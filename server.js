import "dotenv/config.js";
import { promisify } from "util";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import * as redis from "redis";

const { SERVER_PORT, REDIS_HOST, TELEGRAM_TOKEN, TELEGRAM_WEBHOOK, TRACE_MOE_KEY } = process.env;

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

let bot_name = null;

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  webHook: { port: SERVER_PORT },
  polling: false,
});

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

const submitSearch = (imageFileURL, useJC) =>
  new Promise(async (resolve, reject) => {
    const response = await fetch(
      `https://api.trace.moe/search?${[
        `url=${encodeURIComponent(imageFileURL)}`,
        "cutBorders=1",
        "info=basic",
        useJC ? "&method=jc" : "",
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
    const {
      anilist: {
        id,
        isAdult,
        title: { chinese, english, native, romaji },
      },
      similarity,
      filename,
      from,
      to,
      video,
    } = searchResult.result[0];
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
        .filter((entity) => entity.toLowerCase() === `@${bot_name.toLowerCase()}`).length >= 1
    );
  }
  if (message.caption) {
    // Telegram does not provide entities when mentioning the bot in photo caption
    return message.caption.toLowerCase().indexOf(`@${bot_name.toLowerCase()}`) >= 0;
  }
  return false;
};

const messageIsMute = (message) => {
  if (message.caption) {
    return message.caption.toLowerCase().indexOf("mute") >= 0;
  }
  return message.text?.toLowerCase().indexOf("mute") >= 0;
};

const messageIsJC = (message) => {
  if (message.caption) {
    return message.caption.toLowerCase().indexOf("jc") >= 0;
  }
  return message.text?.toLowerCase().indexOf("jc") >= 0;
};

// https://core.telegram.org/bots/api#photosize
const getImageUrlFromPhotoSize = async (PhotoSize) => {
  if (PhotoSize?.file_id) {
    const json = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${PhotoSize.file_id}`
    )
      .then((res) => res.json())
      .catch((e) => {
        console.error(1142, e);
      });
    return json?.result?.file_path
      ? `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`
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
    await bot.sendMessage(message.chat.id, "You can Send / Forward anime screenshots to me.");
    return;
  }
  if (await limitExceeded(message)) {
    await bot.sendMessage(
      message.chat.id,
      "You exceeded the search limit, please try again later",
      {
        reply_to_message_id: responding_msg.message_id,
      }
    );
    return;
  }

  const bot_message = await bot.sendMessage(message.chat.id, "Searching...", {
    reply_to_message_id: responding_msg.message_id,
  });

  const result = await submitSearch(imageURL, messageIsJC(responding_msg));
  // better to send responses one-by-one
  await bot
    .editMessageText(result.text, {
      chat_id: bot_message.chat.id,
      message_id: bot_message.message_id,
      parse_mode: "Markdown",
    })
    .catch((e) => {
      console.error(1227, e);
    });
  if (result.video) {
    const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" }).catch((e) => {
      console.error(1232, e);
    });
    if (video.ok && video.headers.get("content-length") > 0) {
      await bot.sendChatAction(message.chat.id, "upload_video").catch((e) => {
        console.error(1236, e);
      });
      await bot.sendVideo(message.chat.id, videoLink).catch((e) => {
        console.error(1239, e);
      });
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
    await bot.sendMessage(
      message.chat.id,
      "Mention me in an anime screenshot, I will tell you what anime is that",
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  if (await limitExceeded(message)) {
    await bot.sendMessage(
      message.chat.id,
      "You exceeded the search limit, please try again later",
      {
        reply_to_message_id: responding_msg.message_id,
      }
    );
    return;
  }

  const result = await submitSearch(imageURL, messageIsJC(responding_msg)).catch((e) => {
    console.error(1273, e);
  });
  if (result.isAdult) {
    await bot
      .sendMessage(
        message.chat.id,
        "I've found an adult result 😳\nPlease forward it to me via Private Chat 😏",
        {
          reply_to_message_id: responding_msg.message_id,
        }
      )
      .catch((e) => {
        console.error(1285, e);
      });
    return;
  }
  await bot
    .sendMessage(message.chat.id, result.text, {
      reply_to_message_id: responding_msg.message_id,
      parse_mode: "Markdown",
    })
    .catch((e) => {
      console.error(1295, e);
    });
  if (result.video) {
    const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" }).catch((e) => {
      console.error(1300, e);
    });
    if (video.ok && video.headers.get("content-length") > 0) {
      await bot.sendChatAction(message.chat.id, "upload_video").catch((e) => {
        console.error(1304, e);
      });
      await bot
        .sendVideo(message.chat.id, videoLink, {
          reply_to_message_id: responding_msg.message_id,
        })
        .catch((e) => {
          console.error(1311, e);
        });
    }
  }
};

const messageHandler = (message) => {
  if (message.chat.type === "private") {
    privateMessageHandler(message);
  } else if (message.chat.type === "group" || message.chat.type === "supergroup") {
    groupMessageHandler(message);
  }
};

bot.setWebHook(TELEGRAM_WEBHOOK);

bot.on("message", messageHandler);

const result = await bot.getMe();
bot_name = result.username;
console.log(JSON.stringify(result, null, 2));
