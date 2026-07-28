import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyToken, JwtPayload } from '../auth';

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

export function authMiddleware(handler: ApiHandler): ApiHandler {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    // Extract token from cookie or Authorization header
    let token: string | undefined;

    if (req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    const payload: JwtPayload | null = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
    }

    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };

    return handler(req, res);
  };
}
