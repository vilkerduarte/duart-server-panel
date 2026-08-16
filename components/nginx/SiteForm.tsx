import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import { usePhpVersions } from '@/lib/hooks/usePhpVersions';

export interface SiteFormValues {
  domain: string;
  type: string;
  root?: string;
  proxyPort?: number;
  proxySocket?: string;
  websocket?: boolean;
  phpVersion?: string;
  phpPreset?: string;
  aliases: string[];
  clientMaxBodySize?: string;
}

interface SiteFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SiteFormValues) => void;
  site?: Partial<SiteFormValues> & { aliases?: string[] };
}

interface PythonApp {
  name: string;
  socket: string;
}

const SITE_TYPES = [
  { value: 'static', label: 'Estático — HTML, SPA compilada' },
  { value: 'php', label: 'PHP — WordPress, Laravel' },
  { value: 'proxy', label: 'Proxy reverso — porta local' },
  { value: 'python', label: 'Python — app gerenciada pelo painel' },
  { value: 'node', label: 'Node — app gerenciada pelo painel' },
];

const PHP_PRESETS = [
  { value: 'padrao', label: 'Padrão — 256MB, upload 32MB' },
  { value: 'wordpress', label: 'WordPress — 512MB, upload 128MB' },
  { value: 'laravel', label: 'Laravel — 512MB, upload 64MB' },
  { value: 'upload_pesado', label: 'Upload pesado — 1GB, upload 1GB' },
];

export default function SiteForm({ open, onClose, onSubmit, site }: SiteFormProps) {
  const phpVersions = usePhpVersions();

  const [domain, setDomain] = useState(site?.domain || '');
  const [type, setType] = useState(site?.type || 'static');
  const [root, setRoot] = useState(site?.root || '');
  const [proxyPort, setProxyPort] = useState(site?.proxyPort || 3000);
  const [proxySocket, setProxySocket] = useState(site?.proxySocket || '');
  const [websocket, setWebsocket] = useState(site?.websocket || false);
  const [phpVersion, setPhpVersion] = useState(site?.phpVersion || '');
  const [phpPreset, setPhpPreset] = useState(site?.phpPreset || 'padrao');
  const [aliases, setAliases] = useState((site?.aliases || []).join(', '));
  const [clientMaxBodySize, setClientMaxBodySize] = useState(site?.clientMaxBodySize || '');
  const [pythonApps, setPythonApps] = useState<PythonApp[]>([]);

  // Sites do tipo python/node apontam para o socket unix da aplicação, então a
  // lista de apps disponíveis é o que o usuário precisa escolher.
  useEffect(() => {
    if (type !== 'python' && type !== 'node') return;
    fetch('/api/python/apps')
      .then(res => res.json())
      .then(json => { if (json.success) setPythonApps(json.data.apps); })
      .catch(() => {});
  }, [type]);

  // Derivado em vez de sincronizado por efeito: o valor efetivo é a escolha do
  // usuário ou, na ausência dela, a versão preferida do servidor.
  const effectivePhpVersion = phpVersion || phpVersions.preferred || '';

  const isPhp = type === 'php';
  const isFileBased = type === 'static' || type === 'php';
  const isSocketBased = type === 'python' || type === 'node';

  const handleSubmit = () => {
    onSubmit({
      domain: domain.trim(),
      type,
      root: isFileBased ? (root.trim() || undefined) : undefined,
      proxyPort: type === 'proxy' ? proxyPort : undefined,
      proxySocket: isSocketBased ? (proxySocket || undefined) : undefined,
      websocket: (type === 'proxy' || isSocketBased) ? websocket : undefined,
      phpVersion: isPhp ? (effectivePhpVersion || undefined) : undefined,
      phpPreset: isPhp ? phpPreset : undefined,
      aliases: aliases.split(',').map((alias: string) => alias.trim()).filter(Boolean),
      clientMaxBodySize: clientMaxBodySize.trim() || undefined,
    });
    onClose();
  };

  const canSubmit = Boolean(domain.trim()) && (!isPhp || phpVersions.hasAny) && (!isSocketBased || Boolean(proxySocket));

  return (
    <Modal open={open} onClose={onClose} title={site ? 'Editar site' : 'Novo site'} size="lg">
      <div className="space-y-4">
        <Input
          label="Domínio"
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="meusite.com"
        />

        <Input
          label="Aliases (separados por vírgula)"
          value={aliases}
          onChange={e => setAliases(e.target.value)}
          placeholder="www.meusite.com"
        />

        <Select
          label="Tipo"
          value={type}
          onChange={e => setType(e.target.value)}
          options={SITE_TYPES}
        />

        {isFileBased && (
          <Input
            label="Diretório raiz"
            value={root}
            onChange={e => setRoot(e.target.value)}
            placeholder={`/var/www/${domain || 'meusite'}`}
          />
        )}

        {isPhp && (
          phpVersions.hasAny ? (
            <>
              <Select
                label="Versão do PHP"
                value={effectivePhpVersion}
                onChange={e => setPhpVersion(e.target.value)}
                options={phpVersions.versions}
              />
              <Select
                label="Perfil de recursos"
                value={phpPreset}
                onChange={e => setPhpPreset(e.target.value)}
                options={PHP_PRESETS}
              />
              <p className="text-xs text-[var(--text-muted)] bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                O site recebe um pool FPM dedicado: usuário de sistema próprio, socket próprio
                e <span className="font-mono">open_basedir</span> restrito à raiz — sem compartilhar
                workers nem acesso a arquivos com os outros sites.
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              Nenhuma versão de PHP-FPM está instalada. Instale pela tela de <strong>PHP</strong> antes
              de criar um site PHP — sem isso ele responderia 502.
            </p>
          )
        )}

        {type === 'proxy' && (
          <Input
            label="Porta local do upstream"
            type="number"
            value={String(proxyPort)}
            onChange={e => setProxyPort(Number(e.target.value))}
          />
        )}

        {isSocketBased && (
          pythonApps.length ? (
            <Select
              label="Aplicação"
              value={proxySocket}
              onChange={e => setProxySocket(e.target.value)}
              options={[
                { value: '', label: 'Selecione…' },
                ...pythonApps.map(app => ({ value: app.socket, label: `${app.name} — ${app.socket}` })),
              ]}
            />
          ) : (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              Nenhuma aplicação gerenciada encontrada. Crie-a primeiro na tela
              de <strong>Python</strong>; o painel gera o socket que este site vai consumir.
            </p>
          )
        )}

        {(type === 'proxy' || isSocketBased) && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={websocket}
              onChange={e => setWebsocket(e.target.checked)}
              className="rounded"
            />
            <span className="text-[var(--text-secondary)]">Suporte a WebSocket</span>
          </label>
        )}

        <Input
          label="Tamanho máximo de upload"
          value={clientMaxBodySize}
          onChange={e => setClientMaxBodySize(e.target.value)}
          placeholder="64M"
        />
        {isPhp && clientMaxBodySize && (
          <p className="text-xs text-[var(--text-muted)] -mt-2">
            Os limites do PHP (<span className="font-mono">upload_max_filesize</span> e
            <span className="font-mono"> post_max_size</span>) acompanham este valor automaticamente.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {site ? 'Atualizar' : 'Criar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
