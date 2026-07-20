/**
 * Minimal flat-YAML frontmatter parser/serializer.
 * Supports scalars (string, number, boolean) and flat lists ("- item").
 * Intentionally tiny: agent definitions are constrained to this subset (see docs/ARCHITECTURE.md §2).
 */

const FM_RE = /^---\r?\n([\s\S]+?)\r?\n---\r?\n?([\s\S]*)$/;

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value.replace(/^["']|["']$/g, '');
}

export function parseFrontmatter(raw) {
  const match = raw.match(FM_RE);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  const lines = match[1].split(/\r?\n/);
  let currentListKey = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentListKey) {
      meta[currentListKey].push(coerce(listItem[1].trim()));
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (value === '' || value === '[]') {
      meta[key] = [];
      currentListKey = value === '[]' ? null : key;
    } else {
      meta[key] = coerce(value);
      currentListKey = null;
    }
  }
  return { meta, body: match[2].trim() };
}

export function serializeFrontmatter(meta, body) {
  let out = '---\n';
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      out += value.length === 0 ? `${key}: []\n` : `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}\n`;
    } else {
      out += `${key}: ${value}\n`;
    }
  }
  return `${out}---\n\n${body}\n`;
}
