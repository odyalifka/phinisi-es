'use client';

import {
  bayarPiutangBertahap,
  logoutAction,
  tambahPengambilanLangsung,
  tambahPengantaran,
  tambahPengeluaran,
  tambahProduksiBatch,
} from '@/app/actions';
import { UserSession } from '@/lib/auth';
import CurrencyInput from '@/components/CurrencyInput';
import { useState } from 'react';

interface StaffData {
  iceStock: Array<{
    size: string;
    stok_awal_atau_opname: number;
    produksi_layak_jual: number;
    produk_jadi_rusak: number;
    ambil_langsung: number;
    diantar_driver: number;
    stok_teoretis_sekarang: number;
  }>;
  plasticStock: Array<{
    size: string;
    stok_awal: number;
    pembelian: number;
    plastik_terpakai: number;
    plastik_kosong_rusak: number;
    stok_teoretis: number;
  }>;
  customers: Array<{ id: string; name: string; phone: string | null }>;
  drivers: Array<{ id: string; name: string }>;
  searchedReceivables: Array<{
    id: string;
    event_date: string;
    customer_name: string;
    customer_phone: string | null;
    size: string;
    qty: number;
    total_billed: number;
    remaining_balance: number;
    status: string;
  }>;
  debtorSummary: Array<{
    customer_id: string;
    customer_name: string;
    customer_phone: string | null;
    total_remaining_balance: number;
    qty_5kg: number;
    qty_10kg: number;
    qty_20kg: number;
    active_bills_count: number;
  }>;
  debtorLogs: Array<{
    receivable_id: string;
    customer_id: string;
    event_date: string;
    size: string;
    qty: number;
    total_billed: number;
    remaining_balance: number;
    paid_amount: number;
    status: string;
    driver_name: string | null;
  }>;
  todayProductions: Array<{
    id: string;
    event_date: string;
    size: string;
    gross_qty: number;
    damaged_product_qty: number;
    good_qty: number;
    damaged_plastic_qty: number;
    notes: string | null;
    is_voided: boolean;
  }>;
  todayDistributions: Array<{
    id: string;
    event_date: string;
    dist_type: string;
    driver_name: string | null;
    customer_name: string | null;
    size: string;
    qty: number;
    payment_method: string;
    is_voided: boolean;
    notes: string | null;
  }>;
  todayExpenses: Array<{
    id: string;
    expense_date: string;
    category: string;
    description: string;
    amount: number;
    receipt_url: string | null;
    is_voided: boolean;
  }>;
  todayPayments: Array<{
    id: string;
    payment_date: string;
    customer_name: string;
    amount: number;
    method: string;
  }>;
  lastOpnameDate: string | null;
}

const MANDATORY_CATS = new Set(['bbm', 'perawatan_kendaraan', 'material_operasional']);

function formatRp(n: number | string) {
  return `Rp ${Math.round(Number(n || 0)).toLocaleString('id-ID')}`;
}

function formatPackSummary(q5: number, q10: number, q20: number) {
  const parts: string[] = [];
  if (Number(q5) > 0) parts.push(`${Number(q5)} bks (5kg)`);
  if (Number(q10) > 0) parts.push(`${Number(q10)} bks (10kg)`);
  if (Number(q20) > 0) parts.push(`${Number(q20)} bks (20kg)`);
  return parts.length > 0 ? parts.join(' · ') : '0 bks';
}

export default function StaffDashboard({
  session,
  today,
  customerQuery,
  data,
  errorMsg,
  successMsg,
}: {
  session: UserSession;
  today: string;
  customerQuery: string;
  data: StaffData;
  errorMsg?: string;
  successMsg?: string;
}) {
  const [expCategory, setExpCategory] = useState('bbm');
  const [prodGross, setProdGross] = useState<Record<string, number>>({ '5kg': 0, '10kg': 0, '20kg': 0 });
  const [selectedDebtorId, setSelectedDebtorId] = useState<string | null>(
    data.debtorSummary[0]?.customer_id || null
  );

  const isReceiptRequired = MANDATORY_CATS.has(expCategory);
  const activeDebtor = data.debtorSummary.find((d) => d.customer_id === selectedDebtorId) || null;
  const activeDebtorLogs = selectedDebtorId
    ? data.debtorLogs.filter((log) => log.customer_id === selectedDebtorId)
    : [];

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-slate-900 text-white p-6 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Operasional Produksi & Distribusi — Phinisi Es Kristal</h1>
            <p className="text-slate-300 text-sm">Panel Pencatatan Lapangan Staff / Operator ({today})</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs bg-slate-800 px-3 py-1.5 rounded-full">
              {session.name} (STAFF)
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

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-bold text-blue-950">Stok Es Cold Storage (Operasional)</h2>
              <span className="text-xs text-slate-500">
                Opname Terakhir: {data.lastOpnameDate || 'Belum ada'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-600 uppercase">
                  <tr>
                    <th className="p-2.5">Ukuran</th>
                    <th className="p-2.5">Awal</th>
                    <th className="p-2.5">Layak Jual</th>
                    <th className="p-2.5">Keluar</th>
                    <th className="p-2.5 font-bold text-blue-900">Stok Siap</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.iceStock.map((row) => (
                    <tr key={row.size}>
                      <td className="p-2.5 font-bold">{row.size}</td>
                      <td className="p-2.5">{row.stok_awal_atau_opname}</td>
                      <td className="p-2.5 text-emerald-700 font-medium">+{row.produksi_layak_jual}</td>
                      <td className="p-2.5">{Number(row.ambil_langsung) + Number(row.diantar_driver)}</td>
                      <td className="p-2.5 font-bold text-blue-900 text-sm">{row.stok_teoretis_sekarang} bks</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-base font-bold text-indigo-950 mb-3">Stok Plastik Kemasan (Operasional)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-600 uppercase">
                  <tr>
                    <th className="p-2.5">Ukuran</th>
                    <th className="p-2.5">Awal</th>
                    <th className="p-2.5">Masuk</th>
                    <th className="p-2.5">Terpakai</th>
                    <th className="p-2.5">Plastik Rusak</th>
                    <th className="p-2.5 font-bold text-indigo-900">Sisa Stok</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.plasticStock.map((row) => (
                    <tr key={row.size}>
                      <td className="p-2.5 font-bold">{row.size}</td>
                      <td className="p-2.5">{row.stok_awal}</td>
                      <td className="p-2.5 text-emerald-700">+{row.pembelian}</td>
                      <td className="p-2.5">{row.plastik_terpakai}</td>
                      <td className="p-2.5 text-rose-600">{row.plastik_kosong_rusak}</td>
                      <td className="p-2.5 font-bold text-indigo-900 text-sm">{row.stok_teoretis} lbr</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <form action={tambahProduksiBatch} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b pb-3">
            <div>
              <h3 className="font-bold text-base text-blue-900">1. Input Produksi Harian (Multi-Ukuran Sekaligus)</h3>
              <p className="text-xs text-slate-500">
                Catat jumlah kemasan produksi per ukuran dan jumlah plastik rusak (jika ada) pada proses produksi.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium">Tanggal:</label>
              <input type="date" name="event_date" defaultValue={today} required className="border rounded-lg p-1.5 text-sm" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 uppercase">
                <tr>
                  <th className="p-2.5">Ukuran</th>
                  <th className="p-2.5">Produksi Bruto (Bks)</th>
                  <th className="p-2.5">Produksi Layak Jual (Otomatis)</th>
                  <th className="p-2.5">Plastik Rusak (Lbr)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(['5kg', '10kg', '20kg'] as const).map((sz) => {
                  const layak = Math.max(0, prodGross[sz] || 0);
                  return (
                    <tr key={sz}>
                      <td className="p-2.5 font-bold text-sm">{sz}</td>
                      <td className="p-2.5">
                        <input
                          type="number"
                          name={`gross_${sz}`}
                          min="0"
                          defaultValue="0"
                          onChange={(e) => setProdGross({ ...prodGross, [sz]: Number(e.target.value || 0) })}
                          className="w-28 border rounded-lg p-2 text-sm"
                        />
                      </td>
                      <td className="p-2.5 font-bold text-emerald-700 text-sm">{layak} bks</td>
                      <td className="p-2.5">
                        <input
                          type="number"
                          name={`damaged_plastic_${sz}`}
                          min="0"
                          defaultValue="0"
                          className="w-28 border rounded-lg p-2 text-sm"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              name="notes"
              placeholder="Catatan produksi (misal: Shift Pagi / Panen ke-2)"
              className="flex-1 border rounded-lg p-2 text-sm"
            />
            <button type="submit" className="bg-blue-900 hover:bg-blue-800 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
              Simpan Produksi
            </button>
          </div>
        </form>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form action={tambahPengambilanLangsung} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="border-b pb-2">
              <h3 className="font-bold text-base text-emerald-800">2A. Pengambilan Langsung di Pabrik</h3>
              <p className="text-xs text-slate-500">Tanpa driver - Wajib lunas (Tunai / Transfer) - Tidak boleh piutang</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Tanggal</label>
                <input type="date" name="event_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Metode Pembayaran (Wajib Lunas)</label>
                <select name="payment_method" className="w-full border rounded-lg p-2 text-sm">
                  <option value="cash">Tunai (Cash)</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['5kg', '10kg', '20kg'] as const).map((sz) => (
                <div key={sz} className="bg-slate-50 p-2.5 rounded-lg border">
                  <label className="block text-xs font-bold mb-1">Jumlah {sz}</label>
                  <input type="number" name={`qty_${sz}`} min="0" defaultValue="0" className="w-full border bg-white rounded p-1.5 text-sm" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Catatan (Opsional)</label>
              <input type="text" name="notes" placeholder="Nama pembeli / keterangan" className="w-full border rounded-lg p-2 text-sm" />
            </div>
            <button type="submit" className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-lg text-sm">
              Simpan Pengambilan Langsung
            </button>
          </form>

          <form action={tambahPengantaran} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="border-b pb-2">
              <h3 className="font-bold text-base text-teal-800">2B. Pengantaran Driver</h3>
              <p className="text-xs text-slate-500">Wajib nama driver - Mendukung Tunai, Transfer, atau Piutang Pelanggan</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Tanggal</label>
                <input type="date" name="event_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nama Driver (Wajib)</label>
                <select name="driver_name" required className="w-full border rounded-lg p-2 text-sm bg-white">
                  <option value="">-- Pilih Nama Driver --</option>
                  {data.drivers.map((drv) => (
                    <option key={drv.id} value={drv.name}>
                      {drv.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['5kg', '10kg', '20kg'] as const).map((sz) => (
                <div key={sz} className="bg-slate-50 p-2.5 rounded-lg border">
                  <label className="block text-xs font-bold mb-1">Jumlah {sz}</label>
                  <input type="number" name={`qty_${sz}`} min="0" defaultValue="0" className="w-full border bg-white rounded p-1.5 text-sm" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Pembayaran</label>
                <select name="payment_method" className="w-full border rounded-lg p-2 text-sm">
                  <option value="cash">Tunai (Cash)</option>
                  <option value="transfer">Transfer</option>
                  <option value="receivable">Piutang Pelanggan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Pelanggan Terdaftar (Jika Piutang)</label>
                <select name="existing_customer_id" className="w-full border rounded-lg p-2 text-sm">
                  <option value="">-- Pelanggan Baru --</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" name="customer_name" placeholder="Nama pelanggan baru (jika piutang)" className="w-full border rounded-lg p-2 text-xs" />
              <input type="text" name="customer_phone" placeholder="No. HP pelanggan" className="w-full border rounded-lg p-2 text-xs" />
            </div>
            <button type="submit" className="w-full bg-teal-800 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-lg text-sm">
              Simpan Pengantaran Driver
            </button>
          </form>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="border-b pb-2">
              <h3 className="font-bold text-base text-amber-900">3. Pencarian & Pembayaran Piutang Pelanggan</h3>
              <p className="text-xs text-slate-500">
                Ketik nama atau nomor HP pelanggan yang hendak membayar untuk memproses pembayaran bertahap/lunas.
              </p>
            </div>

            <form method="GET" className="flex gap-2">
              <input
                type="text"
                name="cari_pelanggan"
                defaultValue={customerQuery}
                placeholder="Cari nama pelanggan (min. 2 huruf)..."
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                Cari
              </button>
            </form>

            {customerQuery.trim().length < 2 ? (
              <p className="text-xs text-slate-400">Masukkan nama pelanggan pada kolom pencarian di atas untuk menampilkan tagihan aktif pelanggan tersebut.</p>
            ) : data.searchedReceivables.length === 0 ? (
              <p className="text-xs text-slate-500">Tidak ditemukan piutang aktif untuk pencarian “{customerQuery}”.</p>
            ) : (
              <div className="space-y-3 text-xs">
                {data.searchedReceivables.map((r) => (
                  <div key={r.id} className="border rounded-lg p-3 bg-amber-50/40 space-y-2">
                    <div className="flex justify-between">
                      <span className="font-bold text-sm">{r.customer_name}</span>
                      <span className="font-bold text-rose-700">Sisa: {formatRp(r.remaining_balance)}</span>
                    </div>
                    <p className="text-slate-600">
                      Tgl Nota: {r.event_date} - {r.size} x {r.qty} bks - Total Awal: {formatRp(r.total_billed)}
                    </p>
                    <form action={bayarPiutangBertahap} className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                      <input type="hidden" name="receivable_id" value={r.id} />
                      <input type="date" name="payment_date" defaultValue={today} required className="border bg-white rounded px-2 py-1 text-xs" />
                      <CurrencyInput name="amount"
                        min="1"
                        max={r.remaining_balance}
                        defaultValue={r.remaining_balance}
                        required
                        className="border bg-white rounded px-2 py-1 text-xs"
                       />
                      <select name="method" className="border bg-white rounded px-2 py-1 text-xs">
                        <option value="cash">Tunai</option>
                        <option value="transfer">Transfer</option>
                      </select>
                      <button type="submit" className="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded px-2 py-1 text-xs">
                        Simpan Bayar
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form action={tambahPengeluaran} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="border-b pb-2">
              <h3 className="font-bold text-base text-rose-800">4. Input Pengeluaran Operasional Staff</h3>
              <p className="text-xs text-slate-500">
                Kategori BBM, Perawatan Kendaraan, dan Material Pabrik wajib melampirkan foto bukti nota.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Tanggal</label>
                <input type="date" name="expense_date" defaultValue={today} required className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Kategori</label>
                <select
                  name="category"
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full border rounded-lg p-2 text-sm"
                >
                  <option value="bbm">BBM (Wajib Foto)</option>
                  <option value="perawatan_kendaraan">Perawatan Kendaraan (Wajib Foto)</option>
                  <option value="material_operasional">Pembelian Material Pabrik (Wajib Foto)</option>
                  <option value="konsumsi">Konsumsi Harian (Opsional)</option>
                  <option value="lainnya">Lain-lain (Opsional)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Keterangan</label>
                <input type="text" name="description" required placeholder="Contoh: Solar L300 / Lakban" className="w-full border rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nominal (Rp)</label>
                <CurrencyInput name="amount" min="1" required className="w-full border rounded-lg p-2 text-sm"  />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Foto Bukti Nota / Struk{' '}
                {isReceiptRequired ? (
                  <span className="text-rose-600 font-bold">(WAJIB UNTUK KATEGORI INI)</span>
                ) : (
                  <span className="text-slate-400">(Opsional)</span>
                )}
              </label>
              <input
                type="file"
                name="receipt"
                accept="image/*"
                required={isReceiptRequired}
                className="w-full border rounded-lg p-1.5 text-xs"
              />
            </div>
            <button type="submit" className="w-full bg-rose-700 hover:bg-rose-600 text-white font-semibold py-2.5 rounded-lg text-sm">
              Simpan Pengeluaran Staff
            </button>
          </form>
        </section>

        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b pb-3">
            <div>
              <h3 className="font-bold text-base text-amber-950">3B. Daftar Pelanggan Berutang & Riwayat Nota Aktif</h3>
              <p className="text-xs text-slate-500">
                Menampilkan otomatis seluruh pelanggan yang masih berutang beserta rincian bungkus per kemasan dan sisa tagihan. Klik nama pelanggan untuk melihat riwayat hari pembelian & pelunasannya. Nota yang sudah lunas otomatis hilang dari daftar aktif ini.
              </p>
            </div>
            <span className="text-xs font-semibold bg-amber-100 text-amber-900 px-3 py-1 rounded-full">
              {data.debtorSummary.length} Pelanggan Aktif Berutang
            </span>
          </div>

          {data.debtorSummary.length === 0 ? (
            <p className="text-xs text-slate-500">Tidak ada pelanggan dengan sisa utang aktif saat ini.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
              <div className="lg:col-span-6 space-y-2">
                {data.debtorSummary.map((deb) => {
                  const isSelected = deb.customer_id === selectedDebtorId;
                  return (
                    <button
                      key={deb.customer_id}
                      type="button"
                      onClick={() => setSelectedDebtorId(deb.customer_id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition ${
                        isSelected
                          ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500'
                          : 'bg-slate-50/70 border-slate-200 hover:bg-amber-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-sm text-slate-900">{deb.customer_name}</span>
                          {deb.customer_phone && (
                            <span className="ml-2 text-[11px] text-slate-500">({deb.customer_phone})</span>
                          )}
                        </div>
                        <span className="font-bold text-sm text-rose-700">
                          {formatRp(deb.total_remaining_balance)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                        <span>
                          Kemasan aktif: <strong>{formatPackSummary(deb.qty_5kg, deb.qty_10kg, deb.qty_20kg)}</strong>
                        </span>
                        <span className="underline text-amber-900 font-medium">
                          {isSelected ? 'Riwayat dibuka' : 'Klik lihat riwayat'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="lg:col-span-6 border rounded-xl p-4 bg-slate-50/60 space-y-3">
                {!activeDebtor ? (
                  <p className="text-slate-500">Klik salah satu pelanggan di sebelah kiri untuk melihat riwayat pembelian utang dan pelunasannya.</p>
                ) : (
                  <>
                    <div className="border-b pb-2.5 flex items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900">
                          Log Riwayat Utang — {activeDebtor.customer_name}
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Total kemasan: {formatPackSummary(activeDebtor.qty_5kg, activeDebtor.qty_10kg, activeDebtor.qty_20kg)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="block text-[10px] uppercase text-slate-500">Sisa Terutang</span>
                        <span className="font-bold text-sm text-rose-700">
                          {formatRp(activeDebtor.total_remaining_balance)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                      {activeDebtorLogs.map((log) => (
                        <div key={log.receivable_id} className="bg-white border rounded-lg p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-bold text-slate-900">
                              Tanggal: {log.event_date} · {log.qty} bks ({log.size})
                            </span>
                            <span className="font-bold text-rose-700">
                              Sisa: {formatRp(log.remaining_balance)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600">
                            Tagihan awal: {formatRp(log.total_billed)} · Sudah dilunasi: <strong>{formatRp(log.paid_amount)}</strong>
                            {log.driver_name ? ` · Driver: ${log.driver_name}` : ''}
                          </p>
                          <form action={bayarPiutangBertahap} className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                            <input type="hidden" name="receivable_id" value={log.receivable_id} />
                            <input
                              type="date"
                              name="payment_date"
                              defaultValue={today}
                              required
                              className="border bg-slate-50 rounded px-2 py-1 text-xs"
                            />
                            <CurrencyInput name="amount"
                              min="1"
                              max={log.remaining_balance}
                              defaultValue={log.remaining_balance}
                              required
                              className="border bg-slate-50 rounded px-2 py-1 text-xs"
                             />
                            <select name="method" className="border bg-slate-50 rounded px-2 py-1 text-xs">
                              <option value="cash">Tunai</option>
                              <option value="transfer">Transfer</option>
                            </select>
                            <button
                              type="submit"
                              className="bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded px-2 py-1 text-xs"
                            >
                              Bayar Nota
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-slate-900 border-b pb-2">Riwayat Input Operasional Hari Ini ({today})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <h4 className="font-bold text-blue-900 mb-1.5 uppercase">Produksi Hari Ini</h4>
              {data.todayProductions.length === 0 ? (
                <p className="text-slate-400">Belum ada input produksi hari ini.</p>
              ) : (
                <ul className="space-y-1">
                  {data.todayProductions.map((p) => (
                    <li key={p.id} className={`border-b pb-1 ${p.is_voided ? 'line-through opacity-50' : ''}`}>
                      <strong>{p.size}</strong>: Bruto {p.gross_qty} | Layak{' '}
                      <strong>{p.good_qty} bks</strong> | Plastik Rusak {p.damaged_plastic_qty} lbr
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="font-bold text-emerald-900 mb-1.5 uppercase">Distribusi Hari Ini</h4>
              {data.todayDistributions.length === 0 ? (
                <p className="text-slate-400">Belum ada input distribusi hari ini.</p>
              ) : (
                <ul className="space-y-1">
                  {data.todayDistributions.map((d) => (
                    <li key={d.id} className={`border-b pb-1 ${d.is_voided ? 'line-through opacity-50' : ''}`}>
                      {d.dist_type === 'pickup' ? 'Ambil' : `Antar (${d.driver_name})`} - <strong>{d.size} x {d.qty}</strong> ({d.payment_method})
                      {d.customer_name ? ` - ${d.customer_name}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="font-bold text-rose-900 mb-1.5 uppercase">Pengeluaran Staff Hari Ini</h4>
              {data.todayExpenses.length === 0 ? (
                <p className="text-slate-400">Belum ada input pengeluaran hari ini.</p>
              ) : (
                <ul className="space-y-1">
                  {data.todayExpenses.map((e) => (
                    <li key={e.id} className={`border-b pb-1 ${e.is_voided ? 'line-through opacity-50' : ''}`}>
                      <strong className="uppercase">{e.category}</strong>: {e.description} - {formatRp(e.amount)}{' '}
                      {e.receipt_url && (
                        <a href={e.receipt_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                          [Nota]
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="font-bold text-amber-900 mb-1.5 uppercase">Pembayaran Piutang Diproses Hari Ini</h4>
              {data.todayPayments.length === 0 ? (
                <p className="text-slate-400">Belum ada pembayaran piutang hari ini.</p>
              ) : (
                <ul className="space-y-1">
                  {data.todayPayments.map((pay) => (
                    <li key={pay.id} className="border-b pb-1">
                      <strong>{pay.customer_name}</strong>: {formatRp(pay.amount)} ({pay.method})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}