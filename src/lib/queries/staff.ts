import { pool } from '../db';

export async function getStaffDashboardData(today: string, customerQuery: string) {
  const cleanSearch = customerQuery.trim();

  const [
    iceStockRes,
    plasticStockRes,
    customersRes,
    driversRes,
    searchedReceivablesRes,
    todayProdRes,
    todayDistRes,
    todayExpRes,
    todayPayRes,
    lastOpnameRes,
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
             AND (c.name ILIKE $1 OR COALESCE(c.phone, '') ILIKE $1)
           ORDER BY r.event_date ASC
           LIMIT 15`,
          [`%${cleanSearch}%`]
        )
      : Promise.resolve({ rows: [] }),
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
  ]);

  return {
    iceStock: iceStockRes.rows,
    plasticStock: plasticStockRes.rows,
    customers: customersRes.rows,
    drivers: driversRes.rows,
    searchedReceivables: searchedReceivablesRes.rows,
    todayProductions: todayProdRes.rows,
    todayDistributions: todayDistRes.rows,
    todayExpenses: todayExpRes.rows,
    todayPayments: todayPayRes.rows,
    lastOpnameDate: lastOpnameRes.rows[0]?.last_opname_date || null,
  };
}