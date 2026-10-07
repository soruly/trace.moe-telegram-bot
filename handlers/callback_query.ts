import type { CallbackQuery } from "@effect-ak/tg-bot-api";

import { callbackQueryHandler } from "../src/handlers.ts";
import { ensureBotName } from "../src/telegram.ts";

export default async function (callbackQuery: CallbackQuery) {
  await ensureBotName();
  await callbackQueryHandler(callbackQuery);
}
