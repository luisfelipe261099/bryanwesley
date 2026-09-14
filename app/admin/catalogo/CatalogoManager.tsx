"use client";

import { useState, useTransition } from "react";
import { Gem, Loader2, Plus, Save, Scissors } from "lucide-react";
import {
  Card,
  notify,
  Feedback,
  TextInput,
  Toggle,
  type Msg,
} from "@/components/admin/Feedback";
import { toast } from "@/lib/toast";
import { formatBRL } from "@/lib/money";
import { saveService, savePlan, toggleService } from "../actions";

type ServiceRow = {
  id: number;
  name: string;
  description: string;
  priceCents: number;
  durationMin: number;
  tag: string | null;
  active: boolean;
};

type PlanRow = {
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

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const cents = (v: string) =>
  Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

export function CatalogoManager({
  services,
  plans,
}: {
  services: ServiceRow[];
  plans: PlanRow[];
}) {
  return (
    <div className="space-y-5">
      <Card
        title="Serviços"
        desc="Preço e duração aparecem no agendamento na hora que você salvar."
        icon={<Scissors className="h-5 w-5" />}
      >
        <div className="space-y-3">
          {services.map((s) => (
            <ServiceRowForm key={s.id} service={s} />
          ))}
        </div>
        <NewService />
      </Card>

      <Card
        title="Planos de assinatura"
        desc="Os serviços marcados saem sem cobrança para o membro."
        icon={<Gem className="h-5 w-5" />}
      >
        <div className="space-y-5">
          {plans.map((p) => (
            <PlanForm key={p.id} plan={p} services={services} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ServiceRowForm({ service }: { service: ServiceRow }) {
  const [f, setF] = useState({
    ...service,
    price: reais(service.priceCents),
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveService({
        id: service.id,
        name: f.name,
        description: f.description,
        priceCents: cents(f.price),
        durationMin: f.durationMin,
        tag: f.tag || null,
        active: f.active,
      });
      setMsg(notify(res, "Salvo."));
    });
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextInput
          label="Nome"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <TextInput
          label="Preço (R$)"
          inputMode="decimal"
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <TextInput
          label="Duração (min)"
          type="number"
          min={5}
          step={5}
          value={f.durationMin}
          onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })}
        />
        <TextInput
          label="Selo"
          value={f.tag ?? ""}
          placeholder="Ex.: Mais pedido"
          onChange={(e) => setF({ ...f, tag: e.target.value })}
        />
        <TextInput
          label="Descrição"
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Salvar
        </button>
        <ToggleActive id={service.id} active={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

function ToggleActive({
  id,
  active,
  onChange,
}: {
  id: number;
  active: boolean;
  onChange: (v: boolean) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const next = !active;
        // Vira só quando o servidor confirma: otimista sem rollback deixava
        // a tela mostrando o oposto do banco quando a ação falhava.
        start(async () => {
          const r = await toggleService(id, next);
          if (r.ok) {
            onChange(next);
            toast(r.message ?? (next ? "Serviço ativado." : "Serviço desativado."));
          } else {
            toast(r.error ?? "Não foi possível alterar.", "erro");
          }
        });
      }}
      className={`label rounded-full px-4 py-2.5 transition-colors disabled:opacity-50 ${
        active
          ? "border border-neon/30 bg-neon/10 text-neon"
          : "border border-white/12 text-steel-400"
      }`}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : active ? (
        "Ativo"
      ) : (
        "Inativo"
      )}
    </button>
  );
}

function NewService() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: "",
    price: "0,00",
    durationMin: 30,
    description: "",
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline label mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-electric"
      >
        <Plus className="h-4 w-4" />
        Novo serviço
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-electric/30 bg-electric/[0.04] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <TextInput
          label="Nome"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <TextInput
          label="Preço (R$)"
          inputMode="decimal"
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <TextInput
          label="Duração (min)"
          type="number"
          min={5}
          step={5}
          value={f.durationMin}
          onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })}
        />
        <TextInput
          label="Descrição"
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </div>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={pending || f.name.length < 2}
          onClick={() => {
            setMsg(null);
            start(async () => {
              const res = await saveService({
                name: f.name,
                description: f.description,
                priceCents: cents(f.price),
                durationMin: f.durationMin,
                tag: null,
                active: true,
              });
              setMsg(notify(res, "Criado."));
              if (res.ok) {
                setF({ name: "", price: "0,00", durationMin: 30, description: "" });
                setOpen(false);
              }
            });
          }}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Criar
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="label rounded-full border border-white/12 px-5 py-3 text-steel-300"
        >
          Cancelar
        </button>
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

function PlanForm({
  plan,
  services,
}: {
  plan: PlanRow;
  services: ServiceRow[];
}) {
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
        id: plan.id,
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
      setMsg(notify(res, "Salvo."));
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
        ) : (
          <Save className="h-4 w-4" />
        )}
        Salvar plano · {formatBRL(cents(f.price))}/mês
      </button>
      <Feedback msg={msg} />
    </div>
  );
}
