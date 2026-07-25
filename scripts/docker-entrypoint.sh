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
set -eu

AIOS_ROOT="${AIOS_ROOT:-/data}"
SEED="/app/seed"

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

echo "[entrypoint] seeding completato — avvio server"
exec "$@"
