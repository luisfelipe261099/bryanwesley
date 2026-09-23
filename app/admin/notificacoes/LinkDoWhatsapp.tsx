"use client";

// O link que a barbearia manda no WhatsApp.
//
// Para convidar alguém: o link abre a agenda já com o nome, o WhatsApp e
// o serviço preenchidos, e o horário escolhido cai na agenda. Funciona
// com ou sem o atendente conectado.

import { useState } from "react";
import { Check, Copy, MessageCircle, Smartphone } from "lucide-react";
import { Card } from "@/components/admin/Feedback";
import { linkDeAgendamento, linkWaMe, conviteDeAgendamento } from "@/lib/whatsapp-link";

export function LinkDoWhatsapp({
  base,
  shopName,
  servicos,
}: {
  /** Endereço público do site. */
  base: string;
  shopName: string;
  servicos: { slug: string; name: string }[];
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
      title="Link de agendamento"
      desc="Para convidar alguém: o link abre a agenda já preenchida e o horário escolhido cai aqui dentro."
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
    </Card>
  );
}
