import type { NextApiResponse } from 'next';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import {
  readApps, updateApps, detectPythonVersions, createVenv, installDependencies,
  applyApp, removeApp, restartApp, reloadApp, stopApp, appStatus, appLogs,
  runInVenv, socketPathFor, unitName, venvPathFor, isValidAppName,
  suggestedWorkers, PythonApp, hasUv,
} from '@/lib/python';
import { resolveSafePath } from '@/lib/paths';
import { respondWithError } from '@/lib/api-helpers';

/**
 * Aplicações Python supervisionadas pelo systemd.
 *
 * O PM2 continua disponível para quem já usa, mas apps de produção passam a ser
 * units do systemd: sobrevivem a reboot sem depender do PATH do nvm, fazem
 * reload gracioso via SIGHUP no gunicorn (deploy sem derrubar conexão) e
 * entregam log no journal.
 */
export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  try {
    /* ---------------------------- GET ---------------------------- */

    if (req.method === 'GET') {
      const name = typeof req.query.name === 'string' ? req.query.name : null;

      if (name) {
        const app = readApps().find(a => a.name === name);
        if (!app) return res.status(404).json({ success: false, error: 'Aplicação não encontrada' });

        return res.status(200).json({
          success: true,
          data: {
            ...app,
            status: await appStatus(app),
            socket: socketPathFor(app),
            unit: unitName(app),
            logs: await appLogs(app, 200),
          },
        });
      }

      const apps = readApps();
      return res.status(200).json({
        success: true,
        data: {
          apps: await Promise.all(apps.map(async app => ({
            ...app,
            status: await appStatus(app),
            socket: socketPathFor(app),
            unit: unitName(app),
          }))),
          pythonVersions: await detectPythonVersions(),
          hasUv: await hasUv(),
          suggestedWorkers: suggestedWorkers(),
        },
      });
    }

    /* ---------------------------- POST --------------------------- */

    if (req.method === 'POST') {
      const { name, directory, module, framework, pythonBin, workers, threads, timeout, env, user } = req.body ?? {};

      if (!name || !directory || !module) {
        return res.status(400).json({ success: false, error: 'Nome, diretório e módulo são obrigatórios' });
      }
      if (!isValidAppName(name)) {
        return res.status(400).json({
          success: false,
          error: 'Nome inválido — use letras minúsculas, números, hífen e underscore (até 31 caracteres)',
        });
      }
      if (!/^[A-Za-z_][\w.]*(:[A-Za-z_]\w*)?$/.test(String(module))) {
        return res.status(400).json({
          success: false,
          error: 'Módulo inválido. Formato esperado: "app:app" ou "meuprojeto.wsgi:application"',
        });
      }
      if (readApps().some(a => a.name === name)) {
        return res.status(409).json({ success: false, error: 'Já existe uma aplicação com esse nome' });
      }

      const appDir = resolveSafePath(String(directory));
      if (!fs.existsSync(appDir)) {
        return res.status(400).json({ success: false, error: `Diretório não encontrado: ${appDir}` });
      }

      const versions = await detectPythonVersions();
      const chosenBin = pythonBin || versions[versions.length - 1]?.bin;
      if (!chosenBin) {
        return res.status(400).json({ success: false, error: 'Nenhum Python 3 encontrado neste servidor' });
      }

      const app: PythonApp = {
        id: randomUUID(),
        name: String(name),
        directory: appDir,
        module: String(module),
        framework: framework === 'asgi' ? 'asgi' : 'wsgi',
        pythonBin: chosenBin,
        venvPath: venvPathFor(appDir),
        workers: Number(workers) > 0 ? Number(workers) : suggestedWorkers(),
        threads: Number(threads) > 0 ? Number(threads) : undefined,
        timeout: Number(timeout) > 0 ? Number(timeout) : 60,
        // O grupo www-data com umask 007 deixa o socket acessível ao NGINX e a
        // mais ninguém.
        user: user && /^[a-z_][a-z0-9_-]*$/.test(user) ? user : `app_${name}`.substring(0, 31),
        group: 'www-data',
        env: typeof env === 'object' && env ? env : {},
        autoStart: true,
        createdAt: new Date().toISOString(),
      };

      const venv = await createVenv(app.directory, app.pythonBin);
      if (!venv.ok) return res.status(400).json({ success: false, error: `Falha ao criar o ambiente virtual: ${venv.output}` });

      const deps = await installDependencies(app);
      if (!deps.ok) {
        return res.status(400).json({
          success: false,
          error: `Falha ao instalar dependências: ${deps.output.substring(0, 800)}`,
        });
      }

      const applied = await applyApp(app);
      if (!applied.ok) return res.status(400).json({ success: false, error: applied.error });

      await updateApps(apps => [...apps, app]);

      return res.status(200).json({
        success: true,
        data: { app, socket: socketPathFor(app), unit: unitName(app), status: await appStatus(app) },
      });
    }

    /* ---------------------------- PATCH -------------------------- */

    if (req.method === 'PATCH') {
      const { name, action, command } = req.body ?? {};
      const app = readApps().find(a => a.name === name);
      if (!app) return res.status(404).json({ success: false, error: 'Aplicação não encontrada' });

      switch (action) {
        case 'restart': {
          const result = await restartApp(app);
          return result.ok
            ? res.status(200).json({ success: true, data: { status: await appStatus(app) } })
            : res.status(400).json({ success: false, error: result.output });
        }
        case 'reload': {
          const result = await reloadApp(app);
          return result.ok
            ? res.status(200).json({ success: true, data: { status: await appStatus(app) } })
            : res.status(400).json({ success: false, error: result.output });
        }
        case 'stop': {
          const result = await stopApp(app);
          return result.ok
            ? res.status(200).json({ success: true, data: { status: await appStatus(app) } })
            : res.status(400).json({ success: false, error: result.output });
        }
        case 'reinstall': {
          const deps = await installDependencies(app);
          if (!deps.ok) return res.status(400).json({ success: false, error: deps.output.substring(0, 800) });
          const applied = await applyApp(app);
          return applied.ok
            ? res.status(200).json({ success: true, data: { reinstalled: true } })
            : res.status(400).json({ success: false, error: applied.error });
        }
        case 'run': {
          // Migrations, collectstatic, shell — dentro do venv da aplicação.
          if (!Array.isArray(command) || !command.length) {
            return res.status(400).json({ success: false, error: 'Informe o comando como array (ex.: ["python","manage.py","migrate"])' });
          }
          const result = await runInVenv(app, command.map(String));
          return res.status(200).json({ success: true, data: result });
        }
        default:
          return res.status(400).json({ success: false, error: `Ação desconhecida: ${action}` });
      }
    }

    /* --------------------------- DELETE -------------------------- */

    if (req.method === 'DELETE') {
      const name = String(req.query.name ?? '');
      const app = readApps().find(a => a.name === name);
      if (!app) return res.status(404).json({ success: false, error: 'Aplicação não encontrada' });

      await removeApp(app);
      await updateApps(apps => apps.filter(a => a.name !== name));

      return res.status(200).json({ success: true, data: { removed: name } });
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
  } catch (err) {
    return respondWithError(res, err);
  }
});
