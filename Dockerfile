# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# AIOS — all-in-one image (Next.js standalone + seed of the mutable state).
#
#   build  → compiles .next/standalone (self-contained Node server)
#   runtime→ non-root user, /app/seed pristine copy, volume mounted at /data
#
# The container expects a persistent volume at AIOS_ROOT (default /data):
# projects/, agents/, config/users.json, mcp/ and llm_settings.local.json all
# live there. The entrypoint seeds ONLY missing files on first boot.
# ---------------------------------------------------------------------------

FROM node:20-alpine AS build
WORKDIR /app

# Install deps from the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Build the standalone server.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AIOS_ROOT=/data

# Non-root user. The /data volume and /app/seed must be writable by it.
RUN addgroup -S aios && adduser -S aios -G aios

# Standalone server + static assets (the only runtime artefacts needed).
# NOTE: no `COPY public/` — this project has no static asset directory. Do not
# re-add the line from the stock Next.js Dockerfile: it fails the build.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Pristine seed of the mutable state, copied to the volume on first boot.
COPY --from=build /app/agents ./seed/agents
COPY --from=build /app/mcp ./seed/mcp
COPY --from=build /app/config/users.json ./seed/config/users.json

# Entrypoint that seeds missing files onto the volume, then runs the server.
# (.dockerignore excludes scripts/ but re-includes this one file explicitly.)
COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh \
  && mkdir -p /data \
  && chown -R aios:aios /data /app

USER aios
EXPOSE 3000

# The volume mount point (declared for documentation; fly.toml mounts it).
VOLUME ["/data"]

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
