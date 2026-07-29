import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  HiOutlinePlus, HiOutlineTrash, HiOutlineKey, HiOutlineCircleStack,
  HiOutlineUser, HiOutlineFolderOpen, HiOutlineArrowUpTray,
  HiOutlineCheck, HiOutlineXMark
} from 'react-icons/hi2';

interface DbUser {
  user: string;
  host: string;
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
  const [activeTab, setActiveTab] = useState<'databases' | 'users' | 'root'>('databases');

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

  // Feedback
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const showFeedback = (success: boolean, message: string) => {
    setFeedback({ success, message });
    setTimeout(() => setFeedback(null), 4000);
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
    try {
      const resp = await fetch(`/api/databases/${type}/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', name: importDbName, sqlFilePath: importFilePath }),
      });
      const data = await resp.json();
      if (data.success) {
        showFeedback(true, `SQL importado para "${importDbName}"`);
        setShowImport(false);
        setImportDbName('');
        setImportFilePath('');
      } else {
        showFeedback(false, data.error || 'Erro na importação');
      }
    } catch {
      showFeedback(false, 'Erro de conexão');
    }
    setImporting(false);
  };

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

  const tabs = [
    { key: 'databases' as const, label: '🗄️ Bancos', count: databases.length },
    { key: 'users' as const, label: '👥 Usuários', count: users.length },
    { key: 'root' as const, label: '🔑 Root' },
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
          <Button size="sm" variant="ghost" onClick={onRefresh}>🔄 Atualizar</Button>
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
            {tab.label}
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
              <div className="space-y-2 p-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
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
                <strong>⚠️ Atenção:</strong> Alterar a senha root pode afetar aplicações que dependem dela.
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
