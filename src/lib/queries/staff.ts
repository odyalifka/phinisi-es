import { pool } from '../db';

export async function getStaffDashboardData(today: string, customerQuery: string) {
  const cleanSearch = customerQuery.trim();

  const [
    iceStockRes,
    plasticStockRes,
    customersRes,
    driversRes,
    searchedReceivablesRes,
    debtorSummaryRes,
    debtorLogsRes,
    todayProdRes,
    todayDistRes,
    todayExpRes,
    todayPayRes,
    lastOpnameRes,
    todayCashRes,
  ] = await Promise.all([
    pool.query(`
      SELECT size, stok_awal_atau_opname, produksi_layak_jual, produk_jadi_rusak,
             ambil_langsung, diantar_driver, stok_teoretis_sekarang
      FROM v_ice_stock_reconciliation
    `),
    pool.query(`
      SELECT size, stok_awal, pembelian, plastik_terpakai, plastik_kosong_rusak, stok_teoretis
      FROM v_plastic_stock_reconciliation
    `),
    pool.query(`SELECT id, name, phone FROM factory_customers ORDER BY name ASC`),
    pool.query(`SELECT id, name FROM drivers WHERE is_active = TRUE ORDER BY name ASC`),
    cleanSearch.length >= 2
      ? pool.query(
          `SELECT r.id, r.event_date::text AS event_date, c.name AS customer_name, c.phone AS customer_phone,
                  d.size, d.qty, r.total_billed, r.remaining_balance, r.status
           FROM receivables r
           JOIN factory_customers c ON c.id = r.customer_id
           JOIN distributions d ON d.id = r.distribution_id
           WHERE r.status::text IN ('unpaid', 'partial')
             AND r.remaining_balance > 0
             AND (c.name ILIKE $1 OR COALESCE(c.phone, '') ILIKE $1)
           ORDER BY r.event_date ASC
           LIMIT 15`,
          [`%${cleanSearch}%`]
        )
      : Promise.resolve({ rows: [] }),
    pool.query(`
      SELECT
        c.id AS customer_id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        COALESCE(SUM(r.remaining_balance), 0) AS total_remaining_balance,
        COALESCE(SUM(CASE WHEN d.size::text = '5kg' THEN d.qty ELSE 0 END), 0) AS qty_5kg,
        COALESCE(SUM(CASE WHEN d.size::text = '10kg' THEN d.qty ELSE 0 END), 0) AS qty_10kg,
        COALESCE(SUM(CASE WHEN d.size::text = '20kg' THEN d.qty ELSE 0 END), 0) AS qty_20kg,
        COUNT(r.id) AS active_bills_count
      FROM receivables r
      JOIN factory_customers c ON c.id = r.customer_id
      JOIN distributions d ON d.id = r.distribution_id
      WHERE r.status::text IN ('unpaid', 'partial')
        AND r.remaining_balance > 0
        AND d.is_voided = FALSE
      GROUP BY c.id, c.name, c.phone
      HAVING COALESCE(SUM(r.remaining_balance), 0) > 0
      ORDER BY total_remaining_balance DESC, c.name ASC
    `),
    pool.query(`
      SELECT
        r.id AS receivable_id,
        r.customer_id,
        r.event_date::text AS event_date,
        d.size::text AS size,
        d.qty,
        r.total_billed,
        r.remaining_balance,
        (r.total_billed - r.remaining_balance) AS paid_amount,
        r.status::text AS status,
        d.driver_name
      FROM receivables r
      JOIN distributions d ON d.id = r.distribution_id
      WHERE r.status::text IN ('unpaid', 'partial')
        AND r.remaining_balance > 0
        AND d.is_voided = FALSE
      ORDER BY r.event_date DESC, r.created_at DESC
    `),
    pool.query(
      `SELECT id, event_date::text AS event_date, size, gross_qty, damaged_product_qty, good_qty, damaged_plastic_qty, notes, is_voided
       FROM productions
       WHERE event_date = $1::date
       ORDER BY created_at DESC`,
      [today]
    ),
    pool.query(
      `SELECT d.id, d.event_date::text AS event_date, d.dist_type, d.driver_name,
              c.name AS customer_name, d.size, d.qty, d.payment_method, d.is_voided, d.notes
       FROM distributions d
       LEFT JOIN factory_customers c ON c.id = d.customer_id
       WHERE d.event_date = $1::date
       ORDER BY d.created_at DESC`,
      [today]
    ),
    pool.query(
      `SELECT id, expense_date::text AS expense_date, category, description, amount, receipt_url, is_voided
       FROM expenses
       WHERE expense_date = $1::date AND source = 'factory_cash'
       ORDER BY created_at DESC`,
      [today]
    ),
    pool.query(
      `SELECT rp.id, rp.payment_date::text AS payment_date, c.name AS customer_name, rp.amount, rp.method
       FROM receivable_payments rp
       JOIN receivables r ON r.id = rp.receivable_id
       JOIN factory_customers c ON c.id = r.customer_id
       WHERE rp.payment_date = $1::date
       ORDER BY rp.created_at DESC`,
      [today]
    ),
    pool.query(`SELECT MAX(opname_date)::text AS last_opname_date FROM ice_opnames`),
    pool.query(
      `WITH dist_today AS (
         SELECT
           COALESCE(SUM(CASE WHEN payment_method::text = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_sales,
           COALESCE(SUM(CASE WHEN payment_method::text = 'transfer' THEN total_amount ELSE 0 END), 0) AS transfer_sales,
           COALESCE(SUM(CASE WHEN dist_type::text = 'delivery' THEN total_driver_bonus ELSE 0 END), 0) AS driver_bonus_cash_taken
         FROM distributions
         WHERE event_date = $1::date AND is_voided = FALSE
       ),
       rec_today AS (
         SELECT
           COALESCE(SUM(CASE WHEN rp.method::text = 'cash' THEN rp.amount ELSE 0 END), 0) AS cash_receivable_paid,
           COALESCE(SUM(CASE WHEN rp.method::text = 'transfer' THEN rp.amount ELSE 0 END), 0) AS transfer_receivable_paid
         FROM receivable_payments rp
         JOIN receivables r ON r.id = rp.receivable_id
         WHERE rp.payment_date = $1::date AND r.status::text <> 'voided'
       ),
       exp_today AS (
         SELECT COALESCE(SUM(amount), 0) AS cash_expenses
         FROM expenses
         WHERE expense_date = $1::date AND is_voided = FALSE AND source = 'factory_cash'
       )
       SELECT
         (d.cash_sales + r.cash_receivable_paid) AS cash_in_total,
         d.cash_sales,
         r.cash_receivable_paid,
         e.cash_expenses,
         d.driver_bonus_cash_taken,
         (e.cash_expenses + d.driver_bonus_cash_taken) AS cash_out_total,
         ((d.cash_sales + r.cash_receivable_paid) - (e.cash_expenses + d.driver_bonus_cash_taken)) AS cash_to_hold_or_handover,
         (d.transfer_sales + r.transfer_receivable_paid) AS transfer_in_total
       FROM dist_today d, rec_today r, exp_today e`,
      [today]
    ),
  ]);

  const rawCash = todayCashRes.rows[0] || {};

  return {
    iceStock: iceStockRes.rows,
    plasticStock: plasticStockRes.rows,
    customers: customersRes.rows,
    drivers: driversRes.rows,
    searchedReceivables: searchedReceivablesRes.rows,
    debtorSummary: debtorSummaryRes.rows,
    debtorLogs: debtorLogsRes.rows,
    todayProductions: todayProdRes.rows,
    todayDistributions: todayDistRes.rows,
    todayExpenses: todayExpRes.rows,
    todayPayments: todayPayRes.rows,
    lastOpnameDate: lastOpnameRes.rows[0]?.last_opname_date || null,
    cashSummary: {
      cash_in_total: Number(rawCash.cash_in_total || 0),
      cash_sales: Number(rawCash.cash_sales || 0),
      cash_receivable_paid: Number(rawCash.cash_receivable_paid || 0),
      cash_expenses: Number(rawCash.cash_expenses || 0),
      driver_bonus_cash_taken: Number(rawCash.driver_bonus_cash_taken || 0),
      cash_out_total: Number(rawCash.cash_out_total || 0),
      cash_to_hold_or_handover: Number(rawCash.cash_to_hold_or_handover || 0),
      transfer_in_total: Number(rawCash.transfer_in_total || 0),
    },
  };
}