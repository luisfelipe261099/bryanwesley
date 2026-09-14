import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL não definida. Configure a string de conexão do MySQL/TiDB."
  );
}

/**
 * TiDB Cloud exige TLS. Ligamos por padrão e só desligamos para
 * localhost ou quando DATABASE_SSL=false (ex.: MariaDB de teste).
 */
function poolConfig(connectionString: string): mysql.PoolOptions {
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
    // Datas trafegam em UTC: o que gravamos é o que lemos, em qualquer fuso.
    timezone: "Z",
    dateStrings: false,
    supportBigNumbers: true,
    // Na Vercel uma instância atende várias requisições ao mesmo tempo
    // (Fluid compute): com 1 conexão elas fariam fila no pool. Poucas
    // bastam — cada instância vive pouco e o TiDB aceita bem mais.
    connectionLimit: process.env.VERCEL ? 4 : 5,
    waitForConnections: true,
    enableKeepAlive: true,
  };
}

// Cache global evita estourar conexões no hot-reload do dev.
const globalForDb = globalThis as unknown as { __bwPool?: mysql.Pool };
const pool = globalForDb.__bwPool ?? mysql.createPool(poolConfig(url));
if (process.env.NODE_ENV !== "production") globalForDb.__bwPool = pool;

// Modo "planetscale": as consultas relacionais (db.query.*.with) não usam
// LEFT JOIN LATERAL, que TiDB e MariaDB não suportam. Vale para MySQL também.
export const db = drizzle(pool, { schema, mode: "planetscale" });
export { pool };
export * from "./schema";
