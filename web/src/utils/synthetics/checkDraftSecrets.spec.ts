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
import type { BrowserCheck, BrowserStep, HttpCheckConfig } from "@/types/synthetics";
import { raw, type TranslateFn } from "@/types/i18n";
import {
  describeCheckRedacted,
  redactCheckDraftSecrets,
  refillTypedStepWires,
  stepTypesCredential,
} from "./checkDraftSecrets";

const check = (over: Partial<BrowserCheck> = {}): BrowserCheck => ({
  name: "Shop",
  url: "https://shop.test",
  enabled: true,
  tags: [],
  journey: [],
  schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
  locations: [],
  notifications: { destinations: [] },
  rum: { collect: false, sessionReplay: false },
  capture: { screenshot: "off", trace: "off" },
  ...over,
});

describe("redactCheckDraftSecrets", () => {
  it("blanks header, cookie and secret values and secure variables, and reports where", () => {
    const { data, paths } = redactCheckDraftSecrets(
      check({
        headers: [{ key: "X-Team", value: "t-1" }],
        cookies: [{ name: "sid", value: "abc", domain: "shop.test" }],
        secrets: [{ name: "PIN", value: "1234" }],
        variables: [
          { name: "USER", value: "ana" },
          { name: "PASS", value: "pw", secure: true },
        ],
      }),
      "/check",
    );
    expect(data.headers?.[0].value).toBe("");
    expect(data.cookies?.[0]).toEqual({ name: "sid", value: "", domain: "shop.test" });
    expect(data.secrets?.[0].value).toBe("");
    expect(data.variables?.map((v) => v.value)).toEqual(["ana", ""]);
    expect(paths).toEqual([
      "/check/headers/0/value",
      "/check/cookies/0/value",
      "/check/secrets/0/value",
      "/check/variables/1/value",
    ]);
  });

  it("blanks every HTTP request header value, whatever the header is named", () => {
    const http: HttpCheckConfig = {
      method: "GET",
      headers: [
        { name: "Cookie", value: "sid=plain" },
        { name: "X-Team", value: "t-1" },
      ],
      body: "",
      follow_redirects: true,
      timeout_ms: 10000,
      assertions: [],
    };
    const input = { ...check(), http };
    const { data, paths } = redactCheckDraftSecrets(input, "/check");
    expect(data.http.headers).toEqual([
      { name: "Cookie", value: "" },
      { name: "X-Team", value: "" },
    ]);
    expect(paths).toEqual(["/check/http/headers/0/value", "/check/http/headers/1/value"]);
    expect(input.http.headers[0].value).toBe("sid=plain");
  });

  it("leaves the input untouched and skips empty values and absent lists", () => {
    const input = check({ headers: [{ key: "X-Empty", value: "" }] });
    const { data, paths } = redactCheckDraftSecrets(input);
    expect(paths).toEqual([]);
    expect(data).toEqual(input);
    expect("cookies" in data).toBe(false);
  });

  it("blanks a target URL that can carry a credential, but keeps a plain one and any host target", () => {
    const tokened = redactCheckDraftSecrets(
      check({ url: "https://shop.test/?token=abc" }),
      "/check",
    );
    expect(tokened.data.url).toBe("");
    expect(tokened.paths).toEqual(["/check/url"]);

    expect(redactCheckDraftSecrets(check({ url: "https://user:pw@shop.test" })).paths).toEqual([
      "/url",
    ]);
    expect(redactCheckDraftSecrets(check()).paths).toEqual([]);
    expect(
      redactCheckDraftSecrets(check({ url: "bot@db.internal" }), "", { hostTarget: true }).paths,
    ).toEqual([]);
  });
});

describe("journey steps that type a credential", () => {
  const typed = (over: Partial<BrowserStep>): BrowserStep => ({
    id: "s1",
    action: "type",
    value: "hunter2",
    ...over,
  });

  it("decides a long run of malformed placeholders without backtracking", () => {
    const started = performance.now();
    const step = typed({ selector: "#password", value: `{{a}} `.repeat(5000) + "{{" });

    expect(stepTypesCredential(step)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it.each([
    ["a password input", { selector: 'input[type="password"]' }],
    [
      "a field named by its role locator",
      { locator: { candidates: [{ kind: "role", value: 'textbox[name="Password"]' }] } },
    ],
    ["a one-time code field", { selector: "#otp" }],
    ["an API key field", { selector: "[name=api_key]" }],
    ["a recorded selector on the wire", { wire: { id: "s1", action: "fill", selector: "#pwd" } }],
    ["a secret-named step", { name: "Enter token" }],
  ] as [string, Partial<BrowserStep>][])("flags typing into %s", (_name, over) => {
    expect(stepTypesCredential(typed(over))).toBe(true);
  });

  it.each([
    ["an email field", typed({ selector: "#email" })],
    ["a click on a password field", typed({ action: "click", selector: "#password" })],
    ["a stored secret reference", typed({ selector: "#password", value: "{{ SHOP_PASSWORD }}" })],
    ["an empty value", typed({ selector: "#password", value: "" })],
  ])("does not flag %s", (_name, step) => {
    expect(stepTypesCredential(step)).toBe(false);
  });

  it("blanks the typed value and its wire, reports the step's path, and keeps every other step", () => {
    const journey = [
      typed({ id: "s1", selector: "#email", value: "ana@shop.test" }),
      typed({
        id: "s2",
        selector: "#password",
        wire: { id: "s2", action: "fill", selector: "#password", value: "hunter2" },
      }),
    ];
    const { data, paths } = redactCheckDraftSecrets(check({ journey }), "/check");

    expect(data.journey[0].value).toBe("ana@shop.test");
    expect(data.journey[1].value).toBe("");
    expect(data.journey[1].wire?.value).toBe("");
    expect(paths).toEqual(["/check/journey/1/value"]);
    expect(JSON.stringify(data)).not.toContain("hunter2");
    expect(journey[1].value).toBe("hunter2");
  });

  it("writes a restored typed value back into its blanked wire", () => {
    const restored = refillTypedStepWires(
      check({
        journey: [
          typed({
            selector: "#password",
            value: "hunter2",
            wire: { id: "s1", action: "fill", selector: "#password", value: "" },
          }),
        ],
      }),
    );
    expect(restored.journey[0].wire?.value).toBe("hunter2");
  });
});

describe("describeCheckRedacted", () => {
  const t = ((key: string, named?: Record<string, unknown>) =>
    raw(`${key}${named ? `:${JSON.stringify(named)}` : ""}`)) as TranslateFn;

  it("names the URL by the label it is given and each entry by its name", () => {
    const data = check({
      headers: [{ key: "X-Team", value: "" }],
      cookies: [{ name: "sid", value: "", domain: "shop.test" }],
      secrets: [{ name: "PIN", value: "" }],
      variables: [{ name: "PASS", value: "", secure: true }],
    });
    expect(
      describeCheckRedacted(
        [
          "/check/url",
          "/check/headers/0/value",
          "/check/cookies/0/value",
          "/check/secrets/0/value",
          "/check/variables/0/value",
        ],
        data,
        t,
        { pointerPrefix: "/check", urlLabel: raw("starting URL") },
      ),
    ).toEqual([
      "starting URL",
      'common.editorDraft.headerField:{"name":"X-Team"}',
      'common.editorDraft.cookieField:{"name":"sid"}',
      'common.editorDraft.secretField:{"name":"PIN"}',
      'common.editorDraft.variableField:{"name":"PASS"}',
    ]);
  });

  it("names a typed journey value by its step's name, or by its number when it has none", () => {
    const data = check({
      journey: [
        { id: "a", action: "type", name: "Type password", value: "" },
        { id: "b", action: "type", value: "" },
      ],
    });
    expect(
      describeCheckRedacted(["/journey/0/value", "/journey/1/value"], data, t, {
        urlLabel: raw("URL"),
      }),
    ).toEqual([
      'common.editorDraft.stepValueField:{"name":"Type password"}',
      'common.editorDraft.stepValueField:{"name":"2"}',
    ]);
  });

  it("names nothing when one path cannot be named, so the general note covers them all", () => {
    const data = check({ headers: [{ key: "", value: "" }] });
    expect(
      describeCheckRedacted(["/url", "/headers/0/value"], data, t, { urlLabel: raw("URL") }),
    ).toEqual([]);
  });
});
