export default `
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

CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_code ON logs (code);
CREATE INDEX IF NOT EXISTS idx_logs_lang_code ON logs (lang_code);
CREATE INDEX IF NOT EXISTS idx_logs_created_user_id_code ON logs (created, user_id, code);
`;
