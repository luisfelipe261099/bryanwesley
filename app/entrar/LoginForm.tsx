"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarPlus, CheckCircle2, KeyRound, Loader2, Mail, MessageCircle } from "lucide-react";
import {
  login,
  pedirCodigoNoWhatsapp,
  pedirNovaSenhaNaBarbearia,
  receberLinkPorEmail,
  redefinirMinhaSenha,
  signup,
  type AuthState,
  type NovaSenhaState,
  type SignupState,
} from "./actions";

type Tab = "entrar" | "criar" | "esqueci";

export function LoginForm({
  proximo,
  erroInicial,
  whatsapp = false,
  email = false,
}: {
  proximo: string;
  erroInicial?: string;
  /** Envio de e-mail ligado: o link de nova senha chega sozinho. */
  email?: boolean;
  /** O WhatsApp da barbearia manda mensagens sozinho (código de senha). */
  whatsapp?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("entrar");

  return (
    <div className="glass w-full rounded-3xl p-7">
      <div className="mb-6 inline-flex w-full items-center gap-1 rounded-full border border-white/10 bg-ink-700 p-1.5">
        <TabButton active={tab === "entrar"} onClick={() => setTab("entrar")}>
          Entrar
        </TabButton>
        <TabButton active={tab === "criar"} onClick={() => setTab("criar")}>
          Criar conta
        </TabButton>
      </div>

      {erroInicial && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          {erroInicial}
        </p>
      )}

      {tab === "entrar" ? (
        <SignInForm proximo={proximo} onEsqueci={() => setTab("esqueci")} />
      ) : tab === "esqueci" ? (
        <EsqueciForm onVoltar={() => setTab("entrar")} whatsapp={whatsapp} email={email} />
      ) : (
        <SignUpForm proximo={proximo} />
      )}

      <div className="mt-6 border-t border-white/8 pt-5">
        <Link
          href="/agendar"
          className="group flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 transition-colors hover:border-electric/40"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric">
              <CalendarPlus className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">
                Agendar sem cadastro
              </span>
              <span className="text-xs text-steel-400">
                Só nome e WhatsApp
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 flex-none text-electric transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}

function SignInForm({ proximo, onEsqueci }: { proximo: string; onEsqueci: () => void }) {
  const [state, action] = useFormState<AuthState, FormData>(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="proximo" value={proximo} />
      <Field
        label="E-mail ou WhatsApp"
        name="identifier"
        placeholder="voce@email.com ou (11) 9 0000-0000"
        autoComplete="username"
      />
      <Field
        label="Senha"
        name="password"
        type="password"
        placeholder="••••••••"
        autoComplete="current-password"
      />
      <ErrorLine state={state} />
      <SubmitButton>Entrar</SubmitButton>
      {/* Sem este caminho, quem esquecia a senha tentava criar conta de
          novo e ouvia "já existe uma conta". */}
      <button
        type="button"
        onClick={onEsqueci}
        className="mx-auto flex items-center gap-1.5 text-sm text-electric underline-offset-4 hover:underline"
      >
        <KeyRound className="h-3.5 w-3.5" />
        Esqueci minha senha
      </button>
    </form>
  );
}

function SignUpForm({ proximo }: { proximo: string }) {
  const [state, action] = useFormState<SignupState, FormData>(signup, undefined);
  const needsCode = !!state?.needsCode;
  return (
    <form action={action} className="space-y-4">
      {/* Quem veio de "Assinar" volta para o plano que estava assinando. */}
      <input type="hidden" name="proximo" value={proximo} />
      <Field
        label="Nome completo"
        name="name"
        placeholder="Ex.: Gabriel Silva"
        autoComplete="name"
      />
      <Field
        label="WhatsApp (com DDD)"
        name="phone"
        type="tel"
        placeholder="(11) 9 0000-0000"
        autoComplete="tel"
      />
      <Field
        label="E-mail (opcional, para recuperar a senha)"
        name="email"
        type="email"
        placeholder="voce@email.com"
        autoComplete="email"
        required={false}
      />
      <Field
        label="Crie uma senha"
        name="password"
        type="password"
        placeholder="Mínimo 6 caracteres"
        autoComplete="new-password"
      />
      {needsCode && (
        <div className="rounded-xl border border-electric/30 bg-electric/[0.06] p-4">
          <p className="text-sm text-steel-200">
            Esse WhatsApp já tem agendamento. Para confirmar que é você,
            informe o código de 6 letras que aparece na confirmação.
          </p>
          <div className="mt-3">
            <Field
              label="Código do agendamento"
              name="code"
              placeholder="Ex.: K7QM2P"
              autoComplete="off"
            />
          </div>
        </div>
      )}
      <ErrorLine state={state?.error ? { error: state.error } : undefined} />
      <SubmitButton>Criar minha conta</SubmitButton>
    </form>
  );
}

/**
 * Senha nova sem depender do balcão: o cliente prova que é ele com o
 * código que chega no WhatsApp ou com o de um atendimento seu.
 */
function EsqueciForm({ onVoltar, whatsapp, email }: { onVoltar: () => void; whatsapp: boolean; email: boolean }) {
  const [state, action] = useFormState<NovaSenhaState, FormData>(redefinirMinhaSenha, undefined);
  const [fone, setFone] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pedindo, startPedido] = useTransition();

  const [pedido, setPedido] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pedindoLink, startLink] = useTransition();
  const [comCodigo, setComCodigo] = useState(false);

  const [porEmail, setPorEmail] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviandoEmail, startEmail] = useTransition();
  function receberPorEmail() {
    setPorEmail(null);
    startEmail(async () => {
      const r = await receberLinkPorEmail(fone);
      setPorEmail({ ok: r.ok, texto: r.mensagem });
    });
  }

  function pedirNaBarbearia() {
    setPedido(null);
    startLink(async () => {
      const r = await pedirNovaSenhaNaBarbearia(fone);
      setPedido({ ok: r.ok, texto: r.mensagem });
    });
  }

  function pedirCodigo() {
    setAviso(null);
    startPedido(async () => {
      const r = await pedirCodigoNoWhatsapp(fone);
      setAviso({ ok: r.ok, texto: r.mensagem });
    });
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="font-display text-xl text-white">Criar uma nova senha</h2>
        <p className="mt-1 text-sm text-steel-400">
          {email
            ? "Informe seu e-mail ou WhatsApp. O link para criar a senha nova chega no seu e-mail."
            : "Informe seu WhatsApp. A barbearia te manda um link para criar a senha nova."}
        </p>
      </div>
      <label className="block">
        <span className="label mb-2 block text-steel-400">{email ? "Seu e-mail ou WhatsApp" : "Seu WhatsApp"}</span>
        <input
          name="phone"
          type={email ? "text" : "tel"}
          required
          value={fone}
          onChange={(e) => setFone(e.target.value)}
          placeholder={email ? "voce@email.com ou (41) 9 0000-0000" : "(41) 9 0000-0000"}
          autoComplete={email ? "username" : "tel"}
          className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3.5 text-white outline-none transition-colors placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20"
        />
      </label>
      {email && (
        <>
          <button
            type="button"
            onClick={receberPorEmail}
            disabled={enviandoEmail || fone.trim().length < 6}
            className="btn-royal label inline-flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-white disabled:opacity-40"
          >
            {enviandoEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Receber link no e-mail
          </button>
          {porEmail && (
            <p
              className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${
                porEmail.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"
              }`}
            >
              {porEmail.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" /> : <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />}
              {porEmail.texto}
            </p>
          )}
        </>
      )}
      <button
        type="button"
        onClick={pedirNaBarbearia}
        disabled={pedindoLink || fone.replace(/\D/g, "").length < 10}
        className={`label inline-flex w-full items-center justify-center gap-2 rounded-full py-3.5 disabled:opacity-40 ${
          email ? "border border-white/12 text-steel-200" : "btn-royal text-white"
        }`}
      >
        {pedindoLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {email ? "Sem e-mail? Pedir link à barbearia" : "Pedir link à barbearia"}
      </button>
      {pedido && (
        <p
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${
            pedido.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"
          }`}
        >
          {pedido.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" /> : <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />}
          {pedido.texto}
        </p>
      )}
      {!comCodigo ? (
        <button
          type="button"
          onClick={() => setComCodigo(true)}
          className="mx-auto block text-center text-sm text-electric underline-offset-4 hover:underline"
        >
          {whatsapp ? "Tenho um código (WhatsApp ou de atendimento)" : "Já fui atendido e tenho o código do atendimento"}
        </button>
      ) : (
        <>
      {whatsapp && (
      <button
        type="button"
        onClick={pedirCodigo}
        disabled={pedindo || fone.replace(/\D/g, "").length < 10}
        className="label inline-flex w-full items-center justify-center gap-2 rounded-full border border-electric/40 bg-electric/10 py-3 text-electric disabled:opacity-40"
      >
        {pedindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        Receber código no WhatsApp
      </button>
      )}
      {aviso && (
        <p
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${
            aviso.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"
          }`}
        >
          {aviso.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" /> : <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />}
          {aviso.texto}
        </p>
      )}
      <label className="block">
        <span className="label mb-2 block text-steel-400">Código</span>
        <input
          name="codigo"
          required
          maxLength={8}
          autoComplete="one-time-code"
          placeholder={whatsapp ? "Ex.: 482913 ou K7QM2P" : "Ex.: K7QM2P"}
          className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3.5 font-display uppercase tracking-[0.2em] text-white outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20"
        />
        <span className="mt-1.5 block text-xs leading-relaxed text-steel-400">
          {whatsapp ? "O código de 6 números que chegou no WhatsApp, ou o" : "O"} código de um atendimento seu dos
          últimos 60 dias (as 6 letras do agendamento, ex.: K7QM2P) em que você esteve na barbearia.
        </span>
      </label>
      <Field label="Nova senha" name="senha" type="password" placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
      <Field label="Repita a nova senha" name="confirmar" type="password" placeholder="••••••••" autoComplete="new-password" />
      <ErrorLine state={state} />
      <SubmitButton>Salvar nova senha e entrar</SubmitButton>
        </>
      )}
      <button
        type="button"
        onClick={onVoltar}
        className="mx-auto flex items-center gap-1.5 text-sm text-steel-400 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para entrar
      </button>

    </form>
  );
}

function ErrorLine({ state }: { state: AuthState }) {
  if (!state?.error) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3.5 py-3 text-sm text-red-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
      {state.error}
    </p>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-royal label inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:opacity-60"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`label flex-1 rounded-full py-3 transition-all ${
        active ? "btn-royal text-white" : "text-steel-300 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  autoComplete,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label mb-2 block text-steel-400">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3.5 text-white outline-none transition-colors placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20"
      />
    </label>
  );
}
