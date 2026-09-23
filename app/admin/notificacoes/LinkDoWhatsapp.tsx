"use client";

// A ponte do WhatsApp, dos dois lados.
//
// De cá, o link que a barbearia manda para quem chamar: abre a agenda já
// preenchida. De lá, o atendente — com o número aprovado na Meta, o
// cliente escolhe serviço, dia e horário sem sair da conversa e o
// agendamento entra na agenda com código, lembrete e tudo.

import { useState } from "react";
import { Check, Copy, MessageCircle, Smartphone } from "lucide-react";
import { Card } from "@/components/admin/Feedback";
import { linkDeAgendamento, linkWaMe, conviteDeAgendamento } from "@/lib/whatsapp-link";

export function LinkDoWhatsapp({
  base,
  shopName,
  servicos,
  autoAtendente,
}: {
  /** Endereço público do site. */
  base: string;
  shopName: string;
  servicos: { slug: string; name: string }[];
  /** Se o atendente do WhatsApp (webhook da Meta) já está configurado. */
  autoAtendente: { ligado: boolean; falta: string[] };
}) {
  const [servico, setServico] = useState("");
  const [nome, setNome] = useState("");
  const [fone, setFone] = useState("");
  const [copiado, setCopiado] = useState<"link" | "mensagem" | null>(null);

  const link = linkDeAgendamento(base, { nome, fone, servico });
  const mensagem = conviteDeAgendamento({ link, nome, shopName });

  async function copiar(oque: "link" | "mensagem") {
    const texto = oque === "link" ? link : mensagem;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(oque);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setCopiado(null);
    }
  }

  return (
    <Card
      title="Agendamento pelo WhatsApp"
      desc="Mande o link para quem chamar no WhatsApp: ele abre a agenda já preenchida e o horário cai aqui dentro."
      icon={<MessageCircle className="h-5 w-5" />}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label mb-1.5 block text-steel-400">Nome (opcional)</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Como chamar a pessoa"
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
        </label>
        <label className="block">
          <span className="label mb-1.5 block text-steel-400">WhatsApp (opcional)</span>
          <input
            value={fone}
            onChange={(e) => setFone(e.target.value)}
            placeholder="(41) 9 9999-0000"
            inputMode="tel"
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
        </label>
        <label className="block">
          <span className="label mb-1.5 block text-steel-400">Serviço (opcional)</span>
          <select
            value={servico}
            onChange={(e) => setServico(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none [color-scheme:dark] focus:border-electric/60"
          >
            <option value="">Deixar o cliente escolher</option>
            {servicos.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-4 break-all rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3 font-mono text-xs text-steel-300">
        {link}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copiar("link")}
          className="btn-outline label inline-flex items-center gap-2 rounded-full px-4 py-3 text-electric"
        >
          {copiado === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiado === "link" ? "Copiado" : "Copiar link"}
        </button>
        <button
          type="button"
          onClick={() => copiar("mensagem")}
          className="label inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-3 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
        >
          {copiado === "mensagem" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiado === "mensagem" ? "Copiado" : "Copiar mensagem pronta"}
        </button>
        {fone.replace(/\D/g, "").length >= 10 && (
          <a
            href={linkWaMe(fone, mensagem)}
            target="_blank"
            rel="noreferrer"
            className="btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-3 text-white"
          >
            <Smartphone className="h-4 w-4" />
            Abrir no WhatsApp
          </a>
        )}
      </div>

      {/* Passo 2: o atendente que marca dentro da conversa */}
      <div
        className={`mt-5 rounded-2xl border p-4 text-sm ${
          autoAtendente.ligado
            ? "border-neon/25 bg-neon/[0.06] text-neon"
            : "border-white/10 bg-white/[0.02] text-steel-300"
        }`}
      >
        <p className="font-semibold">
          {autoAtendente.ligado
            ? "Agendamento pelo WhatsApp ligado"
            : "Agendamento pelo WhatsApp (falta configurar)"}
        </p>
        <p className="mt-1.5 leading-relaxed text-steel-300">
          {autoAtendente.ligado
            ? "Quem manda mensagem escolhe o serviço, o dia e o horário dentro do próprio WhatsApp — e o agendamento cai aqui na agenda, com código e lembretes. Funciona sozinho, a qualquer hora."
            : "Com o número aprovado na Meta, o cliente marca sem sair do WhatsApp: o sistema responde com a lista de serviços, os dias abertos e os horários realmente livres, e o horário escolhido entra na agenda."}
        </p>
        {!autoAtendente.ligado && autoAtendente.falta.length > 0 && (
          <p className="mt-2 text-xs text-steel-400">
            Falta configurar: {autoAtendente.falta.join(", ")}. O endereço do
            webhook é <code className="rounded bg-black/30 px-1">{base}/api/whatsapp/webhook</code>.
          </p>
        )}
        {autoAtendente.ligado && (
          <p className="mt-2 text-xs text-steel-400">
            Webhook: <code className="rounded bg-black/30 px-1">{base}/api/whatsapp/webhook</code>
          </p>
        )}
      </div>
    </Card>
  );
}
