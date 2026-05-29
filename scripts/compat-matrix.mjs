/**
 * Matriz de compatibilidade: discover + extract por site.
 * Uso: node scripts/compat-matrix.mjs [extratorBaseUrl]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(__dirname, "site-samples.json"), "utf8"));
const base = (process.argv[2] ?? "https://extrator-imoveis.onrender.com").replace(/\/$/, "");

function isDetailUrl(absUrl) {
  try {
    const u = new URL(absUrl);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (/^\/imoveis\/(?:a-venda|aluguel|venda)/i.test(path)) return false;
    if (path.endsWith("/imovel.php") || path.endsWith("/detalhes-imovel.php")) {
      return u.searchParams.has("id") || u.searchParams.has("imovel");
    }
    const patterns = [
      /^\/(apartamento|casa|sobrado|terreno|kitnet|kitinete|chacara|chácara|galpao|galpão|flat|sala|lote)-/i,
      /^\/imovel\/[^/]+(?:\/[^/]+)?\/?$/i,
      /^\/imovel\/\d{3,}\/?$/i,
      /^\/imovel\/[^/]+-id-\d+\/?$/i,
      /^\/(?:imovel|property|properties|detalhes|detalhe|anuncio|anuncios|listing|listings)\/[^/]+(?:\/[^/]+)?\/?$/i,
      /^\/[^/]+\/\d{3,}\/?$/,
      /^\/[^/]+\/[^/]+\/.+-\d{5,}\/?$/,
      /^\/(?:[^/]+\/)*[^/]+-\d{5,}\/?$/,
    ];
    return patterns.some((re) => re.test(path));
  } catch {
    return false;
  }
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function discoverListingUrl(seedUrl) {
  const home = new URL(seedUrl);
  home.pathname = "/";
  const { status, json } = await post("/v1/discover", { url: home.toString() });
  if (!json.ok || !json.html) return null;
  const hrefRe = /href=["']([^"']+)["']/gi;
  const found = [];
  let m;
  while ((m = hrefRe.exec(json.html)) !== null) {
    try {
      const abs = new URL(m[1], home);
      if (abs.hostname.replace(/^www\./, "") !== home.hostname.replace(/^www\./, "")) continue;
      if (isDetailUrl(abs.toString())) found.push(abs.toString());
    } catch {
      // ignore
    }
  }
  return [...new Set(found)][0] ?? null;
}

async function extractOne(url) {
  const { status, json } = await post("/v1/extract", {
    urls: [url],
    options: { downloadImages: false, maxImages: 8, includeText: true },
  });
  const row = json.results?.[0];
  if (!row?.ok) {
    return { ok: false, error: row?.error?.message ?? `HTTP ${status}` };
  }
  const listing = row.listing ?? {};
  const imgs = (listing.images ?? []).filter((i) => i.url && !i.error);
  return {
    ok: true,
    title: (listing.title ?? "").slice(0, 80),
    purpose: listing.purpose ?? "",
    price: listing.price || listing.sale_price || listing.rent_price || "",
    imageCount: imgs.length,
    city: listing.city ?? "",
  };
}

const rows = [];
for (const [host, seed] of Object.entries(samples)) {
  let url = seed;
  try {
    const u = new URL(seed);
    if (!isDetailUrl(seed)) {
      process.stdout.write(`[discover] ${host}...\n`);
      const discovered = await discoverListingUrl(seed);
      if (discovered) url = discovered;
    }
  } catch (e) {
    rows.push({ host, url: seed, status: "error", note: String(e) });
    continue;
  }

  process.stdout.write(`[extract] ${host} ${url}\n`);
  const result = await extractOne(url);
  if (!result.ok) {
    rows.push({ host, url, status: "blocked", note: result.error });
    continue;
  }
  const hasTitle = result.title && result.title.length > 5;
  const hasPhotos = result.imageCount >= 1;
  const status =
    hasTitle && hasPhotos && result.price ? "works" : hasTitle && hasPhotos ? "partial" : "partial";
  rows.push({
    host,
    url,
    status,
    title: result.title,
    purpose: result.purpose,
    price: result.price,
    images: result.imageCount,
    city: result.city,
    note: !hasTitle ? "sem título" : !hasPhotos ? "sem fotos" : !result.price ? "sem preço" : "",
  });
}

console.log("\n=== MATRIZ ===\n");
console.table(rows);
const failed = rows.filter((r) => r.status === "blocked" || r.status === "error");
process.exit(failed.length > 0 ? 1 : 0);
