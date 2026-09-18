// Aplica as migrações. Roda no build da Vercel e localmente.
import "./load-env";
import mysql from "mysql2/promise";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida — migração ignorada.");
  process.exit(1);
}

// Roda no build: melhor quebrar o deploy aqui do que servir 500 em toda
// rota protegida por falta da chave da sessão.
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 24) {
  console.error(
    "AUTH_SECRET ausente ou curta (mínimo 24 caracteres). Gere com:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
  process.exit(1);
}

const dir = join(process.cwd(), "db", "migrations");

function connOptions(connectionString: string): mysql.ConnectionOptions {
  const u = new URL(connectionString);
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  const sslOff = process.env.DATABASE_SSL === "false" || local;
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: sslOff ? undefined : { minVersion: "TLSv1.2", rejectUnauthorized: true },
    timezone: "Z",
    multipleStatements: false,
  };
}

/**
 * Conecta insistindo um pouco.
 *
 * O TiDB Serverless hiberna quando fica sem uso: a primeira conexão
 * depois disso pode estourar o tempo enquanto o cluster acorda. Sem
 * insistir, um deploy falha por causa de um cluster adormecido e o
 * código novo simplesmente não sobe.
 */
async function conectar(opts: mysql.ConnectionOptions, tentativas = 5) {
  let ultima: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await mysql.createConnection({ connectTimeout: 20000, ...opts });
    } catch (e) {
      ultima = e;
      const code = (e as { code?: string }).code;
      // Erro de credencial ou de nome não melhora esperando.
      if (code && !["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "PROTOCOL_CONNECTION_LOST"].includes(code)) {
        throw e;
      }
      const espera = 2000 * 2 ** i;
      console.log(`Banco não respondeu (${code ?? "erro"}); nova tentativa em ${espera / 1000}s`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultima;
}

/**
 * Garante que o schema exista antes de migrar.
 *
 * Num cluster novo do TiDB só vem o banco `test`: apontar a
 * DATABASE_URL para um schema que ainda não existe derrubaria o build
 * no primeiro deploy. Conecta sem escolher banco, cria se faltar e sai.
 */
async function ensureDatabase() {
  const opts = connOptions(url!);
  const name = opts.database;
  if (!name) throw new Error("DATABASE_URL sem nome de banco.");
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Nome de banco inválido na DATABASE_URL: ${name}`);
  }
  const conn = await conectar({ ...opts, database: undefined });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${name}\` ` +
      "CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
  );
  await conn.end();
}

async function main() {
  await ensureDatabase();
  const conn = await conectar(connOptions(url!));

  await conn.query(`CREATE TABLE IF NOT EXISTS __migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);

  // DDL não é transacional no MySQL/TiDB: uma migração que quebrasse no 3º
  // statement deixava os dois primeiros aplicados e nada registrado — e o
  // build seguinte tropeçava para sempre em "coluna já existe". Cada
  // statement concluído é anotado, e a retomada começa do próximo.
  const [cols] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '__migrations'
        AND COLUMN_NAME = 'statements_done'`
  );
  if (cols.length === 0) {
    await conn.query(
      "ALTER TABLE __migrations ADD statements_done INT NOT NULL DEFAULT 0, ADD done TINYINT(1) NOT NULL DEFAULT 1"
    );
  }

  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT name, statements_done, done FROM __migrations"
  );
  const state = new Map(
    rows.map((r) => [
      r.name as string,
      { done: Boolean(r.done), at: Number(r.statements_done) },
    ])
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const st = state.get(file);
    if (st?.done) continue;
    const body = readFileSync(join(dir, file), "utf8");
    // drizzle-kit separa os statements com "--> statement-breakpoint"
    const statements = body
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    const inicio = st?.at ?? 0;
    console.log(
      `▶ aplicando ${file} (${statements.length} statement(s)${
        inicio ? `, retomando do ${inicio + 1}º` : ""
      })`
    );
    if (!st) {
      await conn.query(
        "INSERT INTO __migrations (name, statements_done, done) VALUES (?, 0, 0)",
        [file]
      );
    }
    for (let i = inicio; i < statements.length; i++) {
      try {
        await conn.query(statements[i]);
      } catch (e) {
        // O progresso é anotado DEPOIS do DDL: se a queda foi entre os
        // dois, o statement retomado já está aplicado e o banco responde
        // "já existe". Só o primeiro da retomada pode estar nessa
        // situação — nos demais o erro é erro de verdade.
        const code = (e as { code?: string }).code ?? "";
        const jaAplicado =
          i === inicio &&
          st !== undefined &&
          [
            "ER_DUP_FIELDNAME",
            "ER_DUP_KEYNAME",
            "ER_TABLE_EXISTS_ERROR",
            "ER_DUP_ENTRY",
            "ER_MULTIPLE_PRI_KEY",
            "ER_CANT_DROP_FIELD_OR_KEY",
          ].includes(code);
        if (!jaAplicado) throw e;
        console.log(
          `  ↷ ${i + 1}º statement já estava aplicado (${code}) — seguindo`
        );
      }
      await conn.query(
        "UPDATE __migrations SET statements_done = ? WHERE name = ?",
        [i + 1, file]
      );
    }
    await conn.query("UPDATE __migrations SET done = 1 WHERE name = ?", [file]);
    console.log(`✓ ${file}`);
  }

  console.log("Migrações em dia.");

  // Primeiro deploy: sem catálogo a vitrine fica vazia e ninguém consegue
  // entrar. O seed é idempotente, então só roda quando não há serviços.
  const [[{ n }]] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM services"
  );
  await conn.end();
  if (Number(n) === 0) {
    console.log("Catálogo vazio — rodando o seed inicial.");
    const { runSeed } = await import("./seed");
    await runSeed();
  }
}

main().catch((err) => {
  console.error("Falha na migração:", err);
  process.exit(1);
});
