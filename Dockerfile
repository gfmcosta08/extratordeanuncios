FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Browsers já vêm na imagem base — evita mismatch de versão no npm ci.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "dist/server.js"]
