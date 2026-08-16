import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { readJson, writeJson, ensureDir, writeFileAtomic } from './fsx';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const USERS_FILE = path.join(AUTH_DIR, 'users.json');
const SECRET_FILE = path.join(AUTH_DIR, '.secret');
const LOGIN_ATTEMPTS_FILE = path.join(AUTH_DIR, 'login_attempts.json');

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin';
  createdAt: string;
  lastLoginAt?: string;
  /**
   * Incrementado a cada troca de senha. O token carrega a versão vigente no
   * momento da emissão, então trocar a senha invalida as sessões abertas —
   * antes elas continuavam válidas por 24h, que é justamente o que se quer
   * cortar ao suspeitar de vazamento.
   */
  tokenVersion?: number;
}

export interface UsersData {
  version: number;
  users: User[];
  settings: {
    minPasswordLength: number;
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
    sessionDurationHours: number;
  };
}

interface AttemptRecord {
  attempts: number;
  lastAttempt: string;
  lockedUntil: string | null;
}

export interface LoginAttempts {
  [key: string]: AttemptRecord;
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  tv: number;
  iat: number;
  exp: number;
}

const DEFAULT_USERS: UsersData = {
  version: 1,
  users: [],
  settings: {
    minPasswordLength: 8,
    maxLoginAttempts: 5,
    lockoutDurationMinutes: 15,
    sessionDurationHours: 24,
  },
};

export function ensureDataDirs(): void {
  ensureDir(AUTH_DIR, 0o750);
}

export function readUsers(): UsersData {
  ensureDataDirs();
  const stored = readJson<UsersData>(USERS_FILE, DEFAULT_USERS);
  return {
    ...DEFAULT_USERS,
    ...stored,
    settings: { ...DEFAULT_USERS.settings, ...(stored.settings ?? {}) },
  };
}

export function writeUsers(data: UsersData): void {
  ensureDataDirs();
  writeJson(USERS_FILE, data, 0o600);
}

export function readLoginAttempts(): LoginAttempts {
  ensureDataDirs();
  return readJson<LoginAttempts>(LOGIN_ATTEMPTS_FILE, {});
}

export function writeLoginAttempts(data: LoginAttempts): void {
  ensureDataDirs();
  writeJson(LOGIN_ATTEMPTS_FILE, data, 0o600);
}

export function readSecret(): string {
  ensureDataDirs();
  if (!fs.existsSync(SECRET_FILE)) {
    const secret = randomBytes(64).toString('hex');
    writeFileAtomic(SECRET_FILE, secret, 0o600);
    return secret;
  }
  return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export function generateToken(user: User): string {
  const secret = readSecret();
  const sessionHours = readUsers().settings.sessionDurationHours || 24;

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    username: user.username,
    role: user.role,
    tv: user.tokenVersion ?? 0,
  };

  return jwt.sign(payload, secret, { expiresIn: `${sessionHours}h` });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, readSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Valida o token e confere se ele ainda corresponde à versão atual do usuário.
 * `verifyToken` sozinho só garante a assinatura — não sabe se a senha mudou.
 */
export function verifySession(token: string): { payload: JwtPayload; user: User } | null {
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = readUsers().users.find(u => u.id === payload.sub);
  if (!user) return null;
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) return null;

  return { payload, user };
}

export function bumpTokenVersion(username: string): number {
  const users = readUsers();
  const user = users.users.find(u => u.username === username);
  if (!user) return 0;

  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  writeUsers(users);
  return user.tokenVersion;
}

export function createInitialAdmin(username: string, password: string): { user: User; token: string } {
  const users = readUsers();
  if (users.users.length > 0) {
    throw new Error('Usuário admin já existe');
  }

  const user: User = {
    id: uuidv4(),
    username,
    passwordHash: bcrypt.hashSync(password, 12),
    role: 'admin',
    createdAt: new Date().toISOString(),
    tokenVersion: 0,
  };

  users.users.push(user);
  writeUsers(users);

  return { user, token: generateToken(user) };
}

/* ------------------------------------------------------------------ */
/*  Cookies de sessão                                                  */
/* ------------------------------------------------------------------ */

/**
 * O cookie antigo não tinha `Secure`, e o painel passa toda a instalação em
 * HTTP — que é exatamente quando a senha de admin é criada. Aqui o flag é
 * ligado assim que a requisição chega por HTTPS (direto ou via proxy).
 */
export function buildSessionCookie(token: string, isSecure: boolean, maxAgeSeconds = 86400): string {
  const parts = [`token=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAgeSeconds}`];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(isSecure: boolean): string {
  return buildSessionCookie('', isSecure, 0);
}

/* ------------------------------------------------------------------ */
/*  Proteção contra força bruta                                        */
/* ------------------------------------------------------------------ */

const ATTEMPT_TTL_MS = 24 * 3600 * 1000;

function ipKey(ip?: string): string | null {
  if (!ip) return null;
  return `ip:${ip.replace(/^::ffff:/, '')}`;
}

/** Remove registros antigos; sem isso o arquivo cresce sem limite. */
function prune(attempts: LoginAttempts): LoginAttempts {
  const cutoff = Date.now() - ATTEMPT_TTL_MS;
  const pruned: LoginAttempts = {};

  for (const [key, record] of Object.entries(attempts)) {
    const last = new Date(record.lastAttempt).getTime();
    const locked = record.lockedUntil ? new Date(record.lockedUntil).getTime() : 0;
    if (Number.isFinite(last) && last < cutoff && locked < Date.now()) continue;
    pruned[key] = record;
  }

  return pruned;
}

function evaluate(record: AttemptRecord | undefined, maxAttempts: number, lockoutMinutes: number) {
  if (!record) return { allowed: true as const };

  if (record.lockedUntil) {
    const until = new Date(record.lockedUntil).getTime();
    if (Date.now() < until) {
      return { allowed: false as const, waitMinutes: Math.ceil((until - Date.now()) / 60000) };
    }
  }

  if (record.attempts >= maxAttempts) {
    return { allowed: false as const, waitMinutes: lockoutMinutes, shouldLock: true };
  }

  return { allowed: true as const };
}

/**
 * Limite por usuário e por IP.
 *
 * O bloqueio antigo contava só por nome de usuário, então quem variava o nome
 * não era limitado por nada — a proteção não cobria o ataque mais comum, que é
 * varrer nomes prováveis contra uma senha.
 */
export function checkLoginAttempts(username: string, ip?: string): { allowed: boolean; waitMinutes?: number } {
  const users = readUsers();
  const attempts = prune(readLoginAttempts());

  const maxAttempts = users.settings.maxLoginAttempts;
  const lockoutMinutes = users.settings.lockoutDurationMinutes;
  // O limite por IP é mais folgado: várias pessoas podem sair pelo mesmo NAT.
  const maxByIp = maxAttempts * 4;

  const byUser = evaluate(attempts[`user:${username}`], maxAttempts, lockoutMinutes);
  const key = ipKey(ip);
  const byIp = key ? evaluate(attempts[key], maxByIp, lockoutMinutes) : { allowed: true as const };

  let changed = false;
  if (!byUser.allowed && 'shouldLock' in byUser && byUser.shouldLock) {
    attempts[`user:${username}`] = {
      ...attempts[`user:${username}`],
      lockedUntil: new Date(Date.now() + lockoutMinutes * 60000).toISOString(),
    };
    changed = true;
  }
  if (key && !byIp.allowed && 'shouldLock' in byIp && byIp.shouldLock) {
    attempts[key] = {
      ...attempts[key],
      lockedUntil: new Date(Date.now() + lockoutMinutes * 60000).toISOString(),
    };
    changed = true;
  }

  if (changed) writeLoginAttempts(attempts);

  if (!byUser.allowed) return byUser;
  if (!byIp.allowed) return byIp;
  return { allowed: true };
}

export function recordLoginAttempt(username: string, success: boolean, ip?: string): void {
  const attempts = prune(readLoginAttempts());
  const key = ipKey(ip);
  const now = new Date().toISOString();

  if (success) {
    delete attempts[`user:${username}`];
    if (key) delete attempts[key];

    const users = readUsers();
    const user = users.users.find(u => u.username === username);
    if (user) {
      user.lastLoginAt = now;
      writeUsers(users);
    }
  } else {
    for (const entryKey of [`user:${username}`, key].filter(Boolean) as string[]) {
      const existing = attempts[entryKey] ?? { attempts: 0, lastAttempt: now, lockedUntil: null };
      attempts[entryKey] = {
        attempts: existing.attempts + 1,
        lastAttempt: now,
        lockedUntil: existing.lockedUntil,
      };
    }
  }

  writeLoginAttempts(attempts);
}
