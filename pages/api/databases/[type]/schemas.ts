import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  const { type } = req.query;

  // Only PostgreSQL supports schemas
  if (type !== 'postgresql') {
    return res.status(400).json({ success: false, error: 'Apenas PostgreSQL suporta schemas' });
  }

  try {
    // GET - List schemas with owners and available users
    if (req.method === 'GET') {
      // List schemas (excluding system schemas)
      const listSchemasCmd = `sudo -u postgres psql -tAc "SELECT nspname, pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' ORDER BY nspname" 2>/dev/null`;

      // List users with login capability
      const listUsersCmd = `sudo -u postgres psql -tAc "SELECT rolname FROM pg_roles WHERE rolcanlogin = true ORDER BY rolname" 2>/dev/null`;

      const [schemasResult, usersResult] = await Promise.all([
        executeRaw(listSchemasCmd, 8000),
        executeRaw(listUsersCmd, 8000),
      ]);

      const schemas = (schemasResult.stdout || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
          const parts = l.split('|');
          return {
            schema_name: (parts[0] || '').trim(),
            owner: (parts[1] || '').trim(),
          };
        })
        .filter(s => s.schema_name);

      const users = (usersResult.stdout || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

      return res.status(200).json({
        success: true,
        data: { schemas, users },
      });
    }

    // POST - Change schema owner
    if (req.method === 'POST') {
      const { action, schema, owner } = req.body;

      if (!action) {
        return res.status(400).json({ success: false, error: 'Ação é obrigatória' });
      }

      if (action === 'change_owner') {
        if (!schema || !owner) {
          return res.status(400).json({ success: false, error: 'Schema e owner são obrigatórios' });
        }

        // Sanitize inputs - PostgreSQL identifiers
        const safeSchema = (schema as string).replace(/[^a-zA-Z0-9_-]/g, '');
        const safeOwner = (owner as string).replace(/[^a-zA-Z0-9_-]/g, '');

        if (safeSchema !== schema || safeOwner !== owner) {
          return res.status(400).json({ success: false, error: 'Nome de schema/owner contém caracteres inválidos' });
        }

        await executeRaw(
          `sudo -u postgres psql -c "ALTER SCHEMA \\"${safeSchema}\\" OWNER TO ${safeOwner}"`,
          10000,
        );

        return res.status(200).json({
          success: true,
          data: { changed: true, schema: safeSchema, owner: safeOwner },
        });
      }

      return res.status(400).json({ success: false, error: 'Ação não suportada' });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
