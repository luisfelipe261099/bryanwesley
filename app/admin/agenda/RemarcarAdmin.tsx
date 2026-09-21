"use client";

// Remarcar pelo balcão.
//
// A ação `adminReschedule` existia desde a primeira versão do painel, mas
// não havia botão nenhum para chamá-la: mudar um horário só dava pelo app
// do cliente. Aqui a barbearia resolve pelo telefone, com o cliente na
// linha.

import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { toast } from "@/lib/toast";
import { fetchAvailability } from "@/app/agendar/actions";
import { adminReschedule } from "../actions";
import type { Slot } from "@/lib/schedule";

export function RemarcarAdmin({
  appointmentId,
  dateKey,
  durationMin,
  barberId,
  equipe,
  resumo,
}: {
  appointmentId: number;
  /** O dia em que o horário está hoje — é por onde a busca começa. */
  dateKey: string;
  durationMin: number;
  barberId: number;
  equipe: { id: number; shortName: string }[];
  /** "Fulano · 14:30", só para o cabeçalho do diálogo. */
  resumo: string;
}) {
  const [open, setOpen] = useState(false);
  // Começa no dia do próprio agendamento: na maioria das vezes a troca é
  // de horário, não de data, e abrir em "hoje" mostrava um dia fechado.
  const [dia, setDia] = useState(dateKey);
  const [quem, setQuem] = useState(barberId);
  const [hora, setHora] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCarregando(true);
    setAviso(null);
    fetchAvailability({ dateKey: dia, durationMin, barberId: quem })
      .then((r) => {
        if (cancelado) return;
        setSlots(r.slots);
        setHora(null);
        setAviso(
          r.closed
            ? r.motivo === "folga"
              ? "Esse profissional não atende nesse dia."
              : r.motivo === "sem-equipe"
                ? "Nenhum profissional disponível nesse dia."
                : "A barbearia não abre nesse dia."
            : null
        );
      })
      .catch(() => {
        if (cancelado) return;
        setSlots([]);
        setAviso("Não foi possível carregar os horários. Tente de novo.");
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [open, dia, quem, durationMin]);

  function salvar() {
    if (!hora) return;
    setErro(null);
    start(async () => {
      const r = await adminReschedule({
        appointmentId,
        dateKey: dia,
        time: hora,
        barberId: quem,
      });
      if (r.ok) {
        setOpen(false);
        toast(r.message ?? "Horário remarcado.", "ok");
      } else setErro(r.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Remarcar"
        aria-label={`Remarcar ${resumo}`}
        className="grid h-10 w-10 place-items-center rounded-full border border-white/12 text-steel-400 transition-colors hover:border-electric/45 hover:text-white sm:h-9 sm:w-9"
      >
        <CalendarClock className="h-3.5 w-3.5" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} label={`Remarcar — ${resumo}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-2 block text-steel-400">Novo dia</span>
            <input
              type="date"
              value={dia}
              onChange={(e) => e.target.value && setDia(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none [color-scheme:dark] focus:border-electric/60"
            />
          </label>
          <label className="block">
            <span className="label mb-2 block text-steel-400">Barbeiro</span>
            <select
              value={quem}
              onChange={(e) => setQuem(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none [color-scheme:dark] focus:border-electric/60"
            >
              {equipe.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.shortName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          {carregando ? (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-steel-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando a agenda…
            </p>
          ) : aviso ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-steel-400">
              {aviso}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setHora(s.time)}
                    className={`rounded-xl border py-2.5 text-center text-sm font-semibold tabular-nums transition-all ${
                      !s.available
                        ? "cursor-not-allowed border-white/5 bg-white/[0.01] text-steel-400/40 line-through"
                        : hora === s.time
                          ? "btn-royal border-transparent text-white"
                          : "border-white/8 bg-surface/70 text-white hover:border-electric/45"
                    }`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
              {slots.length > 0 && slots.every((s) => !s.available) && (
                <p className="py-4 text-center text-sm text-steel-400">
                  {dia < hojeNaLoja()
                    ? "Esse dia já passou. Escolha uma data à frente."
                    : "Nenhum horário livre nesse dia."}
                </p>
              )}
            </>
          )}
        </div>

        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200"
          >
            {erro}
          </p>
        )}

        <button
          type="button"
          onClick={salvar}
          disabled={!hora || salvando}
          className="btn-royal label mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:opacity-40"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar remarcação
        </button>
      </Modal>
    </>
  );
}

/** A data de hoje no fuso da loja, no formato do <input type="date">. */
function hojeNaLoja() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
