/**
 * Textos que o servidor mostra ao usuário (erros do laço e resumos de
 * aprovação), nos idiomas do painel.
 *
 * O que vai para o modelo (resultado de ferramenta, mensagens de erro de
 * `execute`) não passa por aqui: o modelo entende qualquer idioma e responde no
 * idioma pedido no prompt.
 */

export type Locale = 'pt-BR' | 'en-US' | 'es-ES';

export const LOCALES: Locale[] = ['pt-BR', 'en-US', 'es-ES'];

export function normalizeLocale(value: unknown): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : 'pt-BR';
}

export const LANGUAGE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'en-US': 'English',
  'es-ES': 'Spanish',
};

const MESSAGES: Record<string, Record<Locale, string>> = {
  /* ---------- Erros do laço ---------- */
  'error.noApiKey': {
    'pt-BR': 'Chave de API não configurada. Defina-a em Configurações.',
    'en-US': 'API key not configured. Set it in Settings.',
    'es-ES': 'Clave de API no configurada. Defínala en Configuración.',
  },
  'error.auth': {
    'pt-BR': 'Chave de API inválida ou sem permissão. Verifique em Configurações.',
    'en-US': 'Invalid API key or missing permission. Check it in Settings.',
    'es-ES': 'Clave de API inválida o sin permiso. Revísela en Configuración.',
  },
  'error.rateLimit': {
    'pt-BR': 'Limite ou saldo do provedor atingido. Verifique a conta e aguarde alguns segundos.',
    'en-US': 'Provider limit or balance reached. Check the account and wait a few seconds.',
    'es-ES': 'Se alcanzó el límite o el saldo del proveedor. Revise la cuenta y espere unos segundos.',
  },
  'error.timeout': {
    'pt-BR': 'Timeout na conexão com o provedor de IA. Tente novamente.',
    'en-US': 'Timeout connecting to the AI provider. Try again.',
    'es-ES': 'Tiempo de espera agotado con el proveedor de IA. Inténtelo de nuevo.',
  },
  'error.badHistory': {
    'pt-BR': 'O histórico desta conversa continha uma mensagem inválida. Ela foi removida automaticamente — envie a mensagem novamente. Se voltar a acontecer, o contexto está no limite: comece uma conversa nova.',
    'en-US': 'This conversation history contained an invalid message. It was removed automatically — send your message again. If it happens again the context is at its limit: start a new conversation.',
    'es-ES': 'El historial de esta conversación contenía un mensaje inválido. Se eliminó automáticamente: envíe el mensaje de nuevo. Si vuelve a ocurrir, el contexto está al límite: inicie una conversación nueva.',
  },
  'error.noFunctionCalling': {
    'pt-BR': 'O modelo configurado ({model}) não suporta function calling, que é o que permite à IA usar ferramentas. Escolha outro modelo em Configurações.',
    'en-US': 'The configured model ({model}) does not support function calling, which is what lets the AI use tools. Pick another model in Settings.',
    'es-ES': 'El modelo configurado ({model}) no soporta function calling, que es lo que permite a la IA usar herramientas. Elija otro modelo en Configuración.',
  },
  'error.context': {
    'pt-BR': 'O contexto da conversa excedeu o limite do modelo. As trocas mais antigas foram descartadas — reenvie a mensagem, ou comece uma conversa nova para a próxima etapa.',
    'en-US': 'The conversation context exceeded the model limit. Older exchanges were dropped — resend the message, or start a new conversation for the next step.',
    'es-ES': 'El contexto de la conversación superó el límite del modelo. Se descartaron los intercambios más antiguos: reenvíe el mensaje o inicie una conversación nueva para el siguiente paso.',
  },
  'error.modelNotFound': {
    'pt-BR': 'O provedor não reconhece o modelo "{model}". Confira o identificador em Configurações → Integração IA.',
    'en-US': 'The provider does not recognize the model "{model}". Check the identifier in Settings → AI Integration.',
    'es-ES': 'El proveedor no reconoce el modelo "{model}". Revise el identificador en Configuración → Integración IA.',
  },
  'error.emptyLength': {
    'pt-BR': 'A resposta foi cortada pelo limite de tokens antes de produzir qualquer conteúdo. O contexto provavelmente está grande demais — comece uma conversa nova para esta etapa. Nada foi perdido.',
    'en-US': 'The response was cut by the token limit before producing any content. The context is probably too large — start a new conversation for this step. Nothing was lost.',
    'es-ES': 'La respuesta se cortó por el límite de tokens antes de producir contenido. El contexto probablemente es demasiado grande: inicie una conversación nueva. No se perdió nada.',
  },
  'error.emptyFiltered': {
    'pt-BR': 'O provedor filtrou a resposta. Nada foi perdido — a conversa segue utilizável.',
    'en-US': 'The provider filtered the response. Nothing was lost — the conversation is still usable.',
    'es-ES': 'El proveedor filtró la respuesta. No se perdió nada: la conversación sigue siendo utilizable.',
  },
  'error.emptyReasoning': {
    'pt-BR': 'O modelo raciocinou mas não emitiu resposta nem chamada de ferramenta. Costuma acontecer quando o contexto está no limite. Nada foi perdido.',
    'en-US': 'The model reasoned but produced neither an answer nor a tool call. This usually happens when the context is at its limit. Nothing was lost.',
    'es-ES': 'El modelo razonó pero no emitió respuesta ni llamada a herramienta. Suele ocurrir cuando el contexto está al límite. No se perdió nada.',
  },
  'error.emptyGeneric': {
    'pt-BR': 'O modelo devolveu um turno vazio (finish_reason: {reason}). Nada foi perdido — a conversa segue utilizável.',
    'en-US': 'The model returned an empty turn (finish_reason: {reason}). Nothing was lost — the conversation is still usable.',
    'es-ES': 'El modelo devolvió un turno vacío (finish_reason: {reason}). No se perdió nada: la conversación sigue siendo utilizable.',
  },
  'error.iterationLimit': {
    'pt-BR': 'Limite de {n} passos atingido. Peça para continuar se a tarefa não terminou.',
    'en-US': 'Step limit of {n} reached. Ask it to continue if the task is not finished.',
    'es-ES': 'Se alcanzó el límite de {n} pasos. Pida que continúe si la tarea no terminó.',
  },
  'error.trimmed': {
    'pt-BR': '{n} troca(s) antiga(s) saíram do contexto para caber no limite do modelo.',
    'en-US': '{n} older exchange(s) left the context to fit the model limit.',
    'es-ES': '{n} intercambio(s) antiguo(s) salieron del contexto para caber en el límite del modelo.',
  },
  'error.generic': {
    'pt-BR': 'Erro na comunicação com a IA.',
    'en-US': 'Error communicating with the AI.',
    'es-ES': 'Error de comunicación con la IA.',
  },
  'error.needInput': {
    'pt-BR': 'Envie uma mensagem ou uma decisão de aprovação.',
    'en-US': 'Send a message or an approval decision.',
    'es-ES': 'Envíe un mensaje o una decisión de aprobación.',
  },
  'error.methodNotAllowed': {
    'pt-BR': 'Método não permitido',
    'en-US': 'Method not allowed',
    'es-ES': 'Método no permitido',
  },

  /* ---------- Resumos de aprovação ---------- */
  'preview.noChanges': {
    'pt-BR': '(sem alterações)',
    'en-US': '(no changes)',
    'es-ES': '(sin cambios)',
  },
  'preview.noChangesFile': {
    'pt-BR': '(sem alterações no arquivo)',
    'en-US': '(no changes to the file)',
    'es-ES': '(sin cambios en el archivo)',
  },
  'preview.unavailable': {
    'pt-BR': '{tool} (pré-visualização indisponível)',
    'en-US': '{tool} (preview unavailable)',
    'es-ES': '{tool} (vista previa no disponible)',
  },
  'preview.run': {
    'pt-BR': 'Executar {tool}',
    'en-US': 'Run {tool}',
    'es-ES': 'Ejecutar {tool}',
  },
  'preview.createFile': {
    'pt-BR': 'Criar {path} ({diff})',
    'en-US': 'Create {path} ({diff})',
    'es-ES': 'Crear {path} ({diff})',
  },
  'preview.changeFile': {
    'pt-BR': 'Alterar {path} ({diff})',
    'en-US': 'Change {path} ({diff})',
    'es-ES': 'Modificar {path} ({diff})',
  },
  'preview.createSite': {
    'pt-BR': 'Criar site {domain} ({type})',
    'en-US': 'Create site {domain} ({type})',
    'es-ES': 'Crear sitio {domain} ({type})',
  },
  'preview.site.domain': { 'pt-BR': 'Domínio', 'en-US': 'Domain', 'es-ES': 'Dominio' },
  'preview.site.type': { 'pt-BR': 'Tipo', 'en-US': 'Type', 'es-ES': 'Tipo' },
  'preview.site.root': { 'pt-BR': 'Raiz', 'en-US': 'Root', 'es-ES': 'Raíz' },
  'preview.site.upstream': { 'pt-BR': 'Porta do upstream', 'en-US': 'Upstream port', 'es-ES': 'Puerto del upstream' },
  'preview.site.php': {
    'pt-BR': 'PHP: {version} · pool dedicado',
    'en-US': 'PHP: {version} · dedicated pool',
    'es-ES': 'PHP: {version} · pool dedicado',
  },
  'preview.site.phpDetected': { 'pt-BR': 'versão detectada', 'en-US': 'detected version', 'es-ES': 'versión detectada' },
  'preview.site.aliases': { 'pt-BR': 'Aliases', 'en-US': 'Aliases', 'es-ES': 'Alias' },
  'preview.updateSite': {
    'pt-BR': 'Atualizar {domain} ({diff})',
    'en-US': 'Update {domain} ({diff})',
    'es-ES': 'Actualizar {domain} ({diff})',
  },
  'preview.maintenance': {
    'pt-BR': 'Manutenção {state} em {domain}',
    'en-US': 'Maintenance {state} on {domain}',
    'es-ES': 'Mantenimiento {state} en {domain}',
  },
  'preview.maintenanceOn': {
    'pt-BR': 'Ativar manutenção em {domain}',
    'en-US': 'Turn maintenance on for {domain}',
    'es-ES': 'Activar mantenimiento en {domain}',
  },
  'preview.maintenanceOff': {
    'pt-BR': 'Desativar manutenção em {domain}',
    'en-US': 'Turn maintenance off for {domain}',
    'es-ES': 'Desactivar mantenimiento en {domain}',
  },
  'preview.bypassIps': {
    'pt-BR': 'IPs liberados: {ips}',
    'en-US': 'Allowed IPs: {ips}',
    'es-ES': 'IPs permitidas: {ips}',
  },
  'preview.enableSite': { 'pt-BR': 'Habilitar {domain}', 'en-US': 'Enable {domain}', 'es-ES': 'Habilitar {domain}' },
  'preview.disableSite': { 'pt-BR': 'Desabilitar {domain}', 'en-US': 'Disable {domain}', 'es-ES': 'Deshabilitar {domain}' },
  'preview.enableSiteLong': {
    'pt-BR': 'Habilitar o site {domain}',
    'en-US': 'Enable the site {domain}',
    'es-ES': 'Habilitar el sitio {domain}',
  },
  'preview.disableSiteLong': {
    'pt-BR': 'Desabilitar o site {domain}',
    'en-US': 'Disable the site {domain}',
    'es-ES': 'Deshabilitar el sitio {domain}',
  },
  'preview.serviceAction': {
    'pt-BR': '{action} no serviço {unit}',
    'en-US': '{action} on service {unit}',
    'es-ES': '{action} en el servicio {unit}',
  },
  'preview.installPhp': {
    'pt-BR': 'Instalar PHP {version} ({count} pacotes)',
    'en-US': 'Install PHP {version} ({count} packages)',
    'es-ES': 'Instalar PHP {version} ({count} paquetes)',
  },
  'preview.issueCert': {
    'pt-BR': 'Emitir certificado para {domains}',
    'en-US': 'Issue certificate for {domains}',
    'es-ES': 'Emitir certificado para {domains}',
  },
  'preview.pythonApp': {
    'pt-BR': '{action} na aplicação {name}',
    'en-US': '{action} on application {name}',
    'es-ES': '{action} en la aplicación {name}',
  },
  'preview.runCommand': { 'pt-BR': 'Executar comando', 'en-US': 'Run command', 'es-ES': 'Ejecutar comando' },
  'preview.irreversibleCommand': {
    'pt-BR': '⚠ Comando irreversível: {reasons}',
    'en-US': '⚠ Irreversible command: {reasons}',
    'es-ES': '⚠ Comando irreversible: {reasons}',
  },
  'preview.confirmAccess': {
    'pt-BR': 'Confirmar acesso e cancelar reversão',
    'en-US': 'Confirm access and cancel rollback',
    'es-ES': 'Confirmar acceso y cancelar reversión',
  },
  'preview.confirmAccessBody': {
    'pt-BR': 'Cancelar a reversão automática agendada (token {token}).',
    'en-US': 'Cancel the scheduled automatic rollback (token {token}).',
    'es-ES': 'Cancelar la reversión automática programada (token {token}).',
  },
  'preview.deleteFile': { 'pt-BR': 'Apagar {path}', 'en-US': 'Delete {path}', 'es-ES': 'Eliminar {path}' },
  'preview.deleteFileBody': {
    'pt-BR': 'Remover {path} ({size} bytes). Esta operação não tem desfazer.',
    'en-US': 'Remove {path} ({size} bytes). This cannot be undone.',
    'es-ES': 'Eliminar {path} ({size} bytes). Esta operación no se puede deshacer.',
  },
  'preview.removeSite': { 'pt-BR': 'Remover site {domain}', 'en-US': 'Remove site {domain}', 'es-ES': 'Eliminar sitio {domain}' },
  'preview.removeSiteBody': {
    'pt-BR': 'Remover o vhost {config}, o symlink e o pool PHP de {domain}.\nOs arquivos em {root} são preservados.',
    'en-US': 'Remove the vhost {config}, the symlink and the PHP pool of {domain}.\nFiles in {root} are preserved.',
    'es-ES': 'Eliminar el vhost {config}, el symlink y el pool PHP de {domain}.\nLos archivos en {root} se conservan.',
  },
  'preview.noRoot': { 'pt-BR': '(sem root)', 'en-US': '(no root)', 'es-ES': '(sin root)' },
  'preview.siteNotFound': {
    'pt-BR': 'Site {domain} não encontrado.',
    'en-US': 'Site {domain} not found.',
    'es-ES': 'Sitio {domain} no encontrado.',
  },
  'preview.firewall': {
    'pt-BR': 'Firewall: {action} {rule} (reversão automática em 5 min)',
    'en-US': 'Firewall: {action} {rule} (automatic rollback in 5 min)',
    'es-ES': 'Firewall: {action} {rule} (reversión automática en 5 min)',
  },
  'preview.writeFiles': {
    'pt-BR': 'Gravar {count} arquivo(s)',
    'en-US': 'Write {count} file(s)',
    'es-ES': 'Escribir {count} archivo(s)',
  },
  'preview.noFiles': { 'pt-BR': '(nenhum arquivo)', 'en-US': '(no files)', 'es-ES': '(ningún archivo)' },
  'preview.fileEdit': { 'pt-BR': 'altera', 'en-US': 'edit  ', 'es-ES': 'edita ' },
  'preview.fileCreate': { 'pt-BR': ' cria ', 'en-US': 'create', 'es-ES': ' crea ' },
  'preview.applyPatch': {
    'pt-BR': 'Aplicar patch em {dir}',
    'en-US': 'Apply patch in {dir}',
    'es-ES': 'Aplicar patch en {dir}',
  },
  'preview.panelDir': {
    'pt-BR': 'diretório do painel',
    'en-US': 'panel directory',
    'es-ES': 'directorio del panel',
  },
  'preview.installPackages': {
    'pt-BR': 'Instalar {count} pacote(s)',
    'en-US': 'Install {count} package(s)',
    'es-ES': 'Instalar {count} paquete(s)',
  },
  'preview.selfUpdate': {
    'pt-BR': 'Auto-atualizar o painel: {summary}',
    'en-US': 'Self-update the panel: {summary}',
    'es-ES': 'Autoactualizar el panel: {summary}',
  },
  'preview.selfUpdateBody': {
    'pt-BR': 'Alteração no código do painel: {summary}\n\nSequência: snapshot → tsc --noEmit → next build → reinício agendado → verificação em 25s.\nSe o painel não responder depois do reinício, o snapshot é restaurado automaticamente.',
    'en-US': 'Panel code change: {summary}\n\nSequence: snapshot → tsc --noEmit → next build → scheduled restart → check after 25s.\nIf the panel does not respond after the restart, the snapshot is restored automatically.',
    'es-ES': 'Cambio en el código del panel: {summary}\n\nSecuencia: snapshot → tsc --noEmit → next build → reinicio programado → verificación a los 25s.\nSi el panel no responde tras el reinicio, el snapshot se restaura automáticamente.',
  },
  'preview.snapshots': {
    'pt-BR': 'Snapshots do painel: {action}',
    'en-US': 'Panel snapshots: {action}',
    'es-ES': 'Snapshots del panel: {action}',
  },
  'preview.snapshotsRestore': {
    'pt-BR': 'Restaurar o código do painel a partir de {file} e recompilar.',
    'en-US': 'Restore the panel code from {file} and rebuild.',
    'es-ES': 'Restaurar el código del panel desde {file} y recompilar.',
  },
  'preview.snapshotsAction': {
    'pt-BR': 'Ação "{action}" sobre os snapshots do painel.',
    'en-US': 'Action "{action}" on the panel snapshots.',
    'es-ES': 'Acción "{action}" sobre los snapshots del panel.',
  },
};

export function tr(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key];
  let text = entry?.[locale] ?? entry?.['pt-BR'] ?? key;

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
