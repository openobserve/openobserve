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

const SECRET_PREFIX = "whsec_";
const ID_BYTES = 12;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const decodeSecret = (secret: string): Uint8Array<ArrayBuffer> => {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const binary = atob(encoded);
  if (!binary.length) throw new Error("empty signing secret");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/** Standard Webhooks `v1,` signature over `{id}.{timestamp}.{content}`, as the server verifies it (signature.rs). */
export async function signWebhook(
  secret: string,
  id: string,
  timestamp: number,
  content: string | Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const head = encoder.encode(`${id}.${timestamp}.`);
  const body = typeof content === "string" ? encoder.encode(content) : content;
  const message = new Uint8Array(head.length + body.length);
  message.set(head);
  message.set(body, head.length);
  // WebCrypto exists only in a secure context (https or localhost).
  const key = await crypto.subtle.importKey(
    "raw",
    decodeSecret(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, message);
  return `v1,${toBase64(new Uint8Array(mac))}`;
}

export function newWebhookId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return `msg_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
