import type {
  SendChatActionInput,
  SendMessageInput,
  SendVideoInput,
  SetMessageReactionInput,
  AnswerGuestQueryInput,
  Message,
  PhotoSize,
  ExternalReplyInfo,
} from "@effect-ak/tg-bot-api";

import { TELEGRAM_API, TELEGRAM_TOKEN } from "./config.ts";

export let botName = "";
export let botNameLowerCase = "";

export const setBotName = (name: string) => {
  botName = name;
  botNameLowerCase = `@${name.toLowerCase()}`;
};

export const sendMessage = (payload: SendMessageInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

export const sendChatAction = (payload: SendChatActionInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

export const setMessageReaction = (payload: SetMessageReactionInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/setMessageReaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

export const sendVideo = (payload: SendVideoInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

export const answerGuestQuery = (payload: AnswerGuestQueryInput) =>
  fetch(`${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/answerGuestQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((e) => e.json())
    .then((e) => e.result);

export const messageIsMentioningBot = (message: Message) => {
  if (message.entities) {
    return message.entities.some(
      (entity) =>
        entity.type === "mention" &&
        entity.length === botNameLowerCase.length &&
        message.text.substring(entity.offset, entity.offset + entity.length).toLowerCase() ===
          botNameLowerCase,
    );
  }
  if (message.caption_entities) {
    return message.caption_entities.some(
      (entity) =>
        entity.type === "mention" &&
        entity.length === botNameLowerCase.length &&
        message.caption.substring(entity.offset, entity.offset + entity.length).toLowerCase() ===
          botNameLowerCase,
    );
  }
  return false;
};

// https://core.telegram.org/bots/api#photosize
export const getImageUrlFromPhotoSize = async (photoSize: PhotoSize) => {
  if (photoSize?.file_id) {
    const json = await fetch(
      `${TELEGRAM_API}/bot${TELEGRAM_TOKEN}/getFile?file_id=${photoSize.file_id}`,
    ).then((res) => res.json());
    return json?.result?.file_path
      ? `${TELEGRAM_API}/file/bot${TELEGRAM_TOKEN}/${json.result.file_path}`
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
