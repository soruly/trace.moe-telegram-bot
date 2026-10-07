import type { Message } from "@effect-ak/tg-bot-api";

import { messageHandler } from "../src/handlers.ts";
import { ensureBotName } from "../src/telegram.ts";

export default async function (message: Message) {
  await ensureBotName();
  await messageHandler(message);
}
