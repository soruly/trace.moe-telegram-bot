# AGENTS.md

## Project Overview

**trace.moe-telegram-bot** is the official Telegram Bot for [trace.moe](https://trace.moe) (anime scene search engine). It allows users and groups to identify anime, episodes, and timestamps by sending images, GIFs, or videos, and provides animated video previews.

### Core Tech Stack

- **Runtime**: Node.js >= 24 (executes `.ts` files directly via native TypeScript support)
- **Protocol / API**: Telegram Bot API via `@effect-ak/tg-bot-api` (Webhook server)
- **Language**: TypeScript
- **Database**: SQLite (`node:sqlite` DatabaseSync)
- **Code Quality & Formatting**: `oxlint`, `oxfmt`

---

## Directory Structure

```
├── server.ts                    # Main Telegram bot webhook server entry point
├── package.json                 # Project dependencies, scripts, and engines
├── tsconfig.json                # TypeScript compiler configuration (erasableSyntaxOnly)
├── .oxfmtrc.json                # oxfmt code formatter configuration
├── Dockerfile                   # Production container build definition
├── README.md                    # User and deployment documentation
├── CHANGELOG.md                 # Project version history
├── LICENSE                      # MIT License
├── SECURITY.md                  # Security policy
├── CODE_OF_CONDUCT.md           # Contributor Covenant Code of Conduct
├── .env.example                 # Environment configuration template
└── src/                         # Server internal modules
    ├── config.ts                # Environment variable parsing and validation
    ├── db.ts                    # SQLite schema, user preference, and log persistence
    ├── handlers.ts              # Handlers for private/group messages and callback queries
    ├── i18n.ts                  # Localization dictionaries (en, ja, zh-TW, zh-CN)
    ├── telegram.ts              # Telegram Bot API helper methods and bot command registration
    ├── tracemoe.ts              # trace.moe HTTP search API client
    └── utils.ts                 # MarkdownV2 escaping, duration formatting, and git revision helper
```

---

## Command Reference

| Action                  | Command              | Notes                                             |
| :---------------------- | :------------------- | :------------------------------------------------ |
| **Start Server**        | `npm start`          | Starts bot server (`node --dns-result-order=...`) |
| **Format Code**         | `npm run format`     | Formats all project files in-place using `oxfmt`  |
| **Lint**                | `npm run lint`       | Checks code using `oxlint`                        |
| **Lint & Fix**          | `npm run lint:fix`   | Automatically fixes lint issues with `oxlint`     |
| **Test & Verify**       | `npm test`           | Runs `oxfmt --check` and `oxlint`                 |
| **Direct TS Execution** | `node <filepath>.ts` | Runs any `.ts` script directly in Node >= 24      |

---

## Coding & Operational Guidelines

### 1. Direct TypeScript Execution

- TypeScript files are executed directly by Node.js >= 24 without compilation or bundling steps.
- All imports between local TypeScript files must use explicit `.ts` extensions (e.g. `import { PORT } from "./src/config.ts";`).

### 2. Environment Variables & Configuration

- `src/config.ts` reads configuration using Node's native `process.loadEnvFile()`.
- Required environment variables: `TELEGRAM_TOKEN` and `TELEGRAM_WEBHOOK`.
- Optional environment variables: `PORT` (default: 3000), `ADDR` (default: "0.0.0.0"), `TRACE_MOE_KEY`, `FILTER_ADULT` (default: true).

### 3. Database Operations

- The application uses Node's built-in SQLite module (`node:sqlite`) with synchronous database operations (`DatabaseSync`) targeting `.db`.
- User language preferences are stored in the `users` table, and search queries within the last 30 days are logged in the `logs` table.

### 4. Telegram MarkdownV2 Formatting

- Messages formatted with `parse_mode: "MarkdownV2"` must escape reserved characters using `escapeMarkdownV2()` from `src/utils.ts`.
- Monospaced code blocks must escape backslashes and backticks using `escapeCode()`.

### 5. Verification Workflow

Before committing changes, ensure formatting and linting pass:

```bash
npm test
```
