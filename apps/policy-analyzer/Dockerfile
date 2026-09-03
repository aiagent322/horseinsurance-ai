# syntax=docker/dockerfile:1.7
FROM node:22.14.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build \
  && mkdir -p tessdata \
  && if [ ! -s tessdata/eng.traineddata ]; then \
       apt-get update \
       && apt-get install -y --no-install-recommends ca-certificates curl \
       && curl -fsSL -o tessdata/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/4.1.0/eng.traineddata \
       && rm -rf /var/lib/apt/lists/*; \
     fi

FROM node:22.14.0-bookworm-slim AS runtime
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.title="horseinsurance-policy-analyzer" \
      org.opencontainers.image.description="Protected analyzer web process and dedicated worker"
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 analyzer \
  && useradd --system --uid 10001 --gid analyzer --home-dir /app --shell /usr/sbin/nologin analyzer \
  && mkdir -p /app /tmp/ocr /tmp/next \
  && chown -R analyzer:analyzer /app /tmp/ocr /tmp/next
WORKDIR /app
COPY --from=deps --chown=analyzer:analyzer /app/node_modules ./node_modules
COPY --from=build --chown=analyzer:analyzer /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build --chown=analyzer:analyzer /app/.next ./.next
COPY --from=build --chown=analyzer:analyzer /app/lib ./lib
COPY --from=build --chown=analyzer:analyzer /app/worker ./worker
COPY --from=build --chown=analyzer:analyzer /app/app ./app
COPY --from=build --chown=analyzer:analyzer /app/components ./components
COPY --from=build --chown=analyzer:analyzer /app/deploy ./deploy
COPY --from=build --chown=analyzer:analyzer /app/tessdata ./tessdata
COPY --from=build --chown=analyzer:analyzer /app/proxy.ts ./proxy.ts
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOME=/app \
    TMPDIR=/tmp/ocr \
    PORT=43147
USER analyzer
ENTRYPOINT ["tini", "--", "node", "deploy/entrypoint.mjs"]
CMD ["web"]
