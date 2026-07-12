import sqlite from "node:sqlite";

export const database = new sqlite.DatabaseSync(".db");

database.exec(`
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER NOT NULL,
  code INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created);
CREATE INDEX IF NOT EXISTS idx_logs_user_id  ON logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_code ON logs (code);
CREATE INDEX IF NOT EXISTS idx_logs_created_user_id_code ON logs (created, user_id, code);
`);

export const select = database.prepare(
  "SELECT COUNT(*) AS count FROM logs WHERE user_id = $user_id AND code = 200 AND created > datetime('now', '-30 days')",
);

export const insert = database.prepare("INSERT INTO logs (user_id, code) VALUES ($user_id, $code)");
