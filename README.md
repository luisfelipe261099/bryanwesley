# Bryan Wesley Barbearia — Sistema de agendamento

Sistema completo de agendamento, assinaturas e gestão da **Bryan Wesley
Barbearia** (Unidade Jardins). Não é mais um protótipo: tem banco de dados,
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
| `/` | Público | Vitrine: serviços, equipe, Clube VIP |
| `/planos` | Público | Planos, ciclo mensal/anual, comparativo, FAQ |
| `/agendar` | Público | Agenda em 3 passos, com ou sem cadastro |
| `/entrar` | Público | Login e criação de conta |
| `/cliente` | `CLIENT` | Horários, QR de check-in, plano, histórico |
| `/barbeiro` | `BARBER` | Agenda do dia, iniciar/finalizar, check-in, comissão |
| `/admin` | `ADMIN` | Faturamento, MRR, ocupação, agenda, equipe |
| `/admin/agenda` | `ADMIN` | Regras da agenda e bloqueios |
| `/admin/equipe` | `ADMIN` | Barbeiros, jornada individual, faixas de meta |
| `/admin/catalogo` | `ADMIN` | Serviços e planos de assinatura |
| `/admin/clientes` | `ADMIN` | Clientes, assinaturas e importação em CSV |

O acesso é barrado no [`middleware.ts`](middleware.ts) e reconferido em cada
Server Action — a proteção não depende da interface. A nav inferior mostra só
o que cada papel pode abrir.

**Assumir a conta.** Quem agendou sem cadastro cria a senha depois pelo mesmo
WhatsApp. Se esse número já tem agendamento, o cadastro exige o **código de 6
letras** de um deles como prova de posse — sem isso, qualquer pessoa com o
número veria os horários de outra. (Quando o WhatsApp entrar, isso vira OTP.)

**Senhas.** O cliente troca a própria em `/cliente`; o admin redefine a de
qualquer conta em `/admin/clientes`. O login gasta o mesmo tempo com usuário
existente ou não, para não denunciar quem tem conta.

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

O despacho roda em `/api/notificacoes/despachar` e também materializa os
horários fixos e expira assinaturas vencidas. Exige `CRON_SECRET` em produção
(header `Authorization: Bearer` ou `?token=`); sem ele responde 503 e não
dispara nada.

> **Plano Hobby da Vercel só permite cron diário**, então o
> [`vercel.json`](vercel.json) agenda às 09:00 UTC. Os lembretes de 24h e 2h
> precisam de uma cadência menor: aponte um agendador externo gratuito
> (ex.: cron-job.org) para `…/api/notificacoes/despachar?token=<CRON_SECRET>`
> a cada 15 min, ou suba para o plano Pro e troque o `schedule` para
> `*/15 * * * *`.

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
npm test              # 43 verificações
npm run test:agenda   # 34 — motor de agenda, jornada por barbeiro, faixas de meta
npm run test:fixo     #  9 — horário fixo
```

Há ainda um roteiro de navegador (Playwright) com 25 verificações de ponta a
ponta: agendamento de visitante, login, todas as telas do admin, check-in por
código, endpoint do cron protegido, tomada de conta com prova por código, nav
por papel e troca de senha.

Cobrem disponibilidade, bloqueios, antecedência, reserva dupla, corrida de
concorrência, ciclo de vida do atendimento, fechamento da comissão e a
materialização idempotente do horário fixo.

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

## Pagamentos

O adaptador da **InfinitePay** está pronto em
[`lib/providers/infinitepay.ts`](lib/providers/infinitepay.ts) (criação de
link de pagamento e reconferência via `payment_check`), inerte até
`INFINITEPAY_HANDLE` ser configurado.

> **Limite da API:** o Checkout da InfinitePay cobre apenas **cobrança
> avulsa** — não existe assinatura recorrente nativa. Para a mensalidade do
> Clube VIP, ou se gera um link novo a cada renovação (com baixa por webhook),
> ou se usa um gateway com recorrência nativa só para as assinaturas.

Enquanto isso, a assinatura é ativada pelo admin em `/admin/clientes`, o que
já cobre a operação do dia a dia.

## O que ainda depende de credencial externa

- **Entrega das mensagens** — a fila está pronta; falta o número aprovado na
  Cloud API do WhatsApp (`WHATSAPP_TOKEN`).
- **Cobrança online** — falta o handle da InfinitePay (`INFINITEPAY_HANDLE`).
