import { describe, expect, it } from "vitest";

import { inferDualPricesFromCorpus, inferPriceFromCorpus, resolvePurposeFromPrices } from "./pricing";

describe("inferPriceFromCorpus", () => {
  it("extrai preço de venda com rótulo explícito", () => {
    const corpus = "Imóvel para venda no valor de R$ 450.000,00. Aluguel R$ 2.500 / mês";
    expect(inferPriceFromCorpus("https://example.com", corpus, "sale")).toBe("450000");
    expect(inferPriceFromCorpus("https://example.com", corpus, "rent")).toBe("2500");
  });

  it("extrai só aluguel quando não há venda", () => {
    const corpus = "Apartamento para aluguel R$ 1.800 / mês";
    expect(inferPriceFromCorpus("https://example.com", corpus, "rent")).toBe("1800");
    expect(inferPriceFromCorpus("https://example.com", corpus, "sale")).toBe("");
  });
});

describe("inferDualPricesFromCorpus", () => {
  it("preenche venda e aluguel com valores distintos", () => {
    const corpus =
      "Casa à venda por R$ 680.000. Também disponível para aluguel por R$ 3.200 / mês.";
    const { sale_price, rent_price } = inferDualPricesFromCorpus("https://www.casa63.com.br/imovel/x", corpus);
    expect(sale_price).toBe("680000");
    expect(rent_price).toBe("3200");
  });

  it("não duplica o mesmo valor nos dois campos quando só há venda", () => {
    const corpus = "Casa à venda R$ 350.000";
    const { sale_price, rent_price } = inferDualPricesFromCorpus(
      "https://www.casa63.com.br/imovel/x",
      corpus,
    );
    expect(sale_price).toBe("350000");
    expect(rent_price).toBe("");
  });
});

describe("resolvePurposeFromPrices", () => {
  it("retorna vazio quando ambos os preços existem", () => {
    expect(resolvePurposeFromPrices("450000", "2500")).toBe("");
  });

  it("retorna sale ou rent quando só um preço", () => {
    expect(resolvePurposeFromPrices("450000", "")).toBe("sale");
    expect(resolvePurposeFromPrices("", "2500")).toBe("rent");
  });
});
