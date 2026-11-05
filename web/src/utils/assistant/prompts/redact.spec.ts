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

import { describe, expect, it } from "vitest";

import { REDACTED, isSecretKey, redactSecrets, redactText, withoutSecretKeys } from "./redact";

describe("redactText", () => {
  it.each([
    ["Authorization: Bearer abc.def.ghi-123", `Authorization: ${REDACTED}`],
    ["authorization=Basic dXNlcjpwYXNzd29yZA==", `authorization=${REDACTED}`],
    ["curl -H 'x' Bearer eyJhbGciOiJIUzI1NiJ9xyz", `curl -H 'x' Bearer ${REDACTED}`],
    ["login failed password=hunter22 for bob", `login failed password=${REDACTED} for bob`],
    ['{"db_password": "s3cr3t", "user": "bob"}', `{"db_password": ${REDACTED}, "user": "bob"}`],
    ["?api_key=AbC123&page=2", `?api_key=${REDACTED}&page=2`],
    ["key AKIAIOSFODNN7EXAMPLE used", `key ${REDACTED} used`],
    [
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      `jwt ${REDACTED}`,
    ],
    ["https://bob:hunter22@db.example.com/x", `https://bob:${REDACTED}@db.example.com/x`],
    ["sent basic dXNlcjpwYXNz upstream", `sent basic ${REDACTED} upstream`],
  ])("redacts %s", (input, output) => {
    expect(redactText(input)).toBe(output);
  });

  it("keeps prose after the word Basic", () => {
    const text = "Basic authentication failed for basic plan users";
    expect(redactText(text)).toBe(text);
  });

  it("leaves ordinary text alone", () => {
    const text = "upstream payments returned 502: connection reset after 3 retries";
    expect(redactText(text)).toBe(text);
  });
});

describe("redactSecrets", () => {
  it("redacts secret-named keys and secret-shaped values deep inside a row (secret_in_row)", () => {
    const row = {
      message: "GET /api?token=t0k3nvalue ok",
      headers: { Authorization: "Bearer zzzzzzzzzz", accept: "json" },
      nested: [{ client_secret: "abc" }],
      service: "checkout",
    };
    expect(redactSecrets(row)).toEqual({
      message: `GET /api?token=${REDACTED} ok`,
      headers: { Authorization: REDACTED, accept: "json" },
      nested: [{ client_secret: REDACTED }],
      service: "checkout",
    });
  });

  it("keeps counts and flags under token-like keys, and empty values", () => {
    expect(redactSecrets({ input_tokens: 812, has_token: false, token: "" })).toEqual({
      input_tokens: 812,
      has_token: false,
      token: "",
    });
  });

  it("never mutates its input and survives a cycle", () => {
    const row: Record<string, unknown> = { password: "x" };
    row.self = row;
    const out = redactSecrets(row) as Record<string, unknown>;
    expect(row.password).toBe("x");
    expect(out).toEqual({ password: REDACTED, self: REDACTED });
  });
});

describe("secret keys", () => {
  it.each(["token", "x-auth-token", "client_secret", "PASSWORD", "authorization", "api_key"])(
    "%s is secret",
    (key) => expect(isSecretKey(key)).toBe(true),
  );

  it("strips secret-named span attributes by name", () => {
    expect(
      withoutSecretKeys({ "http.method": "GET", "auth.token": "x", db_password: "y" }),
    ).toEqual({ "http.method": "GET" });
  });
});
