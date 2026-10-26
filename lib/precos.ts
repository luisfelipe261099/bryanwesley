// Preço por turno — só funções puras: valem no servidor e na tela.
import { minutesToHHMM, weekdayOf } from "./time";

export type RegraPreco = {
  id: number;
  serviceId: number;
  label: string;
  weekdays: number[];
  startMin: number;
  endMin: number;
  priceCents: number;
};

export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * A regra que vale para o serviço num dia da semana e minuto do dia.
 * Duas regras se cruzando (ex.: "Noite" todo dia e "Sábado" o dia todo),
 * vence a mais específica: menos dias e, empatado, a faixa mais curta.
 */
export function regraDoHorario(
  regras: RegraPreco[],
  serviceId: number,
  weekday: number,
  minutos: number
): RegraPreco | null {
  let melhor: RegraPreco | null = null;
  for (const r of regras) {
    if (r.serviceId !== serviceId || !r.weekdays.includes(weekday)) continue;
    if (minutos < r.startMin || minutos >= r.endMin) continue;
    if (
      !melhor ||
      r.weekdays.length < melhor.weekdays.length ||
      (r.weekdays.length === melhor.weekdays.length &&
        (r.endMin - r.startMin < melhor.endMin - melhor.startMin ||
          (r.endMin - r.startMin === melhor.endMin - melhor.startMin && r.id > melhor.id)))
    ) {
      melhor = r;
    }
  }
  return melhor;
}

/** Preço do serviço num horário: o da regra que vale, senão o do catálogo. */
export function precoNoHorario(
  servico: { id: number; priceCents: number },
  regras: RegraPreco[],
  weekday: number,
  minutos: number
) {
  return regraDoHorario(regras, servico.id, weekday, minutos)?.priceCents ?? servico.priceCents;
}

/** Mesmo cálculo a partir de um dia "AAAA-MM-DD" e hora "HH:MM". */
export function precoNoDia(
  servico: { id: number; priceCents: number },
  regras: RegraPreco[],
  dateKey: string,
  time: string
) {
  const [h, m] = time.split(":").map(Number);
  return precoNoHorario(servico, regras, weekdayOf(dateKey), h * 60 + m);
}

/** "Seg a Sex", "Sáb", "Seg, Qua e Sex", "Todos os dias". */
export function rotuloDias(weekdays: number[]) {
  const d = [...new Set(weekdays)].sort((a, b) => a - b);
  if (d.length === 7) return "Todos os dias";
  if (d.length === 0) return "Nenhum dia";
  const seguidos = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos) return `${DIAS_CURTOS[d[0]]} a ${DIAS_CURTOS[d[d.length - 1]]}`;
  const nomes = d.map((x) => DIAS_CURTOS[x]);
  return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** "18:00 às 21:00" (o dia inteiro vira "o dia todo"). */
export function rotuloFaixa(r: { startMin: number; endMin: number }) {
  if (r.startMin <= 0 && r.endMin >= 24 * 60) return "o dia todo";
  return `${minutesToHHMM(r.startMin)} às ${minutesToHHMM(Math.min(r.endMin, 24 * 60 - 1))}`;
}
