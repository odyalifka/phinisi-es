import crypto from 'crypto';
import { cookies } from 'next/headers';

export type UserRole = 'owner' | 'operator';

export interface UserSession {
  id: string;
  name: string;
  username: string;
  role: UserRole;
}

const COOKIE_NAME = 'phinisi_session';
const SECRET = process.env.AUTH_SECRET || process.env.DATABASE_URL || 'phinisi-es-kristal-makassar-2026';

const ACCOUNTS: Record<string, { password: string; session: UserSession }> = {
  owner: {
    password: process.env.OWNER_PASSWORD || 'owner2026',
    session: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Owner / Pengawas Pabrik',
      username: 'owner',
      role: 'owner',
    },
  },
  operator: {
    password: process.env.OPERATOR_PASSWORD || 'operator2026',
    session: {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Staff Operasional & Gudang',
      username: 'operator',
      role: 'operator',
    },
  },
};

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

export function verifyCredentials(username: string, password: string): UserSession | null {
  const key = username.trim().toLowerCase();
  const account = ACCOUNTS[key];
  if (!account || account.password !== password) return null;
  return account.session;
}

export async function createSessionCookie(session: UserSession) {
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = sign(encoded);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${encoded}.${signature}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature || sign(encoded) !== signature) return null;

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as UserSession;
  } catch {
    return null;
  }
}