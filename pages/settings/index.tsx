import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import { useTheme } from '@/lib/contexts/ThemeContext';

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [serverName, setServerName] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/config')
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setConfig(json.data);
          setServerName(json.data.serverName || '');
          setLanguage(json.data.language || 'pt-BR');
          setApiKey('');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
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
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Configurações</h1>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* Aparência */}
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
                    { value: 'pt-BR', label: 'Português' },
                    { value: 'en-US', label: 'English' },
                    { value: 'es-ES', label: 'Español' },
                  ]}
                />
                <div>
                  <label className="text-sm font-medium text-[var(--text-secondary)] block mb-2">Tema</label>
                  <Button variant="ghost" onClick={toggleTheme}>
                    {theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* IA Integration */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Integração IA</h3>
              <div className="space-y-4">
                <Input
                  label="Chave API (DeepSeek)"
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                />
              </div>
            </Card>

            <Button onClick={handleSave} loading={saving}>
              Salvar Configurações
            </Button>
          </>
        )}
      </div>
    </AppLayout>
  );
}
