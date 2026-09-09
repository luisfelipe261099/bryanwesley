# Bryan Wesley Barbearia — Sistema de agendamento

Sistema completo de agendamento, assinaturas e gestão da **Bryan Wesley
Barbearia** (Unidade Jardins). Não é mais um protótipo: tem banco de dados,
login, agenda real com prevenção de conflito, comissões e notificações.

## Stack

- **Next.js 14** (App Router, Server Actions) + **React 18** + **TypeScript**
- **PostgreSQL** + **Drizzle ORM** (migrações versionadas em `db/migrations`)
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
Server Action — a proteção não depende da interface.

## Como a agenda evita conflito

A garantia de que dois clientes não ocupam o mesmo barbeiro no mesmo horário
**não está na aplicação, está no banco**:

```sql
EXCLUDE USING gist (
  barber_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status <> 'CANCELADO' AND status <> 'NO_SHOW')
```

Mesmo com requisições simultâneas, o Postgres rejeita a segunda. O teste
`npm run test:agenda` dispara 5 pedidos ao mesmo tempo no mesmo horário e
confirma que exatamente 1 vence.

A disponibilidade considera: jornada da loja, jornada própria do barbeiro,
agendamentos existentes, bloqueios do admin, dias fechados e antecedência
mínima. Horários da loja são tratados no fuso `America/São_Paulo`
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
`settings.subscription_commission_base`).

## Check-in por QR Code

Cada agendamento nasce com um `checkin_token`. O cliente abre **Meu QR** em
`/cliente`; o barbeiro lê com a câmera (cai em `/barbeiro/checkin/<token>`) ou
digita o código de 6 letras no painel. O check-in valida a chegada e já move o
atendimento para *em andamento*.

## Notificações

A aplicação **enfileira**; quem entrega é o worker. Cada agendamento gera
confirmação imediata e lembretes de 24h e 2h. Cancelar derruba os lembretes
pendentes.

O despacho roda em `/api/notificacoes/despachar`, acionado pelo Vercel Cron a
cada 15 minutos ([`vercel.json`](vercel.json)). Sem `WHATSAPP_TOKEN`
configurado o sistema segue funcionando: as mensagens ficam gravadas na fila
até o número ser aprovado.

## Rodar localmente

```bash
npm install
cp .env.example .env.local     # preencha DATABASE_URL e AUTH_SECRET
npm run db:migrate             # cria as tabelas
npm run db:seed                # catálogo + contas da equipe
npm run dev                    # http://localhost:3000
```

Contas criadas pelo seed (senha em `SEED_PASSWORD`, padrão `bryan2026`):

| E-mail | Papel |
|--------|-------|
| `bryan@bryanwesley.com.br` | Administrador |
| `lucas@bryanwesley.com.br` | Barbeiro |
| `matheus@bryanwesley.com.br` | Barbeiro |

> Troque essas senhas antes de abrir para o público.

## Testes

```bash
npm run test:agenda   # 27 verificações do motor de agenda
```

Cobre disponibilidade, bloqueios, antecedência, reserva dupla, corrida de
concorrência, ciclo de vida do atendimento e fechamento da comissão.

## Deploy

O build aplica as migrações antes de compilar (`npm run build`), então basta
ter `DATABASE_URL` e `AUTH_SECRET` nas variáveis do projeto. Na Vercel:
**Storage → Create Database** já injeta a `DATABASE_URL`.

## O que ainda depende de credencial externa

- **Pagamento recorrente** — a assinatura hoje é ativada pelo admin em
  `/admin/clientes`. Falta plugar o gateway (InfinityPay) para cobrança
  automática e baixa de inadimplência.
- **Entrega das mensagens** — a fila está pronta; falta o número aprovado na
  Cloud API do WhatsApp.
