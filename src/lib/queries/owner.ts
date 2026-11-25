import { pool } from '../db';

export type PeriodMode = 'daily' | 'weekly' | 'monthly';

export function resolveDateRange(mode: PeriodMode, refDate: string): { start: string; end: string; label: string } {
  const base = new Date(`${refDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return { start: refDate, end: refDate, label: `Harian (${refDate})` };
  }

  if (mode === 'monthly') {
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    const first = new Date(Date.UTC(y, m, 1)).toISOString().split('T')[0];
    const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().split('T')[0];
    return { start: first, end: last, label: `Bulanan (${first} s/d ${last})` };
  }

  if (mode === 'weekly') {
    const day = base.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(base);
    monday.setUTCDate(base.getUTCDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const start = monday.toISOString().split('T')[0];
    const end = sunday.toISOString().split('T')[0];
    return { start, end, label: `Mingguan (${start} s/d ${end})` };
  }

  return { start: refDate, end: refDate, label: `Harian (${refDate})` };
}

export async function getOwnerReportPeriodData(start: string, end: string) {
  const [prodRes, distRes, recPeriodRes, payPeriodRes, expPeriodRes, bonusPeriodRes, handoverPeriodRes] =
    await Promise.all([
      pool.query(
        `SELECT size,
                COALESCE(SUM(gross_qty), 0)::integer AS gross_qty,
                COALESCE(SUM(damaged_product_qty), 0)::integer AS damaged_product_qty,
                COALESCE(SUM(good_qty), 0)::integer AS good_qty,
                COALESCE(SUM(damaged_plastic_qty), 0)::integer AS damaged_plastic_qty,
                COALESCE(SUM(plastic_total_cost), 0)::numeric AS plastic_cost
         FROM productions
         WHERE event_date BETWEEN $1::date AND $2::date AND is_voided = FALSE
         GROUP BY size
         ORDER BY size`,
        [start, end]
      ),
      pool.query(
        `SELECT dist_type, payment_method, size,
                COALESCE(SUM(qty), 0)::integer AS total_qty,
                COALESCE(SUM(total_amount), 0)::numeric AS total_omzet,
                COALESCE(SUM(total_driver_bonus), 0)::numeric AS total_bonus
         FROM distributions
         WHERE event_date BETWEEN $1::date AND $2::date AND is_voided = FALSE
         GROUP BY dist_type, payment_method, size
         ORDER BY dist_type, size`,
        [start, end]
      ),
      pool.query(
        `SELECT r.id, r.event_date::text AS event_date, c.name AS customer_name, d.size, d.qty,
                r.total_billed, r.remaining_balance, r.status
         FROM receivables r
         JOIN factory_customers c ON c.id = r.customer_id
         JOIN distributions d ON d.id = r.distribution_id
         WHERE r.event_date BETWEEN $1::date AND $2::date AND r.status::text <> 'voided'
         ORDER BY r.event_date DESC`,
        [start, end]
      ),
      pool.query(
        `SELECT rp.id, rp.payment_date::text AS payment_date, r.event_date::text AS receivable_date,
                c.name AS customer_name, rp.amount, rp.method, rp.notes
         FROM receivable_payments rp
         JOIN receivables r ON r.id = rp.receivable_id
         JOIN factory_customers c ON c.id = r.customer_id
         WHERE rp.payment_date BETWEEN $1::date AND $2::date AND r.status::text <> 'voided'
         ORDER BY rp.payment_date DESC, rp.created_at DESC`,
        [start, end]
      ),
      pool.query(
        `SELECT id, expense_date::text AS expense_date, category, description, amount, source, receipt_url
         FROM expenses
         WHERE expense_date BETWEEN $1::date AND $2::date AND is_voided = FALSE
         ORDER BY expense_date DESC, created_at DESC`,
        [start, end]
      ),
      pool.query(
        `SELECT COALESCE(driver_name, 'Tanpa Nama') AS driver_name,
                COUNT(*)::integer AS trip_count,
                COALESCE(SUM(total_driver_bonus), 0)::numeric AS total_bonus,
                COALESCE(SUM(CASE WHEN bonus_status = 'paid' THEN total_driver_bonus ELSE 0 END), 0)::numeric AS paid_bonus,
                COALESCE(SUM(CASE WHEN bonus_status = 'unpaid' THEN total_driver_bonus ELSE 0 END), 0)::numeric AS unpaid_bonus
         FROM distributions
         WHERE event_date BETWEEN $1::date AND $2::date AND is_voided = FALSE AND dist_type = 'delivery'
         GROUP BY COALESCE(driver_name, 'Tanpa Nama')
         ORDER BY total_bonus DESC`,
        [start, end]
      ),
      pool.query(
        `SELECT id, handover_date::text AS handover_date, amount_handed_over, balance_before, balance_after, notes
         FROM cash_handovers
         WHERE handover_date BETWEEN $1::date AND $2::date
         ORDER BY handover_date DESC, created_at DESC`,
        [start, end]
      ),
    ]);

  let penjualanTunai = 0;
  let penjualanTransfer = 0;
  let penjualanPiutang = 0;
  let totalBonusTerbentuk = 0;
  let totalBksTerjual = 0;

  for (const d of distRes.rows) {
    const omzet = Number(d.total_omzet || 0);
    totalBksTerjual += Number(d.total_qty || 0);
    totalBonusTerbentuk += Number(d.total_bonus || 0);
    if (d.payment_method === 'cash') penjualanTunai += omzet;
    else if (d.payment_method === 'transfer') penjualanTransfer += omzet;
    else if (d.payment_method === 'receivable') penjualanPiutang += omzet;
  }
  const pendapatanPenjualan = penjualanTunai + penjualanTransfer + penjualanPiutang;

  let bayarPiutangTunai = 0;
  let bayarPiutangTransfer = 0;
  for (const p of payPeriodRes.rows) {
    const amt = Number(p.amount || 0);
    if (p.method === 'cash') bayarPiutangTunai += amt;
    else bayarPiutangTransfer += amt;
  }

  const penerimaanTunaiTotal = penjualanTunai + bayarPiutangTunai;
  const penerimaanTransferTotal = penjualanTransfer + bayarPiutangTransfer;

  let pengeluaranKasPabrik = 0;
  let biayaDibayarOwner = 0;
  let pengeluaranTransferLain = 0;
  for (const e of expPeriodRes.rows) {
    const amt = Number(e.amount || 0);
    if (e.source === 'factory_cash') pengeluaranKasPabrik += amt;
    else if (e.source === 'owner_direct') biayaDibayarOwner += amt;
    else pengeluaranTransferLain += amt;
  }
  const totalPengeluaranOperasional = pengeluaranKasPabrik + biayaDibayarOwner + pengeluaranTransferLain;

  const hppPlastik = prodRes.rows.reduce((sum, r) => sum + Number(r.plastic_cost || 0), 0);
  const bonusSudahDibayar = bonusPeriodRes.rows.reduce((sum, r) => sum + Number(r.paid_bonus || 0), 0);
  const bonusKewajibanBelumDibayar = bonusPeriodRes.rows.reduce((sum, r) => sum + Number(r.unpaid_bonus || 0), 0);
  const penyerahanKeOwner = handoverPeriodRes.rows.reduce((sum, r) => sum + Number(r.amount_handed_over || 0), 0);

  const keuntunganBersih =
    pendapatanPenjualan - hppPlastik - totalPengeluaranOperasional - totalBonusTerbentuk;

  return {
    productions: prodRes.rows,
    distributions: distRes.rows,
    receivables: recPeriodRes.rows,
    payments: payPeriodRes.rows,
    expenses: expPeriodRes.rows,
    bonuses: bonusPeriodRes.rows,
    handovers: handoverPeriodRes.rows,
    metrics: {
      totalBksTerjual,
      penjualanTunai,
      penjualanTransfer,
      penjualanPiutang,
      pendapatanPenjualan,
      bayarPiutangTunai,
      bayarPiutangTransfer,
      penerimaanTunaiTotal,
      penerimaanTransferTotal,
      pengeluaranKasPabrik,
      biayaDibayarOwner,
      pengeluaranTransferLain,
      totalPengeluaranOperasional,
      hppPlastik,
      totalBonusTerbentuk,
      bonusSudahDibayar,
      bonusKewajibanBelumDibayar,
      penyerahanKeOwner,
      keuntunganBersih,
    },
  };
}

export async function getOwnerDashboardData(mode: PeriodMode, refDate: string) {
  const range = resolveDateRange(mode, refDate);

  const [
    cashRes,
    iceStockRes,
    plasticStockRes,
    plasticOpnameHistRes,
    plasticPurchaseHistRes,
    iceOpnameHistRes,
    customersRes,
    allReceivablesRes,
    unpaidBonusRes,
    recentDistRes,
    recentProdRes,
    recentExpRes,
    auditLogsRes,
    periodReport,
  ] = await Promise.all([
    pool.query(`SELECT * FROM v_factory_cash_summary`),
    pool.query(`SELECT * FROM v_ice_stock_reconciliation`),
    pool.query(`SELECT * FROM v_plastic_stock_reconciliation`),
    pool.query(`
      SELECT DISTINCT ON (size) size, opname_date::text AS opname_date, theoretical_qty, actual_qty, notes
      FROM plastic_opnames
      ORDER BY size, created_at DESC
    `),
    pool.query(`
      SELECT id, purchase_date::text AS purchase_date, size, qty, unit_price, total_cost, wac_after, supplier_name
      FROM plastic_purchases
      WHERE is_voided = FALSE
      ORDER BY created_at DESC
      LIMIT 8
    `),
    pool.query(`
      SELECT DISTINCT ON (size) size, opname_date::text AS opname_date, theoretical_qty, actual_qty, notes
      FROM ice_opnames
      ORDER BY size, created_at DESC
    `),
    pool.query(`SELECT id, name, phone FROM factory_customers ORDER BY name ASC`),
    pool.query(`
      SELECT r.id, r.event_date::text AS event_date, c.name AS customer_name, c.phone AS customer_phone,
             d.size, d.qty, r.total_billed, r.remaining_balance, r.status
      FROM receivables r
      JOIN factory_customers c ON c.id = r.customer_id
      JOIN distributions d ON d.id = r.distribution_id
      WHERE r.status::text IN ('unpaid', 'partial')
      ORDER BY r.event_date ASC
      LIMIT 30
    `),
    pool.query(`
      SELECT COALESCE(driver_name, 'Tanpa Nama Driver') AS driver_name,
             COUNT(*)::integer AS jumlah_antar,
             COALESCE(SUM(total_driver_bonus), 0)::numeric AS total_bonus
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
      LIMIT 12
    `),
    pool.query(`
      SELECT id, event_date::text AS event_date, size, gross_qty, damaged_product_qty, good_qty,
             damaged_plastic_qty, plastic_total_cost, notes, is_voided
      FROM productions
      ORDER BY created_at DESC
      LIMIT 12
    `),
    pool.query(`
      SELECT id, expense_date::text AS expense_date, category, description, amount, source, receipt_url, is_voided
      FROM expenses
      ORDER BY created_at DESC
      LIMIT 12
    `),
    pool.query(`
      SELECT id, table_name, record_id, action_type, old_values, new_values, changed_by,
             to_char(changed_at AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD HH24:MI:SS') AS waktu_wita,
             reason
      FROM audit_logs
      ORDER BY changed_at DESC
      LIMIT 20
    `),
    getOwnerReportPeriodData(range.start, range.end),
  ]);

  return {
    range,
    cash: cashRes.rows[0] || {
      total_uang_tunai_masuk: 0,
      total_uang_tunai_keluar: 0,
      saldo_kas_pabrik_sekarang: 0,
      kewajiban_bonus_driver_belum_dibayar: 0,
      aman_diserahkan_ke_owner: 0,
    },
    iceStock: iceStockRes.rows,
    plasticStock: plasticStockRes.rows,
    latestPlasticOpnames: plasticOpnameHistRes.rows,
    plasticPurchases: plasticPurchaseHistRes.rows,
    latestIceOpnames: iceOpnameHistRes.rows,
    customers: customersRes.rows,
    allReceivables: allReceivablesRes.rows,
    unpaidBonuses: unpaidBonusRes.rows,
    recentDistributions: recentDistRes.rows,
    recentProductions: recentProdRes.rows,
    recentExpenses: recentExpRes.rows,
    auditLogs: auditLogsRes.rows,
    periodReport,
  };
}