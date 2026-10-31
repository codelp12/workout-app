# syntax=docker/dockerfile:1

# Keep the Node version in sync with `node@runtime` in pnpm-lock.yaml.
ARG NODE_VERSION=24.22.2

FROM node:${NODE_VERSION}-slim AS build
# Keep in sync with `packageManager` in package.json.
RUN npm install --global pnpm@12.16.1
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @workout-app/server deploy --prod /out/server \
    && cp -r apps/server/dist /out/server/dist \
    && cp -r apps/web/dist /out/web

FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app/server
COPY --from=build /out/server/package.json ./
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /out/server/dist ./dist
COPY --from=build /out/web ../web/dist
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
