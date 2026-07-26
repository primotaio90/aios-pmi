#!/bin/sh
# AIOS container entrypoint.
#
# The image bakes a pristine "seed" of the mutable state under /app/seed/:
#   seed/agents/          agent definitions (read AND written by agentEdit.mjs)
#   seed/config/users.json  auth users (read by auth.mjs)
#   seed/mcp/servers.json   MCP catalog (read-only, but kept on the volume so the
#                           whole AIOS_ROOT is one consistent tree)
#
# At boot we copy onto the mounted volume (AIOS_ROOT, default /data) ONLY the
# files that are missing — never overwrite. This makes restarts/redeploys
# idempotent: existing client data, edited agent frontmatter and added users
# survive untouched. llm_settings.local.json is NOT seeded: it holds API keys
# and is created by the Settings panel on the volume on first save.
#
# PRIVILEGES — why this script starts as root and the server does not:
# a freshly created Fly volume is mounted OVER the image's /data and arrives
# owned by root:root, discarding any ownership set at build time. Had the image
# declared `USER aios`, the very first mkdir below would fail with EACCES and
# `set -e` would kill the container before the server ever started. So we stay
# root for the seeding + chown, then hand over to the unprivileged user with
# su-exec. Node itself never runs as root.
set -eu

AIOS_ROOT="${AIOS_ROOT:-/data}"
SEED="/app/seed"
APP_USER="aios"
APP_GROUP="aios"

echo "[entrypoint] AIOS_ROOT=$AIOS_ROOT — seeding file mancanti da $SEED"

mkdir -p "$AIOS_ROOT/agents" "$AIOS_ROOT/config" "$AIOS_ROOT/mcp" "$AIOS_ROOT/projects"

# Copy missing files only (cp -n: no clobber). One pass per seeded tree.
copy_missing() {
  src_dir="$1"
  dst_dir="$2"
  [ -d "$src_dir" ] || return 0
  # -n = do not overwrite an existing file; -R keeps the tree flat per dir.
  cp -Rn "$src_dir/." "$dst_dir/" 2>/dev/null || true
}

copy_missing "$SEED/agents" "$AIOS_ROOT/agents"
copy_missing "$SEED/mcp" "$AIOS_ROOT/mcp"

if [ ! -f "$AIOS_ROOT/config/users.json" ] && [ -f "$SEED/config/users.json" ]; then
  cp "$SEED/config/users.json" "$AIOS_ROOT/config/users.json"
  echo "[entrypoint] seedato config/users.json"
fi

# If we are not root (e.g. someone ran the image with `--user`), there is
# nothing to chown and nobody to drop to: run the server as whoever we are.
if [ "$(id -u)" -ne 0 ]; then
  echo "[entrypoint] già non-root (uid $(id -u)) — nessun chown, nessun drop"
  echo "[entrypoint] seeding completato — avvio server"
  exec "$@"
fi

APP_UID="$(id -u "$APP_USER")"
APP_GID="$(id -g "$APP_USER")"

# Adopt the volume. Two cases, kept distinct so the common one stays cheap:
#   - root still owns AIOS_ROOT → first boot on a fresh mount: take the whole
#     tree once (projects/ included, it may already hold restored data).
#   - already ours → only the seeded trees need a pass, because a redeploy may
#     have just copied new files in as root. projects/ is skipped: it can be
#     large and everything in it was written by the unprivileged server.
if [ "$(stat -c %u "$AIOS_ROOT")" -ne "$APP_UID" ]; then
  echo "[entrypoint] volume di proprietà di uid $(stat -c %u "$AIOS_ROOT") — chown -R iniziale su $AIOS_ROOT"
  chown -R "$APP_UID:$APP_GID" "$AIOS_ROOT"
else
  chown -R "$APP_UID:$APP_GID" "$AIOS_ROOT/agents" "$AIOS_ROOT/config" "$AIOS_ROOT/mcp"
fi

echo "[entrypoint] seeding completato — avvio server come $APP_USER (uid $APP_UID)"
exec su-exec "$APP_UID:$APP_GID" "$@"
