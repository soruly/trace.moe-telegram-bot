import crypto from "node:crypto";

import type { CallbackQuery, Message } from "@effect-ak/tg-bot-api";

import { FILTER_ADULT } from "./config.ts";
import { getUserLang, setUserLang } from "./db.ts";
import { getTranslation } from "./i18n.ts";
import {
  botName,
  sendMessage,
  sendChatAction,
  setMessageReaction,
  sendVideo,
  answerGuestQuery,
  answerCallbackQuery,
  editMessageReplyMarkup,
  editMessageText,
  getImageFromMessage,
} from "./telegram.ts";
import { submitSearch, type SearchOptions, type SearchResult } from "./tracemoe.ts";
import { getHelpMessage, escapeMarkdownV2, enqueueUserTask } from "./utils.ts";

interface CachedLowSimilarityResult {
  result: SearchResult;
  searchOpts: SearchOptions;
  chatId: number | string;
  messageId: number;
  replyMsgId: number;
  hasSpoiler?: boolean;
  isGroup?: boolean;
  langCode?: string;
  timeoutId: NodeJS.Timeout;
}

const lowSimilarityCache = new Map<string, CachedLowSimilarityResult>();

export const languageSelectionKeyboard = {
  inline_keyboard: [
    [
      { text: "English", callback_data: "set_lang:en" },
      { text: "日本語", callback_data: "set_lang:ja" },
    ],
    [
      { text: "繁體中文", callback_data: "set_lang:zh-hant" },
      { text: "简体中文", callback_data: "set_lang:zh-hans" },
    ],
    [{ text: "🌐 Auto", callback_data: "set_lang:auto" }],
  ],
};

export const getSearchOpts = (message: Message): SearchOptions => {
  const text = message.text?.toLowerCase() ?? "";
  const caption = message.caption?.toLowerCase() ?? "";
  return {
    mute: text.includes("mute") || caption.includes("mute"),
    noCrop: text.includes("nocrop") || caption.includes("nocrop"),
    skip: text.includes("skip") || caption.includes("skip"),
  };
};

export const callbackQueryHandler = async (callbackQuery: CallbackQuery) => {
  const data = callbackQuery.data ?? "";
  const userId = callbackQuery.from?.id ?? 0;

  if (data.startsWith("set_lang:")) {
    const selected = data.substring("set_lang:".length);
    const newLang = selected === "auto" ? null : selected;
    setUserLang(userId, newLang);
    const effectiveLang = newLang ?? callbackQuery.from?.language_code;

    const langNameMap: Record<string, string> = {
      en: "English",
      "zh-hant": "繁體中文",
      "zh-hans": "简体中文",
      ja: "日本語",
      auto: "Auto",
    };
    const langDisplay = langNameMap[selected] ?? selected;
    const text = getTranslation(effectiveLang, "languageSet", { language: langDisplay });

    await answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text,
    });

    if (callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
      await editMessageText({
        chat_id: callbackQuery.message.chat.id,
        message_id: callbackQuery.message.message_id,
        text,
      }).catch(async () => {
        await editMessageReplyMarkup({
          chat_id: callbackQuery.message!.chat.id,
          message_id: callbackQuery.message!.message_id,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      });
    }
    return;
  }

  if (!data.startsWith("low_sim:")) {
    return;
  }
  const id = data.substring("low_sim:".length);
  const cached = lowSimilarityCache.get(id);

  if (!cached) {
    const langCode = getUserLang(userId) ?? callbackQuery.from?.language_code;
    await answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: getTranslation(langCode, "resultExpired"),
      show_alert: true,
    });
    if (callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
      await editMessageReplyMarkup({
        chat_id: callbackQuery.message.chat.id,
        message_id: callbackQuery.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    return;
  }

  clearTimeout(cached.timeoutId);
  lowSimilarityCache.delete(id);

  await answerCallbackQuery({ callback_query_id: callbackQuery.id });

  await editMessageReplyMarkup({
    chat_id: cached.chatId,
    message_id: cached.messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch((e) => console.error("Failed to remove inline button on click:", e));

  const { result, searchOpts, chatId, replyMsgId, hasSpoiler, isGroup, langCode } = cached;

  if (isGroup && FILTER_ADULT && result.isAdult) {
    await sendMessage({
      chat_id: chatId,
      text: getTranslation(langCode, "adultResult"),
      reply_parameters: { message_id: replyMsgId },
    });
    return;
  }

  if (result.video && !searchOpts.skip) {
    const videoLink = searchOpts.mute ? `${result.video}&mute` : result.video;
    const video = await fetch(videoLink, { method: "HEAD" });
    if (video.ok && Number(video.headers.get("content-length")) > 0) {
      await sendVideo({
        chat_id: chatId,
        video: videoLink,
        caption: escapeMarkdownV2(result.text),
        has_spoiler: hasSpoiler,
        parse_mode: "MarkdownV2",
        reply_parameters: {
          message_id: replyMsgId,
        },
      });
      return;
    }
  }

  await sendMessage({
    chat_id: chatId,
    text: escapeMarkdownV2(result.text),
    parse_mode: "MarkdownV2",
    reply_parameters: { message_id: replyMsgId },
  });
};

export const privateMessageHandler = async (message: Message) => {
  const userId = message.from?.id ?? 0;
  const langCode = getUserLang(userId) ?? message.from?.language_code;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const reply_msg_id = message.external_reply ? message.message_id : responding_msg.message_id;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    const text = (message.text ?? message.caption)?.toLowerCase() ?? "";
    if (text.includes("/help")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: escapeMarkdownV2(await getHelpMessage(botName, userId, message.from?.language_code)),
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
    }
    if (text.includes("/lang") || text.includes("/setlang")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: getTranslation(langCode, "selectLanguage"),
        reply_markup: languageSelectionKeyboard,
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

  if (result.lowSimilarity) {
    const id = crypto.randomBytes(16).toString("hex");
    const sentMsg = await sendMessage({
      chat_id: message.chat.id,
      text: escapeMarkdownV2(getTranslation(langCode, "apiNoResults")),
      parse_mode: "MarkdownV2",
      reply_parameters: { message_id: reply_msg_id },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: getTranslation(langCode, "showLowSimilarityResult"),
              callback_data: `low_sim:${id}`,
            },
          ],
        ],
      },
    });

    if (sentMsg?.message_id) {
      const timeoutId = setTimeout(
        () => {
          lowSimilarityCache.delete(id);
          editMessageReplyMarkup({
            chat_id: message.chat.id,
            message_id: sentMsg.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch((e) => console.error("Failed to remove expired inline button:", e));
        },
        5 * 60 * 1000,
      );

      lowSimilarityCache.set(id, {
        result,
        searchOpts,
        chatId: message.chat.id,
        messageId: sentMsg.message_id,
        replyMsgId: reply_msg_id,
        langCode,
        timeoutId,
      });
    }
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
  const langCode = getUserLang(userId) ?? message.from?.language_code;
  const searchOpts = getSearchOpts(message);
  const responding_msg = message.reply_to_message
    ? message.reply_to_message
    : message.external_reply
      ? message.external_reply
      : message;
  const reply_msg_id = message.external_reply ? message.message_id : responding_msg.message_id;
  const imageURL = await getImageFromMessage(responding_msg);
  if (!imageURL) {
    const text = (message.text ?? message.caption)?.toLowerCase() ?? "";
    if (text.includes("/help")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: escapeMarkdownV2(await getHelpMessage(botName, userId, message.from?.language_code)),
        parse_mode: "MarkdownV2",
        reply_parameters: { message_id: message.message_id },
        link_preview_options: { is_disabled: true },
      });
    }
    if (text.includes("/lang") || text.includes("/setlang")) {
      return await sendMessage({
        chat_id: message.chat.id,
        text: getTranslation(langCode, "selectLanguage"),
        reply_parameters: { message_id: message.message_id },
        reply_markup: languageSelectionKeyboard,
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

  if (result.lowSimilarity) {
    const id = crypto.randomBytes(16).toString("hex");
    const sentMsg = await sendMessage({
      chat_id: message.chat.id,
      text: escapeMarkdownV2(getTranslation(langCode, "apiNoResults")),
      parse_mode: "MarkdownV2",
      reply_parameters: { message_id: reply_msg_id },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: getTranslation(langCode, "showLowSimilarityResult"),
              callback_data: `low_sim:${id}`,
            },
          ],
        ],
      },
    });

    if (sentMsg?.message_id) {
      const timeoutId = setTimeout(
        () => {
          lowSimilarityCache.delete(id);
          editMessageReplyMarkup({
            chat_id: message.chat.id,
            message_id: sentMsg.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch((e) => console.error("Failed to remove expired inline button:", e));
        },
        5 * 60 * 1000,
      );

      lowSimilarityCache.set(id, {
        result,
        searchOpts,
        chatId: message.chat.id,
        messageId: sentMsg.message_id,
        replyMsgId: reply_msg_id,
        hasSpoiler: responding_msg.has_media_spoiler,
        isGroup: true,
        langCode,
        timeoutId,
      });
    }
    return;
  }

  if (FILTER_ADULT && result.isAdult) {
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
  const langCode = getUserLang(userId) ?? message.from?.language_code;
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

  if (result.lowSimilarity) {
    await answerGuestQuery({
      guest_query_id: message?.guest_query_id,
      result: {
        type: "article",
        id: message?.guest_query_id,
        title: "placeholder",
        input_message_content: {
          message_text: escapeMarkdownV2(getTranslation(langCode, "apiNoResults")),
          parse_mode: "MarkdownV2",
        },
      },
    });
    return;
  }

  if (FILTER_ADULT && result.isAdult) {
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
