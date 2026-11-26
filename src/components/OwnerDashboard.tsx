'use client';

import {
  bayarBonusDriver,
  tambahDriver,
  ubahDriver,
  hapusDriver,
  bayarPiutangBertahap,
  beliPlastik,
  logoutAction,
  simpanOpnameColdStorage,
  simpanOpnamePlastik,
  simpanSerahKasOwner,
  tambahPengambilanLangsung,
  tambahPengantaran,
  tambahPengeluaran,
  tambahProduksiBatch,
  voidDistribusi,
  voidPengeluaran,
  voidProduksi,
} from '@/app/actions';
import { UserSession } from '@/lib/auth';
import { PeriodMode } from '@/lib/queries/owner';
import { useState } from 'react';
import CopyReportButton from './CopyReportButton';

const MANDATORY_CATS = new Set(['bbm', 'perawatan_kendaraan', 'material_operasional']);

function rp(n: number | string) {
  return `Rp ${Math.round(Number(n || 0)).toLocaleString('id-ID')}`;
}

export default function OwnerDashboard({
  session,
  today,
  mode,
  refDate,
  data,
  errorMsg,
  successMsg,
}: {
  session: UserSession;
  today: string;
  mode: PeriodMode;
  refDate: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  errorMsg?: string;
  successMsg?: string;
}) {
  const [expCategory, setExpCategory] = useState('bbm');
  const isReceiptRequired = MANDATORY_CATS.has(expCategory);

  const m = data.periodReport.metrics;
  const cash = data.cash;

  const waSummary = [
    `*LAPORAN PHINISI ES KRISTAL*`,
    `Periode: ${data.range.label}`,
    ``,
    `*A. KEUNTUNGAN BERSIH (LABA RUGI)*`,
    `- Pendapatan Penjualan: ${rp(m.pendapatanPenjualan)}`,
    `- HPP Plastik Terpakai: ${rp(m.hppPlastik)}`,
    `- Pengeluaran Operasional Total: ${rp(m.totalPengeluaranOperasional)}`,
    `- Kewajiban Bonus Driver: ${rp(m.totalBonusTerbentuk)}`,
    `- *Keuntungan Bersih: ${rp(m.keuntunganBersih)}*`,
    ``,
    `*B. ARUS KAS & PENYERAHAN OWNER*`,
    `- Penerimaan Tunai (Jual + Bayar Piutang): ${rp(m.penerimaanTunaiTotal)}`,
    `- Penerimaan Transfer: ${rp(m.penerimaanTransferTotal)}`,
    `- Keluar Kas Pabrik: ${rp(m.pengeluaranKasPabrik)}`,
    `- Bonus Driver Dibayar: ${rp(m.bonusSudahDibayar)}`,
    `- Setoran ke Owner: ${rp(m.penyerahanKeOwner)}`,
    ``,
    `*C. SALDO KAS PABRIK SAAT INI*`,
    `- Saldo Kas Pabrik: ${rp(cash.saldo_kas_pabrik_sekarang)}`,
    `- Kewajiban Bonus Belum Dibayar: ${rp(cash.kewajiban_bonus_driver_belum_dibayar)}`,
    `- Aman Diserahkan ke Owner: ${rp(cash.aman_diserahkan_ke_owner)}`,
  ].join('\n');

  const latestIceOpnameMap = new Map<string, { actual_qty: number; theoretical_qty: number; opname_date: string }>(
    data.latestIceOpnames.map((o: { size: string; actual_qty: number; theoretical_qty: number; opname_date: string }) => [
      o.size,
      o,
    ])
  );
  const latestPlasticOpnameMap = new Map<string, { actual_qty: number; theoretical_qty: number; opname_date: string }>(
    data.latestPlasticOpnames.map((o: { size: string; actual_qty: number; theoretical_qty: number; opname_date: string }) => [
      o.size,
      o,
    ])
  );

  const lastOpnameDates = data.latestIceOpnames.map((o: { opname_date: string }) => o.opname_date).sort();
  const latestOpnameDateStr: string | null = lastOpnameDates[lastOpnameDates.length - 1] || null;
  let daysSinceOpname = 999;
  if (latestOpnameDateStr) {
    const diffMs = new Date(today).getTime() - new Date(latestOpnameDateStr).getTime();
    daysSinceOpname = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="bg-blue-950 text-white p-6 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sistem Operasional & Keuangan Phinisi Es Kristal</h1>
            <p className="text-blue-200 text-sm">Panel Pengawasan Penuh Owner - Laba Rugi, Arus Kas, Kontrol Plastik & Audit Trail</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs bg-blue-900 px-3 py-1.5 rounded-full">
              {session.name} (OWNER)
            </span>
            <form action={logoutAction}>
              <button type="submit" className="text-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold px-3 py-1.5 rounded-full">
                Keluar
              </button>
            </form>
          </div>
        </header>

        {errorMsg && (
          <div className="bg-rose-50 border border-rose-300 text-rose-800 px-4 py-3 rounded-xl text-sm font-medium">
            Peringatan: {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-xl text-sm font-medium">
            {successMsg}
          </div>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Saldo Kas Pabrik Sekarang</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{rp(cash.saldo_kas_pabrik_sekarang)}</p>
            <p className="text-xs text-slate-400 mt-1">Total Tunai Masuk: {rp(cash.total_uang_tunai_masuk)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Aman Diserahkan ke Owner</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{rp(cash.aman_diserahkan_ke_owner)}</p>
            <p className="text-xs text-slate-400 mt-1">Saldo kas dikurangi kewajiban bonus</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Kewajiban Bonus Driver</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{rp(cash.kewajiban_bonus_driver_belum_dibayar)}</p>
            <p className="text-xs text-slate-400 mt-1">Belum dibayarkan</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Keuntungan Bersih ({data.range.label})</p>
            <p className={`text-2xl font-bold mt-1 ${m.keuntunganBersih >= 0 ? 'text-blue-900' : 'text-rose-600'}`}>
              {rp(m.keuntunganBersih)}
            </p>
            <p className="text-xs text-slate-400 mt-1">Setoran ke owner tidak mengurangi laba</p>
          </div>
        </section>

        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Laporan Keuntungan, Arus Kas & Rekap Operasional</h2>
              <p className="text-xs text-slate-500">Periode Aktif: <strong>{data.range.label}</strong></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form method="GET" className="flex flex-wrap items-center gap-2">
                <select name="mode" defaultValue={mode} className="border rounded-lg px-3 py-1.5 text-xs font-semibold">
                  <option value="daily">Harian</option>
                  <option value="weekly">Mingguan</option>
                  <option value="monthly">Bulanan</option>
                </select>
                <input type="date" name="date" defaultValue={refDate} className="border rounded-lg px-3 py-1.5 text-xs" />
                <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-2 rounded-lg">
                  Terapkan Filter
                </button>
              </form>
              <a
                href={`/api/export?format=xlsx&mode=${mode}&date=${refDate}`}
                className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold px-3.5 py-2 rounded-lg"
              >
                Ekspor Excel (.XLSX)
              </a>
              <a
                href={`/api/export?format=pdf&mode=${mode}&date=${refDate}`}
                className="bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold px-3.5 py-2 rounded-lg"
              >
                Ekspor PDF (.PDF)
              </a>
              <CopyReportButton text={waSummary} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
            <div className="border rounded-xl p-4 bg-blue-50/40 space-y-2">
              <h3 className="font-bold text-sm text-blue-950 border-b border-blue-200 pb-1.5">
                A. Laporan Keuntungan (Laba Rugi Akrual)
              </h3>
              <div className="flex justify-between"><span>Pendapatan Penjualan Tunai</span><span>{rp(m.penjualanTunai)}</span></div>
              <div className="flex justify-between"><span>Pendapatan Penjualan Transfer</span><span>{rp(m.penjualanTransfer)}</span></div>
              <div className="flex justify-between"><span>Pendapatan Penjualan Piutang</span><span>{rp(m.penjualanPiutang)}</span></div>
              <div className="flex justify-between font-bold border-t pt-1"><span>Total Pendapatan Penjualan</span><span>{rp(m.pendapatanPenjualan)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) HPP Plastik Terpakai (Rata-Rata Tertimbang)</span><span>-{rp(m.hppPlastik)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) Pengeluaran Operasional Kas Pabrik</span><span>-{rp(m.pengeluaranKasPabrik)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) Biaya Dibayar Langsung Owner</span><span>-{rp(m.biayaDibayarOwner)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) Pengeluaran Transfer Rekening Lain</span><span>-{rp(m.pengeluaranTransferLain)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) Total Kewajiban Bonus Driver Terbentuk</span><span>-{rp(m.totalBonusTerbentuk)}</span></div>
              <div className="flex justify-between font-bold text-sm border-t border-blue-200 pt-1.5 text-blue-950">
                <span>KEUNTUNGAN BERSIH</span>
                <span>{rp(m.keuntunganBersih)}</span>
              </div>
            </div>

            <div className="border rounded-xl p-4 bg-emerald-50/40 space-y-2">
              <h3 className="font-bold text-sm text-emerald-950 border-b border-emerald-200 pb-1.5">
                B. Arus Kas Aktual & Penyerahan Uang ke Owner
              </h3>
              <div className="flex justify-between"><span>Penerimaan Tunai Penjualan Baru</span><span>{rp(m.penjualanTunai)}</span></div>
              <div className="flex justify-between"><span>Penerimaan Tunai Pembayaran Piutang (Tgl Diterima)</span><span>{rp(m.bayarPiutangTunai)}</span></div>
              <div className="flex justify-between font-bold border-t pt-1"><span>Total Penerimaan Tunai Periode Ini</span><span>{rp(m.penerimaanTunaiTotal)}</span></div>
              <div className="flex justify-between"><span>Total Penerimaan Transfer (Jual + Bayar Piutang)</span><span>{rp(m.penerimaanTransferTotal)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) Pengeluaran Operasional Kas Pabrik</span><span>-{rp(m.pengeluaranKasPabrik)}</span></div>
              <div className="flex justify-between text-rose-700"><span>(-) Bonus Driver Sudah Dibayarkan</span><span>-{rp(m.bonusSudahDibayar)}</span></div>
              <div className="flex justify-between font-bold text-teal-900 border-t border-emerald-200 pt-1.5">
                <span>Penyerahan Uang ke Owner (Non-Biaya Operasional)</span>
                <span>{rp(m.penyerahanKeOwner)}</span>
              </div>
              <p className="text-[11px] text-slate-500 pt-1">
                * Pembayaran piutang lama dicatat sebagai penerimaan pada tanggal uang diterima dan tidak dihitung ulang sebagai penjualan baru.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b pb-3">
            <div>
              <h2 className="text-lg font-bold text-blue-950">Kontrol Stok Es & Stock Opname Cold Storage (Wajib Akhir Minggu)</h2>
              <p className="text-xs text-slate-500">
                Opname Terakhir: <strong>{latestOpnameDateStr || 'Belum pernah dilakukan'}</strong>
              </p>
            </div>
            {daysSinceOpname >= 7 ? (
              <span className="text-xs bg-rose-100 text-rose-800 font-bold px-3 py-1.5 rounded-full w-fit">
                Peringatan: Jadwal Stock Opname Akhir Minggu Sudah Jatuh Tempo!
              </span>
            ) : (
              <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-3 py-1.5 rounded-full w-fit">
                Status Opname Mingguan Terkendali ({daysSinceOpname} hari lalu)
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-600 uppercase">
                <tr>
                  <th className="p-2.5">Ukuran</th>
                  <th className="p-2.5">Stok Awal / Opname</th>
                  <th className="p-2.5">Produksi Layak</th>
                  <th className="p-2.5">Produk Rusak</th>
                  <th className="p-2.5">Ambil</th>
                  <th className="p-2.5">Antar</th>
                  <th className="p-2.5 font-bold text-blue-900">Stok Teoretis</th>
                  <th className="p-2.5">Stok Aktual Opname Terakhir</th>
                  <th className="p-2.5">Selisih Opname Terakhir</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.iceStock.map((row: {
                  size: string;
                  stok_awal_atau_opname: number;
                  produksi_layak_jual: number;
                  produk_jadi_rusak: number;
                  ambil_langsung: number;
                  diantar_driver: number;
                  stok_teoretis_sekarang: number;
                }) => {
                  const lastOp = latestIceOpnameMap.get(row.size);
                  const selisihOp = lastOp ? Number(lastOp.actual_qty) - Number(lastOp.theoretical_qty) : 0;
                  return (
                    <tr key={row.size}>
                      <td className="p-2.5 font-bold">{row.size}</td>
                      <td className="p-2.5">{row.stok_awal_atau_opname}</td>
                      <td className="p-2.5 text-emerald-700 font-medium">+{row.produksi_layak_jual}</td>
                      <td className="p-2.5 text-rose-600">{row.produk_jadi_rusak}</td>
                      <td className="p-2.5">{row.ambil_langsung}</td>
                      <td className="p-2.5">{row.diantar_driver}</td>
                      <td className="p-2.5 font-bold text-blue-900 text-sm">{row.stok_teoretis_sekarang} bks</td>
                      <td className="p-2.5">{lastOp ? `${lastOp.actual_qty} bks (${lastOp.opname_date})` : '-'}</td>
                      <td className={`p-2.5 font-bold ${selisihOp !== 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                        {lastOp ? `${selisihOp > 0 ? '+' : ''}${selisihOp} bks` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form action={simpanOpnameColdStorage} className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-3">
            <h3 className="font-bold text-sm text-indigo-950">Input Stock Opname Cold Storage (Ketiga Ukuran)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Tanggal Opname</label>
                <input type="date" name="opname_date" defaultValue={today} required className="w-full border bg-white rounded-lg p-2" />
              </div>
              {(['5kg', '10kg', '20kg'] as const).map((sz) => (
                <div key={sz}>
                  <label className="block font-medium mb-1">Stok Fisik Aktual {sz} (Bks)</label>
                  <input type="number" name={`actual_${sz}`} min="0" placeholder="Kosongkan jika tdk diopname" className="w-full border bg-white rounded-lg p-2" />
                </div>
              ))}
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                type="text"
                name="notes"
                placeholder="Keterangan selisih (WAJIB diisi jika stok aktual berbeda dari stok teoretis)"
                className="flex-1 border bg-white rounded-lg p-2 text-xs"
              />
              <button type="submit" className="bg-indigo-900 hover:bg-indigo-800 text-white font-semibold px-5 py-2 rounded-lg text-xs">
                Simpan Stock Opname Cold Storage
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="border-b pb-3">
            <h2 className="text-lg font-bold text-purple-950">Modul Kontrol Persediaan Plastik (5 kg, 10 kg, 20 kg)</h2>
            <p className="text-xs text-slate-500">
              Pembelian plastik oleh Owner otomatis menghitung ulang Harga Rata-Rata Tertimbang (Weighted Average Cost).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-600 uppercase">
                <tr>
                  <th className="p-2.5">Ukuran</th>
                  <th className="p-2.5">Stok Awal</th>
                  <th className="p-2.5">Pembelian</th>
                  <th className="p-2.5">Terpakai</th>
                  <th className="p-2.5">Plastik Rusak</th>
                  <th className="p-2.5 font-bold text-purple-900">Stok Teoretis</th>
                  <th className="p-2.5">Stok Aktual Opname</th>
                  <th className="p-2.5">Selisih & %</th>
                  <th className="p-2.5 font-bold">Harga Rata-Rata Tertimbang</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.plasticStock.map((row: {
                  size: string;
                  stok_awal: number;
                  pembelian: number;
                  plastik_terpakai: number;
                  plastik_kosong_rusak: number;
                  stok_teoretis: number;
                  harga_rata_rata_tertimbang: number;
                }) => {
                  const lastOp = latestPlasticOpnameMap.get(row.size);
                  const selisih = lastOp ? Number(lastOp.actual_qty) - Number(lastOp.theoretical_qty) : 0;
                  const pct =
                    lastOp && Number(lastOp.theoretical_qty) > 0
                      ? ((selisih / Number(lastOp.theoretical_qty)) * 100).toFixed(2)
                      : '0.00';
                  return (
                    <tr key={row.size}>
                      <td className="p-2.5 font-bold">{row.size}</td>
                      <td className="p-2.5">{row.stok_awal}</td>
                      <td className="p-2.5 text-emerald-700">+{row.pembelian}</td>
                      <td className="p-2.5">{row.plastik_terpakai}</td>
                      <td className="p-2.5 text-rose-600">{row.plastik_kosong_rusak}</td>
                      <td className="p-2.5 font-bold text-purple-900 text-sm">{row.stok_teoretis} lbr</td>
                      <td className="p-2.5">{lastOp ? `${lastOp.actual_qty} lbr (${lastOp.opname_date})` : '-'}</td>
                      <td className={`p-2.5 font-bold ${selisih !== 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                        {lastOp ? `${selisih} lbr (${pct}%)` : '-'}
                      </td>
                      <td className="p-2.5 font-bold text-slate-900">{rp(row.harga_rata_rata_tertimbang)} / lbr</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <form action={beliPlastik} className="border rounded-xl p-4 bg-purple-50/40 space-y-2.5">
              <h3 className="font-bold text-sm text-purple-950">Input Pembelian Plastik (Khusus Owner)</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium mb-1">Tanggal Beli</label>
                  <input type="date" name="purchase_date" defaultValue={today} required className="w-full border bg-white rounded p-1.5" />
                </div>
                <div>
                  <label className="block font-medium mb-1">Ukuran</label>
                  <select name="size" className="w-full border bg-white rounded p-1.5">
                    <option value="5kg">5 kg</option>
                    <option value="10kg">10 kg</option>
                    <option value="20kg">20 kg</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Jumlah (Lembar)</label>
                  <input type="number" name="qty" min="1" required className="w-full border bg-white rounded p-1.5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium mb-1">Harga Beli per Lembar (Rp)</label>
                  <input type="number" name="unit_price" min="0" step="0.01" required className="w-full border bg-white rounded p-1.5" />
                </div>
                <div>
                  <label className="block font-medium mb-1">Supplier</label>
                  <input type="text" name="supplier_name" placeholder="Nama toko/pabrik plastik" className="w-full border bg-white rounded p-1.5" />
                </div>
              </div>
              <button type="submit" className="w-full bg-purple-900 hover:bg-purple-800 text-white font-semibold py-2 rounded-lg">
                Simpan Pembelian Plastik
              </button>
            </form>

            <form action={simpanOpnamePlastik} className="border rounded-xl p-4 bg-slate-50 space-y-2.5">
              <h3 className="font-bold text-sm text-slate-900">Stock Opname Persediaan Plastik</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium mb-1">Tanggal Opname</label>
                  <input type="date" name="opname_date" defaultValue={today} required className="w-full border bg-white rounded p-1.5" />
                </div>
                <div>
                  <label className="block font-medium mb-1">Ukuran</label>
                  <select name="size" className="w-full border bg-white rounded p-1.5">
                    <option value="5kg">5 kg</option>
                    <option value="10kg">10 kg</option>
                    <option value="20kg">20 kg</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Stok Fisik (Lembar)</label>
                  <input type="number" name="actual_qty" min="0" required className="w-full border bg-white rounded p-1.5" />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Keterangan (Wajib jika ada selisih)</label>
                <input type="text" name="notes" placeholder="Alasan selisih fisik plastik" className="w-full border bg-white rounded p-1.5" />
              </div>
              <button type="submit" className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2 rounded-lg">
                Simpan Opname Plastik
              </button>
            </form>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form action={tambahProduksiBatch} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
              <h3 className="font-bold text-base text-blue-900 border-b pb-2">Input Produksi Multi-Ukuran</h3>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" name="event_date" defaultValue={today} required className="border rounded p-2" />
                <input type="text" name="notes" placeholder="Catatan produksi" className="border rounded p-2" />
              </div>
              <div className="grid grid-cols-3 gap-2 px-2 text-[11px] font-semibold text-slate-500">
                <span>Ukuran</span>
                <span>Produksi (Bks)</span>
                <span>Plastik Rusak (Lbr)</span>
              </div>
              {(['5kg', '10kg', '20kg'] as const).map((sz) => (
                <div key={sz} className="grid grid-cols-3 gap-2 items-center bg-slate-50 p-2 rounded border">
                  <span className="font-bold">{sz}</span>
                  <input type="number" name={`gross_${sz}`} min="0" defaultValue="0" placeholder="Produksi (Bks)" className="border bg-white rounded p-1.5" />
                  <input type="number" name={`damaged_plastic_${sz}`} min="0" defaultValue="0" placeholder="Plastik Rusak (Lbr)" className="border bg-white rounded p-1.5" />
                </div>
              ))}
              <button type="submit" className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg">
                Simpan Produksi
              </button>
            </form>

          <form action={simpanSerahKasOwner} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <h3 className="font-bold text-base text-teal-900 border-b pb-2">Serah Terima Kas ke Owner</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-medium mb-1">Tanggal Setor</label>
                <input type="date" name="handover_date" defaultValue={today} required className="w-full border rounded p-2" />
              </div>
              <div>
                <label className="block font-medium mb-1">Nominal Diserahkan (Rp)</label>
                <input type="number" name="amount_handed_over" min="1" required className="w-full border rounded p-2" />
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">Catatan Setoran</label>
              <input type="text" name="notes" placeholder="Contoh: Setoran kas harian" className="w-full border rounded p-2" />
            </div>
            <button type="submit" className="w-full bg-teal-800 hover:bg-teal-700 text-white font-semibold py-2 rounded-lg">
              Catat Setoran ke Owner
            </button>
          </form>
        </section>

                <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 text-xs">
          <div className="border-b pb-2">
            <h2 className="text-base font-bold text-slate-900">Manajemen Karyawan Driver (Dropdown Pengantaran)</h2>
            <p className="text-slate-500">Tambah driver baru, ubah nama driver, atau hapus driver yang sudah keluar. Riwayat pengantaran lama tetap aman tersimpan.</p>
          </div>

          <form action={tambahDriver} className="flex flex-col sm:flex-row gap-2 max-w-md">
            <input type="text" name="driver_name" required placeholder="Nama driver baru..." className="flex-1 border rounded-lg px-3 py-2" />
            <button type="submit" className="bg-blue-900 hover:bg-blue-800 text-white font-semibold px-4 py-2 rounded-lg">
              + Tambah Driver
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.drivers.map((drv: { id: string; name: string }) => (
              <div key={drv.id} className="border rounded-lg p-3 bg-slate-50 flex items-center justify-between gap-2">
                <form action={ubahDriver} className="flex items-center gap-1.5 flex-1">
                  <input type="hidden" name="driver_id" value={drv.id} />
                  <input type="text" name="new_name" defaultValue={drv.name} required className="w-full border bg-white rounded px-2 py-1 text-xs font-semibold" />
                  <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded font-semibold">
                    Simpan
                  </button>
                </form>
                <form action={hapusDriver}>
                  <input type="hidden" name="driver_id" value={drv.id} />
                  <button type="submit" className="bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 rounded font-semibold">
                    Hapus
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
          <form action={tambahPengambilanLangsung} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
            <h3 className="font-bold text-sm text-emerald-800 border-b pb-1.5">Pengambilan Langsung (Lunas)</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" name="event_date" defaultValue={today} required className="border rounded p-1.5" />
              <select name="payment_method" className="border rounded p-1.5">
                <option value="cash">Tunai (Cash)</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['5kg', '10kg', '20kg'] as const).map((sz) => (
                <div key={sz}>
                  <label className="block font-bold">{sz}</label>
                  <input type="number" name={`qty_${sz}`} min="0" defaultValue="0" className="w-full border rounded p-1.5" />
                </div>
              ))}
            </div>
            <input type="text" name="notes" placeholder="Catatan" className="w-full border rounded p-1.5" />
            <button type="submit" className="w-full bg-emerald-700 text-white font-semibold py-2 rounded-lg">
              Simpan Ambil Langsung
            </button>
          </form>

          <form action={tambahPengantaran} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
            <h3 className="font-bold text-sm text-teal-800 border-b pb-1.5">Pengantaran Driver</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" name="event_date" defaultValue={today} required className="border rounded p-1.5" />
              <select name="driver_name" required className="border rounded p-1.5 bg-white">
                  <option value="">-- Pilih Driver --</option>
                  {data.drivers.filter((d: { is_active: boolean }) => d.is_active).map((d: { id: string; name: string }) => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['5kg', '10kg', '20kg'] as const).map((sz) => (
                <div key={sz}>
                  <label className="block font-bold">{sz}</label>
                  <input type="number" name={`qty_${sz}`} min="0" defaultValue="0" className="w-full border rounded p-1.5" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select name="payment_method" className="border rounded p-1.5">
                <option value="cash">Tunai</option>
                <option value="transfer">Transfer</option>
                <option value="receivable">Piutang</option>
              </select>
              <select name="existing_customer_id" className="border rounded p-1.5">
                <option value="">-- Pelanggan Baru --</option>
                {data.customers.map((c: { id: string; name: string }) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <input type="text" name="customer_name" placeholder="Nama pelanggan baru (jika piutang)" className="w-full border rounded p-1.5" />
            <button type="submit" className="w-full bg-teal-800 text-white font-semibold py-2 rounded-lg">
              Simpan Pengantaran
            </button>
          </form>

          <form action={tambahPengeluaran} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
            <h3 className="font-bold text-sm text-rose-800 border-b pb-1.5">Input Pengeluaran</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" name="expense_date" defaultValue={today} required className="border rounded p-1.5" />
              <select
                name="category"
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                className="border rounded p-1.5"
              >
                <option value="bbm">BBM (Wajib Foto)</option>
                <option value="perawatan_kendaraan">Perawatan Kendaraan (Wajib Foto)</option>
                <option value="material_operasional">Material Pabrik (Wajib Foto)</option>
                <option value="konsumsi">Konsumsi Harian (Opsional)</option>
                <option value="listrik">Listrik (Opsional)</option>
                <option value="gaji">Gaji Karyawan (Opsional)</option>
                <option value="perawatan_mesin">Perawatan Mesin (Opsional)</option>
              </select>
            </div>
            <input type="text" name="description" required placeholder="Keterangan pengeluaran" className="w-full border rounded p-1.5" />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" name="amount" min="1" required placeholder="Nominal (Rp)" className="border rounded p-1.5" />
              <select name="source" className="border rounded p-1.5">
                <option value="factory_cash">Kas Pabrik</option>
                <option value="owner_direct">Dibayar Langsung Owner</option>
                <option value="other_transfer">Transfer Rekening Lain</option>
              </select>
            </div>
            <input type="file" name="receipt" accept="image/*" required={isReceiptRequired} className="w-full border rounded p-1" />
            <button type="submit" className="w-full bg-rose-700 text-white font-semibold py-2 rounded-lg">
              Simpan Pengeluaran
            </button>
          </form>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-base text-slate-900">Piutang Pelanggan Aktif (Pembayaran Bertahap / Lunas)</h3>
            {data.allReceivables.length === 0 ? (
              <p className="text-slate-400">Tidak ada piutang berjalan.</p>
            ) : (
              <div className="space-y-3">
                {data.allReceivables.map((r: {
                  id: string;
                  event_date: string;
                  customer_name: string;
                  size: string;
                  qty: number;
                  remaining_balance: number;
                }) => (
                  <div key={r.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="font-bold">{r.customer_name} ({r.event_date} - {r.size}x{r.qty})</span>
                      <span className="font-bold text-rose-700">Sisa: {rp(r.remaining_balance)}</span>
                    </div>
                    <form action={bayarPiutangBertahap} className="grid grid-cols-4 gap-1.5">
                      <input type="hidden" name="receivable_id" value={r.id} />
                      <input type="date" name="payment_date" defaultValue={today} required className="border rounded px-2 py-1" />
                      <input type="number" name="amount" min="1" max={r.remaining_balance} defaultValue={r.remaining_balance} required className="border rounded px-2 py-1" />
                      <select name="method" className="border rounded px-2 py-1">
                        <option value="cash">Cash</option>
                        <option value="transfer">Transfer</option>
                      </select>
                      <button type="submit" className="bg-emerald-700 text-white font-semibold rounded px-2 py-1">
                        Bayar
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-base text-slate-900">Kewajiban Bonus Driver</h3>
              {data.unpaidBonuses.length > 0 && (
                <form action={bayarBonusDriver}>
                  <input type="hidden" name="driver_name" value="__ALL__" />
                  <button type="submit" className="bg-amber-600 text-white font-semibold px-3 py-1.5 rounded">
                    Bayar Semua Bonus
                  </button>
                </form>
              )}
            </div>
            {data.unpaidBonuses.length === 0 ? (
              <p className="text-slate-400">Semua bonus driver sudah dibayarkan.</p>
            ) : (
              <div className="space-y-2">
                {data.unpaidBonuses.map((b: { driver_name: string; jumlah_antar: number; total_bonus: number }, i: number) => (
                  <div key={i} className="flex justify-between items-center border-b pb-2">
                    <div>
                      <p className="font-bold">{b.driver_name}</p>
                      <p className="text-slate-500">{b.jumlah_antar} pengantaran - {rp(b.total_bonus)}</p>
                    </div>
                    <form action={bayarBonusDriver}>
                      <input type="hidden" name="driver_name" value={b.driver_name} />
                      <button type="submit" className="bg-blue-900 text-white font-semibold px-3 py-1.5 rounded">
                        Bayar Bonus
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

                <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 text-xs">
          <div className="border-b pb-2">
            <h2 className="text-base font-bold text-slate-900">Manajemen Karyawan Driver (Dropdown Pengantaran)</h2>
            <p className="text-slate-500">Tambah driver baru, ubah nama driver, atau hapus driver yang sudah keluar. Riwayat pengantaran lama tetap aman tersimpan.</p>
          </div>

          <form action={tambahDriver} className="flex flex-col sm:flex-row gap-2 max-w-md">
            <input type="text" name="driver_name" required placeholder="Nama driver baru..." className="flex-1 border rounded-lg px-3 py-2" />
            <button type="submit" className="bg-blue-900 hover:bg-blue-800 text-white font-semibold px-4 py-2 rounded-lg">
              + Tambah Driver
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.drivers.map((drv: { id: string; name: string }) => (
              <div key={drv.id} className="border rounded-lg p-3 bg-slate-50 flex items-center justify-between gap-2">
                <form action={ubahDriver} className="flex items-center gap-1.5 flex-1">
                  <input type="hidden" name="driver_id" value={drv.id} />
                  <input type="text" name="new_name" defaultValue={drv.name} required className="w-full border bg-white rounded px-2 py-1 text-xs font-semibold" />
                  <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded font-semibold">
                    Simpan
                  </button>
                </form>
                <form action={hapusDriver}>
                  <input type="hidden" name="driver_id" value={drv.id} />
                  <button type="submit" className="bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 rounded font-semibold">
                    Hapus
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
            <h3 className="font-bold text-sm text-blue-950 border-b pb-1.5">Riwayat Produksi & Void</h3>
            {data.recentProductions.map((p: {
              id: string;
              event_date: string;
              size: string;
              gross_qty: number;
              damaged_product_qty: number;
              good_qty: number;
              is_voided: boolean;
            }) => (
              <div key={p.id} className={`border-b pb-2 ${p.is_voided ? 'opacity-50' : ''}`}>
                <p className="font-semibold">
                  [{p.event_date}] {p.size} - Bruto {p.gross_qty} | Layak {p.good_qty}
                </p>
                {p.is_voided ? (
                  <span className="text-rose-700 font-bold">VOID</span>
                ) : (
                  <form action={voidProduksi} className="flex gap-1 mt-1">
                    <input type="hidden" name="production_id" value={p.id} />
                    <input type="text" name="void_reason" required placeholder="Alasan void" className="flex-1 border rounded px-1.5 py-0.5" />
                    <button type="submit" className="bg-rose-700 text-white px-2 py-0.5 rounded font-semibold">Void</button>
                  </form>
                )}
              </div>
            ))}
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
            <h3 className="font-bold text-sm text-emerald-950 border-b pb-1.5">Riwayat Distribusi & Void</h3>
            {data.recentDistributions.map((d: {
              id: string;
              event_date: string;
              dist_type: string;
              driver_name: string | null;
              size: string;
              qty: number;
              total_amount: number;
              is_voided: boolean;
            }) => (
              <div key={d.id} className={`border-b pb-2 ${d.is_voided ? 'opacity-50' : ''}`}>
                <p className="font-semibold">
                  [{d.event_date}] {d.dist_type === 'pickup' ? 'Ambil' : `Antar (${d.driver_name})`} {d.size}x{d.qty} ({rp(d.total_amount)})
                </p>
                {d.is_voided ? (
                  <span className="text-rose-700 font-bold">VOID</span>
                ) : (
                  <form action={voidDistribusi} className="flex gap-1 mt-1">
                    <input type="hidden" name="distribution_id" value={d.id} />
                    <input type="text" name="void_reason" required placeholder="Alasan void" className="flex-1 border rounded px-1.5 py-0.5" />
                    <button type="submit" className="bg-rose-700 text-white px-2 py-0.5 rounded font-semibold">Void</button>
                  </form>
                )}
              </div>
            ))}
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
            <h3 className="font-bold text-sm text-rose-950 border-b pb-1.5">Riwayat Pengeluaran & Void</h3>
            {data.recentExpenses.map((e: {
              id: string;
              expense_date: string;
              category: string;
              description: string;
              amount: number;
              receipt_url: string | null;
              is_voided: boolean;
            }) => (
              <div key={e.id} className={`border-b pb-2 ${e.is_voided ? 'opacity-50' : ''}`}>
                <p className="font-semibold">
                  [{e.expense_date}] {e.category.toUpperCase()} {rp(e.amount)}{' '}
                  {e.receipt_url && (
                    <a href={e.receipt_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">[Nota]</a>
                  )}
                </p>
                <p className="text-slate-500">{e.description}</p>
                {e.is_voided ? (
                  <span className="text-rose-700 font-bold">VOID</span>
                ) : (
                  <form action={voidPengeluaran} className="flex gap-1 mt-1">
                    <input type="hidden" name="expense_id" value={e.id} />
                    <input type="text" name="void_reason" required placeholder="Alasan void" className="flex-1 border rounded px-1.5 py-0.5" />
                    <button type="submit" className="bg-rose-700 text-white px-2 py-0.5 rounded font-semibold">Void</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h2 className="text-base font-bold text-slate-900 border-b pb-2">Audit Log Perubahan & Pembatalan Sistem</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-600 uppercase">
                <tr>
                  <th className="p-2">Waktu (WITA)</th>
                  <th className="p-2">Pengguna</th>
                  <th className="p-2">Aksi & Tabel</th>
                  <th className="p-2">Alasan</th>
                  <th className="p-2">Nilai Lama</th>
                  <th className="p-2">Nilai Baru</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.auditLogs.map((log: {
                  id: string;
                  waktu_wita: string;
                  changed_by: string;
                  action_type: string;
                  table_name: string;
                  reason: string;
                  old_values: unknown;
                  new_values: unknown;
                }) => (
                  <tr key={log.id}>
                    <td className="p-2 whitespace-nowrap">{log.waktu_wita}</td>
                    <td className="p-2 font-medium">{log.changed_by}</td>
                    <td className="p-2 font-bold">{log.action_type} ({log.table_name})</td>
                    <td className="p-2">{log.reason}</td>
                    <td className="p-2 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                      {log.old_values ? JSON.stringify(log.old_values) : '-'}
                    </td>
                    <td className="p-2 font-mono text-[11px] text-slate-800 max-w-xs truncate">
                      {log.new_values ? JSON.stringify(log.new_values) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}