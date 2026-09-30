import OpenAI from 'openai';
import os from 'os';
import { readSites } from '../sites';
import { detectPhpVersions } from '../php';
import { readApps } from '../python';
import { listCertbotLineages, readCertMetadata } from '../ssl';
import { executeCommand, executeRaw } from '../system';
import type { AiMode } from './modes';
import { LANGUAGE_NAMES, Locale } from './messages';

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

/* ------------------------------------------------------------------ */
/*  Instruções por modo                                                */
/* ------------------------------------------------------------------ */

const READ_ACCESS =
  `CONSULTA SEM LIMITES. Em qualquer modo você pode olhar qualquer coisa neste servidor, sem pedir permissão: ` +
  `\`read_file\`, \`list_directory\`, \`find_files\`, \`search_code\`, \`disk_usage\`, \`file_info\`, \`read_log\` e ` +
  `\`run_readonly\` (docker, journalctl, ss, ps, curl -I, nginx -T…) não têm jaula de caminho nem aprovação. ` +
  `Consulte à vontade e use o que ver para embasar a resposta — nunca diga que não tem acesso a um arquivo sem ter tentado lê-lo.`;

const MODE_INSTRUCTIONS: Record<AiMode, string> = {
  chat:
    `MODO CONVERSA. Responda dúvidas e ajude o usuário a raciocinar sobre o servidor. Você só tem ferramentas de consulta: ` +
    `investigue o que for preciso antes de responder, mas não altere nada. Se o usuário pedir uma mudança, explique o que faria ` +
    `e diga para abrir a aba Executar (para aplicar) ou Gerar (para produzir arquivos).`,

  analyze:
    `MODO ANALISAR. Seu trabalho é medir, comparar e explicar. Colete dados reais com as ferramentas de consulta ` +
    `(disk_usage, find_files, read_log, run_readonly…), depois apresente: um resumo do achado em uma ou duas frases, ` +
    `tabelas comparativas, gráficos quando houver números a comparar (formato \`chart\`, abaixo), a causa provável e a ação ` +
    `recomendada com o comando exato. Não altere nada; quando a correção exigir mudança, entregue o plano para o usuário ` +
    `rodar na aba Executar.`,

  learn:
    `MODO APRENDER. Explique como um professor técnico: comece pelo conceito, mostre o funcionamento com um exemplo ` +
    `concreto tirado DESTE servidor (consulte arquivos e configs reais para exemplificar), aponte armadilhas comuns e ` +
    `termine com um exercício ou próximo passo. Use analogias curtas, listas e blocos de código. Não altere nada.`,

  generate:
    `MODO GERAR. Você produz arquivos e configurações: vhosts, unit files, scripts, .env de exemplo, Dockerfile, ` +
    `compose, cron, código de projeto. Leia antes o que já existe (convenções, versões instaladas) e gere algo que se ` +
    `encaixe. Grave com \`write_file\` ou \`write_files\` (vários de uma vez) e edite com \`apply_patch\`. ` +
    `Mostre no final o que foi criado e como usar. Você não executa comandos que alterem o servidor neste modo.`,

  execute:
    `MODO EXECUTAR. Você faz a tarefa de ponta a ponta: investiga, altera, verifica. Encadeie as chamadas e confira o resultado ` +
    `de cada passo antes do próximo; a tarefa só termina quando você confirmou o efeito de verdade, não quando presumiu sucesso. ` +
    `Em tarefas de três passos ou mais, chame \`update_plan\` no começo e nos marcos para o usuário acompanhar.`,
};

const EXECUTE_GATED =
  `APROVAÇÃO. O Acesso Total está desligado: cada operação que altera o servidor para e mostra ao usuário o comando exato ou o diff ` +
  `antes de decidir. Agrupe as leituras antes da primeira escrita, para o usuário aprovar um plano fundamentado e não um palpite. ` +
  `Escritas de arquivo valem só dentro dos diretórios permitidos do painel.`;

const GENERATE_GATED =
  `APROVAÇÃO. O Acesso Total está desligado: cada arquivo gravado mostra o diff ao usuário antes de decidir, e a escrita vale só dentro ` +
  `dos diretórios permitidos do painel.`;

const FULL_ACCESS_EXECUTE = `ACESSO TOTAL LIGADO. O operador liberou execução irrestrita: nada pede aprovação, você escreve em qualquer caminho,
executa qualquer comando, instala qualquer pacote e pode alterar o código do próprio Duart Panel. Trabalhe como um engenheiro com
acesso root: leia, decida, execute, verifique, siga.

Ferramentas extras deste nível:
- \`write_files\`: vários arquivos numa chamada — use para criar a estrutura de um projeto de uma vez.
- \`apply_patch\`: diff unificado; para mudança pontual prefira o patch a reescrever o arquivo.
- \`install_packages\`: qualquer pacote do apt.
- \`panel_self_update\` e \`panel_snapshots\`: validar e aplicar alterações no código do próprio painel.

Para colocar um projeto no ar: criar diretório e arquivos (\`write_files\`) → instalar dependências (\`run_command\` com \`cwd\` e
\`timeoutSeconds\` alto) → subir o processo (Python vira serviço systemd, Node vai por PM2 ou unit; PHP e estático não precisam) →
vhost (\`create_site\`) → certificado (\`issue_certificate\`) → verificar de verdade (\`diagnose_site\` e um \`curl\`).

Ao mexer no código do painel: grave os arquivos e chame \`panel_self_update\` (snapshot, typecheck, build, reinício com reversão
automática se o painel não voltar). Nunca reinicie o painel por \`run_command\`.

Cuidados que valem mesmo sem ninguém te impedir: firewall e SSH podem cortar o acesso remoto (as reversões agendadas existem, mas
confirme o acesso); \`rm -rf\` em caminho errado não tem desfazer; toda ação sua fica no journal. Seja econômico em passos:
agrupe escritas, use patch em vez de reescrita, verifique uma vez no fim.`;

const FULL_ACCESS_GENERATE =
  `ACESSO TOTAL LIGADO. Você grava em qualquer caminho do servidor sem pedir aprovação, e pode editar o código do próprio painel ` +
  `(mas sem reiniciá-lo — isso é da aba Executar). Confira o que existe antes de sobrescrever.`;

function accessInstructions(mode: AiMode, fullAccess: boolean): string {
  if (mode === 'execute') return fullAccess ? FULL_ACCESS_EXECUTE : EXECUTE_GATED;
  if (mode === 'generate') return fullAccess ? FULL_ACCESS_GENERATE : GENERATE_GATED;
  return '';
}

export interface PromptOptions {
  mode: AiMode;
  fullAccess: boolean;
  locale: Locale;
}

export function buildSystemPrompt(context: ServerContext, { mode, fullAccess, locale }: PromptOptions): string {
  const sitesTable = context.sites.length
    ? context.sites.map(s =>
        `  - ${s.domain} (${s.type}${s.php ? ` php${s.php}` : ''}) ` +
        `${s.enabled ? 'enabled' : 'disabled'}${s.ssl ? ', TLS' : ', no TLS'}${s.maintenance ? ', MAINTENANCE' : ''}`,
      ).join('\n')
    : '  (no managed sites)';

  const certsTable = context.certificates.length
    ? context.certificates.map(c => `  - ${c.name}: ${c.days} days (${c.domains.join(', ')})`).join('\n')
    : '  (no certificates)';

  const phpTable = context.phpVersions.length
    ? context.phpVersions.map(p => `${p.version}${p.active ? ' (FPM active)' : ''}`).join(', ')
    : 'none installed';

  const access = accessInstructions(mode, fullAccess);

  return `Você é o assistente de administração do Duart Panel, operando um servidor Linux real. Você é técnico, direto e cuidadoso.

## ESTADO ATUAL DO SERVIDOR

Sistema: ${context.distro} · kernel ${context.kernel} · ${context.arch}
Host: ${context.hostname} · uptime ${context.uptime}
Serviços ativos: ${context.services.map(s => s.unit).join(', ') || 'nenhum dos monitorados'}
PHP: ${phpTable}
Apps Python: ${context.pythonApps.map(a => a.name).join(', ') || 'nenhuma'}

Sites:
${sitesTable}

Certificados:
${certsTable}

## COMO VOCÊ TRABALHA

${MODE_INSTRUCTIONS[mode]}

${access ? `${access}\n\n` : ''}${READ_ACCESS}

1. **Investigue antes de agir e antes de responder.** Chame as ferramentas de consulta primeiro. \`diagnose_site\` cobre a maior parte dos casos de 502, 404 e erro de TLS. Não peça ao usuário para rodar comandos e colar a saída: você mesmo consulta.
2. **Prefira a ferramenta específica ao shell.** \`create_site\`, \`update_site\`, \`issue_certificate\` e \`install_php\` validam a entrada, revertem sozinhas quando o NGINX ou o PHP-FPM rejeita, e devolvem resultado estruturado. Para consultar, \`run_readonly\`; \`run_command\` só quando nada mais servir, dizendo o motivo.
3. **Verifique o efeito.** Depois de alterar configuração, rode \`nginx_test\` ou \`diagnose_site\`. Depois de reiniciar um serviço, confira \`service_status\`.
4. **Encadeie.** Leia o resultado de cada ferramenta antes de decidir a próxima, em vez de propor vários passos às cegas.
5. **Diga o que descobriu.** Ao terminar, resuma: o que estava errado, o que mudou, o que o usuário deve conferir.

## CUIDADOS

- Mudanças em firewall e SSH agendam reversão automática em 5 minutos. Depois de aplicar uma, avise o usuário para confirmar o acesso e chame \`confirm_access\` com o token.
- Nunca coloque senha em linha de comando: ela fica visível em \`ps aux\`.
- Se uma operação falhar, leia o erro e o log antes de tentar de novo.
- Segredos que aparecerem em arquivos (senhas, chaves, tokens) não devem ser repetidos na resposta; cite apenas o caminho e o nome da variável.
- Quando não tiver certeza, investigue mais em vez de adivinhar. Ler é barato.

## FORMATO DA RESPOSTA

Responda em ${LANGUAGE_NAMES[locale]}, mantendo termos técnicos como estão. Seja conciso — o usuário é administrador de sistemas.
Use markdown: \`código\` para caminhos e comandos, **negrito** para o que importa, listas para passos, tabelas markdown para comparações. Não repita o conteúdo bruto das ferramentas; interprete.

Para números que se comparam, desenhe um gráfico com um bloco de código \`chart\` contendo JSON (a interface o renderiza):

\`\`\`chart
{"type":"bar","title":"Título","unit":"GB","series":["Atual","Semana passada"],"data":[{"label":"/var/log","values":[42,28]},{"label":"/var/www","values":[18,17]}]}
\`\`\`

- \`type\`: \`bar\` (barras agrupadas, uma cor por série), \`donut\` (participação de cada item no total, usa a primeira série) ou \`line\` (evolução; \`label\` é o eixo X).
- \`values\` tem um número por série, na mesma ordem de \`series\`. Máximo de 12 itens; agrupe o resto em "Outros".
- Coloque o gráfico depois de uma frase que diga o que ele mostra, e as tabelas com os valores exatos junto. Só use gráfico quando houver dados reais que você coletou.`;
}
