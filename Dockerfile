# Build stage: minify the frontend into dist/web (see build.mjs).
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN node build.mjs web

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json server.mjs workspace.mjs planner.mjs optimizer.mjs docker-start.mjs recipes.json ./
COPY --chown=node:node vendor ./vendor
COPY --from=build --chown=node:node /src/dist/web ./public
# The server imports the shared scripts' TypeScript sources (state.ts, transfer.ts,
# preferences.ts, ...), which Node runs as they are; the browser gets the built .js files.
COPY --from=build --chown=node:node /src/public/*.ts ./public/
RUN mkdir -p /data && chown node:node /data
USER root
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker-start.mjs"]
