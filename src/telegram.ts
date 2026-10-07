import type {
  SendChatActionInput,
  SendMessageInput,
  SendVideoInput,
  SetMessageReactionInput,
  AnswerGuestQueryInput,
  AnswerCallbackQueryInput,
  EditMessageReplyMarkupInput,
  EditMessageTextInput,
  Message,
  PhotoSize,
  ExternalReplyInfo,
} from "@effect-ak/tg-bot-api";

import { BOT_NAME, TELEGRAM_API, TELEGRAM_TOKEN } from "./config.ts";
import { getTranslation, locales } from "./i18n.ts";

export let botName = "";
export let botNameLowerCase = "";

export const setBotName = (name: string) => {
  botName = name;
  botNameLowerCase = `@${name.toLowerCase()}`;
};

if (BOT_NAME) {
  setBotName(BOT_NAME);
}

type ServerlessApi = {
  [key: string]: (payload?: any) => Promise<any>;
};

let serverlessApi: ServerlessApi | null = null;
try {
  // @ts-expect-error Telegram Serverless provides 'sdk' module at runtime
  const sdk = await import("sdk").catch(() => null);
  if (sdk?.api) {
    serverlessApi = sdk.api;
  }
} catch {}

if (!serverlessApi && typeof (globalThis as any).api !== "undefined") {
  serverlessApi = (globalThis as any).api;
}

export const ensureBotName = async (): Promise<string> => {
  if (botName) return botName;
  if (BOT_NAME) {
    setBotName(BOT_NAME);
    return botName;
  }
  try {
    let username = "";
    if (serverlessApi && typeof serverlessApi.getMe === "function") {
      const res = await serverlessApi.getMe();
      username = res?.username ?? "";
    } else if (TELEGRAM_TOKEN) {
      const res = await fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getMe`).then((e) => e.json());
      username = res?.result?.username ?? "";
    }
    if (username) {
      setBotName(username);
    }
  } catch (err) {
    console.error("Failed to get bot info:", err);
  }
  return botName;
};

const callTelegramApi = async (method: string, payload: unknown) => {
  if (serverlessApi && typeof serverlessApi[method] === "function") {
    return await serverlessApi[method](payload);
  }
  return fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);
};

export const sendMessage = (payload: SendMessageInput) => callTelegramApi("sendMessage", payload);

export const sendChatAction = (payload: SendChatActionInput) =>
  callTelegramApi("sendChatAction", payload);

export const setMessageReaction = (payload: SetMessageReactionInput) =>
  callTelegramApi("setMessageReaction", payload);

export const sendVideo = (payload: SendVideoInput) => callTelegramApi("sendVideo", payload);

export const answerGuestQuery = (payload: AnswerGuestQueryInput) =>
  callTelegramApi("answerGuestQuery", payload);

export const answerCallbackQuery = (payload: AnswerCallbackQueryInput) =>
  callTelegramApi("answerCallbackQuery", payload);

export const editMessageReplyMarkup = (payload: EditMessageReplyMarkupInput) =>
  callTelegramApi("editMessageReplyMarkup", payload);

export const editMessageText = (payload: EditMessageTextInput) =>
  callTelegramApi("editMessageText", payload);

export const setMyCommands = (payload: {
  commands: Array<{ command: string; description: string }>;
  language_code?: string;
}) => callTelegramApi("setMyCommands", payload);

export const registerBotCommands = async () => {
  for (const langCode of Object.keys(locales)) {
    try {
      await setMyCommands({
        commands: [
          { command: "help", description: getTranslation(langCode, "helpCommandDescription") },
          { command: "lang", description: getTranslation(langCode, "langCommandDescription") },
        ],
        language_code: langCode,
      });
    } catch (err) {
      console.error(`Failed to set bot commands for ${langCode}:`, err);
    }
  }
};


export const messageIsMentioningBot = (message: Message) => {
  if (!botNameLowerCase || botNameLowerCase === "@") return false;
  if (message.entities) {
    return message.entities.some((entity) => {
      if (entity.type === "mention") {
        return (
          entity.length === botNameLowerCase.length &&
          message.text?.substring(entity.offset, entity.offset + entity.length).toLowerCase() ===
            botNameLowerCase
        );
      }
      if (entity.type === "bot_command") {
        const text = message.text
          ?.substring(entity.offset, entity.offset + entity.length)
          .toLowerCase();
        return text?.endsWith(botNameLowerCase);
      }
      return false;
    });
  }
  if (message.caption_entities) {
    return message.caption_entities.some((entity) => {
      if (entity.type === "mention") {
        return (
          entity.length === botNameLowerCase.length &&
          message.caption?.substring(entity.offset, entity.offset + entity.length).toLowerCase() ===
            botNameLowerCase
        );
      }
      if (entity.type === "bot_command") {
        const text = message.caption
          ?.substring(entity.offset, entity.offset + entity.length)
          .toLowerCase();
        return text?.endsWith(botNameLowerCase);
      }
      return false;
    });
  }
  return false;
};

// https://core.telegram.org/bots/api#photosize
export const getImageUrlFromPhotoSize = async (photoSize: PhotoSize) => {
  if (photoSize?.file_id) {
    let filePath = "";
    if (serverlessApi && typeof serverlessApi.getFile === "function") {
      const res = await serverlessApi.getFile({ file_id: photoSize.file_id });
      filePath = res?.file_path ?? "";
    } else if (TELEGRAM_TOKEN) {
      const json = await fetch(
        `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getFile?file_id=${photoSize.file_id}`,
      ).then((res) => res.json());
      filePath = json?.result?.file_path ?? "";
    }
    return filePath && TELEGRAM_TOKEN
      ? `${TELEGRAM_API}/file/bot${TELEGRAM_TOKEN}/${filePath}`
      : false;
  }
  return false;
};

export const getImageFromMessage = async (message: Message | ExternalReplyInfo) => {
  if (message.photo && message.photo.length > 0) {
    return await getImageUrlFromPhotoSize(message.photo[message.photo.length - 1]);
  }
  if (message.animation) {
    return await getImageUrlFromPhotoSize(message.animation);
  }
  if (message.video) {
    if (message.video?.file_size && message.video.file_size <= 307200) {
      return await getImageUrlFromPhotoSize(message.video);
    }
    if (message.video?.cover && message.video.cover.length > 0) {
      return await getImageUrlFromPhotoSize(message.video.cover[message.video.cover.length - 1]);
    }
    if (message.video?.thumbnail) {
      return await getImageUrlFromPhotoSize(message.video.thumbnail);
    }
  }
  if (message.sticker) {
    return await getImageUrlFromPhotoSize(message.sticker);
  }
  if (message.document?.thumbnail) {
    return await getImageUrlFromPhotoSize(message.document.thumbnail);
  }
  if (message.link_preview_options?.url) {
    return message.link_preview_options.url;
  }
  if ("entities" in message && message.entities && message.text) {
    for (const entity of message.entities) {
      if (entity.type === "url") {
        return message.text.substring(entity.offset, entity.offset + entity.length);
      }
      if (entity.type === "text_link") {
        return entity.url;
      }
    }
  }
  return false;
};
