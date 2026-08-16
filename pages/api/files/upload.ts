import type { NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';
import formidable from 'formidable';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError, configuredRoots, methodNotAllowed } from '@/lib/api-helpers';

/**
 * Upload de arquivos.
 *
 * A versão anterior fazia parsing de multipart à mão: acumulava o request
 * inteiro em memória como string binária (sem limite de tamanho), e usava o
 * nome de arquivo enviado pelo cliente direto no path.join — então um
 * `filename="../../etc/cron.d/x"` escrevia fora do destino.
 *
 * O formidable já era dependência do projeto e não estava sendo usado.
 */

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 512 * 1024 * 1024;

/** Nome vindo do cliente nunca é caminho: só o basename, sem componentes especiais. */
function safeFileName(raw: string | null | undefined): string {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[\0/]/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return `upload_${Date.now()}`;
  return cleaned.slice(0, 255);
}

/** Estrutura de pastas do upload: aceita subdiretórios, recusa subir de nível. */
function safeRelativePath(raw: string | null | undefined): string {
  const value = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value) return '';
  const parts = value.split('/').filter(p => p && p !== '.' && p !== '..');
  return parts.join('/');
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duart-upload-'));
  const uploaded: Array<{ name: string; path: string; size: number }> = [];

  try {
    const form = formidable({
      multiples: true,
      uploadDir: tempDir,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      maxTotalFileSize: MAX_FILE_SIZE * 4,
    });

    const [fields, files] = await form.parse(req);

    const destPath = firstValue(fields.destPath);
    if (!destPath) {
      return res.status(400).json({ success: false, error: 'Diretório de destino é obrigatório' });
    }

    const roots = configuredRoots();
    const resolvedDest = resolveSafePath(destPath, { allowedRoots: roots });
    const relative = safeRelativePath(firstValue(fields.relativePath));

    const targetDir = relative ? path.join(resolvedDest, relative) : resolvedDest;
    // Revalida: o caminho relativo do cliente não pode empurrar para fora da jaula.
    resolveSafePath(targetDir, { allowedRoots: roots });

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
    }

    const overwrite = firstValue(fields.overwrite) === 'true';

    for (const entry of Object.values(files)) {
      const list = Array.isArray(entry) ? entry : [entry];

      for (const file of list) {
        if (!file) continue;

        const name = safeFileName(file.originalFilename);
        const destination = path.join(targetDir, name);
        resolveSafePath(destination, { allowedRoots: roots });

        if (fs.existsSync(destination) && !overwrite) {
          return res.status(409).json({
            success: false,
            error: `O arquivo ${name} já existe no destino. Reenvie com overwrite=true para substituir.`,
            data: { conflict: name },
          });
        }

        fs.copyFileSync(file.filepath, destination);
        fs.chmodSync(destination, 0o644);
        uploaded.push({ name, path: destination, size: fs.statSync(destination).size });
      }
    }

    return res.status(200).json({
      success: true,
      data: { uploaded: true, files: uploaded, count: uploaded.length, destination: targetDir },
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ETOOBIG' || /maxFileSize|maxTotalFileSize/.test(message)) {
      return res.status(413).json({ success: false, error: 'Arquivo maior que o limite de 512MB' });
    }
    return respondWithError(res, err);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
