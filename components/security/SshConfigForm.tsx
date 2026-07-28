import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';

export default function SshConfigForm() {
  const [config, setConfig] = useState<any>({});
  const [port, setPort] = useState('22');
  const [permitRootLogin, setPermitRootLogin] = useState('prohibit-password');
  const [passwordAuth, setPasswordAuth] = useState('yes');
  const [pubkeyAuth, setPubkeyAuth] = useState('yes');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/security/ssh-config').then(r => r.json()).then(json => {
      if (json.success) {
        setConfig(json.data);
        setPort(json.data.Port || '22');
        setPermitRootLogin(json.data.PermitRootLogin || 'prohibit-password');
        setPasswordAuth(json.data.PasswordAuthentication || 'yes');
        setPubkeyAuth(json.data.PubkeyAuthentication || 'yes');
      }
    });
  }, []);

  const handleSave = () => {
    setSaving(true);
    // PUT to update SSH config
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Input label="Porta SSH" value={port} onChange={e => setPort(e.target.value)} />
        <Select label="PermitRootLogin" value={permitRootLogin} onChange={e => setPermitRootLogin(e.target.value)}
          options={[{ value: 'yes', label: 'Sim' }, { value: 'no', label: 'Não' }, { value: 'prohibit-password', label: 'Proibir Senha' }]} />
        <Select label="Password Auth" value={passwordAuth} onChange={e => setPasswordAuth(e.target.value)}
          options={[{ value: 'yes', label: 'Sim' }, { value: 'no', label: 'Não' }]} />
        <Select label="Pubkey Auth" value={pubkeyAuth} onChange={e => setPubkeyAuth(e.target.value)}
          options={[{ value: 'yes', label: 'Sim' }, { value: 'no', label: 'Não' }]} />
      </div>
      <Button onClick={handleSave} loading={saving}>Aplicar Configurações SSH</Button>
    </div>
  );
}
