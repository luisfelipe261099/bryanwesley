// Aplica as migrações. Roda no build da Vercel e localmente.
import "./load-env";
import postgres from "postgres";
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
const sql = postgres(url, { max: 1, prepare: false });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS __migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM __migrations`).map(
      (r) => r.name
    )
  );

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
      await sql.unsafe(statement);
    }
    await sql`INSERT INTO __migrations (name) VALUES (${file})`;
    console.log(`✓ ${file}`);
  }

  console.log("Migrações em dia.");

  // Primeiro deploy: sem catálogo a vitrine fica vazia e ninguém consegue
  // entrar. O seed é idempotente, então só roda quando não há serviços.
  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM services`;
  await sql.end();
  if (Number(n) === 0) {
    console.log("Catálogo vazio — rodando o seed inicial.");
    const { runSeed } = await import("./seed");
    await runSeed();
  }
}

main().catch(async (err) => {
  console.error("Falha na migração:", err);
  await sql.end();
  process.exit(1);
});
