import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import ThemeToggle from '@/components/settings/ThemeToggle';

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [serverName, setServerName] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/config').then(r => r.json()).then(j => {
      if (j.success) { setConfig(j.data); setServerName(j.data.serverName || ''); setLanguage(j.data.language || 'pt-BR'); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const updates: any = {};
    if (serverName) updates.serverName = serverName;
    if (language) updates.language = language;
    if (apiKey) updates.aiApiKey = apiKey;
    await fetch('/api/settings/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Configurações</h1>
        {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
          <>
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Aparência e Idioma</h3>
              <div className="space-y-4">
                <Input label="Nome do Servidor" value={serverName} onChange={e => setServerName(e.target.value)} />
                <Select label="Idioma" value={language} onChange={e => setLanguage(e.target.value)}
                  options={[{ value: 'pt-BR', label: 'Português' }, { value: 'en-US', label: 'English' }, { value: 'es-ES', label: 'Español' }]} />
                <ThemeToggle />
              </div>
            </Card>
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Integração IA</h3>
              <Input label="Chave API (DeepSeek)" type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
            </Card>
            <Button onClick={handleSave} loading={saving}>Salvar Configurações</Button>
          </>
        )}
      </div>
    </AppLayout>
  );
}
