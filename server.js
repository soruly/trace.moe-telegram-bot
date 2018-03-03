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

const formatTime = function (timeInSeconds) {
  const sec_num = parseInt(timeInSeconds, 10);
  const hours = Math.floor(sec_num / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((sec_num - (hours * 3600)) / 60).toString().padStart(2, "0");
  const seconds = (sec_num - (hours * 3600) - (minutes * 60)).toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
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
      uri: `https://whatanime.ga/api/search?token=${config.whatanime_token}`,
      body: formData,
      method: "POST"
    })
      .then(function (response) {
        try {
          const searchResult = JSON.parse(response.body);
          if (searchResult.docs) {
            if (searchResult.docs.length > 0) {
              const {
                similarity,
                title,
                title_english,
                title_chinese,
                title_romaji,
                season,
                anime,
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
              ].filter(e=>e).reduce(
                (acc, cur) => acc.map(e => e.toLowerCase()).includes(cur.toLowerCase()) ? acc : [...acc, cur],
                []
              ).join("\n");
              text += "\n";
              text += `EP#${episode.toString().padStart(2, "0")} ${formatTime(at)}\n`;
              text += `${(similarity * 100).toFixed(1)}% similarity\n`;
              text += "```";
              const videoLink = `https://whatanime.ga/preview.php?season=${encodeURIComponent(season)}&anime=${encodeURIComponent(anime)}&file=${encodeURIComponent(filename)}&t=${at}&token=${tokenthumb}`;
              resolve({text: text, video: videoLink});
            } else {
              resolve({text: "Sorry, I don't know what anime is it :\\"});
            }
          }
        } catch (e) {
          resolve({text: "Backend server error, please try again later."});
        }
      })
      .catch(function (error) {
        reject(error);
      });
  });
};

const messageIsMentioningBot = (message) => {
  if (message.entities) {
    return message.entities
      .filter(entity => entity.type === "mention")
      .map(entity => message.text.substr(entity.offset, entity.length))
      .filter(entity => entity === `@${config.username}`)
      .length >= 1;
  }
  if (message.caption) {
    // Telegram does not provide entities when mentioning the bot in photo caption
    return message.caption === `@${config.username}`;
  }
  return false;
};

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
      bot.sendChatAction(message.chat.id, "typing");
      bot.sendMessage(message.chat.id, "Downloading the image...", {reply_to_message_id: message.message_id, parse_mode: "Markdown"})
        .then(function (bot_message) {
          bot.sendChatAction(message.chat.id, "typing");
          request(`https://api.telegram.org/bot${token}/getFile?file_id=${getImageFromMessage(message).file_id}`)
            .then(function (response) {
              bot.sendChatAction(message.chat.id, "typing");
              const file_path = path.resolve(upload_dir, `${(new Date).getTime()}.jpg`);
              request(`https://api.telegram.org/file/bot${token}/${JSON.parse(response.body).result.file_path}`)
                .pipe(fs.createWriteStream(file_path))
                .on("close", function () {
                  bot.editMessageText("Downloading the image...searching...", {chat_id: bot_message.chat.id, message_id: bot_message.message_id, parse_mode: "Markdown"});
                  bot.sendChatAction(message.chat.id, "typing");
                  const chatAction_handler = setInterval(()=>{
                    bot.sendChatAction(message.chat.id, "typing");
                  }, 4000);
                  submitSearch(file_path)
                    .then(function (result) {
                      clearInterval(chatAction_handler);
                      bot.editMessageText(result.text, {chat_id: bot_message.chat.id, message_id: bot_message.message_id, parse_mode: "Markdown"});
                      if (result.video) {
                        bot.sendChatAction(message.chat.id, "upload_video");
                        bot.sendVideo(message.chat.id, result.video);
                      }
                    })
                    .catch(function (error) {
                      clearInterval(chatAction_handler);
                      bot.editMessageText("Server error", {chat_id: bot_message.chat.id, message_id: bot_message.message_id, parse_mode: "Markdown"});
                      console.log(error);
                    });
                });
            });
        });
    } else {
      bot.sendMessage(message.from.id, "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)");
    }

  } else if ((message.chat.type === "group" || message.chat.type === "supergroup")) {
    if (messageIsMentioningBot(message)) {
      bot.sendChatAction(message.chat.id, "typing");
      const responding_message = message.reply_to_message ? message.reply_to_message : message;
      if (getImageFromMessage(responding_message)) {
        request(`https://api.telegram.org/bot${token}/getFile?file_id=${getImageFromMessage(responding_message).file_id}`)
          .then(function (response) {
            bot.sendChatAction(message.chat.id, "typing");
            const file_path = path.resolve(upload_dir, `${(new Date).getTime()}.jpg`);
            request(`https://api.telegram.org/file/bot${token}/${JSON.parse(response.body).result.file_path}`)
              .pipe(fs.createWriteStream(file_path))
              .on("close", function () {
                bot.sendChatAction(message.chat.id, "typing");
                const chatAction_handler = setInterval(()=>{
                  bot.sendChatAction(message.chat.id, "typing");
                }, 4000);
                submitSearch(file_path)
                  .then(function (result) {
                    clearInterval(chatAction_handler);
                    bot.sendMessage(message.chat.id, result.text, {reply_to_message_id: responding_message.message_id, parse_mode: "Markdown"});
                    if (result.video) {
                      bot.sendChatAction(message.chat.id, "upload_video");
                      bot.sendVideo(message.chat.id, result.video, {reply_to_message_id: responding_message.message_id});
                    }
                  })
                  .catch(function (error) {
                    clearInterval(chatAction_handler);
                    console.log(error);
                  });
              });
          });
      } else {
        // cannot find image from the message mentioning the bot
        bot.sendMessage(message.chat.id, "Mention me in an anime screenshot, I will tell you what anime is that", {reply_to_message_id: message.message_id});
      }
    }
  }
};

bot.onText(/\/start/, welcomeHandler);

bot.on("message", messageHandler);
