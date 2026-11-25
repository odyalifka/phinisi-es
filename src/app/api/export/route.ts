import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { getOwnerReportPeriodData, PeriodMode, resolveDateRange } from '@/lib/queries/owner';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

function rp(val: unknown): string {
  return `Rp ${Math.round(Number(val || 0)).toLocaleString('id-ID')}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    return new NextResponse('Forbidden: Hanya Owner yang dapat mengunduh laporan.', { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get('format') || 'xlsx').toLowerCase();
  const modeParam = (searchParams.get('mode') || 'daily') as PeriodMode;
  const mode: PeriodMode = ['daily', 'weekly', 'monthly'].includes(modeParam) ? modeParam : 'daily';

  const dateRes = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const today = dateRes.rows[0]?.today || '2026-11-25';
  const refDate = searchParams.get('date') || today;

  const range = resolveDateRange(mode, refDate);
  const [report, cashRes] = await Promise.all([
    getOwnerReportPeriodData(range.start, range.end),
    pool.query(`SELECT * FROM v_factory_cash_summary`),
  ]);
  const cash = cashRes.rows[0] || {};
  const m = report.metrics;

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();

    const ringkasanRows = [
      ['LAPORAN KEUNTUNGAN & ARUS KAS PHINISI ES KRISTAL'],
      ['Periode', range.label],
      [],
      ['A. LAPORAN KEUNTUNGAN (LABA RUGI AKRUAL)', 'Nominal (Rp)'],
      ['Pendapatan Penjualan Tunai', m.penjualanTunai],
      ['Pendapatan Penjualan Transfer', m.penjualanTransfer],
      ['Pendapatan Penjualan Piutang', m.penjualanPiutang],
      ['TOTAL PENDAPATAN PENJUALAN', m.pendapatanPenjualan],
      ['Dikurangi: HPP Plastik Terpakai (Rata-Rata Tertimbang)', -m.hppPlastik],
      ['Dikurangi: Pengeluaran Operasional Kas Pabrik', -m.pengeluaranKasPabrik],
      ['Dikurangi: Biaya Dibayar Langsung Owner', -m.biayaDibayarOwner],
      ['Dikurangi: Pengeluaran Transfer Rekening Lain', -m.pengeluaranTransferLain],
      ['Dikurangi: Total Kewajiban Bonus Driver Terbentuk', -m.totalBonusTerbentuk],
      ['KEUNTUNGAN BERSIH (NET PROFIT)', m.keuntunganBersih],
      [],
      ['B. LAPORAN ARUS KAS & PENYERAHAN KE OWNER', 'Nominal (Rp)'],
      ['Penerimaan Tunai dari Penjualan Baru', m.penjualanTunai],
      ['Penerimaan Tunai dari Pembayaran Piutang Lama/Baru', m.bayarPiutangTunai],
      ['TOTAL PENERIMAAN TUNAI PERIODE INI', m.penerimaanTunaiTotal],
      ['Penerimaan Transfer (Penjualan + Bayar Piutang)', m.penerimaanTransferTotal],
      ['Pengeluaran Operasional Kas Pabrik', m.pengeluaranKasPabrik],
      ['Bonus Driver Sudah Dibayarkan', m.bonusSudahDibayar],
      ['Penyerahan Uang ke Owner (Bukan Biaya Operasional)', m.penyerahanKeOwner],
      [],
      ['C. POSISI SALDO KAS PABRIK SAAT INI (KUMULATIF)', 'Nominal (Rp)'],
      ['Saldo Kas Pabrik Sekarang', Number(cash.saldo_kas_pabrik_sekarang || 0)],
      ['Kewajiban Bonus Driver Belum Dibayar', Number(cash.kewajiban_bonus_driver_belum_dibayar || 0)],
      ['Aman Diserahkan ke Owner', Number(cash.aman_diserahkan_ke_owner || 0)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ringkasanRows), 'Laba Rugi & Arus Kas');

    const prodSheet = XLSX.utils.json_to_sheet(
      report.productions.map((r) => ({
        Ukuran: r.size,
        'Produksi Bruto (Bks)': Number(r.gross_qty),
        'Produk Jadi Rusak (Bks)': Number(r.damaged_product_qty),
        'Produksi Layak Jual (Bks)': Number(r.good_qty),
        'Plastik Kosong Rusak (Lbr)': Number(r.damaged_plastic_qty),
        'HPP Plastik (Rp)': Number(r.plastic_cost),
      }))
    );
    XLSX.utils.book_append_sheet(wb, prodSheet, 'Rekap Produksi');

    const distSheet = XLSX.utils.json_to_sheet(
      report.distributions.map((r) => ({
        Metode: r.dist_type === 'pickup' ? 'Ambil Langsung' : 'Diantar Driver',
        Pembayaran: r.payment_method,
        Ukuran: r.size,
        'Jumlah (Bks)': Number(r.total_qty),
        'Omzet Penjualan (Rp)': Number(r.total_omzet),
        'Bonus Driver (Rp)': Number(r.total_bonus),
      }))
    );
    XLSX.utils.book_append_sheet(wb, distSheet, 'Rekap Distribusi');

    const recSheet = XLSX.utils.json_to_sheet(
      report.receivables.map((r) => ({
        Tanggal: r.event_date,
        Pelanggan: r.customer_name,
        Ukuran: r.size,
        Jumlah: Number(r.qty),
        'Total Tagihan (Rp)': Number(r.total_billed),
        'Sisa Tagihan (Rp)': Number(r.remaining_balance),
        Status: r.status,
      }))
    );
    XLSX.utils.book_append_sheet(wb, recSheet, 'Rekap Piutang');

    const paySheet = XLSX.utils.json_to_sheet(
      report.payments.map((r) => ({
        'Tanggal Uang Diterima': r.payment_date,
        'Tanggal Piutang Asal': r.receivable_date,
        Pelanggan: r.customer_name,
        'Nominal Diterima (Rp)': Number(r.amount),
        Metode: r.method,
        Catatan: r.notes || '',
      }))
    );
    XLSX.utils.book_append_sheet(wb, paySheet, 'Pembayaran Piutang');

    const expSheet = XLSX.utils.json_to_sheet(
      report.expenses.map((r) => ({
        Tanggal: r.expense_date,
        Kategori: r.category,
        Keterangan: r.description,
        'Nominal (Rp)': Number(r.amount),
        'Sumber Dana': r.source,
        'Link Bukti Nota': r.receipt_url || '-',
      }))
    );
    XLSX.utils.book_append_sheet(wb, expSheet, 'Rekap Pengeluaran');

    const bonusSheet = XLSX.utils.json_to_sheet(
      report.bonuses.map((r) => ({
        Driver: r.driver_name,
        'Jumlah Antar': Number(r.trip_count),
        'Total Bonus (Rp)': Number(r.total_bonus),
        'Sudah Dibayar (Rp)': Number(r.paid_bonus),
        'Kewajiban Belum Dibayar (Rp)': Number(r.unpaid_bonus),
      }))
    );
    XLSX.utils.book_append_sheet(wb, bonusSheet, 'Bonus Driver');

    const handoverSheet = XLSX.utils.json_to_sheet(
      report.handovers.map((r) => ({
        Tanggal: r.handover_date,
        'Nominal Diserahkan (Rp)': Number(r.amount_handed_over),
        'Saldo Kas Sebelum (Rp)': Number(r.balance_before),
        'Saldo Kas Sesudah (Rp)': Number(r.balance_after),
        Catatan: r.notes || '',
      }))
    );
    XLSX.utils.book_append_sheet(wb, handoverSheet, 'Penyerahan ke Owner');

    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(new Uint8Array(xlsxBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Laporan-Phinisi-Es-${range.start}-sd-${range.end}.xlsx"`,
      },
    });
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595.28, 841.89]);
  let y = 795;

  const ensureSpace = (needed = 24) => {
    if (y - needed < 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 795;
    }
  };

  const drawHeading = (text: string) => {
    ensureSpace(30);
    y -= 8;
    page.drawText(text, { x: 42, y, size: 11, font: fontBold, color: rgb(0.08, 0.2, 0.45) });
    y -= 14;
  };

  const drawRow = (label: string, value: string, bold = false) => {
    ensureSpace(16);
    page.drawText(label.slice(0, 62), {
      x: 46,
      y,
      size: 9.5,
      font: bold ? fontBold : fontRegular,
      color: rgb(0.15, 0.15, 0.15),
    });
    page.drawText(value, {
      x: 370,
      y,
      size: 9.5,
      font: bold ? fontBold : fontRegular,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 14;
  };

  page.drawText('LAPORAN OPERASIONAL & KEUANGAN PHINISI ES KRISTAL', {
    x: 42,
    y,
    size: 14,
    font: fontBold,
    color: rgb(0.05, 0.15, 0.38),
  });
  y -= 16;
  page.drawText(`Periode Laporan: ${range.label}`, {
    x: 42,
    y,
    size: 10,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 18;

  drawHeading('1. LAPORAN KEUNTUNGAN (LABA RUGI AKRUAL)');
  drawRow('Pendapatan Penjualan Tunai', rp(m.penjualanTunai));
  drawRow('Pendapatan Penjualan Transfer', rp(m.penjualanTransfer));
  drawRow('Pendapatan Penjualan Piutang', rp(m.penjualanPiutang));
  drawRow('Total Pendapatan Penjualan', rp(m.pendapatanPenjualan), true);
  drawRow('HPP Plastik Terpakai (Rata-Rata Tertimbang)', `- ${rp(m.hppPlastik)}`);
  drawRow('Pengeluaran Operasional Kas Pabrik', `- ${rp(m.pengeluaranKasPabrik)}`);
  drawRow('Biaya Dibayar Langsung Owner', `- ${rp(m.biayaDibayarOwner)}`);
  drawRow('Pengeluaran Transfer Rekening Lain', `- ${rp(m.pengeluaranTransferLain)}`);
  drawRow('Total Kewajiban Bonus Driver Terbentuk', `- ${rp(m.totalBonusTerbentuk)}`);
  drawRow('KEUNTUNGAN BERSIH (NET PROFIT)', rp(m.keuntunganBersih), true);

  drawHeading('2. ARUS KAS & PENYERAHAN UANG KE OWNER');
  drawRow('Penerimaan Tunai (Penjualan Tunai + Bayar Piutang Tunai)', rp(m.penerimaanTunaiTotal));
  drawRow('Penerimaan Transfer (Penjualan + Bayar Piutang Transfer)', rp(m.penerimaanTransferTotal));
  drawRow('Pengeluaran Operasional Kas Pabrik', rp(m.pengeluaranKasPabrik));
  drawRow('Bonus Driver Sudah Dibayarkan', rp(m.bonusSudahDibayar));
  drawRow('Penyerahan Uang ke Owner (Non-Biaya Operasional)', rp(m.penyerahanKeOwner), true);
  drawRow('Saldo Kas Pabrik Kumulatif Saat Ini', rp(cash.saldo_kas_pabrik_sekarang), true);
  drawRow('Aman Diserahkan ke Owner (Setelah Potong Kewajiban Bonus)', rp(cash.aman_diserahkan_ke_owner), true);

  drawHeading('3. REKAP PRODUKSI');
  if (report.productions.length === 0) {
    drawRow('Tidak ada catatan produksi pada periode ini.', '-');
  } else {
    for (const p of report.productions) {
      drawRow(
        `Ukuran ${p.size}: Bruto ${p.gross_qty} | Rusak ${p.damaged_product_qty} | Layak ${p.good_qty} | Plastik Rusak ${p.damaged_plastic_qty}`,
        `HPP ${rp(p.plastic_cost)}`
      );
    }
  }

  drawHeading('4. REKAP DISTRIBUSI');
  if (report.distributions.length === 0) {
    drawRow('Tidak ada distribusi pada periode ini.', '-');
  } else {
    for (const d of report.distributions) {
      drawRow(
        `${d.dist_type === 'pickup' ? 'Ambil' : 'Antar'} ${d.size} (${d.payment_method}) - ${d.total_qty} bks`,
        rp(d.total_omzet)
      );
    }
  }

  drawHeading('5. REKAP PIUTANG & PEMBAYARAN DITERIMA');
  drawRow(`Piutang Baru Terbentuk (${report.receivables.length} transaksi)`, rp(m.penjualanPiutang));
  drawRow(
    `Pembayaran Piutang Diterima (${report.payments.length} transaksi)`,
    rp(m.bayarPiutangTunai + m.bayarPiutangTransfer)
  );

  drawHeading('6. REKAP PENGELUARAN');
  if (report.expenses.length === 0) {
    drawRow('Tidak ada pengeluaran pada periode ini.', '-');
  } else {
    for (const e of report.expenses) {
      drawRow(`[${e.expense_date}] ${e.category.toUpperCase()} - ${e.description} (${e.source})`, rp(e.amount));
    }
  }

  drawHeading('7. REKAP BONUS DRIVER');
  if (report.bonuses.length === 0) {
    drawRow('Tidak ada pengantaran driver pada periode ini.', '-');
  } else {
    for (const b of report.bonuses) {
      drawRow(`${b.driver_name} (${b.trip_count} antar) | Dibayar: ${rp(b.paid_bonus)}`, `Sisa: ${rp(b.unpaid_bonus)}`);
    }
  }

  const pdfBytes = await pdfDoc.save();

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Laporan-Phinisi-Es-${range.start}-sd-${range.end}.pdf"`,
    },
  });
}