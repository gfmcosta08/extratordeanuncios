import express from "express";
import { z } from "zod";
import { extractFromUrl } from "./extract";

const app = express();
app.use(express.json({ limit: "2mb" }));

type Extracted = Awaited<ReturnType<typeof extractFromUrl>>;

function asStringOrEmpty(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || value === true || value === false) return String(value);
  return "";
}

function asCleanStringOrEmpty(value: unknown): string {
  return fixMojibakeIfNeeded(asStringOrEmpty(value));
}

function asNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asDecimalStringOrEmpty(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalizeDecimalString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : "";
}

function looksMojibake(text: string): boolean {
  return /[ÃÂ�├]/.test(text);
}

function normalizeCommonMojibakeTokens(text: string): string {
  if (!text) return text;
  const replacements: Array<[string, string]> = [
    ["├ú", "ã"],
    ["├ü", "á"],
    ["├®", "é"],
    ["├í", "í"],
    ["├│", "ó"],
    ["├║", "ú"],
    ["├ç", "ç"],
    ["├Ç", "À"],
    ["┬▓", "²"],
    ["┬░", "°"]
  ];

  let out = text;
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

function fixMojibakeIfNeeded(text: string): string {
  if (!text) return text;
  if (!looksMojibake(text)) return normalizeCommonMojibakeTokens(text);
  const beforeBad = (text.match(/[ÃÂ�├]/g) ?? []).length;
  const candidate = Buffer.from(text, "latin1").toString("utf8");
  const afterBad = (candidate.match(/[ÃÂ�├]/g) ?? []).length;
  if (afterBad < beforeBad) return normalizeCommonMojibakeTokens(candidate);
  return normalizeCommonMojibakeTokens(text);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMoneyAmountAfterBRL(text: string, label: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const re = new RegExp(
    `\\b${escapeRegExp(label)}\\b[^R$]{0,20}R\\$\\s*(\\d{1,3}(?:\\.\\d{3})*(?:,\\d+)?|\\d+(?:,\\d+)?)`,
    "i"
  );
  const m = cleaned.match(re);
  if (!m) return "";
  return normalizeDecimalString(m[1] ?? "");
}

function inferPropertySubtype(url: string, title: string, corpus: string): string {
  const fixedTitle = fixMojibakeIfNeeded(title);
  const fixedCorpus = fixMojibakeIfNeeded(corpus);

  let path = "";
  try {
    const u = new URL(url);
    path = u.pathname.toLowerCase();
  } catch {
    path = "";
  }

  const titleLower = fixedTitle.toLowerCase();
  const corpusLower = fixedCorpus.toLowerCase();

  const fromPath: Array<{ test: (p: string) => boolean; label: string }> = [
    { test: (p) => p.includes("/sala-") || p.includes("/sala/"), label: "Sala" },
    { test: (p) => p.includes("/apartamento-") || p.includes("/apartamento/"), label: "Apartamento" },
    { test: (p) => p.includes("/casa-") || p.includes("/casa/"), label: "Casa" },
    { test: (p) => p.includes("/sobrado-") || p.includes("/sobrado/"), label: "Sobrado" },
    { test: (p) => p.includes("/terreno-") || p.includes("/terreno/") || p.includes("/lote-"), label: "Terreno" },
    { test: (p) => p.includes("/kitnet-") || p.includes("/kitinete-"), label: "Kitnet" },
    { test: (p) => p.includes("/chacara-") || p.includes("/chácara-"), label: "Chácara" },
    { test: (p) => p.includes("/galpao-") || p.includes("/galpão-"), label: "Galpão" },
    { test: (p) => p.includes("/flat-"), label: "Flat" }
  ];

  for (const r of fromPath) {
    if (r.test(path)) return r.label;
  }

  const fromTitle: Array<{ test: (s: string) => boolean; label: string }> = [
    { test: (s) => s.includes("sala comercial") || s.includes(" sala "), label: "Sala" },
    { test: (s) => s.includes("apartamento"), label: "Apartamento" },
    { test: (s) => s.includes("sobrado"), label: "Sobrado" },
    { test: (s) => s.includes("terreno") || s.includes("lote"), label: "Terreno" },
    { test: (s) => s.includes("kitnet") || s.includes("kitinete"), label: "Kitnet" },
    { test: (s) => s.includes("chácara") || s.includes("chacara"), label: "Chácara" },
    { test: (s) => s.includes("galpão") || s.includes("galpao"), label: "Galpão" },
    { test: (s) => s.includes("flat"), label: "Flat" },
    { test: (s) => s.includes("casa"), label: "Casa" }
  ];

  for (const r of fromTitle) {
    if (r.test(titleLower)) return r.label;
  }

  const fromCorpusLowPriority: Array<{ test: (s: string) => boolean; label: string }> = [
    { test: (s) => s.includes("apartamento"), label: "Apartamento" },
    { test: (s) => s.includes("sobrado"), label: "Sobrado" },
    { test: (s) => s.includes("terreno") || s.includes("lote"), label: "Terreno" },
    { test: (s) => s.includes("kitnet") || s.includes("kitinete"), label: "Kitnet" },
    { test: (s) => s.includes("chácara") || s.includes("chacara"), label: "Chácara" },
    { test: (s) => s.includes("galpão") || s.includes("galpao"), label: "Galpão" },
    { test: (s) => s.includes("flat"), label: "Flat" },
    { test: (s) => s.includes("casa"), label: "Casa" },
    { test: (s) => s.includes("sala comercial"), label: "Sala" }
  ];

  for (const r of fromCorpusLowPriority) {
    if (r.test(corpusLower)) return r.label;
  }

  return "";
}

function normalizeForHeuristics(input: string): string {
  return input.replace(/\u00a0/g, " ").replace(/\s+/g, " ").toLowerCase().trim();
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function inferPurposeFromSonharHtmlByPriceWindow(html: string): "sale" | "rent" | "" {
  const text = normalizeForHeuristics(stripHtmlToText(html));

  const idx = text.indexOf("r$");
  if (idx < 0) return "";

  const start = Math.max(0, idx - 120);
  const end = Math.min(text.length, idx + 120);
  const win = text.slice(start, end);

  const hasSale = /\bvenda\b|à venda|a venda|vende-se|vende se/.test(win);
  const hasRent = /\baluguel\b|para alugar|pacote de loca/.test(win);

  if (hasSale && !hasRent) return "sale";
  if (hasRent && !hasSale) return "rent";

  const before = text.slice(Math.max(0, idx - 25), idx);
  if (before.includes("venda")) return "sale";
  if (before.includes("aluguel")) return "rent";

  return "";
}

function inferPurposeFromQueryParams(u: URL): "sale" | "rent" | "" {
  const from = (u.searchParams.get("from") ?? "").toLowerCase();
  if (from === "sale" || from === "venda") return "sale";
  if (from === "rent" || from === "aluguel" || from === "alugar") return "rent";

  const finalidade = (u.searchParams.get("finalidade") ?? "").toLowerCase();
  if (finalidade === "1" || finalidade === "venda" || finalidade === "sale") return "sale";
  if (finalidade === "2" || finalidade === "aluguel" || finalidade === "rent") return "rent";

  const tipoTransacao = (u.searchParams.get("tipoTransacao") ?? "").toLowerCase();
  if (tipoTransacao === "venda" || tipoTransacao === "sale") return "sale";
  if (tipoTransacao === "aluguel" || tipoTransacao === "rent" || tipoTransacao === "locacao") return "rent";

  return "";
}

function inferPurposeFromLogosText(text: string): "sale" | "rent" | "" {
  if (/\bpara\s+aluguel\b/.test(text) || /\bim[oó]vel\s+para\s+aluguel\b/.test(text)) return "rent";
  if (/\bpara\s+venda\b/.test(text) || /\bim[oó]vel\s+para\s+venda\b/.test(text)) return "sale";
  return "";
}

function inferPurposeFromUrlOrText(url: string, text: string, html?: string): "sale" | "rent" | "" {
  const cleaned = normalizeForHeuristics(text);

  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    if (hostname.endsWith("logos-to.com.br")) {
      const byLogosText = inferPurposeFromLogosText(cleaned);
      if (byLogosText) return byLogosText;
    }

    const byQueryParams = inferPurposeFromQueryParams(u);
    if (byQueryParams) return byQueryParams;

    if (hostname.endsWith("imobiliariasonhar.com.br") && html) {
      const byWindow = inferPurposeFromSonharHtmlByPriceWindow(html);
      if (byWindow) return byWindow;
    }

    const path = `${u.hostname}${u.pathname}`.toLowerCase();
    if (
      path.includes("aluguel") ||
      path.includes("para-alugar") ||
      path.includes("locacao") ||
      path.includes("para-locacao")
    ) {
      return "rent";
    }
    if (path.includes("venda") || path.includes("a-venda") || path.includes("comprar")) return "sale";
  } catch {
  }

  const hasSale =
    /\b(venda|à venda|a venda|vende-se|vende se)\b/.test(cleaned) ||
    /venda.{0,10}r\$/i.test(cleaned);

  const hasRent =
    /\b(aluguel|para alugar|loca[cç][aã]o|pacote de loca[cç][aã]o)\b/.test(cleaned) ||
    /aluguel.{0,10}r\$/i.test(cleaned) ||
    /\/\s*m[eê]s\b/.test(cleaned);

  const saleMoneyContext = /\bvenda\b[^r$]{0,25}r\$/i.test(cleaned);
  const rentMoneyContext = /\b(aluguel|loca[cç][aã]o)\b[^r$]{0,25}r\$/i.test(cleaned);
  if (saleMoneyContext && !rentMoneyContext) return "sale";
  if (rentMoneyContext && !saleMoneyContext) return "rent";

  if (hasSale && !hasRent) return "sale";
  if (hasRent && !hasSale) return "rent";
  if (hasRent && hasSale) {
    const head = cleaned.slice(0, 2500);
    if (
      /\b(a venda|à venda|para venda|im[oó]vel\s+para\s+venda|casa\s+a\s+venda)\b/.test(head)
    ) {
      return "sale";
    }
    const vendaIdx = head.search(/\bvenda\b/);
    const alugarIdx = head.search(/\balugar\b/);
    if (vendaIdx >= 0 && (alugarIdx < 0 || vendaIdx < alugarIdx)) return "sale";
    return "rent";
  }

  return "";
}

function inferInternalCodeFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return last || "";
  } catch {
    return "";
  }
}

function inferPostalCodeIfExplicit(text: string): string {
  const cleaned = text.replace(/\s+/g, " ");
  const m = cleaned.match(/\bcep\b[^\d]{0,10}(\d{5}-?\d{3}|\d{8})\b/i);
  if (!m) return "";
  return digitsOnly(m[1] ?? "");
}

function inferLocationFromText(text: string): { neighborhood: string; city: string; state: string; postal_code: string } {
  const cleaned = text.replace(/\s+/g, " ").trim();
  let neighborhood = "";
  let city = "";
  let state = "";
  let postal_code = "";

  const parts = cleaned.split(/localiza[cç][aã]o/i);
  if (parts.length > 1) {
    const after = parts.slice(1).join(" ").trim();
    const clipped =
      after.split(/\b(publicidade|detalhes|valores|dicas de seguran[cç]a|c[oó]digo do an[uú]ncio)\b/i)[0]?.trim() ??
      after;
    const chunk = clipped.slice(0, 250);

    const mComma = chunk.match(/([^,]+?),\s*([^,]+?),\s*([A-Z]{2})\s*,\s*(\d{5}-?\d{3}|\d{8})\b/);
    if (mComma) {
      neighborhood = (mComma[1] ?? "").trim();
      city = (mComma[2] ?? "").trim();
      state = (mComma[3] ?? "").trim();
      postal_code = digitsOnly(mComma[4] ?? "");
    } else {
      const mDashCep = chunk.match(/([^,]+?),\s*([^,]+?)\s*-\s*([A-Z]{2})\s*,?\s*(\d{5}-?\d{3}|\d{8})\b/);
      if (mDashCep) {
        neighborhood = (mDashCep[1] ?? "").trim();
        city = (mDashCep[2] ?? "").trim();
        state = (mDashCep[3] ?? "").trim();
        postal_code = digitsOnly(mDashCep[4] ?? "");
      }
    }
  }

  if (!postal_code) {
    postal_code = inferPostalCodeIfExplicit(cleaned);
  }

  if (!city || !state) {
    const zap = cleaned.match(/\bim[oó]vel\s+em\s+([^,]+?)\s*,\s*([^,]+?)\s*-\s*([A-Z]{2})\b/i);
    if (zap) {
      neighborhood = neighborhood || (zap[1] ?? "").trim();
      city = city || (zap[2] ?? "").trim();
      state = state || (zap[3] ?? "").trim();
    }
  }

  if (!city || !state) {
    const sonhar = cleaned.match(/-\s*([^-/]+?)\s*\/\s*([A-Z]{2})\s*$/);
    if (sonhar) {
      city = city || (sonhar[1] ?? "").trim();
      state = state || (sonhar[2] ?? "").trim();
    }
  }

  if (!city || !state) {
    const commaCityState = cleaned.match(/,\s*([A-Za-zÀ-ÿ ]+?)\s*-\s*([A-Z]{2})\b/);
    if (commaCityState) {
      city = city || (commaCityState[1] ?? "").trim();
      state = state || (commaCityState[2] ?? "").trim();
    }
  }

  if (!city || !state) {
    const dashCityState = cleaned.match(/\b([A-Za-zÀ-ÿ ]+?)\s*-\s*([A-Z]{2})\b/);
    if (dashCityState) {
      city = city || (dashCityState[1] ?? "").trim();
      state = state || (dashCityState[2] ?? "").trim();
    }
  }

  const cityNorm = normalizeForHeuristics(city);
  if (/^(arso|arse|arno|arne|acso|acne|acsv|acse|acno|asr)\b/.test(cityNorm)) {
    city = "";
    state = "";
  }
  if (/(\bcreci\b|\bcod\b|\bc[óo]d\b)/.test(cityNorm)) {
    city = "";
    state = "";
  }
  if (state && !/^[A-Z]{2}$/.test(state)) {
    state = "";
  }
  if (!city) {
    state = "";
  }

  return { neighborhood, city, state, postal_code };
}

function inferLocationFromLogosText(text: string): {
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
} {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/\bno bairro\s+([^,]+),\s*([^,]+),\s*im/i);
  if (!m) {
    return { neighborhood: "", city: "", state: "", postal_code: "" };
  }

  const neighborhood = (m[1] ?? "").trim();
  const city = (m[2] ?? "").trim();
  const cityNorm = normalizeForHeuristics(city);
  const state = cityNorm === "palmas" ? "TO" : "";

  return { neighborhood, city, state, postal_code: "" };
}

function inferLocationFromCasaMineiraText(
  text: string,
  url: string,
  address?: string
): { neighborhood: string; city: string; state: string; postal_code: string } {
  const cleaned = fixMojibakeIfNeeded(text.replace(/\s+/g, " ").trim());
  let neighborhood = "";
  let city = "";
  let state = "";

  const m = cleaned.match(/,\s*([^,]+),\s*([A-Za-zÀ-ÿ ]+)\s+\d+\s*m(?:²|2)\b/i);
  if (m) {
    neighborhood = (m[1] ?? "").trim();
    city = (m[2] ?? "").trim();
  }

  if (!city || !neighborhood) {
    const mAddr = cleaned.match(
      /,\s*([^,]+),\s*([^,]+),\s*brasil\s+casamineira,\s*,\s*([^,]+)/i
    );
    if (mAddr) {
      city = city || (mAddr[1] ?? "").trim();
      neighborhood = neighborhood || (mAddr[3] ?? "").trim();
    }
  }

  if ((!city || !neighborhood) && address) {
    const addr = fixMojibakeIfNeeded(address);
    const parts = addr
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length >= 2) {
      city = city || (parts[1] ?? "");
      neighborhood = neighborhood || (parts[parts.length - 1] ?? "");
    }
  }

  try {
    const u = new URL(url);
    const suffix = u.pathname.match(/-([a-z]{2})\/\d+/i)?.[1] ?? "";
    if (suffix) state = suffix.toUpperCase();
  } catch {
  }

  return { neighborhood, city, state, postal_code: "" };
}

function inferLocationFromCasa63Text(
  text: string,
  title: string,
): { neighborhood: string; city: string; state: string; postal_code: string } {
  const cleaned = fixMojibakeIfNeeded(text.replace(/\s+/g, " ").trim());
  let neighborhood = "";
  let city = "";
  let state = "";

  if (title) {
    const fromTitle = title.match(/-\s*([^-\n]+?)\s*$/);
    if (fromTitle?.[1]) neighborhood = fromTitle[1].trim();
  }

  const loteamento = cleaned.match(
    /\b(?:Loteamento|Setor|Condom[ií]nio)\s+([^,\n]+?),\s*([A-Za-zÀ-ÿ ]+?)\s*-\s*([A-Z]{2})\b/i,
  );
  if (loteamento) {
    if (!neighborhood) neighborhood = (loteamento[1] ?? "").trim();
    city = (loteamento[2] ?? "").trim();
    state = (loteamento[3] ?? "").trim();
  }

  return { neighborhood, city, state, postal_code: "" };
}

function pickFirstInt(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickBestFromCompactBlock(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const head = cleaned.slice(0, 1200);
  const m = head.match(
    /\b(\d+\s*Quartos?.{0,140}?\d+\s*Su[ií]tes?.{0,140}?\d+\s*Banheiros?.{0,140}?\d+\s*Vagas?|\d+\s*Quartos?.{0,140}?\d+\s*Banheiros?.{0,140}?\d+\s*Vagas?|\d+\s*Quartos?.{0,140}?\d+\s*Vagas?.{0,140}?\d+\s*Banheiros?)\b/i
  );
  return (m?.[0] ?? "").trim();
}

function inferAreaFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname.toLowerCase();

    const m1 = slug.match(/-(\d+(?:[.,]\d+)?)m2\b/);
    if (m1) return normalizeDecimalString(m1[1] ?? "");

    const m2 = slug.match(/-(\d+(?:[.,]\d+)?)-m\b/);
    if (m2) return normalizeDecimalString(m2[1] ?? "");

    return "";
  } catch {
    return "";
  }
}

function pickFirstAreaM2(text: string): string {
  const t = text.replace(/\s+/g, " ");

  const m1 = t.match(/\b(área\s*(útil|privativa))\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(m²|m2)\b/i);
  if (m1) return normalizeDecimalString(m1[3] ?? "");

  const m2 = t.match(/\b(área)\s*(útil)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*(m²|m2)\b/i);
  if (m2) return normalizeDecimalString(m2[3] ?? "");

  const m3 = t.match(/\b(\d+(?:[.,]\d+)?)\s*(m²|m2)\b/i);
  if (m3) return normalizeDecimalString(m3[1] ?? "");

  return "";
}

function findLabeledNumber(text: string, label: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const re = new RegExp(`\\b${escapeRegExp(label)}\\b\\s*[:\\-]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(m²|m2)?\\b`, "i");
  const m = cleaned.match(re);
  if (!m) return "";
  return normalizeDecimalString(m[1] ?? "");
}

function findLabeledInt(text: string, label: string): number | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const re = new RegExp(`\\b${escapeRegExp(label)}\\b\\s*[:\\-]?\\s*(\\d+)\\b`, "i");
  const m = cleaned.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function buildTextCorpus(data: Extracted): string {
  const parts = [data.title, data.description, data.rawText]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => fixMojibakeIfNeeded(v));

  return parts.join("\n");
}

function inferPriceFromCorpus(url: string, corpus: string, purpose: "sale" | "rent" | ""): string {
  const cleaned = corpus.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const hostname = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  const moneyPattern = "(\\d{1,3}(?:\\s*[\\.\\s]\\s*\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)";
  const genericMoneyRe = /R\$\s*(\d{1,3}(?:\s*[.\s]\s*\d{3})+(?:,\d+)?|\d+(?:,\d+)?)/gi;

  if (hostname.endsWith("logos-to.com.br")) {
    if (purpose === "sale") {
      const logosSale = cleaned.match(
        new RegExp(`(?:im[oó]vel\\s+para\\s+venda|para\\s+venda|venda)\\s+no\\s+valor\\s+de\\s+R\\$\\s*${moneyPattern}`, "i")
      );
      if (logosSale?.[1]) return normalizeDecimalString(logosSale[1]);
    }
    if (purpose === "rent") {
      const logosRent = cleaned.match(
        new RegExp(
          `(?:im[oó]vel\\s+para\\s+aluguel|para\\s+aluguel|aluguel)\\s+no\\s+valor\\s+de\\s+R\\$\\s*${moneyPattern}`,
          "i"
        )
      );
      if (logosRent?.[1]) return normalizeDecimalString(logosRent[1]);
    }
  }

  if (purpose === "sale") {
    const saleThousandMatch = cleaned.match(/\bvenda\b[^R$]{0,80}R\$\s*(\d{1,3}(?:\.\d{3})+)\b/i);
    if (saleThousandMatch?.[1]) return normalizeDecimalString(saleThousandMatch[1]);

    const saleMatch = cleaned.match(new RegExp(`\\bvenda\\b[^R$]{0,60}R\\$\\s*${moneyPattern}`, "i"));
    if (saleMatch?.[1]) return normalizeDecimalString(saleMatch[1]);

    const allowPortalFallback =
      hostname.endsWith("estiloimobiliaria.com") ||
      hostname.endsWith("loft.com.br") ||
      hostname.endsWith("casa63.com.br");
    if (allowPortalFallback) {
      for (const m of cleaned.matchAll(genericMoneyRe)) {
        const amountRaw = m[1] ?? "";
        const amount = normalizeDecimalString(amountRaw);
        if (!amount) continue;

        const idx = m.index ?? 0;
        const before = cleaned.slice(Math.max(0, idx - 40), idx).toLowerCase();
        if (/\b(iptu|condom[ií]nio|taxa)\b/.test(before)) continue;
        return amount;
      }
    }

    return "";
  }
  if (purpose === "rent") {
    const rentMatch = cleaned.match(
      new RegExp(`\\b(aluguel|loca[cç][aã]o)\\b[^R$]{0,60}R\\$\\s*${moneyPattern}`, "i")
    );
    if (rentMatch?.[2]) return normalizeDecimalString(rentMatch[2]);

    const allowPortalFallback =
      hostname.endsWith("estiloimobiliaria.com") ||
      hostname.endsWith("loft.com.br") ||
      hostname.endsWith("casa63.com.br");
    if (allowPortalFallback) {
      for (const m of cleaned.matchAll(genericMoneyRe)) {
        const amountRaw = m[1] ?? "";
        const amount = normalizeDecimalString(amountRaw);
        if (!amount) continue;

        const idx = m.index ?? 0;
        const before = cleaned.slice(Math.max(0, idx - 40), idx).toLowerCase();
        if (/\b(iptu|condom[ií]nio|taxa)\b/.test(before)) continue;
        return amount;
      }
    }

    return "";
  }

  for (const m of cleaned.matchAll(genericMoneyRe)) {
    const amountRaw = m[1] ?? "";
    const amount = normalizeDecimalString(amountRaw);
    if (!amount) continue;

    const idx = m.index ?? 0;
    const before = cleaned.slice(Math.max(0, idx - 40), idx).toLowerCase();
    if (/\b(iptu|condom[ií]nio|taxa)\b/.test(before)) continue;

    return amount;
  }

  return "";
}

function isUnavailableListingPage(url: string, title: string, corpus: string): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  const t = normalizeForHeuristics(`${title}\n${corpus}`);

  if (hostname.endsWith("loft.com.br")) {
    if (
      /este\s+.*indispon/i.test(t) ||
      (/indispon/i.test(t) && /(imoveis\s+similares|imóveis\s+similares|selecionamos\s+\d+\s+imoveis\s+similares)/i.test(t))
    ) {
      return true;
    }
  }

  if (hostname.endsWith("zapimoveis.com.br")) {
    if (t.includes("oops") && (t.includes("nao conseguimos encontrar a pagina") || t.includes("não conseguimos encontrar a página"))) {
      return true;
    }
  }

  if (hostname.endsWith("vaniaimoveis-to.com.br")) {
    if (t.includes("pagina nao encontrada") || t.includes("página não encontrada")) return true;
  }

  if (hostname.endsWith("ritacamposnegocios.com.br")) {
    if (t.includes("403 forbidden") || t.includes("manutencao") || t.includes("manutenção")) return true;
  }

  return false;
}

function shouldFetchHtmlForSonharPurpose(url: string): boolean {
  try {
    const u = new URL(url);
    const isSonhar = u.hostname.toLowerCase().endsWith("imobiliariasonhar.com.br");
    const hasFrom = u.searchParams.has("from");
    return isSonhar && !hasFrom;
  } catch {
    return false;
  }
}

async function extractWithSmartOptions(url: string, options: Record<string, unknown>): Promise<Extracted> {
  const wantHtml = shouldFetchHtmlForSonharPurpose(url);
  if (!wantHtml) return extractFromUrl(url, options);

  const merged = { ...options, includeHtml: true };
  return extractFromUrl(url, merged);
}

function mapToListing(data: Extracted) {
  const corpus = buildTextCorpus(data);
  const compact = pickBestFromCompactBlock(corpus);

  const fixedTitle = fixMojibakeIfNeeded(asStringOrEmpty(data.title));
  const property_subtype = inferPropertySubtype(data.url, fixedTitle, corpus);

  const purpose = inferPurposeFromUrlOrText(data.url, corpus, data.html);
  const internalCode = inferInternalCodeFromUrl(data.url);

  const hostname = (() => {
    try {
      return new URL(data.url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const locFromLogos = hostname.endsWith("logos-to.com.br")
    ? inferLocationFromLogosText(corpus)
    : { neighborhood: "", city: "", state: "", postal_code: "" };
  const locFromCasaMineira = hostname.endsWith("casamineira.com.br")
    ? inferLocationFromCasaMineiraText(corpus, data.url, asStringOrEmpty(data.address))
    : { neighborhood: "", city: "", state: "", postal_code: "" };
  const locFromCasa63 = hostname.endsWith("casa63.com.br")
    ? inferLocationFromCasa63Text(corpus, fixedTitle)
    : { neighborhood: "", city: "", state: "", postal_code: "" };

  const locFromCorpus = inferLocationFromText(corpus);
  const locFromTitle = fixedTitle
    ? inferLocationFromText(fixedTitle)
    : { neighborhood: "", city: "", state: "", postal_code: "" };

  const neighborhood =
    locFromLogos.neighborhood ||
    locFromCasaMineira.neighborhood ||
    locFromCasa63.neighborhood ||
    locFromCorpus.neighborhood ||
    locFromTitle.neighborhood;
  const city =
    locFromLogos.city ||
    locFromCasaMineira.city ||
    locFromCasa63.city ||
    locFromCorpus.city ||
    locFromTitle.city;
  const state =
    locFromLogos.state ||
    locFromCasaMineira.state ||
    locFromCasa63.state ||
    locFromCorpus.state ||
    locFromTitle.state;
  const postal_code =
    locFromLogos.postal_code ||
    locFromCasaMineira.postal_code ||
    locFromCorpus.postal_code ||
    locFromTitle.postal_code;

  const builtArea =
    findLabeledNumber(corpus, "Área construída") ||
    findLabeledNumber(corpus, "Area construida") ||
    findLabeledNumber(corpus, "Construção") ||
    findLabeledNumber(corpus, "Construcao");

  const landArea =
    findLabeledNumber(corpus, "Área do terreno") ||
    findLabeledNumber(corpus, "Area do terreno") ||
    findLabeledNumber(corpus, "Terreno");

  const quartoPatterns = [/\b(\d+)\s*quartos?\(?s?\)?\b/i, /\b(\d+)\s*(qts?)\b/i];

  const bedrooms =
    asNumberOrNull(data.bedrooms) ??
    findLabeledInt(corpus, "Quartos") ??
    pickFirstInt(compact, quartoPatterns) ??
    pickFirstInt(corpus, quartoPatterns);

  const suites =
    findLabeledInt(corpus, "Suítes") ??
    findLabeledInt(corpus, "Suites") ??
    pickFirstInt(compact, [/\b(\d+)\s*(su[ií]tes?)\b/i]) ??
    pickFirstInt(corpus, [/\b(\d+)\s*(su[ií]tes?)\b/i]);

  const bathrooms =
    (hostname.endsWith("casamineira.com.br")
      ? pickFirstInt(corpus, [/\b(\d+)\s*(banheiros?)\b/i])
      : null) ??
    asNumberOrNull(data.bathrooms) ??
    findLabeledInt(corpus, "Banheiros") ??
    pickFirstInt(compact, [/\b(\d+)\s*(banheiros?|bhs?)\b/i]) ??
    pickFirstInt(corpus, [/\b(\d+)\s*(banheiros?|bhs?)\b/i]);

  const parking_spaces =
    (hostname.endsWith("casamineira.com.br")
      ? pickFirstInt(corpus, [/\b(\d+)\s*(vagas?)\b/i])
      : null) ??
    asNumberOrNull(data.parkingSpaces) ??
    findLabeledInt(corpus, "Vagas") ??
    pickFirstInt(compact, [/\b(\d+)\s*(vagas?|vaga na garagem|vagas na garagem)\b/i]) ??
    pickFirstInt(corpus, [/\b(\d+)\s*(vagas?|vaga na garagem|vagas na garagem)\b/i]);

  const area_m2 =
    asDecimalStringOrEmpty(data.area) ||
    builtArea ||
    landArea ||
    inferAreaFromUrl(data.url) ||
    pickFirstAreaM2(compact) ||
    pickFirstAreaM2(corpus);

  const iptu_amount = findMoneyAmountAfterBRL(corpus, "IPTU");

  const price = inferPriceFromCorpus(data.url, corpus, purpose) || asDecimalStringOrEmpty(data.price);
  const sale_price = purpose === "sale" ? price : "";
  const rent_price = purpose === "rent" ? price : "";
  const unavailable = isUnavailableListingPage(data.url, fixedTitle, corpus);

  return {
    id: "",
    public_id: "",
    account_id: "",
    broker_id: "",
    origin_plan_code: "",
    listing_status: "",
    property_type: "",
    property_subtype,
    purpose: unavailable ? "" : purpose,
    title: asCleanStringOrEmpty(data.title),
    description: asCleanStringOrEmpty(data.description),
    city: unavailable ? "" : asCleanStringOrEmpty(city),
    state: unavailable ? "" : asCleanStringOrEmpty(state),
    neighborhood: unavailable ? "" : asCleanStringOrEmpty(neighborhood),
    address_line: "",
    postal_code,
    bedrooms: unavailable ? null : bedrooms,
    suites: unavailable ? null : suites,
    bathrooms: unavailable ? null : bathrooms,
    parking_spaces: unavailable ? null : parking_spaces,
    area_m2: unavailable ? "" : area_m2,
    price: unavailable ? "" : price,
    condo_fee: "",
    iptu_amount: unavailable ? "" : iptu_amount,
    printed_at: null,
    expires_at: null,
    removed_at: null,
    created_at: null,
    updated_at: null,
    internal_code: internalCode,
    full_description: asCleanStringOrEmpty(data.description),
    highlights: "",
    broker_notes: "",
    sale_price: unavailable ? "" : sale_price,
    rent_price: unavailable ? "" : rent_price,
    other_fees: "",
    accepts_financing: null,
    accepts_trade: null,
    total_area_m2: "",
    built_area_m2: builtArea,
    land_area_m2: landArea,
    living_rooms: null,
    floors_count: null,
    unit_floor: null,
    is_furnished: null,
    floor_type: "",
    sun_position: "",
    property_age_years: null,
    full_address: asCleanStringOrEmpty(data.address),
    street_number: "",
    address_complement: "",
    latitude: null,
    longitude: null,
    owner_name: "",
    owner_phone: "",
    owner_email: "",
    listing_broker_name: "",
    listing_broker_phone: "",
    listing_broker_email: "",
    features: "",
    infrastructure: "",
    security_items: "",
    key_available: null,
    is_occupied: null,
    documentation: "",
    technical_details: "",
    construction_type: "",
    finish_standard: "",
    registry_number: "",
    documentation_status: "",
    has_deed: null,
    has_registration: null,
    nearby_points: "",
    distance_to_center_km: "",
    city_region: "",
    furnishing_status: "",
    sold_at: null,
    sold_commission_amount: null,
    sold_confirmed_at: null,
    sold_notes: null,
    images: data.images.map((img) => ({
      url: asStringOrEmpty(img.url),
      saved_to: asStringOrEmpty(img.savedTo),
      content_type: asStringOrEmpty(img.contentType),
      bytes: asNumberOrNull(img.bytes),
      error: asStringOrEmpty(img.error)
    }))
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const ExtractRequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
  options: z
    .object({
      includeHtml: z.boolean().optional().default(false),
      includeText: z.boolean().optional().default(true),
      downloadImages: z.boolean().optional().default(true),
      maxImages: z.number().int().min(0).max(50).optional().default(25)
    })
    .optional()
    .default({})
});

app.post("/v1/extract", async (req, res) => {
  const parsed = ExtractRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: {
        message: "Payload inválido",
        details: parsed.error.flatten()
      }
    });
    return;
  }

  const { urls, options } = parsed.data;
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const data = await extractWithSmartOptions(url, options as Record<string, unknown>);
        const listing = mapToListing(data);
        return { url, ok: true as const, data, listing };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        return { url, ok: false as const, error: { message } };
      }
    })
  );

  res.json({ ok: true, results });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  process.stdout.write(`API escutando em http://localhost:${port}\n`);
});
