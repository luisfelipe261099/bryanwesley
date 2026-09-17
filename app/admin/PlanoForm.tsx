"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import {
  notify,
  Feedback,
  TextInput,
  Toggle,
  type Msg,
} from "@/components/admin/Feedback";
import { formatBRL } from "@/lib/money";
import { savePlan } from "./actions";

export type PlanoServico = { id: number; name: string };

export type PlanoEditavel = {
  id: number;
  name: string;
  kicker: string;
  tagline: string;
  priceCents: number;
  annualPriceCents: number;
  features: string[];
  highlight: boolean;
  badge: string | null;
  active: boolean;
  serviceIds: number[];
};

/** Plano em branco, para cadastrar um novo. */
const EM_BRANCO: PlanoEditavel = {
  id: 0,
  name: "",
  kicker: "",
  tagline: "",
  priceCents: 0,
  annualPriceCents: 0,
  features: [],
  highlight: false,
  badge: null,
  active: true,
  serviceIds: [],
};

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const cents = (v: string) =>
  Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) || 0;

/**
 * Formulário de um plano.
 *
 * Mora fora das telas porque o catálogo e a gestão do Clube editam a mesma
 * coisa — duas cópias sairiam do lugar na primeira mudança de preço.
 */
export function PlanoForm({
  plan,
  services,
  onSalvo,
}: {
  plan: PlanoEditavel;
  services: PlanoServico[];
  /** Avisa a tela quando um plano novo entra, para ela recarregar. */
  onSalvo?: () => void;
}) {
  const novo = plan.id === 0;
  const [f, setF] = useState({
    ...plan,
    price: reais(plan.priceCents),
    annual: reais(plan.annualPriceCents),
    featuresText: plan.features.join("\n"),
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await savePlan({
        id: novo ? undefined : plan.id,
        name: f.name,
        kicker: f.kicker,
        tagline: f.tagline,
        priceCents: cents(f.price),
        annualPriceCents: cents(f.annual),
        features: f.featuresText.split("\n").map((x) => x.trim()).filter(Boolean),
        highlight: f.highlight,
        badge: f.badge || null,
        active: f.active,
        serviceIds: f.serviceIds,
      });
      setMsg(notify(res, novo ? "Plano criado." : "Salvo."));
      if (res.ok) onSalvo?.();
    });
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput
          label="Nome"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <TextInput
          label="Mensal (R$)"
          inputMode="decimal"
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <TextInput
          label="Anual — por mês (R$)"
          inputMode="decimal"
          value={f.annual}
          onChange={(e) => setF({ ...f, annual: e.target.value })}
        />
        <TextInput
          label="Rótulo superior"
          value={f.kicker}
          onChange={(e) => setF({ ...f, kicker: e.target.value })}
        />
        <TextInput
          label="Selo"
          value={f.badge ?? ""}
          onChange={(e) => setF({ ...f, badge: e.target.value })}
        />
        <TextInput
          label="Chamada"
          value={f.tagline}
          onChange={(e) => setF({ ...f, tagline: e.target.value })}
        />
      </div>

      <label className="mt-3 block">
        <span className="label mb-2 block text-steel-400">
          Benefícios (um por linha)
        </span>
        <textarea
          rows={4}
          value={f.featuresText}
          onChange={(e) => setF({ ...f, featuresText: e.target.value })}
          className="w-full resize-none rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white outline-none focus:border-electric/60"
        />
      </label>

      <div className="mt-3">
        <span className="label mb-2 block text-steel-400">
          Serviços inclusos no plano
        </span>
        <div className="flex flex-wrap gap-2">
          {services.map((s) => {
            const on = f.serviceIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setF({
                    ...f,
                    serviceIds: on
                      ? f.serviceIds.filter((x) => x !== s.id)
                      : [...f.serviceIds, s.id],
                  })
                }
                className={`label rounded-full px-3.5 py-2.5 transition-colors ${
                  on
                    ? "border border-electric/50 bg-electric/10 text-electric"
                    : "border border-white/12 text-steel-400 hover:border-white/30"
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Toggle
          checked={f.highlight}
          onChange={(v) => setF({ ...f, highlight: v })}
          label="Destaque da vitrine"
          hint="Só um plano pode ser o destaque"
        />
        <Toggle
          checked={f.active}
          onChange={(v) => setF({ ...f, active: v })}
          label="Disponível para assinar"
        />
      </div>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="btn-royal label mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : novo ? (
          <Plus className="h-4 w-4" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {novo ? "Criar plano" : "Salvar plano"} · {formatBRL(cents(f.price))}/mês
      </button>
      <Feedback msg={msg} />
    </div>
  );
}


/** Cadastro de um plano novo, escondido atrás de um botão. */
export function NovoPlano({ services }: { services: PlanoServico[] }) {
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="label inline-flex items-center gap-2 rounded-full border border-electric/40 bg-electric/10 px-5 py-3 text-electric"
      >
        <Plus className="h-4 w-4" />
        Criar plano
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <PlanoForm plan={EM_BRANCO} services={services} onSalvo={() => setAberto(false)} />
      <button
        type="button"
        onClick={() => setAberto(false)}
        className="label rounded-full border border-white/12 px-4 py-2.5 text-steel-300 hover:text-white"
      >
        Cancelar
      </button>
    </div>
  );
}
