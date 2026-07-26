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

# Copy every seed file that has no counterpart on the volume, leaving existing
# ones strictly untouched. Walks file by file, so it is no-clobber by
# construction and reports exactly what it wrote.
#
# Do NOT "simplify" this back to `cp -Rn "$src/." "$dst/"`. That form works
# under GNU/BSD cp but is a SILENT NO-OP under the BusyBox cp in Alpine: it
# copies nothing and still exits 0, so the volume stays empty, every route
# 500s on a missing mcp/servers.json, and no error is ever logged. That bug
# is invisible unless the seeding is tested inside the actual image.
seed_missing() {
  src_dir="$1"
  dst_dir="$2"
  [ -d "$src_dir" ] || return 0
  find "$src_dir" -type f | while read -r src; do
    rel="${src#"$src_dir"/}"
    dst="$dst_dir/$rel"
    if [ -e "$dst" ]; then
      continue
    fi
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "[entrypoint] seedato ${dst#"$AIOS_ROOT"/}"
  done
}

# config/ seeds users.json only: llm_settings.local.json is deliberately absent
# from the image (it holds API keys) and is created by the Settings panel.
seed_missing "$SEED/agents" "$AIOS_ROOT/agents"
seed_missing "$SEED/mcp" "$AIOS_ROOT/mcp"
seed_missing "$SEED/config" "$AIOS_ROOT/config"

# Fail loudly rather than booting a server that will 500 on every request: the
# gateway opens this file at startup and there is no sane fallback without it.
if [ ! -f "$AIOS_ROOT/mcp/servers.json" ]; then
  echo "[entrypoint] ERRORE: $AIOS_ROOT/mcp/servers.json assente dopo il seeding" >&2
  exit 1
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
