# Build context is the repository root, so the fixture the mock ingestion mode
# replays can be copied in alongside the app.
FROM node:22-alpine AS deps
WORKDIR /app
COPY services/web/package.json services/web/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/web ./
# `standalone` is opt-in so that a local `next build && next start` still works;
# see next.config.ts.
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# The JSON course store and the ingestion fixture both live on disk. Mount a
# volume at /app/.data to keep drafts across a redeploy.
ENV DATA_DIR=/app/.data
ENV FIXTURE_DIR=/app/fixtures

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs docs/productDocs/fixtures ./fixtures
RUN mkdir -p /app/.data && chown nextjs:nodejs /app/.data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
