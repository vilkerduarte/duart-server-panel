# Migração para a versão nova

Guia para adequar uma instalação existente. O caminho todo leva ~10 minutos,
sendo ~1 minuto de indisponibilidade do painel (os sites hospedados não param).

---

## Resumo do risco

| | |
|---|---|
| **Sites hospedados saem do ar?** | Não. O NGINX não é reiniciado, só recarregado, e os vhosts existentes não são tocados a menos que você peça. |
| **Perde certificado?** | Não. Os arquivos ficam onde estão; só o registro do painel é atualizado. |
| **Perde usuário/senha do painel?** | Não. `users.json` não muda de formato, e as sessões abertas continuam válidas. |
| **Perde a chave da API da IA?** | Não. |
| **Perde histórico de conversa da IA?** | Sim — não havia histórico antes (as conversas viviam só no navegador). |
| **Único ponto que apaga algo** | Regenerar um vhost que você editou à mão. É opcional, mostra o diff antes e pede confirmação separada. |

---

## Procedimento

### 1. Backup independente

O migrador faz backup sozinho, mas um snapshot da VM é a rede de segurança
real. Se o provedor oferecer, tire agora.

```bash
sudo tar czf /root/duart-backup-$(date +%F).tar.gz \
    /var/lib/duart-panel /etc/nginx /etc/letsencrypt
```

### 2. Atualizar o código

```bash
cd /opt/duart-panel        # ou onde estiver
sudo git fetch --all
sudo git status            # confira se há alterações locais suas
sudo git pull
```

Se `git status` mostrar arquivos modificados por você, guarde-os antes:
`sudo git stash`.

### 3. Simular a migração

Não grava nada — só relata o que faria.

```bash
sudo npm run migrate
```

Leia a seção **"Precisa da sua atenção"** no fim da saída. Ela lista o que exige
decisão sua, tipicamente:

- jobs de cron que estavam salvos mas **nunca chegaram a rodar** e agora vão passar a rodar;
- certificados cuja validade real difere da que o painel exibia;
- vhosts que parecem editados à mão.

### 4. Aplicar

```bash
sudo npm run migrate:apply
```

Faz backup em `/var/lib/duart-panel/backups/pre-migracao-*.tar.gz` e normaliza o
estado em disco. Campos que saíram do schema permanecem nos arquivos, ignorados
— nada é apagado.

### 5. Reinstalar

```bash
sudo bash scripts/install.sh
```

O instalador detecta a instalação existente e preserva domínio, porta,
configuração e o bloco TLS do vhost do painel. Nesta etapa ele:

- instala o Node pelo apt, se o atual for anterior ao 20.9;
- roda `npm ci` e `next build`;
- cria o serviço systemd `duart-panel` e **remove a instância do PM2** (outras
  aplicações suas no PM2 são preservadas);
- instala os snippets compartilhados do NGINX e o webroot ACME;
- remove `/etc/cron.d/duart-panel-ssl` e passa a renovação para o `certbot.timer`;
- instala o `duart-recover` em `/usr/local/sbin`.

A indisponibilidade do painel é a troca de PM2 por systemd, alguns segundos.

### 6. Conferir

```bash
systemctl status duart-panel
sudo nginx -t
npm run ssl:check           # validade real de cada certificado
```

Acesse o painel. Sua sessão continua válida — se pedir login, apenas entre de novo.

### 7. Regenerar os vhosts (opcional, recomendado)

Os arquivos de vhost antigos continuam servindo tráfego normalmente, mas não
recebem as correções até serem reescritos. Sem regenerar, estes três seguem como
estavam:

- sem escuta em IPv6 (o site não responde a visitantes por IPv6, e a renovação
  do certificado pode falhar em domínios com registro AAAA);
- sem o snippet de desafio ACME no bloco da porta 80;
- com o modo manutenção inoperante.

Na tela **NGINX**, use **"Regenerar configurações"**. Ela analisa cada site,
mostra o diff antes de gravar e aplica um por vez — se o `nginx -t` reprovar
algum, aquele site volta ao arquivo anterior e os demais seguem.

**Sites com vhost editado à mão aparecem marcados em vermelho e não são
regenerados sem uma confirmação separada.** Abra o diff, copie o que precisa
manter, e depois marque a caixa. Alternativamente, cole as customizações no
campo "Diretivas customizadas" do site — assim elas sobrevivem às próximas
regenerações.

---

## Mudanças de comportamento

Coisas que passam a funcionar diferente e podem surpreender.

**Jobs de cron passam a existir de verdade.** Antes ficavam num JSON e nunca
eram instalados. Agora vão para `/etc/cron.d/duart-panel` e executam. Revise a
lista na tela de Cron antes de sair do passo 4.

**O gerenciador de arquivos ganhou jaula.** O acesso fica restrito a
`/var/www`, `/srv`, `/opt`, `/home`, `/etc/nginx`, `/etc/php`, `/var/log` e aos
dados do painel. Se você usava para editar outro caminho, acrescente-o em
`fileManagerRoots` no `config.json` — ou peça à IA, que faz a edição com diff.
`/etc/shadow`, `/etc/sudoers` e `/root/.ssh` ficam negados em qualquer configuração.

**Sites PHP ganham pool dedicado ao serem salvos.** Na primeira edição (ou
regeneração) de um site PHP, o painel cria um usuário de sistema, um pool FPM e
um socket próprios, e reaponta o vhost. O conteúdo do site não muda, mas o dono
dos arquivos passa a importar: se o site grava em disco (upload, cache), rode
`chown -R web_<dominio>:web_<dominio> /var/www/<dominio>` depois.

**Datas de validade de certificado vão mudar na tela.** Elas eram calculadas
como "emissão + 90 dias" e agora vêm do arquivo. Se algum aparecer vencido, ele
já estava — o painel é que não mostrava.

**A renovação passa a ser do `certbot.timer`.** Se você tinha uma linha no
crontab chamando `scripts/renew-ssl.js`, ela vai falhar (o script foi removido).
O migrador avisa; remova com `crontab -e`.

**A IA muda de comportamento.** Ela agora executa ferramentas de verdade. Os
antigos modos de aprovação (Leitura, Assistido, Autônomo, Laboratório) viraram
cinco abas — Conversa, Analisar, Executar, Gerar e Aprender — e o Laboratório
virou o interruptor **Acesso Total** em Configurações. Quem tinha o laboratório
ligado continua com ele ligado como Acesso Total (a configuração é migrada
sozinha); conversas antigas abrem na aba Executar (as que eram só leitura, em
Conversa). Sem Acesso Total, o Executar pede aprovação para cada alteração,
mostrando diff ou comando exato. A consulta de arquivos e comandos de leitura é
livre em todas as abas. Veja o [README](README.md#assistente-de-ia-modos-e-acesso-total).

**Backups de vhost saem de `sites-available`.** Versões anteriores gravavam
`dominio.bak-<timestamp>` dentro de `/etc/nginx/sites-available/`, e como o
painel varre esse diretório para listar sites, cada backup aparecia como um
vhost a mais na tela — uma instalação executada duas vezes mostrava o mesmo
domínio três vezes. Agora eles vão para `/var/lib/duart-panel/backups/nginx/`,
e o migrador move os que já existem.

---

## Se algo der errado

**O painel não sobe:**

```bash
journalctl -u duart-panel -n 50
sudo duart-recover --diagnose
```

**O NGINX não sobe ou os sites caíram:**

```bash
sudo duart-recover              # sobe uma config mínima servindo só o painel
sudo duart-recover --restore    # restaura os vhosts do backup mais recente
```

**Voltar tudo:**

```bash
sudo systemctl stop duart-panel
cd /opt/duart-panel && sudo git checkout <commit-anterior>
sudo tar xzf /var/lib/duart-panel/backups/pre-migracao-*.tar.gz -C /
sudo npm ci && sudo npm run build
sudo systemctl restart nginx
```

O `pre-migracao-*.tar.gz` contém `/var/lib/duart-panel`,
`/etc/nginx/sites-available`, `/etc/nginx/sites-enabled` e
`/etc/letsencrypt/renewal` — os caminhos com paths absolutos, por isso o `-C /`.
