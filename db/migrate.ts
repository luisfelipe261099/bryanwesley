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

async function main() {
  const conn = await mysql.createConnection(connOptions(url!));

  await conn.query(`CREATE TABLE IF NOT EXISTS __migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);

  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT name FROM __migrations"
  );
  const applied = new Set(rows.map((r) => r.name as string));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8");
    // drizzle-kit separa os statements com "--> statement-breakpoint"
    const statements = body
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`▶ aplicando ${file} (${statements.length} statement(s))`);
    for (const statement of statements) {
      await conn.query(statement);
    }
    await conn.query("INSERT INTO __migrations (name) VALUES (?)", [file]);
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
