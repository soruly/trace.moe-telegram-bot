import type { Message } from "@effect-ak/tg-bot-api";

import { getTranslation } from "./i18n.ts";
import {
  botName,
  sendMessage,
  sendChatAction,
  setMessageReaction,
  sendVideo,
  answerGuestQuery,
  getImageFromMessage,
  messageIsMentioningBot,
} from "./telegram.ts";
import { submitSearch, type SearchOptions } from "./tracemoe.ts";
import { getHelpMessage, escapeMarkdownV2, enqueueUserTask } from "./utils.ts";

export const getSearchOpts = (message: Message): SearchOptions => {
  const text = message.text?.toLowerCase() ?? "";
  const caption = message.caption?.toLowerCase() ?? "";
  return {
    mute: text.includes("mute") || caption.includes("mute"),
    noCrop: text.includes("nocrop") || caption.includes("nocrop"),
    skip: text.includes("skip") || caption.includes("skip"),
  };
};

export const privateMessageHandler = async (message: Message) => {
  const userId = message.from?.id ?? 0;
  const langCode = message.from?.language_code;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const reply_msg_id = message.external_reply ? message.message_id : responding_msg.message_id;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (message.text?.toLowerCase().includes("/help")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: escapeMarkdownV2(await getHelpMessage(botName, userId, langCode)),
        parse_mode: "MarkdownV2",
      });
    }
    return await sendMessage({
      chat_id: message.chat.id,
      text: getTranslation(langCode, "welcomePrivate"),
    });
  }

  const result = await enqueueUserTask(userId, async () => {
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👌" }],
    });
    const result = await submitSearch(imageURL, userId, searchOpts, langCode);
    sendChatAction({ chat_id: message.chat.id, action: "typing" });
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    });
    return result;
  });

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && Number(video.headers.get("content-length")) > 0) {
      await sendVideo({
        chat_id: message.chat.id,
        video: videoLink,
        caption: escapeMarkdownV2(result.text),
        parse_mode: "MarkdownV2",
        reply_parameters: {
          message_id: reply_msg_id,
        },
      });
      return;
    }
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: escapeMarkdownV2(result.text),
    parse_mode: "MarkdownV2",
    reply_parameters: { message_id: reply_msg_id },
  });
};

export const groupMessageHandler = async (message: Message) => {
  const userId = message.from?.id ?? 0;
  const langCode = message.from?.language_code;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const reply_msg_id = message.external_reply ? message.message_id : responding_msg.message_id;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    if (message.text?.toLowerCase().includes("/help")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: escapeMarkdownV2(await getHelpMessage(botName, userId, langCode)),
        parse_mode: "MarkdownV2",
        reply_parameters: { message_id: message.message_id },
      });
    }
    // cannot find image from the message mentioning the bot
    return await sendMessage({
      chat_id: message.chat.id,
      text: getTranslation(langCode, "welcomeGroup"),
      reply_parameters: { message_id: message.message_id },
    });
  }

  const result = await enqueueUserTask(userId, async () => {
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👌" }],
    });
    const result = await submitSearch(imageURL, userId, searchOpts, langCode);
    sendChatAction({ chat_id: message.chat.id, action: "typing" });
    setMessageReaction({
      chat_id: message.chat.id,
      message_id: message.message_id,
      reaction: [{ type: "emoji", emoji: "👍" }],
    });
    return result;
  });

  if (result.isAdult) {
    await sendMessage({
      chat_id: message.chat.id,
      text: getTranslation(langCode, "adultResult"),
      reply_parameters: { message_id: reply_msg_id },
    });
    return;
  }

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && Number(video.headers.get("content-length")) > 0) {
      await sendVideo({
        chat_id: message.chat.id,
        video: videoLink,
        caption: escapeMarkdownV2(result.text),
        has_spoiler: responding_msg.has_media_spoiler,
        parse_mode: "MarkdownV2",
        reply_parameters: {
          message_id: reply_msg_id,
        },
      });
      return;
    }
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: escapeMarkdownV2(result.text),
    parse_mode: "MarkdownV2",
    reply_parameters: { message_id: reply_msg_id },
  });
};

export const guestMessageHandler = async (message: Message) => {
  const userId = message.from?.id ?? 0;
  const langCode = message.from?.language_code;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    // cannot find image from the message mentioning the bot
    await answerGuestQuery({
      guest_query_id: message?.guest_query_id,
      result: {
        type: "article",
        id: message?.guest_query_id,
        title: "placeholder",
        input_message_content: {
          message_text: getTranslation(langCode, "welcomeGroup"),
        },
      },
    });
    return;
  }

  const result = await enqueueUserTask(userId, async () => {
    const result = await submitSearch(imageURL, userId, searchOpts, langCode);
    return result;
  });

  if (result.isAdult) {
    await answerGuestQuery({
      guest_query_id: message?.guest_query_id,
      result: {
        type: "article",
        id: message?.guest_query_id,
        title: "placeholder",
        input_message_content: {
          message_text: getTranslation(langCode, "adultResult"),
        },
      },
    });
    return;
  }

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && Number(video.headers.get("content-length")) > 0) {
      await answerGuestQuery({
        guest_query_id: message?.guest_query_id,
        result: {
          type: "video",
          id: message?.guest_query_id,
          title: "placeholder",
          video_url: videoLink,
          mime_type: "video/mp4",
          thumbnail_url: result.image,
          caption: escapeMarkdownV2(result.text),
          parse_mode: "MarkdownV2",
        },
      });
      return;
    }
  }

  await answerGuestQuery({
    guest_query_id: message?.guest_query_id,
    result: {
      type: "article",
      id: message?.guest_query_id,
      title: "placeholder",
      input_message_content: {
        message_text: escapeMarkdownV2(result.text),
        parse_mode: "MarkdownV2",
      },
    },
  });
};
