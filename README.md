# trace.moe-telegram-bot

[![License](https://img.shields.io/github/license/soruly/trace.moe-telegram-bot.svg?style=flat-square)](https://github.com/soruly/trace.moe-telegram-bot/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/workflow/status/soruly/trace.moe-telegram-bot/Node.js%20CI?style=flat-square)](https://github.com/soruly/trace.moe-telegram-bot/actions)
[![Discord](https://img.shields.io/discord/437578425767559188.svg?style=flat-square)](https://discord.gg/K9jn6Kj)

This Telegram Bot can tell the anime when you send an screenshot to it

The bot is live on telegram now https://telegram.me/WhatAnimeBot

## Demo (YouTube)

[![](https://img.youtube.com/vi/5C9nD5dtRrY/0.jpg)](https://www.youtube.com/watch?v=5C9nD5dtRrY)

## Features

- Show anime titles in multiple languages
- Telegram group support
- Image, GIF, Video, URL support (stickers are not supported)
- Video preview

## How to use

1. Start chatting with the bot https://telegram.me/WhatAnimeBot
2. Send anime screenshots (images, gif or video) directly to the bot
3. You may also forward images from other chats to the bot
4. The bot will tell you the anime, episode, and time code of it
5. It will also send you a video preview of that scene

## How to use (in group)

1. Add the bot `@WhatAnimeBot` to your group
2. Reply to any group image, mention the bot with `@WhatAnimeBot`
3. Wait for the bot to reply

_Note that the bot has no access to your messages before it is added to your group_

## How to host the bot on your own

If you have privacy concern, you can host the bot on your own.

Please read [Telegram's official tutorial to create a Bot](https://core.telegram.org/bots) first.

You need to disable [Privacy Mode](https://core.telegram.org/bots#privacy-mode) if you want to use your bot in group chat.

### Prerequisites

- Node.js 14.x
- Redis
- git
- [pm2](https://pm2.keymetrics.io/) (optional)

### Install

Install Prerequisites first, then:

```
git clone https://github.com/soruly/trace.moe-telegram-bot.git
cd trace.moe-telegram-bot
npm install
```

### Configuration

- Copy `.env.example` to `.env`
- Edit `.env` as follows

```
SERVER_PORT=          # e.g. 3000
TELEGRAM_TOKEN=       # e.g. 111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
TELEGRAM_WEBHOOK=     # e.g. https://your.host.com/111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
TRACE_MOE_KEY=        # (optional)
REDIS_HOST=           # (optional) e.g. 127.0.0.1 or just leave blank to disable rate limit
ANILIST_API_URL=https://graphql.anilist.co/
```

### Start server

```
node server.js
```

You also can use pm2 to run this in background in cluster mode.

Use below commands to start / restart / stop server.

```
npm run start
npm run stop
npm run reload
npm run restart
npm run delete
```

To change the number of nodejs instances, edit ecosystem.config.json
