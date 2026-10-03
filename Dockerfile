# Build stage: minify the frontend into dist/web (see build.ts).
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN node build.ts web

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
# Only the runtime package: highs, the solver the server calculates with. Owned by root, so
# the server can read but not change it.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server.ts workspace.ts planner.ts optimizer.ts docker-start.ts recipes.json ./
# The calculator's modules, which planner.ts re-exports (#776).
COPY --chown=node:node planner ./planner
# The server modules workspace.ts wires together (persistence, accounts, limits, routes).
COPY --chown=node:node server ./server
# The frozen handbook the original-profile migration falls back on (#495), next to
# workspace.ts and outside the public/ the server serves.
COPY --chown=node:node migrations ./migrations
COPY --from=build --chown=node:node /src/dist/web ./public
# The server imports the shared scripts' TypeScript sources (state.ts, transfer.ts,
# preferences.ts, ...), which Node runs as they are; the browser gets the built .js files.
# state.ts re-exports the modules in public/state/ (#532) and preferences.ts those in
# public/preferences/ (#777), which go next to their built .js.
COPY --from=build --chown=node:node /src/public/*.ts ./public/
COPY --from=build --chown=node:node /src/public/state/*.ts ./public/state/
COPY --from=build --chown=node:node /src/public/preferences/*.ts ./public/preferences/
RUN mkdir -p /data && chown node:node /data
USER root
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker-start.ts"]
