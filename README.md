# Bryan Wesley Barbearia — Sistema de agendamento

Sistema completo de agendamento, assinaturas e gestão da **Bryan Wesley
Barbearia** (Unidade Cajuru). Não é mais um protótipo: tem banco de dados,
login, agenda real com prevenção de conflito, comissões e notificações.

## Stack

- **Next.js 14** (App Router, Server Actions) + **React 18** + **TypeScript**
- **MySQL / TiDB** + **Drizzle ORM** (`mysql-core`, driver `mysql2`, migrações versionadas em `db/migrations`)
- **Tailwind CSS** com o design system **Modern Electric Precision**
- Sessão em cookie httpOnly assinado (**jose**), senhas com **bcrypt**
- Deploy na **Vercel** (cron nativo para as notificações)

## Design system — Modern Electric Precision

| Token | Cor | Uso |
|-------|-----|-----|
| Primary | `#1EB8FF` (`electric`) | Destaques, ícones, bordas ativas |
| Secondary | `#2979FF` (`royal`) | Fim do gradiente de botões e avatares |
| Tertiary | `#00E5FF` (`neon`) | Acento: VIP, status ativo, valores positivos |
| Neutral | `#0B0E14` (`ink`) | Fundo; cards em `#131823` (`surface`) |

**Headline / Label:** Space Grotesk · **Body:** Plus Jakarta Sans.
Utilitários em [`app/globals.css`](app/globals.css): `.glass`, `.btn-royal`,
`.btn-outline` e `.label`. Tokens em [`tailwind.config.ts`](tailwind.config.ts).

## Perfis e telas

| Rota | Quem acessa | O que faz |
|------|-------------|-----------|
| `/` | Público | Vitrine: serviços, equipe, Clube VIP, próximo horário livre real |
| `/planos` | Público | Planos, ciclo mensal/anual, comparativo, FAQ |
| `/agendar` | Público | Agenda em 3 passos, com ou sem cadastro |
| `/agendar/confirmado/[token]` | Quem tem o link | Confirmação durável, com QR de check-in |
| `/assinar/[slug]` | `CLIENT` | Pede o plano (ou vai ao pagamento, se configurado) |
| `/entrar` | Público | Login e criação de conta |
| `/privacidade` | Público | Política de privacidade (LGPD) |
| `/cliente` | `CLIENT` | Horários, remarcar, QR, plano, horário fixo, histórico |
| `/conta` | Qualquer sessão | Dados e troca de senha |
| `/barbeiro` | `BARBER` | Agenda do dia, comissão, check-in, iniciar/finalizar |
| `/barbeiro/checkin/[token]` | `BARBER` | Destino do QR lido pela câmera |
| `/admin` | `ADMIN` | KPIs, agenda navegável por dia e barbeiro, pedidos de plano |
| `/admin/agenda` | `ADMIN` | Dados da barbearia, regras da agenda e bloqueios |
| `/admin/equipe` | `ADMIN` | Barbeiros, jornada própria, metas e faixas de comissão |
| `/admin/catalogo` | `ADMIN` | Serviços e planos de assinatura |
| `/admin/clientes` | `ADMIN` | Clientes, assinaturas, cobrança, senha, importar/exportar |
| `/admin/relatorios` | `ADMIN` | Fechamento mensal por barbeiro + CSV |
| `/admin/notificacoes` | `ADMIN` | Fila de mensagens, reenvio e disparo manual |
| `/api/health` | Monitor | Disponibilidade e latência do banco |

O acesso é barrado no [`middleware.ts`](middleware.ts) e reconferido em cada
Server Action — a proteção não depende da interface. A nav inferior mostra só
o que cada papel pode abrir.

**Assumir a conta.** Quem agendou sem cadastro cria a senha depois pelo mesmo
WhatsApp. Se esse número já tem agendamento, o cadastro exige o **código de 6
letras** de um deles como prova de posse — sem isso, qualquer pessoa com o
número veria os horários de outra. (Quando o WhatsApp entrar, isso vira OTP.)

**Senhas.** Qualquer sessão troca a própria em `/conta`; o admin redefine a de
qualquer conta em `/admin/clientes`. O login gasta o mesmo tempo com usuário
existente ou não, para não denunciar quem tem conta, e trava por 15 minutos
após 5 tentativas erradas.

## Avisos que sobrevivem à revalidação

Toda ação do painel chama `revalidatePath`, e isso **remonta a árvore da
rota** — uma mensagem de sucesso guardada em `useState` sumiria no instante
em que o usuário fosse lê-la. Por isso a fila de avisos mora em
[`lib/toast.ts`](lib/toast.ts), fora do React: o `<Toaster />` do layout raiz
relê a fila ao remontar. Erros continuam inline, junto do campo.

Modais (remarcar, QR) são renderizados em portal no `<body>`
([`components/Modal.tsx`](components/Modal.tsx)): dentro da página eles
herdariam o contexto de empilhamento dos cards animados e ficariam atrás do
conteúdo.

## Como a agenda evita conflito

O banco é TiDB (compatível com MySQL), que **não tem exclusion constraint**.
A garantia contra reserva dupla é uma trava pessimista dentro da transação de
agendamento ([`lib/appointments.ts`](lib/appointments.ts)):

1. `INSERT … ON DUPLICATE KEY UPDATE` garante a linha `(barbeiro, dia)` em
   `booking_locks`;
2. `SELECT … FOR UPDATE` nessa linha serializa quem está reservando aquele
   barbeiro naquele dia;
3. já dentro da trava, reconfere sobreposição e só então insere.

Requisições simultâneas ficam em fila na trava e a segunda vê o horário
ocupado. O teste `npm run test:agenda` dispara 5 pedidos ao mesmo tempo no
mesmo horário e confirma que exatamente 1 vence.

> **Compatibilidade TiDB.** O TiDB só *parseia* `LATERAL` — não executa
> ([docs](https://docs.pingcap.com/tidb/stable/lateral-derived-tables/)) — e o
> Drizzle implementa relações (`db.query.*.with`) exatamente com isso. Por esse
> motivo **nenhuma consulta usa `with:`**: relações são joins explícitos ou uma
> segunda consulta por lote ([`lib/queries.ts`](lib/queries.ts)). Ao criar
> consultas novas, siga o mesmo padrão. O cliente está em modo `planetscale`
> como segunda barreira.

A disponibilidade considera: jornada da loja, **jornada própria do barbeiro**
(cadastrada em Admin → Equipe; sem linha para o dia da semana = folga),
agendamentos existentes, bloqueios do admin, dias fechados e antecedência
mínima. "Mais rápido" nunca escala quem está de folga. Horários da loja são tratados no fuso `America/São_Paulo`
([`lib/time.ts`](lib/time.ts)).

## Comissões

Divisão padrão **50% barbeiro / 50% barbearia**, configurável por barbeiro.
Como um cliente pode passar por barbeiros diferentes a cada visita, a divisão
é calculada e gravada **por atendimento** (`appointment_commissions`), com o
percentual congelado no momento do agendamento.

As **faixas de meta** (`commission_tiers`) elevam o percentual quando o
barbeiro ultrapassa um faturamento no mês — regra global ou individual.

Atendimento de assinante não tem cobrança no balcão, mas gera comissão: a base
vira o preço de tabela do serviço entregue (ajustável em
`settings.subscription_commission_base`). Cada barbeiro tem uma **meta mensal**
própria (Admin → Equipe) que alimenta a barra do painel dele.

**Assinatura vencida** vira `INADIMPLENTE` no cron e perde os benefícios até o
admin registrar a renovação em `/admin/clientes` (o ciclo é estendido a partir
do vencimento, não de hoje). Com o gateway, a renovação passa a ser automática.

## Check-in por QR Code

Cada agendamento nasce com um `checkin_token`. O cliente abre **Meu QR** em
`/cliente`; o barbeiro lê com a câmera (cai em `/barbeiro/checkin/<token>`) ou
digita o código de 6 letras no painel. O check-in valida a chegada; se o barbeiro
estiver livre, já move o atendimento para *em andamento* — senão registra a
chegada e ele inicia quando terminar o atual. Para assinante, a resposta diz se
o plano está ativo: é o ponto anti-fraude.

## Horário fixo do assinante

O membro reserva o mesmo dia e hora **toda semana** ou **todo mês** em
`/cliente`. O sistema materializa os agendamentos 5 semanas à frente, e
ter o fixo **não impede** marcar horários avulsos — são agendamentos comuns,
sujeitos às mesmas regras. Se um horário fixo esbarrar em alguém que já
estava lá, o fixo cede e o caso é reportado em vez de quebrar a rodada.

A materialização é idempotente e roda junto do cron.

## Notificações

A aplicação **enfileira**; quem entrega é o worker. Cada agendamento gera
confirmação imediata e lembretes de 24h e 2h. Cancelar derruba os lembretes
pendentes.

A varredura ([`lib/dispatch.ts`](lib/dispatch.ts)) expira assinaturas
vencidas, materializa os horários fixos e entrega o que venceu. Três coisas a
disparam, e uma trava garante que só uma rode por vez:

| Gatilho | Cadência | Para quê |
|---------|----------|----------|
| **Heartbeat do painel** — `POST /api/notificacoes/heartbeat` | a cada 10 min enquanto `/admin` ou `/barbeiro` estiver aberto | O dia a dia. A barbearia fica com o painel aberto, então os lembretes de 24h e 2h saem no horário sem nada externo |
| Cron da Vercel — `/api/notificacoes/despachar` | diário às 09:00 UTC ([`vercel.json`](vercel.json), limite do plano Hobby) | Rede de segurança para dias sem movimento |
| Agendador externo (opcional) | o que você configurar | Só se quiser cadência garantida mesmo com o painel fechado |

O heartbeat exige sessão de equipe; o cron exige `CRON_SECRET` (header
`Authorization: Bearer` ou `?token=`) e em produção responde 503 sem ele.
A trava é um compare-and-swap em `settings.last_dispatch_at`: cada chamada
tenta avançar o carimbo e só quem consegue varre a fila — duas abas abertas,
ou cron e agendador colados, não entregam a mesma mensagem duas vezes.
`/admin/notificacoes` mostra quando foi a última varredura.

Sem `WHATSAPP_TOKEN` configurado o sistema segue funcionando: as mensagens
ficam gravadas na fila até o número ser aprovado. Horário fixo materializado
pelo sistema não dispara confirmação (o membro já sabe), só os lembretes.

## Rodar localmente

```bash
npm install
cp .env.example .env.local     # preencha DATABASE_URL e AUTH_SECRET
npm run db:migrate             # cria as tabelas (e semeia se estiver vazio)
npm run dev                    # http://localhost:3000
```

Para testar sem TiDB, um MariaDB/MySQL local serve
(`DATABASE_URL=mysql://user:pass@127.0.0.1:3306/bryanwesley` e
`DATABASE_SSL=false`). O `mysql2` fala com os três.

Contas criadas pelo seed (senha em `SEED_PASSWORD`, padrão `bryan2026`):

| E-mail | Papel |
|--------|-------|
| `bryan@bryanwesley.com.br` | Administrador |
| `lucas@bryanwesley.com.br` | Barbeiro |
| `matheus@bryanwesley.com.br` | Barbeiro |

> Troque essas senhas antes de abrir para o público.

## Testes

```bash
npm test                  # 103 verificações
npm run test:agenda       # 33 — motor de agenda, jornada por barbeiro, faixas de meta
npm run test:fixo         # 17 — horário fixo, ocorrência cancelada, transição concorrente
npm run test:seguranca    # 18 — teto de agendamentos, webhook, redirect, CSV, sessão
npm run test:despacho     # 35 — trava da varredura, mensagem vencida, renovação, erro do driver
```

Há ainda um roteiro de navegador (Playwright) com 91 verificações de ponta a
ponta: agendamento de visitante, login, todas as telas do admin, check-in por
código, endpoint do cron protegido, tomada de conta com prova por código, nav
por papel, troca de senha, assinatura pelo site, remarcação, relatórios,
download dos CSVs, heartbeat disparado pelo painel, redirect com sessão
expirada, foco preso no modal, toggle do catálogo x banco, desativação de
barbeiro (com a guarda de auto-desativação do admin) e redefinição de senha da
equipe pelo painel.

Cobrem disponibilidade, bloqueios, antecedência, reserva dupla, corrida de
concorrência, ciclo de vida do atendimento, fechamento da comissão e a
materialização idempotente do horário fixo.

## Segurança

O que está no lugar, e por quê:

| Proteção | Onde | Contra o quê |
|----------|------|--------------|
| Sessão JWT em cookie `httpOnly`, papel conferido contra lista | [`lib/auth/session.ts`](lib/auth/session.ts) | Sessão forjada ou token de versão antiga |
| Guarda por papel no middleware **e** dentro de cada Server Action — o middleware deixa o POST da action passar e ela mesma redireciona se a sessão faltar | [`middleware.ts`](middleware.ts), `app/*/actions.ts`, [`lib/errors.ts`](lib/errors.ts) | Ação chamada direto, sem passar pela tela; sessão expirada virando tela muda |
| Sessão confrontada com o banco a cada requisição: conta ativa, papel e `token_version` | [`lib/auth/index.ts`](lib/auth/index.ts) | Cookie de 30 dias sobrevivendo a demissão ou troca de senha |
| Admin não desativa a própria conta nem o último admin ativo | [`app/admin/actions.ts`](app/admin/actions.ts) | Ficar trancado para fora do painel, sem outra porta de entrada |
| Redefinir senha da equipe em `/admin/equipe`; cada pessoa troca a própria em `/conta` | [`app/admin/equipe/EquipeManager.tsx`](app/admin/equipe/EquipeManager.tsx), [`app/conta/page.tsx`](app/conta/page.tsx) | Barbeiro que esquece a senha ficar sem acesso — não há recuperação por e-mail |
| Transição de atendimento condicional ao estado lido | [`lib/appointments.ts`](lib/appointments.ts) | Dois cliques concorrentes lançando comissão em atendimento cancelado |
| Baixa de pagamento condicional ao PENDENTE | [`lib/payments.ts`](lib/payments.ts) | Webhook entregue em duplicidade estendendo a assinatura dois ciclos |
| Dono do recurso conferido em cancelar, remarcar e check-in | [`app/cliente/actions.ts`](app/cliente/actions.ts), [`app/barbeiro/actions.ts`](app/barbeiro/actions.ts) | Mexer no horário de outra pessoa |
| Trava de 5 tentativas por 15 min + mensagem genérica no login | [`app/entrar/actions.ts`](app/entrar/actions.ts) | Força bruta e descoberta de quem tem conta |
| Retorno de login só para rota interna (`//x` e `/\x` recusados) | [`lib/url.ts`](lib/url.ts) | Redirecionamento aberto usado como isca |
| Conta com assinatura ativa não se reivindica sozinha | [`app/entrar/actions.ts`](app/entrar/actions.ts) | Tomada de conta por quem sabe o WhatsApp |
| Teto de horários futuros em aberto por telefone (4 / 12) | [`lib/appointments.ts`](lib/appointments.ts) | Script reservando a agenda inteira |
| Baixa de pagamento só após `payment_check` na InfinitePay | [`lib/payments.ts`](lib/payments.ts) | Callback falso ativando plano de graça |
| `CRON_SECRET` obrigatório em produção no despacho | [`app/api/notificacoes/despachar`](app/api/notificacoes/despachar/route.ts) | Disparo de mensagens por terceiros (custa dinheiro) |
| CSV neutraliza `= + - @` no início do campo | [`lib/reports.ts`](lib/reports.ts) | Fórmula executando ao abrir no Excel |
| CSP, `X-Frame-Options`, `nosniff`, HSTS, `Permissions-Policy` | [`next.config.mjs`](next.config.mjs) | Clickjacking, sniffing, downgrade |
| `noindex` + `robots` na confirmação (URL tem token) | [`app/agendar/confirmado`](app/agendar/confirmado/[token]/page.tsx) | Link compartilhado caindo em buscador |

A CSP entra sem `default-src`/`script-src`: o App Router injeta script inline
(`self.__next_f.push`) em toda página e barrar isso quebraria a hidratação.
Ficam as diretivas que valem sozinhas — `frame-ancestors`, `base-uri`,
`form-action`, `object-src`, `upgrade-insecure-requests`.

## Deploy

O build aplica as migrações antes de compilar (`npm run build`) e, se o
catálogo estiver vazio, roda o seed — o primeiro deploy já sobe com serviços,
planos e as contas da equipe. Sem `DATABASE_URL` ou `AUTH_SECRET` o build
**falha de propósito**: melhor que servir 500 em toda rota protegida.

TLS fica ligado por padrão (o TiDB Cloud exige) e só é desligado para
`localhost` ou com `DATABASE_SSL=false`. Datas trafegam em UTC
(`timezone: "Z"` no driver) e as colunas são `DATETIME(3)`; a conversão para o
horário da loja é toda em [`lib/time.ts`](lib/time.ts).

Variáveis do projeto na Vercel:

| Variável | Obrigatória | Para quê |
|----------|-------------|----------|
| `DATABASE_URL` | sim | `mysql://usuario:senha@host:4000/banco` (TiDB Cloud) |
| `DATABASE_SSL` | não | `false` desliga TLS (só para MySQL local de teste) |
| `AUTH_SECRET` | sim | Assina o cookie de sessão (≥ 24 caracteres) |
| `CRON_SECRET` | sim em produção | Protege o endpoint de despacho |
| `SEED_PASSWORD` | não | Senha inicial da equipe (padrão `bryan2026`) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | não | Entrega das mensagens |
| `INFINITEPAY_HANDLE` | não | Cobrança avulsa online |
| `NEXT_PUBLIC_SITE_URL` | recomendada | Base dos links do QR e do webhook |

### Passo a passo da primeira publicação

1. **TiDB Cloud** — criar o cluster e o banco, e copiar a string de conexão
   (`mysql://usuario:senha@host:4000/banco`). Liberar o IP de saída da Vercel
   na lista de acesso do cluster.
2. **Vercel → Settings → Environment Variables** (ambiente *Production*):
   `DATABASE_URL`, `AUTH_SECRET` (≥ 24 caracteres, aleatória),
   `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` e, se quiser trocar a senha inicial
   da equipe, `SEED_PASSWORD`. Gerar segredos com:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Publicar** — o merge na `main` dispara o deploy. O build roda as
   migrações e, com o catálogo vazio, o seed: serviços, planos, contas da
   equipe e as configurações da Unidade Cajuru.
4. **Trocar as senhas da equipe** em `/admin/equipe` antes de divulgar. A
   senha do seed é a mesma para todos e serve só para o primeiro acesso.
5. **Conferir** `/api/health` — deve responder `{"ok":true,"db":"ok"}`.
6. **Agendador externo** — o plano Hobby da Vercel só permite cron diário
   ([`vercel.json`](vercel.json) usa `0 9 * * *`). Para lembrete de hora em
   hora, apontar um agendador externo (cron-job.org, por exemplo) a cada 15
   minutos para:

   ```
   https://SEU-DOMINIO/api/notificacoes/despachar?token=CRON_SECRET
   ```

   Sem `WHATSAPP_TOKEN` as mensagens ficam na fila sem consumir tentativa —
   dá para ligar o agendador antes do número estar aprovado.

## Relatórios

`/admin/relatorios` fecha o mês a partir da razão de comissões — por barbeiro,
com lançamento a lançamento e exportação em CSV (`;` e vírgula decimal, abre
direto no Excel pt-BR). A base de clientes também sai em CSV.

## Pagamentos

O adaptador da **InfinitePay** está pronto em
[`lib/providers/infinitepay.ts`](lib/providers/infinitepay.ts) (criação de
link de pagamento e reconferência via `payment_check`), inerte até
`INFINITEPAY_HANDLE` ser configurado.

> **Limite da API:** o Checkout da InfinitePay cobre apenas **cobrança
> avulsa** — não existe assinatura recorrente nativa. Para a mensalidade do
> Clube VIP, ou se gera um link novo a cada renovação (com baixa por webhook),
> ou se usa um gateway com recorrência nativa só para as assinaturas.

O fluxo está fechado: o cliente escolhe o plano em `/assinar/[slug]`; com
`INFINITEPAY_HANDLE` configurado ele vai ao checkout e o
[webhook](app/api/pagamentos/infinitepay/route.ts) ativa a assinatura
(reconferindo em `payment_check`, sem confiar só no callback). Sem o handle,
vira um pedido que o admin ativa em um clique no painel. O admin também gera
link de cobrança avulso para renovações.

## O que ainda depende de credencial externa

- **Entrega das mensagens** — a fila está pronta; falta o número aprovado na
  Cloud API do WhatsApp (`WHATSAPP_TOKEN`).
- **Cobrança online** — falta o handle da InfinitePay (`INFINITEPAY_HANDLE`).
