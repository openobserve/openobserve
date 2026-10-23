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
import {
  DEFAULT_SAMPLE_BODY,
  buildMaskedSnippet,
  buildSnippet,
  maskSecret,
  type SnippetLang,
} from "./httpSnippets";

const URL = "https://o2.example.com/api/v2/default/workflows/hooks/7fT2kQ9xLmN4pR8sV1wY3z";
const TOKEN = "o2wh_4fK9pQ2mZ7vX1cR8tY3nB6wL0sD5hJ2gE9aU1oI4k";
const SIGNING = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const BODY = '{"service":"checkout","deploy_id":"d-4821","reason":"canary failed"}';
const LANGS: SnippetLang[] = ["curl", "js", "python"];

const token = { url: URL, mode: "token" as const, secret: TOKEN, sampleBody: BODY };
const signed = { url: URL, mode: "signature" as const, secret: SIGNING, sampleBody: BODY };

describe("buildSnippet", () => {
  it("curl uses -sS and --data-binary", () => {
    const curl = buildSnippet("curl", token);

    expect(curl).toContain(`curl -sS -X POST '${URL}'`);
    expect(curl).toContain(`-H 'Authorization: Bearer ${TOKEN}'`);
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain(`--data-binary '${BODY}'`);
    expect(curl).not.toMatch(/\s-d\s/);
  });

  it("curl escapes a single quote in the body for the shell", () => {
    const curl = buildSnippet("curl", { ...token, sampleBody: `{"note":"it's"}` });

    expect(curl).toContain(`--data-binary '{"note":"it'\\''s"}'`);
  });

  it("adds the Idempotency-Key header when one is given", () => {
    expect(buildSnippet("curl", { ...token, idempotencyKey: "deploy-d-4821" })).toContain(
      "-H 'Idempotency-Key: deploy-d-4821'",
    );
    expect(buildSnippet("curl", token)).not.toContain("Idempotency-Key");
  });

  it("JavaScript posts with fetch, headers and the raw body", () => {
    const js = buildSnippet("js", token);

    expect(js).toContain(`fetch(${JSON.stringify(URL)}, {`);
    expect(js).toContain('method: "POST"');
    expect(js).toContain(`Authorization: ${JSON.stringify(`Bearer ${TOKEN}`)}`);
    expect(js).toContain(`body: ${JSON.stringify(BODY)}`);
  });

  it("Python posts with requests.post and data=body", () => {
    const python = buildSnippet("python", token);

    expect(python).toContain("import requests");
    expect(python).toContain(`requests.post(\n    ${JSON.stringify(URL)},`);
    expect(python).toContain("headers=headers");
    expect(python).toContain("data=body");
    expect(python).toContain(`"Authorization": ${JSON.stringify(`Bearer ${TOKEN}`)}`);
  });

  it("signed mode snippet computes the signature in shell", () => {
    const curl = buildSnippet("curl", signed);

    expect(curl).toContain(`SECRET='${SIGNING}'`);
    expect(curl).toContain(`BODY='${BODY}'`);
    expect(curl).toContain("openssl dgst -sha256 -mac HMAC");
    expect(curl).toContain('-H "webhook-id: $MSG_ID"');
    expect(curl).toContain('-H "webhook-timestamp: $TS"');
    expect(curl).toContain('-H "webhook-signature: v1,$SIG"');
    expect(curl).toContain('--data-binary "$BODY"');
    expect(curl).not.toContain("Authorization");
  });

  it("signed JavaScript and Python sign id.timestamp.body with HMAC-SHA256", () => {
    const js = buildSnippet("js", signed);
    const python = buildSnippet("python", signed);

    expect(js).toContain('createHmac("sha256"');
    expect(js).toContain("`${id}.${ts}.${body}`");
    expect(js).toContain('"webhook-signature": `v1,${signature}`');
    expect(python).toContain('hmac.new(key, f"{msg_id}.{ts}.{body}".encode(), hashlib.sha256)');
    expect(python).toContain('"webhook-signature": f"v1,{signature}"');
  });

  it("a missing secret renders a placeholder, never an empty credential", () => {
    expect(buildSnippet("curl", { ...token, secret: null })).toContain(
      '-H "Authorization: Bearer $O2_HOOK_TOKEN"',
    );
  });
});

describe("buildMaskedSnippet", () => {
  it("masked snippets never contain the secret", () => {
    for (const lang of LANGS) {
      const maskedToken = buildMaskedSnippet(lang, {
        url: URL,
        mode: "token",
        sampleBody: BODY,
        displayPrefix: "o2wh_4fK9…oI4k",
      });
      const maskedSigned = buildMaskedSnippet(lang, {
        url: URL,
        mode: "signature",
        sampleBody: BODY,
        displayPrefix: "whsec_MfKQ…LaSw",
      });

      expect(maskedToken).not.toContain(TOKEN);
      expect(maskedToken).not.toContain("4fK9");
      expect(maskedToken).toContain("o2wh_••••••••••••••••");
      expect(maskedSigned).not.toContain(SIGNING);
      expect(maskedSigned).toContain("whsec_••••••••••••••••");
    }
  });

  it("keeps everything but the credential identical to the real snippet", () => {
    const real = buildSnippet("curl", token);
    const masked = buildMaskedSnippet("curl", {
      url: URL,
      mode: "token",
      sampleBody: BODY,
      displayPrefix: "o2wh_4fK9…oI4k",
    });

    expect(masked).toBe(real.replace(TOKEN, "o2wh_••••••••••••••••"));
  });
});

describe("maskSecret", () => {
  it("keeps the display prefix ends and hides the middle", () => {
    expect(maskSecret("o2wh_4fK9…oI4k")).toBe(`o2wh_4fK9${"•".repeat(20)}oI4k`);
    expect(maskSecret("whsec_Q2xm…8f0=")).toBe(`whsec_Q2xm${"•".repeat(20)}8f0=`);
  });

  it("masks a prefix without an ellipsis whole", () => {
    expect(maskSecret("o2wh_abcd")).toBe(`o2wh_abcd${"•".repeat(20)}`);
  });
});

describe("DEFAULT_SAMPLE_BODY", () => {
  it("is compact JSON", () => {
    expect(JSON.stringify(JSON.parse(DEFAULT_SAMPLE_BODY))).toBe(DEFAULT_SAMPLE_BODY);
  });
});
