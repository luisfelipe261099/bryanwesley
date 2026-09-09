import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL não definida. Configure a variável de ambiente com a string de conexão do Postgres."
  );
}

// Em serverless cada invocação pode criar um cliente novo; o cache global
// evita estourar o limite de conexões durante o hot-reload do dev.
const globalForDb = globalThis as unknown as {
  __bwSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__bwSql ??
  postgres(url, {
    max: 1, // pooling é feito pelo provedor (Neon/Supabase)
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // compatível com pgbouncer em modo transaction
  });

if (process.env.NODE_ENV !== "production") globalForDb.__bwSql = sql;

export const db = drizzle(sql, { schema });
export { sql };
export * from "./schema";
