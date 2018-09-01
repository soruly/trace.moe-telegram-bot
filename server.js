const TelegramBot = require("node-telegram-bot-api");
const request = require("requestretry");
const querystring = require("querystring");
const fs = require("fs");
const path = require("path");
const Datauri = require("datauri");

const {
  port,
  token,
  webhook,
  whatanime_token
} = require("./config");

let bot_name = null;

const upload_dir = path.resolve(__dirname, "uploads");
if (!fs.existsSync(upload_dir)) {
  fs.mkdirSync(upload_dir);
}

const bot = new TelegramBot(token, {
  webHook: {port},
  polling: false
});

const formatTime = (timeInSeconds) => {
  const sec_num = parseInt(timeInSeconds, 10);
  const hours = Math.floor(sec_num / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((sec_num - (hours * 3600)) / 60).toString().padStart(2, "0");
  const seconds = (sec_num - (hours * 3600) - (minutes * 60)).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const welcomeHandler = (message) => {
  bot.sendMessage(message.from.id, "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)");
};

const submitSearch = (file_path) => new Promise(async (resolve, reject) => {
  const datauri = new Datauri(file_path);
  const formData = querystring.stringify({image: datauri.content});
  const contentLength = formData.length;
  let response = {};
  try {
    response = await request({
      headers: {
        "Content-Length": contentLength,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      uri: `https://whatanime.ga/api/search?token=${whatanime_token}`,
      body: formData,
      method: "POST"
    });
  } catch (error) {
    reject(error);
  }
  let searchResult = {};
  try {
    searchResult = JSON.parse(response.body);
  } catch (e) {
    resolve({text: "Backend server error, please try again later."});
  }

  if (searchResult.docs && searchResult.docs.length <= 0) {
    resolve({text: "Sorry, I don't know what anime is it :\\"});
  } else {
    const {
      similarity,
      title,
      title_english,
      title_chinese,
      title_romaji,
      anilist_id,
      filename,
      episode,
      at,
      tokenthumb
    } = searchResult.docs[0];
    let text = "";
    if (similarity < 0.92) {
      text = "I have low confidence in this, wild guess:\n";
    }
    text += "```\n";
    text += [
      title,
      title_chinese,
      title_romaji,
      title_english
    ].filter((e) => e).reduce( // deduplicate titles
      (acc, cur) => acc.map((e) => e.toLowerCase()).includes(cur.toLowerCase()) ? acc : [
        ...acc,
        cur
      ],
      []
    )
      .join("\n");
    text += "\n";
    text += `EP#${episode.toString().padStart(2, "0")} ${formatTime(at)}\n`;
    text += `${(similarity * 100).toFixed(1)}% similarity\n`;
    text += "```";
    const videoLink = [
      "https://whatanime.ga/preview.php?",
      `anilist_id=${anilist_id}`,
      `file=${encodeURIComponent(filename)}`,
      `t=${at}`,
      `token=${tokenthumb}`
    ].join("&");
    resolve({
      text,
      video: videoLink
    });
  }
});

const messageIsMentioningBot = (message) => {
  if (message.entities) {
    return message.entities
      .filter((entity) => entity.type === "mention")
      .map((entity) => message.text.substr(entity.offset, entity.length))
      .filter((entity) => entity.toLowerCase() === `@${bot_name.toLowerCase()}`)
      .length >= 1;
  }
  if (message.caption) {
    // Telegram does not provide entities when mentioning the bot in photo caption
    return message.caption.toLowerCase() === `@${bot_name.toLowerCase()}`;
  }
  return false;
};

// The return type is PhotoSize
// https://core.telegram.org/bots/api#photosize
const getImageFromMessage = (message) => {
  if (message.photo) {
    return message.photo.pop(); // get the last (largest) photo
  }
  if (message.document && message.document.thumb) {
    return message.document.thumb;
  }
  if (message.video && message.video.thumb) {
    return message.video.thumb;
  }
  return false;
};

const privateMessageHandler = async (message) => {
  if (!getImageFromMessage(message)) {
    bot.sendMessage(message.from.id, "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)");
    return;
  }
  const bot_message = await bot.sendMessage(message.chat.id, "Downloading the image...", {
    reply_to_message_id: message.message_id,
    parse_mode: "Markdown"
  });
  const response = await request(`https://api.telegram.org/bot${token}/getFile?file_id=${getImageFromMessage(message).file_id}`);
  const file_path = path.resolve(upload_dir, `${(new Date()).getTime()}.jpg`);
  request(`https://api.telegram.org/file/bot${token}/${JSON.parse(response.body).result.file_path}`)
    .pipe(fs.createWriteStream(file_path))
    .on("close", async () => {
      bot.editMessageText("Downloading the image...searching...", {
        chat_id: bot_message.chat.id,
        message_id: bot_message.message_id,
        parse_mode: "Markdown"
      });
      try {
        const result = await submitSearch(file_path);
        bot.editMessageText(result.text, {
          chat_id: bot_message.chat.id,
          message_id: bot_message.message_id,
          parse_mode: "Markdown"
        });
        if (result.video) {
          bot.sendChatAction(message.chat.id, "upload_video");
          bot.sendVideo(message.chat.id, result.video);
        }
      } catch (error) {
        bot.editMessageText("Server error", {
          chat_id: bot_message.chat.id,
          message_id: bot_message.message_id,
          parse_mode: "Markdown"
        });
        console.log(error);
      }
    });
};

const groupMessageHandler = async (message) => {
  if (!messageIsMentioningBot(message)) {
    return;
  }
  const responding_msg = message.reply_to_message ? message.reply_to_message : message;
  if (!getImageFromMessage(responding_msg)) {
    // cannot find image from the message mentioning the bot
    bot.sendMessage(message.chat.id, "Mention me in an anime screenshot, I will tell you what anime is that", {reply_to_message_id: message.message_id});
    return;
  }
  const response = await request(`https://api.telegram.org/bot${token}/getFile?file_id=${getImageFromMessage(responding_msg).file_id}`);
  const file_path = path.resolve(upload_dir, `${(new Date()).getTime()}.jpg`);
  request(`https://api.telegram.org/file/bot${token}/${JSON.parse(response.body).result.file_path}`)
    .pipe(fs.createWriteStream(file_path))
    .on("close", async () => {
      try {
        const result = await submitSearch(file_path);
        bot.sendMessage(message.chat.id, result.text, {
          reply_to_message_id: responding_msg.message_id,
          parse_mode: "Markdown"
        });
        if (result.video) {
          bot.sendChatAction(message.chat.id, "upload_video");
          bot.sendVideo(message.chat.id, result.video, {reply_to_message_id: responding_msg.message_id});
        }
      } catch (error) {
        console.log(error);
      }
    });
};

const messageHandler = (message) => {
  if (message.chat.type === "private") {
    privateMessageHandler(message);
  } else if (message.chat.type === "group" || message.chat.type === "supergroup") {
    groupMessageHandler(message);
  }
};

bot.setWebHook(webhook);

bot.onText(/\/start/, welcomeHandler);

bot.on("message", messageHandler);

(async () => {
  const result = await bot.getMe();
  bot_name = result.username;
  console.log(JSON.stringify(result, null, 2));
})();
