import "dotenv/config";
import { performance } from "perf_hooks";
import { promisify } from "util";
import fetch from "node-fetch";
import express from "express";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import * as redis from "redis";

const {
  SERVER_PORT,
  TELEGRAM_TOKEN,
  TELEGRAM_WEBHOOK,
  TRACE_MOE_KEY,
  REDIS_HOST,
  ANILIST_API_URL,
} = process.env;

const TELEGRAM_API = "https://api.telegram.org";

let redisClient = null;
let getAsync = null;
let setAsync = null;
let ttlAsync = null;
if (REDIS_HOST) {
  redisClient = redis.createClient({ host: REDIS_HOST });
  getAsync = promisify(redisClient.get).bind(redisClient);
  setAsync = promisify(redisClient.set).bind(redisClient);
  ttlAsync = promisify(redisClient.ttl).bind(redisClient);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  new rateLimit({
    max: 3600, // limit each IP to 60 requests per 60 seconds
    delayMs: 0, // disable delaying - full speed until the max limit is reached
  })
);
app.use(bodyParser.json());

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
    const response = await fetch(
      `https://api.trace.moe/search?${[
        `uid=tg${message.from.id}`,
        `url=${encodeURIComponent(imageFileURL)}`,
        "cutBorders=1",
      ].join("&")}`,
      {
        headers: { "x-trace-key": TRACE_MOE_KEY },
      }
    ).catch((e) => {
      return resolve({ text: "`trace.moe API error, please try again later.`" });
    });
    if (!response) {
      return resolve({ text: "`trace.moe API error, please try again later.`" });
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
    const { title: { chinese, english, native, romaji } = {}, isAdult } = await getAnilistInfo(
      anilist
    );
    let text = "";
    text += [native, chinese, romaji, english]
      .filter((e) => e)
      .reduce(
        // deduplicate titles
        (acc, cur) =>
          acc.map((e) => e.toLowerCase()).includes(cur.toLowerCase()) ? acc : [...acc, cur],
        []
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
  if (message.caption) {
    return message.caption.toLowerCase().indexOf("mute") >= 0;
  }
  return message.text?.toLowerCase().indexOf("mute") >= 0;
};

// https://core.telegram.org/bots/api#photosize
const getImageUrlFromPhotoSize = async (PhotoSize) => {
  if (PhotoSize?.file_id) {
    const json = await fetch(
      `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getFile?file_id=${PhotoSize.file_id}`
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

const limitExceeded = async (message) => {
  if (REDIS_HOST) {
    let limit = await getAsync(`telegram_${message.from.id}_limit`);
    const limitTTL = await ttlAsync(`telegram_${message.from.id}_limit`);
    limit = limit === null ? 5 - 1 : limit - 1;
    await setAsync(
      `telegram_${message.from.id}_limit`,
      limit,
      "EX",
      Number(limitTTL) > 0 ? Number(limitTTL) : 60
    );
    if (limit < 0) {
      return true;
    }

    let quota = await getAsync(`telegram_${message.from.id}_quota`);
    const quotaTTL = await ttlAsync(`telegram_${message.from.id}_quota`);
    quota = quota === null ? 50 - 1 : quota - 1;
    await setAsync(
      `telegram_${message.from.id}_quota`,
      quota,
      "EX",
      Number(quotaTTL) > 0 ? Number(quotaTTL) : 86400
    );
    if (quota < 0) {
      return true;
    }
  }
  return false;
};

const privateMessageHandler = async (message) => {
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    await sendMessage(message.chat.id, "You can Send / Forward anime screenshots to me.");
    return;
  }
  if (await limitExceeded(message)) {
    await sendMessage(message.chat.id, "You exceeded the search limit, please try again later", {
      reply_to_message_id: responding_msg.message_id,
    });
    return;
  }

  const bot_message = await sendMessage(message.chat.id, "Searching...", {
    reply_to_message_id: responding_msg.message_id,
  });

  const result = await submitSearch(imageURL, responding_msg, message);
  // better to send responses one-by-one
  await editMessageText(result.text, {
    chat_id: bot_message.chat.id,
    message_id: bot_message.message_id,
    parse_mode: "Markdown",
  });

  if (result.video) {
    const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && video.headers.get("content-length") > 0) {
      await sendChatAction(message.chat.id, "upload_video");
      await sendVideo(message.chat.id, videoLink);
    }
  }
};

const groupMessageHandler = async (message) => {
  if (!messageIsMentioningBot(message)) {
    return;
  }
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    // cannot find image from the message mentioning the bot
    await sendMessage(
      message.chat.id,
      "Mention me in an anime screenshot, I will tell you what anime is that",
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  if (await limitExceeded(message)) {
    await sendMessage(message.chat.id, "You exceeded the search limit, please try again later", {
      reply_to_message_id: responding_msg.message_id,
    });
    return;
  }

  const result = await submitSearch(imageURL, responding_msg, message);
  if (result.isAdult) {
    await sendMessage(
      message.chat.id,
      "I've found an adult result 😳\nPlease forward it to me via Private Chat 😏",
      {
        reply_to_message_id: responding_msg.message_id,
      }
    );

    return;
  }
  await sendMessage(message.chat.id, result.text, {
    reply_to_message_id: responding_msg.message_id,
    parse_mode: "Markdown",
  });

  if (result.video) {
    const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && video.headers.get("content-length") > 0) {
      await sendChatAction(message.chat.id, "upload_video");
      await sendVideo(message.chat.id, videoLink, {
        reply_to_message_id: responding_msg.message_id,
      });
    }
  }
};

app.post("/", (req, res) => {
  const message = req.body?.message;
  if (message?.chat?.type === "private") {
    privateMessageHandler(message);
  } else if (message?.chat?.type === "group" || message?.chat?.type === "supergroup") {
    groupMessageHandler(message);
  }
  res.sendStatus(204);
});

app.get("/", (req, res) => {
  res.send("ok");
});

app.listen(SERVER_PORT, "0.0.0.0", () => console.log(`server listening on port ${SERVER_PORT}`));

fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setWebhook?url=${TELEGRAM_WEBHOOK}&max_connections=100`)
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
