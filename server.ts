import crypto from "node:crypto";
import http from "node:http";

import type { Message } from "@effect-ak/tg-bot-api";

import { PORT, ADDR, TELEGRAM_TOKEN, TELEGRAM_WEBHOOK, TELEGRAM_API } from "./src/config.ts";
import { privateMessageHandler, groupMessageHandler, guestMessageHandler } from "./src/handlers.ts";
import { botName, setBotName, setMessageReaction, messageIsMentioningBot } from "./src/telegram.ts";

console.log(`WEBHOOK: ${TELEGRAM_WEBHOOK}`);
console.log(`Use trace.moe API: ${process.env.TRACE_MOE_KEY ? "with" : "without"} API Key`);

console.log("Setting Telegram webhook...");

const SECRET_TOKEN = crypto.randomBytes(32).toString("hex");
await fetch(
  `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setWebhook?url=${TELEGRAM_WEBHOOK}&max_connections=100&allowed_updates=%5B%22message%22%2C%22edited_message%22%2C%22guest_message%22%5D&secret_token=${SECRET_TOKEN}`,
)
  .then((e) => e.json())
  .then((e) => {
    console.log(e);
  });

fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getMe`)
  .then((e) => e.json())
  .then((e) => {
    console.log(e);
    const fetchedBotName = e.result?.username ?? "";
    setBotName(fetchedBotName);
  })
  .catch((err) => {
    console.error("Failed to get bot info:", err);
  });

const getBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      req.destroy();
      throw new Error("Request entity too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
};

const SECRET_TOKEN_BUFFER = Buffer.from(SECRET_TOKEN);
const server = http.createServer({ keepAliveTimeout: 60000 }, async (req, res) => {
  if (req.method === "POST") {
    const clientSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (
      typeof clientSecret !== "string" ||
      clientSecret.length !== SECRET_TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(clientSecret), SECRET_TOKEN_BUFFER)
    ) {
      return res.writeHead(403).end();
    }
    try {
      const request = JSON.parse(await getBody(req));
      const message: Message = request.message ?? request.edited_message ?? request.guest_message;
      if (message?.guest_query_id && messageIsMentioningBot(message)) {
        await guestMessageHandler(message);
      } else if (message?.chat?.type === "private") {
        await privateMessageHandler(message);
        setMessageReaction({
          chat_id: message.chat.id,
          message_id: message.message_id,
          reaction: [],
        });
      } else if (message?.chat?.type === "group" || message?.chat?.type === "supergroup") {
        if (messageIsMentioningBot(message)) {
          await groupMessageHandler(message);
          setMessageReaction({
            chat_id: message.chat.id,
            message_id: message.message_id,
            reaction: [],
          });
        }
      }
      return res.writeHead(204).end();
    } catch (e) {
      console.error(e);
      return res.writeHead(400).end();
    }
  }
  if (req.method === "GET") {
    return res
      .writeHead(200, {
        "Content-Type": "text/html",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
        "X-Content-Type-Options": "nosniff",
      })
      .end(`<meta http-equiv="Refresh" content="0; URL=https://t.me/${botName ?? ""}">`);
  }
  return res.writeHead(400).end();
});

server.on("error", (e) => console.error(e));

server.listen(Number(PORT), ADDR, () => console.log("server listening on", server.address()));
