import OwnerDashboard from '@/components/OwnerDashboard';
import StaffDashboard from '@/components/StaffDashboard';
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';
import { getOwnerDashboardData, PeriodMode } from '@/lib/queries/owner';
import { getStaffDashboardData } from '@/lib/queries/staff';
import { connection } from 'next/server';
import { loginAction } from './actions';

export const instant = false;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    date?: string;
    cari_pelanggan?: string;
    error?: string;
    success?: string;
  }>;
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

  const dateRes = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const today: string = dateRes.rows[0]?.today || '2026-11-25';

  if (session.role === 'owner') {
    const modeParam = (params.mode || 'daily') as PeriodMode;
    const mode: PeriodMode = ['daily', 'weekly', 'monthly'].includes(modeParam) ? modeParam : 'daily';
    const refDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
    const ownerData = await getOwnerDashboardData(mode, refDate);

    return (
      <OwnerDashboard
        session={session}
        today={today}
        mode={mode}
        refDate={refDate}
        data={ownerData}
        errorMsg={params.error}
        successMsg={params.success}
      />
    );
  }

  const customerQuery = params.cari_pelanggan || '';
  const staffData = await getStaffDashboardData(today, customerQuery);

  return (
    <StaffDashboard
      session={session}
      today={today}
      customerQuery={customerQuery}
      data={staffData}
      errorMsg={params.error}
      successMsg={params.success}
    />
  );
}