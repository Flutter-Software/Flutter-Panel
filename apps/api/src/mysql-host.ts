import mysql from "mysql2/promise";
import { FlutterError } from "@flutter-software/shared";

export type MysqlTarget = {
  host: string;
  port: number;
  username: string;
  password: string;
};

function ident(value: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw FlutterError.validation("Invalid MySQL identifier");
  }
  return `\`${value}\``;
}

function hostLiteral(value: string) {
  if (!value || value.length > 255 || value.includes("'") || value.includes("\\")) {
    throw FlutterError.validation("Invalid remote host");
  }
  return value;
}

function mysqlMessage(error: unknown) {
  if (error && typeof error === "object" && "sqlMessage" in error && typeof error.sqlMessage === "string") {
    return error.sqlMessage;
  }
  return error instanceof Error ? error.message : "MySQL request failed";
}

export async function withMysql<T>(target: MysqlTarget, run: (conn: mysql.Connection) => Promise<T>) {
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: target.username,
      password: target.password,
      connectTimeout: 8_000,
    });
  } catch (error) {
    throw FlutterError.unavailable(`Could not reach the database host: ${mysqlMessage(error)}`);
  }
  try {
    return await run(conn);
  } catch (error) {
    if (error instanceof FlutterError) throw error;
    throw FlutterError.unavailable(mysqlMessage(error));
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export async function pingMysql(target: MysqlTarget) {
  await withMysql(target, async (conn) => {
    await conn.query("SELECT 1");
  });
}

export async function createMysqlDatabase(
  target: MysqlTarget,
  spec: { database: string; username: string; password: string; remote: string },
) {
  const db = ident(spec.database);
  const user = ident(spec.username);
  const remote = hostLiteral(spec.remote);
  await withMysql(target, async (conn) => {
    await conn.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`CREATE USER ${user}@? IDENTIFIED BY ?`, [remote, spec.password]);
    await conn.query(`GRANT ALL PRIVILEGES ON ${db}.* TO ${user}@?`, [remote]);
    await conn.query("FLUSH PRIVILEGES");
  });
}

export async function rotateMysqlPassword(
  target: MysqlTarget,
  spec: { username: string; remote: string; password: string },
) {
  const user = ident(spec.username);
  const remote = hostLiteral(spec.remote);
  await withMysql(target, async (conn) => {
    try {
      await conn.query(`ALTER USER ${user}@? IDENTIFIED BY ?`, [remote, spec.password]);
    } catch {
      await conn.query(`SET PASSWORD FOR ${user}@? = PASSWORD(?)`, [remote, spec.password]);
    }
    await conn.query("FLUSH PRIVILEGES");
  });
}

export async function dropMysqlDatabase(
  target: MysqlTarget,
  spec: { database: string; username: string; remote: string },
) {
  const db = ident(spec.database);
  const user = ident(spec.username);
  const remote = hostLiteral(spec.remote);
  await withMysql(target, async (conn) => {
    await conn.query(`DROP USER IF EXISTS ${user}@?`, [remote]);
    await conn.query(`DROP DATABASE IF EXISTS ${db}`);
    await conn.query("FLUSH PRIVILEGES");
  });
}
