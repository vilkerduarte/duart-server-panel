import type { NextApiRequest, NextApiResponse } from 'next';
import { verifySession, JwtPayload } from '../auth';

export interface AuthenticatedRequest extends NextApiRequest {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export type ApiHandler = (
  req: AuthenticatedRequest,
  res: NextApiResponse
) => void | Promise<void>;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isSecureRequest(req: NextApiRequest): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (proto) return proto.split(',')[0].trim() === 'https';
  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

/**
 * Verificação de origem para métodos que alteram estado.
 *
 * O cookie usa SameSite=Strict, o que já cobre a maior parte do CSRF, mas o
 * painel é servido no mesmo host de sites de terceiros hospedados no servidor —
 * vale a checagem explícita. Requisições sem Origin nem Referer (curl, scripts
 * com Bearer token) passam: elas não são cross-site por definição.
 */
function hasValidOrigin(req: NextApiRequest): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;

  if (!host) return true;
  if (!origin && !referer) return true;

  const source = origin ?? referer!;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

export function authMiddleware(handler: ApiHandler): ApiHandler {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    if (MUTATING_METHODS.has(req.method ?? '') && !hasValidOrigin(req)) {
      return res.status(403).json({ success: false, error: 'Origem da requisição não confere' });
    }

    let token: string | undefined;
    if (req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const session = verifySession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Sessão inválida ou expirada. Faça login novamente.',
      });
    }

    const payload: JwtPayload = session.payload;
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };

    return handler(req, res);
  };
}
