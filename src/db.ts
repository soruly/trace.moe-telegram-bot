import sqlite from "node:sqlite";

export const database = new sqlite.DatabaseSync(".db");

database.exec(`
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
  database.exec("ALTER TABLE logs ADD COLUMN lang_code TEXT");
} catch {}

database.exec(`
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created);
CREATE INDEX IF NOT EXISTS idx_logs_user_id  ON logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_code ON logs (code);
CREATE INDEX IF NOT EXISTS idx_logs_lang_code ON logs (lang_code);
CREATE INDEX IF NOT EXISTS idx_logs_created_user_id_code ON logs (created, user_id, code);
`);

database.exec("DELETE FROM logs WHERE created < datetime('now', '-30 days')");
database.exec("VACUUM");

export const select = database.prepare(
  "SELECT COUNT(*) AS count FROM logs WHERE user_id = $user_id AND code = 200 AND created > datetime('now', '-30 days')",
);

export const insert = database.prepare(
  "INSERT INTO logs (user_id, code, lang_code) VALUES ($user_id, $code, $lang_code)",
);

export const selectUser = database.prepare("SELECT lang_code FROM users WHERE id = $id");

export const upsertUser = database.prepare(`
  INSERT INTO users (id, lang_code) VALUES ($id, $lang_code)
  ON CONFLICT(id) DO UPDATE SET lang_code = excluded.lang_code
`);

export const getUserLang = (userId: number): string | null => {
  if (!userId) return null;
  const row = selectUser.get({ $id: userId }) as { lang_code: string | null } | undefined;
  return row?.lang_code ?? null;
};

export const setUserLang = (userId: number, langCode: string | null): void => {
  if (!userId) return;
  upsertUser.run({ $id: userId, $lang_code: langCode });
};
