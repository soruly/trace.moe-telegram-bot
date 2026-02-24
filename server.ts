import child_process from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import sqlite from "node:sqlite";
import packageConfig from "./package.json" with { type: "json" };
import type {
  ExternalReplyInfo,
  Message,
  PhotoSize,
  SendChatActionInput,
  SendMessageInput,
  SendVideoInput,
  SetMessageReactionInput,
} from "@effect-ak/tg-bot-api";

process.loadEnvFile();
const {
  PORT = 3000,
  ADDR = "0.0.0.0",
  TELEGRAM_TOKEN,
  TELEGRAM_WEBHOOK,
  TRACE_MOE_KEY,
} = process.env;

const TELEGRAM_API = "https://api.telegram.org";

if (!TELEGRAM_TOKEN || !TELEGRAM_WEBHOOK) {
  console.log("Please configure TELEGRAM_TOKEN and TELEGRAM_WEBHOOK first");
  process.exit();
}

console.log(`WEBHOOK: ${TELEGRAM_WEBHOOK}`);
console.log(`Use trace.moe API: ${TRACE_MOE_KEY ? "with" : "without"} API Key`);

const database = new sqlite.DatabaseSync(".db");

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
const select = database.prepare(
  "SELECT COUNT(*) AS count FROM logs WHERE user_id = $user_id AND code = 200 AND created > datetime('now', '-30 days')",
);
const insert = database.prepare("INSERT INTO logs (user_id, code) VALUES ($user_id, $code)");

console.log("Setting Telegram webhook...");

const SECRET_TOKEN = crypto.randomBytes(32).toString("hex");
await fetch(
  `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setWebhook?url=${TELEGRAM_WEBHOOK}&max_connections=100&secret_token=${SECRET_TOKEN}`,
)
  .then((e) => e.json())
  .then((e) => {
    console.log(e);
  });

let botName = "";
fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getMe`)
  .then((e) => e.json())
  .then((e) => {
    console.log(e);
    botName = e.result?.username;
  });

let REVISION;
try {
  REVISION = child_process.execSync("git rev-parse HEAD").toString().trim();
} catch (e) {
  REVISION = "";
}

const getHelpMessage = async (botName: string, fromId: number) =>
  [
    `Bot Name: ${botName ? `@${botName}` : "(unknown)"}`,
    `Revision: \`${REVISION.substring(0, 7)}\``,
    `Use trace.moe with API Key? ${TRACE_MOE_KEY ? "`true`" : "`false`"}`,
    `Homepage: ${packageConfig.homepage ?? ""}`,
    `Your search count (last 30 days): ${select.get({ $user_id: fromId }).count}`,
  ]
    .filter((e) => e)
    .join("\n");

const escapeMarkdownV2 = (text: string) =>
  text.replace(/([\_\*\[\]\(\)\~\>\#\+\-\=\|\{\}\.\!])/g, "\\$1");

const sendMessage = (payload: SendMessageInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const sendChatAction = (payload: SendChatActionInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const setMessageReaction = (payload: SetMessageReactionInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const sendVideo = (payload: SendVideoInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const formatTime = (duration: number) => {
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration - hours * 3600) / 60);
  const seconds = Math.floor(duration - hours * 3600 - minutes * 60);
  return [hours, minutes, seconds].map((t) => t.toString().padStart(2, "0")).join(":");
};

interface AnilistTitle {
  native: string | null;
  romaji: string | null;
  english: string | null;
  chinese: string | null;
}
interface AnilistInfo {
  id: number;
  idMal: number;
  title: AnilistTitle;
  synonyms: string[];
  isAdult: boolean;
}

interface APISearchResult {
  anilist: AnilistInfo;
  filename: string;
  episode: any;
  duration: number;
  from: number;
  to: number;
  at: number;
  similarity: number;
  video: string;
  image: string;
}

interface SearchResult {
  isAdult?: boolean;
  text: string;
  video?: string;
}

const submitSearch = async (
  imageFileURL: string,
  userId: number,
  opts: SearchOptions,
): Promise<SearchResult> => {
  let trial = 5;
  let response = null;
  while (trial > 0 && (!response || response.status === 503 || response.status === 402)) {
    trial--;
    try {
      response = await fetch(
        `https://api.trace.moe/search?${[
          "anilistInfo=1",
          `url=${encodeURIComponent(imageFileURL)}`,
          opts.noCrop ? "" : "cutBorders=1",
        ].join("&")}`,
        TRACE_MOE_KEY ? { headers: { "x-trace-key": TRACE_MOE_KEY } } : {},
      );
    } catch (e) {
      trial = 0;
      return { text: "`trace.moe API error, please try again later.`" };
    }
    if (!response) {
      trial = 0;
      return { text: "`trace.moe API error, please try again later.`" };
    }
    insert.run({ $user_id: userId, $code: response.status });
    if (response.status === 503 || response.status === 402) {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4000) + 1000));
    } else trial = 0;
  }
  if (!response) {
    return { text: "`trace.moe API error, please try again later.`" };
  }

  if ([502, 503, 504].includes(response.status)) {
    return { text: "`trace.moe server is busy, please try again later.`" };
  }
  if (response.status === 402 || response.status === 429) {
    return { text: "`You exceeded the search limit, please try again later`" };
  }
  if (response.status >= 400) {
    console.error(await response.text());
    return { text: "`trace.moe API error, please try again later.`" };
  }
  const searchResult = await response.json();
  if (response.status >= 400 || searchResult.error) {
    return {
      text: searchResult.error
        ? `\`${searchResult.error.replace(/TELEGRAM_TOKEN/g, "{TELEGRAM_TOKEN}")}\``
        : `Error: HTTP ${response.status}`,
    };
  }
  if (searchResult?.result?.length <= 0) {
    return { text: "Cannot find any results from trace.moe" };
  }
  const { anilist, similarity, filename, from, to, video }: APISearchResult =
    searchResult.result[0];
  const { title: { chinese, english, native, romaji } = {}, isAdult } = anilist ?? {};
  let text = "";
  const titles: string[] = [];
  if (native) titles.push(native);
  if (chinese && !titles.includes(chinese)) titles.push(chinese);
  if (romaji && !titles.includes(romaji)) titles.push(romaji);
  if (english && !titles.includes(english)) titles.push(english);

  text += titles.map((t) => `\`${t}\``).join("\n");
  text += "\n";
  text += `\`${filename.replace(/`/g, "``")}\`\n`;
  if (formatTime(from) === formatTime(to)) {
    text += `\`${formatTime(from)}\`\n`;
  } else {
    text += `\`${formatTime(from)}\` - \`${formatTime(to)}\`\n`;
  }
  text += `\`${(similarity * 100).toFixed(1)}% similarity\`\n`;
  const url = new URL(video);
  const urlSearchParams = new URLSearchParams(url.search);
  urlSearchParams.set("size", "l");
  url.search = urlSearchParams.toString();
  return {
    isAdult,
    text,
    video: url.toString(),
  };
};

const messageIsMentioningBot = (botName: string, message: Message) => {
  const botNameLowerCase = `@${botName.toLowerCase()}`;
  if (message.entities) {
    return message.entities.some(
      (entity) =>
        entity.type === "mention" &&
        message.text.substring(entity.offset, entity.offset + entity.length).toLowerCase() ===
          botNameLowerCase,
    );
  }
  if (message.caption_entities) {
    return message.caption_entities.some(
      (entity) =>
        entity.type === "mention" &&
        message.caption.substring(entity.offset, entity.offset + entity.length).toLowerCase() ===
          botNameLowerCase,
    );
  }
  return false;
};

interface SearchOptions {
  mute: boolean;
  noCrop: boolean;
  skip: boolean;
}

const getSearchOpts = (message: Message): SearchOptions => {
  const text = message.text?.toLowerCase() ?? "";
  const caption = message.caption?.toLowerCase() ?? "";
  return {
    mute: text.includes("mute") || caption.includes("mute"),
    noCrop: text.includes("nocrop") || caption.includes("nocrop"),
    skip: text.includes("skip") || caption.includes("skip"),
  };
};

// https://core.telegram.org/bots/api#photosize
const getImageUrlFromPhotoSize = async (photoSize: PhotoSize) => {
  if (photoSize?.file_id) {
    const json = await fetch(
      `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getFile?file_id=${photoSize.file_id}`,
    ).then((res) => res.json());
    return json?.result?.file_path
      ? `${TELEGRAM_API}/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`
      : false;
  }
  return false;
};

const getImageFromMessage = async (message: Message | ExternalReplyInfo) => {
  if (message.photo) {
    return await getImageUrlFromPhotoSize(message.photo.pop()); // get the last (largest) photo
  }
  if (message.animation) {
    return await getImageUrlFromPhotoSize(message.animation);
  }
  if (message.video) {
    if (message.video?.file_size <= 307200) return await getImageUrlFromPhotoSize(message.video);
    if (message.video?.cover) return await getImageUrlFromPhotoSize(message.video.cover.pop());
    if (message.video?.thumbnail) return await getImageUrlFromPhotoSize(message.video.thumbnail);
  }
  if (message.sticker) {
    return await getImageUrlFromPhotoSize(message.sticker);
  }
  if (message.document?.thumbnail) {
    return await getImageUrlFromPhotoSize(message.document.thumbnail);
  }
  if (message.link_preview_options?.url) {
    return message.link_preview_options?.url;
  }
  if ("entities" in message && message.entities && message.text) {
    for (const entity of message.entities) {
      if (entity.type === "url") {
        return message.text.substring(entity.offset, entity.offset + entity.length);
      }
      if (entity.type === "text_link") {
        return entity.url;
      }
    }
  }
  return false;
};

const queue = new Map<number, Promise<any>>();

const enqueueUserTask = async <T>(userId: number, task: () => Promise<T>): Promise<T> => {
  const previous = queue.get(userId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);

  const storedPromise = current.finally(() => {
    if (queue.get(userId) === storedPromise) queue.delete(userId);
  });
  queue.set(userId, storedPromise);
  return current;
};

const privateMessageHandler = async (message: Message) => {
  const userId = message.from?.id ?? 0;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const reply_msg_id = message.external_reply ? message.message_id : responding_msg.message_id;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (message.text?.toLowerCase().includes("/help")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: escapeMarkdownV2(await getHelpMessage(botName, userId)),
        parse_mode: "MarkdownV2",
      });
    }
    return await sendMessage({
      chat_id: message.chat.id,
      text: "You can Send or Forward anime screenshots to me",
    });
  }

  const result = await enqueueUserTask(userId, async () => {
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👌" }],
    });
    const result = await submitSearch(imageURL, userId, searchOpts);
    sendChatAction({ chat_id: message.chat.id, action: "typing" });
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    });
    return result;
  });

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && Number(video.headers.get("content-length")) > 0) {
      await sendVideo({
        chat_id: message.chat.id,
        video: videoLink,
        caption: escapeMarkdownV2(result.text),
        parse_mode: "MarkdownV2",
        reply_parameters: {
          message_id: reply_msg_id,
        },
      });
      return;
    }
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: escapeMarkdownV2(result.text),
    parse_mode: "MarkdownV2",
    reply_parameters: { message_id: reply_msg_id },
  });
};

const groupMessageHandler = async (message: Message) => {
  const userId = message.from?.id ?? 0;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const reply_msg_id = message.external_reply ? message.message_id : responding_msg.message_id;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (message.text?.toLowerCase().includes("/help")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: escapeMarkdownV2(await getHelpMessage(botName, userId)),
        parse_mode: "MarkdownV2",
        reply_parameters: { message_id: message.message_id },
      });
    }
    // cannot find image from the message mentioning the bot
    return await sendMessage({
      chat_id: message.chat.id,
      text: "Mention me in an anime screenshot, I will tell you what anime is that",
      reply_parameters: { message_id: message.message_id },
    });
  }

  const result = await enqueueUserTask(userId, async () => {
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👌" }],
    });
    const result = await submitSearch(imageURL, userId, searchOpts);
    sendChatAction({ chat_id: message.chat.id, action: "typing" });
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    });
    return result;
  });

  if (result.isAdult) {
    await sendMessage({
      chat_id: message.chat.id,
      text: "I've found an adult result 😳\nPlease forward it to me via Private Chat 😏",
      reply_parameters: { message_id: reply_msg_id },
    });
    return;
  }

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && Number(video.headers.get("content-length")) > 0) {
      await sendVideo({
        chat_id: message.chat.id,
        video: videoLink,
        caption: escapeMarkdownV2(result.text),
        has_spoiler: responding_msg.has_media_spoiler,
        parse_mode: "MarkdownV2",
        reply_parameters: {
          message_id: reply_msg_id,
        },
      });
      return;
    }
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: escapeMarkdownV2(result.text),
    parse_mode: "MarkdownV2",
    reply_parameters: { message_id: reply_msg_id },
  });
};

const getBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: any[] = [];
    let size = 0;
    req.on("error", (error) => {
      console.log(error);
      reject(error);
    });
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        req.destroy();
        return reject(new Error("Request entity too large"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString());
    });
  });

const server = http.createServer({ keepAliveTimeout: 60000 }, async (req, res) => {
  if (req.method === "POST") {
    const clientSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (
      typeof clientSecret !== "string" ||
      clientSecret.length !== SECRET_TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(clientSecret), Buffer.from(SECRET_TOKEN))
    ) {
      return res.writeHead(403).end();
    }
    try {
      const request = JSON.parse(await getBody(req));
      const message: Message = request.message ?? request.edited_message;
      if (message?.chat?.type === "private") {
        await privateMessageHandler(message);
        setMessageReaction({
          chat_id: message.chat.id,
          message_id: message.message_id,
          reaction: [],
        });
      } else if (message?.chat?.type === "group" || message?.chat?.type === "supergroup") {
        if (messageIsMentioningBot(botName, message)) {
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
