# Bryan Wesley Barbearia — Protótipo

Protótipo visual navegável do sistema de agendamento da **Bryan Wesley Barbearia**.
Feito para o cliente aprovar a experiência antes de construir o sistema completo.

> ⚠️ **É um protótipo de aprovação.** Os dados são fictícios (mock) e não há
> banco de dados, login real ou pagamento ainda. Tudo é clicável para demonstrar
> as 3 experiências. A etapa seguinte é plugar backend, autenticação e pagamentos.

## Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **Tailwind CSS** (design system azul sobre grafite)
- **Framer Motion** (transições do fluxo de agendamento)
- **Lucide** (ícones)
- Pronto para deploy gratuito na **Vercel**

## As 3 experiências (perfis)

Acesse `/entrar` para escolher o perfil — ou navegue direto:

| Rota | Quem usa | O que mostra |
|------|----------|--------------|
| `/` | Visitante | Landing: hero, serviços com preço, planos, como funciona |
| `/agendar` | **Cliente avulso** | Fluxo passo-a-passo: serviço → data → horário → confirmação |
| `/planos` | Visitante | Planos de assinatura + tabela comparativa + FAQ |
| `/cliente` | **Assinante / mensalista** | Painel: plano, ciclo, benefícios, histórico, próximo horário |
| `/admin` | **Administrador (Bryan)** | Agenda do dia, faturamento, meta, ocupação, clientes |

Os serviços, planos e dados ficam em [`lib/data.ts`](lib/data.ts) — fácil de
ajustar preços, durações e nomes durante a validação com o cliente.

## Rodar localmente

```bash
npm install
npm run dev      # http://localhost:3000
```

Build de produção:

```bash
npm run build
npm run start
```

## Deploy na Vercel (grátis)

**Opção A — pela CLI:**
```bash
npm i -g vercel
vercel            # deploy de preview
vercel --prod     # deploy de produção
```

**Opção B — pelo painel (recomendado):**
1. Suba este projeto para um repositório no GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. A Vercel detecta o Next.js automaticamente — é só clicar em **Deploy**.

Não precisa de variáveis de ambiente nesta fase (sem backend ainda).

## Próximos passos (pós-aprovação)

1. **Banco de dados** — agendamentos, clientes, planos, pagamentos
   (ex.: Postgres da Vercel Marketplace / Neon).
2. **Autenticação** — login do cliente e do admin (ex.: Clerk ou Auth.js).
3. **Agenda real** — horários dinâmicos, bloqueios, evitar conflito de slot.
4. **Pagamentos / assinaturas** — cobrança recorrente dos mensalistas
   (ex.: Stripe ou Mercado Pago).
5. **Notificações no WhatsApp** — confirmação e lembrete de horário.
