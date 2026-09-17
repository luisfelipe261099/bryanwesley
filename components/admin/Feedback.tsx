"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "@/lib/toast";

export type Msg = { ok: boolean; text: string } | null;

/**
 * Sucesso vira aviso flutuante (sobrevive à revalidação da rota);
 * erro fica inline, ao lado do formulário, onde o usuário está olhando.
 */
export function notify(
  res: { ok: boolean; message?: string; error?: string },
  fallback = "Feito."
): Msg {
  if (res.ok) {
    toast(res.message ?? fallback, "ok");
    return null;
  }
  return { ok: false, text: res.error ?? "Não foi possível concluir." };
}

export function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p
      role="status"
      className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm ${
        msg.ok
          ? "border border-neon/30 bg-neon/10 text-neon"
          : "border border-amber-400/30 bg-amber-400/10 text-amber-200"
      }`}
    >
      {msg.ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
      )}
      {msg.text}
    </p>
  );
}

export function Card({
  title,
  desc,
  children,
  icon,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
  /**
   * Elemento já renderizado (ex.: `<Scissors className="h-5 w-5" />`).
   * Receber o componente em si quebraria quando o Card fosse usado de
   * dentro de um Server Component.
   */
  icon?: ReactNode;
}) {
  return (
    <div className="glass rounded-3xl p-6">
      <div className="flex items-center gap-2 text-electric">
        {icon}
        <h2 className="font-display text-lg text-white">{title}</h2>
      </div>
      {desc && <p className="mt-1.5 text-sm text-steel-400">{desc}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

export function TextInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="label mb-2 block text-steel-400">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20"
      />
    </label>
  );
}

export function SelectInput({
  label,
  children,
  ...props
}: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="label mb-2 block text-steel-400">{label}</span>
      <select
        {...props}
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none [color-scheme:dark] focus:border-electric/60"
      >
        {children}
      </select>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-steel-400">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 flex-none rounded-full transition-colors ${
          checked ? "bg-royal-grad" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-1.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-7" : "left-1.5"
          }`}
        />
      </button>
    </div>
  );
}
