import { useState } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Spinner from '@/components/ui/Spinner';
import { HiOutlineComputerDesktop } from 'react-icons/hi2';

export default function LoginScreen() {
  const { login, setupAdmin, needsSetup, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Usuário e senha são obrigatórios');
      return;
    }

    if (needsSetup && password.length < 8) {
      setError('Senha deve ter no mínimo 8 caracteres');
      return;
    }

    if (needsSetup && password !== confirmPassword) {
      setError('As senhas não conferem');
      return;
    }

    setLoading(true);
    const result = needsSetup
      ? await setupAdmin(username, password)
      : await login(username, password);

    if (!result.success) {
      setError(result.error || 'Erro');
    }
    setLoading(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <HiOutlineComputerDesktop className="w-12 h-12 mx-auto mb-3 text-blue-400" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Duart Panel</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Painel de Gerenciamento de Servidores</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] text-center">
            {needsSetup ? 'Criar Administrador' : 'Entrar'}
          </h2>
          {needsSetup && (
            <p className="text-xs text-[var(--text-muted)] text-center">Primeiro acesso: crie sua conta de administrador</p>
          )}

          <Input label="Usuário" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoFocus />
          <Input label="Senha" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />

          {needsSetup && (
            <Input label="Confirmar Senha" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" />
          )}

          {error && (
            <div className="bg-red-600/10 border border-red-600/30 text-red-400 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            {needsSetup ? 'Criar Conta' : 'Entrar'}
          </Button>
        </form>

        <p className="text-xs text-[var(--text-muted)] text-center mt-6">Duart Panel v1.0.0 — Ubuntu/Debian</p>
      </div>
    </div>
  );
}
