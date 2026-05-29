import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContextOptions } from "playwright";

chromiumExtra.use(StealthPlugin());

let browserPromise: Promise<Browser> | null = null;

export const DEFAULT_CONTEXT_OPTIONS: BrowserContextOptions = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  viewport: { width: 1366, height: 768 },
  extraHTTPHeaders: {
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  },
};

export function isOlxHost(hostname: string): boolean {
  return hostname.toLowerCase().includes("olx.com.br");
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromiumExtra.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    const close = async () => {
      try {
        const current = browserPromise;
        if (!current) return;
        const browser = await current;
        await browser.close();
      } catch {
      } finally {
        browserPromise = null;
      }
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }
  return browserPromise;
}
