"use client";

import { useState, useTransition } from "react";
import { Clock, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { notify, Feedback, TextInput, type Msg } from "@/components/admin/Feedback";
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import { minutesToHHMM } from "@/lib/time";
import { DIAS_CURTOS, rotuloDias, rotuloFaixa, type RegraPreco } from "@/lib/precos";
import { removeServicePriceRule, saveServicePriceRule } from "../actions";

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * Preços por turno de um serviço: "Noite, Seg a Sex, 18:00 às 21:00 — R$ 60".
 * Fora de qualquer turno vale o preço normal do serviço.
 */
export function PrecosPorTurno({
  serviceId,
  precoNormal,
  regras,
}: {
  serviceId: number;
  precoNormal: number;
  regras: RegraPreco[];
}) {
  const [novo, setNovo] = useState(false);
  return (
    <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 text-sm text-white">
        <Clock className="h-4 w-4 text-electric" />
        <span className="font-semibold">Preço por turno</span>
      </div>
      <p className="mt-1 text-xs text-steel-400">
        Outro valor em certos dias e horários, como à noite ou no sábado. Fora deles vale o
        preço normal ({formatBRL(precoNormal)}).
      </p>
      <div className="mt-3 space-y-3">
        {regras.map((r) => (
          <TurnoForm key={r.id} serviceId={serviceId} regra={r} />
        ))}
        {novo && <TurnoForm serviceId={serviceId} onPronto={() => setNovo(false)} precoNormal={precoNormal} />}
      </div>
      {!novo && (
        <button
          type="button"
          onClick={() => setNovo(true)}
          className="label mt-3 inline-flex items-center gap-2 rounded-full border border-electric/40 bg-electric/10 px-4 py-2.5 text-electric"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar turno
        </button>
      )}
    </div>
  );
}

function TurnoForm({
  serviceId,
  regra,
  precoNormal = 0,
  onPronto,
}: {
  serviceId: number;
  regra?: RegraPreco;
  precoNormal?: number;
  onPronto?: () => void;
}) {
  const [f, setF] = useState({
    label: regra?.label ?? "Noite",
    weekdays: regra?.weekdays ?? [1, 2, 3, 4, 5],
    start: minutesToHHMM(regra?.startMin ?? 18 * 60),
    end: minutesToHHMM(regra?.endMin ?? 21 * 60),
    price: reais(regra?.priceCents ?? precoNormal),
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const alternaDia = (d: number) =>
    setF({
      ...f,
      weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d],
    });

  function salvar() {
    setMsg(null);
    start(async () => {
      const res = await saveServicePriceRule({
        id: regra?.id,
        serviceId,
        label: f.label,
        weekdays: f.weekdays,
        start: f.start,
        end: f.end,
        priceCents: parseMoneyToCents(f.price),
      });
      setMsg(notify(res, "Preço por turno salvo."));
      if (res.ok) onPronto?.();
    });
  }

  function remover() {
    if (!regra) return onPronto?.();
    if (!window.confirm(`Remover o turno "${regra.label || rotuloDias(regra.weekdays)}"? O serviço volta ao preço normal nesse horário.`)) return;
    start(async () => {
      const res = await removeServicePriceRule(regra.id);
      setMsg(notify(res, "Preço por turno removido."));
    });
  }

  return (
    <div className="rounded-xl border border-white/8 bg-surface-2/40 p-3">
      {regra && (
        <p className="mb-2 text-xs text-steel-300">
          {regra.label ? `${regra.label} · ` : ""}
          {rotuloDias(regra.weekdays)}, {rotuloFaixa(regra)} · {formatBRL(regra.priceCents)}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <TextInput
          label="Nome do turno"
          value={f.label}
          placeholder="Ex.: Noite"
          onChange={(e) => setF({ ...f, label: e.target.value })}
        />
        <TextInput label="Das" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        <TextInput label="Até" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        <TextInput
          label="Preço (R$)"
          inputMode="decimal"
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
      </div>
      <div className="mt-3">
        <span className="label mb-2 block text-steel-400">Dias</span>
        <div className="flex flex-wrap gap-2">
          {DIAS_CURTOS.map((nome, d) => {
            const on = f.weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => alternaDia(d)}
                className={`label rounded-full px-3 py-2 transition-colors ${
                  on
                    ? "border border-electric/50 bg-electric/10 text-electric"
                    : "border border-white/12 text-steel-400"
                }`}
              >
                {nome}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-steel-400">
        Vale para horários que começam a partir de “Das” e antes de “Até”.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar turno
        </button>
        <button
          type="button"
          onClick={remover}
          disabled={pending}
          className="label inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2.5 text-steel-300 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {regra ? "Remover" : "Cancelar"}
        </button>
      </div>
      <Feedback msg={msg} />
    </div>
  );
}
