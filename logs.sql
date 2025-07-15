CREATE TABLE IF NOT EXISTS logs_bot (
  created timestamp NOT NULL DEFAULT NOW(),
  user_id bigint NOT NULL,
  code smallint NOT NULL
);

CREATE INDEX ON logs_bot (created);

CREATE INDEX ON logs_bot (user_id);

CREATE INDEX ON logs_bot (code);