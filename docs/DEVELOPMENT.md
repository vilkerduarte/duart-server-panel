# Duart Panel — Guia de Desenvolvimento

## Configuração do Ambiente

### Pré-requisitos

- Node.js 22+ (recomendado via NVM)
- npm 10+
- Git

### Setup Local

```bash
git clone <repo-url>
cd duart-panel
npm install
npm run dev
```

O servidor de desenvolvimento inicia em `http://localhost:3000`.

**Nota**: Em desenvolvimento local, as API Routes que executam comandos shell (`nginx`, `ufw`, `docker`, etc.) não funcionarão a menos que esteja rodando em um servidor Linux com esses binários instalados. Para desenvolvimento do frontend, crie dados mockados.

## Estrutura do Projeto

### Páginas (Pages Router)

Todas as páginas seguem o padrão SSG + CSR:

1. A página é exportada como HTML estático via `next export`
2. Os dados dinâmicos são carregados via `fetch` no `useEffect`
3. `AppLayout` fornece sidebar + header

### API Routes

As API routes são a única porção server-side:

1. Validam sessão via `authMiddleware`
2. Executam comandos shell via `lib/system.ts`
3. Retornam JSON padronizado `{ success, data?, error? }`

### Bibliotecas Internas (`lib/`)

| Arquivo | Função |
|---------|--------|
| `auth.ts` | Autenticação (bcrypt, JWT, usuários, tentativas) |
| `system.ts` | Whitelist e execução de comandos shell |
| `middleware/auth.ts` | Middleware de autenticação para API routes |
| `data/config.ts` | Leitura/escrita de configurações |
| `contexts/*` | Contextos React (Auth, I18n, Theme, Toast) |
| `hooks/*` | Custom hooks (useApi, useKeyboard) |

### Componentes

#### Layout
- `AppLayout` — Wrapper com sidebar + header + conteúdo
- `Sidebar` — Menu lateral colapsável com ícones
- `Header` — Breadcrumb, toggle tema, avatar, logout

#### UI
- `Button` — Múltiplas variantes e tamanhos
- `Card` — Container padrão
- `Modal` — Modal com backdrop blur
- `Input`, `Select` — Campos de formulário
- `Badge` — Indicador de status
- `Spinner` — Loading
- `ConfirmDialog` — Confirmação com ações

## Sistema de Comandos Shell

### Adicionar Novo Comando

Em [`lib/system.ts`](lib/system.ts), adicione uma entrada na `COMMAND_WHITELIST`:

```typescript
novo_comando: {
  bin: 'comando',
  baseArgs: ['arg1'],
  allowedArgs: [/^regex-para-validar$/],
  sudo: false,
  timeout: 10000,
}
```

### Segurança

- Binários são fixos na whitelist
- Argumentos extras são validados por regex
- Comandos com `sudo: true` requerem privilégios
- Timeout impede comandos que travam

## Internacionalização (i18n)

### Adicionar Novo Namespace

1. Crie `languages/pt-BR/novo-namespace.js`:

```javascript
module.exports = {
  'novo-namespace': {
    chave: "Valor em Português",
  }
};
```

2. Crie equivalentes em `en-US/` e `es-ES/`
3. Use no componente: `const { t } = useI18n(); t('novo-namespace.chave')`

### Adicionar Novo Idioma

1. Crie a pasta `languages/XX-YY/`
2. Copie a estrutura de `pt-BR/`
3. Traduza todos os arquivos
4. Adicione em `availableLocales` no [`I18nContext`](lib/contexts/I18nContext.tsx)

## Temas (Dark/Light)

O tema é controlado por:

1. **CSS Variables** em [`styles/globals.css`](styles/globals.css)
2. **Classe `.light`** no `<html>` para tema claro
3. **ThemeContext** que persiste a escolha via API

Para usar cores do tema nos componentes:

```tsx
<div className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)]">
```

## Adicionar Novo Módulo

1. **API Route**: Crie `pages/api/modulo/*.ts`
2. **Página**: Crie `pages/modulo/index.tsx` (padrão SSG+CSR)
3. **i18n**: Adicione traduções em `languages/*/modulo.js`
4. **Sidebar**: Adicione item em `components/Layout/Sidebar.tsx`

## Build e Deploy

```bash
# Build para produção
npm run build    # next build && next export

# Output em /out/ (HTML/CSS/JS estático)

# Iniciar servidor API (apenas)
npm start        # next start -p $PORT
```

O NGINX serve os arquivos estáticos de `/out/` e faz proxy das chamadas `/api/*` para o Node.js.

## Testes

Para testar localmente sem servidor Linux:

1. Mock as API routes retornando dados estáticos
2. Use `NODE_ENV=development` para habilitar logs
3. Teste componentes UI isoladamente com dados mock

## Troubleshooting

| Problema | Solução |
|----------|---------|
| `next export` falha | Verificar se nenhuma página usa `getServerSideProps` |
| API routes não respondem | Verificar se `next start` está rodando na porta correta |
| Comandos shell falham | Verificar sudoers e permissões dos binários |
| Traduções não carregam | Verificar se o arquivo .js existe no locale atual |
