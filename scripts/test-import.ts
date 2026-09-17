// Leitura do CSV de clientes: separador, aspas, ordem das colunas,
// telefone com código do país e telefone compartilhado.
import "../db/load-env";
import { parseCsv, mapHeader } from "../lib/csv";
import { planClientImport, semelhante, chaveNome } from "../lib/import";
import {
  normalizePhone,
  isValidPhone,
  formatPhone,
  isPlaceholderPhone,
  nextPlaceholderPhone,
} from "../lib/phone";
import { readFileSync, existsSync } from "node:fs";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

function main() {
  console.log("\n1. Leitura do CSV");
  {
    const linhas = parseCsv('nome,telefone\n"Silva, Jr","(41) 99999-0000"');
    ok("aspas protegem a vírgula do nome", linhas[1][0] === "Silva, Jr", JSON.stringify(linhas[1]));
    ok("duas colunas, não três", linhas[1].length === 2, String(linhas[1].length));

    const pv = parseCsv("nome;telefone\nAna;(41) 99999-0000");
    ok("detecta ponto e vírgula (Excel pt-BR)", pv[1][0] === "Ana" && pv[1].length === 2);

    const tab = parseCsv("nome\ttelefone\nAna\t41999990000");
    ok("detecta tab", tab[1][0] === "Ana" && tab[1].length === 2);

    const bom = parseCsv('﻿"nome","telefone"\r\n"Ana","41999990000"\r\n');
    ok("engole BOM e CRLF", bom[0][0] === "nome" && bom.length === 2, JSON.stringify(bom[0]));

    const aspas = parseCsv('nome,obs\nAna,"disse ""oi"" ontem"');
    ok('aspas duplicadas viram uma', aspas[1][1] === 'disse "oi" ontem', aspas[1][1]);

    const vazias = parseCsv("nome,telefone\n\n\nAna,41999990000\n\n");
    ok("linhas em branco somem", vazias.length === 2, String(vazias.length));
  }

  console.log("\n2. Colunas em qualquer ordem");
  {
    const a = mapHeader(["ID", "Nome", "CPF", "Email", "Telefone", "Cidade"]);
    ok("acha Nome/Telefone/Email fora de ordem", a.mapa.nome === 1 && a.mapa.telefone === 4 && a.mapa.email === 3, JSON.stringify(a.mapa));
    ok("reconhece que há cabeçalho", a.temCabecalho);

    const b = mapHeader(["nome", "celular", "e-mail"]);
    ok("aceita 'celular' e 'e-mail'", b.mapa.telefone === 1 && b.mapa.email === 2, JSON.stringify(b.mapa));

    const c = mapHeader(["Cliente", "WhatsApp"]);
    ok("aceita 'Cliente' e 'WhatsApp'", c.mapa.nome === 0 && c.mapa.telefone === 1, JSON.stringify(c.mapa));

    const d = mapHeader(["João Silva", "41999990000", "joao@x.com"]);
    ok("sem cabeçalho cai na ordem documentada", !d.temCabecalho && d.mapa.nome === 0 && d.mapa.telefone === 1);

    // "Data de cadastro" não pode roubar a coluna de nome.
    const e = mapHeader(["Nome", "Data de cadastro", "Telefone"]);
    ok("coluna de data não vira nome", e.mapa.nome === 0 && e.mapa.telefone === 2, JSON.stringify(e.mapa));
  }

  console.log("\n3. Telefone");
  {
    ok("+55 na frente é cortado", normalizePhone("(55) 4199287-0977") === "41992870977");
    ok("+55 com 12 dígitos também", normalizePhone("(55) 419990-1036") === "4199901036");
    ok("DDD 55 de 11 dígitos NÃO é cortado", normalizePhone("(55) 99999-8888") === "55999998888");
    ok("DDD 55 de 10 dígitos NÃO é cortado", normalizePhone("(55) 3999-8888") === "5539998888");
    ok("13 dígitos com 55 passa a valer", isValidPhone("(55) 4199287-0977"));
    ok("9 dígitos continua inválido", !isValidPhone("(41) 991-4468"));
    ok("vazio é inválido", !isValidPhone(""));
  }

  console.log("\n4. Telefone compartilhado e repetido");
  {
    const csv = [
      "nome,telefone",
      "Ana Paula,(41) 99999-0001",
      "Ana Paula Souza,(41) 99999-0001",
      "Bruno Lima,(41) 99999-0001",
      "Carla,(41) 99999-0002",
    ].join("\n");
    const r = planClientImport(csv);
    ok("plano montado", r.ok === true);
    if (r.ok) {
      ok("um cadastro por telefone", r.candidatos.length === 2, String(r.candidatos.length));
      ok("fica a primeira ocorrência", r.candidatos[0].name === "Ana Paula", r.candidatos[0].name);
      ok("nome parecido é 'repetido'", r.skipped.some((s) => /Ana Paula Souza.*repetido/.test(s)), r.skipped.join(" | "));
      ok("nome diferente é 'divide o telefone'", r.skipped.some((s) => /Bruno Lima.*divide o telefone/.test(s)), r.skipped.join(" | "));
    }

    ok("semelhante: prefixo conta", semelhante("Ana Paula", "Ana Paula Souza"));
    ok("semelhante: acento não atrapalha", semelhante("João", "joao"));
    ok("semelhante: nomes distintos não", !semelhante("Ana", "Bruno"));
  }

  console.log("\n5. Linhas que ficam de fora");
  {
    const r = planClientImport(
      ["nome,telefone,email", "Sem Fone,,x@y.com", ",41999990000,", "Curto,(41) 991-4468,", "Bom,(41) 99999-0000,BOM@X.COM"].join("\n")
    );
    ok("plano montado", r.ok === true);
    if (r.ok) {
      const comFone = r.candidatos.filter((c) => !c.pendente);
      ok("só um tem telefone de verdade", comFone.length === 1 && comFone[0].name === "Bom");
      ok("e-mail vira minúsculo", comFone[0].email === "bom@x.com", String(comFone[0].email));
      ok("sem telefone e telefone curto entram como pendentes", r.candidatos.filter((c) => c.pendente).length === 2);
      ok("relata sem telefone", r.skipped.some((s) => /Sem Fone.*sem telefone/.test(s)));
      ok("relata sem nome", r.skipped.some((s) => /sem nome/.test(s)));
      ok("relata telefone incompleto", r.skipped.some((s) => /Curto.*incompleto/.test(s)));
      ok("linha sem nome nenhum fica de fora de verdade", !r.candidatos.some((c) => c.name === ""));
      ok("aponta o número da linha", r.skipped.every((s) => /^Linha \d+:/.test(s)), r.skipped.join(" | "));
    }
  }

  console.log("\n5b. Sem telefone entra para completar depois");
  {
    const r = planClientImport(
      ["nome,telefone", "Sem Fone,", "Curto,(41) 991-4468", "Bom,(41) 99999-0000"].join("\n")
    );
    ok("plano montado", r.ok === true);
    if (r.ok) {
      ok("os três entram", r.candidatos.length === 3, String(r.candidatos.length));
      const pend = r.candidatos.filter((c) => c.pendente);
      ok("dois marcados como pendentes", pend.length === 2, String(pend.length));
      ok("pendente vai sem telefone", pend.every((c) => c.phone === ""));
      ok("o válido não é pendente", r.candidatos.some((c) => c.name === "Bom" && !c.pendente));
      ok("o aviso diz que entrou", r.skipped.every((x) => /completar depois/.test(x)), r.skipped.join(" | "));
    }
  }

  console.log("\n5c. Número reservado não vale como telefone de verdade");
  {
    ok("reconhece o reservado", isPlaceholderPhone("00000000001"));
    ok("número comum não é reservado", !isPlaceholderPhone("41999990000"));
    ok("reservado nunca é válido para agendar/entrar", !isValidPhone("00000000001"));
    ok("aparece como 'Sem telefone'", formatPhone("00000000001") === "Sem telefone");
    ok("numera a partir do que já existe", nextPlaceholderPhone(["00000000001", "00000000007"]) === "00000000008");
    ok("primeiro da base", nextPlaceholderPhone([]) === "00000000001");
    ok("ignora telefones reais ao numerar", nextPlaceholderPhone(["41999990000"]) === "00000000001");

    // Um reservado que venha no arquivo não pode virar cadastro "real".
    const r = planClientImport("nome,telefone\nEsperto,00000000001\nReal,(41) 99999-0000");
    ok("reservado vindo no arquivo vira pendente", r.ok && r.candidatos.some((c) => c.name === "Esperto" && c.pendente === true), JSON.stringify(r).slice(0, 140));
  }

  console.log("\n5b. Mesma pessoa sem telefone duas vezes");
  {
    const r = planClientImport(
      "nome,telefone\nReal,(41) 99999-0000\nJoão da Silva,\nJOAO DA SILVA ,\nOutro Nome,"
    );
    ok("plano montado", r.ok === true);
    if (r.ok) {
      const pend = r.candidatos.filter((c) => c.pendente);
      ok(
        "linha repetida sem telefone não vira dois cadastros",
        pend.length === 2,
        pend.map((c) => c.name).join(" | ")
      );
      ok(
        "avisa que a repetida ficou de fora",
        r.skipped.some((m) => /repetido sem telefone/i.test(m)),
        r.skipped.join(" | ")
      );
    }
    ok("chaveNome ignora acento e caixa", chaveNome("João  DA Silva ") === chaveNome("joao da silva"));
    ok("chaveNome não junta nomes diferentes", chaveNome("Ana") !== chaveNome("Ana Paula"));
  }

  console.log("\n6. Erros de arquivo");
  {
    const vazio = planClientImport("");
    ok("arquivo vazio", !vazio.ok && /vazio/i.test(vazio.error));
    const soCabecalho = planClientImport("nome,telefone");
    ok("só cabeçalho", !soCabecalho.ok && /cabeçalho/i.test(soCabecalho.error));
    const semColunas = planClientImport("cpf,cidade\n123,Curitiba\n456,Pinhais");
    ok("arquivo sem nenhum telefone válido é recusado", !semColunas.ok && /telefone válido/i.test(semColunas.error), JSON.stringify(semColunas));
    const semCabecalho = planClientImport("cpf,cidade\n123,Curitiba");
    ok("não cria cadastro vazio a partir de arquivo errado", !semCabecalho.ok);
  }

  // O arquivo real do cliente, quando estiver por perto.
  const real = process.env.CSV_REAL;
  if (real && existsSync(real)) {
    console.log("\n7. Arquivo real do cliente");
    const r = planClientImport(readFileSync(real, "utf8"));
    ok("plano montado", r.ok === true);
    if (r.ok) {
      console.log(`     ${r.candidatos.length} cadastros · ${r.skipped.length} linhas de fora`);
      const comFone = r.candidatos.filter((c) => !c.pendente);
      console.log(`     ${comFone.length} com telefone · ${r.candidatos.length - comFone.length} para completar`);
      ok("todos com telefone de 10 ou 11 dígitos", comFone.every((c) => [10, 11].includes(c.phone.length)));
      ok("nenhum telefone repetido", new Set(comFone.map((c) => c.phone)).size === comFone.length);
      const mails = comFone.map((c) => c.email).filter(Boolean);
      ok("nenhum e-mail repetido", new Set(mails).size === mails.length);
      ok("nome nunca vazio", r.candidatos.every((c) => c.name.length > 0));
    }
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  process.exit(f === 0 ? 0 : 1);
}

main();
