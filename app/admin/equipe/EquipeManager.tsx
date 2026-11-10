"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Coffee, KeyRound, Loader2, Plus, Save, Target, UserPlus, X } from "lucide-react";
import {
  Card,
  notify,
  Feedback,
  SelectInput,
  TextInput,
  Toggle,
  type Msg,
} from "@/components/admin/Feedback";
import { toast } from "@/lib/toast";
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import {
  resetUserPassword,
  createBarber,
  updateBarber,
  upsertCommissionTier,
  removeCommissionTier,
  setBarberHours,
  setBarberLunch,
} from "../actions";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type BarberRow = {
  id: number;
  /** Conta de login do barbeiro (users.id). */
  userId: number;
  name: string;
  phone: string;
  email: string;
  isAdmin: boolean;
  shortName: string;
  title: string;
  commissionPct: number;
  monthlyGoalCents: number;
  active: boolean;
  baseCents: number;
  barberCents: number;
  atendimentos: number;
  hours: { weekday: number; openMinute: number; closeMinute: number }[];
  /** Almoço (minutos do dia), bloqueado na agenda. */
  lunchStart: number | null;
  lunchEnd: number | null;
};

function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMin(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

export function EquipeManager({
  euUserId,
  team,
  tiers,
  comissaoPadrao,
}: {
  /** A conta de quem está no painel: o próprio cartão não se desativa. */
  euUserId: number;
  team: BarberRow[];
  /** "Comissão padrão" de Ajustes: o valor inicial de quem é cadastrado. */
  comissaoPadrao: number;
  tiers: {
    id: number;
    barberId: number | null;
    minRevenueCents: number;
    barberPct: number;
    label: string | null;
  }[];
}) {
  return (
    <div className="space-y-3">
      {team.map((b) => (
        <BarberCard key={b.id} barber={b} meu={b.userId === euUserId} />
      ))}
      <NewBarber comissaoPadrao={comissaoPadrao} />
      <div className="pt-4">
        <Tiers tiers={tiers} team={team} />
      </div>
    </div>
  );
}

function BarberCard({ barber, meu }: { barber: BarberRow; meu: boolean }) {
  const [form, setForm] = useState(barber);
  const [goal, setGoal] = useState(
    (barber.monthlyGoalCents / 100).toFixed(2).replace(".", ",")
  );
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  // Fechado por padrão: a página mostra a equipe numa lista curta, e só a
  // pessoa tocada abre os detalhes.
  // Lembrado na aba: salvar recarrega os dados da página e o cartão era
  // recriado fechado, bem na hora em que a pessoa conferia o que salvou.
  const chave = `equipe-aberto-${barber.id}`;
  const [aberto, setAbertoBruto] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(chave) === "1") setAbertoBruto(true);
    } catch {
      /* sem armazenamento */
    }
  }, [chave]);
  const setAberto = (f: (v: boolean) => boolean) =>
    setAbertoBruto((v) => {
      const n = f(v);
      try {
        if (n) sessionStorage.setItem(chave, "1");
        else sessionStorage.removeItem(chave);
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return n;
    });
  const folgas = barber.hours.filter((h) => h.closeMinute <= h.openMinute).map((h) => WEEKDAYS[h.weekday]);

  function save() {
    setMsg(null);
    // Desativar não é folga: encerra o acesso, cancela os horários futuros
    // e desliga os fixos — e nada disso volta ao religar.
    if (barber.active && !form.active) {
      const ok = window.confirm(
        `Desativar ${barber.shortName}?\n\nIsso encerra o acesso dele ao sistema, cancela todos os horários futuros na agenda dele e desliga os horários fixos dos membros. Não dá para desfazer religando.\n\nPara uma folga, use "Folga" na jornada ou um bloqueio em Ajustes.`
      );
      if (!ok) return;
    }
    start(async () => {
      const dados = {
        id: barber.id,
        shortName: form.shortName,
        title: form.title,
        commissionPct: form.commissionPct,
        monthlyGoalCents: parseMoneyToCents(goal),
        active: form.active,
        name: form.name,
        email: form.email,
        phone: form.phone,
        isAdmin: form.isAdmin,
      };
      let res = await updateBarber(dados);
      // WhatsApp ou e-mail de uma conta de cliente: pergunta se é a mesma
      // pessoa e, confirmando, junta as duas.
      if (!res.ok && res.error.startsWith("Essa pessoa já tem conta de cliente")) {
        if (window.confirm(res.error)) res = await updateBarber({ ...dados, converterConta: true });
        else return;
      }
      setMsg(notify(res, "Salvo."));
    });
  }

  return (
    <div className={`glass overflow-hidden rounded-3xl ${barber.active ? "" : "opacity-70"}`}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 p-4 text-left sm:p-5"
      >
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-royal-grad font-display text-lg text-white">
          {barber.name.charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-white">
            {barber.shortName}
            <span className="font-normal text-steel-400"> · {barber.title}</span>
          </span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            {!barber.active && <Pill cls="bg-white/8 text-steel-300">Desativado</Pill>}
            {barber.isAdmin && <Pill cls="bg-electric/10 text-electric">Admin</Pill>}
            <Pill cls={barber.lunchStart != null ? "bg-amber-400/10 text-amber-200" : "bg-white/5 text-steel-400"}>
              {barber.lunchStart != null && barber.lunchEnd != null
                ? `Almoço ${hhmm(barber.lunchStart)}–${hhmm(barber.lunchEnd)}`
                : "Sem almoço"}
            </Pill>
            {folgas.length > 0 && <Pill cls="bg-white/5 text-steel-300">Folga {folgas.join(", ")}</Pill>}
            <Pill cls="bg-white/5 text-steel-300">{barber.atendimentos} no mês</Pill>
          </span>
        </span>
        <ChevronDown className={`h-5 w-5 flex-none text-steel-400 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-white/8 p-4 sm:p-5">
          <Secao titulo="Dados">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <TextInput label="Nome completo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <TextInput label="Nome curto" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
              <TextInput label="Cargo" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <TextInput label="WhatsApp" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <TextInput label="E-mail (login)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </Secao>

          <Secao titulo="Jornada e almoço">
            <Almoco barberId={barber.id} inicio={barber.lunchStart} fim={barber.lunchEnd} />
            <BarberHours barberId={barber.id} hours={barber.hours} />
          </Secao>

          <Secao titulo="Comissão">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="Comissão base (%)"
                type="number"
                min={0}
                max={100}
                value={form.commissionPct}
                onChange={(e) => setForm({ ...form, commissionPct: Number(e.target.value) })}
              />
              <TextInput label="Meta de comissão no mês (R$)" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
            <p className="mt-3 text-sm text-steel-300">
              Este mês: gerou <span className="font-semibold text-white">{formatBRL(form.baseCents)}</span> · comissão{" "}
              <span className="font-semibold text-electric">{formatBRL(form.barberCents)}</span>
            </p>
          </Secao>

          <Secao titulo="Acesso">
            {/* No próprio cartão as duas chaves ficam travadas: o servidor
                recusa (o dono ficaria trancado para fora). */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle
                checked={form.active}
                onChange={(v) => setForm({ ...form, active: v })}
                disabled={meu}
                label="Ativo na agenda"
                hint={
                  meu
                    ? "É a sua conta: só outro administrador pode desativá-la"
                    : form.active
                      ? "Aparece para os clientes e tem acesso ao sistema"
                      : "Ao salvar: perde o acesso e os horários futuros são cancelados"
                }
              />
              <Toggle
                checked={form.isAdmin}
                onChange={(v) => setForm({ ...form, isAdmin: v })}
                disabled={meu}
                label="Também é administrador"
                hint={meu ? "É a sua conta: você continua administrador" : "Dá acesso ao painel de gestão"}
              />
            </div>
            <ResetSenha userId={barber.userId} nome={barber.shortName} />
          </Secao>

          <div>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar dados, comissão e acesso
            </button>
            <p className="mt-1.5 text-xs text-steel-400">Jornada e almoço salvam no próprio botão deles.</p>
            <Feedback msg={msg} />
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`label rounded-full px-2.5 py-1 text-[10px] ${cls}`}>{children}</span>;
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <p className="label mb-3 text-steel-300">{titulo}</p>
      {children}
    </section>
  );
}

/** Almoço: bloqueado na agenda todo dia de trabalho da pessoa. */
function Almoco({ barberId, inicio, fim }: { barberId: number; inicio: number | null; fim: number | null }) {
  const [ini, setIni] = useState(inicio != null ? hhmm(inicio) : "");
  const [ate, setAte] = useState(fim != null ? hhmm(fim) : "");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function salvar(remover = false) {
    setMsg(null);
    start(async () => {
      const res = await setBarberLunch({
        barberId,
        inicio: remover || !ini ? null : toMin(ini),
        fim: remover || !ate ? null : toMin(ate),
      });
      setMsg(notify(res, "Salvo."));
      if (res.ok && remover) {
        setIni("");
        setAte("");
      }
    });
  }

  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Coffee className="h-4 w-4 text-amber-200" /> Almoço
      </p>
      <p className="mt-1 text-xs text-steel-400">
        Todo dia de trabalho, esse horário fica bloqueado: ninguém consegue marcar (nem pelo site, nem encaixe).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="time"
          aria-label="Início do almoço"
          value={ini}
          onChange={(e) => setIni(e.target.value)}
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-electric/60"
        />
        <span className="text-steel-400">às</span>
        <input
          type="time"
          aria-label="Fim do almoço"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-electric/60"
        />
        <button
          type="button"
          onClick={() => salvar()}
          disabled={pending || !ini || !ate}
          className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-white disabled:opacity-40"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Salvar almoço
        </button>
        {inicio != null && (
          <button
            type="button"
            onClick={() => salvar(true)}
            disabled={pending}
            className="label rounded-full px-3 py-2 text-steel-400 hover:text-white disabled:opacity-50"
          >
            Sem almoço
          </button>
        )}
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

/**
 * Redefinir a senha de quem trabalha na barbearia.
 *
 * Não existe "esqueci minha senha" por e-mail: sem isto, barbeiro que
 * esquece a senha fica sem acesso e ninguém consegue devolvê-lo. A ação
 * também sobe o token_version, então as sessões antigas daquela conta caem.
 */
function ResetSenha({ userId, nome }: { userId: number; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="label mt-4 inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2.5 text-steel-300 transition-colors hover:border-electric/45 hover:text-white"
      >
        <KeyRound className="h-3.5 w-3.5" />
        Redefinir senha
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <p className="text-sm font-semibold text-white">Nova senha de {nome}</p>
      <p className="mt-1 text-xs text-steel-400">
        Pelo menos 6 caracteres. Ao salvar, as sessões abertas dessa conta
        caem e a pessoa entra de novo com a senha nova.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <TextInput
            label="Senha"
            type="text"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={pending || senha.trim().length < 6}
          onClick={() => {
            setMsg(null);
            start(async () => {
              const r = await resetUserPassword({ userId, password: senha });
              setMsg(notify(r, "Senha redefinida."));
              if (r.ok) {
                setSenha("");
                setAberto(false);
              }
            });
          }}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          Salvar senha
        </button>
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setSenha("");
            setMsg(null);
          }}
          className="label rounded-full border border-white/12 px-4 py-3 text-steel-400 hover:text-white"
        >
          Cancelar
        </button>
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

function BarberHours({
  barberId,
  hours,
}: {
  barberId: number;
  hours: { weekday: number; openMinute: number; closeMinute: number }[];
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const map = new Map(hours.map((h) => [h.weekday, h]));
  const [editando, setEditando] = useState(false);

  function save(weekday: number, open: string, close: string, clear = false, folga = false) {
    setMsg(null);
    start(async () => {
      const res = await setBarberHours({
        barberId,
        weekday,
        openMinute: clear || folga ? null : toMin(open),
        closeMinute: clear || folga ? null : toMin(close),
        folga,
      });
      setMsg(notify(res, "Salvo."));
    });
  }

  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-white">Jornada da semana</p>
      {/* Resumo: a semana inteira em uma olhada. */}
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {WEEKDAYS.map((d, i) => {
          const linha = map.get(i);
          const folga = !!linha && linha.closeMinute <= linha.openMinute;
          return (
            <div
              key={d}
              className={`rounded-lg px-2 py-1.5 text-center ${
                folga ? "bg-amber-400/10 text-amber-200" : linha ? "bg-electric/10 text-electric" : "bg-white/5 text-steel-300"
              }`}
            >
              <span className="label block text-[10px]">{d}</span>
              <span className="block text-[11px]">
                {folga ? "Folga" : linha ? `${hhmm(linha.openMinute)}–${hhmm(linha.closeMinute)}` : "Loja"}
              </span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setEditando((v) => !v)}
        className="label mt-2 text-electric underline-offset-4 hover:underline"
      >
        {editando ? "Fechar edição" : "Editar jornada"}
      </button>
      {editando && (
      <>
      <p className="mt-2 text-xs text-steel-400">
        &ldquo;Loja&rdquo; segue o horário da loja. Preencha só os dias em que entra ou sai em outro horário e toque em{" "}
        <strong className="text-steel-200">Folga</strong> no dia em que não trabalha.
      </p>
      <div className="mt-3 space-y-2">
        {WEEKDAYS.map((d, i) => {
          const linha = map.get(i);
          const folga = !!linha && linha.closeMinute <= linha.openMinute;
          const h = folga ? undefined : linha;
          return (
            <div key={d} className="flex flex-wrap items-center gap-2">
              <span className="label w-10 flex-none text-steel-400">{d}</span>
              <span
                className={`label w-14 flex-none rounded-full px-2 py-1 text-center ${
                  folga ? "bg-amber-400/10 text-amber-200" : h ? "bg-electric/10 text-electric" : "bg-white/5 text-steel-400"
                }`}
              >
                {folga ? "Folga" : h ? "Próprio" : "Loja"}
              </span>
              <input
                type="time"
                aria-label={`Abertura de ${d}`}
                defaultValue={h ? hhmm(h.openMinute) : ""}
                id={`o-${barberId}-${i}`}
                className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-electric/60"
              />
              <span className="text-steel-400">—</span>
              <input
                type="time"
                aria-label={`Fechamento de ${d}`}
                defaultValue={h ? hhmm(h.closeMinute) : ""}
                id={`c-${barberId}-${i}`}
                className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-electric/60"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const o = (
                    document.getElementById(`o-${barberId}-${i}`) as HTMLInputElement
                  ).value;
                  const c = (
                    document.getElementById(`c-${barberId}-${i}`) as HTMLInputElement
                  ).value;
                  save(i, o, c, !o || !c);
                }}
                className="label rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-electric/40 hover:text-white disabled:opacity-50"
              >
                Aplicar
              </button>
              {!folga && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => save(i, "", "", false, true)}
                  className="label rounded-full border border-white/12 px-3 py-2 text-steel-400 transition-colors hover:border-amber-300/40 hover:text-amber-200 disabled:opacity-50"
                >
                  Folga
                </button>
              )}
              {linha && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => save(i, "", "", true)}
                  className="label rounded-full px-3 py-2 text-steel-400 transition-colors hover:text-white disabled:opacity-50"
                >
                  Usar horário da loja
                </button>
              )}
            </div>
          );
        })}
      </div>
      </>
      )}
      <Feedback msg={msg} />
    </div>
  );
}

function NewBarber({ comissaoPadrao }: { comissaoPadrao: number }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: "",
    shortName: "",
    title: "Barbeiro",
    phone: "",
    email: "",
    password: "",
    commissionPct: comissaoPadrao,
    isAdmin: false,
  });

  function submit() {
    setMsg(null);
    start(async () => {
      let res = await createBarber(f);
      // O WhatsApp é de uma conta de cliente (o barbeiro já tinha usado o
      // site): transforma em conta de barbeiro só com confirmação.
      if (!res.ok && res.error.startsWith("Essa pessoa já tem conta de cliente")) {
        if (window.confirm(res.error)) res = await createBarber({ ...f, converterConta: true });
      }
      setMsg(notify(res, "Cadastrado."));
      if (res.ok) {
        setF({ ...f, name: "", shortName: "", phone: "", email: "", password: "" });
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline label inline-flex w-full items-center justify-center gap-2 rounded-2xl py-5 text-electric"
      >
        <UserPlus className="h-4 w-4" />
        Cadastrar barbeiro
      </button>
    );
  }

  return (
    <Card title="Novo barbeiro" icon={<UserPlus className="h-5 w-5" />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Nome completo"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <TextInput
          label="Nome curto"
          value={f.shortName}
          placeholder="Ex.: Rafael M."
          onChange={(e) => setF({ ...f, shortName: e.target.value })}
        />
        <TextInput
          label="Cargo"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <TextInput
          label="WhatsApp"
          value={f.phone}
          placeholder="(41) 9 0000-0000"
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
        <TextInput
          label="E-mail (login)"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <TextInput
          label="Senha inicial"
          type="password"
          value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })}
        />
        <TextInput
          label="Comissão (%)"
          type="number"
          min={0}
          max={100}
          value={f.commissionPct}
          onChange={(e) => setF({ ...f, commissionPct: Number(e.target.value) })}
        />
      </div>
      <div className="mt-4">
        <Toggle
          checked={f.isAdmin}
          onChange={(v) => setF({ ...f, isAdmin: v })}
          label="Também é administrador"
          hint="Dá acesso ao painel de gestão"
        />
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Cadastrar
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
    </Card>
  );
}

function Tiers({
  tiers,
  team,
}: {
  tiers: {
    id: number;
    barberId: number | null;
    minRevenueCents: number;
    barberPct: number;
    label: string | null;
  }[];
  team: BarberRow[];
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ barberId: "", meta: "", pct: 60, label: "" });
  const [aberto, setAberto] = useState(false);

  function add() {
    setMsg(null);
    start(async () => {
      const res = await upsertCommissionTier({
        barberId: f.barberId ? Number(f.barberId) : null,
        // "8.000" é oito mil, não oito reais.
        minRevenueCents: parseMoneyToCents(f.meta),
        barberPct: f.pct,
        label: f.label,
      });
      setMsg(notify(res, "Salvo."));
      if (res.ok) setF({ ...f, meta: "", label: "" });
    });
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="glass flex w-full items-center gap-3 rounded-3xl p-4 text-left sm:p-5"
      >
        <Target className="h-5 w-5 flex-none text-electric" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-white">Faixas de meta</span>
          <span className="text-xs text-steel-400">
            {tiers.length ? `${tiers.length} faixa(s) cadastrada(s)` : "Nenhuma faixa: vale a comissão base de cada um"}
          </span>
        </span>
        <ChevronDown className="h-5 w-5 flex-none text-steel-400" />
      </button>
    );
  }

  return (
    <Card
      title="Faixas de meta"
      desc="Quando o barbeiro passa do valor gerado no mês, o percentual dele sobe. Sem faixa, vale a comissão base."
      icon={<Target className="h-5 w-5" />}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <SelectInput
          label="Quem"
          value={f.barberId}
          onChange={(e) => setF({ ...f, barberId: e.target.value })}
        >
          <option value="">Todos</option>
          {team.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="A partir de (R$ gerados)"
          inputMode="decimal"
          value={f.meta}
          placeholder="8.000"
          onChange={(e) => setF({ ...f, meta: e.target.value })}
        />
        <TextInput
          label="Comissão (%)"
          type="number"
          min={0}
          max={100}
          value={f.pct}
          onChange={(e) => setF({ ...f, pct: Number(e.target.value) })}
        />
        <TextInput
          label="Rótulo"
          value={f.label}
          placeholder="Ex.: Meta ouro"
          onChange={(e) => setF({ ...f, label: e.target.value })}
        />
      </div>
      <button
        type="button"
        onClick={add}
        disabled={pending || !f.meta}
        className="btn-royal label mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        Adicionar faixa
      </button>
      <Feedback msg={msg} />

      <ul className="mt-5 space-y-2 border-t border-white/8 pt-5">
        {tiers.length === 0 ? (
          <p className="text-sm text-steel-400">
            Nenhuma faixa. Todos seguem a comissão base.
          </p>
        ) : (
          tiers.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  {t.label || "Faixa"} · {t.barberPct}%
                </p>
                <p className="text-xs text-steel-400">
                  {t.barberId
                    ? team.find((b) => b.id === t.barberId)?.shortName
                    : "Todos"}{" "}
                  · a partir de {formatBRL(t.minRevenueCents)}
                </p>
              </div>
              <TierRemove id={t.id} />
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

function TierRemove({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await removeCommissionTier(id);
          toast(
            r.ok ? r.message ?? "Faixa removida." : r.error ?? "Não foi possível.",
            r.ok ? "ok" : "erro"
          );
        })
      }
      aria-label="Remover faixa"
      className="grid h-10 w-10 flex-none place-items-center rounded-full text-steel-400 transition-colors hover:bg-white/5 hover:text-red-200 disabled:opacity-40"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <X className="h-4 w-4" />
      )}
    </button>
  );
}
