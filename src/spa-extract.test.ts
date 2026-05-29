import { describe, expect, it } from "vitest";

import {
  extractDescriptionFromRawText,
  isBlockedOlxListing,
  isCloudflareBlocked,
  isGenericSiteTitle,
  pickBestTitle,
} from "./spa-extract";

describe("spa-extract", () => {
  it("detecta bloqueio Cloudflare", () => {
    expect(
      isCloudflareBlocked("Attention Required! | Cloudflare", "Sorry, you have been blocked"),
    ).toBe(true);
  });

  it("prefere document.title sobre og:title genérico", () => {
    const title = pickBestTitle(
      "Fazenda, C/ 4 Quartos Sendo 4 Suítes - Vivanci",
      "Fazenda, C/ 4 Quartos Sendo 4 Suítes - Vivanci",
      "Vivanci Imobiliária - Imóveis em Palmas TO",
    );
    expect(title).toContain("Fazenda");
  });

  it("identifica título genérico do site", () => {
    expect(isGenericSiteTitle("Vivanci Imobiliária - Imóveis em Palmas TO")).toBe(true);
    expect(isGenericSiteTitle("OLX - O Maior Site de Compra e Venda do Brasil")).toBe(true);
  });

  it("detecta OLX redirecionada para homepage", () => {
    expect(
      isBlockedOlxListing(
        "https://to.olx.com.br/tocantins/lancamentos/terraco-urban-1503931",
        "https://www.olx.com.br/",
        "OLX - O Maior Site de Compra e Venda do Brasil",
      ),
    ).toBe(true);
  });

  it("extrai descrição após rótulo Descrição", () => {
    const text =
      "Voltar #0808 VENDA Fazenda Descrição Ponte Alta região rural com excelente área. Características 4 quartos";
    expect(extractDescriptionFromRawText(text)).toContain("Ponte Alta");
  });
});
