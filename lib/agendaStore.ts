// ───────────────────────────────────────────────────────────
// Configurações da agenda controladas pelo administrador.
// No protótipo guardamos no localStorage do navegador para que
// o painel admin e o fluxo de agendamento "conversem" de verdade
// (bloquear um dia no admin some/trava ele pro cliente).
// Depois isso vira uma tabela no banco + API.
// ───────────────────────────────────────────────────────────

export type AgendaSettings = {
  acceptingBookings: boolean; // aceitar novos agendamentos?
  minHours: number; // antecedência mínima (horas)
  blockedDates: string[]; // dias inteiros bloqueados: ["2026-06-20", ...]
  blockedSlots: Record<string, string[]>; // horários bloqueados por dia
};

const KEY = "bw_agenda_v1";
const CHANGE_EVENT = "bw-agenda-change";

export const defaultAgenda: AgendaSettings = {
  acceptingBookings: true,
  minHours: 2,
  blockedDates: [],
  blockedSlots: {},
};

export function readAgenda(): AgendaSettings {
  if (typeof window === "undefined") return defaultAgenda;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultAgenda;
    return { ...defaultAgenda, ...JSON.parse(raw) };
  } catch {
    return defaultAgenda;
  }
}

export function writeAgenda(next: AgendaSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function onAgendaChange(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb); // sincroniza entre abas
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// Chave de data local (YYYY-MM-DD) — evita o deslocamento de fuso do toISOString.
export function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isDateBlocked(s: AgendaSettings, key: string) {
  return s.blockedDates.includes(key);
}

export function isSlotBlocked(s: AgendaSettings, dateKey: string, time: string) {
  return (s.blockedSlots[dateKey] ?? []).includes(time);
}
