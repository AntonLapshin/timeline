# Timeline web app — production image.
#
# Builds the React + TypeScript + Tailwind bundle with Vite and serves the
# static output with `vite preview`. Inside the container the server must bind
# 0.0.0.0 — Docker port publishing forwards to the container's eth0, so a
# loopback bind would make the published port unreachable. Host-side exposure
# is 0.0.0.0:8123 by design (trusted LAN only — the app has no auth; see
# docker-compose.yml and README "Host-system / LAN access").

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
# npm workspaces hoist dev dependencies (vite, vitest, @vitejs/plugin-react)
# into the monorepo-root node_modules, so the serve stage needs the root
# node_modules (plus the @timeline/shared workspace symlink target) — copying
# apps/web alone leaves `vite preview` unable to resolve its own config.
WORKDIR /app
ENV NODE_ENV=production
# Bind all interfaces inside the container (required for Docker port
# publishing); host exposure is 0.0.0.0:8123 by design (trusted LAN only).
ENV HOST=0.0.0.0
ENV PORT=8123
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web
WORKDIR /app/apps/web
# `vite preview` serves the built app (the --host flag overrides the
# vite.config.ts preview block) and proxies /api + /healthz to the backend
# (TIMELINE_API_URL, see docker-compose.yml and vite.config.ts).
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "8123", "--strictPort"]
