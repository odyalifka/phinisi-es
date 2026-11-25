import CopyReportButton from '@/components/CopyReportButton';
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { connection } from 'next/server';
import {
  bayarBonusDriver,
  loginAction,
  logoutAction,
  lunasiPiutang,
  simpanSerahKasOwner,
  simpanStokOpname,
  tambahDistribusi,
  tambahPengeluaran,
  tambahProduksi,
  voidDistribusi,
  voidPengeluaran,
  voidProduksi,
} from './actions';

export const instant = false;

function formatRupiah(angka: number | string) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(angka || 0));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string; error?: string; success?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const session = await getSession();

  if (!session) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4 text-slate-800">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-blue-950">Phinisi Es Kristal</h1>
            <p className="text-sm text-slate-500">Sistem Operasional, Cold Storage & Keuangan Pabrik</p>
          </div>

          {params.error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3 rounded-lg">
              {params.error}
            </div>
          )}

          <form action={loginAction} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Username</label>
              <input
                type="text"
                name="username"
                placeholder="owner atau operator"
                required
                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Password</label>
              <input
                type="password"
                name="password"
                placeholder="Masukkan password"
                required
                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-lg text-sm"
            >
              Masuk ke Sistem
            </button>
          </form>
        </div>
      </main>
    );
  }

  const isOwner = session.role === 'owner';

  const dateRes = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const today: string = dateRes.rows[0]?.today || '2026-11-24';
  const reportDate =
    params.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(params.tanggal) ? params.tanggal : today;

  const [
    cashRes,
    stockRes,
    customersRes,
    recRes,
    bonusRes,
    recentDistRes,
    recentProdRes,
    recentExpRes,
    dailyProdRes,
    dailyDistRes,
    dailyExpRes,
    dailyPayRes,
    dailyHandoverRes,
  ] = await Promise.all([
    pool.query('SELECT * FROM v_factory_cash_summary'),
    pool.query('SELECT * FROM v_ice_stock_reconciliation'),
    pool.query('SELECT id, name, phone FROM factory_customers ORDER BY name ASC'),
    pool.query(`
      SELECT r.id, r.event_date::text AS event_date, c.name AS customer_name, c.phone AS customer_phone,
             d.size, d.qty, r.total_billed, r.remaining_balance, r.status
      FROM receivables r
      JOIN factory_customers c ON c.id = r.customer_id
      JOIN distributions d ON d.id = r.distribution_id
      WHERE r.status != 'paid'
      ORDER BY r.event_date DESC
      LIMIT 20
    `),
    pool.query(`
      SELECT COALESCE(driver_name, 'Tanpa Nama Driver') AS driver_name,
             COUNT(*) AS jumlah_antar,
             COALESCE(SUM(total_driver_bonus), 0) AS total_bonus
      FROM distributions
      WHERE is_voided = FALSE AND dist_type = 'delivery' AND bonus_status = 'unpaid'
      GROUP BY COALESCE(driver_name, 'Tanpa Nama Driver')
      ORDER BY total_bonus DESC
    `),
    pool.query(`
      SELECT d.id, d.event_date::text AS event_date, d.dist_type, d.driver_name,
             c.name AS customer_name, d.size, d.qty, d.payment_method,
             d.total_amount, d.is_voided, d.notes
      FROM distributions d
      LEFT JOIN factory_customers c ON c.id = d.customer_id
      ORDER BY d.created_at DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT id, event_date::text AS event_date, size, good_qty, damaged_product_qty, damaged_plastic_qty, notes, is_voided
      FROM productions
      ORDER BY created_at DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT id, expense_date::text AS expense_date, category, description, amount, source, receipt_url, is_voided
      FROM expenses
      ORDER BY created_at DESC
      LIMIT 10
    `),
    pool.query(
      `SELECT size,
              COALESCE(SUM(good_qty), 0) AS good_qty,
              COALESCE(SUM(damaged_product_qty), 0) AS damaged_product_qty,
              COALESCE(SUM(damaged_plastic_qty), 0) AS damaged_plastic_qty
       FROM productions
       WHERE event_date = $1::date AND is_voided = FALSE
       GROUP BY size
       ORDER BY size`,
      [reportDate]
    ),
    pool.query(
      `SELECT dist_type, payment_method, size,
              COALESCE(SUM(qty), 0) AS total_qty,
              COALESCE(SUM(total_amount), 0) AS total_omzet,
              COALESCE(SUM(total_driver_bonus), 0) AS total_bonus
       FROM distributions
       WHERE event_date = $1::date AND is_voided = FALSE
       GROUP BY dist_type, payment_method, size
       ORDER BY dist_type, size`,
      [reportDate]
    ),
    pool.query(
      `SELECT category, description, amount, source, receipt_url
       FROM expenses
       WHERE expense_date = $1::date AND is_voided = FALSE
       ORDER BY created_at ASC`,
      [reportDate]
    ),
    pool.query(
      `SELECT method, COALESCE(SUM(amount), 0) AS total_masuk
       FROM receivable_payments
       WHERE payment_date = $1::date
       GROUP BY method`,
      [reportDate]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_handed_over), 0) AS total_setor
       FROM cash_handovers
       WHERE handover_date = $1::date`,
      [reportDate]
    ),
  ]);

  const cash = cashRes.rows[0] || {
    total_uang_tunai_masuk: 0,
    total_uang_tunai_keluar: 0,
    saldo_kas_pabrik_sekarang: 0,
    kewajiban_bonus_driver_belum_dibayar: 0,
    aman_diserahkan_ke_owner: 0,
  };

  let harianTunai = 0;
  let harianTransfer = 0;
  let harianPiutang = 0;
  let harianBonusDriver = 0;
  let harianTotalBks = 0;

  for (const row of dailyDistRes.rows) {
    const omzet = Number(row.total_omzet || 0);
    harianTotalBks += Number(row.total_qty || 0);
    harianBonusDriver += Number(row.total_bonus || 0);
    if (row.payment_method === 'cash') harianTunai += omzet;
    else if (row.payment_method === 'transfer') harianTransfer += omzet;
    else if (row.payment_method === 'receivable') harianPiutang += omzet;
  }

  let pelunasanCash = 0;
  let pelunasanTransfer = 0;
  for (const p of dailyPayRes.rows) {
    if (p.method === 'cash') pelunasanCash += Number(p.total_masuk || 0);
    else pelunasanTransfer += Number(p.total_masuk || 0);
  }

  const harianKeluarKasPabrik = dailyExpRes.rows
    .filter((e) => e.source === 'factory_cash')
    .reduce((acc, e) => acc + Number(e.amount || 0), 0);

  const harianSetorOwner = Number(dailyHandoverRes.rows[0]?.total_setor || 0);

  const waReportText = [
    `*LAPORAN HARIAN PHINISI ES KRISTAL*`,
    `Tanggal: ${reportDate}`,
    ``,
    `*1. PRODUKSI HARIAN*`,
    ...(dailyProdRes.rows.length > 0
      ? dailyProdRes.rows.map(
          (p) => `- ${p.size}: ${p.good_qty} bks layak (Es rusak: ${p.damaged_product_qty}, Plastik rusak: ${p.damaged_plastic_qty})`
        )
      : [`- Tidak ada catatan produksi`]),
    ``,
    `*2. PENJUALAN & DISTRIBUSI (${harianTotalBks} bks)*`,
    `- Penjualan Tunai: ${formatRupiah(harianTunai)}`,
    `- Penjualan Transfer: ${formatRupiah(harianTransfer)}`,
    `- Penjualan Piutang Baru: ${formatRupiah(harianPiutang)}`,
    `- Pelunasan Piutang Masuk: ${formatRupiah(pelunasanCash + pelunasanTransfer)} (Cash: ${formatRupiah(pelunasanCash)})`,
    `- Akumulasi Bonus Driver Hari Ini: ${formatRupiah(harianBonusDriver)}`,
    ``,
    `*3. PENGELUARAN & SETORAN*`,
    `- Pengeluaran via Kas Pabrik: ${formatRupiah(harianKeluarKasPabrik)}`,
    `- Setoran Tunai ke Owner: ${formatRupiah(harianSetorOwner)}`,
    ``,
    `*4. POSISI SALDO KAS PABRIK SAAT INI*`,
    `- Saldo Kas Pabrik: ${formatRupiah(cash.saldo_kas_pabrik_sekarang)}`,
    `- Kewajiban Bonus Driver Belum Dibayar: ${formatRupiah(cash.kewajiban_bonus_driver_belum_dibayar)}`,
    `- Aman Diserahkan ke Owner: ${formatRupiah(cash.aman_diserahkan_ke_owner)}`,
  ].join('\n');

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="bg-blue-900 text-white p-6 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sistem Operasional & Keuangan Pabrik Es Kristal</h1>
            <p className="text-blue-200 text-sm">Kontrol Produksi, Cold Storage, Piutang, Bonus Driver & Tutup Buku Harian</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs bg-blue-800 px-3 py-1.5 rounded-full">
              {session.name} ({session.role.toUpperCase()})
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-xs bg-rose-600 hover:bg-rose-500 text-white font-semibold px-3 py-1.5 rounded-full"
              >
                Keluar
              </button>
            </form>
          </div>
        </header>

        {/* Notifikasi */}
        {params.error && (
          <div className="bg-rose-50 border border-rose-300 text-rose-800 px-4 py-3 rounded-xl text-sm font-medium">
            Peringatan: {params.error}
          </div>
        )}
        {params.success && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-xl text-sm font-medium">
            {params.success}
          </div>
        )}

        {/* Ringkasan Kas Pabrik */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Saldo Kas Pabrik</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{formatRupiah(cash.saldo_kas_pabrik_sekarang)}</p>
            <p className="text-xs text-slate-400 mt-1">Masuk: {formatRupiah(cash.total_uang_tunai_masuk)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Aman Diserahkan ke Owner</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{formatRupiah(cash.aman_diserahkan_ke_owner)}</p>
            <p className="text-xs text-slate-400 mt-1">Setelah potong kewajiban bonus</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Kewajiban Bonus Driver</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{formatRupiah(cash.kewajiban_bonus_driver_belum_dibayar)}</p>
            <p className="text-xs text-slate-400 mt-1">Belum dibayarkan</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Total Kas Keluar</p>
            <p className="text-2xl font-bold text-rose-600 mt-1">{formatRupiah(cash.total_uang_tunai_keluar)}</p>
            <p className="text-xs text-slate-400 mt-1">Biaya kas pabrik & serah owner</p>
          </div>
        </section>

        {/* Tabel Stok Cold Storage */}
        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold mb-4">Stok Es dalam Cold Storage</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                <tr>
                  <th className="p-3">Ukuran</th>
                  <th className="p-3">Stok Opname Awal</th>
                  <th className="p-3">Produksi Layak Jual</th>
                  <th className="p-3">Rusak</th>
                  <th className="p-3">Ambil Langsung</th>
                  <th className="p-3">Diantar Driver</th>
                  <th className="p-3 font-bold text-blue-900">Stok Teoretis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stockRes.rows.map((row) => (
                  <tr key={row.size}>
                    <td className="p-3 font-semibold">{row.size}</td>
                    <td className="p-3">{row.stok_awal_atau_opname}</td>
                    <td className="p-3 text-emerald-700 font-medium">+{row.produksi_layak_jual}</td>
                    <td className="p-3 text-rose-600">{row.produk_jadi_rusak}</td>
                    <td className="p-3">{row.ambil_langsung}</td>
                    <td className="p-3">{row.diantar_driver}</td>
                    <td className="p-3 font-bold text-blue-900 text-base">{row.stok_teoretis_sekarang} bks</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3 Form Input Operasional Harian */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form 1: Produksi */}
          <form action={tambahProduksi} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-base border-b pb-2 text-blue-900">1. Input Produksi Harian</h3>
            <div>
              <label className="block text-xs font-medium mb-1">Tanggal Produksi</label>
              <input type="date" name="event_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Ukuran Kemasan</label>
              <select name="size" className="w-full border rounded-lg p-2 text-sm">
                <option value="5kg">5 kg</option>
                <option value="10kg">10 kg</option>
                <option value="20kg">20 kg</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Layak Jual</label>
                <input type="number" name="good_qty" min="0" defaultValue="0" required className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Es Rusak</label>
                <input type="number" name="damaged_product_qty" min="0" defaultValue="0" className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Plastik Rusak</label>
                <input type="number" name="damaged_plastic_qty" min="0" defaultValue="0" className="w-full border rounded-lg p-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Catatan</label>
              <input type="text" name="notes" placeholder="Opsional" className="w-full border rounded-lg p-2 text-sm" />
            </div>
            <button type="submit" className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-lg text-sm">
              Simpan Produksi
            </button>
          </form>

          {/* Form 2: Distribusi */}
          <form action={tambahDistribusi} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-base border-b pb-2 text-emerald-800">2. Ambil Langsung / Pengantaran</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Tanggal</label>
                <input type="date" name="event_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Metode</label>
                <select name="dist_type" className="w-full border rounded-lg p-2 text-sm">
                  <option value="pickup">Ambil Langsung</option>
                  <option value="delivery">Diantar Driver</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Ukuran</label>
                <select name="size" className="w-full border rounded-lg p-2 text-sm">
                  <option value="5kg">5 kg</option>
                  <option value="10kg">10 kg</option>
                  <option value="20kg">20 kg</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Jumlah (Bks)</label>
                <input type="number" name="qty" min="1" defaultValue="1" required className="w-full border rounded-lg p-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Pembayaran</label>
                <select name="payment_method" className="w-full border rounded-lg p-2 text-sm">
                  <option value="cash">Tunai (Cash)</option>
                  <option value="transfer">Transfer</option>
                  <option value="receivable">Piutang (Khusus Antar)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nama Driver (Wajib Antar)</label>
                <input type="text" name="driver_name" placeholder="Contoh: Daeng Udin" className="w-full border rounded-lg p-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Pilih Pelanggan Piutang Terdaftar</label>
              <select name="existing_customer_id" className="w-full border rounded-lg p-2 text-sm">
                <option value="">-- Pelanggan Baru (Isi di bawah) --</option>
                {customersRes.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Nama Pelanggan Baru</label>
                <input type="text" name="customer_name" placeholder="Jika belum terdaftar" className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">No. HP</label>
                <input type="text" name="customer_phone" placeholder="08..." className="w-full border rounded-lg p-2 text-sm" />
              </div>
            </div>
            <button type="submit" className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-lg text-sm">
              Simpan Distribusi
            </button>
          </form>

          {/* Form 3: Pengeluaran + Foto Nota */}
          <form action={tambahPengeluaran} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-base border-b pb-2 text-rose-800">3. Input Pengeluaran</h3>
            <div>
              <label className="block text-xs font-medium mb-1">Tanggal Pengeluaran</label>
              <input type="date" name="expense_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Kategori</label>
              <select name="category" className="w-full border rounded-lg p-2 text-sm">
                <option value="bbm">BBM</option>
                <option value="konsumsi">Konsumsi Karyawan</option>
                <option value="material_operasional">Material Operasional</option>
                <option value="perawatan_kendaraan">Perawatan Kendaraan</option>
                <option value="listrik">Listrik</option>
                <option value="gaji">Gaji Karyawan</option>
                <option value="perawatan_mesin">Perawatan Mesin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Keterangan</label>
              <input type="text" name="description" placeholder="Contoh: Solar L300" required className="w-full border rounded-lg p-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Nominal (Rp)</label>
                <input type="number" name="amount" min="1" required className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Sumber Dana</label>
                <select name="source" className="w-full border rounded-lg p-2 text-sm">
                  <option value="factory_cash">Kas Pabrik</option>
                  <option value="owner_direct">Dibayar Owner</option>
                  <option value="other_transfer">Transfer Rekening Lain</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Foto Nota / Struk (Opsional)</label>
              <input
                type="file"
                name="receipt"
                accept="image/*"
                className="w-full border rounded-lg p-1.5 text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:bg-rose-50 file:text-rose-700 file:font-semibold"
              />
            </div>
            <button type="submit" className="w-full bg-rose-700 hover:bg-rose-600 text-white font-semibold py-2.5 rounded-lg text-sm">
              Simpan Pengeluaran
            </button>
          </form>
        </section>

        {/* Form 4 & 5: Khusus Owner */}
        {isOwner ? (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form action={simpanStokOpname} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-base border-b pb-2 text-indigo-900">4. Stok Opname Cold Storage (Owner)</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Tanggal Opname</label>
                  <input type="date" name="opname_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Ukuran</label>
                  <select name="size" className="w-full border rounded-lg p-2 text-sm">
                    <option value="5kg">5 kg</option>
                    <option value="10kg">10 kg</option>
                    <option value="20kg">20 kg</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Stok Fisik (Bks)</label>
                  <input type="number" name="actual_qty" min="0" required className="w-full border rounded-lg p-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Catatan Opname</label>
                <input type="text" name="notes" placeholder="Contoh: Cek fisik pagi" className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <button type="submit" className="w-full bg-indigo-800 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg text-sm">
                Simpan Stok Opname
              </button>
            </form>

            <form action={simpanSerahKasOwner} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-bold text-base border-b pb-2 text-teal-900">5. Serah Terima Kas ke Owner (Owner)</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Tanggal Setor</label>
                  <input type="date" name="handover_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Nominal Diserahkan (Rp)</label>
                  <input type="number" name="amount_handed_over" min="1" required className="w-full border rounded-lg p-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Catatan Setoran</label>
                <input type="text" name="notes" placeholder="Contoh: Setoran tunai sore" className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <button type="submit" className="w-full bg-teal-800 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-lg text-sm">
                Catat Setoran ke Owner
              </button>
            </form>
          </section>
        ) : (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-xs">
            Mode Operator: Form Stok Opname Cold Storage, Serah Terima Kas, Pelunasan Piutang, Pencairan Bonus Driver, dan Void Transaksi hanya dapat diakses melalui akun Owner.
          </div>
        )}

        {/* REKAP LAPORAN HARIAN, SALIN WA & UNDUH CSV/EXCEL */}
        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Rekap Laporan Harian & Ekspor Excel (CSV)</h2>
              <p className="text-xs text-slate-500">Ringkasan mutasi harian, salin format WhatsApp, atau unduh laporan spreadsheet</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form method="GET" className="flex items-center gap-2">
                <input
                  type="date"
                  name="tanggal"
                  defaultValue={reportDate}
                  className="border rounded-lg px-3 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-2 rounded-lg"
                >
                  Tampilkan
                </button>
              </form>
              <CopyReportButton text={waReportText} />
            </div>
          </div>

          {/* Bar Unduh CSV/Excel per Rentang Tanggal */}
          <form
            action="/api/export"
            method="GET"
            className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-blue-950">Unduh Laporan Excel (.CSV):</span>
              <input type="date" name="start" defaultValue={reportDate} className="border bg-white rounded-lg px-2.5 py-1.5 text-xs" />
              <span>s/d</span>
              <input type="date" name="end" defaultValue={reportDate} className="border bg-white rounded-lg px-2.5 py-1.5 text-xs" />
            </div>
            <button
              type="submit"
              className="bg-blue-900 hover:bg-blue-800 text-white text-xs font-semibold px-4 py-2 rounded-lg"
            >
              Unduh File CSV / Excel
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-slate-50 p-4 rounded-lg border">
              <p className="text-xs text-slate-500">Penjualan Tunai ({reportDate})</p>
              <p className="text-lg font-bold text-slate-900">{formatRupiah(harianTunai)}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-lg border">
              <p className="text-xs text-slate-500">Penjualan Transfer ({reportDate})</p>
              <p className="text-lg font-bold text-blue-900">{formatRupiah(harianTransfer)}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-lg border">
              <p className="text-xs text-slate-500">Piutang Baru ({reportDate})</p>
              <p className="text-lg font-bold text-amber-700">{formatRupiah(harianPiutang)}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-lg border">
              <p className="text-xs text-slate-500">Keluar Kas Pabrik ({reportDate})</p>
              <p className="text-lg font-bold text-rose-700">{formatRupiah(harianKeluarKasPabrik)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="border rounded-lg p-4">
              <h4 className="font-bold text-slate-700 mb-2 uppercase">Rincian Pengeluaran Aktif ({reportDate})</h4>
              {dailyExpRes.rows.length === 0 ? (
                <p className="text-slate-400">Tidak ada pengeluaran aktif pada tanggal ini.</p>
              ) : (
                <ul className="space-y-1.5">
                  {dailyExpRes.rows.map((e, i) => (
                    <li key={i} className="flex justify-between items-center border-b pb-1 gap-2">
                      <span>
                        <strong className="uppercase">{e.category}</strong> — {e.description} ({e.source}){' '}
                        {e.receipt_url && (
                          <a
                            href={e.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 underline font-semibold ml-1"
                          >
                            [Lihat Nota]
                          </a>
                        )}
                      </span>
                      <span className="font-semibold text-rose-700">{formatRupiah(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border rounded-lg p-4 bg-slate-50">
              <h4 className="font-bold text-slate-700 mb-2 uppercase">Pratinjau Format Laporan WhatsApp</h4>
              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed">
                {waReportText}
              </pre>
            </div>
          </div>
        </section>

        {/* Piutang Belum Lunas + Bonus Driver Belum Dibayar */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-base mb-3">Piutang Pelanggan Belum Lunas</h3>
            {recRes.rows.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada piutang berjalan.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {recRes.rows.map((r) => (
                  <div key={r.id} className="flex justify-between items-center border-b pb-2 gap-2">
                    <div>
                      <p className="font-semibold">{r.customer_name}</p>
                      <p className="text-xs text-slate-500">
                        {r.event_date} • {r.size} × {r.qty} bks • Sisa:{' '}
                        <span className="font-bold text-rose-600">{formatRupiah(r.remaining_balance)}</span>
                      </p>
                    </div>
                    {isOwner && (
                      <form action={lunasiPiutang} className="flex items-center gap-1.5">
                        <input type="hidden" name="receivable_id" value={r.id} />
                        <input type="hidden" name="remaining_balance" value={r.remaining_balance} />
                        <select name="method" className="border rounded px-2 py-1 text-xs">
                          <option value="cash">Cash</option>
                          <option value="transfer">Transfer</option>
                        </select>
                        <button type="submit" className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded">
                          Tandai Lunas
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-base">Bonus Driver Belum Dibayar</h3>
              {isOwner && bonusRes.rows.length > 0 && (
                <form action={bayarBonusDriver}>
                  <input type="hidden" name="driver_name" value="__ALL__" />
                  <button type="submit" className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 rounded">
                    Bayar Semua Bonus
                  </button>
                </form>
              )}
            </div>
            {bonusRes.rows.length === 0 ? (
              <p className="text-sm text-slate-400">Tidak ada bonus driver yang belum dibayar.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {bonusRes.rows.map((b, idx) => (
                  <div key={idx} className="flex justify-between items-center border-b pb-2 gap-2">
                    <div>
                      <p className="font-semibold">{b.driver_name}</p>
                      <p className="text-xs text-slate-500">
                        {b.jumlah_antar} pengantaran • Total:{' '}
                        <span className="font-bold text-amber-700">{formatRupiah(b.total_bonus)}</span>
                      </p>
                    </div>
                    {isOwner && (
                      <form action={bayarBonusDriver}>
                        <input type="hidden" name="driver_name" value={b.driver_name} />
                        <button type="submit" className="bg-blue-900 hover:bg-blue-800 text-white text-xs font-semibold px-3 py-1.5 rounded">
                          Bayar Bonus
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Riwayat Distribusi Terakhir + Kontrol Void */}
        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-base mb-3">Riwayat Distribusi Terakhir & Kontrol Void</h3>
          {recentDistRes.rows.length === 0 ? (
            <p className="text-sm text-slate-400">Belum ada pencatatan distribusi.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {recentDistRes.rows.map((d) => (
                <div
                  key={d.id}
                  className={`flex flex-col md:flex-row md:justify-between md:items-center border-b pb-3 gap-2 ${
                    d.is_voided ? 'opacity-50' : ''
                  }`}
                >
                  <div>
                    <p className="font-semibold">
                      [{d.event_date}] {d.dist_type === 'pickup' ? 'Ambil Langsung' : `Antar (${d.driver_name || '-'})`} •{' '}
                      {d.size} × {d.qty} bks
                      {d.customer_name ? ` • Pelanggan: ${d.customer_name}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      Metode: <span className="uppercase font-medium">{d.payment_method}</span>
                      {d.notes ? ` • Catatan: ${d.notes}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`font-bold ${d.is_voided ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {formatRupiah(d.total_amount)}
                    </span>

                    {d.is_voided ? (
                      <span className="text-xs bg-rose-100 text-rose-700 font-semibold px-2.5 py-1 rounded">VOID</span>
                    ) : (
                      isOwner && (
                        <form action={voidDistribusi} className="flex items-center gap-1.5">
                          <input type="hidden" name="distribution_id" value={d.id} />
                          <input
                            type="text"
                            name="void_reason"
                            defaultValue="Salah input"
                            className="border rounded px-2 py-1 text-xs w-28"
                          />
                          <button type="submit" className="bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold px-2.5 py-1 rounded">
                            Void
                          </button>
                        </form>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Riwayat Produksi & Pengeluaran Terakhir + Kontrol Void & Bukti Nota */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Riwayat Produksi */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-base mb-3">Riwayat Produksi Terakhir & Kontrol Void</h3>
            {recentProdRes.rows.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada catatan produksi.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {recentProdRes.rows.map((p) => (
                  <div
                    key={p.id}
                    className={`flex flex-col sm:flex-row sm:justify-between sm:items-center border-b pb-2 gap-2 ${
                      p.is_voided ? 'opacity-50' : ''
                    }`}
                  >
                    <div>
                      <p className="font-semibold">
                        [{p.event_date}] {p.size} • Layak: {p.good_qty} bks
                      </p>
                      <p className="text-xs text-slate-500">
                        Es rusak: {p.damaged_product_qty} • Plastik rusak: {p.damaged_plastic_qty}
                        {p.notes ? ` • ${p.notes}` : ''}
                      </p>
                    </div>
                    {p.is_voided ? (
                      <span className="text-xs bg-rose-100 text-rose-700 font-semibold px-2.5 py-1 rounded w-fit">VOID</span>
                    ) : (
                      isOwner && (
                        <form action={voidProduksi} className="flex items-center gap-1.5">
                          <input type="hidden" name="production_id" value={p.id} />
                          <input
                            type="text"
                            name="void_reason"
                            defaultValue="Salah hitung"
                            className="border rounded px-2 py-1 text-xs w-24"
                          />
                          <button type="submit" className="bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold px-2.5 py-1 rounded">
                            Void
                          </button>
                        </form>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Riwayat Pengeluaran */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-base mb-3">Riwayat Pengeluaran, Nota & Kontrol Void</h3>
            {recentExpRes.rows.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada catatan pengeluaran.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {recentExpRes.rows.map((e) => (
                  <div
                    key={e.id}
                    className={`flex flex-col sm:flex-row sm:justify-between sm:items-center border-b pb-2 gap-2 ${
                      e.is_voided ? 'opacity-50' : ''
                    }`}
                  >
                    <div>
                      <p className="font-semibold">
                        [{e.expense_date}] <span className="uppercase">{e.category}</span> — {formatRupiah(e.amount)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {e.description} ({e.source})
                        {e.receipt_url && (
                          <a
                            href={e.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 underline font-semibold ml-1.5"
                          >
                            [Lihat Foto Nota]
                          </a>
                        )}
                      </p>
                    </div>
                    {e.is_voided ? (
                      <span className="text-xs bg-rose-100 text-rose-700 font-semibold px-2.5 py-1 rounded w-fit">VOID</span>
                    ) : (
                      isOwner && (
                        <form action={voidPengeluaran} className="flex items-center gap-1.5">
                          <input type="hidden" name="expense_id" value={e.id} />
                          <input
                            type="text"
                            name="void_reason"
                            defaultValue="Salah nominal"
                            className="border rounded px-2 py-1 text-xs w-24"
                          />
                          <button type="submit" className="bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold px-2.5 py-1 rounded">
                            Void
                          </button>
                        </form>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}