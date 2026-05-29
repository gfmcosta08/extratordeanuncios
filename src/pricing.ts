export function normalizeDecimalString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : "";
}

function moneyContextWindow(corpus: string, idx: number): string {
  return corpus.slice(Math.max(0, idx - 80), Math.min(corpus.length, idx + 80)).toLowerCase();
}

function isFeeContext(before: string): boolean {
  return /\b(iptu|condom[ií]nio|taxa)\b/.test(before);
}

function isRentContext(window: string): boolean {
  return /\b(aluguel|para alugar|loca[cç][aã]o|\/\s*m[eê]s)\b/.test(window);
}

function isSaleContext(window: string): boolean {
  return /\b(venda|à venda|a venda|para venda|comprar)\b/.test(window);
}

export function inferPriceFromCorpus(url: string, corpus: string, purpose: "sale" | "rent" | ""): string {
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

  if (hostname.includes("olx.com.br") && purpose) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (purpose === "rent" && !path.includes("aluguel") && !path.includes("locacao")) {
        // path may not hint rent; still try text patterns below
      }
      if (purpose === "sale" && (path.includes("lancamentos") || path.includes("venda"))) {
        const olxSale = cleaned.match(new RegExp(`R\\$\\s*${moneyPattern}`, "i"));
        if (olxSale?.[1]) return normalizeDecimalString(olxSale[1]);
      }
    } catch {
      // ignore
    }
  }

  if (hostname.endsWith("logos-to.com.br")) {
    if (purpose === "sale") {
      const logosSale = cleaned.match(
        new RegExp(
          `(?:im[oó]vel\\s+para\\s+venda|para\\s+venda|venda)\\s+no\\s+valor\\s+de\\s+R\\$\\s*${moneyPattern}`,
          "i",
        ),
      );
      if (logosSale?.[1]) return normalizeDecimalString(logosSale[1]);
    }
    if (purpose === "rent") {
      const logosRent = cleaned.match(
        new RegExp(
          `(?:im[oó]vel\\s+para\\s+aluguel|para\\s+aluguel|aluguel)\\s+no\\s+valor\\s+de\\s+R\\$\\s*${moneyPattern}`,
          "i",
        ),
      );
      if (logosRent?.[1]) return normalizeDecimalString(logosRent[1]);
    }
  }

  if (purpose === "sale") {
    const saleThousandMatch = cleaned.match(/\bvenda\b[^R$]{0,80}R\$\s*(\d{1,3}(?:\.\d{3})+)\b/i);
    if (saleThousandMatch?.[1]) return normalizeDecimalString(saleThousandMatch[1]);

    const saleMatch = cleaned.match(
      new RegExp(`(?:à venda|a venda|para venda|\\bvenda\\b)[^\\d]{0,40}R\\$\\s*${moneyPattern}`, "i"),
    );
    if (saleMatch?.[1]) return normalizeDecimalString(saleMatch[1]);

    const valorDeMatch = cleaned.match(
      new RegExp(`(?:venda|comprar)[\\s\\S]{0,80}?(?:no valor de|por)\\s*R\\$\\s*${moneyPattern}`, "i"),
    );
    if (valorDeMatch?.[1]) return normalizeDecimalString(valorDeMatch[1]);

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
        if (isFeeContext(before)) continue;
        const window = moneyContextWindow(cleaned, idx);
        if (isRentContext(window) && !isSaleContext(window)) continue;
        return amount;
      }
    }

    return "";
  }

  if (purpose === "rent") {
    const rentMatch = cleaned.match(
      new RegExp(`\\b(aluguel|loca[cç][aã]o)\\b[^\\d]{0,40}R\\$\\s*${moneyPattern}`, "i"),
    );
    if (rentMatch?.[2]) return normalizeDecimalString(rentMatch[2]);

    const rentBeforeMonth = cleaned.match(
      new RegExp(`R\\$\\s*${moneyPattern}\\s*/\\s*m[eê]s`, "i"),
    );
    if (rentBeforeMonth?.[1]) return normalizeDecimalString(rentBeforeMonth[1]);

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
        if (isFeeContext(before)) continue;
        const window = moneyContextWindow(cleaned, idx);
        if (isSaleContext(window) && !isRentContext(window)) continue;
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
    if (isFeeContext(before)) continue;

    return amount;
  }

  return "";
}

export type DualPrices = { sale_price: string; rent_price: string };

export function inferDualPricesFromCorpus(
  url: string,
  corpus: string,
  fallbackPrice?: string,
): DualPrices {
  let sale_price = inferPriceFromCorpus(url, corpus, "sale");
  let rent_price = inferPriceFromCorpus(url, corpus, "rent");

  if (sale_price && rent_price && sale_price === rent_price) {
    const cleaned = corpus.replace(/\s+/g, " ").trim().toLowerCase();
    const saleCtx =
      /(?:à venda|a venda|para venda|\bvenda\b)[^\d]{0,40}r\$/i.test(cleaned) || isSaleContext(cleaned);
    const rentCtx =
      /(?:\baluguel\b|\bloca[cç][aã]o\b)[^\d]{0,40}r\$/i.test(cleaned) ||
      /r\$\s*[\d.]+\s*\/\s*m[eê]s/i.test(cleaned) ||
      isRentContext(cleaned);
    if (saleCtx && !rentCtx) rent_price = "";
    else if (rentCtx && !saleCtx) sale_price = "";
  }

  if (!sale_price && !rent_price && fallbackPrice) {
    const normalized = normalizeDecimalString(String(fallbackPrice));
    if (normalized) {
      sale_price = normalized;
    }
  }

  return { sale_price, rent_price };
}

export function resolvePurposeFromPrices(
  sale_price: string,
  rent_price: string,
): "sale" | "rent" | "" {
  const hasSale = Boolean(sale_price);
  const hasRent = Boolean(rent_price);
  if (hasSale && hasRent) return "";
  if (hasSale) return "sale";
  if (hasRent) return "rent";
  return "";
}
