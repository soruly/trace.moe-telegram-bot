require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");
const redis = require("redis");
const { promisify } = require("util");
<<<<<<< HEAD
=======
const getUrls = require("get-urls");
const { off } = require("process");
>>>>>>> 0b6f7ef... Implemented much simpler URL search

const { SERVER_PORT, REDIS_HOST, TELEGRAM_TOKEN, TELEGRAM_WEBHOOK, TRACE_MOE_TOKEN } = process.env;

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
  const sec_num = parseInt(timeInSeconds, 10);
  const hours = Math.floor(sec_num / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((sec_num - hours * 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (sec_num - hours * 3600 - minutes * 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const submitSearch = (imageFileURL) =>
  new Promise(async (resolve, reject) => {
    let response = {};
    try {
      response = await fetch(
        `https://trace.moe/api/search?token=${TRACE_MOE_TOKEN}&url=${imageFileURL}`
      );
    } catch (error) {
      reject(error);
    }
    if (parseInt(response.headers.get("x-whatanime-quota"), 10) === 0) {
      resolve({ text: "Search quota exceeded, please try again later." });
      return;
    }
    let searchResult = {};
    try {
      searchResult = await response.json();
    } catch (e) {
      resolve({ text: "Backend server error, please try again later." });
      return;
    }
    if (!searchResult.docs) {
      resolve({ text: "Error with search response. Is your query correctly formatted? Note: URL searches must be for static images, not gifs" });
      return;
    }
    if (searchResult.docs && searchResult.docs.length <= 0) {
      resolve({ text: "Sorry, I don't know what anime is it :\\" });
      return;
    }
    const {
      is_adult,
      similarity,
      title,
      title_english,
      title_chinese,
      title_romaji,
      anilist_id,
      filename,
      episode,
      at,
      tokenthumb,
    } = searchResult.docs[0];
    let text = "";
    if (similarity < 0.92) {
      text = "I have low confidence in this, wild guess:\n";
    }
    text += [title, title_chinese, title_romaji, title_english]
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
    text += `\`EP#${episode.toString().padStart(2, "0")} ${formatTime(at)}\`\n`;
    text += `\`${(similarity * 100).toFixed(1)}% similarity\`\n`;
    const videoLink = [
      `https://media.trace.moe/video/${anilist_id}/${encodeURIComponent(filename)}?`,
      `t=${at}&`,
      `token=${tokenthumb}`,
    ].join("");
    resolve({
      is_adult,
      text,
      video: videoLink,
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
  return message.text && message.text.toLowerCase().indexOf("mute") >= 0;
};

// The return type is PhotoSize || String for URL
// https://core.telegram.org/bots/api#photosize
const getImageFromMessage = (message) => {
  if (message.photo) {
    return message.photo.pop(); // get the last (largest) photo
  }
  if (message.animation) {
    return message.animation;
  }
  if (message.video && message.video.thumb) {
    return message.video.thumb;
  }
  if (message.document && message.document.thumb) {
    return message.document.thumb;
  }
  // check if there's a URL and parsable text
  if (message.entities && message.text) {
    for (let i = 0; i < message.entities.length; i++) {
      let ent = message.entities[i];
      if (ent.type === "url") {
        let offset = ent.offset;
        let length = ent.length;
        return message.text.substring(offset, offset + length + 1);
      }
    }
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
      parseInt(limitTTL, 10) > 0 ? parseInt(limitTTL, 10) : 60
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
      parseInt(quotaTTL, 10) > 0 ? parseInt(quotaTTL, 10) : 86400
    );
    if (quota < 0) {
      return true;
    }
  }
  return false;
};

const privateMessageHandler = async (message) => {
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  if (!getImageFromMessage(responding_msg)) {
    await bot.sendMessage(
      message.chat.id,
<<<<<<< HEAD
      "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)"
=======
      infoText
>>>>>>> 0b6f7ef... Implemented much simpler URL search
    );
    return;
  }
  if (await limitExceeded(message)) {
    await bot.sendMessage(message.chat.id, "You exceeded the search limit, please try again later", {
      reply_to_message_id: responding_msg.message_id,
    });
    return;
  }

  const bot_message = await bot.sendMessage(message.chat.id, "Searching...", {
    reply_to_message_id: responding_msg.message_id,
  });
  let searchUrl = "";
  const imgData = getImageFromMessage(responding_msg);
  // Should only be string if there was a URL present
  if (typeof imgData === "string") {
    searchUrl = imgData;
  } else {
    const json = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${
        getImageFromMessage(responding_msg).file_id
      }`
    ).then((res) => res.json());

    searchUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`;
  }

  try {
    const result = await submitSearch(searchUrl);
    // better to send responses one-by-one
    await bot.editMessageText(result.text, {
      chat_id: bot_message.chat.id,
      message_id: bot_message.message_id,
      parse_mode: "Markdown",
    });
    if (result.video) {
      const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
      try {
        await bot.sendChatAction(message.chat.id, "upload_video");
        await bot.sendVideo(message.chat.id, videoLink);
      } catch (error) {
        console.log(error);
      }
    }
  } catch (error) {
    await bot.editMessageText("Server error", {
      chat_id: bot_message.chat.id,
      message_id: bot_message.message_id,
    });
    console.log(error);
  }
};


const groupMessageHandler = async (message) => {
  if (!messageIsMentioningBot(message)) {
    return;
  }
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  if (!getImageFromMessage(responding_msg)) {
    // cannot find image from the message mentioning the bot
    await bot.sendMessage(
      message.chat.id,
      "Mention me in an anime screenshot, I will tell you what anime is that",
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  if (await limitExceeded(message)) {
<<<<<<< HEAD
    await bot.sendMessage(message.chat.id, "Your search limit exceeded, please try again later", {
=======
    await bot.sendMessage(message.chat.id, "You exceeded the search limit, please try again later", {
>>>>>>> 0b6f7ef... Implemented much simpler URL search
      reply_to_message_id: responding_msg.message_id,
    });
    return;
  }

  let searchUrl = "";
  const imgData = getImageFromMessage(responding_msg);
  // Should only be string if there was a URL present
  if (typeof imgData === "string") {
    searchUrl = imgData;
  } else {
    const json = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${
        getImageFromMessage(responding_msg).file_id
      }`
    ).then((res) => res.json());

    searchUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`;
  }

  try {
    const result = await submitSearch(searchUrl);
    if (result.is_adult) {
      await bot.sendMessage(
        message.chat.id,
        "I've found an adult result 😳\nPlease forward it to me via Private Chat 😏",
        {
          reply_to_message_id: responding_msg.message_id,
        }
      );
      return;
    }
    await bot.sendMessage(message.chat.id, result.text, {
      reply_to_message_id: responding_msg.message_id,
      parse_mode: "Markdown",
    });
    if (result.video) {
      const videoLink = messageIsMute(message) ? `${result.video}&mute` : result.video;
      await bot.sendChatAction(message.chat.id, "upload_video");
      await bot.sendVideo(message.chat.id, videoLink, {
        reply_to_message_id: responding_msg.message_id,
      });
    }
  } catch (error) {
    console.log(error);
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

(async () => {
  const result = await bot.getMe();
  bot_name = result.username;
  console.log(JSON.stringify(result, null, 2));
})();
