// Link de nova senha por e-mail (Gmail): envio interceptado, nada sai.
import "../db/load-env";
import nodemailer from "nodemailer";
import { db, pool } from "../db/client";
import { passwordResets, users } from "../db/schema";
import { eq } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const enviados: { to: string; subject: string; html?: string; text?: string; from?: string }[] = [];
(nodemailer as unknown as { createTransport: unknown }).createTransport = () => ({
  sendMail: async (m: { to: string; subject: string; html?: string; text?: string; from?: string }) => { enviados.push(m); return { messageId: "x" }; },
});

async function main() {
  const email = await import("../lib/email");
  const link = await import("../lib/senha-link");
  delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD;
  ok("sem configuração, o e-mail fica desligado", !email.emailConfigurado());
  process.env.GMAIL_USER = "barbearia@teste.com";
  process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
  ok("com Gmail e senha de app, liga", email.emailConfigurado());

  ok("normaliza e-mail", email.normalizarEmail("  Fulano@Gmail.COM ") === "fulano@gmail.com");
  ok("recusa e-mail inválido", email.normalizarEmail("fulano@") === false && email.normalizarEmail("") === null);

  await db.delete(users).where(eq(users.phone, "41970290001"));
  await db.insert(users).values({ name: "Email Teste", phone: "41970290001", role: "CLIENT", email: "email.teste@exemplo.com" });
  const u = (await db.select().from(users).where(eq(users.phone, "41970290001")))[0];
  try {
    const l = await link.gerarLinkDeSenha(u.id);
    const m = email.emailDeNovaSenha(u.name, l!.url);
    const r = await email.enviarEmail({ para: u.email!, assunto: m.assunto, texto: m.texto, html: m.html });
    ok("envia o e-mail para a conta", r.ok && enviados.length === 1 && enviados[0].to === "email.teste@exemplo.com");
    ok("remetente é a barbearia", enviados[0].from?.includes("barbearia@teste.com") === true);
    ok("o link de nova senha vai no e-mail", !!enviados[0].html?.includes(l!.url) && !!enviados[0].text?.includes(l!.url));
    const token = l!.url.split("/nova-senha/")[1];
    const valido = await link.linkDeSenhaValido(token);
    ok("o link abre a troca de senha", valido?.userId === u.id);
    ok("e vale uma vez só", (await link.gastarLinkDeSenha(valido!.resetId)) && !(await link.gastarLinkDeSenha(valido!.resetId)));
    ok("link gasto não abre mais", (await link.linkDeSenhaValido(token)) === null);
    const l2 = await link.gerarLinkDeSenha(u.id);
    const l3 = await link.gerarLinkDeSenha(u.id);
    ok("pedir de novo invalida o link anterior", (await link.linkDeSenhaValido(l2!.url.split("/nova-senha/")[1])) === null && !!(await link.linkDeSenhaValido(l3!.url.split("/nova-senha/")[1])));
    ok("nome com HTML não quebra o e-mail", !email.emailDeNovaSenha("<b>x</b>", "https://a").html.includes("<b>x</b>"));
  } finally {
    await db.delete(passwordResets).where(eq(passwordResets.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
