'use server';

import {
  clearSessionCookie,
  createSessionCookie,
  getSession,
  verifyCredentials,
} from '@/lib/auth';
import { pool } from '@/lib/db';
import { mkdir, writeFile } from 'fs/promises';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import path from 'path';

const DEFAULT_OWNER_ID = '11111111-1111-1111-1111-111111111111';

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
    return fallback.rows[0]?.id || DEFAULT_OWNER_ID;
  } catch {
    return DEFAULT_OWNER_ID;
  }
}

// LOGIN & LOGOUT
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

// 1. SIMPAN PRODUKSI HARIAN
export async function tambahProduksi(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const event_date = String(formData.get('event_date'));
  const size = String(formData.get('size'));
  const good_qty = Number(formData.get('good_qty') || 0);
  const damaged_product_qty = Number(formData.get('damaged_product_qty') || 0);
  const damaged_plastic_qty = Number(formData.get('damaged_plastic_qty') || 0);
  const notes = String(formData.get('notes') || '').trim();

  if (good_qty + damaged_product_qty + damaged_plastic_qty <= 0) {
    redirectWith('error', 'Minimal salah satu jumlah (Layak Jual / Es Rusak / Plastik Rusak) harus lebih dari 0.');
  }

  const actorId = await resolveActorId(session.id);

  await pool.query(
    `INSERT INTO productions (event_date, size, good_qty, damaged_product_qty, damaged_plastic_qty, notes, created_by)
     VALUES ($1, $2::product_size, $3, $4, $5, $6, $7)`,
    [event_date, size, good_qty, damaged_product_qty, damaged_plastic_qty, notes, actorId]
  );

  redirectWith('success', `Produksi ${size} (${good_qty} bks layak jual) berhasil dicatat.`);
}

// VOID PRODUKSI (KHUSUS OWNER)
export async function voidProduksi(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang berhak membatalkan (Void) data produksi.');
  }

  const production_id = String(formData.get('production_id') || '');
  const void_reason = String(formData.get('void_reason') || 'Salah input produksi').trim();

  await pool.query(
    `UPDATE productions
     SET is_voided = TRUE,
         void_reason = $2,
         notes = TRIM(BOTH ' ' FROM COALESCE(notes, '') || ' [VOID oleh ' || $3 || ': ' || $2 || ']')
     WHERE id = $1 AND is_voided = FALSE`,
    [production_id, void_reason, session.username]
  );

  redirectWith('success', 'Data produksi berhasil dibatalkan (VOID) dan stok teoretis diperbarui.');
}

// 2. SIMPAN DISTRIBUSI
export async function tambahDistribusi(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const event_date = String(formData.get('event_date'));
  const dist_type = String(formData.get('dist_type'));
  const driver_name = String(formData.get('driver_name') || '').trim();
  const size = String(formData.get('size'));
  const qty = Number(formData.get('qty') || 0);
  const payment_method = String(formData.get('payment_method'));
  const existing_customer_id = String(formData.get('existing_customer_id') || '').trim();
  const customer_name = String(formData.get('customer_name') || '').trim();
  const customer_phone = String(formData.get('customer_phone') || '').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (qty <= 0) {
    redirectWith('error', 'Jumlah bungkus harus minimal 1.');
  }
  if (dist_type === 'pickup' && payment_method === 'receivable') {
    redirectWith('error', 'Ambil Langsung tidak boleh memakai metode Piutang.');
  }
  if (dist_type === 'delivery' && !driver_name) {
    redirectWith('error', 'Nama Driver wajib diisi untuk transaksi Diantar Driver.');
  }
  if (payment_method === 'receivable' && !existing_customer_id && !customer_name) {
    redirectWith('error', 'Pilih pelanggan dari daftar atau ketik nama pelanggan baru untuk transaksi Piutang.');
  }

  const prodRes = await pool.query('SELECT * FROM products WHERE size = $1::product_size', [size]);
  const product = prodRes.rows[0];
  if (!product) {
    redirectWith('error', `Master harga untuk ukuran ${size} tidak ditemukan.`);
  }

  const unitPrice = dist_type === 'pickup' ? Number(product.pickup_price) : Number(product.delivery_price);
  const driverBonus = dist_type === 'delivery' ? Number(product.driver_bonus) : 0;
  const actorId = await resolveActorId(session.id);

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
        if (customer_phone) {
          await pool.query(
            `UPDATE factory_customers SET phone = COALESCE(NULLIF(phone, ''), $1) WHERE id = $2`,
            [customer_phone, customerId]
          );
        }
      } else {
        const custRes = await pool.query(
          `INSERT INTO factory_customers (name, phone) VALUES ($1, $2) RETURNING id`,
          [customer_name, customer_phone]
        );
        customerId = custRes.rows[0].id;
      }
    }
  }

  const distRes = await pool.query(
    `INSERT INTO distributions (
      event_date, dist_type, driver_name, customer_id, size, qty, payment_method,
      unit_price_snapshot, owner_share_snapshot, driver_bonus_snapshot, notes, created_by
    ) VALUES ($1, $2::distribution_type, $3, $4, $5::product_size, $6, $7::payment_method, $8, $9, $10, $11, $12)
    RETURNING id, total_amount`,
    [
      event_date,
      dist_type,
      dist_type === 'delivery' ? driver_name : null,
      customerId,
      size,
      qty,
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

  redirectWith('success', `Distribusi ${size} × ${qty} bks berhasil dicatat.`);
}

// VOID DISTRIBUSI (KHUSUS OWNER)
export async function voidDistribusi(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang berhak membatalkan (Void) transaksi.');
  }

  const distribution_id = String(formData.get('distribution_id') || '');
  const void_reason = String(formData.get('void_reason') || 'Salah input data').trim();

  const recCheck = await pool.query(
    `SELECT id, total_billed, remaining_balance FROM receivables WHERE distribution_id = $1`,
    [distribution_id]
  );

  if (recCheck.rows.length > 0) {
    const rec = recCheck.rows[0];
    if (Number(rec.remaining_balance) < Number(rec.total_billed)) {
      redirectWith('error', 'Transaksi piutang yang sudah pernah dibayar/dicicil tidak dapat langsung di-Void.');
    }
    await pool.query(`DELETE FROM receivables WHERE id = $1`, [rec.id]);
  }

  await pool.query(
    `UPDATE distributions
     SET is_voided = TRUE,
         notes = TRIM(BOTH ' ' FROM COALESCE(notes, '') || ' [VOID oleh ' || $2 || ': ' || $3 || ']')
     WHERE id = $1 AND is_voided = FALSE`,
    [distribution_id, session.username, void_reason]
  );

  redirectWith('success', 'Transaksi distribusi berhasil dibatalkan (VOID).');
}

// 3. SIMPAN PENGELUARAN + UNGGAH FOTO NOTA
export async function tambahPengeluaran(formData: FormData) {
  const session = await getSession();
  if (!session) redirectWith('error', 'Sesi habis. Silakan login kembali.');

  const expense_date = String(formData.get('expense_date'));
  const category = String(formData.get('category'));
  const description = String(formData.get('description') || '').trim();
  const amount = Number(formData.get('amount') || 0);
  const source = String(formData.get('source'));
  const receiptFile = formData.get('receipt') as File | null;

  if (!description || amount <= 0) {
    redirectWith('error', 'Keterangan dan nominal pengeluaran wajib diisi dengan benar.');
  }

  let receiptUrl: string | null = null;
  if (receiptFile && receiptFile.size > 0) {
    if (!receiptFile.type.startsWith('image/')) {
      redirectWith('error', 'File bukti nota harus berupa gambar (JPG/PNG/WebP).');
    }
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'notas');
    await mkdir(uploadDir, { recursive: true });

    const ext = path.extname(receiptFile.name) || '.jpg';
    const safeBase = path
      .basename(receiptFile.name, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    const fileName = `${expense_date}_${Date.now()}_${safeBase}${ext}`;
    const filePath = path.join(uploadDir, fileName);

    const bytes = await receiptFile.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));
    receiptUrl = `/uploads/notas/${fileName}`;
  }

  const actorId = await resolveActorId(session.id);

  await pool.query(
    `INSERT INTO expenses (expense_date, category, description, amount, source, receipt_url, created_by)
     VALUES ($1, $2, $3, $4, $5::payment_source, $6, $7)`,
    [expense_date, category, description, amount, source, receiptUrl, actorId]
  );

  redirectWith(
    'success',
    receiptUrl
      ? `Pengeluaran "${description}" beserta foto nota berhasil disimpan.`
      : `Pengeluaran "${description}" berhasil disimpan.`
  );
}

// VOID PENGELUARAN (KHUSUS OWNER)
export async function voidPengeluaran(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang berhak membatalkan (Void) pengeluaran.');
  }

  const expense_id = String(formData.get('expense_id') || '');
  const void_reason = String(formData.get('void_reason') || 'Salah input pengeluaran').trim();

  await pool.query(
    `UPDATE expenses
     SET is_voided = TRUE,
         void_reason = $2,
         description = description || ' [VOID oleh ' || $3 || ': ' || $2 || ']'
     WHERE id = $1 AND is_voided = FALSE`,
    [expense_id, void_reason, session.username]
  );

  redirectWith('success', 'Pengeluaran berhasil dibatalkan (VOID) dan saldo kas diperbarui.');
}

// 4. LUNASI PIUTANG (KHUSUS OWNER)
export async function lunasiPiutang(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat mencatat pelunasan piutang.');
  }

  const receivable_id = String(formData.get('receivable_id'));
  const remaining_balance = Number(formData.get('remaining_balance') || 0);
  const method = String(formData.get('method') || 'cash');

  if (remaining_balance <= 0) redirectWith('error', 'Saldo piutang sudah 0.');

  const dateRes = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const payment_date = dateRes.rows[0].today;
  const actorId = await resolveActorId(session.id);

  await pool.query(
    `INSERT INTO receivable_payments (receivable_id, payment_date, amount, method, notes, created_by)
     VALUES ($1, $2, $3, $4::payment_method, 'Pelunasan penuh via web', $5)`,
    [receivable_id, payment_date, remaining_balance, method, actorId]
  );

  redirectWith('success', 'Piutang pelanggan berhasil ditandai lunas.');
}

// 5. BAYAR BONUS DRIVER (KHUSUS OWNER)
export async function bayarBonusDriver(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat mencairkan bonus driver.');
  }

  const driver_name = String(formData.get('driver_name') || '').trim();
  const dateRes = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const paid_date = dateRes.rows[0].today;

  if (driver_name && driver_name !== '__ALL__') {
    await pool.query(
      `UPDATE distributions
       SET bonus_status = 'paid'::bonus_status, bonus_paid_date = $1
       WHERE is_voided = FALSE AND dist_type = 'delivery' AND bonus_status = 'unpaid' AND driver_name = $2`,
      [paid_date, driver_name]
    );
    redirectWith('success', `Bonus driver ${driver_name} telah ditandai dibayar.`);
  } else {
    await pool.query(
      `UPDATE distributions
       SET bonus_status = 'paid'::bonus_status, bonus_paid_date = $1
       WHERE is_voided = FALSE AND dist_type = 'delivery' AND bonus_status = 'unpaid'`,
      [paid_date]
    );
    redirectWith('success', 'Seluruh kewajiban bonus driver telah ditandai dibayar.');
  }
}

// 6. SIMPAN STOK OPNAME COLD STORAGE (KHUSUS OWNER)
export async function simpanStokOpname(formData: FormData) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    redirectWith('error', 'Hanya Owner yang dapat melakukan Stok Opname Cold Storage.');
  }

  const opname_date = String(formData.get('opname_date'));
  const size = String(formData.get('size'));
  const actual_qty = Number(formData.get('actual_qty') || 0);
  const notes = String(formData.get('notes') || 'Stok opname fisik').trim();
  const actorId = await resolveActorId(session.id);

  const theoRes = await pool.query(
    `SELECT COALESCE(stok_teoretis_sekarang, 0) AS theo
     FROM v_ice_stock_reconciliation
     WHERE size = $1::product_size`,
    [size]
  );
  const theoretical_qty = Number(theoRes.rows[0]?.theo ?? actual_qty);

  await pool.query(
    `INSERT INTO ice_opnames (opname_date, size, theoretical_qty, actual_qty, notes, created_by)
     VALUES ($1, $2::product_size, $3, $4, $5, $6)`,
    [opname_date, size, theoretical_qty, actual_qty, notes, actorId]
  );

  redirectWith('success', `Stok opname ${size} (${actual_qty} bks) berhasil disimpan.`);
}

// 7. SIMPAN SERAH TERIMA KAS KE OWNER (KHUSUS OWNER)
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
  await pool.query(
    `INSERT INTO cash_handovers (${cols.join(', ')}) VALUES (${placeholders})`,
    vals
  );

  redirectWith('success', 'Serah terima kas ke Owner berhasil dicatat.');
}