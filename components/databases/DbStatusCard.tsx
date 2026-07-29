import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Spinner from '@/components/ui/Spinner';
import {
  HiOutlinePlus, HiOutlineTrash, HiOutlineKey, HiOutlineCircleStack,
  HiOutlineUser, HiOutlineFolderOpen, HiOutlineArrowUpTray,
  HiOutlineCheck, HiOutlineXMark, HiOutlineArrowPath,
  HiOutlineUsers, HiOutlineExclamationTriangle,
  HiOutlineShieldCheck, HiOutlineCommandLine, HiOutlinePlay,
} from 'react-icons/hi2';

interface DbUser {
  user: string;
  host: string;
}

interface DbSchema {
  schema_name: string;
  owner: string;
}

interface DbStatusCardProps {
  name: string;
  type: string;
  installed: boolean;
  running: boolean;
  version: string;
  port: number;
  databases: string[];
  users: DbUser[];
  onInstall: () => void;
  onRefresh: () => void;
}

export default function DbStatusCard({
  name, type, installed, running, version, port, databases, users, onInstall, onRefresh,
}: DbStatusCardProps) {
  const [activeTab, setActiveTab] = useState<'databases' | 'users' | 'root' | 'schemas' | 'console'>('databases');

  // Database state
  const [showNewDb, setShowNewDb] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [dbToDelete, setDbToDelete] = useState<string | null>(null);
  const [creatingDb, setCreatingDb] = useState(false);

  // Import SQL state
  const [showImport, setShowImport] = useState(false);
  const [importDbName, setImportDbName] = useState('');
  const [importFilePath, setImportFilePath] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFileSize, setImportFileSize] = useState(0);
  const [importStartTime, setImportStartTime] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importComplete, setImportComplete] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);

  // User state
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserDb, setNewUserDb] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userToDelete, setUserToDelete] = useState<DbUser | null>(null);

  // Password change state
  const [showUserPassword, setShowUserPassword] = useState<DbUser | null>(null);
  const [userNewPassword, setUserNewPassword] = useState('');
  const [changingUserPassword, setChangingUserPassword] = useState(false);

  // Root password state
  const [showRootPassword, setShowRootPassword] = useState(false);
  const [rootNewPassword, setRootNewPassword] = useState('');
  const [changingRootPassword, setChangingRootPassword] = useState(false);

  // Schemas state (PostgreSQL only)
  const [schemas, setSchemas] = useState<DbSchema[]>([]);
  const [schemaUsers, setSchemaUsers] = useState<string[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [changingSchemaOwner, setChangingSchemaOwner] = useState<string | null>(null);

  // SQL Console state (MySQL & PostgreSQL only)
  const [sqlQuery, setSqlQuery] = useState('');
  const [sqlExecuting, setSqlExecuting] = useState(false);
  const [sqlResult, setSqlResult] = useState<{ success: boolean; output: string } | null>(null);
  const [sqlHistory, setSqlHistory] = useState<{ query: string; success: boolean; output: string }[]>([]);

  // Feedback
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const showFeedback = (success: boolean, message: string) => {
    setFeedback({ success, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Fetch schemas for PostgreSQL
  const fetchSchemas = () => {
    if (type !== 'postgresql' || !running) return;
    setLoadingSchemas(true);
    fetch(`/api/databases/${type}/schemas`)
      .then(r => r.json())
      .then(j => {
        if (j.success) {
          setSchemas(j.data.schemas || []);
          setSchemaUsers(j.data.users || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSchemas(false));
  };

  // Load schemas when switching to schemas tab or on mount
  useEffect(() => {
    if (activeTab === 'schemas' && type === 'postgresql' && running) {
      fetchSchemas();
    }
  }, [activeTab, type, running]);

  // Change schema owner
  const handleChangeSchemaOwner = async (schemaName: string, newOwner: string) => {
    if (!schemaName || !newOwner) return;
    setChangingSchemaOwner(schemaName);
    try {
      const resp = await fetch(`/api/databases/${type}/schemas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_owner', schema: schemaName, owner: newOwner }),
      });
      const data = await resp.json();
      if (data.success) {
        showFeedback(true, `Owner do schema "${schemaName}" alterado para "${newOwner}"`);
        fetchSchemas();
      } else {
        showFeedback(false, data.error || 'Erro ao alterar owner do schema');
      }
    } catch {
      showFeedback(false, 'Erro de conexão');
    }
    setChangingSchemaOwner(null);
  };

  // Database actions
  const handleCreateDb = async () => {
    if (!newDbName.trim()) return;
    setCreatingDb(true);
    try {
      const resp = await fetch(`/api/databases/${type}/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newDbName.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        showFeedback(true, `Banco "${newDbName}" criado`);
        setNewDbName('');
        setShowNewDb(false);
        onRefresh();
      } else {
        showFeedback(false, data.error || 'Erro ao criar banco');
      }
    } catch {
      showFeedback(false, 'Erro de conexão');
    }
    setCreatingDb(false);
  };

  const handleDeleteDb = async () => {
    if (!dbToDelete) return;
    try {
      await fetch(`/api/databases/${type}/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'drop', name: dbToDelete }),
      });
      showFeedback(true, `Banco "${dbToDelete}" removido`);
      setDbToDelete(null);
      onRefresh();
    } catch {
      showFeedback(false, 'Erro ao remover banco');
    }
  };

  const handleImportSql = async () => {
    if (!importDbName || !importFilePath) return;
    setImporting(true);
    setImportProgress(0);
    setImportFileSize(0);
    setImportError(null);
    setImportComplete(false);
    setImportJobId(null);
    setImportStartTime(Date.now());

    try {
      // Start import job
      const startResp = await fetch(`/api/databases/${type}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: importDbName, sqlFilePath: importFilePath }),
      });
      const startData = await startResp.json();

      if (!startData.success) {
        setImportError(startData.error || 'Erro ao iniciar importação');
        setImporting(false);
        return;
      }

      const jobId = startData.data.jobId;
      const fileSize = startData.data.fileSize;
      setImportJobId(jobId);
      setImportFileSize(fileSize);

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const pollResp = await fetch(`/api/databases/${type}/import?job=${jobId}`);
          const pollData = await pollResp.json();

          if (!pollData.success) {
            clearInterval(pollInterval);
            setImportError(pollData.error || 'Erro ao verificar progresso');
            setImporting(false);
            return;
          }

          const job = pollData.data;
          setImportProgress(job.progress);

          if (job.status === 'completed') {
            clearInterval(pollInterval);
            setImportProgress(100);
            setImportComplete(true);
            setImporting(false);
            showFeedback(true, `SQL importado para "${importDbName}" (${formatFileSize(fileSize)})`);
            setShowImport(false);
            setImportDbName('');
            setImportFilePath('');
            onRefresh();
          } else if (job.status === 'error') {
            clearInterval(pollInterval);
            setImportError(job.error || 'Erro desconhecido na importação');
            setImporting(false);
          }
        } catch {
          // Polling error, continue trying
        }
      }, 800);
    } catch {
      setImportError('Erro de conexão ao iniciar importação');
      setImporting(false);
    }
  };

  const handleCancelImport = () => {
    setImporting(false);
    setImportJobId(null);
    setImportProgress(0);
    setImportError(null);
    setImportComplete(false);
  };

  // SQL Console
  const handleExecuteSql = async () => {
    if (!sqlQuery.trim()) return;
    setSqlExecuting(true);
    setSqlResult(null);

    try {
      const resp = await fetch(`/api/databases/${type}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlQuery }),
      });
      const data = await resp.json();

      const result = {
        success: data.success,
        output: data.success ? data.data?.output || '' : data.error || 'Erro desconhecido',
      };

      setSqlResult(result);
      setSqlHistory(prev => [{ query: sqlQuery, ...result }, ...prev].slice(0, 50));
    } catch {
      setSqlResult({ success: false, output: 'Erro de conexão ao executar SQL' });
      setSqlHistory(prev => [{ query: sqlQuery, success: false, output: 'Erro de conexão' }, ...prev].slice(0, 50));
    }
    setSqlExecuting(false);
  };

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  // User actions
  const handleCreateUser = async () => {
    if (!newUsername || !newUserPassword) return;
    setCreatingUser(true);
    try {
      const resp = await fetch(`/api/databases/${type}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          username: newUsername,
          password: newUserPassword,
          database: newUserDb || undefined,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        showFeedback(true, `Usuário "${newUsername}" criado`);
        setNewUsername('');
        setNewUserPassword('');
        setNewUserDb('');
        setShowNewUser(false);
        onRefresh();
      } else {
        showFeedback(false, data.error || 'Erro ao criar usuário');
      }
    } catch {
      showFeedback(false, 'Erro de conexão');
    }
    setCreatingUser(false);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await fetch(`/api/databases/${type}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'drop', username: userToDelete.user, host: userToDelete.host }),
      });
      showFeedback(true, `Usuário "${userToDelete.user}" removido`);
      setUserToDelete(null);
      onRefresh();
    } catch {
      showFeedback(false, 'Erro ao remover usuário');
    }
  };

  const handleChangeUserPassword = async () => {
    if (!showUserPassword || !userNewPassword) return;
    setChangingUserPassword(true);
    try {
      const resp = await fetch(`/api/databases/${type}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'password',
          username: showUserPassword.user,
          password: userNewPassword,
          host: showUserPassword.host,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        showFeedback(true, `Senha de "${showUserPassword.user}" alterada`);
        setShowUserPassword(null);
        setUserNewPassword('');
      } else {
        showFeedback(false, data.error || 'Erro ao alterar senha');
      }
    } catch {
      showFeedback(false, 'Erro de conexão');
    }
    setChangingUserPassword(false);
  };

  // Root password
  const handleChangeRootPassword = async () => {
    if (!rootNewPassword) return;
    setChangingRootPassword(true);
    try {
      const resp = await fetch(`/api/databases/${type}/root-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: rootNewPassword }),
      });
      const data = await resp.json();
      if (data.success) {
        showFeedback(true, 'Senha root alterada com sucesso');
        setShowRootPassword(false);
        setRootNewPassword('');
      } else {
        showFeedback(false, data.error || 'Erro ao alterar senha root');
      }
    } catch {
      showFeedback(false, 'Erro de conexão');
    }
    setChangingRootPassword(false);
  };

  if (!installed) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-[var(--text-primary)]">{name}</h3>
            <Badge variant="warning">Não Instalado</Badge>
          </div>
          <Button onClick={onInstall}>Instalar {name}</Button>
        </div>
      </Card>
    );
  }

  const isPostgres = type === 'postgresql';
  const isSqlCapable = type === 'mysql' || type === 'postgresql';

  const tabs = [
    { key: 'databases' as const, icon: <HiOutlineCircleStack className="w-4 h-4" />, label: 'Bancos', count: databases.length },
    { key: 'users' as const, icon: <HiOutlineUsers className="w-4 h-4" />, label: 'Usuários', count: users.length },
    ...(isPostgres ? [{ key: 'schemas' as const, icon: <HiOutlineShieldCheck className="w-4 h-4" />, label: 'Permissões', count: schemas.length }] : []),
    ...(isSqlCapable ? [{ key: 'console' as const, icon: <HiOutlineCommandLine className="w-4 h-4" />, label: 'Console' }] : []),
    { key: 'root' as const, icon: <HiOutlineKey className="w-4 h-4" />, label: 'Root' },
  ];

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-[var(--text-primary)]">{name}</h3>
            <div className="flex gap-1.5">
              <Badge variant="success">Instalado</Badge>
              {running ? <Badge variant="success">Rodando</Badge> : <Badge variant="danger">Parado</Badge>}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onRefresh}><HiOutlineArrowPath className="w-4 h-4" /> Atualizar</Button>
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          {version && (
            <div>
              <span className="text-[var(--text-muted)]">Versão:</span>
              <span className="text-[var(--text-primary)] ml-1">{version}</span>
            </div>
          )}
          <div>
            <span className="text-[var(--text-muted)]">Porta:</span>
            <span className="text-[var(--text-primary)] ml-1 font-mono">{port}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Bancos:</span>
            <span className="text-[var(--text-primary)] ml-1">{databases.length}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Usuários:</span>
            <span className="text-[var(--text-primary)] ml-1">{users.length}</span>
          </div>
        </div>
      </Card>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
          feedback.success ? 'bg-green-600/10 text-green-400 border border-green-500/30' : 'bg-red-600/10 text-red-400 border border-red-500/30'
        }`}>
          {feedback.success ? <HiOutlineCheck className="w-4 h-4" /> : <HiOutlineXMark className="w-4 h-4" />}
          {feedback.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border-t border-x border-[var(--border-color)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {tab.icon}
              {tab.label}
            </span>
            {tab.count !== undefined && (
              <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <Card padding={false}>
        {activeTab === 'databases' && (
          <div>
            {/* Actions */}
            <div className="flex items-center gap-2 p-3 border-b border-[var(--border-color)]">
              <Button size="sm" onClick={() => setShowNewDb(!showNewDb)}>
                <HiOutlinePlus className="w-3.5 h-3.5" /> Novo Banco
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowImport(!showImport)}>
                <HiOutlineArrowUpTray className="w-3.5 h-3.5" /> Importar SQL
              </Button>
            </div>

            {/* New DB Form */}
            {showNewDb && (
              <div className="flex items-center gap-2 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <Input
                  placeholder="Nome do banco..."
                  value={newDbName}
                  onChange={e => setNewDbName(e.target.value)}
                  className="w-48"
                  onKeyDown={e => e.key === 'Enter' && handleCreateDb()}
                />
                <Button size="sm" onClick={handleCreateDb} loading={creatingDb}>Criar</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewDb(false)}>Cancelar</Button>
              </div>
            )}

            {/* Import SQL Form */}
            {showImport && (
              <div className="space-y-3 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                {!importing && !importError && !importComplete && (
                  <>
                    <Select
                      label="Banco de Destino"
                      value={importDbName}
                      onChange={e => setImportDbName(e.target.value)}
                      options={[
                        { value: '', label: 'Selecione um banco...' },
                        ...databases.map(db => ({ value: db, label: db })),
                      ]}
                    />
                    <Input
                      label="Caminho do Arquivo SQL"
                      placeholder="/caminho/para/arquivo.sql"
                      value={importFilePath}
                      onChange={e => setImportFilePath(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleImportSql} loading={importing}>Importar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>Cancelar</Button>
                    </div>
                  </>
                )}

                {/* Progress display */}
                {importing && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-primary)] font-medium">
                        Importando para <code className="text-blue-400">{importDbName}</code>
                      </span>
                      <button
                        onClick={handleCancelImport}
                        className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>

                    {/* File info */}
                    <div className="flex gap-4 text-xs text-[var(--text-muted)]">
                      <span>Arquivo: <code className="text-[var(--text-secondary)]">{importFilePath}</code></span>
                      {importFileSize > 0 && <span>Tamanho: {formatFileSize(importFileSize)}</span>}
                      <span>Tempo: {formatElapsed(Date.now() - importStartTime)}</span>
                    </div>

                    {/* Progress bar */}
                    <div className="space-y-1">
                      <div className="w-full bg-[var(--bg-card)] rounded-full h-3 overflow-hidden border border-[var(--border-color)]">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-300 relative"
                          style={{ width: `${importProgress}%` }}
                        >
                          {importProgress > 0 && (
                            <div className="absolute inset-0 bg-blue-400/30 animate-pulse rounded-full" />
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-[var(--text-muted)]">
                        <span>{importProgress}%</span>
                        {importFileSize > 0 && (
                          <span>
                            ~{formatFileSize(Math.round((importProgress / 100) * importFileSize))} / {formatFileSize(importFileSize)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <Spinner size="sm" />
                      <span>{importProgress < 100 ? 'Importando...' : 'Finalizando...'}</span>
                    </div>
                  </div>
                )}

                {/* Error display */}
                {importError && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-red-400">
                      <HiOutlineXMark className="w-5 h-5" />
                      <span className="font-medium text-sm">Erro na importação</span>
                    </div>
                    <pre className="text-xs font-mono text-red-300 bg-red-900/20 border border-red-500/30 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {importError}
                    </pre>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => {
                        setImportError(null);
                        setImporting(false);
                        setImportProgress(0);
                      }}>
                        Tentar novamente
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setShowImport(false);
                        setImportError(null);
                        setImporting(false);
                        setImportProgress(0);
                      }}>
                        Fechar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Database List */}
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                  <th className="p-3">Banco</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {databases.length === 0 && (
                  <tr>
                    <td colSpan={2} className="p-6 text-center text-[var(--text-muted)] text-sm">
                      Nenhum banco de dados encontrado
                    </td>
                  </tr>
                )}
                {databases.map(db => (
                  <tr key={db} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className="p-3 text-sm text-[var(--text-primary)] font-mono">
                      <HiOutlineCircleStack className="w-4 h-4 inline mr-2 text-[var(--text-muted)]" />
                      {db}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setDbToDelete(db)}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                        title="Remover banco"
                      >
                        <HiOutlineTrash className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'users' && (
          <div>
            {/* Actions */}
            <div className="flex items-center gap-2 p-3 border-b border-[var(--border-color)]">
              <Button size="sm" onClick={() => setShowNewUser(!showNewUser)}>
                <HiOutlinePlus className="w-3.5 h-3.5" /> Novo Usuário
              </Button>
            </div>

            {/* New User Form */}
            {showNewUser && (
              <div className="space-y-3 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <Input
                  placeholder="Username"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder="Senha"
                  value={newUserPassword}
                  onChange={e => setNewUserPassword(e.target.value)}
                />
                <Select
                  label="Banco de Dados (opcional)"
                  value={newUserDb}
                  onChange={e => setNewUserDb(e.target.value)}
                  options={[
                    { value: '', label: 'Todos os bancos (admin)' },
                    ...databases.map(db => ({ value: db, label: db })),
                  ]}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateUser} loading={creatingUser}>Criar Usuário</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewUser(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {/* User Password Change Form */}
            {showUserPassword && (
              <div className="flex items-center gap-2 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <span className="text-sm text-[var(--text-muted)] shrink-0">Nova senha para <strong>{showUserPassword.user}</strong>:</span>
                <Input
                  type="password"
                  placeholder="Nova senha"
                  value={userNewPassword}
                  onChange={e => setUserNewPassword(e.target.value)}
                  className="w-48"
                  onKeyDown={e => e.key === 'Enter' && handleChangeUserPassword()}
                />
                <Button size="sm" onClick={handleChangeUserPassword} loading={changingUserPassword}>Salvar</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowUserPassword(null)}>Cancelar</Button>
              </div>
            )}

            {/* Users List */}
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                  <th className="p-3">Usuário</th>
                  <th className="p-3">Host</th>
                  <th className="p-3 w-24">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-[var(--text-muted)] text-sm">
                      Nenhum usuário encontrado
                    </td>
                  </tr>
                )}
                {users.map(u => (
                  <tr key={`${u.user}@${u.host}`} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                    <td className="p-3 text-sm text-[var(--text-primary)] font-mono">
                      <HiOutlineUser className="w-4 h-4 inline mr-2 text-[var(--text-muted)]" />
                      {u.user}
                    </td>
                    <td className="p-3 text-sm text-[var(--text-muted)] font-mono">{u.host}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setShowUserPassword(u); setUserNewPassword(''); }}
                          className="p-1 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded"
                          title="Alterar senha"
                        >
                          <HiOutlineKey className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setUserToDelete(u)}
                          className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                          title="Remover usuário"
                        >
                          <HiOutlineTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'schemas' && isPostgres && (
          <div>
            {/* Header with refresh */}
            <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
              <h4 className="text-sm font-medium text-[var(--text-primary)]">
                Schemas do PostgreSQL
              </h4>
              <Button size="sm" variant="ghost" onClick={fetchSchemas} loading={loadingSchemas}>
                <HiOutlineArrowPath className="w-3.5 h-3.5" /> Atualizar
              </Button>
            </div>

            {loadingSchemas ? (
              <div className="flex justify-center py-8"><Spinner size="md" /></div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-left text-xs uppercase text-[var(--text-muted)]">
                    <th className="p-3">Schema</th>
                    <th className="p-3">Owner Atual</th>
                    <th className="p-3 w-56">Alterar Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {schemas.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-[var(--text-muted)] text-sm">
                        Nenhum schema encontrado
                      </td>
                    </tr>
                  )}
                  {schemas.map(s => (
                    <tr key={s.schema_name} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]">
                      <td className="p-3 text-sm text-[var(--text-primary)] font-mono">
                        <HiOutlineFolderOpen className="w-4 h-4 inline mr-2 text-[var(--text-muted)]" />
                        {s.schema_name}
                      </td>
                      <td className="p-3 text-sm text-[var(--text-muted)] font-mono">
                        {s.owner}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <select
                            className="text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-[var(--text-primary)] min-w-0 w-32"
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value && e.target.value !== s.owner) {
                                handleChangeSchemaOwner(s.schema_name, e.target.value);
                                e.target.value = '';
                              }
                            }}
                            disabled={changingSchemaOwner === s.schema_name}
                          >
                            <option value="" disabled>Novo owner...</option>
                            {schemaUsers.filter(u => u !== s.owner).map(u => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                          {changingSchemaOwner === s.schema_name && (
                            <Spinner size="sm" />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="p-3 bg-blue-600/10 border-t border-[var(--border-color)] text-xs text-blue-300">
              <HiOutlineShieldCheck className="w-4 h-4 inline mr-1" />
              Altere o owner de cada schema para definir qual usuário será o dono dos objetos dentro dele.
            </div>
          </div>
        )}

        {activeTab === 'console' && isSqlCapable && (
          <div className="flex flex-col" style={{ height: '60vh' }}>
            {/* Input area */}
            <div className="p-3 border-b border-[var(--border-color)] space-y-2">
              <div className="flex items-center gap-2">
                <HiOutlineCommandLine className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Console SQL - {type === 'mysql' ? 'MySQL (root)' : 'PostgreSQL (postgres)'}
                </span>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={sqlQuery}
                  onChange={e => setSqlQuery(e.target.value)}
                  placeholder={`Digite seu SQL aqui...\nEx: SHOW DATABASES;\nEx: SELECT * FROM pg_catalog.pg_tables;`}
                  className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-y min-h-[80px] max-h-[200px] focus:outline-none focus:border-blue-500/50"
                  rows={3}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleExecuteSql();
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  Ctrl+Enter para executar
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleExecuteSql} loading={sqlExecuting}>
                    <HiOutlinePlay className="w-3.5 h-3.5" /> Executar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setSqlQuery('');
                    setSqlResult(null);
                  }}>
                    Limpar
                  </Button>
                </div>
              </div>
            </div>

            {/* Result area */}
            <div className="flex-1 overflow-y-auto p-3">
              {sqlResult ? (
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 text-xs font-medium ${
                    sqlResult.success ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {sqlResult.success ? (
                      <HiOutlineCheck className="w-4 h-4" />
                    ) : (
                      <HiOutlineXMark className="w-4 h-4" />
                    )}
                    {sqlResult.success ? 'Sucesso' : 'Erro'}
                  </div>
                  <pre className={`text-xs font-mono p-3 rounded-lg overflow-auto whitespace-pre-wrap ${
                    sqlResult.success
                      ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]'
                      : 'bg-red-900/20 text-red-300 border border-red-500/30'
                  }`}>
                    {sqlResult.output}
                  </pre>
                </div>
              ) : sqlHistory.length > 0 ? (
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase">Histórico</h4>
                  {sqlHistory.slice(0, 10).map((h, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${h.success ? 'bg-green-400' : 'bg-red-400'}`} />
                        <code
                          className="text-xs font-mono text-[var(--text-secondary)] cursor-pointer hover:text-blue-400 truncate max-w-md"
                          onClick={() => setSqlQuery(h.query)}
                          title="Clique para reexecutar"
                        >
                          {h.query.length > 80 ? h.query.slice(0, 80) + '...' : h.query}
                        </code>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
                  <HiOutlineCommandLine className="w-10 h-10 mb-2 opacity-50" />
                  <p className="text-sm">Digite um comando SQL e clique em Executar</p>
                  <p className="text-xs mt-1">O resultado da consulta aparecerá aqui</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-[var(--border-color)] bg-amber-600/10 text-xs text-amber-300 flex items-center gap-1">
              <HiOutlineExclamationTriangle className="w-3.5 h-3.5" />
              Comandos executados como superusuário. Use com cautela.
            </div>
          </div>
        )}

        {activeTab === 'root' && (
          <div className="p-6">
            <div className="max-w-md space-y-4">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <HiOutlineKey className="w-5 h-5 text-amber-400" />
                <h4 className="font-semibold">Senha Root do {name}</h4>
              </div>

              <p className="text-sm text-[var(--text-muted)]">
                Altere a senha do usuário root/admin do {name}. Esta senha é usada para
                administração do servidor de banco de dados.
              </p>

              {!showRootPassword ? (
                <Button onClick={() => setShowRootPassword(true)}>
                  <HiOutlineKey className="w-4 h-4" /> Alterar Senha Root
                </Button>
              ) : (
                <div className="space-y-3">
                  <Input
                    type="password"
                    label="Nova Senha Root"
                    placeholder="Mínimo 6 caracteres"
                    value={rootNewPassword}
                    onChange={e => setRootNewPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleChangeRootPassword()}
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleChangeRootPassword} loading={changingRootPassword} variant="danger">
                      Salvar Nova Senha
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowRootPassword(false); setRootNewPassword(''); }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              <div className="p-3 bg-amber-600/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                <strong><HiOutlineExclamationTriangle className="w-4 h-4 inline" /> Atenção:</strong> Alterar a senha root pode afetar aplicações que dependem dela.
                Certifique-se de atualizar as configurações das aplicações após a mudança.
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Delete Database Confirm */}
      <ConfirmDialog
        open={!!dbToDelete}
        title="Remover Banco de Dados"
        message={`Tem certeza que deseja remover o banco "${dbToDelete}"? Todos os dados serão perdidos permanentemente.`}
        confirmLabel="Remover"
        variant="danger"
        onConfirm={handleDeleteDb}
        onClose={() => setDbToDelete(null)}
      />

      {/* Delete User Confirm */}
      <ConfirmDialog
        open={!!userToDelete}
        title="Remover Usuário"
        message={`Tem certeza que deseja remover o usuário "${userToDelete?.user}@${userToDelete?.host}"?`}
        confirmLabel="Remover"
        variant="danger"
        onConfirm={handleDeleteUser}
        onClose={() => setUserToDelete(null)}
      />
    </div>
  );
}
