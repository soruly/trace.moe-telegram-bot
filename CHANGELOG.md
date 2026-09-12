# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-09-12

### Added

- Multi-language localization support (`en`, `ja`, `zh-TW`, `zh-CN`).
- User language preference selection via `/lang` and `/setlang` commands.
- Search options (`mute`, `nocrop`, `skip`) via text keywords and captions.
- Inline keyboard button for viewing low similarity search results.
- Native SQLite database (`node:sqlite`) for 30-day user search logs and language preferences.
- Integration of `oxlint` and `oxfmt` for code linting and formatting.

### Changed

- Migrated runtime to Node.js >= 24 with native direct TypeScript execution (`server.ts`).
- Rewrote HTTP webhook server using native Node.js HTTP server instead of Express.
- Replaced PostgreSQL database with native `node:sqlite`.
- Replaced Prettier and ESLint with Oxfmt and Oxlint.
