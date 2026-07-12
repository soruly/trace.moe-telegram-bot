import child_process from "node:child_process";

import packageConfig from "../package.json" with { type: "json" };
import { TRACE_MOE_KEY } from "./config.ts";
import { select } from "./db.ts";
import { getTranslation } from "./i18n.ts";

let REVISION: string;
try {
  REVISION = child_process.execSync("git rev-parse HEAD").toString().trim();
} catch (e) {
  REVISION = "";
}

export { REVISION };

export const getHelpMessage = async (botName: string, fromId: number, langCode?: string) => {
  const countObj = select.get({ $user_id: fromId }) as { count: number } | undefined;
  const count = countObj ? countObj.count : 0;
  return [
    getTranslation(langCode, "helpBotName", { botName: botName ? `@${botName}` : "(unknown)" }),
    getTranslation(langCode, "helpRevision", { revision: REVISION.substring(0, 7) }),
    getTranslation(langCode, "helpApiKey", { hasKey: TRACE_MOE_KEY ? "true" : "false" }),
    getTranslation(langCode, "helpHomepage", { homepage: packageConfig.homepage ?? "" }),
    getTranslation(langCode, "helpSearchCount", { count }),
  ]
    .filter((e) => e)
    .join("\n");
};

export const escapeMarkdownV2 = (text: string) =>
  text.replace(/([\_\*\[\]\(\)\~\>\#\+\-\=\|\{\}\.\!])/g, "\\$1");

export const escapeCode = (text: string) => text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");

export const formatTime = (duration: number) => {
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration - hours * 3600) / 60);
  const seconds = Math.floor(duration - hours * 3600 - minutes * 60);
  return [hours, minutes, seconds].map((t) => t.toString().padStart(2, "0")).join(":");
};

const queue = new Map<number, Promise<any>>();

export const enqueueUserTask = async <T>(userId: number, task: () => Promise<T>): Promise<T> => {
  const previous = queue.get(userId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);

  const storedPromise = current.finally(() => {
    if (queue.get(userId) === storedPromise) queue.delete(userId);
  });
  queue.set(userId, storedPromise);
  return current;
};
