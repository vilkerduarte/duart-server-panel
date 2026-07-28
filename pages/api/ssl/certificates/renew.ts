import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeCommand } from '@/lib/system';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERTS_FILE = path.join(SSL_DIR, 'certificates.json');

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: 'ID do certificado é obrigatório' });
  }

  try {
    if (!fs.existsSync(CERTS_FILE)) {
      return res.status(404).json({ success: false, error: 'Nenhum certificado registrado' });
    }

    const data = JSON.parse(fs.readFileSync(CERTS_FILE, 'utf-8'));
    const certs = data.certificates || [];
    const index = certs.findIndex((c: any) => c.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Certificado não encontrado' });
    }

    const cert = certs[index];

    if (cert.type !== 'letsencrypt') {
      return res.status(400).json({
        success: false,
        error: 'Apenas certificados Let\'s Encrypt podem ser renovados automaticamente',
      });
    }

    // Run certbot renew
    const result = await executeCommand('certbot_renew');

    if (result.code !== 0) {
      return res.status(400).json({
        success: false,
        error: 'Falha na renovação: ' + (result.stderr || result.stdout),
      });
    }

    // Update validity
    const newValidUntil = new Date(Date.now() + 90 * 86400000).toISOString();
    certs[index].validUntil = newValidUntil;
    certs[index].updatedAt = new Date().toISOString();

    fs.writeFileSync(CERTS_FILE, JSON.stringify({ certificates: certs }, null, 2));

    // Reload NGINX to pick up renewed certs
    try {
      await executeCommand('nginx_reload');
    } catch {}

    return res.status(200).json({
      success: true,
      data: { renewed: true, newValidUntil },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
