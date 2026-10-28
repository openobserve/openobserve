const SECRET_ENV_NAME_RE = /(KEY|TOKEN|SECRET|PASSWORD|AUTH)/;
const MIN_SECRET_LENGTH = 8;
const REDACTED = "[redacted]";
const WORD_JOINER = "⁠";
const ZERO_WIDTH_SPACE = "​";

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
];
const AUTH_HEADER_RE = /(Authorization:)[^\n]*/gi;
const MARKER_RE = /<!--(\s*o2-review)/gi;
const MENTION_RE = /(^|[^\w`@/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9][\w.-]*)?)/g;

export function secretValues(env) {
  const values = new Set();
  for (const [name, value] of Object.entries(env || {})) {
    if (!SECRET_ENV_NAME_RE.test(name) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length >= MIN_SECRET_LENGTH) values.add(trimmed);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

// Secrets are redacted everywhere, code fences included: a token inside a code block is still a leak.
export function scrubSecrets(text, env) {
  let hits = 0;
  let out = text;
  for (const value of secretValues(env)) {
    const parts = out.split(value);
    if (parts.length > 1) {
      hits += parts.length - 1;
      out = parts.join(REDACTED);
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      hits += 1;
      return REDACTED;
    });
  }
  out = out.replace(AUTH_HEADER_RE, (_, label) => {
    hits += 1;
    return `${label} ${REDACTED}`;
  });
  return { text: out, hits };
}

export function breakMarkers(text) {
  return text.replace(MARKER_RE, `<!-${ZERO_WIDTH_SPACE}-$1`);
}

// GitHub does not notify for mentions inside code, so only prose is touched.
export function neutralizeMentions(text) {
  return splitByCode(text)
    .map(segment => (segment.code ? segment.text : segment.text.replace(MENTION_RE, `$1@${WORD_JOINER}$2`)))
    .join("");
}

export function scrubReviewBody(text, env) {
  const secrets = scrubSecrets(text, env);
  return { text: neutralizeMentions(breakMarkers(secrets.text)), secretHits: secrets.hits };
}

export function splitByCode(text) {
  const segments = [];
  const lines = text.split(/(?<=\n)/);
  let fence = null;
  let buffer = "";
  const flush = code => {
    if (buffer) segments.push({ code, text: buffer });
    buffer = "";
  };
  for (const line of lines) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && match) {
      flush(false);
      fence = match[1];
      buffer = line;
      continue;
    }
    if (fence) {
      buffer += line;
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && line.trim() === match[1]) {
        flush(true);
        fence = null;
      }
      continue;
    }
    buffer += line;
  }
  flush(Boolean(fence));
  return segments.flatMap(segment => (segment.code ? [segment] : splitInlineCode(segment.text)));
}

function splitInlineCode(text) {
  const segments = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ code: false, text: text.slice(last, match.index) });
    segments.push({ code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ code: false, text: text.slice(last) });
  return segments;
}
