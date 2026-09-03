# Build context is the repository root, matching the other services.
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
# Next's standalone server binds whatever HOSTNAME says, and Docker sets HOSTNAME to
# the container id. Resolving that depends on the embedded DNS answering about the
# container itself, which fails intermittently with EAI_AGAIN during startup and
# crash-loops the container. Binding the wildcard removes the dependency entirely.
ENV HOSTNAME=0.0.0.0
# This app holds no state. Courses live in Postgres behind the Go API, so there is
# nothing here to mount a volume for.

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
