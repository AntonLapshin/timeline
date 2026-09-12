# Timeline web app — production image.
#
# Builds the React + TypeScript + Tailwind bundle with Vite and serves the
# static output with `vite preview`. The app is bound to loopback only
# (127.0.0.1) because it has no auth — it must never be exposed to the LAN or
# internet (never set HOST to 0.0.0.0).

# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Install the whole monorepo so `packages/shared` is available to the web build.
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm ci

WORKDIR /app/apps/web
RUN npm run build

# --- Serve stage ---
FROM node:20-alpine AS serve
WORKDIR /app/apps/web
ENV NODE_ENV=production
# Loopback bind only — no auth. Never change to 0.0.0.0.
ENV HOST=127.0.0.1
ENV PORT=8123
# Copy the whole built web app (source + dist + node_modules + vite config).
COPY --from=build /app/apps/web ./
# `vite preview` serves the built app on 127.0.0.1:8123 (reads vite.config.ts).
CMD ["npx", "vite", "preview", "--host", "127.0.0.1", "--port", "8123", "--strictPort"]
