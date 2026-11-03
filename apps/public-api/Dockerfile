# Build context: repository root.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@showcase/public-api..." \
 && pnpm --filter "@showcase/public-api..." build \
 && pnpm deploy --legacy --filter @showcase/public-api --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /cache && chown node:node /cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "dist/index.js"]
