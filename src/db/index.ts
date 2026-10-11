import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsMysqlPool?: mysql.Pool;
};

function createPoolFromUrl(url: string) {
  const parsed = new URL(url);
  return mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: parsed.username,
    password: parsed.password,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    connectionLimit: 10,
  });
}

export const pool =
  globalForDb.__arenaNextJsMysqlPool ?? createPoolFromUrl(databaseUrl);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsMysqlPool = pool;
}

export const db = drizzle(pool);
