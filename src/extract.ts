import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import * as cheerio from "cheerio";

export type ExtractOptions = {
  includeHtml?: boolean;
  includeText?: boolean;
  downloadImages?: boolean;
  maxImages?: number;
};

export type ExtractedImage = {
  url: string;
  savedTo?: string;
  contentType?: string | null;
  bytes?: number;
  error?: string;
};

export type ExtractedListing = {
  url: string;
  fetchedAt: string;
  hostname: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  price?: string | number;
  address?: string;
  bedrooms?: number;
  bathrooms?: number;
  parkingSpaces?: number;
  area?: string | number;
  rawText?: string;
  html?: string;
  jsonLd?: unknown[];
  images: ExtractedImage[];
};

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
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

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function toAbsoluteUrl(baseUrl: string, maybeUrl: string): string | null {
  const trimmed = maybeUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return null;
  if (trimmed.startsWith("javascript:")) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickBestFromSrcset(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((part) => part.trim())
    .map((part) => {
      const [url, descriptor] = part.split(/\s+/);
      const weight = descriptor?.endsWith("w")
        ? Number(descriptor.slice(0, -1))
        : descriptor?.endsWith("x")
          ? Number(descriptor.slice(0, -1)) * 1000
          : 0;
      return { url, weight };
    })
    .filter((c) => Boolean(c.url));

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0]?.url ?? null;
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function extractJsonLd($: cheerio.CheerioAPI): unknown[] {
  const json: unknown[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const content = $(el).text().trim();
    if (!content) return;
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) json.push(...parsed);
      else json.push(parsed);
    } catch {
    }
  });
  return json;
}

function findFirstJsonLdListing(jsonLd: unknown[]): Record<string, unknown> | null {
  const stack: unknown[] = [...jsonLd];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;
    const obj = current as Record<string, unknown>;

    const typeValue = obj["@type"];
    const typeStr =
      typeof typeValue === "string"
        ? typeValue
        : Array.isArray(typeValue)
          ? typeValue.filter((t) => typeof t === "string").join(",")
          : "";

    if (
      /RealEstateListing|Offer|Product|Apartment|House|Residence/i.test(typeStr) ||
      typeof obj["offers"] !== "undefined"
    ) {
      return obj;
    }

    for (const value of Object.values(obj)) {
      if (value && (typeof value === "object" || Array.isArray(value))) stack.push(value);
    }
  }
  return null;
}

function extractFromListingObject(listing: Record<string, unknown>): Partial<ExtractedListing> {
  const title = typeof listing["name"] === "string" ? listing["name"] : undefined;
  const description =
    typeof listing["description"] === "string" ? listing["description"] : undefined;

  const offers = listing["offers"];
  let price: string | number | undefined;
  if (offers && typeof offers === "object") {
    const offerObj = Array.isArray(offers) ? offers[0] : offers;
    if (offerObj && typeof offerObj === "object") {
      const p = (offerObj as Record<string, unknown>)["price"];
      if (typeof p === "string" || typeof p === "number") price = p;
    }
  }

  const addressObj = listing["address"];
  let address: string | undefined;
  if (typeof addressObj === "string") address = addressObj;
  if (addressObj && typeof addressObj === "object") {
    const a = addressObj as Record<string, unknown>;
    const parts = [
      a["streetAddress"],
      a["addressLocality"],
      a["addressRegion"],
      a["postalCode"]
    ].filter((v) => typeof v === "string") as string[];
    if (parts.length > 0) address = parts.join(", ");
  }

  const bedrooms =
    typeof listing["numberOfRooms"] === "number" ? listing["numberOfRooms"] : undefined;

  const floorSize = listing["floorSize"];
  let area: string | number | undefined;
  if (typeof floorSize === "number" || typeof floorSize === "string") area = floorSize;
  if (floorSize && typeof floorSize === "object") {
    const v = (floorSize as Record<string, unknown>)["value"];
    if (typeof v === "number" || typeof v === "string") area = v;
  }

  return { title, description, price, address, bedrooms, area };
}

function extractMetadataFromHtml(url: string, html: string): {
  canonicalUrl?: string;
  title?: string;
  description?: string;
  structured: Partial<ExtractedListing>;
  imageUrls: string[];
  rawText?: string;
  jsonLd: unknown[];
} {
  const $ = cheerio.load(html);

  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonicalUrl = canonicalHref ? toAbsoluteUrl(url, canonicalHref) ?? canonicalHref : undefined;

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogDescription = $('meta[property="og:description"]').attr("content")?.trim();
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim();

  const metaTitle = $("title").first().text().trim() || undefined;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || undefined;

  const title = ogTitle || metaTitle;
  const description = ogDescription || metaDescription;

  const jsonLd = extractJsonLd($);
  const listingObj = findFirstJsonLdListing(jsonLd);
  const fromJsonLd = listingObj ? extractFromListingObject(listingObj) : {};

  const imageCandidates: string[] = [];
  if (ogImage) imageCandidates.push(ogImage);
  $('meta[property="og:image"]').each((_i, el) => {
    const v = $(el).attr("content")?.trim();
    if (v) imageCandidates.push(v);
  });
  $('meta[itemprop="image"]').each((_i, el) => {
    const v = $(el).attr("content")?.trim();
    if (v) imageCandidates.push(v);
  });

  $("img").each((_i, el) => {
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const best = pickBestFromSrcset(srcset);
      if (best) imageCandidates.push(best);
    }
    const src = $(el).attr("data-src") ?? $(el).attr("src");
    if (src) imageCandidates.push(src);
  });

  const imageUrls = dedupeUrls(
    imageCandidates
      .map((u) => toAbsoluteUrl(url, u))
      .filter((u): u is string => Boolean(u))
  );

  return {
    canonicalUrl,
    title: fromJsonLd.title ?? title,
    description: fromJsonLd.description ?? description,
    structured: fromJsonLd,
    imageUrls,
    jsonLd
  };
}

async function downloadBinary(url: string, timeoutMs: number): Promise<{
  bytes: Uint8Array;
  contentType: string | null;
}> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type");
    const arrayBuffer = await res.arrayBuffer();
    return { bytes: new Uint8Array(arrayBuffer), contentType };
  } finally {
    clearTimeout(id);
  }
}

function guessExtensionFromContentType(contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("image/jpeg")) return "jpg";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("image/gif")) return "gif";
  if (ct.includes("image/avif")) return "avif";
  return "bin";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function extractFromUrl(
  url: string,
  options: ExtractOptions
): Promise<ExtractedListing> {
  const includeHtml = options.includeHtml ?? false;
  const includeText = options.includeText ?? true;
  const downloadImages = options.downloadImages ?? true;
  const maxImages = options.maxImages ?? 25;

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
  });

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 7000 });
    } catch {
    }

    const html = await page.content();
    const rawText = includeText ? await page.innerText("body") : undefined;
    await page.close();

    const meta = extractMetadataFromHtml(url, html);
    const selectedImageUrls = meta.imageUrls.slice(0, Math.max(0, maxImages));

    const fetchedAt = new Date().toISOString();
    const listingBase: ExtractedListing = {
      url,
      fetchedAt,
      hostname,
      canonicalUrl: meta.canonicalUrl,
      title: meta.title,
      description: meta.description,
      price: meta.structured.price,
      address: meta.structured.address,
      bedrooms: meta.structured.bedrooms,
      bathrooms: meta.structured.bathrooms,
      parkingSpaces: meta.structured.parkingSpaces,
      area: meta.structured.area,
      rawText,
      html: includeHtml ? html : undefined,
      jsonLd: meta.jsonLd,
      images: selectedImageUrls.map((u) => ({ url: u }))
    };

    if (!downloadImages || selectedImageUrls.length === 0) return listingBase;

    const dataDir = process.env.DATA_DIR ?? "data";
    const baseDir = path.join(dataDir, sha1(url), "images");
    await mkdir(baseDir, { recursive: true });

    const downloaded = await mapWithConcurrency(
      selectedImageUrls,
      4,
      async (imageUrl, index): Promise<ExtractedImage> => {
        try {
          const { bytes, contentType } = await downloadBinary(imageUrl, 30000);
          const ext = guessExtensionFromContentType(contentType);
          const fileName = `${String(index + 1).padStart(2, "0")}.${ext}`;
          const filePath = path.join(baseDir, fileName);
          await writeFile(filePath, bytes);
          return { url: imageUrl, savedTo: filePath, contentType, bytes: bytes.byteLength };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erro ao baixar imagem";
          return { url: imageUrl, error: message };
        }
      }
    );

    return { ...listingBase, images: downloaded };
  } finally {
    await context.close();
  }
}
