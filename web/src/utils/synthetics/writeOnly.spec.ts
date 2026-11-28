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
  KEEP,
  carriesWriteOnly,
  defaultHeaderSecure,
  isKept,
  readSlot,
  setReplaced,
  slotKey,
  stepUrlRefusal,
  urlRefRefusal,
  writeSlot,
} from "./writeOnly";
import {
  buildCreateBrowserTestPayload,
  buildCreateProtocolCheckPayload,
  mapResponseToBrowserCheck,
  mapResponseToProtocolCheck,
} from "./buildPayload";

const SET = { set: true, updated_at: 1_700_000_000_000_000, updated_by: "marco@acme.io" };

const savedCheck = () =>
  mapResponseToProtocolCheck({
    id: "c1",
    name: "checkout-api",
    type: "http",
    target: "https://api.acme.io/v1/health",
    locations: ["aws-us-east-1"],
    frequency: { type: "minutes", interval: 5 },
    destinations: [],
    variables: [
      { name: "TENANT_ID", value: "acme-eu", secure: false },
      { name: "CHECKOUT_PIN", value: SET, secure: true },
    ],
    auth: { type: "basic", username: "probe-bot", password: SET },
    config: {
      method: "GET",
      headers: [
        { name: "X-Session-Token", value: SET },
        { name: "Accept", value: "application/json" },
      ],
    },
  });

describe("write-only check credentials (V39)", () => {
  it("never puts a kept value in the form model", () => {
    const check = savedCheck();
    expect(check.auth?.password).toBe("");
    expect(check.http?.headers[0].value).toBe("");
    expect(check.variables?.find((v) => v.name === "CHECKOUT_PIN")?.value).toBe("");
    expect(check.writeOnly?.[slotKey.authPassword()]).toEqual({
      updated_at: SET.updated_at,
      updated_by: "marco@acme.io",
    });
    expect(JSON.stringify(check)).not.toContain('"set":true');
  });

  it("saves unchanged write-only slots as {keep: true}", () => {
    const payload: any = buildCreateProtocolCheckPayload(savedCheck());
    expect(payload.auth.password).toEqual(KEEP);
    expect(payload.config.headers[0]).toEqual({ name: "X-Session-Token", value: KEEP });
    expect(payload.config.headers[1]).toEqual({ name: "Accept", value: "application/json" });
    expect(payload.variables.find((v: any) => v.name === "CHECKOUT_PIN").value).toEqual(KEEP);
    expect(payload.variables.find((v: any) => v.name === "TENANT_ID").value).toBe("acme-eu");
    expect(payload.writeOnly).toBeUndefined();
    expect(payload.replacedSlots).toBeUndefined();
  });

  it("sends the typed value once a slot is replaced", () => {
    let check = setReplaced(savedCheck(), slotKey.authPassword(), true);
    check = { ...check, auth: { ...check.auth!, password: "n3w" } };
    expect(isKept(check, slotKey.authPassword())).toBe(false);
    expect((buildCreateProtocolCheckPayload(check) as any).auth.password).toBe("n3w");
    const back = setReplaced(check, slotKey.authPassword(), false);
    expect(writeSlot(back, slotKey.authPassword(), "")).toEqual(KEEP);
  });

  it("sends a value typed into a kept slot even without Replace", () => {
    const check = savedCheck();
    const typed = { ...check, auth: { ...check.auth!, password: "typed" } };
    expect((buildCreateProtocolCheckPayload(typed) as any).auth.password).toBe("typed");
  });

  it("applies the server's name rule when a header has no secure flag", () => {
    for (const name of [
      "Authorization",
      "proxy-authorization",
      "Cookie",
      "X-Api-Key",
      "x-session-token",
      "Client-Secret",
    ]) {
      expect(defaultHeaderSecure(name)).toBe(true);
    }
    for (const name of ["Accept", "Content-Type", "X-Keyboard"]) {
      expect(defaultHeaderSecure(name)).toBe(false);
    }
  });

  it("reads a plain value as is", () => {
    const meta = {};
    expect(readSlot("abc", "k", meta)).toBe("abc");
    expect(meta).toEqual({});
  });
});

describe("no secrets in a check URL (V34, R15 F01)", () => {
  const secure = new Set(["CHECKOUT_PIN"]);
  it("refuses a secret ref, a secure variable and an auth placeholder", () => {
    expect(urlRefRefusal("https://h/x?k={{secrets.API_TOKEN}}", secure)).toMatchObject({
      name: "API_TOKEN",
      kind: "secret",
    });
    expect(urlRefRefusal("https://h/x?pin={{CHECKOUT_PIN}}", secure)).toMatchObject({
      name: "CHECKOUT_PIN",
      kind: "secure_variable",
      code: "ref_not_allowed_in_field",
    });
    expect(urlRefRefusal("https://h/{{O2_AUTH_TOKEN}}", secure)?.kind).toBe("auth_value");
  });

  it("allows a plain variable", () => {
    expect(urlRefRefusal("https://{{API_HOST}}/v1/health?t={{TENANT_ID}}", secure)).toBeNull();
  });
});

describe("capture note trigger (R16 A-05)", () => {
  it("is on for a kept credential and off for a plain check", () => {
    expect(carriesWriteOnly(savedCheck())).toBe(true);
    const plain = {
      ...savedCheck(),
      writeOnly: {},
      auth: undefined,
      variables: [],
      http: undefined,
    };
    expect(carriesWriteOnly(plain as any)).toBe(false);
  });
});

describe("browser check write-only slots (U5b, D269)", () => {
  const savedBrowser = () =>
    mapResponseToBrowserCheck({
      id: "b1",
      name: "login-flow",
      type: "browser",
      target: "https://shop.acme.io/login",
      locations: ["aws-us-east-1"],
      frequency: { type: "minutes", interval: 5 },
      destinations: [],
      config: {
        steps: [
          { id: "step-a", action: "navigate", url: "https://shop.acme.io/login" },
          { id: "step-b", action: "fill", locator: { candidates: [] }, value: SET },
        ],
      },
      cookies: [{ name: "csrf", value: SET, domain: "shop.acme.io", path: "/", secure: true }],
    });

  it("keeps a kept step's stored id and reads its marker as Set, never as a value", () => {
    const check = savedBrowser();
    expect(check.journey[1].id).toBe("step-b");
    expect(check.journey[1].value).toBe("");
    expect(check.journey[1].valueSet).toEqual({
      updated_at: SET.updated_at,
      updated_by: SET.updated_by,
    });
  });

  it("saves an untouched step value and cookie as keeps, with the cookie's identity", () => {
    const body = buildCreateBrowserTestPayload(savedBrowser()) as any;
    expect(body.config.steps[1]).toMatchObject({ id: "step-b", value: KEEP });
    expect(body.cookies[0]).toEqual({
      name: "csrf",
      value: KEEP,
      domain: "shop.acme.io",
      path: "/",
      secure: true,
    });
  });

  it("sends a replaced step value as typed", () => {
    const check = savedBrowser();
    check.journey[1] = { ...check.journey[1], valueReplaced: true, value: "new-pin" };
    const body = buildCreateBrowserTestPayload(check) as any;
    expect(body.config.steps[1].value).toBe("new-pin");
  });

  it("sends a cookie that holds a secret as Secure", () => {
    const check = savedBrowser();
    check.cookies = [{ name: "session", value: "{{secrets.SESSION}}", domain: "shop.acme.io" }];
    const body = buildCreateBrowserTestPayload(check) as any;
    expect(body.cookies[0].secure).toBe(true);
  });

  it("refuses a navigate step URL that names a browser secret", () => {
    const check = savedBrowser();
    check.secrets = [{ name: "OTP", value: "" }];
    check.journey[0] = { ...check.journey[0], value: "https://shop.acme.io/?k={{OTP}}" };
    expect(stepUrlRefusal(check)).toEqual({
      index: 0,
      refusal: { code: "ref_not_allowed_in_field", name: "OTP", kind: "secure_variable" },
    });
    check.journey[0] = { ...check.journey[0], value: "https://shop.acme.io/login" };
    expect(stepUrlRefusal(check)).toBeNull();
  });
});
