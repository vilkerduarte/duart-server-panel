import { useEffect, useState } from 'react';
import AppLayout from '@/components/Layout/AppLayout';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import ThemeToggle from '@/components/settings/ThemeToggle';
import { HiOutlineCheck, HiOutlineXMark, HiOutlineKey, HiOutlineBolt, HiOutlineShieldCheck } from 'react-icons/hi2';
import { useToast } from '@/lib/contexts/ToastContext';
import { useI18n } from '@/lib/contexts/I18nContext';

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [serverName, setServerName] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiMaxTokens, setAiMaxTokens] = useState('');
  const [fullAccess, setFullAccess] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordResult, setPasswordResult] = useState<{ success: boolean; message: string } | null>(null);

  const { showToast } = useToast();
  const { t, setLocale } = useI18n();

  useEffect(() => {
    fetch('/api/settings/config').then(r => r.json()).then(j => {
      if (j.success) {
        setConfig(j.data);
        setServerName(j.data.serverName || '');
        setLanguage(j.data.language || 'pt-BR');
        setAiBaseUrl(j.data.aiBaseUrl || '');
        setAiModel(j.data.aiModel || '');
        // Zero significa "usar o padrão do painel": mostra o campo vazio.
        setAiMaxTokens(j.data.aiMaxTokens ? String(j.data.aiMaxTokens) : '');
        setFullAccess(Boolean(j.data.aiFullAccess));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const updates: any = {};
    if (serverName) updates.serverName = serverName;
    if (language) updates.language = language;
    // A chave só é enviada quando o campo foi preenchido: em branco significa
    // "manter a atual", não "apagar".
    if (apiKey) updates.aiApiKey = apiKey;
    updates.aiBaseUrl = aiBaseUrl;
    if (aiModel) updates.aiModel = aiModel;
    updates.aiMaxTokens = aiMaxTokens.trim() === '' ? 0 : Number(aiMaxTokens);
    updates.aiFullAccess = fullAccess;
    try {
      const res = await fetch('/api/settings/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      // O idioma vale já, sem recarregar a página.
      if (language) setLocale(language);
      showToast(t('settings.saveSuccess'), 'success');
    } catch {
      showToast(t('settings.saveError'), 'error');
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    setPasswordResult(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordResult({ success: false, message: t('settings.passwordAllRequired') });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordResult({ success: false, message: t('settings.passwordTooShort') });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordResult({ success: false, message: t('settings.passwordMismatch') });
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
        setPasswordResult({ success: true, message: t('settings.passwordSuccess') });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordResult({ success: false, message: data.error || t('settings.passwordFailed') });
      }
    } catch {
      setPasswordResult({ success: false, message: t('settings.connectionError') });
    }
    setChangingPassword(false);
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t('settings.title')}</h1>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* Geral */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('settings.appearance')}</h3>
              <div className="space-y-4">
                <Input
                  label={t('settings.serverName')}
                  value={serverName}
                  onChange={e => setServerName(e.target.value)}
                />
                <Select
                  label={t('settings.language')}
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  options={[
                    { value: 'pt-BR', label: t('settings.languagePt') },
                    { value: 'en-US', label: t('settings.languageEn') },
                    { value: 'es-ES', label: t('settings.languageEs') },
                  ]}
                />
                <ThemeToggle />
              </div>
            </Card>

            {/* IA Integration */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">{t('settings.integration')}</h3>
              <Input
                label={t('settings.apiKey')}
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
              <p className="text-xs text-[var(--text-muted)] mt-2">
                {t('settings.apiKeyHelp')}{' '}
                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  platform.deepseek.com
                </a>
              </p>

              <Input
                label={t('settings.aiEndpoint')}
                placeholder="https://api.openai.com/v1"
                value={aiBaseUrl}
                onChange={e => setAiBaseUrl(e.target.value)}
                className="mt-4"
              />
              <Input
                label={t('settings.model')}
                placeholder="deepseek-v4-pro"
                value={aiModel}
                onChange={e => setAiModel(e.target.value)}
                className="mt-4"
              />
              <Input
                label={t('settings.maxTokens')}
                type="number"
                min={256}
                max={65536}
                placeholder="4096"
                value={aiMaxTokens}
                onChange={e => setAiMaxTokens(e.target.value)}
                className="mt-4"
              />
              <p className="text-xs text-[var(--text-muted)] mt-2">{t('settings.maxTokensHelp')}</p>
              <p className="text-xs text-[var(--text-muted)] mt-2">{t('settings.compatHelp')}</p>

              {/* Acesso Total */}
              <div className={`mt-6 rounded-xl border p-4 transition-colors ${
                fullAccess ? 'border-amber-500/50 bg-amber-500/5' : 'border-[var(--border-color)]'
              }`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fullAccess}
                    onChange={e => setFullAccess(e.target.checked)}
                    className="mt-1 rounded"
                  />
                  <span className="text-sm">
                    <span className="flex items-center gap-1.5 font-semibold text-amber-400">
                      <HiOutlineBolt className="w-4 h-4" />
                      {t('settings.fullAccessLabel')}
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)] mt-1.5">
                      {fullAccess ? t('settings.fullAccessDesc') : t('settings.fullAccessOff')}
                    </span>
                  </span>
                </label>

                <p className="flex items-start gap-2 text-xs text-[var(--text-muted)] mt-3">
                  <HiOutlineShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                  {t('settings.fullAccessRead')}
                </p>

                {fullAccess && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">{t('settings.fullAccessSafeguards')}</p>
                    <p className="text-xs text-amber-400/90">{t('settings.fullAccessWarning')}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Change Password */}
            <Card>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <HiOutlineKey className="w-5 h-5" /> {t('settings.passwordTitle')}
              </h3>
              <div className="space-y-4">
                <Input
                  label={t('settings.currentPassword')}
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder={t('settings.passwordCurrentPlaceholder')}
                />
                <Input
                  label={t('settings.newPassword')}
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={t('settings.passwordNewPlaceholder')}
                />
                <Input
                  label={t('settings.confirmNewPassword')}
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('settings.passwordConfirmPlaceholder')}
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
                  {t('settings.changePassword')}
                </Button>
              </div>
            </Card>

            <Button onClick={handleSave} loading={saving} className="w-full sm:w-auto">
              {t('settings.saveButton')}
            </Button>
          </>
        )}
      </div>
    </AppLayout>
  );
}
