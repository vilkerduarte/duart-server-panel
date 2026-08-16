import type { NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readJournal, listJournalDates } from '@/lib/ai/journal';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Data inválida (use AAAA-MM-DD)' });
  }

  return res.status(200).json({
    success: true,
    data: {
      entries: readJournal({
        date,
        limit: Number(req.query.limit) || 200,
        sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
      }),
      availableDates: listJournalDates(),
    },
  });
});
