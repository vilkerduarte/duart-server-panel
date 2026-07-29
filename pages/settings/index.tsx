import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import ThemeToggle from '@/components/settings/ThemeToggle';
import { HiOutlineCheck, HiOutlineXMark, HiOutlineKey } from 'react-icons/hi2';
import { useToast } from '@/lib/contexts/ToastContext';

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [serverName, setServerName] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordResult, setPasswordResult] = useState<{ success: boolean; message: string } | null>(null);

  const { showToast } = useToast();

  useEffect(() => {
    fetch('/api/settings/config').then(r => r.json()).then(j => {
      if (j.success) {
        setConfig(j.data);
        setServerName(j.data.serverName || '');
        setLanguage(j.data.language || 'pt-BR');
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const updates: any = {};
    if (serverName) updates.serverName = serverName;
    if (language) updates.language = language;
    if (apiKey) updates.aiApiKey = apiKey;
    await fetch('/api/settings/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setSaving(false);
    showToast('Configurações salvas', 'success');
  };

  const handleChangePassword = async () => {
    setPasswordResult(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordResult({ success: false, message: 'Todos os campos são obrigatórios' });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordResult({ success: false, message: 'Nova senha deve ter no mínimo 8 caracteres' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordResult({ success: false, message: 'As senhas não coincidem' });
      return;
    }

    setChangingPassword(true);
    try {
      const resp = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await resp.json();

      if (data.success) {
        setPasswordResult({ success: true, message: 'Senha alterada com sucesso!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordResult({ success: false, message: data.error || 'Erro ao alterar senha' });
      }
    } catch {
      setPasswordResult({ success: false, message: 'Erro de conexão' });
    }
    setChangingPassword(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Configurações</h1>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* Geral */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Aparência e Idioma</h3>
              <div className="space-y-4">
                <Input
                  label="Nome do Servidor"
                  value={serverName}
                  onChange={e => setServerName(e.target.value)}
                />
                <Select
                  label="Idioma"
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  options={[
                    { value: 'pt-BR', label: 'Português (Brasil)' },
                    { value: 'en-US', label: 'English (US)' },
                    { value: 'es-ES', label: 'Español' },
                  ]}
                />
                <ThemeToggle />
              </div>
            </Card>

            {/* IA Integration */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Integração IA</h3>
              <Input
                label="Chave API (DeepSeek)"
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
              <p className="text-xs text-[var(--text-muted)] mt-2">
                Obtenha sua chave em{' '}
                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  platform.deepseek.com
                </a>
              </p>
            </Card>

            {/* Change Password */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <HiOutlineKey className="w-5 h-5" /> Alterar Senha do Painel
              </h3>
              <div className="space-y-4">
                <Input
                  label="Senha Atual"
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Digite sua senha atual"
                />
                <Input
                  label="Nova Senha"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
                <Input
                  label="Confirmar Nova Senha"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                />

                {passwordResult && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                    passwordResult.success
                      ? 'bg-green-600/10 text-green-400 border border-green-500/30'
                      : 'bg-red-600/10 text-red-400 border border-red-500/30'
                  }`}>
                    {passwordResult.success ? (
                      <HiOutlineCheck className="w-4 h-4 shrink-0" />
                    ) : (
                      <HiOutlineXMark className="w-4 h-4 shrink-0" />
                    )}
                    {passwordResult.message}
                  </div>
                )}

                <Button
                  onClick={handleChangePassword}
                  loading={changingPassword}
                  variant="ghost"
                  className="w-full sm:w-auto"
                >
                  Alterar Senha
                </Button>
              </div>
            </Card>

            <Button onClick={handleSave} loading={saving} className="w-full sm:w-auto">
              Salvar Configurações
            </Button>
          </>
        )}
      </div>
    </AppLayout>
  );
}
