// ───────────────────────────────────────────────────────────
// Ponte entre a conversa no WhatsApp e a agenda.
//
// O cliente manda mensagem, recebe um link e cai no /agendar com o nome,
// o telefone e o serviço já preenchidos: escolhe o horário e pronto — o
// agendamento entra no sistema como qualquer outro, com código, lembrete
// e tudo mais. Sem bot, sem aprovação da Meta, funciona hoje.
// ───────────────────────────────────────────────────────────
import { normalizePhone } from "./phone";

export type PreAgendamento = {
  nome?: string | null;
  /** Só dígitos ou formatado — a função normaliza. */
  fone?: string | null;
  /** Slug do serviço no catálogo ("corte", "combo"…). */
  servico?: string | null;
  /** "2026-09-26" */
  dia?: string | null;
};

/**
 * O link que a barbearia manda no WhatsApp.
 *
 * Só leva o que a própria barbearia já sabe (o nome que ela digitou, o
 * número de quem está conversando). Nada é consultado a partir da URL:
 * um link com telefone de terceiro não revela o nome de ninguém.
 */
export function linkDeAgendamento(base: string, pre: PreAgendamento = {}) {
  const p = new URLSearchParams();
  const nome = (pre.nome ?? "").trim();
  const fone = normalizePhone(pre.fone ?? "");
  const servico = (pre.servico ?? "").trim();
  const dia = (pre.dia ?? "").trim();
  if (nome) p.set("nome", nome);
  if (fone.length >= 10) p.set("fone", fone);
  if (servico) p.set("servico", servico);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) p.set("dia", dia);
  const qs = p.toString();
  return `${base.replace(/\/$/, "")}/agendar${qs ? `?${qs}` : ""}`;
}

/** Abre a conversa no WhatsApp com a mensagem pronta. */
export function linkWaMe(phoneDigits: string, texto: string) {
  const d = normalizePhone(phoneDigits);
  const numero = d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** O convite padrão que vai junto do link. */
export function conviteDeAgendamento(opts: {
  link: string;
  nome?: string | null;
  shopName: string;
}) {
  const primeiro = (opts.nome ?? "").trim().split(" ")[0];
  const ola = primeiro ? `Oi, ${primeiro}!` : "Oi!";
  return `${ola} Aqui é da ${opts.shopName}. Para marcar seu horário em 30 segundos, é só abrir: ${opts.link}`;
}
