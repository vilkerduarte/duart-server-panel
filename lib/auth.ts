import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
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

export interface LoginAttempts {
  [username: string]: {
    attempts: number;
    lastAttempt: string;
    lockedUntil: string | null;
  };
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }
}

export function ensureDataDirs(): void {
  ensureDir(AUTH_DIR);
}

export function readUsers(): UsersData {
  ensureDataDirs();
  if (!fs.existsSync(USERS_FILE)) {
    const defaultData: UsersData = {
      version: 1,
      users: [],
      settings: {
        minPasswordLength: 8,
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 15,
        sessionDurationHours: 24,
      },
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultData, null, 2), { mode: 0o640 });
    return defaultData;
  }
  const raw = fs.readFileSync(USERS_FILE, 'utf-8');
  return JSON.parse(raw);
}

export function writeUsers(data: UsersData): void {
  ensureDataDirs();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), { mode: 0o640 });
}

export function readLoginAttempts(): LoginAttempts {
  ensureDataDirs();
  if (!fs.existsSync(LOGIN_ATTEMPTS_FILE)) {
    return {};
  }
  const raw = fs.readFileSync(LOGIN_ATTEMPTS_FILE, 'utf-8');
  return JSON.parse(raw);
}

export function writeLoginAttempts(data: LoginAttempts): void {
  ensureDataDirs();
  fs.writeFileSync(LOGIN_ATTEMPTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function readSecret(): string {
  ensureDataDirs();
  if (!fs.existsSync(SECRET_FILE)) {
    const secret = randomBytes(64).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
  return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(user: User): string {
  const secret = readSecret();
  const users = readUsers();
  const sessionHours = users.settings.sessionDurationHours || 24;

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, secret, {
    expiresIn: `${sessionHours}h`,
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const secret = readSecret();
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}

export function createInitialAdmin(username: string, password: string): { user: User; token: string } {
  const users = readUsers();

  if (users.users.length > 0) {
    throw new Error('Usuário admin já existe');
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const user: User = {
    id: uuidv4(),
    username,
    passwordHash,
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  users.users.push(user);
  writeUsers(users);

  const token = generateToken(user);

  return { user, token };
}

export function checkLoginAttempts(username: string): { allowed: boolean; waitMinutes?: number } {
  const users = readUsers();
  const attempts = readLoginAttempts();
  const userAttempts = attempts[username];

  if (!userAttempts) return { allowed: true };

  const maxAttempts = users.settings.maxLoginAttempts;
  const lockoutMinutes = users.settings.lockoutDurationMinutes;

  // Check if currently locked
  if (userAttempts.lockedUntil) {
    const lockedUntil = new Date(userAttempts.lockedUntil);
    if (new Date() < lockedUntil) {
      const remainingMs = lockedUntil.getTime() - Date.now();
      return {
        allowed: false,
        waitMinutes: Math.ceil(remainingMs / 60000),
      };
    }
    // Lockout expired, reset
    delete attempts[username];
    writeLoginAttempts(attempts);
    return { allowed: true };
  }

  if (userAttempts.attempts >= maxAttempts) {
    const lockedUntil = new Date(Date.now() + lockoutMinutes * 60000).toISOString();
    attempts[username] = {
      ...userAttempts,
      lockedUntil,
    };
    writeLoginAttempts(attempts);
    return { allowed: false, waitMinutes: lockoutMinutes };
  }

  return { allowed: true };
}

export function recordLoginAttempt(username: string, success: boolean): void {
  const attempts = readLoginAttempts();

  if (success) {
    delete attempts[username];
    // Update lastLoginAt
    const users = readUsers();
    const user = users.users.find(u => u.username === username);
    if (user) {
      user.lastLoginAt = new Date().toISOString();
      writeUsers(users);
    }
  } else {
    const existing = attempts[username] || { attempts: 0, lastAttempt: '', lockedUntil: null };
    attempts[username] = {
      attempts: existing.attempts + 1,
      lastAttempt: new Date().toISOString(),
      lockedUntil: existing.lockedUntil,
    };
  }

  writeLoginAttempts(attempts);
}
