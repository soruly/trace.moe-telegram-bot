import fs from "node:fs/promises";
import child_process from "node:child_process";
import express from "express";
import rateLimit from "express-rate-limit";

process.loadEnvFile();
const {
  PORT = 3000,
  TELEGRAM_TOKEN,
  TELEGRAM_WEBHOOK,
  TRACE_MOE_KEY,
  ANILIST_API_URL = "https://graphql.anilist.co/",
  RAILWAY_STATIC_URL,
  RAILWAY_GIT_COMMIT_SHA,
  HEROKU_SLUG_COMMIT,
} = process.env;

const TELEGRAM_API = "https://api.telegram.org";

const WEBHOOK = RAILWAY_STATIC_URL ? `https://${RAILWAY_STATIC_URL}` : TELEGRAM_WEBHOOK;

if (!TELEGRAM_TOKEN || !WEBHOOK) {
  console.log("Please configure TELEGRAM_TOKEN and TELEGRAM_WEBHOOK first");
  process.exit();
}

console.log(`WEBHOOK: ${WEBHOOK}`);
console.log(`Use trace.moe API: ${TRACE_MOE_KEY ? "with API Key" : "without API Key"}`);
console.log(`Anilist Info Endpoint: ${ANILIST_API_URL}`);

console.log("Setting Telegram webhook...");
await fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setWebhook?url=${WEBHOOK}&max_connections=100`)
  .then((e) => e.json())
  .then((e) => {
    console.log(e);
  });

fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getMe`)
  .then((e) => e.json())
  .then((e) => {
    console.log(e);
    app.locals.botName = e.result?.username;
  });

const app = express();

let REVISION;
try {
  REVISION =
    HEROKU_SLUG_COMMIT ??
    RAILWAY_GIT_COMMIT_SHA ??
    child_process.execSync("git rev-parse HEAD").toString().trim();
} catch (e) {
  REVISION = "";
}
const packageJSON = (await fs.stat("./package.json").catch(() => null))
  ? JSON.parse(await fs.readFile("./package.json"))
  : null;

const getHelpMessage = (botName) =>
  [
    `Bot Name: ${botName ? `@${botName}` : "(unknown)"}`,
    `Revision: \`${REVISION.substring(0, 7)}\``,
    `Use trace.moe with API Key? ${TRACE_MOE_KEY ? "`true`" : "`false`"}`,
    `Anilist Info Endpoint: ${ANILIST_API_URL}`,
    `Homepage: ${packageJSON?.homepage ?? ""}`,
  ].join("\n");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  rateLimit({
    max: 100, // limit each IP to 100 requests
    windowMs: 1000, // per second
    delayMs: 0, // disable delaying - full speed until the max limit is reached
  }),
);
app.use(express.json());

// app.use((req, res, next) => {
//   const startTime = performance.now();
//   console.log("=>", new Date().toISOString(), req.ip, req.path);
//   res.on("finish", () => {
//     console.log(
//       "<=",
//       new Date().toISOString(),
//       req.ip,
//       req.path,
//       res.statusCode,
//       `${(performance.now() - startTime).toFixed(0)}ms`
//     );
//   });
//   next();
// });

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

const editMessageText = (text, options) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...options }),
  })
    .then((e) => e.json())
    .then((e) => e.result);

const formatTime = (timeInSeconds) => {
  const sec_num = Number(timeInSeconds);
  const hours = Math.floor(sec_num / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((sec_num - hours * 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (sec_num - hours * 3600 - minutes * 60).toFixed(0).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const getAnilistInfo = (id) =>
  new Promise(async (resolve) => {
    const response = await fetch(ANILIST_API_URL, {
      method: "POST",
      body: JSON.stringify({
        query: `query($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            idMal
            title {
              native
              romaji
              english
            }
            synonyms
            isAdult
          }
        }
        `,
        variables: { id },
      }),
      headers: { "Content-Type": "application/json" },
    });
    if (response.status >= 400) {
      console.error(1070, response.status, await response.text());
      return resolve({ text: "`Anilist API error, please try again later.`" });
    }
    return resolve((await response.json()).data.Media);
  });

const submitSearch = (imageFileURL, message) =>
  new Promise(async (resolve, reject) => {
    let trial = 5;
    let response = null;
    while (trial > 0 && (!response || response.status === 503 || response.status === 402)) {
      trial--;
      response = await fetch(
        `https://api.trace.moe/search?${[
          `uid=tg${message.from.id}`,
          `url=${encodeURIComponent(imageFileURL)}`,
          messageIsNoCrop(message) ? "" : "cutBorders=1",
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
    const { title: { chinese, english, native, romaji } = {}, isAdult } =
      await getAnilistInfo(anilist);
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
        .filter((entity) => entity.toLowerCase() === `@${app.locals.botName.toLowerCase()}`)
        .length >= 1
    );
  }
  if (message.caption) {
    // Telegram does not provide entities when mentioning the bot in photo caption
    return message.caption.toLowerCase().indexOf(`@${app.locals.botName.toLowerCase()}`) >= 0;
  }
  return false;
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

const privateMessageHandler = async (message) => {
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (message.text?.toLowerCase().includes("/help")) {
      return await sendMessage(message.chat.id, getHelpMessage(app.locals.botName), {
        parse_mode: "Markdown",
      });
    }
    return await sendMessage(message.chat.id, "You can Send / Forward anime screenshots to me.");
  }
  setMessageReaction(message.chat.id, message.message_id, ["👌"]);
  const result = await submitSearch(imageURL, responding_msg, message);
  sendChatAction(message.chat.id, "typing");
  setMessageReaction(message.chat.id, message.message_id, ["👍"]);

  if (result.video && !messageIsSkipPreview(message)) {
    const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
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
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (responding_msg.text?.toLowerCase().includes("/help")) {
      return await sendMessage(message.chat.id, getHelpMessage(app.locals.botName), {
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
  setMessageReaction(message.chat.id, message.message_id, ["👌"]);
  const result = await submitSearch(imageURL, responding_msg, message);
  sendChatAction(message.chat.id, "typing");
  setMessageReaction(message.chat.id, message.message_id, ["👍"]);

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

  if (result.video && !messageIsSkipPreview(message)) {
    const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
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

app.post("/", async (req, res) => {
  const message = req.body?.message;
  if (message?.chat?.type === "private") {
    await privateMessageHandler(message);
    setMessageReaction(message.chat.id, message.message_id, []);
  } else if (message?.chat?.type === "group" || message?.chat?.type === "supergroup") {
    if (messageIsMentioningBot(message)) {
      await groupMessageHandler(message);
      setMessageReaction(message.chat.id, message.message_id, []);
    }
  }
  res.sendStatus(204);
});

app.get("/", (req, res) => {
  return res.send(
    `<meta http-equiv="Refresh" content="0; URL=https://t.me/${app.locals.botName ?? ""}">`,
  );
});

app.listen(PORT, "0.0.0.0", () => console.log(`server listening on port ${PORT}`));
