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

export const locales: Record<string, Partial<LocaleStrings>> = {
  en: defaultLocale,
};

export const getTranslation = (
  langCode: string | undefined,
  key: keyof LocaleStrings,
  params: Record<string, string | number> = {},
): string => {
  const code = langCode ? langCode.split("-")[0].toLowerCase() : "en";
  const strings = locales[code] || defaultLocale;
  let text = strings[key] || defaultLocale[key];
  for (const [paramKey, paramValue] of Object.entries(params)) {
    text = text.replaceAll(`{${paramKey}}`, String(paramValue));
  }
  return text;
};
