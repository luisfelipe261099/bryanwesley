// Avisos no celular (Web Push): inscrição, chaves, quem recebe o quê, a
// fila de lembretes e o despacho. O serviço de push é um falso que anota
// o que receberia — nada sai da máquina.
import "../db/load-env";
import webpush from "web-push";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications, barbers, plans,
  planRequests, pushSubscriptions, pushVapid, rateLimits, services as sv, subscriptions, users, whatsappPonte,
} from "../db/schema";
import {
  chavesVapid, chavePublicaPush, esquecerChaves, lerInscricao, salvarInscricao, removerInscricao,
  contarAparelhos, inscricoesDe, enviarPush, usarTransporte, nomeDoAparelho, hashDoEndpoint,
  aparelhosDaEquipe, MAX_APARELHOS_POR_PESSOA, chavesValidas, type Transporte,
} from "../lib/push";
import {
  avisarEquipe, avisarCliente, avisarPedidoDePlano, avisarPagamento, alertarWhatsappCaido, alertarWahaDesconectado,
  quandoCurto, PONTE_ALERTA_MS, TETO_AVISOS_POR_CLIENTE_HORA,
} from "../lib/avisos";
import { createBooking, rescheduleBooking, transitionAppointment } from "../lib/appointments";
import { garantirLembretesPush, pendingNotifications } from "../lib/notifications";
import { despacharPush, runDispatch, ttlAteOHorario } from "../lib/dispatch";
import { receberSinal } from "../lib/ponte";
import { getSettings, getAvailability } from "../lib/schedule";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { and, eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZPush";
const FONE = (n: number) => `4197009${String(n).padStart(4, "0")}`;
const END = (nome: string) => `https://push.exemplo.test/${MARCA}/${nome}`;
const INSC = (nome: string) => ({
  endpoint: END(nome),
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

/** O serviço de push falso: anota cada envio; alguns endereços falham. */
type Envio = { endpoint: string; payload: unknown; ttl?: number };
const enviados: Envio[] = [];
const falso: Transporte = async (i, payload, opcoes) => {
  if (i.endpoint.endsWith("/morto")) {
    const e = new webpush.WebPushError("Gone", 410, {}, "", i.endpoint);
    throw e;
  }
  if (i.endpoint.endsWith("/caido")) {
    const e = new webpush.WebPushError("Server error", 500, {}, "", i.endpoint);
    throw e;
  }
  if (i.endpoint.endsWith("/lento")) {
    await new Promise((r) => setTimeout(r, 30_000));
  }
  enviados.push({ endpoint: i.endpoint, payload: JSON.parse(payload), ttl: opcoes.TTL });
  return { statusCode: 201 };
};
const recebeu = (nome: string) => enviados.filter((e) => e.endpoint === END(nome));
const zerar = () => enviados.splice(0, enviados.length);

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197009%"));
  const ids = gente.map((u) => u.id);
  await db.delete(rateLimits).where(like(rateLimits.chave, "push:%"));
  await db.delete(notifications).where(like(notifications.phone, "4197009%"));
  await db.delete(pushSubscriptions).where(like(pushSubscriptions.endpoint, `%/${MARCA}/%`));
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments).where(inArray(appointments.clientUserId, ids));
  const apptIds = appts.map((a) => a.id);
  if (apptIds.length) {
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, apptIds));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, apptIds));
    await db.delete(notifications).where(inArray(notifications.appointmentId, apptIds));
    await db.delete(appointments).where(inArray(appointments.id, apptIds));
  }
  await db.delete(planRequests).where(inArray(planRequests.userId, ids));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
  await db.delete(barbers).where(inArray(barbers.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

async function diaComVagas(durationMin: number, n: number, barberId: number | null = null) {
  const settings = await getSettings();
  for (let i = 2; i <= 20; i++) {
    const dia = addDays(shopToday(), i);
    if (settings.closedWeekdays.includes(weekdayOf(dia))) continue;
    const { slots } = await getAvailability({ dateKey: dia, durationMin, barberId });
    const livres = slots.filter((s) => s.available);
    if (livres.length >= n) return { dia, livres: livres.map((s) => s.time) };
  }
  throw new Error("sem vaga para montar o teste");
}

async function main() {
  await limpar();
  usarTransporte(falso);
  // Sem ponte: o despacho roda inteiro aqui.
  await db.delete(whatsappPonte);

  // Gente do teste: um admin, um barbeiro (com cadeira) e um cliente.
  const [{ id: adminId }] = await db.insert(users).values({ name: `${MARCA} Admin`, phone: FONE(1), role: "ADMIN" }).$returningId();
  const [{ id: barbeiroUserId }] = await db.insert(users).values({ name: `${MARCA} Barbeiro`, phone: FONE(2), role: "BARBER" }).$returningId();
  const [{ id: barberId }] = await db.insert(barbers).values({
    userId: barbeiroUserId, slug: `${MARCA.toLowerCase()}-barbeiro`, shortName: "ZZBarb", title: "Barbeiro", sortOrder: 99,
  }).$returningId();
  const [{ id: clienteId }] = await db.insert(users).values({ name: `${MARCA} Cliente`, phone: FONE(3), role: "CLIENT" }).$returningId();
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;

  console.log("\n1. Chaves VAPID nascem sozinhas e ficam no banco");
  {
    esquecerChaves();
    const antes = await db.select().from(pushVapid).where(eq(pushVapid.id, 1));
    const chaves = await chavesVapid();
    ok("tem chave pública e privada", chaves.publicKey.length > 60 && chaves.privateKey.length > 30);
    const depois = await db.select().from(pushVapid).where(eq(pushVapid.id, 1));
    ok("gravadas na linha única", depois.length === 1 && depois[0].publicKey === chaves.publicKey);
    esquecerChaves();
    const deNovo = await chavesVapid();
    ok("na próxima vez vêm as mesmas (não gera outras)", deNovo.publicKey === chaves.publicKey);
    ok("a chave pública do site é essa", (await chavePublicaPush()) === chaves.publicKey);
    ok(antes.length === 0 ? "o banco estava sem chave antes" : "já havia chave (banco reaproveitado)", true);
    // web-push aceita as chaves: monta os cabeçalhos VAPID sem reclamar.
    const det = webpush.generateRequestDetails(INSC("x"), "oi", {
      vapidDetails: { subject: "https://bryanwesley.vercel.app", publicKey: chaves.publicKey, privateKey: chaves.privateKey },
      contentEncoding: "aes128gcm",
    });
    ok("web-push assina com elas (Authorization: vapid …)", String(det.headers.Authorization).startsWith("vapid "));
    ok("payload cifrado em aes128gcm", det.headers["Content-Encoding"] === "aes128gcm" && Buffer.isBuffer(det.body));

    // Variável de ambiente com chave quebrada não derruba os envios: é
    // ignorada e valem as do banco.
    ok("chaves geradas passam na conferência de formato", chavesValidas(chaves.publicKey, chaves.privateKey));
    ok("chave pública curta não passa", !chavesValidas("abc", chaves.privateKey));
    ok("chave privada de outro tamanho não passa", !chavesValidas(chaves.publicKey, "AAAA"));
    process.env.VAPID_PUBLIC_KEY = "nao-e-chave";
    process.env.VAPID_PRIVATE_KEY = "nem-esta";
    esquecerChaves();
    const comEnvRuim = await chavesVapid();
    ok("variável inválida é ignorada: valem as do banco", comEnvRuim.publicKey === chaves.publicKey);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    esquecerChaves();
  }

  console.log("\n2. Inscrição: o que vem do navegador é conferido");
  {
    ok("inscrição boa passa", lerInscricao(INSC("a")) !== null);
    ok("sem endpoint não passa", lerInscricao({ keys: INSC("a").keys }) === null);
    ok("endpoint que não é URL não passa", lerInscricao({ ...INSC("a"), endpoint: "nada" }) === null);
    ok("ftp:// não passa", lerInscricao({ ...INSC("a"), endpoint: "ftp://x.test/a" }) === null);
    ok("chave p256dh curta não passa", lerInscricao({ endpoint: END("a"), keys: { p256dh: "abc", auth: INSC("a").keys.auth } }) === null);
    ok("auth com caractere estranho não passa", lerInscricao({ endpoint: END("a"), keys: { p256dh: INSC("a").keys.p256dh, auth: "a b c d e f g h i j k" } }) === null);
    ok("endpoint com usuário:senha não passa", lerInscricao({ ...INSC("a"), endpoint: "https://u:p@x.test/a" }) === null);
    ok("p256dh com 65 bytes mas que não é ponto P-256 (não começa com 0x04) não passa",
      lerInscricao({ endpoint: END("a"), keys: { p256dh: "A" + INSC("a").keys.p256dh.slice(1), auth: INSC("a").keys.auth } }) === null);
    ok("p256dh de 64 bytes não passa", lerInscricao({ endpoint: END("a"), keys: { p256dh: INSC("a").keys.p256dh.slice(0, -2), auth: INSC("a").keys.auth } }) === null);
    ok("auth de 15 bytes não passa", lerInscricao({ endpoint: END("a"), keys: { p256dh: INSC("a").keys.p256dh, auth: "tBHItJI5svbpez7KI4CC" } }) === null);
    ok("fora de produção, IP local passa (testes)", lerInscricao({ ...INSC("a"), endpoint: "http://127.0.0.1:9/x" }) !== null);
    ok("nome do aparelho: iPhone · Safari", nomeDoAparelho("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1") === "iPhone · Safari");
    ok("nome do aparelho: Android · Chrome", nomeDoAparelho("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36") === "Android · Chrome");
    ok("sem User-Agent, sem nome", nomeDoAparelho(null) === null);

    await salvarInscricao(adminId, INSC("admin-cel"), "Android · Chrome");
    await salvarInscricao(adminId, INSC("admin-cel"), "Android · Chrome");
    ok("inscrever duas vezes o mesmo aparelho não duplica", (await contarAparelhos(adminId)) === 1);
    await salvarInscricao(adminId, INSC("admin-pc"), "Windows · Chrome");
    ok("segundo aparelho conta", (await contarAparelhos(adminId)) === 2);

    // O mesmo celular passou para outra pessoa: a inscrição muda de dono.
    await salvarInscricao(clienteId, INSC("admin-pc"), "Windows · Chrome");
    ok("aparelho que trocou de dono sai do dono antigo", (await contarAparelhos(adminId)) === 1);
    ok("e passa para o novo", (await contarAparelhos(clienteId)) === 1);
    ok("remover por endpoint de outra pessoa não remove", (await removerInscricao(adminId, END("admin-pc"))) === false);
    ok("remover o próprio remove", (await removerInscricao(clienteId, END("admin-pc"))) === true);
    ok("hash é sha256 hex", /^[0-9a-f]{64}$/.test(hashDoEndpoint(END("x"))));

    // Teto por pessoa.
    for (let i = 0; i < MAX_APARELHOS_POR_PESSOA + 3; i++) {
      await salvarInscricao(clienteId, INSC(`cli-${i}`), `Aparelho ${i}`);
    }
    ok(`teto de ${MAX_APARELHOS_POR_PESSOA} aparelhos por pessoa`, (await contarAparelhos(clienteId)) === MAX_APARELHOS_POR_PESSOA);
    const sobraram = await inscricoesDe([clienteId]);
    ok("os mais recentes ficam", sobraram.some((s) => s.endpoint === END(`cli-${MAX_APARELHOS_POR_PESSOA + 2}`)) && !sobraram.some((s) => s.endpoint === END("cli-0")));
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, clienteId));
  }

  console.log("\n3. Envio: entrega, quem está fora, aparelho morto e falha passageira");
  {
    zerar();
    await salvarInscricao(barbeiroUserId, INSC("barb-cel"), "Android · Chrome");
    await salvarInscricao(barbeiroUserId, INSC("morto"), "Android antigo");
    await salvarInscricao(barbeiroUserId, INSC("caido"), "Tablet");
    const r = await enviarPush([adminId, barbeiroUserId], { titulo: "Teste", corpo: "Olá", url: "/x", tag: "t1" });
    ok("entregou nos aparelhos vivos", r.enviadas === 2, JSON.stringify(r));
    ok("o aparelho que o serviço diz não existir (410) saiu da lista", r.removidas === 1 && !(await inscricoesDe([barbeiroUserId])).some((s) => s.endpoint === END("morto")));
    ok("a falha passageira (500) conta uma falha e fica", r.falhas === 1 && (await inscricoesDe([barbeiroUserId])).some((s) => s.endpoint === END("caido") && s.falhas === 1));
    ok("contou os aparelhos tentados", r.aparelhos === 4);
    const carga = recebeu("admin-cel")[0]?.payload as Record<string, unknown>;
    ok("o aviso leva título, corpo, url e tag", carga?.titulo === "Teste" && carga?.corpo === "Olá" && carga?.url === "/x" && carga?.tag === "t1");
    ok("e um carimbo de hora", typeof carga?.quando === "number");

    zerar();
    const r2 = await enviarPush([adminId, barbeiroUserId], { titulo: "T", corpo: "c" }, { excluir: [adminId] });
    ok("quem está excluído não recebe", recebeu("admin-cel").length === 0 && r2.enviadas === 1);
    const r3 = await enviarPush([], { titulo: "T", corpo: "c" });
    ok("sem destinatário, nada acontece", r3.aparelhos === 0 && r3.enviadas === 0);
    const r4 = await enviarPush([clienteId], { titulo: "T", corpo: "c" });
    ok("pessoa sem aparelho: zero aparelhos (quem chama sabe que não chegou)", r4.aparelhos === 0);

    // Conta desativada não recebe.
    await db.update(users).set({ active: false }).where(eq(users.id, barbeiroUserId));
    const r5 = await enviarPush([barbeiroUserId], { titulo: "T", corpo: "c" });
    ok("conta desativada não recebe", r5.aparelhos === 0);
    await db.update(users).set({ active: true }).where(eq(users.id, barbeiroUserId));

    // Falhas seguidas: o aparelho "caído" sai depois de várias.
    for (let i = 0; i < 10; i++) await enviarPush([barbeiroUserId], { titulo: "T", corpo: "c" });
    ok("aparelho que só falha sai da lista depois de várias falhas", !(await inscricoesDe([barbeiroUserId])).some((s) => s.endpoint === END("caido")));
    // O que entrega sempre zera as falhas.
    const vivo = (await inscricoesDe([barbeiroUserId])).find((s) => s.endpoint === END("barb-cel"));
    ok("o aparelho que entrega fica com zero falhas", vivo?.falhas === 0);

    // Envio lento não segura a ação de quem agendou.
    await salvarInscricao(adminId, INSC("lento"), "Lento");
    const t0 = Date.now();
    const r6 = await enviarPush([adminId], { titulo: "T", corpo: "c" });
    const dt = Date.now() - t0;
    ok("serviço que não responde é cortado em ~6s", dt < 8_000 && r6.falhas === 1, `${dt}ms ${JSON.stringify(r6)}`);
    const lento = (await inscricoesDe([adminId])).find((s) => s.endpoint === END("lento"));
    ok("tempo esgotado não conta contra o aparelho (o problema é daqui)", lento?.falhas === 0, String(lento?.falhas));
    await removerInscricao(adminId, END("lento"));
    ok("TTL padrão de um dia", recebeu("admin-cel").every((e) => e.ttl === 24 * 3600));
    zerar();
    await enviarPush([adminId], { titulo: "T", corpo: "c" }, { ttlSegundos: 7200 });
    ok("TTL pedido é respeitado", recebeu("admin-cel")[0]?.ttl === 7200, String(recebeu("admin-cel")[0]?.ttl));
    zerar();
  }

  console.log("\n4. Agendamento novo avisa admin e barbeiro — menos quem marcou");
  {
    zerar();
    await db.delete(rateLimits).where(like(rateLimits.chave, "push:equipe:%"));
    await salvarInscricao(clienteId, INSC("cli-cel"), "iPhone · Safari");
    const { dia, livres } = await diaComVagas(corte.durationMin, 3, barberId);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId,
      clientName: `${MARCA} Cliente`, clientPhone: FONE(3), userId: clienteId, autorUserId: clienteId,
    });
    const admin = recebeu("admin-cel"), barb = recebeu("barb-cel"), cli = recebeu("cli-cel");
    ok("admin recebeu 'Novo agendamento'", admin.length === 1 && (admin[0].payload as { titulo: string }).titulo === "Novo agendamento", JSON.stringify(admin));
    ok("barbeiro do horário recebeu", barb.length === 1);
    ok("o cliente que marcou não recebe aviso da própria ação", cli.length === 0);
    const corpo = (admin[0].payload as { corpo: string }).corpo;
    ok("o aviso diz quem, o quê, quando e com quem", corpo.includes(`${MARCA} Cliente`) && corpo.includes("Corte") && corpo.includes(quandoCurto(appt.startsAt)) && corpo.includes("ZZBarb"), corpo);
    ok("admin abre a agenda do dia", (admin[0].payload as { url: string }).url === `/admin/agenda?dia=${dia}`);
    ok("barbeiro abre a agenda dele", (barb[0].payload as { url: string }).url === `/barbeiro?dia=${dia}`);
    ok("a tag é do agendamento (avisos seguintes substituem)", (admin[0].payload as { tag: string }).tag === `agendamento-${appt.id}`);

    // Lembretes do cliente ganharam a versão push (ele tem aparelho).
    const fila = await db.select().from(notifications).where(eq(notifications.appointmentId, appt.id));
    const push = fila.filter((n) => n.channel === "PUSH").map((n) => n.kind).sort();
    ok("lembretes de 24h e 2h também pelo celular", JSON.stringify(push) === JSON.stringify(["LEMBRETE_24H", "LEMBRETE_2H"]), JSON.stringify(push));
    ok("a confirmação não vai para a fila push (foi na hora)", !fila.some((n) => n.channel === "PUSH" && n.kind === "AGENDAMENTO_CRIADO"));
    ok("as de WhatsApp continuam como antes", fila.filter((n) => n.channel === "WHATSAPP").length === 3);

    // Admin marcando para o cliente: o admin não recebe, o barbeiro e o cliente sim.
    zerar();
    const appt2 = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: livres[2], barberId,
      clientName: `${MARCA} Cliente`, clientPhone: FONE(3), userId: clienteId, autorUserId: adminId,
    });
    ok("admin que marcou não recebe", recebeu("admin-cel").length === 0);
    ok("barbeiro recebe", recebeu("barb-cel").length === 1);
    const c = recebeu("cli-cel");
    ok("cliente recebe 'Horário confirmado' com o código", c.length === 1 && (c[0].payload as { titulo: string; corpo: string }).titulo === "Horário confirmado" && (c[0].payload as { corpo: string }).corpo.includes(appt2.code), JSON.stringify(c));

    // Cancelamento pelo cliente: equipe sabe, cliente não.
    zerar();
    await transitionAppointment(appt2.id, "CANCELADO", { autorUserId: clienteId });
    ok("cancelou: admin e barbeiro recebem 'Horário cancelado'", recebeu("admin-cel").length === 1 && recebeu("barb-cel").length === 1 && (recebeu("admin-cel")[0].payload as { titulo: string }).titulo === "Horário cancelado");
    ok("cliente que cancelou não recebe", recebeu("cli-cel").length === 0);
    const push2 = await db.select().from(notifications).where(and(eq(notifications.appointmentId, appt2.id), eq(notifications.channel, "PUSH")));
    ok("lembretes push do cancelado caem junto", push2.every((n) => n.status === "CANCELADA"), JSON.stringify(push2.map((n) => n.status)));

    // Cancelamento pelo admin: cliente recebe; sem aviso à equipe quando pedido (lote).
    zerar();
    await transitionAppointment(appt.id, "CANCELADO", { autorUserId: adminId, semAvisoAEquipe: true });
    ok("em lote, a equipe não recebe", recebeu("admin-cel").length === 0 && recebeu("barb-cel").length === 0);
    ok("mas o cliente recebe 'Horário cancelado'", recebeu("cli-cel").length === 1 && (recebeu("cli-cel")[0].payload as { titulo: string }).titulo === "Horário cancelado");

    // Remarcação pelo admin.
    zerar();
    const { dia: d2, livres: l2 } = await diaComVagas(corte.durationMin, 2, barberId);
    const appt3 = await createBooking({
      serviceIds: [corte.id], dateKey: d2, time: l2[0], barberId,
      clientName: `${MARCA} Cliente`, clientPhone: FONE(3), userId: clienteId, autorUserId: clienteId,
    });
    zerar();
    const novo = await rescheduleBooking({ appointmentId: appt3.id, dateKey: d2, time: l2[1], barberId, autorUserId: adminId });
    ok("remarcou: barbeiro recebe 'Horário remarcado' uma vez só", recebeu("barb-cel").length === 1 && (recebeu("barb-cel")[0].payload as { titulo: string }).titulo === "Horário remarcado", JSON.stringify(recebeu("barb-cel")));
    ok("admin que remarcou não recebe", recebeu("admin-cel").length === 0);
    ok("cliente recebe o novo horário", recebeu("cli-cel").length === 1 && (recebeu("cli-cel")[0].payload as { corpo: string }).corpo.includes(novo.code));
    ok("nenhum aviso de 'criado' vazou na remarcação", !enviados.some((e) => (e.payload as { titulo: string }).titulo === "Novo agendamento"));
    ok("o aviso de remarcado substitui o 'Novo agendamento' do horário antigo (mesma tag)", (recebeu("barb-cel")[0].payload as { tag: string }).tag === `agendamento-${appt3.id}`);

    // Remarcação para OUTRO barbeiro: o antigo fica sabendo que o horário saiu.
    const [{ id: outroUserId }] = await db.insert(users).values({ name: `${MARCA} Outro`, phone: FONE(4), role: "BARBER" }).$returningId();
    const [{ id: outroBarberId }] = await db.insert(barbers).values({ userId: outroUserId, slug: `${MARCA.toLowerCase()}-outro`, shortName: "ZZOutro", title: "Barbeiro", sortOrder: 98 }).$returningId();
    await salvarInscricao(outroUserId, INSC("outro-cel"), "Android · Chrome");
    const { dia: d3, livres: l3 } = await diaComVagas(corte.durationMin, 1, outroBarberId);
    zerar();
    const novo2 = await rescheduleBooking({ appointmentId: novo.id, dateKey: d3, time: l3[0], barberId: outroBarberId, autorUserId: adminId });
    ok("o barbeiro novo recebe 'Horário remarcado'", recebeu("outro-cel").length === 1 && (recebeu("outro-cel")[0].payload as { titulo: string }).titulo === "Horário remarcado", JSON.stringify(recebeu("outro-cel")));
    ok("o barbeiro antigo recebe 'Horário saiu da sua agenda'", recebeu("barb-cel").length === 1 && (recebeu("barb-cel")[0].payload as { titulo: string }).titulo === "Horário saiu da sua agenda", JSON.stringify(recebeu("barb-cel")));
    ok("com a tag do horário antigo (substitui o aviso de antes)", (recebeu("barb-cel")[0].payload as { tag: string }).tag === `agendamento-${novo.id}`);
    void novo2;

    // Barbeiro que também é admin recebe uma vez só.
    zerar();
    await db.update(users).set({ role: "ADMIN" }).where(eq(users.id, barbeiroUserId));
    await avisarEquipe("criado", novo, { autorUserId: clienteId });
    ok("barbeiro-admin recebe uma vez (versão do admin)", recebeu("barb-cel").length === 1 && (recebeu("barb-cel")[0].payload as { url: string }).url.startsWith("/admin/agenda"));
    await db.update(users).set({ role: "BARBER" }).where(eq(users.id, barbeiroUserId));
    zerar();
  }

  console.log("\n5. Freio: um cliente não vira rajada no celular da equipe");
  {
    zerar();
    await db.delete(rateLimits).where(like(rateLimits.chave, "push:equipe:%"));
    const appt = (await db.query.appointments.findFirst({ where: eq(appointments.clientUserId, clienteId) }))!;
    for (let i = 0; i < TETO_AVISOS_POR_CLIENTE_HORA + 2; i++) await avisarEquipe("criado", appt);
    ok(`no máximo ${TETO_AVISOS_POR_CLIENTE_HORA} avisos à equipe por cliente por hora`, recebeu("admin-cel").length === TETO_AVISOS_POR_CLIENTE_HORA, String(recebeu("admin-cel").length));
    zerar();
    await avisarEquipe("cancelado", appt);
    ok("cancelamento passa pelo freio sempre", recebeu("admin-cel").length === 1);
    zerar();
    await avisarEquipe("criado", appt, { autorUserId: adminId });
    ok("o balcão (admin marcando) não entra na conta do freio", recebeu("barb-cel").length === 1, String(recebeu("barb-cel").length));
    zerar();
    const passado = { ...appt, startsAt: new Date(Date.now() - 2 * 3600_000) };
    await avisarEquipe("cancelado", passado);
    await avisarCliente("AGENDAMENTO_CANCELADO", passado);
    ok("cancelar horário que já passou não avisa ninguém (é arrumação)", enviados.length === 0);
    await db.delete(rateLimits).where(like(rateLimits.chave, "push:equipe:%"));
  }

  console.log("\n6. Pedido de plano, pagamento e o cliente");
  {
    zerar();
    await avisarPedidoDePlano({ userId: clienteId, nomeCliente: "Fulano", nomePlano: "Plano Gold", ciclo: "ANUAL" });
    const a = recebeu("admin-cel");
    ok("admin recebe 'Pedido de plano' e abre o painel", a.length === 1 && (a[0].payload as { titulo: string; url: string; corpo: string }).titulo === "Pedido de plano" && (a[0].payload as { url: string }).url === "/admin" && (a[0].payload as { corpo: string }).corpo.includes("anual"));
    ok("barbeiro não recebe pedido de plano", recebeu("barb-cel").length === 0);
    zerar();
    const planoQualquer = (await db.query.plans.findFirst())!;
    await avisarPagamento({ userId: clienteId, planId: planoQualquer.id });
    ok("pagamento: admin sabe e o cliente também", recebeu("admin-cel").length === 1 && recebeu("cli-cel").length === 1 && (recebeu("cli-cel")[0].payload as { titulo: string }).titulo === "Plano ativo");
    zerar();
    await avisarCliente("AGENDAMENTO_CRIADO", { ...((await db.query.appointments.findFirst({ where: eq(appointments.clientUserId, clienteId) }))!), clientUserId: null });
    ok("agendamento sem conta de cliente: ninguém para avisar, sem erro", enviados.length === 0);
  }

  console.log("\n7. Fila: lembretes pelo celular saem no despacho, sem depender do WhatsApp");
  {
    zerar();
    const appt = (await db.query.appointments.findFirst({
      where: and(eq(appointments.clientUserId, clienteId), eq(appointments.status, "CONFIRMADO")),
    }))!;
    // Finge que o lembrete de 24h chegou na hora.
    await db.update(notifications).set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_24H")));
    const whats = await pendingNotifications(50);
    ok("a fila do WhatsApp só tem WhatsApp", whats.every((n) => n.channel === "WHATSAPP"));
    const prontas = await pendingNotifications(50, "PUSH");
    ok("a fila push tem o lembrete de 24h", prontas.some((n) => n.appointmentId === appt.id && n.kind === "LEMBRETE_24H"));

    const r = await despacharPush(50);
    ok("o despacho entregou o lembrete no celular", r.enviadas >= 1 && recebeu("cli-cel").some((e) => (e.payload as { titulo: string }).titulo === "Lembrete do seu horário"), JSON.stringify(r));
    {
      const ttl = recebeu("cli-cel").find((e) => (e.payload as { titulo: string }).titulo === "Lembrete do seu horário")?.ttl ?? 0;
      // O teste adiantou o scheduledFor para "agora": a função conta 24h a
      // partir dele, com teto de um dia.
      ok("lembrete vale até a hora do atendimento no serviço de push (teto de 1 dia)", ttl > 24 * 3600 - 300 && ttl <= 24 * 3600, String(ttl));
      ok("a conta pela hora do atendimento é exata", ttlAteOHorario("LEMBRETE_2H", new Date(Date.now() + 30 * 60_000)) - 2.5 * 3600 < 2 && ttlAteOHorario("LEMBRETE_24H", new Date(Date.now() - 23 * 3600_000)) - 3600 < 2);
      ok("lembrete já vencido vale o mínimo de 1 min", ttlAteOHorario("LEMBRETE_2H", new Date(Date.now() - 3 * 3600_000)) === 60);
    }
    const linha = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_24H"), eq(notifications.channel, "PUSH")),
    });
    ok("e marcou como enviada", linha?.status === "ENVIADA", linha?.status);
    const whatsLinha = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_24H"), eq(notifications.channel, "WHATSAPP")),
    });
    ok("a de WhatsApp continua na fila dela (sem provedor)", whatsLinha?.status === "PENDENTE", whatsLinha?.status);

    // A ponte não leva aviso de celular.
    await db.insert(whatsappPonte).values({ id: 1, segredoHash: "x".repeat(64), pareadaEm: new Date() }).onDuplicateKeyUpdate({ set: { pareadaEm: new Date() } });
    await db.update(notifications).set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_2H")));
    const sinal = await receberSinal({ status: "WORKING", numero: "5541999990000" } as Parameters<typeof receberSinal>[0]);
    const idsPush = (await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.channel, "PUSH"))).map((n) => n.id);
    ok("a ponte só recebe mensagens de WhatsApp", sinal.mensagens.every((m) => !idsPush.includes(m.id)));
    // Devolve o que a ponte arrendou, para o resto do teste.
    await db.update(notifications).set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(and(eq(notifications.status, "PENDENTE"), like(notifications.phone, "4197009%")));
    await db.delete(whatsappPonte);

    // Cliente sem aparelho: a mensagem push sai da fila com o motivo.
    zerar();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, clienteId));
    const r2 = await despacharPush(50);
    ok("sem aparelho, o lembrete push é descartado com motivo", r2.semAparelho >= 1, JSON.stringify(r2));
    const l2 = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_2H"), eq(notifications.channel, "PUSH")),
    });
    ok("marcado como cancelada com 'Nenhum aparelho'", l2?.status === "CANCELADA" && /Nenhum aparelho/.test(l2.error ?? ""), `${l2?.status} ${l2?.error}`);

    // Ligou os avisos depois de marcar: os lembretes ganham a versão push.
    const { dia, livres } = await diaComVagas(corte.durationMin, 1, barberId);
    const semPush = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId,
      clientName: `${MARCA} Cliente`, clientPhone: FONE(3), userId: clienteId, autorUserId: clienteId,
    });
    const antes = await db.select().from(notifications).where(and(eq(notifications.appointmentId, semPush.id), eq(notifications.channel, "PUSH")));
    ok("sem aparelho, o agendamento não cria lembrete push", antes.length === 0);
    await salvarInscricao(clienteId, INSC("cli-cel"), "iPhone · Safari");
    const criados = await garantirLembretesPush(clienteId);
    const depois = await db.select().from(notifications).where(and(eq(notifications.appointmentId, semPush.id), eq(notifications.channel, "PUSH")));
    ok("ao ligar os avisos, os lembretes dos horários marcados ganham a versão push", criados >= 2 && depois.length === 2, `${criados} ${depois.length}`);
    ok("ligar de novo não duplica", (await garantirLembretesPush(clienteId)) === 0);

    // runDispatch inteiro inclui o push no relatório.
    const rd = await runDispatch(20);
    ok("o relatório da varredura traz o bloco push", rd.push !== undefined && typeof rd.push.enviadas === "number");
    zerar();
  }

  console.log("\n8. WhatsApp caído: o admin fica sabendo, uma vez a cada 12 h");
  {
    zerar();
    await db.delete(rateLimits).where(like(rateLimits.chave, "push:%"));
    ok("sem ponte instalada, nenhum alerta", (await alertarWhatsappCaido()).aparelhos === 0 && enviados.length === 0);
    const agora = new Date();
    const h = (n: number) => new Date(agora.getTime() - n * 3600_000);
    const ponte = async (campos: Partial<typeof whatsappPonte.$inferInsert>) => {
      await db.delete(whatsappPonte);
      await db.insert(whatsappPonte).values({ id: 1, segredoHash: "x".repeat(64), pareadaEm: h(3), vistoEm: agora, status: "WORKING", ...campos });
    };

    await ponte({ vistoEm: new Date(agora.getTime() - PONTE_ALERTA_MS - 60_000) });
    const r = await alertarWhatsappCaido(agora);
    ok("ponte muda há mais de 15 min: admin recebe 'WhatsApp fora do ar'", r.enviadas === 1 && (recebeu("admin-cel")[0]?.payload as { titulo: string })?.titulo === "WhatsApp fora do ar", JSON.stringify(r));
    ok("barbeiro não recebe", recebeu("barb-cel").length === 0);
    ok("o texto não exagera o tempo (piso, não arredondamento)", /há mais de 1[56] min/.test((recebeu("admin-cel")[0]?.payload as { corpo: string })?.corpo ?? ""), (recebeu("admin-cel")[0]?.payload as { corpo: string })?.corpo);
    zerar();
    const r2 = await alertarWhatsappCaido(agora);
    ok("de novo em seguida, não repete", r2.enviadas === 0 && enviados.length === 0);

    await db.delete(rateLimits).where(like(rateLimits.chave, "push:%"));
    await ponte({ status: "SCAN_QR_CODE" });
    const r3 = await alertarWhatsappCaido(agora);
    ok("ponte viva mas número desconectado (depois de já ter funcionado): avisa para ler o QR", r3.enviadas === 1 && /QR/.test((recebeu("admin-cel")[0]?.payload as { corpo: string })?.corpo ?? ""));
    zerar();

    await db.delete(rateLimits).where(like(rateLimits.chave, "push:%"));
    await ponte({ status: "SCAN_QR_CODE", pareadaEm: h(0.5) });
    ok("primeiro QR de uma ponte recém-instalada não é alarme", (await alertarWhatsappCaido(agora)).enviadas === 0);
    await ponte({ status: "INSTALANDO", vistoEm: null, pareadaEm: h(0.1) });
    ok("instalação em andamento não é alarme", (await alertarWhatsappCaido(agora)).enviadas === 0);
    await ponte({ status: "WORKING" });
    ok("tudo certo: silêncio", (await alertarWhatsappCaido(agora)).enviadas === 0);

    // Desligada pelo painel: nem o carimbo antigo faz alarme.
    await ponte({ segredoHash: null, vistoEm: new Date(agora.getTime() - PONTE_ALERTA_MS * 10) });
    ok("ponte desligada pelo painel não é ponte caída", (await alertarWhatsappCaido(agora)).enviadas === 0);
    await ponte({ vistoEm: new Date(agora.getTime() - PONTE_ALERTA_MS * 10) });
    process.env.WHATSAPP_PROVIDER = "meta";
    ok("com outro provedor escolhido, a ponte não conta", (await alertarWhatsappCaido(agora)).enviadas === 0);
    delete process.env.WHATSAPP_PROVIDER;

    // WAHA próprio desconectado: mesmo alerta, mesma cadência.
    zerar();
    await db.delete(rateLimits).where(like(rateLimits.chave, "push:%"));
    ok("WAHA próprio desconectado avisa para conectar de novo", (await alertarWahaDesconectado(agora)).enviadas === 1 && /conecte de novo/.test((recebeu("admin-cel")[0]?.payload as { corpo: string })?.corpo ?? ""));
    ok("e respeita a cadência de 12 h", (await alertarWahaDesconectado(agora)).enviadas === 0);
    zerar();
    await db.delete(whatsappPonte);
    await db.delete(rateLimits).where(like(rateLimits.chave, "push:%"));
  }

  console.log("\n9. O painel vê quem da equipe ligou");
  {
    const equipe = await aparelhosDaEquipe();
    const a = equipe.find((e) => e.userId === adminId);
    const b = equipe.find((e) => e.userId === barbeiroUserId);
    ok("admin aparece com 1 aparelho", a?.aparelhos === 1, JSON.stringify(a));
    ok("barbeiro aparece com 1 aparelho", b?.aparelhos === 1, JSON.stringify(b));
    ok("cliente não entra na lista da equipe", !equipe.some((e) => e.userId === clienteId));
  }

  usarTransporte(null);
  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
