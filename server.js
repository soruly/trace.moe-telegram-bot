var TelegramBot = require('node-telegram-bot-api');
var request = require('request');
var querystring = require('querystring')
var fs = require('fs');
var path = require('path');
const Datauri = require('datauri');

var config = require('./config');

var options = {
  webHook: {
    port: config.port
  },
  polling: false
};

var token = config.token;
var bot = new TelegramBot(token, options);
bot.setWebHook(config.webhook);

bot.onText(/\/start (.+)/, function (msg, match) {
  var fromId = msg.from.id;
  var resp = match[1];
});

bot.onText(/\/start/, function (msg) {
  var fromId = msg.from.id;
  bot.sendMessage(fromId, "You can Send / Forward anime screenshots to me. I can't get images from URLs, please send the image directly to me ;)");
});

bot.on('message', function (msg) {
  var chatId = msg.chat.id;
  var photo = 'cats.png';
  if(msg.photo){
    bot.sendMessage(chatId, "Downloading your image...");
    let largest_file = msg.photo.pop();
    request('https://api.telegram.org/bot'+token+'/getFile?file_id='+largest_file.file_id, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        let file = JSON.parse(body);
        //console.log(file.result.file_path);
        let url = 'https://api.telegram.org/file/bot'+token+'/'+file.result.file_path;
        let milliseconds = (new Date).getTime()
        let file_path = path.resolve(__dirname,'uploads',milliseconds+'.jpg');
        request({uri: url})
          .pipe(fs.createWriteStream(file_path))
          .on('close', function() {

            bot.sendMessage(chatId, "I've got your image, searching...");

            var datauri = new Datauri(file_path);
            var formData = querystring.stringify({image: datauri.content});
            var contentLength = formData.length;


            request({
              headers: {
                'Content-Length': contentLength,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              uri: 'https://whatanime.ga/api/search?token='+config.whatanime_token,
              body: formData,
              method: 'POST'
            }, function (error, response, body) {
              if (error) {
                console.log('Error sending message: ', error)
              } else if (response.body.error) {
                console.log('Error: ', response.body.error)
              }
              else if (response.statusCode == 429) {
                bot.sendMessage(chatId, "Bot search limit exceeded, please try again later.");
              } else {
                try {
                  var resultBody = JSON.parse(body);
                }
                catch(err) {
                  console.log(response.statusCode);
                  console.log(response.body);
                }
                var searchResult = JSON.parse(body)
                if (searchResult.docs) {
                  if (searchResult.docs.length > 0) {
                    var src = searchResult.docs[0]
                    var similarity = (src.similarity*100).toFixed(1)
                    var text = ''
                    if (similarity >= 0.88) {
                      text = src.title + '\n'
                      text += src.title_chinese + '\n'
                      text += src.title_english + '\n'
                      text += 'EP#' + zeroPad(src.episode, 2) + ' ' + formatTime(src.at) + '\n'
                      text += '' + similarity + '% similarity\n'
                    } else {
                      text = "Sorry, I don't know what anime is it :\\"
                    }
                    bot.sendMessage(chatId, text);
                    
                    var videoLink = 'https://whatanime.ga/preview.php?season=' + encodeURIComponent(src.season) + '&anime=' + encodeURIComponent(src.anime) + '&file=' + encodeURIComponent(src.filename) + '&t=' + (src.at) + '&token=' + src.tokenthumb;
                    bot.sendVideo(chatId, videoLink);

                  } else {
                    bot.sendMessage(chatId, "Sorry, I don't know what anime is it :\\");
                  }
                }
              }
            })


          });
      }
    })

  }
});


var zeroPad = function (n, width, z) {
  z = z || '0'
  n = n + ''
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n
}


var formatTime = function (timeInSeconds) {
  var sec_num = parseInt(timeInSeconds, 10)
  var hours = Math.floor(sec_num / 3600)
  var minutes = Math.floor((sec_num - (hours * 3600)) / 60)
  var seconds = sec_num - (hours * 3600) - (minutes * 60)

  if (hours < 10) {hours = '0' + hours;}
  if (minutes < 10) {minutes = '0' + minutes;}
  if (seconds < 10) {seconds = '0' + seconds;}
  var timestring = hours + ':' + minutes + ':' + seconds

  return timestring
}

