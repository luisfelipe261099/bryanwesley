"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Crown,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Pencil,
  Phone,
  UserCheck,
} from "lucide-react";
import {
  Card,
  Feedback,
  notify,
  SelectInput,
  TextInput,
  type Msg,
} from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import { formatBRL, formatDuration } from "@/lib/money";
import type { DayOption } from "@/lib/schedule";
import type { Slot } from "@/lib/schedule";
import { fetchAvailability } from "@/app/agendar/actions";
import {
  bookForClient,
  cancelSubscription,
  createSubscriptionCharge,
  renewSubscription,
  resetUserPassword,
  subscribeClient,
  updateClient,
} from "../../actions";

type Cliente = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  hasAccount: boolean;
  phonePending: boolean;
};

type Assinatura = {
  status: string;
  planName: string;
  cycle: string;
  renewsAt: string;
} | null;

export function FichaCliente({
  cliente,
  assinatura,
  plans,
  services,
  team,
  days,
  resumo,
  fixo,
}: {
  cliente: Cliente;
  assinatura: Assinatura;
  plans: { id: number; name: string; priceCents: number }[];
  services: { id: number; name: string; priceCents: number; durationMin: number }[];
  team: { id: number; shortName: string }[];
  days: DayOption[];
  resumo: { concluidos: number; gasto: number; desde: string };
  fixo: { texto: string; barberName: string } | null;
}) {
  return (
    <div className="space-y-5">
      <Cabecalho cliente={cliente} resumo={resumo} fixo={fixo} />
      <Agendar cliente={cliente} services={services} team={team} days={days} />
      <Plano cliente={cliente} assinatura={assinatura} plans={plans} />
    </div>
  );
}

// ───────────────────────── Cadastro ─────────────────────────

function Cabecalho({
  cliente,
  resumo,
  fixo,
}: {
  cliente: Cliente;
  resumo: { concluidos: number; gasto: number; desde: string };
  fixo: { texto: string; barberName: string } | null;
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(cliente.name);
  const [fone, setFone] = useState(cliente.phonePending ? "" : cliente.phone);

  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [senha, setSenha] = useState("");

  function salvar() {
    setMsg(null);
    start(async () => {
      const res = await updateClient({
        userId: cliente.id,
        name: nome,
        phone: fone,
      });
      setMsg(notify(res, "Cadastro atualizado."));
      if (res.ok) setEditando(false);
    });
  }

  function redefinir() {
    setMsg(null);
    start(async () => {
      const res = await resetUserPassword({ userId: cliente.id, password: senha });
      setMsg(notify(res, "Senha redefinida."));
      if (res.ok) {
        setSenha("");
        setTrocandoSenha(false);
      }
    });
  }

  return (
    <div className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start gap-4">
        <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-royal-grad font-display text-2xl text-white">
          {cliente.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl text-white">{cliente.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span
              className={`inline-flex items-center gap-1.5 ${
                cliente.phonePending ? "text-amber-300" : "text-steel-300"
              }`}
            >
              <Phone className="h-3.5 w-3.5" />
              {cliente.phonePending
                ? "Sem telefone — completar"
                : formatPhone(cliente.phone)}
            </span>
            {cliente.email && (
              <span className="inline-flex items-center gap-1.5 text-steel-400">
                <Mail className="h-3.5 w-3.5" />
                {cliente.email}
              </span>
            )}
            {cliente.hasAccount && (
              <span className="inline-flex items-center gap-1.5 text-steel-400">
                <UserCheck className="h-3.5 w-3.5" />
                Tem conta no app
              </span>
            )}
          </div>
          {fixo && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-electric/10 px-3 py-1.5 text-xs text-electric">
              <CalendarClock className="h-3.5 w-3.5" />
              Horário fixo {fixo.texto} com {fixo.barberName}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className={`label inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 ${
              cliente.phonePending
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-white/12 text-steel-300 hover:border-electric/40 hover:text-white"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editando ? "Fechar" : cliente.phonePending ? "Completar" : "Editar"}
          </button>
          <button
            type="button"
            onClick={() => setTrocandoSenha((v) => !v)}
            title="Definir uma senha para o cliente entrar no app"
            className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-4 py-2.5 text-steel-300 hover:border-electric/40 hover:text-white"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Senha
          </button>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Numero rotulo="Atendimentos" valor={String(resumo.concluidos)} />
        <Numero rotulo="Total gasto" valor={formatBRL(resumo.gasto)} />
        <Numero rotulo="Cliente desde" valor={resumo.desde} />
      </dl>

      {editando && (
        <div className="mt-5 grid gap-3 border-t border-white/8 pt-5 sm:grid-cols-[1fr_1fr_auto]">
          <TextInput
            label="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <TextInput
            label="WhatsApp"
            inputMode="tel"
            placeholder="(41) 99999-0000"
            value={fone}
            onChange={(e) => setFone(e.target.value)}
          />
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={salvar}
              disabled={pending}
              className="btn-royal label rounded-xl px-4 py-3 text-white disabled:opacity-40"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditando(false);
                setNome(cliente.name);
                setFone(cliente.phonePending ? "" : cliente.phone);
                setMsg(null);
              }}
              className="label rounded-xl border border-white/12 px-4 py-3 text-steel-300 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {trocandoSenha && (
        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-white/8 pt-5">
          <input
            type="text"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Nova senha (mínimo 6)"
            aria-label="Nova senha"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
          <button
            type="button"
            onClick={redefinir}
            disabled={pending || senha.trim().length < 6}
            className="btn-royal label rounded-xl px-4 py-3 text-white disabled:opacity-40"
          >
            Definir senha
          </button>
        </div>
      )}

      <Feedback msg={msg} />
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-3">
      <dt className="label text-steel-400">{rotulo}</dt>
      <dd className="mt-1 font-display text-xl text-white">{valor}</dd>
    </div>
  );
}

// ───────────────────────── Agendar pelo balcão ─────────────────────────

function Agendar({
  cliente,
  services,
  team,
  days,
}: {
  cliente: Cliente;
  services: { id: number; name: string; priceCents: number; durationMin: number }[];
  team: { id: number; shortName: string }[];
  days: DayOption[];
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhidos, setEscolhidos] = useState<number[]>([]);
  const [barberId, setBarberId] = useState<number | null>(null);
  const [dateKey, setDateKey] = useState(days[0]?.dateKey ?? "");
  const [time, setTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [fechado, setFechado] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  const duracao = services
    .filter((s) => escolhidos.includes(s.id))
    .reduce((acc, s) => acc + s.durationMin, 0);
  const preco = services
    .filter((s) => escolhidos.includes(s.id))
    .reduce((acc, s) => acc + s.priceCents, 0);

  // A grade muda com o serviço, o dia e o barbeiro: recarrega a cada troca.
  useEffect(() => {
    if (!aberto || !dateKey || duracao === 0) {
      setSlots([]);
      return;
    }
    let cancelado = false;
    setCarregando(true);
    fetchAvailability({ dateKey, durationMin: duracao, barberId })
      .then((res) => {
        if (cancelado) return;
        setSlots(res.slots);
        setFechado(res.closed);
        setTime((atual) =>
          atual && res.slots.some((s) => s.time === atual && s.available)
            ? atual
            : null
        );
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [aberto, dateKey, duracao, barberId]);

  function marcar() {
    setMsg(null);
    start(async () => {
      const res = await bookForClient({
        userId: cliente.id,
        serviceIds: escolhidos,
        dateKey,
        time: time ?? "",
        barberId,
      });
      setMsg(notify(res, "Horário marcado."));
      if (res.ok) {
        setEscolhidos([]);
        setTime(null);
        setAberto(false);
      }
    });
  }

  const livres = slots.filter((s) => s.available);

  return (
    <Card
      title="Marcar horário para este cliente"
      desc={
        cliente.phonePending
          ? "Complete o WhatsApp antes: sem número não dá para confirmar nem lembrar."
          : "O nome e o WhatsApp saem do cadastro — o cliente recebe a confirmação como se tivesse agendado sozinho."
      }
      icon={<CalendarPlus className="h-5 w-5" />}
    >
      {!aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          disabled={cliente.phonePending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-40"
        >
          <CalendarPlus className="h-4 w-4" />
          Escolher serviço e horário
        </button>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="label mb-2 text-steel-400">Serviços</p>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => {
                const on = escolhidos.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setEscolhidos((atual) =>
                        on ? atual.filter((i) => i !== s.id) : [...atual, s.id]
                      )
                    }
                    className={`label inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2.5 transition-colors ${
                      on
                        ? "border-electric/45 bg-electric/12 text-electric"
                        : "border-white/10 text-steel-300 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {s.name} · {formatBRL(s.priceCents)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput
              label="Profissional"
              value={barberId === null ? "" : String(barberId)}
              onChange={(e) =>
                setBarberId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Quem estiver livre</option>
              {team.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.shortName}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Dia"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
            >
              {days.map((d) => (
                <option key={d.dateKey} value={d.dateKey}>
                  {d.weekday} · {d.dayLabel}
                </option>
              ))}
            </SelectInput>
          </div>

          <div>
            <p className="label mb-2 text-steel-400">
              Horário
              {duracao > 0 && (
                <span className="ml-2 normal-case tracking-normal text-steel-400/80">
                  {formatDuration(duracao)} · {formatBRL(preco)}
                </span>
              )}
            </p>
            {duracao === 0 ? (
              <p className="text-sm text-steel-400">Escolha ao menos um serviço.</p>
            ) : carregando ? (
              <p className="inline-flex items-center gap-2 text-sm text-steel-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Procurando horários livres…
              </p>
            ) : fechado ? (
              <p className="text-sm text-amber-200">A loja não abre nesse dia.</p>
            ) : livres.length === 0 ? (
              <p className="text-sm text-amber-200">
                Nenhum horário livre nesse dia para essa combinação.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {livres.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    aria-pressed={time === s.time}
                    onClick={() => setTime(s.time)}
                    className={`label rounded-xl border px-3.5 py-2.5 transition-colors ${
                      time === s.time
                        ? "border-electric/45 bg-electric/12 text-electric"
                        : "border-white/10 text-steel-300 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={marcar}
              disabled={pending || !time || escolhidos.length === 0}
              className="btn-royal label inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white disabled:opacity-40"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Marcar horário
            </button>
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                setMsg(null);
              }}
              className="label rounded-xl border border-white/12 px-4 py-3 text-steel-300 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <Feedback msg={msg} />
    </Card>
  );
}

// ───────────────────────── Plano ─────────────────────────

function Plano({
  cliente,
  assinatura,
  plans,
}: {
  cliente: Cliente;
  assinatura: Assinatura;
  plans: { id: number; name: string; priceCents: number }[];
}) {
  const [planId, setPlanId] = useState(String(plans[0]?.id ?? ""));
  const [cycle, setCycle] = useState<"MENSAL" | "ANUAL">("MENSAL");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [cobranca, setCobranca] = useState<string | null>(null);

  function ativar() {
    setMsg(null);
    start(async () => {
      const res = await subscribeClient({
        userId: cliente.id,
        planId: Number(planId),
        cycle,
      });
      setMsg(notify(res, "Assinatura ativada."));
    });
  }

  function renovar() {
    setMsg(null);
    start(async () => {
      setMsg(notify(await renewSubscription(cliente.id), "Renovação registrada."));
    });
  }

  function cancelar() {
    setMsg(null);
    start(async () => {
      setMsg(notify(await cancelSubscription(cliente.id), "Plano cancelado."));
    });
  }

  function cobrar() {
    setMsg(null);
    start(async () => {
      const res = await createSubscriptionCharge(cliente.id);
      if (res.ok) setCobranca(res.url);
      else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <Card
      title="Plano"
      desc={
        assinatura
          ? `${assinatura.planName} · ${
              assinatura.cycle === "ANUAL" ? "anual" : "mensal"
            } · ${
              assinatura.status === "ATIVA"
                ? `renova em ${assinatura.renewsAt}`
                : `venceu em ${assinatura.renewsAt}`
            }`
          : "Este cliente é avulso."
      }
      icon={<Crown className="h-5 w-5" />}
    >
      {assinatura ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={renovar}
            disabled={pending}
            title="Registrar o pagamento do ciclo e estender o plano"
            className="label inline-flex items-center gap-1.5 rounded-full border border-electric/40 bg-electric/10 px-4 py-2.5 text-electric disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Registrar renovação
          </button>
          {cobranca ? (
            <a
              href={cobranca}
              target="_blank"
              rel="noreferrer"
              className="label inline-flex items-center gap-1.5 rounded-full border border-neon/40 bg-neon/10 px-4 py-2.5 text-neon"
            >
              <Link2 className="h-3.5 w-3.5" />
              Abrir cobrança
            </a>
          ) : (
            <button
              type="button"
              onClick={cobrar}
              disabled={pending}
              title="Gerar link de pagamento do próximo ciclo"
              className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-4 py-2.5 text-steel-300 hover:border-electric/45 hover:text-white disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" />
              Gerar cobrança
            </button>
          )}
          {assinatura.status === "ATIVA" && (
            <button
              type="button"
              onClick={cancelar}
              disabled={pending}
              className="label rounded-full border border-white/12 px-4 py-2.5 text-steel-300 hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
            >
              Cancelar plano
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectInput
            label="Plano"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatBRL(p.priceCents)}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Ciclo"
            value={cycle}
            onChange={(e) => setCycle(e.target.value as "MENSAL" | "ANUAL")}
          >
            <option value="MENSAL">Mensal</option>
            <option value="ANUAL">Anual</option>
          </SelectInput>
          <div className="flex items-end">
            <button
              type="button"
              onClick={ativar}
              disabled={pending || plans.length === 0}
              className="btn-royal label inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-white disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ativar assinatura
            </button>
          </div>
        </div>
      )}
      <Feedback msg={msg} />
    </Card>
  );
}
