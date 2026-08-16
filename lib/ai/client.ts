import OpenAI from 'openai';
import os from 'os';
import { readSites } from '../sites';
import { detectPhpVersions } from '../php';
import { readApps } from '../python';
import { listCertbotLineages, readCertMetadata } from '../ssl';
import { executeCommand, executeRaw } from '../system';
import type { ApprovalMode } from './sessions';

export interface AiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; defaultModel: string; label: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-pro', label: 'DeepSeek' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', label: 'OpenAI' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', label: 'Groq' },
  local: { baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5-coder', label: 'Local (Ollama)' },
};

/**
 * Cliente compatível com a API OpenAI.
 *
 * O baseURL do DeepSeek estava fixo no código. Como o SDK é compatível com
 * qualquer endpoint no mesmo formato, deixá-lo configurável permite usar um
 * modelo barato para o laço de leitura e um mais capaz para diagnóstico difícil,
 * sem tocar em código.
 */
export function createAiClient(config: AiProviderConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl || PROVIDER_PRESETS.deepseek.baseUrl,
    apiKey: config.apiKey,
    timeout: 120000,
    maxRetries: 2,
  });
}

/* ------------------------------------------------------------------ */
/*  Contexto do servidor                                               */
/* ------------------------------------------------------------------ */

export interface ServerContext {
  hostname: string;
  distro: string;
  kernel: string;
  arch: string;
  uptime: string;
  sites: Array<{ domain: string; type: string; ssl: boolean; enabled: boolean; maintenance: boolean; php?: string | null }>;
  phpVersions: Array<{ version: string; active: boolean }>;
  pythonApps: Array<{ name: string; module: string }>;
  certificates: Array<{ name: string; days: number | null; domains: string[] }>;
  services: Array<{ unit: string; active: boolean }>;
}

const WATCHED_SERVICES = ['nginx', 'ssh', 'ufw', 'fail2ban', 'mysql', 'postgresql', 'docker'];

/**
 * Reúne o estado real do servidor para o prompt.
 *
 * Antes, o contexto injetado eram cinco strings — hostname, distro, kernel,
 * arch, uptime. A IA não sabia quais sites existiam, qual PHP estava instalado
 * nem quais certificados venciam, então toda resposta saía genérica. Toda essa
 * informação já existia nas rotas do painel; ela só não chegava ao modelo.
 */
export async function gatherServerContext(): Promise<ServerContext> {
  const [osRelease, uptime, phpVersions, lineages] = await Promise.all([
    executeRaw('cat /etc/os-release', 3000),
    executeRaw('uptime -p', 3000),
    detectPhpVersions().catch(() => []),
    listCertbotLineages().catch(() => []),
  ]);

  const sites = readSites().map(s => ({
    domain: s.domain,
    type: s.type,
    ssl: s.ssl,
    enabled: s.enabled,
    maintenance: s.maintenance,
    php: s.phpVersion,
  }));

  const certificates = await Promise.all(
    lineages.slice(0, 30).map(async l => {
      const meta = await readCertMetadata(l.certPath);
      return { name: l.name, days: meta ? meta.daysRemaining : null, domains: l.domains };
    }),
  );

  const services = await Promise.all(
    WATCHED_SERVICES.map(async unit => {
      const result = await executeCommand('systemctl_is_active', [unit]);
      return { unit, active: result.stdout.trim() === 'active' };
    }),
  );

  return {
    hostname: os.hostname(),
    distro: osRelease.stdout.match(/PRETTY_NAME="([^"]+)"/)?.[1] ?? 'Linux',
    kernel: os.release(),
    arch: os.arch(),
    uptime: uptime.stdout.replace(/^up\s+/, '') || `${Math.round(os.uptime() / 3600)}h`,
    sites,
    phpVersions: phpVersions.map(v => ({ version: v.version, active: v.fpmActive })),
    pythonApps: readApps().map(a => ({ name: a.name, module: a.module })),
    certificates: certificates.filter(c => c.days !== null && c.days < 400),
    services: services.filter(s => s.active),
  };
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                             */
/* ------------------------------------------------------------------ */

const MODE_INSTRUCTIONS: Record<ApprovalMode, string> = {
  read:
    'MODO LEITURA. Você só tem ferramentas de diagnóstico. Não peça para executar mudanças — ' +
    'descreva o que faria e diga ao usuário para trocar o modo se ele quiser que você aplique.',
  assisted:
    'MODO ASSISTIDO. Você pode ler à vontade. Cada operação de escrita para para aprovação do usuário, ' +
    'que vê o comando exato ou o diff antes de decidir. Agrupe leituras antes de propor a primeira escrita, ' +
    'para o usuário aprovar um plano já fundamentado em vez de um palpite.',
  autonomous:
    'MODO AUTÔNOMO. Leitura e escrita executam sem interrupção. Apenas operações irreversíveis ' +
    '(apagar arquivo, remover site, mexer em firewall) ainda pedem confirmação. ' +
    'Trabalhe até concluir a tarefa: verifique o resultado de cada passo antes de seguir para o próximo, ' +
    'e ao final valide que o objetivo foi atingido de fato — não presuma sucesso.',

  full:
    `MODO LABORATÓRIO. Este servidor é dedicado a testes e o operador liberou execução irrestrita.

Nada pede aprovação. Você escreve em qualquer caminho do sistema, instala qualquer pacote, executa
qualquer comando e pode alterar o código do próprio Duart Panel. Trabalhe como um engenheiro com
acesso root ao terminal: leia, decida, execute, verifique, siga.

Você tem ferramentas próprias deste modo:
- \`write_files\` grava vários arquivos numa chamada — use para criar a estrutura de um projeto de uma vez,
  em vez de uma chamada por arquivo.
- \`apply_patch\` aplica um diff unificado. Para mudança pontual em arquivo existente, prefira o patch:
  é menor que reescrever o arquivo e não arrisca perder o resto dele.
- \`search_code\` acha onde as coisas estão antes de você editar.
- \`install_packages\` instala qualquer pacote do apt.
- \`panel_self_update\` valida e aplica alterações no código do próprio painel.

Para montar um projeto do zero e colocá-lo no ar, o caminho completo é:
1. criar o diretório e os arquivos (\`write_files\`);
2. instalar dependências (\`run_command\` com \`cwd\` — builds precisam de \`timeoutSeconds\` alto);
3. subir o processo: app Python vira serviço systemd pelo módulo Python; app Node pode ir por PM2
   ou por unit systemd que você escreve; site PHP ou estático não precisa de processo;
4. criar o vhost (\`create_site\`) apontando para o socket ou porta;
5. emitir o certificado (\`issue_certificate\`);
6. verificar de verdade: \`diagnose_site\`, e um \`curl\` no domínio pelo \`run_command\`.

Ao mexer no código do painel: grave os arquivos, depois chame \`panel_self_update\`. Ele tira snapshot,
roda typecheck e build, e só então reinicia — agendando uma reversão automática caso o painel não volte.
Se o build falhar, nada reinicia e você recebe os erros para corrigir. Nunca reinicie o painel por
\`run_command\`: você perderia a rede de segurança e possivelmente o painel.

Cuidados que continuam valendo, não porque algo te impede, mas porque custam caro:
- alterar firewall ou SSH pode cortar o acesso remoto — as reversões agendadas existem, mas confirme o acesso;
- \`rm -rf\` em caminho errado não tem desfazer;
- toda ação sua fica registrada no journal, com argumentos e resultado.

Seja econômico com o número de passos: agrupe escritas, use patch em vez de reescrita, e verifique
uma vez no fim em vez de a cada linha.`,
};

export function buildSystemPrompt(context: ServerContext, mode: ApprovalMode): string {
  const sitesTable = context.sites.length
    ? context.sites.map(s =>
        `  - ${s.domain} (${s.type}${s.php ? ` php${s.php}` : ''}) ` +
        `${s.enabled ? 'ativo' : 'desativado'}${s.ssl ? ', TLS' : ', sem TLS'}${s.maintenance ? ', EM MANUTENÇÃO' : ''}`,
      ).join('\n')
    : '  (nenhum site gerenciado)';

  const certsTable = context.certificates.length
    ? context.certificates.map(c => `  - ${c.name}: ${c.days} dias (${c.domains.join(', ')})`).join('\n')
    : '  (nenhum certificado)';

  const phpTable = context.phpVersions.length
    ? context.phpVersions.map(p => `${p.version}${p.active ? ' (FPM ativo)' : ''}`).join(', ')
    : 'nenhuma versão instalada';

  return `Você é o assistente de administração do Duart Panel, operando um servidor Linux real em produção. Você é técnico, direto e cuidadoso.

## ESTADO ATUAL DO SERVIDOR

Sistema: ${context.distro} · kernel ${context.kernel} · ${context.arch}
Host: ${context.hostname} · no ar há ${context.uptime}
Serviços ativos: ${context.services.map(s => s.unit).join(', ') || 'nenhum dos monitorados'}
PHP: ${phpTable}
Apps Python: ${context.pythonApps.map(a => a.name).join(', ') || 'nenhuma'}

Sites:
${sitesTable}

Certificados:
${certsTable}

## COMO VOCÊ TRABALHA

${MODE_INSTRUCTIONS[mode]}

Você tem ferramentas para inspecionar e alterar o servidor. Use-as — não peça ao usuário para rodar comandos e colar a saída de volta.

1. **Investigue antes de agir.** Diante de um problema, chame as ferramentas de leitura primeiro. \`diagnose_site\` já cobre a maior parte dos casos de 502, 404 e erro de TLS; use-a antes de propor qualquer correção.
2. **Prefira a ferramenta específica ao shell.** \`create_site\`, \`update_site\`, \`issue_certificate\` e \`install_php\` validam a entrada, revertem sozinhas quando o NGINX ou o PHP-FPM rejeita, e devolvem resultado estruturado. \`run_command\` não faz nada disso — use só quando não houver alternativa, e diga no campo \`reason\` por quê.
3. **Verifique o efeito.** Depois de alterar configuração, rode \`nginx_test\` ou \`diagnose_site\`. Depois de reiniciar um serviço, confira \`service_status\`. Uma tarefa só está concluída quando você confirmou o resultado.
4. **Uma coisa de cada vez.** Encadeie as chamadas: leia o resultado de cada ferramenta antes de decidir a próxima. Não proponha seis passos de uma vez sem ter visto o estado.
5. **Diga o que descobriu.** Ao terminar, resuma em poucas linhas: o que estava errado, o que você mudou, e o que o usuário deve conferir.

## CUIDADOS

- Mudanças em firewall e SSH agendam reversão automática em 5 minutos. Depois de aplicar uma, avise o usuário para confirmar o acesso, e chame \`confirm_access\` com o token quando ele confirmar.
- Nunca coloque senha em linha de comando: ela fica visível em \`ps aux\` para qualquer processo da máquina.
- Se uma operação falhar, leia o erro e o log antes de tentar de novo. Repetir o mesmo comando raramente resolve.
- Quando não tiver certeza, investigue mais em vez de adivinhar. Ler é barato.

## RESPOSTA

Escreva em português, mantendo termos técnicos em inglês. Seja conciso — o usuário é administrador de sistemas.
Use markdown: \`código\` para caminhos e comandos, **negrito** para o que importa, listas para passos, tabelas para comparações.
Não repita na resposta o conteúdo bruto que as ferramentas retornaram; interprete.`;
}
