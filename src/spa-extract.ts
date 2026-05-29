import type { Page } from "playwright";

export function isCloudflareBlocked(title: string, bodyText: string): boolean {
  const combined = `${title}\n${bodyText}`.toLowerCase();
  return (
    /attention required/.test(combined) ||
    /cloudflare/.test(combined) ||
    /you have been blocked/.test(combined) ||
    /cf-browser-verification/.test(combined) ||
    /sorry,\s*you have been blocked/.test(combined)
  );
}

export function isGenericSiteTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  return (
    /imobili[aá]ria.*im[oó]veis em/.test(t) ||
    /encontre seu lugar/.test(t) ||
    /encontre apartamentos.*casas/.test(t) ||
    /^vivanci imobili[aá]ria/.test(t)
  );
}

export function isGenericSiteDescription(description: string): boolean {
  const d = description.trim().toLowerCase();
  if (!d) return true;
  return (
    /encontre apartamentos.*lan[cç]amentos/.test(d) ||
    /atendimento personalizado/.test(d) ||
    /fale com a vivanci/.test(d) ||
    /\+?\d[\d.]* im[oó]veis/.test(d)
  );
}

export function pickBestTitle(
  documentTitle: string,
  metaTitle: string | undefined,
  ogTitle: string | undefined,
): string | undefined {
  const doc = documentTitle.trim();
  const meta = (metaTitle ?? "").trim();
  const og = (ogTitle ?? "").trim();

  if (doc && og && doc !== og) {
    if (isGenericSiteTitle(og) && !isGenericSiteTitle(doc)) return doc;
    if (isGenericSiteTitle(og) && doc.length > og.length + 5) return doc;
  }

  if (doc && meta && doc !== meta && isGenericSiteTitle(meta) && !isGenericSiteTitle(doc)) {
    return doc;
  }

  return doc || meta || og || undefined;
}

export function extractDescriptionFromRawText(rawText: string): string | undefined {
  const cleaned = rawText.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;

  const descMatch = cleaned.match(/\bDescri[cç][aã]o\b\s*(.+?)(?:\bCaracter[ií]sticas\b|\bValores\b|\bLocaliza[cç][aã]o\b|$)/i);
  if (descMatch?.[1]?.trim()) {
    const section = descMatch[1].trim();
    if (section.length >= 40 && !isGenericSiteDescription(section)) return section.slice(0, 4000);
  }

  if (cleaned.length >= 80 && !isGenericSiteDescription(cleaned.slice(0, 200))) {
    return cleaned.slice(0, 4000);
  }

  return undefined;
}

export async function waitForSpaContent(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const body = document.body?.innerText ?? "";
        const hasPropertyText =
          body.length > 400 &&
          (/quartos?|venda|loca[cç][aã]o|#\d{3,}/i.test(body) || /R\$\s*[\d.]/.test(body));
        const hasSupabaseImg = document.querySelector('img[src*="supabase.co"]') !== null;
        const hasGalleryImg =
          document.querySelectorAll("img").length > 3 &&
          Array.from(document.querySelectorAll("img")).some((img) => {
            const src = (img.getAttribute("src") ?? "").toLowerCase();
            return src.includes(".jpeg") || src.includes(".jpg") || src.includes(".webp");
          });
        return hasSupabaseImg || hasGalleryImg || hasPropertyText;
      },
      { timeout: 15_000 },
    );
  } catch {
    await page.waitForTimeout(2000);
  }
}

export async function collectRenderedImageUrls(page: Page, baseUrl: string): Promise<string[]> {
  return page.evaluate((base) => {
    const out: string[] = [];
    const push = (raw: string | null | undefined) => {
      if (!raw?.trim()) return;
      try {
        out.push(new URL(raw.trim(), base).toString());
      } catch {
        // ignore invalid URLs
      }
    };

    Array.from(document.querySelectorAll("img")).forEach((img) => {
      push(img.getAttribute("src"));
      push(img.getAttribute("data-src"));
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        const parts = srcset.split(",").map((p: string) => p.trim().split(/\s+/)[0]);
        for (const part of parts) push(part);
      }
    });

    Array.from(
      document.querySelectorAll('meta[property="og:image"], meta[itemprop="image"]'),
    ).forEach((meta) => {
      push(meta.getAttribute("content"));
    });

    return out;
  }, baseUrl);
}
