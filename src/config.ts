try {
  process.loadEnvFile();
} catch {}

export const PORT = process.env.PORT || 3000;
export const ADDR = process.env.ADDR || "0.0.0.0";
export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
export const TELEGRAM_WEBHOOK = process.env.TELEGRAM_WEBHOOK;
export const TRACE_MOE_KEY = process.env.TRACE_MOE_KEY;
export const FILTER_ADULT = process.env.FILTER_ADULT ? process.env.FILTER_ADULT !== "false" : true;
export const BOT_NAME = process.env.BOT_NAME || process.env.TELEGRAM_BOT_NAME;

export const TELEGRAM_API = "https://api.telegram.org";

