// Popula o banco com o catálogo da barbearia e as contas iniciais.
// Idempotente: pode rodar de novo sem duplicar nada.
import "./load-env";

import bcrypt from "bcryptjs";
import { db, sql } from "./client";
import {
  users,
  barbers,
  services,
  plans,
  planServices,
  settings,
} from "./schema";
import { eq } from "drizzle-orm";
import { normalizePhone } from "../lib/phone";

const SERVICES = [
  { slug: "corte", name: "Corte Signature", description: "Degradê, tesoura e finalização com styling.", priceCents: 9000, durationMin: 40, tag: null, sortOrder: 1 },
  { slug: "barba", name: "Barboterapia", description: "Toalha quente, navalha e óleos essenciais.", priceCents: 7500, durationMin: 35, tag: null, sortOrder: 2 },
  { slug: "combo", name: "Combo Completo", description: "Corte Signature + Barboterapia Premium.", priceCents: 15000, durationMin: 75, tag: "Mais pedido", sortOrder: 3 },
  { slug: "lavagem", name: "Corte & Lavagem", description: "Massagem capilar inclusa e finalização.", priceCents: 9000, durationMin: 45, tag: null, sortOrder: 4 },
  { slug: "pezinho", name: "Pézinho / Acabamento", description: "Aquele retoque entre os cortes.", priceCents: 3500, durationMin: 15, tag: null, sortOrder: 5 },
  { slug: "sobrancelha", name: "Sobrancelha", description: "Alinhamento na navalha.", priceCents: 3000, durationMin: 10, tag: null, sortOrder: 6 },
  { slug: "platinado", name: "Platinado / Luzes", description: "Descoloração e tonalização. Inclui hidratação.", priceCents: 22000, durationMin: 120, tag: "Premium", sortOrder: 7 },
  { slug: "hidratacao", name: "Spa Capilar", description: "Tratamento, nutrição e reconstrução do fio.", priceCents: 8000, durationMin: 30, tag: null, sortOrder: 8 },
];

const PLANS = [
  {
    slug: "silver",
    name: "Plano Silver",
    kicker: "Entrada exclusiva",
    tagline: "Pra quem mantém o cabelo sempre em dia.",
    priceCents: 13900,
    annualPriceCents: 11600,
    highlight: false,
    badge: null,
    sortOrder: 1,
    features: [
      "2 cortes de cabelo por mês",
      "Pézinho liberado entre os cortes",
      "10% OFF em produtos e cosméticos",
      "Barber Bar com café espresso & chopp",
    ],
    covers: ["corte", "pezinho"],
  },
  {
    slug: "gold",
    name: "Plano Gold Black",
    kicker: "Experiência insígnia",
    tagline: "Cabelo e barba impecáveis o mês inteiro.",
    priceCents: 22900,
    annualPriceCents: 19100,
    highlight: true,
    badge: "Mais escolhido",
    sortOrder: 2,
    features: [
      "Cortes ilimitados durante todo o mês",
      "Barboterapia semanal inclusa",
      "Prioridade máxima na agenda VIP",
      "Bar liberado & 20% OFF em produtos",
    ],
    covers: ["corte", "barba", "sobrancelha", "lavagem"],
  },
  {
    slug: "diamond",
    name: "Diamond Royalty",
    kicker: "Nível soberano",
    tagline: "A experiência completa, sem limites.",
    priceCents: 31900,
    annualPriceCents: 26600,
    highlight: false,
    badge: "Top",
    sortOrder: 3,
    features: [
      "Cortes & barba ilimitados + toalha quente",
      "Acesso privativo ao Lounge VIP",
      "1 convidado mensal grátis",
      "Spa capilar e 25% OFF em coloração",
    ],
    covers: ["corte", "barba", "sobrancelha", "lavagem", "hidratacao"],
  },
];

const TEAM = [
  { slug: "bryan", name: "Bryan Wesley", shortName: "Bryan W.", title: "Master Barber & Founder", phone: "(11) 99999-0001", email: "bryan@bryanwesley.com.br", rating: 50, commissionPct: 45, admin: true },
  { slug: "lucas", name: "Lucas Silva", shortName: "Lucas S.", title: "Barbeiro Sênior", phone: "(11) 99999-0002", email: "lucas@bryanwesley.com.br", rating: 49, commissionPct: 40, admin: false },
  { slug: "matheus", name: "Matheus Fontes", shortName: "Matheus F.", title: "Especialista em Barba", phone: "(11) 99999-0003", email: "matheus@bryanwesley.com.br", rating: 48, commissionPct: 40, admin: false },
];

export async function runSeed() {
  const defaultPassword = process.env.SEED_PASSWORD || "bryan2026";
  const hash = await bcrypt.hash(defaultPassword, 10);

  // ── Configurações (linha única) ──
  await db
    .insert(settings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: settings.id });

  // ── Serviços ──
  for (const s of SERVICES) {
    await db
      .insert(services)
      .values(s)
      .onConflictDoUpdate({
        target: services.slug,
        set: {
          name: s.name,
          description: s.description,
          priceCents: s.priceCents,
          durationMin: s.durationMin,
          tag: s.tag,
          sortOrder: s.sortOrder,
        },
      });
  }
  console.log(`✓ ${SERVICES.length} serviços`);

  // ── Planos + cobertura ──
  for (const p of PLANS) {
    const [row] = await db
      .insert(plans)
      .values({
        slug: p.slug,
        name: p.name,
        kicker: p.kicker,
        tagline: p.tagline,
        priceCents: p.priceCents,
        annualPriceCents: p.annualPriceCents,
        features: p.features,
        highlight: p.highlight,
        badge: p.badge,
        sortOrder: p.sortOrder,
      })
      .onConflictDoUpdate({
        target: plans.slug,
        set: {
          name: p.name,
          kicker: p.kicker,
          tagline: p.tagline,
          priceCents: p.priceCents,
          annualPriceCents: p.annualPriceCents,
          features: p.features,
          highlight: p.highlight,
          badge: p.badge,
          sortOrder: p.sortOrder,
        },
      })
      .returning();

    await db.delete(planServices).where(eq(planServices.planId, row.id));
    for (const slug of p.covers) {
      const svc = await db.query.services.findFirst({
        where: eq(services.slug, slug),
      });
      if (svc)
        await db
          .insert(planServices)
          .values({ planId: row.id, serviceId: svc.id })
          .onConflictDoNothing();
    }
  }
  console.log(`✓ ${PLANS.length} planos`);

  // ── Equipe (usuário + barbeiro) ──
  for (let i = 0; i < TEAM.length; i++) {
    const t = TEAM[i];
    const [user] = await db
      .insert(users)
      .values({
        name: t.name,
        phone: normalizePhone(t.phone),
        email: t.email,
        passwordHash: hash,
        role: t.admin ? "ADMIN" : "BARBER",
      })
      .onConflictDoUpdate({
        target: users.phone,
        set: { name: t.name, email: t.email, role: t.admin ? "ADMIN" : "BARBER" },
      })
      .returning();

    await db
      .insert(barbers)
      .values({
        userId: user.id,
        slug: t.slug,
        shortName: t.shortName,
        title: t.title,
        rating: t.rating,
        commissionPct: t.commissionPct,
        sortOrder: i + 1,
      })
      .onConflictDoUpdate({
        target: barbers.slug,
        set: {
          userId: user.id,
          shortName: t.shortName,
          title: t.title,
          rating: t.rating,
          commissionPct: t.commissionPct,
          sortOrder: i + 1,
        },
      });
  }
  console.log(`✓ ${TEAM.length} membros da equipe`);
  console.log(`\nLogin inicial — senha: ${defaultPassword}`);
  for (const t of TEAM) console.log(`  ${t.email}  (${t.admin ? "ADMIN" : "BARBEIRO"})`);

  await sql.end();
}

// `npm run db:seed` executa direto; o migrate importa e chama runSeed().
if (require.main === module) {
  runSeed().catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
}
