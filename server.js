const TelegramBot = require("node-telegram-bot-api");
const request = require("requestretry");
const querystring = require("querystring");
const fs = require("fs");
const path = require("path");
const Datauri = require("datauri");

const config = require("./config");

const options = {
  webHook: {
    port: config.port
  },
  polling: false
};

const upload_dir = path.resolve(__dirname, "uploads");
if (!fs.existsSync(upload_dir)) {
  fs.mkdirSync(upload_dir);
}

const token = config.token;
const bot = new TelegramBot(token, options);
bot.setWebHook(config.webhook);

bot.getMe().then(function (result) {
  config.username = result.username;
  console.log(result);
});

const zeroPad = function (n, width, z) {
  z = z || "0";
  n = n + "";
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
};

const formatTime = function (timeInSeconds) {
  const sec_num = parseInt(timeInSeconds, 10);
  let hours = Math.floor(sec_num / 3600);
  let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
  let seconds = sec_num - (hours * 3600) - (minutes * 60);

  if (hours < 10) {
    hours = "0" + hours;
  }
  if (minutes < 10) {
    minutes = "0" + minutes;
  }
  if (seconds < 10) {
    seconds = "0" + seconds;
  }

  return hours + ":" + minutes + ":" + seconds;
};

const welcomeHandler = function (message) {
  bot.sendMessage(message.from.id, "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)");
};

const submitSearch = function (file_path) {
  return new Promise((resolve, reject) => {
    const datauri = new Datauri(file_path);
    const formData = querystring.stringify({image: datauri.content});
    const contentLength = formData.length;
    request({
      headers: {
        "Content-Length": contentLength,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      uri: "https://whatanime.ga/api/search?token=" + config.whatanime_token,
      body: formData,
      method: "POST"
    })
      .then(function (response) {
        const searchResult = JSON.parse(response.body);
        if (searchResult.docs) {
          if (searchResult.docs.length > 0) {
            const src = searchResult.docs[0];
            const similarity = (src.similarity * 100).toFixed(1);
            let text = "";
            if (src.similarity < 0.92) {
              text = "I have low confidence on this, wild guess:" + "\n";
            }
            text += "```";
            text += src.title + "\n";
            text += src.title_chinese + "\n";
            text += src.title_english + "\n";
            text += "EP#" + zeroPad(src.episode, 2) + " " + formatTime(src.at) + "\n";
            text += "" + similarity + "% similarity";
            text += "```";
            const videoLink = "https://whatanime.ga/preview.php?season=" + encodeURIComponent(src.season) + "&anime=" + encodeURIComponent(src.anime) + "&file=" + encodeURIComponent(src.filename) + "&t=" + (src.at) + "&token=" + src.tokenthumb;
            resolve({text: text, video: videoLink});
          } else {
            resolve({text: "Sorry, I don't know what anime is it :\\"});
          }
        }
      })
      .catch(function (error) {
        reject(error);
      });
  });
};

const messageIsMentioningBot = (message) =>
  message.entities ? message.entities
    .filter(entity => entity.type === "mention")
    .map(entity => message.text.substr(entity.offset, entity.length))
    .filter(entity => entity === `@${config.username}`)
    .length >= 1
    : false;

// The return type is PhotoSize
// https://core.telegram.org/bots/api#photosize
const getImageFromMessage = function (message) {
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

const messageHandler = function (message) {
  if (message.chat.type === "private") {
    if (getImageFromMessage(message)) {
      bot.sendMessage(message.chat.id, "Downloading the image...", {reply_to_message_id: message.message_id, parse_mode: "Markdown"})
        .then(function (bot_message) {
          request("https://api.telegram.org/bot" + token + "/getFile?file_id=" + getImageFromMessage(message).file_id)
            .then(function (response) {
              const file_path = path.resolve(upload_dir, (new Date).getTime() + ".jpg");
              request("https://api.telegram.org/file/bot" + token + "/" + JSON.parse(response.body).result.file_path)
                .pipe(fs.createWriteStream(file_path))
                .on("close", function () {
                  bot.editMessageText("Downloading the image...searching...", {chat_id: bot_message.chat.id, message_id: bot_message.message_id, parse_mode: "Markdown"});
                  submitSearch(file_path)
                    .then(function (result) {
                      bot.editMessageText(result.text, {chat_id: bot_message.chat.id, message_id: bot_message.message_id, parse_mode: "Markdown"});
                      if (result.video) {
                        bot.sendVideo(message.chat.id, result.video);
                      }
                    })
                    .catch(function (error) {
                      console.log(error);
                    });
                });
            });
        });
    } else {
      bot.sendMessage(message.from.id, "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)");
    }

  } else if ((message.chat.type === "group" || message.chat.type === "supergroup") && messageIsMentioningBot(message)) {
    if (message.reply_to_message && getImageFromMessage(message.reply_to_message)) {
      request("https://api.telegram.org/bot" + token + "/getFile?file_id=" + getImageFromMessage(message.reply_to_message).file_id)
        .then(function (response) {
          const file_path = path.resolve(upload_dir, (new Date).getTime() + ".jpg");
          request("https://api.telegram.org/file/bot" + token + "/" + JSON.parse(response.body).result.file_path)
            .pipe(fs.createWriteStream(file_path))
            .on("close", function () {
              submitSearch(file_path)
                .then(function (result) {
                  bot.sendMessage(message.chat.id, result.text, {reply_to_message_id: message.reply_to_message.message_id, parse_mode: "Markdown"});
                  if (result.video) {
                    bot.sendVideo(message.chat.id, result.video, {reply_to_message_id: message.reply_to_message.message_id});
                  }
                })
                .catch(function (error) {
                  console.log(error);
                });
            });
        });
    } else {
      bot.sendMessage(message.chat.id, "Mention me in an anime screenshot, I will tell you what anime is that", {reply_to_message_id: message.message_id});
    }
  }
};

bot.onText(/\/start/, welcomeHandler);

bot.on("message", messageHandler);