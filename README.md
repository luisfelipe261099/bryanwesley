# Bryan Wesley Barbearia — Protótipo

Protótipo visual navegável do sistema de agendamento da **Bryan Wesley Barbearia**.
Feito para o cliente aprovar a experiência antes de construir o sistema completo.

> ⚠️ **É um protótipo de aprovação.** Os dados são fictícios (mock) e não há
> banco de dados, login real ou pagamento ainda. Tudo é clicável para demonstrar
> as 3 experiências. A etapa seguinte é plugar backend, autenticação e pagamentos.

## Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **Tailwind CSS** com o design system **Modern Electric Precision**
- **Framer Motion** (transições) e **Lucide** (ícones)
- Pronto para deploy gratuito na **Vercel**

## Design system — Modern Electric Precision

| Token | Cor | Uso |
|-------|-----|-----|
| Primary | `#1EB8FF` (`electric`) | Destaques, ícones, links, bordas ativas |
| Secondary | `#2979FF` (`royal`) | Fim do gradiente dos botões e avatares |
| Tertiary | `#00E5FF` (`neon`) | Acento pontual: VIP, status ativo, métricas positivas |
| Neutral | `#0B0E14` (`ink`) | Fundo base; cards em `#131823` (`surface`) |

- **Headline / Label:** Space Grotesk · **Body:** Plus Jakarta Sans
- Classes utilitárias em [`app/globals.css`](app/globals.css): `.glass` (card),
  `.btn-royal` (botão primário), `.btn-outline` (secundário) e `.label`
  (micro-label em caixa alta, presente em todos os cabeçalhos de bloco).
- Tokens em [`tailwind.config.ts`](tailwind.config.ts).

## As 4 experiências (perfis)

Acesse `/entrar` para escolher o perfil — ou navegue direto:

| Rota | Quem usa | O que mostra |
|------|----------|--------------|
| `/` | Visitante | Landing: hero, serviços, equipe, Clube VIP, depoimentos |
| `/agendar` | **Cliente avulso** | Agendamento rápido em 3 passos: serviço → barbeiro & horário → dados |
| `/planos` | Visitante | Clube VIP: Silver / Gold Black / Diamond, ciclo mensal-anual, comparativo e FAQ |
| `/cliente` | **Membro do Clube VIP** | Check-in, assinatura, ciclo, benefícios, histórico |
| `/barbeiro` | **Barbeiro** | Comissão do mês, agenda diária, iniciar/finalizar atendimento |
| `/admin` | **Administrador (Bryan)** | Dashboard: faturamento, MRR, ocupação, equipe, operação, clientes |

As telas logadas compartilham o `AppHeader` e a `BottomNav`
(Início · Clube VIP · Barbeiro · Admin).

Serviços, planos, barbeiros e métricas ficam em [`lib/data.ts`](lib/data.ts) —
fácil de ajustar preços, durações e nomes durante a validação com o cliente.

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

1. **Banco de dados** — agendamentos, clientes, barbeiros, planos, pagamentos
   (ex.: Postgres da Vercel Marketplace / Neon).
2. **Autenticação** — login do cliente, do barbeiro e do admin (ex.: Clerk ou Auth.js).
3. **Agenda real** — horários dinâmicos, bloqueios, evitar conflito de slot.
4. **Pagamentos / assinaturas** — cobrança recorrente dos mensalistas
   (ex.: Stripe ou Mercado Pago).
5. **Notificações no WhatsApp** — confirmação e lembrete de horário.
