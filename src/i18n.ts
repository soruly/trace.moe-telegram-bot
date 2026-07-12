export interface LocaleStrings {
  helpBotName: string;
  helpRevision: string;
  helpApiKey: string;
  helpHomepage: string;
  helpSearchCount: string;
  apiError: string;
  apiBusy: string;
  apiLimitExceeded: string;
  apiNoResults: string;
  welcomePrivate: string;
  welcomeGroup: string;
  adultResult: string;
}

export const defaultLocale: LocaleStrings = {
  helpBotName: "Bot Name: {botName}",
  helpRevision: "Revision: `{revision}`",
  helpApiKey: "Use trace.moe with API Key? `{hasKey}`",
  helpHomepage: "Homepage: {homepage}",
  helpSearchCount: "Your search count (last 30 days): {count}",
  apiError: "`trace.moe API error, please try again later.`",
  apiBusy: "`trace.moe server is busy, please try again later.`",
  apiLimitExceeded: "`You exceeded the search limit, please try again later`",
  apiNoResults: "Cannot find any results from trace.moe",
  welcomePrivate: "You can Send or Forward anime screenshots to me",
  welcomeGroup: "Mention me in an anime screenshot, I will tell you what anime is that",
  adultResult: "I've found an adult result 😳\nPlease forward it to me via Private Chat 😏",
};

const zhHansLocale: LocaleStrings = {
  helpBotName: "机器人名称: {botName}",
  helpRevision: "版本: `{revision}`",
  helpApiKey: "是否使用 trace.moe API Key? `{hasKey}`",
  helpHomepage: "主页: {homepage}",
  helpSearchCount: "您最近 30 天的搜索次数: {count}",
  apiError: "`trace.moe API 错误，请稍后再试。`",
  apiBusy: "`trace.moe 服务器繁忙，请稍后再试。`",
  apiLimitExceeded: "`您已超出搜索限制，请稍后再试`",
  apiNoResults: "无法在 trace.moe 中找到任何结果",
  welcomePrivate: "您可以发送或转发动漫截图给我",
  welcomeGroup: "在动漫截图中提及我，我会告诉您那是哪部动漫",
  adultResult: "我找到了一个成人内容结果 😳\n请通过私聊转发给我 😏",
};

const zhHantLocale: LocaleStrings = {
  helpBotName: "機器人名稱: {botName}",
  helpRevision: "版本: `{revision}`",
  helpApiKey: "是否使用 trace.moe API Key? `{hasKey}`",
  helpHomepage: "主頁: {homepage}",
  helpSearchCount: "您最近 30 天的搜尋次數: {count}",
  apiError: "`trace.moe API 錯誤，請稍後再試。`",
  apiBusy: "`trace.moe 伺服器繁忙，請稍後再試。`",
  apiLimitExceeded: "`您已超出搜尋限制，請稍後再試`",
  apiNoResults: "無法在 trace.moe 中找到任何結果",
  welcomePrivate: "您可以發送或轉發動漫截圖給我",
  welcomeGroup: "在動漫截圖中提及我，我會告訴您那是哪部動漫",
  adultResult: "我找到了一個成人內容結果 😳\n請通過私聊轉發給我 😏",
};

const jaLocale: LocaleStrings = {
  helpBotName: "ボット名: {botName}",
  helpRevision: "リビジョン: `{revision}`",
  helpApiKey: "trace.moe APIキーを使用中? `{hasKey}`",
  helpHomepage: "ホームページ: {homepage}",
  helpSearchCount: "検索回数 (過去30日間): {count}",
  apiError: "`trace.moe APIエラーが発生しました。時間をおいてもう一度お試しください。`",
  apiBusy: "`trace.moe サーバーが混雑しています。時間をおいてもう一度お試しください。`",
  apiLimitExceeded: "`検索制限を超過しました。時間をおいてもう一度お試しください`",
  apiNoResults: "trace.moe で結果が見つかりませんでした",
  welcomePrivate: "アニメのスクリーンショットを送信または転送してください",
  welcomeGroup: "アニメのスクリーンショットで私をメンションすると、どのアニメかお答えします",
  adultResult: "成人向けの結果が見つかりました 😳\nプライベートチャットで転送してください 😏",
};

export const locales: Record<string, Partial<LocaleStrings>> = {
  en: defaultLocale,
  "zh-hans": zhHansLocale,
  "zh-cn": zhHansLocale,
  "zh-sg": zhHansLocale,
  zh: zhHansLocale,
  "zh-hant": zhHantLocale,
  "zh-tw": zhHantLocale,
  "zh-hk": zhHantLocale,
  ja: jaLocale,
};

export const getTranslation = (
  langCode: string | undefined,
  key: keyof LocaleStrings,
  params: Record<string, string | number> = {},
): string => {
  const code = langCode ? langCode.toLowerCase() : "en";
  const primaryCode = code.split("-")[0];
  const strings = locales[code] || locales[primaryCode] || defaultLocale;
  let text = strings[key] || defaultLocale[key];
  for (const [paramKey, paramValue] of Object.entries(params)) {
    text = text.replaceAll(`{${paramKey}}`, String(paramValue));
  }
  return text;
};
