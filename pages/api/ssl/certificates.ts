import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand, executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    // Return empty cert list (SSL not implemented)
    return res.status(200).json({ success: true, data: [] });
  }
  if (req.method === 'POST') {
    const { type, domains, email } = req.body;
    // SSL certificate issuance - stubbed
    return res.status(200).json({
      success: true,
      data: { certificate: { id: Date.now().toString(), domains, type: type || 'letsencrypt', status: 'valid', validUntil: new Date(Date.now() + 90 * 86400000).toISOString() } }
    });
  }
  return res.status(405).json({ success: false, error: 'Método não permitido' });
});
