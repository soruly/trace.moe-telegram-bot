process.loadEnvFile();

export const PORT = process.env.PORT || 3000;
export const ADDR = process.env.ADDR || "0.0.0.0";
export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
export const TELEGRAM_WEBHOOK = process.env.TELEGRAM_WEBHOOK;
export const TRACE_MOE_KEY = process.env.TRACE_MOE_KEY;

export const TELEGRAM_API = "https://api.telegram.org";

if (!TELEGRAM_TOKEN || !TELEGRAM_WEBHOOK) {
  console.log("Please configure TELEGRAM_TOKEN and TELEGRAM_WEBHOOK first");
  process.exit();
}
