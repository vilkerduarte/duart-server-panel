import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import {
  HiOutlineKey, HiOutlineEye, HiOutlineEyeSlash, HiOutlineClipboard, HiOutlineSparkles,
  HiOutlineExclamationTriangle,
} from 'react-icons/hi2';

interface MysqlRootPasswordProps {
  name: string;
  onFeedback: (success: boolean, message: string) => void;
}

/**
 * Senha root do MySQL guardada pelo painel: revelar, copiar e trocar
 * (digitada ou gerada). A troca roda ALTER USER no banco de verdade.
 */
export default function MysqlRootPassword({ name, onFeedback }: MysqlRootPasswordProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [notStored, setNotStored] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReveal = async () => {
    if (revealed !== null) { setRevealed(null); return; }
    setRevealing(true);
    try {
      const resp = await fetch('/api/databases/mysql/root-password', { cache: 'no-store' });
      const data = await resp.json();
      if (!data.success) onFeedback(false, data.error || 'Erro ao ler a senha');
      else if (!data.data.stored) setNotStored(true);
      else { setNotStored(false); setRevealed(data.data.password); }
    } catch {
      onFeedback(false, 'Erro de conexão');
    }
    setRevealing(false);
  };

  const handleCopy = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      onFeedback(true, 'Senha copiada');
    } catch {
      onFeedback(false, 'Não foi possível copiar');
    }
  };

  const save = async (body: { newPassword?: string; generate?: boolean }) => {
    setSaving(true);
    try {
      const resp = await fetch('/api/databases/mysql/root-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.success) {
        onFeedback(true, 'Senha root alterada no MySQL');
        setRevealed(data.data.password ?? null);
        setNotStored(false);
        setEditing(false);
        setNewPassword('');
      } else {
        onFeedback(false, data.error || 'Erro ao alterar senha root');
      }
    } catch {
      onFeedback(false, 'Erro de conexão');
    }
    setSaving(false);
  };

  return (
    <div className="max-w-md space-y-4">
      <div className="flex items-center gap-2 text-[var(--text-primary)]">
        <HiOutlineKey className="w-5 h-5 text-amber-400" />
        <h4 className="font-semibold">Senha Root do {name}</h4>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        O painel guarda a senha do <span className="font-mono">root@localhost</span> em um arquivo acessível só ao
        sistema e a usa para administrar o banco. É a mesma usada para entrar no phpMyAdmin.
      </p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 font-mono text-sm px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] break-all min-h-[38px]">
            {revealed ?? (notStored ? 'Nenhuma senha guardada (root usa autenticação por socket)' : '••••••••••••')}
          </div>
          <Button size="sm" variant="ghost" onClick={handleReveal} loading={revealing} title={revealed ? 'Ocultar' : 'Revelar'}>
            {revealed ? <HiOutlineEyeSlash className="w-4 h-4" /> : <HiOutlineEye className="w-4 h-4" />}
          </Button>
          {revealed && (
            <Button size="sm" variant="ghost" onClick={handleCopy} title="Copiar">
              <HiOutlineClipboard className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {!editing ? (
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setEditing(true)}>
            <HiOutlineKey className="w-4 h-4" /> Alterar senha
          </Button>
          <Button
            variant="warning"
            loading={saving}
            onClick={() => confirm('Gerar uma nova senha root aleatória e aplicá-la no MySQL?') && save({ generate: true })}
          >
            <HiOutlineSparkles className="w-4 h-4" /> Gerar nova senha
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            type="password"
            label="Nova senha root"
            placeholder="Mínimo 8 caracteres"
            value={newPassword}
            autoComplete="new-password"
            onChange={e => setNewPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newPassword && save({ newPassword })}
          />
          <div className="flex gap-2">
            <Button onClick={() => save({ newPassword })} loading={saving} disabled={newPassword.length < 8} variant="danger">
              Salvar nova senha
            </Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setNewPassword(''); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="p-3 bg-amber-600/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
        <strong><HiOutlineExclamationTriangle className="w-4 h-4 inline" /> Atenção:</strong> aplicações que
        conectam como root precisam ser atualizadas após a troca.
      </div>
    </div>
  );
}
