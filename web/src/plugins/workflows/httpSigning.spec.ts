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
import { newWebhookId, signWebhook } from "./httpSigning";

// The published Standard Webhooks vector; the server tests the same one (signature.rs).
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TS = 1614265330;
const BODY = '{"test": 2432232314}';
const SIGNATURE = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

describe("signWebhook", () => {
  it("reproduces the Standard Webhooks test vector", async () => {
    await expect(signWebhook(SECRET, ID, TS, BODY)).resolves.toBe(SIGNATURE);
  });

  it("accepts the secret without its whsec_ prefix", async () => {
    await expect(signWebhook(SECRET.slice("whsec_".length), ID, TS, BODY)).resolves.toBe(SIGNATURE);
  });

  it("signs bytes exactly as it signs the same string", async () => {
    await expect(signWebhook(SECRET, ID, TS, new TextEncoder().encode(BODY))).resolves.toBe(
      SIGNATURE,
    );
  });

  it("a different body gives a different signature", async () => {
    await expect(signWebhook(SECRET, ID, TS, '{"test": 1}')).resolves.not.toBe(SIGNATURE);
  });

  it("rejects a secret that is not base64", async () => {
    await expect(signWebhook("whsec_***", ID, TS, BODY)).rejects.toThrow();
  });
});

describe("newWebhookId", () => {
  it("is msg_ plus 24 hex characters and differs per call", () => {
    const first = newWebhookId();
    const second = newWebhookId();

    expect(first).toMatch(/^msg_[0-9a-f]{24}$/);
    expect(second).toMatch(/^msg_[0-9a-f]{24}$/);
    expect(first).not.toBe(second);
  });
});
