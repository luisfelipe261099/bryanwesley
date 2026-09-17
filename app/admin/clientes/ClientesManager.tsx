"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  subscribeImportReport,
  getImportReport,
  getServerImportReport,
  setImportReport,
  clearImportReport,
} from "@/lib/import-report";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  Loader2,
  Phone,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import { Card, Feedback, type Msg } from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import { importClients } from "../actions";

type ClientRow = {
  id: number;
  name: string;
  phone: string;
  plan: string | null;
  overduePlan: string | null;
  renewsAt: string | null;
  visits: number;
  lastVisit: string | null;
  upcoming: number;
  hasAccount: boolean;
  hasFixedSlot: boolean;
  phonePending: boolean;
};

/** Os recortes que o balcão pede no dia a dia. */
const SITUACOES = [
  { valor: "todos", label: "Todos" },
  { valor: "assinantes", label: "Assinantes" },
  { valor: "inadimplentes", label: "Plano vencido" },
  { valor: "avulsos", label: "Avulsos" },
  { valor: "sem-telefone", label: "Sem telefone" },
  { valor: "com-conta", label: "Com conta no app" },
  { valor: "fixo", label: "Horário fixo" },
] as const;

const ORDENS = [
  { valor: "recentes", label: "Mais recentes" },
  { valor: "nome", label: "Nome (A–Z)" },
  { valor: "visitas", label: "Mais visitas" },
  { valor: "ultima-visita", label: "Última visita" },
] as const;

type Situacao = (typeof SITUACOES)[number]["valor"];
type Ordem = (typeof ORDENS)[number]["valor"];

/** Monta a URL da lista preservando o que já estava aplicado. */
function urlDaLista(atual: {
  busca: string;
  situacao: Situacao;
  ordem: Ordem;
  pagina: number;
}) {
  const p = new URLSearchParams();
  if (atual.busca) p.set("q", atual.busca);
  if (atual.situacao !== "todos") p.set("situacao", atual.situacao);
  if (atual.ordem !== "recentes") p.set("ordem", atual.ordem);
  if (atual.pagina > 1) p.set("pagina", String(atual.pagina));
  const qs = p.toString();
  return qs ? `/admin/clientes?${qs}` : "/admin/clientes";
}

export function ClientesManager({
  clients,
  busca,
  situacao,
  ordem,
  pagina,
  porPagina,
  total,
}: {
  clients: ClientRow[];
  /** Termo em vigor, vindo da URL. */
  busca: string;
  situacao: Situacao;
  ordem: Ordem;
  pagina: number;
  porPagina: number;
  /** Quantos clientes o filtro encontrou no banco. */
  total: number;
}) {
  const router = useRouter();
  const [navegando, start] = useTransition();
  const estado = { busca, situacao, ordem, pagina };

  // Mudar filtro ou ordem volta para a primeira página: manter a página
  // anterior deixaria a tela vazia sem explicar por quê.
  function aplicar(mudanca: Partial<typeof estado>) {
    start(() => {
      router.push(urlDaLista({ ...estado, pagina: 1, ...mudanca }));
    });
  }

  const primeiro = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(pagina * porPagina, total);
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  const exportar = (() => {
    const p = new URLSearchParams();
    if (busca) p.set("q", busca);
    if (situacao !== "todos") p.set("situacao", situacao);
    if (ordem !== "recentes") p.set("ordem", ordem);
    const qs = p.toString();
    return qs ? `/api/relatorios/clientes?${qs}` : "/api/relatorios/clientes";
  })();

  return (
    <div className="space-y-5">
      <ImportBox exportar={exportar} filtrando={!!busca || situacao !== "todos"} />

      <Card
        title="Clientes"
        desc={
          total === 0
            ? "Nenhum cliente para este filtro."
            : `Mostrando ${primeiro}–${ultimo} de ${total}`
        }
      >
        <BuscaClientes
          inicial={busca}
          onBuscar={(termo) => aplicar({ busca: termo })}
        />

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {SITUACOES.map((s) => (
            <button
              key={s.valor}
              type="button"
              onClick={() => aplicar({ situacao: s.valor })}
              aria-pressed={situacao === s.valor}
              className={`label rounded-full border px-3 py-2 transition-colors ${
                situacao === s.valor
                  ? "border-electric/45 bg-electric/12 text-electric"
                  : "border-white/10 text-steel-300 hover:border-white/25 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-steel-400">
            Ordenar
            <select
              value={ordem}
              onChange={(e) => aplicar({ ordem: e.target.value as Ordem })}
              aria-label="Ordenar clientes"
              className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white outline-none [color-scheme:dark] focus:border-electric/60"
            >
              {ORDENS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {clients.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Nenhum cliente encontrado.
          </p>
        ) : (
          <ul className={`space-y-2 ${navegando ? "opacity-60" : ""}`}>
            {clients.map((c) => (
              <ClientRowItem key={c.id} client={c} />
            ))}
          </ul>
        )}

        {total > porPagina && (
          <nav
            aria-label="Páginas de clientes"
            className="mt-4 flex flex-wrap items-center justify-center gap-3 border-t border-white/8 pt-4 sm:justify-between"
          >
            <PaginaBtn
              href={urlDaLista({ ...estado, pagina: pagina - 1 })}
              desabilitado={pagina <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </PaginaBtn>
            {/* Em tela estreita a contagem vai para a própria linha: entre
                os dois botões ela empurrava "Próxima" para fora. */}
            <span className="order-first w-full text-center text-xs text-steel-400 sm:order-none sm:w-auto">
              Página {pagina} de {ultimaPagina}
            </span>
            <PaginaBtn
              href={urlDaLista({ ...estado, pagina: pagina + 1 })}
              desabilitado={pagina >= ultimaPagina}
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5" />
            </PaginaBtn>
          </nav>
        )}
      </Card>
    </div>
  );
}

function PaginaBtn({
  href,
  desabilitado,
  children,
}: {
  href: string;
  desabilitado: boolean;
  children: React.ReactNode;
}) {
  const classe =
    "label inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5";
  if (desabilitado) {
    return (
      <span
        aria-disabled="true"
        className={`${classe} border-white/8 text-steel-400/50`}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${classe} border-white/12 text-steel-300 hover:border-electric/40 hover:text-white`}
    >
      {children}
    </Link>
  );
}

/**
 * Uma linha da lista.
 *
 * O cartão inteiro abre a ficha: assinatura, agendamento, pagamentos e
 * senha moram lá, onde há espaço para mostrar o que já aconteceu antes de
 * mexer. Aqui fica só o que ajuda a reconhecer a pessoa.
 */
function ClientRowItem({ client }: { client: ClientRow }) {
  return (
    <li>
      <Link
        href={`/admin/clientes/${client.id}`}
        className="flex flex-wrap items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5 transition-colors hover:border-electric/35 hover:bg-white/[0.04]"
      >
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
          {client.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1 basis-[60%]">
          <div className="flex flex-wrap items-center gap-2">
            {/* O nome ocupa a linha inteira no celular: com os selos ao lado
                ele encolheria a zero e o admin não saberia de quem é o card. */}
            <span className="w-full truncate font-medium text-white sm:w-auto">
              {client.name}
            </span>
            {client.hasFixedSlot && (
              <span
                className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2 py-1 text-electric"
                title="Tem horário fixo reservado"
              >
                <CalendarClock className="h-3 w-3" />
                Fixo
              </span>
            )}
            {client.hasAccount && (
              <span
                className="label inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-steel-400"
                title="Já criou senha no app"
              >
                <UserCheck className="h-3 w-3" />
                Conta
              </span>
            )}
          </div>
          <div
            className={`mt-0.5 flex items-center gap-1 text-xs ${
              client.phonePending ? "text-amber-300" : "text-steel-400"
            }`}
          >
            <Phone className="h-3 w-3 flex-none" />
            <span className="truncate">
              {client.phonePending
                ? "Sem telefone — completar"
                : formatPhone(client.phone)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {client.plan ? (
              <span className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2.5 py-1.5 text-electric">
                <Crown className="h-3 w-3" />
                {client.plan.replace("Plano ", "")}
              </span>
            ) : client.overduePlan ? (
              <span className="label inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1.5 text-amber-300">
                <Crown className="h-3 w-3" />
                {client.overduePlan.replace("Plano ", "")} · vencido
              </span>
            ) : (
              <span className="label rounded-full bg-white/5 px-2.5 py-1.5 text-steel-300">
                Avulso
              </span>
            )}
            <span className="text-xs text-steel-400">
              {client.visits} visita(s)
              {client.lastVisit ? ` · última em ${client.lastVisit}` : ""}
              {client.renewsAt ? ` · renova ${client.renewsAt}` : ""}
            </span>
          </div>
        </div>
        <div className="flex w-full flex-none items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end sm:justify-start">
          {client.upcoming > 0 ? (
            <span className="label inline-flex items-center gap-1 rounded-full bg-neon/10 px-2.5 py-1.5 text-neon">
              <CalendarClock className="h-3 w-3" />
              {client.upcoming} marcado(s)
            </span>
          ) : (
            <span className="text-xs text-steel-400/70">sem horário marcado</span>
          )}
          <span className="label inline-flex items-center gap-1 rounded-full border border-white/12 px-3 py-2 text-steel-300">
            Abrir ficha
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * Busca de cliente.
 *
 * O termo vai para a URL e a consulta acontece no banco: com quase mil
 * cadastros importados, filtrar só a página carregada esconderia a maioria
 * das pessoas.
 */
function BuscaClientes({
  inicial,
  onBuscar,
}: {
  inicial: string;
  onBuscar: (termo: string) => void;
}) {
  const [q, setQ] = useState(inicial);
  const [pending, start] = useTransition();

  function buscar(termo: string) {
    start(() => onBuscar(termo.trim()));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        buscar(q);
      }}
      className="mb-4 flex gap-2"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nome ou telefone…"
        aria-label="Buscar cliente"
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn-royal label flex-none rounded-xl px-5 text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
      </button>
      {inicial && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            buscar("");
          }}
          className="label flex-none rounded-xl border border-white/12 px-4 text-steel-300 hover:text-white"
        >
          Limpar
        </button>
      )}
    </form>
  );
}

function ImportBox({
  exportar,
  filtrando,
}: {
  /** Endereço do CSV já com a busca e o filtro em vigor. */
  exportar: string;
  filtrando: boolean;
}) {
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  // Fora do React: a ação revalida a rota e um useState seria apagado
  // junto com a lista de quem ficou de fora — justamente o que o dono
  // precisa ler depois de importar.
  const relatorio = useSyncExternalStore(
    subscribeImportReport,
    getImportReport,
    getServerImportReport
  );
  const skipped = relatorio?.skipped ?? [];

  function run() {
    setMsg(null);
    clearImportReport();
    start(async () => {
      const res = await importClients(csv);
      if (res.ok) {
        // O resumo vai para o store junto com o relatório: a ação revalida
        // a rota, isso remonta a árvore e um useState seria apagado —
        // exatamente a mensagem que diz quantos entraram.
        setImportReport({
          message: res.message ?? "Importado.",
          criados: res.criados ?? 0,
          atualizados: res.atualizados ?? 0,
          skipped: res.skipped ?? [],
        });
        setCsv("");
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  function baixarRelatorio() {
    const linhas = [
      `Importação: ${relatorio?.message ?? ""}`,
      `${skipped.length} linha(s) de fora:`,
      ...skipped,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([linhas], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "importacao-clientes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  return (
    <Card
      title="Importar clientes do sistema antigo"
      desc="Envie o CSV como ele sai do outro sistema: as colunas podem vir em qualquer ordem (nome, telefone e e-mail são reconhecidos pelo cabeçalho) e o separador pode ser vírgula, ponto e vírgula ou tab. O telefone é a chave: quem já existe é atualizado, sem duplicar."
      icon={<Upload className="h-5 w-5" />}
    >
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        onChange={onFile}
        aria-label="Arquivo CSV"
        className="mb-3 block w-full text-sm text-steel-300 file:mr-4 file:rounded-full file:border-0 file:bg-electric/15 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:uppercase file:tracking-widest file:text-electric hover:file:bg-electric/25"
      />
      <textarea
        rows={5}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"nome,telefone,email\nJoão Silva,(41) 99999-0000,joao@email.com\n\nOu cole o arquivo inteiro do sistema antigo — as colunas extras são ignoradas."}
        className="w-full resize-none rounded-xl border border-white/10 bg-surface-2 px-4 py-3 font-mono text-xs text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
      />
      <button
        type="button"
        onClick={run}
        disabled={pending || csv.trim().length === 0}
        className="btn-royal label mt-3 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-40"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        Importar
      </button>
      <a
        href={exportar}
        title={
          filtrando
            ? "Baixa só quem está aparecendo no filtro"
            : "Baixa a base inteira"
        }
        className="btn-outline label ml-3 inline-flex items-center gap-2 rounded-full px-5 py-3 text-electric"
      >
        <Download className="h-4 w-4" />
        {filtrando ? "Exportar o filtro" : "Exportar"}
      </a>
      <Feedback msg={relatorio ? { ok: true, text: relatorio.message } : msg} />

      {skipped.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5">
          <p className="label flex items-center gap-2 text-amber-200">
            <X className="h-3.5 w-3.5" />
            {skipped.length} linha(s) ignorada(s)
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-200/80">
            {skipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={baixarRelatorio}
            className="label mt-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 px-4 py-2 text-amber-200 hover:bg-amber-400/10"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar a lista
          </button>
        </div>
      )}
    </Card>
  );
}
