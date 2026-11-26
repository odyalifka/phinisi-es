'use server';

import { writeAuditLog } from '@/lib/audit';
import {
  clearSessionCookie,
  createSessionCookie,
  getSession,
  verifyCredentials,
} from '@/lib/auth';
import { pool } from '@/lib/db';
import { uploadReceiptToSupabase } from '@/lib/supabaseStorage';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const SIZES = ['5kg', '10kg', '20kg'] as const;
const MANDATORY_RECEIPT_CATEGORIES = new Set(['bbm', 'perawatan_kendaraan', 'material_operasional']);

function redirectWith(type: 'error' | 'success', message: string): never {
  revalidatePath('/');
  redirect(`/?${type}=${encodeURIComponent(message)}`);
}

async function resolveActorId(sessionId: string): Promise<string> {
  try {
    const check = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS has_users`
    );
    if (!check.rows[0]?.has_users) return sessionId;

    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [sessionId]);
    if (userRes.rows[0]?.id) return userRes.rows[0].id;

    const fallback = await pool.query('SELECT id FROM users LIMIT 1');
    return fallback.rows[0]?.id || sessionId;
  } catch {
    return sessionId;
  }
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get('username') || '');
  const password = String(formData.get('password') || '');

  const session = verifyCredentials(username, password);
  if (!session) {
    redirectWith('error', 'Username atau password salah.');
  }

  await createSessionCookie(session);
  redirectWith('success', `Berhasil masuk sebagai ${session.name}.`);
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect('/');
}

export async function tambahProduksiBatch(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const event_date = String(formData.get('event_date'));
  const notes = String(formData.get('notes') || '').trim();
  const actorId = await resolveActorId(session.id);
  const batchId = crypto.randomUUID();

  const wacRes = await pool.query(`SELECT size, weighted_avg_cost FROM plastic_inventory_state`);
  const wacMap = new Map<string, number>();
  for (const r of wacRes.rows) {
    wacMap.set(r.size, Number(r.weighted_avg_cost || 0));
  }

  const entries: Array<{
    size: string;
    gross_qty: number;
    damaged_product_qty: number;
    good_qty: number;
    damaged_plastic_qty: number;
    plastic_unit_cost: number;
    plastic_total_cost: number;
  }> = [];

  for (const size of SIZES) {
    const gross_qty = Number(formData.get(`gross_${size}`) || 0);
    const damaged_product_qty = 0;
    const damaged_plastic_qty = Number(formData.get(`damaged_plastic_${size}`) || 0);

    if (gross_qty < 0 || damaged_plastic_qty < 0) {
      redirectWith('error', `Angka produksi ukuran ${size} tidak boleh negatif.`);
    }

    if (gross_qty > 0 || damaged_plastic_qty > 0) {
      const good_qty = gross_qty;
      const plastic_unit_cost = wacMap.get(size) || 0;
      const plastic_total_cost = (gross_qty + damaged_plastic_qty) * plastic_unit_cost;
      entries.push({
        size,
        gross_qty,
        damaged_product_qty,
        good_qty,
        damaged_plastic_qty,
        plastic_unit_cost,
        plastic_total_cost,
      });
    }
  }

  if (entries.length === 0) {
    redirectWith('error', 'Isi minimal satu ukuran kemasan (Produksi atau Plastik Rusak > 0).');
  }

  for (const item of entries) {
    const ins = await pool.query(
      `INSERT INTO productions (
        batch_id, event_date, size, gross_qty, damaged_product_qty, good_qty,
        damaged_plastic_qty, plastic_unit_cost_snapshot, plastic_total_cost, notes, created_by
      ) VALUES ($1, $2, $3::product_size, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        batchId,
        event_date,
        item.size,
        item.gross_qty,
        item.damaged_product_qty,
        item.good_qty,
        item.damaged_plastic_qty,
        item.plastic_unit_cost,
        item.plastic_total_cost,
        notes,
        actorId,
      ]
    );

    await writeAuditLog({
      tableName: 'productions',
      recordId: ins.rows[0].id,
      actionType: 'INSERT',
      oldValues: null,
      newValues: { event_date, ...item, notes },
      session,
      reason: 'Pencatatan produksi harian',
    });
  }

  redirectWith('success', `Produksi (${entries.length} ukuran) pada ${event_date} berhasil disimpan.`);
}
export async function voidProduksi(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang berhak membatalkan (Void) data produksi.');
  }

  const production_id = String(formData.get('production_id') || '');
  const void_reason = String(formData.get('void_reason') || '').trim();
  if (!void_reason) redirectWith('error', 'Alasan pembatalan (Void) wajib diisi.');

  const oldRes = await pool.query(`SELECT * FROM productions WHERE id = $1`, [production_id]);
  const oldRow = oldRes.rows[0];
  if (!oldRow || oldRow.is_voided) redirectWith('error', 'Data produksi tidak ditemukan atau sudah di-Void.');

  await pool.query(
    `UPDATE productions
     SET is_voided = TRUE,
         void_reason = $2,
         notes = TRIM(BOTH ' ' FROM COALESCE(notes, '') || ' [VOID: ' || $2 || ']')
     WHERE id = $1`,
    [production_id, void_reason]
  );

  await writeAuditLog({
    tableName: 'productions',
    recordId: production_id,
    actionType: 'VOID',
    oldValues: {
      size: oldRow.size,
      gross_qty: oldRow.gross_qty,
      damaged_product_qty: oldRow.damaged_product_qty,
      good_qty: oldRow.good_qty,
      damaged_plastic_qty: oldRow.damaged_plastic_qty,
      is_voided: false,
    },
    newValues: { is_voided: true, void_reason },
    session,
    reason: void_reason,
  });

  redirectWith('success', 'Data produksi berhasil di-Void dan stok es/plastik diperbarui.');
}

export async function tambahPengambilanLangsung(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const event_date = String(formData.get('event_date'));
  const payment_method = String(formData.get('payment_method'));
  const notes = String(formData.get('notes') || '').trim();

  if (payment_method !== 'cash' && payment_method !== 'transfer') {
    redirectWith('error', 'Pengambilan langsung harus lunas menggunakan Tunai (Cash) atau Transfer.');
  }

  const items: Array<{ size: string; qty: number }> = [];
  for (const size of SIZES) {
    const qty = Number(formData.get(`qty_${size}`) || 0);
    if (qty < 0) redirectWith('error', `Jumlah ${size} tidak boleh negatif.`);
    if (qty > 0) items.push({ size, qty });
  }

  if (items.length === 0) {
    redirectWith('error', 'Isi minimal satu ukuran kemasan (jumlah > 0) untuk pengambilan langsung.');
  }

  const prodRes = await pool.query(`SELECT * FROM products`);
  const prodMap = new Map(prodRes.rows.map((r) => [r.size, r]));
  const actorId = await resolveActorId(session.id);
  const batchId = crypto.randomUUID();

  for (const item of items) {
    const product = prodMap.get(item.size);
    if (!product) redirectWith('error', `Master harga untuk ukuran ${item.size} belum diatur.`);

    const unitPrice = Number(product.pickup_price);
    const ins = await pool.query(
      `INSERT INTO distributions (
        batch_id, event_date, dist_type, driver_name, customer_id, size, qty, payment_method,
        unit_price_snapshot, owner_share_snapshot, driver_bonus_snapshot, notes, created_by
      ) VALUES ($1, $2, 'pickup'::distribution_type, NULL, NULL, $3::product_size, $4, $5::payment_method, $6, $7, 0, $8, $9)
      RETURNING id, total_amount`,
      [
        batchId,
        event_date,
        item.size,
        item.qty,
        payment_method,
        unitPrice,
        Number(product.owner_share),
        notes,
        actorId,
      ]
    );

    await writeAuditLog({
      tableName: 'distributions',
      recordId: ins.rows[0].id,
      actionType: 'INSERT',
      oldValues: null,
      newValues: { dist_type: 'pickup', event_date, size: item.size, qty: item.qty, payment_method, notes },
      session,
      reason: 'Pencatatan pengambilan langsung',
    });
  }

  redirectWith('success', `Pengambilan langsung (${items.length} ukuran) berhasil dicatat lunas.`);
}

export async function tambahPengantaran(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const event_date = String(formData.get('event_date'));
  const driver_name = String(formData.get('driver_name') || '').trim();
  const payment_method = String(formData.get('payment_method'));
  const existing_customer_id = String(formData.get('existing_customer_id') || '').trim();
  const customer_name = String(formData.get('customer_name') || '').trim();
  const customer_phone = String(formData.get('customer_phone') || '').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (!driver_name) {
    redirectWith('error', 'Nama Driver wajib diisi untuk transaksi pengantaran.');
  }

  if (payment_method === 'receivable' && !existing_customer_id && !customer_name) {
    redirectWith('error', 'Transaksi piutang wajib memilih pelanggan terdaftar atau mengisi nama pelanggan baru.');
  }

  const items: Array<{ size: string; qty: number }> = [];
  for (const size of SIZES) {
    const qty = Number(formData.get(`qty_${size}`) || 0);
    if (qty < 0) redirectWith('error', `Jumlah ${size} tidak boleh negatif.`);
    if (qty > 0) items.push({ size, qty });
  }

  if (items.length === 0) {
    redirectWith('error', 'Isi minimal satu ukuran kemasan (jumlah > 0) untuk pengantaran.');
  }

  const prodRes = await pool.query(`SELECT * FROM products`);
  const prodMap = new Map(prodRes.rows.map((r) => [r.size, r]));
  const actorId = await resolveActorId(session.id);
  const batchId = crypto.randomUUID();

  let customerId: string | null = null;
  if (payment_method === 'receivable') {
    if (existing_customer_id) {
      customerId = existing_customer_id;
    } else {
      const dupCheck = await pool.query(
        `SELECT id FROM factory_customers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
        [customer_name]
      );
      if (dupCheck.rows[0]?.id) {
        customerId = dupCheck.rows[0].id;
      } else {
        const custRes = await pool.query(
          `INSERT INTO factory_customers (name, phone) VALUES ($1, $2) RETURNING id`,
          [customer_name, customer_phone]
        );
        customerId = custRes.rows[0].id;
      }
    }
  }

  for (const item of items) {
    const product = prodMap.get(item.size);
    if (!product) redirectWith('error', `Master harga untuk ukuran ${item.size} belum diatur.`);

    const unitPrice = Number(product.delivery_price);
    const driverBonus = Number(product.driver_bonus);

    const distRes = await pool.query(
      `INSERT INTO distributions (
        batch_id, event_date, dist_type, driver_name, customer_id, size, qty, payment_method,
        unit_price_snapshot, owner_share_snapshot, driver_bonus_snapshot, notes, created_by
      ) VALUES ($1, $2, 'delivery'::distribution_type, $3, $4, $5::product_size, $6, $7::payment_method, $8, $9, $10, $11, $12)
      RETURNING id, total_amount`,
      [
        batchId,
        event_date,
        driver_name,
        customerId,
        item.size,
        item.qty,
        payment_method,
        unitPrice,
        Number(product.owner_share),
        driverBonus,
        notes,
        actorId,
      ]
    );

    if (payment_method === 'receivable' && customerId) {
      await pool.query(
        `INSERT INTO receivables (distribution_id, customer_id, event_date, total_billed)
         VALUES ($1, $2, $3, $4)`,
        [distRes.rows[0].id, customerId, event_date, distRes.rows[0].total_amount]
      );
    }

    await writeAuditLog({
      tableName: 'distributions',
      recordId: distRes.rows[0].id,
      actionType: 'INSERT',
      oldValues: null,
      newValues: {
        dist_type: 'delivery',
        driver_name,
        customer_id: customerId,
        event_date,
        size: item.size,
        qty: item.qty,
        payment_method,
        notes,
      },
      session,
      reason: 'Pencatatan pengantaran driver',
    });
  }

  redirectWith('success', `Pengantaran oleh ${driver_name} (${items.length} ukuran) berhasil dicatat.`);
}

export async function voidDistribusi(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang berhak membatalkan (Void) transaksi distribusi.');
  }

  const distribution_id = String(formData.get('distribution_id') || '');
  const void_reason = String(formData.get('void_reason') || '').trim();
  if (!void_reason) redirectWith('error', 'Alasan pembatalan (Void) wajib diisi.');

  const oldRes = await pool.query(`SELECT * FROM distributions WHERE id = $1`, [distribution_id]);
  const oldRow = oldRes.rows[0];
  if (!oldRow || oldRow.is_voided) redirectWith('error', 'Transaksi tidak ditemukan atau sudah di-Void.');

  const recCheck = await pool.query(
    `SELECT id, total_billed, remaining_balance, status FROM receivables WHERE distribution_id = $1`,
    [distribution_id]
  );

  if (recCheck.rows.length > 0) {
    const rec = recCheck.rows[0];
    if (Number(rec.remaining_balance) < Number(rec.total_billed)) {
      redirectWith('error', 'Piutang yang sudah memiliki riwayat pembayaran tidak dapat di-Void langsung.');
    }
    await pool.query(
      `UPDATE receivables SET status = 'voided'::receivable_status, remaining_balance = 0 WHERE id = $1`,
      [rec.id]
    );
  }

  await pool.query(
    `UPDATE distributions
     SET is_voided = TRUE,
         void_reason = $2,
         notes = TRIM(BOTH ' ' FROM COALESCE(notes, '') || ' [VOID: ' || $2 || ']')
     WHERE id = $1`,
    [distribution_id, void_reason]
  );

  await writeAuditLog({
    tableName: 'distributions',
    recordId: distribution_id,
    actionType: 'VOID',
    oldValues: {
      size: oldRow.size,
      qty: oldRow.qty,
      payment_method: oldRow.payment_method,
      total_amount: oldRow.total_amount,
      is_voided: false,
    },
    newValues: { is_voided: true, void_reason },
    session,
    reason: void_reason,
  });

  redirectWith('success', 'Transaksi distribusi berhasil di-Void (histori audit tersimpan).');
}

export async function bayarPiutangBertahap(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const receivable_id = String(formData.get('receivable_id') || '');
  const payment_date = String(formData.get('payment_date') || '');
  const amount = Number(formData.get('amount') || 0);
  const method = String(formData.get('method') || 'cash');
  const notes = String(formData.get('notes') || 'Pembayaran piutang').trim();

  if (amount <= 0) {
    redirectWith('error', 'Nominal pembayaran piutang harus lebih dari Rp 0.');
  }

  const recRes = await pool.query(
    `SELECT id, total_billed, remaining_balance, status FROM receivables WHERE id = $1`,
    [receivable_id]
  );
  const rec = recRes.rows[0];
  if (!rec || rec.status === 'paid' || rec.status === 'voided') {
    redirectWith('error', 'Piutang tidak ditemukan atau sudah lunas.');
  }

  const sisaSebelum = Number(rec.remaining_balance);
  if (amount > sisaSebelum) {
    redirectWith('error', `Nominal bayar (Rp ${amount}) melebihi sisa tagihan (Rp ${sisaSebelum}).`);
  }

  const actorId = await resolveActorId(session.id);

  const payIns = await pool.query(
    `INSERT INTO receivable_payments (receivable_id, payment_date, amount, method, notes, created_by)
     VALUES ($1, $2, $3, $4::payment_method, $5, $6)
     RETURNING id`,
    [receivable_id, payment_date, amount, method, notes, actorId]
  );

  const afterRes = await pool.query(
    `SELECT remaining_balance, status FROM receivables WHERE id = $1`,
    [receivable_id]
  );
  const sisaSesudahDB = Number(afterRes.rows[0]?.remaining_balance ?? sisaSebelum);
  if (sisaSesudahDB === sisaSebelum) {
    const sisaBaru = sisaSebelum - amount;
    const statusBaru = sisaBaru <= 0 ? 'paid' : 'partial';
    await pool.query(
      `UPDATE receivables SET remaining_balance = $1, status = $2::receivable_status WHERE id = $3`,
      [sisaBaru, statusBaru, receivable_id]
    );
  }

  await writeAuditLog({
    tableName: 'receivables',
    recordId: receivable_id,
    actionType: 'PAYMENT',
    oldValues: { remaining_balance: sisaSebelum, status: rec.status },
    newValues: {
      payment_id: payIns.rows[0].id,
      payment_date,
      paid_amount: amount,
      method,
      remaining_balance: sisaSebelum - amount,
    },
    session,
    reason: notes,
  });

  redirectWith('success', `Pembayaran piutang sebesar Rp ${amount.toLocaleString('id-ID')} berhasil dicatat.`);
}

export async function tambahPengeluaran(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const expense_date = String(formData.get('expense_date'));
  const category = String(formData.get('category'));
  const description = String(formData.get('description') || '').trim();
  const amount = Number(formData.get('amount') || 0);
  const requestedSource = String(formData.get('source') || 'factory_cash');
  const receiptFile = formData.get('receipt') as File | null;

  const source = session.role === 'owner' ? requestedSource : 'factory_cash';

  if (!description || amount <= 0) {
    redirectWith('error', 'Keterangan dan nominal pengeluaran wajib diisi dengan benar.');
  }

  const isReceiptMandatory = MANDATORY_RECEIPT_CATEGORIES.has(category);
  const hasFile = Boolean(receiptFile && receiptFile.size > 0);

  if (isReceiptMandatory && !hasFile) {
    redirectWith(
      'error',
      `Kategori "${category.toUpperCase()}" WAJIB melampirkan foto bukti nota/struk.`
    );
  }

  let receiptUrl: string | null = null;
  if (hasFile && receiptFile) {
    try {
      receiptUrl = await uploadReceiptToSupabase(receiptFile, expense_date);
    } catch (err) {
      redirectWith('error', err instanceof Error ? err.message : 'Gagal mengunggah bukti nota.');
    }
  }

  const actorId = await resolveActorId(session.id);

  const ins = await pool.query(
    `INSERT INTO expenses (expense_date, category, description, amount, source, receipt_url, created_by)
     VALUES ($1, $2, $3, $4, $5::payment_source, $6, $7)
     RETURNING id`,
    [expense_date, category, description, amount, source, receiptUrl, actorId]
  );

  await writeAuditLog({
    tableName: 'expenses',
    recordId: ins.rows[0].id,
    actionType: 'INSERT',
    oldValues: null,
    newValues: { expense_date, category, description, amount, source, receipt_url: receiptUrl },
    session,
    reason: 'Pencatatan pengeluaran operasional',
  });

  redirectWith('success', `Pengeluaran "${description}" berhasil disimpan.`);
}

export async function voidPengeluaran(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang berhak membatalkan (Void) pengeluaran.');
  }

  const expense_id = String(formData.get('expense_id') || '');
  const void_reason = String(formData.get('void_reason') || '').trim();
  if (!void_reason) redirectWith('error', 'Alasan pembatalan (Void) wajib diisi.');

  const oldRes = await pool.query(`SELECT * FROM expenses WHERE id = $1`, [expense_id]);
  const oldRow = oldRes.rows[0];
  if (!oldRow || oldRow.is_voided) redirectWith('error', 'Pengeluaran tidak ditemukan atau sudah di-Void.');

  await pool.query(
    `UPDATE expenses
     SET is_voided = TRUE,
         void_reason = $2,
         description = description || ' [VOID: ' || $2 || ']'
     WHERE id = $1`,
    [expense_id, void_reason]
  );

  await writeAuditLog({
    tableName: 'expenses',
    recordId: expense_id,
    actionType: 'VOID',
    oldValues: { category: oldRow.category, description: oldRow.description, amount: oldRow.amount, is_voided: false },
    newValues: { is_voided: true, void_reason },
    session,
    reason: void_reason,
  });

  redirectWith('success', 'Pengeluaran berhasil di-Void dan saldo kas diperbarui.');
}

export async function beliPlastik(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat mencatat pembelian persediaan plastik.');
  }

  const purchase_date = String(formData.get('purchase_date'));
  const size = String(formData.get('size'));
  const qty = Number(formData.get('qty') || 0);
  const unit_price = Number(formData.get('unit_price') || 0);
  const supplier_name = String(formData.get('supplier_name') || '').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (qty <= 0 || unit_price < 0) {
    redirectWith('error', 'Jumlah pembelian plastik harus > 0 dan harga satuan tidak boleh negatif.');
  }

  const [stockRes, wacRes] = await Promise.all([
    pool.query(`SELECT stok_teoretis FROM v_plastic_stock_reconciliation WHERE size = $1::product_size`, [size]),
    pool.query(`SELECT weighted_avg_cost FROM plastic_inventory_state WHERE size = $1::product_size`, [size]),
  ]);

  const currentStock = Math.max(0, Number(stockRes.rows[0]?.stok_teoretis || 0));
  const oldWac = Number(wacRes.rows[0]?.weighted_avg_cost || 0);
  const totalCost = qty * unit_price;
  const newStock = currentStock + qty;
  const newWac = newStock > 0 ? ((currentStock * oldWac) + totalCost) / newStock : unit_price;

  const actorId = await resolveActorId(session.id);

  await pool.query(
    `UPDATE plastic_inventory_state
     SET weighted_avg_cost = $1, updated_at = NOW()
     WHERE size = $2::product_size`,
    [newWac, size]
  );

  const ins = await pool.query(
    `INSERT INTO plastic_purchases (purchase_date, size, qty, unit_price, total_cost, wac_after, supplier_name, notes, created_by)
     VALUES ($1, $2::product_size, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [purchase_date, size, qty, unit_price, totalCost, newWac, supplier_name, notes, actorId]
  );

  await writeAuditLog({
    tableName: 'plastic_purchases',
    recordId: ins.rows[0].id,
    actionType: 'INSERT',
    oldValues: { stock_before: currentStock, wac_before: oldWac },
    newValues: { size, qty, unit_price, total_cost: totalCost, stock_after: newStock, wac_after: newWac },
    session,
    reason: `Pembelian plastik ${size}${supplier_name ? ` dari ${supplier_name}` : ''}`,
  });

  redirectWith(
    'success',
    `Pembelian ${qty} lbr plastik ${size} dicatat. Harga rata-rata tertimbang baru: Rp ${Math.round(newWac).toLocaleString('id-ID')}/lbr.`
  );
}

export async function simpanOpnamePlastik(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat menyimpan Stock Opname Plastik.');
  }

  const opname_date = String(formData.get('opname_date'));
  const size = String(formData.get('size'));
  const actual_qty = Number(formData.get('actual_qty') || 0);
  const notes = String(formData.get('notes') || '').trim();

  const theoRes = await pool.query(
    `SELECT stok_teoretis FROM v_plastic_stock_reconciliation WHERE size = $1::product_size`,
    [size]
  );
  const theoretical_qty = Number(theoRes.rows[0]?.stok_teoretis ?? 0);
  const variance = actual_qty - theoretical_qty;

  if (variance !== 0 && !notes) {
    redirectWith('error', `Terdapat selisih ${variance} lembar pada plastik ${size}. Keterangan wajib diisi.`);
  }

  const actorId = await resolveActorId(session.id);

  const ins = await pool.query(
    `INSERT INTO plastic_opnames (opname_date, size, theoretical_qty, actual_qty, notes, created_by)
     VALUES ($1, $2::product_size, $3, $4, $5, $6)
     RETURNING id`,
    [opname_date, size, theoretical_qty, actual_qty, notes || 'Sesuai stok teoretis', actorId]
  );

  await writeAuditLog({
    tableName: 'plastic_opnames',
    recordId: ins.rows[0].id,
    actionType: 'OPNAME',
    oldValues: { size, theoretical_qty },
    newValues: { size, actual_qty, variance },
    session,
    reason: notes || 'Stock opname plastik',
  });

  redirectWith('success', `Stock opname plastik ${size} berhasil disimpan (Selisih: ${variance} lbr).`);
}

export async function simpanOpnameColdStorage(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat melakukan Stock Opname Cold Storage.');
  }

  const opname_date = String(formData.get('opname_date'));
  const notes = String(formData.get('notes') || '').trim();
  const actorId = await resolveActorId(session.id);

  const theoRes = await pool.query(`SELECT size, stok_teoretis_sekarang FROM v_ice_stock_reconciliation`);
  const theoMap = new Map<string, number>();
  for (const r of theoRes.rows) {
    theoMap.set(r.size, Number(r.stok_teoretis_sekarang || 0));
  }

  let hasVariance = false;
  const rowsToSave: Array<{ size: string; theoretical_qty: number; actual_qty: number; variance: number }> = [];

  for (const size of SIZES) {
    const rawVal = formData.get(`actual_${size}`);
    if (rawVal === null || String(rawVal).trim() === '') continue;
    const actual_qty = Number(rawVal);
    if (actual_qty < 0) redirectWith('error', `Stok fisik ${size} tidak boleh negatif.`);
    const theoretical_qty = theoMap.get(size) ?? 0;
    const variance = actual_qty - theoretical_qty;
    if (variance !== 0) hasVariance = true;
    rowsToSave.push({ size, theoretical_qty, actual_qty, variance });
  }

  if (rowsToSave.length === 0) {
    redirectWith('error', 'Isi minimal satu ukuran stok fisik aktual Cold Storage.');
  }

  if (hasVariance && !notes) {
    redirectWith(
      'error',
      'Terdapat selisih antara stok teoretis dan stok aktual Cold Storage. Wajib mengisi keterangan penyebab selisih.'
    );
  }

  for (const item of rowsToSave) {
    const ins = await pool.query(
      `INSERT INTO ice_opnames (opname_date, size, theoretical_qty, actual_qty, notes, created_by)
       VALUES ($1, $2::product_size, $3, $4, $5, $6)
       RETURNING id`,
      [opname_date, item.size, item.theoretical_qty, item.actual_qty, notes || 'Stock opname mingguan sesuai', actorId]
    );

    await writeAuditLog({
      tableName: 'ice_opnames',
      recordId: ins.rows[0].id,
      actionType: 'OPNAME',
      oldValues: { size: item.size, theoretical_qty: item.theoretical_qty },
      newValues: { size: item.size, actual_qty: item.actual_qty, variance: item.variance },
      session,
      reason: notes || 'Stock opname Cold Storage',
    });
  }

  redirectWith('success', `Stock Opname Cold Storage (${rowsToSave.length} ukuran) berhasil disimpan.`);
}

export async function bayarBonusDriver(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat mencairkan bonus driver.');
  }

  const driver_name = String(formData.get('driver_name') || '').trim();
  const dateRes = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const paid_date = dateRes.rows[0].today;

  if (driver_name && driver_name !== '__ALL__') {
    const sumRes = await pool.query(
      `SELECT COALESCE(SUM(total_driver_bonus), 0) AS total
       FROM distributions
       WHERE is_voided = FALSE AND dist_type = 'delivery' AND bonus_status = 'unpaid' AND driver_name = $1`,
      [driver_name]
    );
    await pool.query(
      `UPDATE distributions
       SET bonus_status = 'paid'::bonus_status, bonus_paid_date = $1
       WHERE is_voided = FALSE AND dist_type = 'delivery' AND bonus_status = 'unpaid' AND driver_name = $2`,
      [paid_date, driver_name]
    );
    await writeAuditLog({
      tableName: 'distributions',
      recordId: driver_name,
      actionType: 'PAYMENT',
      oldValues: { bonus_status: 'unpaid', unpaid_amount: Number(sumRes.rows[0]?.total || 0) },
      newValues: { bonus_status: 'paid', bonus_paid_date: paid_date },
      session,
      reason: `Pembayaran bonus driver ${driver_name}`,
    });
    redirectWith('success', `Bonus driver ${driver_name} telah ditandai dibayar.`);
  } else {
    await pool.query(
      `UPDATE distributions
       SET bonus_status = 'paid'::bonus_status, bonus_paid_date = $1
       WHERE is_voided = FALSE AND dist_type = 'delivery' AND bonus_status = 'unpaid'`,
      [paid_date]
    );
    await writeAuditLog({
      tableName: 'distributions',
      recordId: 'ALL_DRIVERS',
      actionType: 'PAYMENT',
      oldValues: { bonus_status: 'unpaid' },
      newValues: { bonus_status: 'paid', bonus_paid_date: paid_date },
      session,
      reason: 'Pembayaran seluruh kewajiban bonus driver',
    });
    redirectWith('success', 'Seluruh kewajiban bonus driver telah ditandai dibayar.');
  }
}

export async function simpanSerahKasOwner(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat mencatat serah terima kas.');
  }

  const handover_date = String(formData.get('handover_date'));
  const amount_handed_over = Number(formData.get('amount_handed_over') || 0);
  const notes = String(formData.get('notes') || 'Setoran kas ke owner').trim();

  if (amount_handed_over <= 0) {
    redirectWith('error', 'Nominal serah terima kas harus lebih dari 0.');
  }

  const actorId = await resolveActorId(session.id);

  const [cashRes, colRes] = await Promise.all([
    pool.query(`SELECT * FROM v_factory_cash_summary`),
    pool.query(
      `SELECT column_name, data_type, is_nullable, column_default, is_generated
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cash_handovers'`
    ),
  ]);

  const cash = cashRes.rows[0] || {};
  const balance_before = Number(cash.saldo_kas_pabrik_sekarang ?? 0);
  const balance_after = balance_before - amount_handed_over;

  const cols: string[] = [];
  const vals: unknown[] = [];

  for (const col of colRes.rows) {
    const name: string = col.column_name;
    if (name === 'id' || col.is_generated !== 'NEVER') continue;

    if (name === 'handover_date') {
      cols.push(name);
      vals.push(handover_date);
    } else if (name === 'amount_handed_over') {
      cols.push(name);
      vals.push(amount_handed_over);
    } else if (name === 'balance_before') {
      cols.push(name);
      vals.push(balance_before);
    } else if (name === 'balance_after') {
      cols.push(name);
      vals.push(balance_after);
    } else if (name === 'notes') {
      cols.push(name);
      vals.push(notes);
    } else if (col.data_type === 'uuid') {
      cols.push(name);
      vals.push(actorId);
    } else if (col.is_nullable === 'NO' && col.column_default === null) {
      cols.push(name);
      if (name.includes('bonus')) {
        vals.push(Number(cash.kewajiban_bonus_driver_belum_dibayar ?? 0));
      } else if (name.includes('safe') || name.includes('aman')) {
        vals.push(Number(cash.aman_diserahkan_ke_owner ?? 0));
      } else if (name.includes('after')) {
        vals.push(balance_after);
      } else {
        vals.push(balance_before);
      }
    }
  }

  const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
  const ins = await pool.query(
    `INSERT INTO cash_handovers (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    vals
  );

  await writeAuditLog({
    tableName: 'cash_handovers',
    recordId: ins.rows[0].id,
    actionType: 'INSERT',
    oldValues: { saldo_kas_sebelum: balance_before },
    newValues: { handover_date, amount_handed_over, saldo_kas_sesudah: balance_after },
    session,
    reason: notes,
  });

  redirectWith('success', 'Serah terima kas ke Owner berhasil dicatat.');
}
export async function tambahDriver(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat menambah data driver.');
  }
  const name = String(formData.get('driver_name') || '').trim();
  if (!name) redirectWith('error', 'Nama driver baru wajib diisi.');

  const existing = await pool.query(`SELECT id FROM drivers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`, [name]);
  if (existing.rows.length > 0) {
    await pool.query(`UPDATE drivers SET name = $1, is_active = TRUE WHERE id = $2`, [name, existing.rows[0].id]);
    redirectWith('success', `Driver "${name}" diaktifkan kembali.`);
  }

  const ins = await pool.query(`INSERT INTO drivers (name, is_active) VALUES ($1, TRUE) RETURNING id`, [name]);
  await writeAuditLog({
    tableName: 'drivers',
    recordId: ins.rows[0].id,
    actionType: 'INSERT',
    oldValues: null,
    newValues: { name, is_active: true },
    session,
    reason: 'Menambah driver baru',
  });
  redirectWith('success', `Driver "${name}" berhasil ditambahkan.`);
}

export async function ubahDriver(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat mengubah nama driver.');
  }
  const driver_id = String(formData.get('driver_id') || '');
  const new_name = String(formData.get('new_name') || '').trim();
  if (!driver_id || !new_name) redirectWith('error', 'Nama baru driver tidak boleh kosong.');

  const oldRes = await pool.query(`SELECT name FROM drivers WHERE id = $1`, [driver_id]);
  const oldName = oldRes.rows[0]?.name || '';

  await pool.query(`UPDATE drivers SET name = $1 WHERE id = $2`, [new_name, driver_id]);
  await writeAuditLog({
    tableName: 'drivers',
    recordId: driver_id,
    actionType: 'UPDATE',
    oldValues: { name: oldName },
    newValues: { name: new_name },
    session,
    reason: 'Edit nama driver',
  });
  redirectWith('success', `Nama driver berhasil diubah menjadi "${new_name}".`);
}

export async function hapusDriver(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat menghapus/menonaktifkan driver.');
  }
  const driver_id = String(formData.get('driver_id') || '');
  const oldRes = await pool.query(`SELECT name FROM drivers WHERE id = $1`, [driver_id]);
  const oldName = oldRes.rows[0]?.name || '';

  await pool.query(`DELETE FROM drivers WHERE id = $1`, [driver_id]);
  await writeAuditLog({
    tableName: 'drivers',
    recordId: driver_id,
    actionType: 'VOID',
    oldValues: { name: oldName },
    newValues: null,
    session,
    reason: 'Menghapus driver yang keluar',
  });
  redirectWith('success', `Driver "${oldName}" telah dihapus dari daftar pilihan.`);
}