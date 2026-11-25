import { UserSession } from './auth';
import { pool } from './db';

export async function writeAuditLog(params: {
  tableName: string;
  recordId: string;
  actionType: 'INSERT' | 'UPDATE' | 'VOID' | 'PAYMENT' | 'OPNAME';
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  session: UserSession;
  reason: string;
}) {
  const actorLabel = `${params.session.name} (${params.session.username} / ${params.session.role.toUpperCase()})`;
  await pool.query(
    `INSERT INTO audit_logs (table_name, record_id, action_type, old_values, new_values, changed_by, reason)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      params.tableName,
      params.recordId,
      params.actionType,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      actorLabel,
      params.reason,
    ]
  );
}