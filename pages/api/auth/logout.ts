import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSessionCookie } from '@/lib/auth';
import { isSecureRequest } from '@/lib/middleware/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  res.setHeader('Set-Cookie', clearSessionCookie(isSecureRequest(req)));
  return res.status(200).json({ success: true });
}
