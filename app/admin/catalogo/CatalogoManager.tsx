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
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import { saveService, toggleService } from "../actions";
import { PlanoForm } from "../PlanoForm";

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
const cents = (v: string) => parseMoneyToCents(v);

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
            <PlanoForm key={p.id} plan={p} services={services} />
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
