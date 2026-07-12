import { TRACE_MOE_KEY } from "./config.ts";
import { insert } from "./db.ts";
import { getTranslation } from "./i18n.ts";
import { formatTime, escapeCode } from "./utils.ts";

export interface AnilistTitle {
  native: string | null;
  romaji: string | null;
  english: string | null;
  chinese: string | null;
}

export interface AnilistInfo {
  id: number;
  idMal: number;
  title: AnilistTitle;
  synonyms: string[];
  isAdult: boolean;
}

export interface APISearchResult {
  anilist: AnilistInfo;
  filename: string;
  episode: any;
  duration: number;
  from: number;
  to: number;
  at: number;
  similarity: number;
  video: string;
  image: string;
}

export interface SearchResult {
  isAdult?: boolean;
  text: string;
  video?: string;
  image?: string;
}

export interface SearchOptions {
  mute: boolean;
  noCrop: boolean;
  skip: boolean;
}

export const submitSearch = async (
  imageFileURL: string,
  userId: number,
  opts: SearchOptions,
  langCode?: string,
): Promise<SearchResult> => {
  let trial = 5;
  let response = null;
  while (trial > 0 && (!response || response.status === 503 || response.status === 402)) {
    trial--;
    try {
      response = await fetch(
        `https://api.trace.moe/search?${[
          "anilistInfo=1",
          `url=${encodeURIComponent(imageFileURL)}`,
          opts.noCrop ? "" : "cutBorders=1",
        ].join("&")}`,
        TRACE_MOE_KEY ? { headers: { "x-trace-key": TRACE_MOE_KEY } } : {},
      );
    } catch (e) {
      trial = 0;
      return { text: getTranslation(langCode, "apiError") };
    }
    if (!response) {
      trial = 0;
      return { text: getTranslation(langCode, "apiError") };
    }
    insert.run({ $user_id: userId, $code: response.status });
    if (response.status === 503 || response.status === 402) {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4000) + 1000));
    } else trial = 0;
  }
  if (!response) {
    return { text: getTranslation(langCode, "apiError") };
  }

  if ([502, 503, 504].includes(response.status)) {
    return { text: getTranslation(langCode, "apiBusy") };
  }
  if (response.status === 402 || response.status === 429) {
    return { text: getTranslation(langCode, "apiLimitExceeded") };
  }
  if (response.status >= 400) {
    console.error(await response.text());
    return { text: getTranslation(langCode, "apiError") };
  }
  const searchResult = await response.json();
  if (response.status >= 400 || searchResult.error) {
    console.error(searchResult.error || (await response.text()));
    return { text: getTranslation(langCode, "apiError") };
  }
  if (searchResult?.result?.length <= 0) {
    return { text: getTranslation(langCode, "apiNoResults") };
  }
  const { anilist, similarity, filename, from, to, video, image }: APISearchResult =
    searchResult.result[0];
  const { title: { chinese, english, native, romaji } = {}, isAdult } = anilist ?? {};
  const code = langCode ? langCode.toLowerCase() : "en";
  const isEn = code.startsWith("en");
  const isZh = code.startsWith("zh");
  const isJa = code.startsWith("ja");

  let text = "";
  const titles: string[] = [];
  if (native) titles.push(native);
  if (chinese && isZh && !titles.includes(chinese)) titles.push(chinese);
  if (romaji && !titles.includes(romaji)) {
    if (!(isZh || isJa) || titles.length === 0) titles.push(romaji);
  }
  if (english && isEn && !titles.includes(english)) titles.push(english);

  text += titles.map((t) => `\`${escapeCode(t)}\``).join("\n");
  text += "\n";
  text += `\`${escapeCode(filename)}\`\n`;
  if (formatTime(from) === formatTime(to)) {
    text += `\`${formatTime(from)}\`\n`;
  } else {
    text += `\`${formatTime(from)}\` - \`${formatTime(to)}\`\n`;
  }
  text += `\`${(similarity * 100).toFixed(1)}% similarity\`\n`;
  const url = new URL(video);
  const urlSearchParams = new URLSearchParams(url.search);
  urlSearchParams.set("size", "l");
  url.search = urlSearchParams.toString();
  return {
    isAdult,
    text,
    video: url.toString(),
    image: image,
  };
};
