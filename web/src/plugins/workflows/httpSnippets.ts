// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { HttpAuthMode } from "@/services/workflows";

export type SnippetLang = "curl" | "js" | "python";

export interface SnippetInput {
  url: string;
  mode: HttpAuthMode;
  /** `null` renders an environment-variable placeholder instead of a value. */
  secret: string | null;
  sampleBody: string;
  idempotencyKey?: string;
}

export type MaskedSnippetInput = Omit<SnippetInput, "secret"> & { displayPrefix: string };

export const DEFAULT_SAMPLE_BODY =
  '{"service":"checkout","deploy_id":"d-4821","reason":"canary failed"}';

const MASK = "•";
const TOKEN_ENV = "O2_HOOK_TOKEN";
const SECRET_ENV = "O2_HOOK_SECRET";
const SCHEME_PREFIX: Record<HttpAuthMode, string> = { token: "o2wh_", signature: "whsec_" };

// Single-quoted shell words keep `$` and `\` literal; only `'` needs the close-escape-reopen dance.
const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const json = (value: string): string => JSON.stringify(value);

const curlToken = (input: SnippetInput): string => {
  const auth =
    input.secret === null
      ? `-H "Authorization: Bearer $${TOKEN_ENV}"`
      : `-H ${shellQuote(`Authorization: Bearer ${input.secret}`)}`;
  const lines = [
    `curl -sS -X POST ${shellQuote(input.url)}`,
    `  ${auth}`,
    `  -H 'Content-Type: application/json'`,
  ];
  if (input.idempotencyKey) {
    lines.push(`  -H ${shellQuote(`Idempotency-Key: ${input.idempotencyKey}`)}`);
  }
  lines.push(`  --data-binary ${shellQuote(input.sampleBody)}`);
  return lines.join(" \\\n");
};

// `--data-binary "$BODY"` sends exactly the bytes the HMAC covered.
const curlSigned = (input: SnippetInput): string =>
  [
    input.secret === null ? `SECRET="$${SECRET_ENV}"` : `SECRET=${shellQuote(input.secret)}`,
    `URL=${shellQuote(input.url)}`,
    `BODY=${shellQuote(input.sampleBody)}`,
    `MSG_ID="msg_$(openssl rand -hex 12)"`,
    `TS=$(date +%s)`,
    `KEY_HEX=$(printf '%s' "\${SECRET#whsec_}" | openssl base64 -d -A | od -An -tx1 | tr -d ' \\n')`,
    `SIG=$(printf '%s.%s.%s' "$MSG_ID" "$TS" "$BODY" \\`,
    `      | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$KEY_HEX" -binary | openssl base64 -A)`,
    [
      `curl -sS -X POST "$URL"`,
      `  -H 'Content-Type: application/json'`,
      `  -H "webhook-id: $MSG_ID"`,
      `  -H "webhook-timestamp: $TS"`,
      `  -H "webhook-signature: v1,$SIG"`,
      `  --data-binary "$BODY"`,
    ].join(" \\\n"),
  ].join("\n");

const jsFetch = (url: string, headers: string[], body: string): string =>
  [
    `const response = await fetch(${json(url)}, {`,
    `  method: "POST",`,
    `  headers: {`,
    ...headers.map((h) => `    ${h},`),
    `  },`,
    `  body: ${body},`,
    `});`,
    `console.log(response.status, await response.text());`,
  ].join("\n");

const jsToken = (input: SnippetInput): string => {
  const auth =
    input.secret === null
      ? `Authorization: \`Bearer \${process.env.${TOKEN_ENV}}\``
      : `Authorization: ${json(`Bearer ${input.secret}`)}`;
  const headers = [auth, `"Content-Type": "application/json"`];
  if (input.idempotencyKey) headers.push(`"Idempotency-Key": ${json(input.idempotencyKey)}`);
  return jsFetch(input.url, headers, json(input.sampleBody));
};

const jsSigned = (input: SnippetInput): string =>
  [
    `import { createHmac, randomBytes } from "node:crypto";`,
    ``,
    `const secret = ${input.secret === null ? `process.env.${SECRET_ENV}` : json(input.secret)};`,
    `const body = ${json(input.sampleBody)};`,
    `const id = \`msg_\${randomBytes(12).toString("hex")}\`;`,
    `const ts = Math.floor(Date.now() / 1000);`,
    `const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");`,
    `const signature = createHmac("sha256", key).update(\`\${id}.\${ts}.\${body}\`).digest("base64");`,
    ``,
    jsFetch(
      input.url,
      [
        `"Content-Type": "application/json"`,
        `"webhook-id": id`,
        `"webhook-timestamp": String(ts)`,
        `"webhook-signature": \`v1,\${signature}\``,
      ],
      "body",
    ),
  ].join("\n");

const pythonPost = (url: string): string[] => [
  ``,
  `response = requests.post(`,
  `    ${json(url)},`,
  `    headers=headers,`,
  `    data=body,`,
  `)`,
  `print(response.status_code, response.text)`,
];

const pythonToken = (input: SnippetInput): string => {
  const auth =
    input.secret === null
      ? `"Authorization": f"Bearer {os.environ['${TOKEN_ENV}']}"`
      : `"Authorization": ${json(`Bearer ${input.secret}`)}`;
  const headers = [auth, `"Content-Type": "application/json"`];
  if (input.idempotencyKey) headers.push(`"Idempotency-Key": ${json(input.idempotencyKey)}`);
  return [
    ...(input.secret === null ? [`import os`, ``] : []),
    `import requests`,
    ``,
    `body = ${json(input.sampleBody)}`,
    `headers = {`,
    ...headers.map((h) => `    ${h},`),
    `}`,
    ...pythonPost(input.url),
  ].join("\n");
};

const pythonSigned = (input: SnippetInput): string =>
  [
    `import base64`,
    `import hashlib`,
    `import hmac`,
    ...(input.secret === null ? [`import os`] : []),
    `import secrets`,
    `import time`,
    ``,
    `import requests`,
    ``,
    `secret = ${input.secret === null ? `os.environ["${SECRET_ENV}"]` : json(input.secret)}`,
    `body = ${json(input.sampleBody)}`,
    `msg_id = f"msg_{secrets.token_hex(12)}"`,
    `ts = str(int(time.time()))`,
    `key = base64.b64decode(secret.removeprefix("whsec_"))`,
    `signature = base64.b64encode(`,
    `    hmac.new(key, f"{msg_id}.{ts}.{body}".encode(), hashlib.sha256).digest()`,
    `).decode()`,
    `headers = {`,
    `    "Content-Type": "application/json",`,
    `    "webhook-id": msg_id,`,
    `    "webhook-timestamp": ts,`,
    `    "webhook-signature": f"v1,{signature}",`,
    `}`,
    ...pythonPost(input.url),
  ].join("\n");

const BUILDERS: Record<SnippetLang, Record<HttpAuthMode, (input: SnippetInput) => string>> = {
  curl: { token: curlToken, signature: curlSigned },
  js: { token: jsToken, signature: jsSigned },
  python: { token: pythonToken, signature: pythonSigned },
};

/** The real call (never the dry-run header), so a copied snippet starts a run. */
export function buildSnippet(lang: SnippetLang, input: SnippetInput): string {
  return BUILDERS[lang][input.mode](input);
}

/** Same text as `buildSnippet` with the credential replaced by its scheme and bullets. */
export function buildMaskedSnippet(lang: SnippetLang, input: MaskedSnippetInput): string {
  const { displayPrefix, ...rest } = input;
  const scheme = displayPrefix.includes("_")
    ? displayPrefix.slice(0, displayPrefix.indexOf("_") + 1)
    : SCHEME_PREFIX[input.mode];
  return buildSnippet(lang, { ...rest, secret: `${scheme}${MASK.repeat(16)}` });
}

/** `o2wh_4fK9…oI4k` → `o2wh_4fK9••••••••••••••••••••oI4k`; the display prefix is not secret. */
export function maskSecret(displayPrefix: string): string {
  const [head, tail = ""] = displayPrefix.split("…");
  return `${head}${MASK.repeat(20)}${tail}`;
}
