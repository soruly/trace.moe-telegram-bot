import sqlite from "node:sqlite";

type ServerlessDb = {
  prepare: (sql: string) => {
    get: (...args: any[]) => any;
    all?: (...args: any[]) => any[];
    run: (...args: any[]) => any;
  };
  exec?: (sql: string) => void;
};

let serverlessDb: ServerlessDb | null = null;
try {
  // @ts-expect-error Telegram Serverless provides 'sdk' module at runtime
  const sdk = await import("sdk").catch(() => null);
  if (sdk?.db) {
    serverlessDb = sdk.db;
  }
} catch {}

if (!serverlessDb && typeof (globalThis as any).db !== "undefined") {
  serverlessDb = (globalThis as any).db;
}

let sqliteDb: sqlite.DatabaseSync | null = null;
if (!serverlessDb) {
  try {
    sqliteDb = new sqlite.DatabaseSync(".db");
    sqliteDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  lang_code TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER NOT NULL,
  code INTEGER NOT NULL,
  lang_code TEXT
);
`);
    try {
      sqliteDb.exec("ALTER TABLE logs ADD COLUMN lang_code TEXT");
    } catch {}

    sqliteDb.exec(`
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created);
CREATE INDEX IF NOT EXISTS idx_logs_user_id  ON logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_code ON logs (code);
CREATE INDEX IF NOT EXISTS idx_logs_lang_code ON logs (lang_code);
CREATE INDEX IF NOT EXISTS idx_logs_created_user_id_code ON logs (created, user_id, code);
`);

    sqliteDb.exec("DELETE FROM logs WHERE created < datetime('now', '-30 days')");
    sqliteDb.exec("VACUUM");
  } catch (err) {
    console.error("Failed to initialize SQLite database:", err);
  }
}

export const database = sqliteDb!;

export const select = sqliteDb?.prepare(
  "SELECT COUNT(*) AS count FROM logs WHERE user_id = $user_id AND code = 200 AND created > datetime('now', '-30 days')",
)!;

export const insert = sqliteDb?.prepare(
  "INSERT INTO logs (user_id, code, lang_code) VALUES ($user_id, $code, $lang_code)",
)!;

export const selectUser = sqliteDb?.prepare("SELECT lang_code FROM users WHERE id = $id")!;

export const upsertUser = sqliteDb?.prepare(`
  INSERT INTO users (id, lang_code) VALUES ($id, $lang_code)
  ON CONFLICT(id) DO UPDATE SET lang_code = excluded.lang_code
`)!;

export const getUserLang = (userId: number): string | null => {
  if (!userId) return null;
  if (serverlessDb) {
    try {
      const row = serverlessDb.prepare("SELECT lang_code FROM users WHERE id = ?").get(userId) as
        | { lang_code: string | null }
        | undefined;
      return row?.lang_code ?? null;
    } catch (err) {
      console.error("Serverless DB getUserLang error:", err);
      return null;
    }
  }
  if (selectUser) {
    const row = selectUser.get({ $id: userId }) as { lang_code: string | null } | undefined;
    return row?.lang_code ?? null;
  }
  return null;
};

export const setUserLang = (userId: number, langCode: string | null): void => {
  if (!userId) return;
  if (serverlessDb) {
    try {
      serverlessDb
        .prepare(
          `
        INSERT INTO users (id, lang_code) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET lang_code = excluded.lang_code
      `,
        )
        .run(userId, langCode);
      return;
    } catch (err) {
      console.error("Serverless DB setUserLang error:", err);
      return;
    }
  }
  if (upsertUser) {
    upsertUser.run({ $id: userId, $lang_code: langCode });
  }
};

export const getSearchCount = (userId: number): number => {
  if (!userId) return 0;
  if (serverlessDb) {
    try {
      const row = serverlessDb
        .prepare(
          "SELECT COUNT(*) AS count FROM logs WHERE user_id = ? AND code = 200 AND created > datetime('now', '-30 days')",
        )
        .get(userId) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch (err) {
      console.error("Serverless DB getSearchCount error:", err);
      return 0;
    }
  }
  if (select) {
    const countObj = select.get({ $user_id: userId }) as { count: number } | undefined;
    return countObj?.count ?? 0;
  }
  return 0;
};

export const saveSearchLog = (userId: number, code: number, langCode?: string | null): void => {
  if (!userId) return;
  if (serverlessDb) {
    try {
      serverlessDb
        .prepare("INSERT INTO logs (user_id, code, lang_code) VALUES (?, ?, ?)")
        .run(userId, code, langCode ?? null);
      return;
    } catch (err) {
      console.error("Serverless DB saveSearchLog error:", err);
      return;
    }
  }
  if (insert) {
    insert.run({
      $user_id: userId,
      $code: code,
      $lang_code: langCode ?? null,
    });
  }
};

