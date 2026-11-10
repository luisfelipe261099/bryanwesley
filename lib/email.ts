// ───────────────────────────────────────────────────────────
// E-mail pelo Gmail da barbearia (grátis, até ~500 por dia).
//
// Configuração (variáveis de ambiente):
//   GMAIL_USER          o endereço, ex.: barbeariabryanwesley@gmail.com
//   GMAIL_APP_PASSWORD  a "senha de app" de 16 letras do Google (NUNCA a
//                       senha da conta: o Google não aceita a senha comum
//                       para programas, e a de app dá para revogar)
//
// Sem as duas, o módulo fica inerte e a tela não oferece "por e-mail".
// ───────────────────────────────────────────────────────────
import nodemailer from "nodemailer";

export function emailConfigurado() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

let transporte: nodemailer.Transporter | null = null;
function smtp() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s/g, ""),
      },
    });
  }
  return transporte;
}

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function enviarEmail(input: { para: string; assunto: string; texto: string; html?: string }) {
  if (!emailConfigurado()) return { ok: false as const, error: "E-mail não configurado." };
  try {
    await smtp().sendMail({
      from: `"Bryan Wesley Barbearia" <${process.env.GMAIL_USER}>`,
      to: input.para,
      subject: input.assunto,
      text: input.texto,
      html: input.html,
    });
    return { ok: true as const };
  } catch (e) {
    console.error("E-mail não saiu:", e);
    return { ok: false as const, error: "Não deu para enviar o e-mail agora." };
  }
}

/** E-mail do link de nova senha. */
export function emailDeNovaSenha(nome: string, url: string) {
  const primeiro = nome.split(" ")[0];
  const texto = `Oi ${primeiro}!\n\nPara criar sua nova senha na Bryan Wesley Barbearia, abra este link (vale por 24 horas e uma vez só):\n\n${url}\n\nSe não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1b2130">
  <h2 style="margin:0 0 12px">Oi ${escapar(primeiro)}!</h2>
  <p>Para criar sua nova senha na <b>Bryan Wesley Barbearia</b>, toque no botão abaixo. O link vale por 24 horas e uma vez só.</p>
  <p style="margin:24px 0"><a href="${escapar(url)}" style="background:#2979ff;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Criar nova senha</a></p>
  <p style="font-size:13px;color:#5b6578">Se o botão não abrir, copie este endereço no navegador:<br>${escapar(url)}</p>
  <p style="font-size:13px;color:#5b6578">Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>
</div>`;
  return { assunto: "Sua nova senha — Bryan Wesley Barbearia", texto, html };
}

/** E-mail digitado: minúsculo, sem espaços; null se vazio; false se inválido. */
export function normalizarEmail(v: string | null | undefined): string | null | false {
  const e = (v ?? "").trim().toLowerCase();
  if (!e) return null;
  return /^[^\s@]{1,64}@[^\s@]{1,180}\.[a-z]{2,}$/.test(e) && e.length <= 190 ? e : false;
}
