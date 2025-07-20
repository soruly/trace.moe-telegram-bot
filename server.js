import child_process from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import postgres from "postgres";

process.loadEnvFile();
const {
  PORT = 3000,
  ADDR = "0.0.0.0",
  TELEGRAM_TOKEN,
  TELEGRAM_WEBHOOK,
  TRACE_MOE_KEY,
  HEROKU_SLUG_COMMIT,
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASS,
} = process.env;

const TELEGRAM_API = "https://api.telegram.org";

if (!TELEGRAM_TOKEN || !TELEGRAM_WEBHOOK) {
  console.log("Please configure TELEGRAM_TOKEN and TELEGRAM_WEBHOOK first");
  process.exit();
}

console.log(`WEBHOOK: ${TELEGRAM_WEBHOOK}`);
console.log(`Use trace.moe API: ${TRACE_MOE_KEY ? "with" : "without"} API Key`);
console.log(
  `Logs to database: ${DB_HOST ? `postgres://${DB_USER}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}` : "false"}`,
);

const sql = DB_HOST
  ? postgres({
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      username: DB_USER,
      password: DB_PASS,
    })
  : null;

console.log("Setting Telegram webhook...");
await fetch(
  `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setWebhook?url=${TELEGRAM_WEBHOOK}&max_connections=100`,
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
  REVISION = HEROKU_SLUG_COMMIT ?? child_process.execSync("git rev-parse HEAD").toString().trim();
} catch (e) {
  REVISION = "";
}
const packageJSON = (await fs.stat("./package.json").catch(() => null))
  ? JSON.parse(await fs.readFile("./package.json"))
  : null;

const getHelpMessage = async (botName, fromId) =>
  [
    `Bot Name: ${botName ? `@${botName}` : "(unknown)"}`,
    `Revision: \`${REVISION.substring(0, 7)}\``,
    `Use trace.moe with API Key? ${TRACE_MOE_KEY ? "`true`" : "`false`"}`,
    `Homepage: ${packageJSON?.homepage ?? ""}`,
    sql
      ? `Your search count (last 30 days): ${(await sql`SELECT COUNT(*) AS count FROM logs_bot WHERE user_id=${fromId} AND code=200 AND created > now() - '30 days'::interval`)[0].count}`
      : "",
  ]
    .filter((e) => e)
    .join("\n");

const sendMessage = (chat_id, text, options) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, ...options }),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const sendChatAction = (chat_id, action) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, action }),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const setMessageReaction = (chat_id, message_id, emoji_list, is_big) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id,
      message_id,
      reaction: emoji_list.map((emoji) => ({ type: "emoji", emoji })),
      is_big,
    }),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const sendVideo = (chat_id, video, options) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, video, ...options }),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const formatTime = (timeInSeconds) => {
  const sec_num = Math.round(Number(timeInSeconds));
  const hours = Math.floor(sec_num / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((sec_num - hours * 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (sec_num - hours * 3600 - minutes * 60).toFixed(0).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const submitSearch = (imageFileURL, opts) =>
  new Promise(async (resolve, reject) => {
    let trial = 5;
    let response = null;
    while (trial > 0 && (!response || response.status === 503 || response.status === 402)) {
      trial--;
      response = await fetch(
        `https://api.trace.moe/search?${[
          "anilistInfo=1",
          `url=${encodeURIComponent(imageFileURL)}`,
          opts.noCrop ? "" : "cutBorders=1",
        ].join("&")}`,
        TRACE_MOE_KEY ? { headers: { "x-trace-key": TRACE_MOE_KEY } } : {},
      ).catch((e) => {
        trial = 0;
        return resolve({ text: "`trace.moe API error, please try again later.`" });
      });
      if (!response) {
        trial = 0;
        return resolve({ text: "`trace.moe API error, please try again later.`" });
      }
      if (sql)
        await sql`INSERT INTO logs_bot ${sql({ user_id: opts.fromId, code: response.status })}`;
      if (response.status === 503 || response.status === 402) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.floor(Math.random() * 4000) + 1000),
        );
      } else trial = 0;
    }

    if ([502, 503, 504].includes(response.status)) {
      return resolve({ text: "`trace.moe server is busy, please try again later.`" });
    }
    if (response.status === 402 || response.status === 429) {
      return resolve({ text: "`You exceeded the search limit, please try again later`" });
    }
    if (response.status >= 400) {
      console.error(await response.text());
      return resolve({ text: "`trace.moe API error, please try again later.`" });
    }
    const searchResult = await response.json();
    if (response.status >= 400 || searchResult.error) {
      return resolve({
        text: searchResult.error
          ? `\`${searchResult.error.replace(/TELEGRAM_TOKEN/g, "{TELEGRAM_TOKEN}")}\``
          : `Error: HTTP ${response.status}`,
      });
    }
    if (searchResult?.result?.length <= 0) {
      return resolve({ text: "Cannot find any results from trace.moe" });
    }
    const { anilist, similarity, filename, from, to, video } = searchResult.result[0];
    const { title: { chinese, english, native, romaji } = {}, isAdult } = anilist ?? {};
    let text = "";
    text += [native, chinese, romaji, english]
      .filter((e) => e)
      .reduce(
        // deduplicate titles
        (acc, cur) =>
          acc.map((e) => e.toLowerCase()).includes(cur.toLowerCase()) ? acc : [...acc, cur],
        [],
      )
      .map((t) => `\`${t}\``)
      .join("\n");
    text += "\n";
    text += `\`${filename.replace(/`/g, "``")}\`\n`;
    text += `\`${formatTime(from)}\`\n`;
    text += `\`${(similarity * 100).toFixed(1)}% similarity\`\n`;
    return resolve({
      isAdult,
      text,
      video: `${video}&size=l`,
    });
  });

const messageIsMentioningBot = (message) => {
  if (message.entities) {
    return (
      message.entities
        .filter((entity) => entity.type === "mention")
        .map((entity) => message.text.substr(entity.offset, entity.length))
        .filter((entity) => entity.toLowerCase() === `@${botName.toLowerCase()}`).length >= 1
    );
  }
  if (message.caption) {
    // Telegram does not provide entities when mentioning the bot in photo caption
    return message.caption.toLowerCase().indexOf(`@${botName.toLowerCase()}`) >= 0;
  }
  return false;
};

const getSearchOpts = (message) => {
  const opts = {
    mute: false,
    noCrop: false,
    skip: false,
    fromId: message.from.id,
  };
  if (messageIsMute(message)) opts.mute = true;
  if (messageIsNoCrop(message)) opts.noCrop = true;
  if (messageIsSkipPreview(message)) opts.skip = true;
  return opts;
};

const messageIsMute = (message) => {
  if (message.caption) return message.caption.toLowerCase().includes("mute");
  return message.text?.toLowerCase().includes("mute");
};

const messageIsNoCrop = (message) => {
  if (message.caption) return message.caption.toLowerCase().includes("nocrop");
  return message.text?.toLowerCase().includes("nocrop");
};

const messageIsSkipPreview = (message) => {
  if (message.caption) return message.caption.toLowerCase().includes("skip");
  return message.text?.toLowerCase().includes("skip");
};

// https://core.telegram.org/bots/api#photosize
const getImageUrlFromPhotoSize = async (PhotoSize) => {
  if (PhotoSize?.file_id) {
    const json = await fetch(
      `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getFile?file_id=${PhotoSize.file_id}`,
    ).then((res) => res.json());
    return json?.result?.file_path
      ? `${TELEGRAM_API}/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`
      : false;
  }
  return false;
};

const getImageFromMessage = async (message) => {
  if (message.photo) {
    return await getImageUrlFromPhotoSize(message.photo.pop()); // get the last (largest) photo
  }
  if (message.animation) {
    return await getImageUrlFromPhotoSize(message.animation);
  }
  if (message.video?.thumb) {
    return await getImageUrlFromPhotoSize(message.video.thumb);
  }
  if (message.sticker) {
    return await getImageUrlFromPhotoSize(message.sticker);
  }
  if (message.document?.thumb) {
    return await getImageUrlFromPhotoSize(message.document.thumb);
  }
  if (message.entities && message.text) {
    const urlEntity = message.entities.find((entity) => entity.type === "url");
    return urlEntity
      ? message.text.substring(urlEntity.offset, urlEntity.offset + urlEntity.length)
      : false;
  }
  return false;
};

const queue = new Set();
setInterval(() => queue.clear(), 60 * 60 * 1000); // reset search queue every 60 mins

const privateMessageHandler = async (message) => {
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (message.text?.toLowerCase().includes("/help")) {
      return await sendMessage(message.chat.id, await getHelpMessage(botName, searchOpts.fromId), {
        parse_mode: "Markdown",
      });
    }
    return await sendMessage(message.chat.id, "You can Send / Forward anime screenshots to me.");
  }
  while (queue.has(searchOpts.fromId)) await new Promise((resolve) => setTimeout(resolve, 100));
  queue.add(searchOpts.fromId);
  setMessageReaction(message.chat.id, message.message_id, ["👌"]);
  const result = await submitSearch(imageURL, searchOpts);
  sendChatAction(message.chat.id, "typing");
  setMessageReaction(message.chat.id, message.message_id, ["👍"]);
  queue.delete(searchOpts.fromId);

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && video.headers.get("content-length") > 0) {
      await sendVideo(message.chat.id, videoLink, {
        caption: result.text,
        parse_mode: "Markdown",
        reply_to_message_id: responding_msg.message_id,
      });
      return;
    }
  }

  await sendMessage(message.chat.id, result.text, {
    reply_to_message_id: responding_msg.message_id,
    parse_mode: "Markdown",
  });
};

const groupMessageHandler = async (message) => {
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (responding_msg.text?.toLowerCase().includes("/help")) {
      return await sendMessage(message.chat.id, await getHelpMessage(botName, searchOpts.fromId), {
        reply_to_message_id: message.message_id,
        parse_mode: "Markdown",
      });
    }
    // cannot find image from the message mentioning the bot
    return await sendMessage(
      message.chat.id,
      "Mention me in an anime screenshot, I will tell you what anime is that",
      { reply_to_message_id: message.message_id },
    );
  }
  while (queue.has(searchOpts.fromId)) await new Promise((resolve) => setTimeout(resolve, 100));
  queue.add(searchOpts.fromId);
  setMessageReaction(message.chat.id, message.message_id, ["👌"]);
  const result = await submitSearch(imageURL, searchOpts);
  sendChatAction(message.chat.id, "typing");
  setMessageReaction(message.chat.id, message.message_id, ["👍"]);
  queue.delete(searchOpts.fromId);

  if (result.isAdult) {
    await sendMessage(
      message.chat.id,
      "I've found an adult result 😳\nPlease forward it to me via Private Chat 😏",
      {
        reply_to_message_id: responding_msg.message_id,
      },
    );
    return;
  }

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && video.headers.get("content-length") > 0) {
      await sendVideo(message.chat.id, videoLink, {
        caption: result.text,
        has_spoiler: responding_msg.has_media_spoiler,
        parse_mode: "Markdown",
        reply_to_message_id: responding_msg.message_id,
      });
      return;
    }
  }

  await sendMessage(message.chat.id, result.text, {
    parse_mode: "Markdown",
    reply_to_message_id: responding_msg.message_id,
  });
};

const getBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("error", (error) => {
      console.log(error);
      reject(error);
    });
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });

const server = http.createServer({ keepAliveTimeout: 60000 }, async (req, res) => {
  if (req.method === "POST") {
    try {
      const { message } = JSON.parse(await getBody(req));
      if (message?.chat?.type === "private") {
        await privateMessageHandler(message);
        setMessageReaction(message.chat.id, message.message_id, []);
      } else if (message?.chat?.type === "group" || message?.chat?.type === "supergroup") {
        if (messageIsMentioningBot(message)) {
          await groupMessageHandler(message);
          setMessageReaction(message.chat.id, message.message_id, []);
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
      .writeHead(200, { "Content-Type": "text/html" })
      .end(`<meta http-equiv="Refresh" content="0; URL=https://t.me/${botName ?? ""}">`);
  }
  return res.writeHead(400).end();
});

server.on("error", (e) => console.error(e));

server.listen(PORT, ADDR, () => console.log("server listening on", server.address()));
