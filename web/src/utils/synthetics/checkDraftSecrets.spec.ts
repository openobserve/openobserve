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
import type { BrowserCheck, HttpCheckConfig } from "@/types/synthetics";
import { raw, type TranslateFn } from "@/types/i18n";
import { describeCheckRedacted, redactCheckDraftSecrets } from "./checkDraftSecrets";

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

  it("names nothing when one path cannot be named, so the general note covers them all", () => {
    const data = check({ headers: [{ key: "", value: "" }] });
    expect(
      describeCheckRedacted(["/url", "/headers/0/value"], data, t, { urlLabel: raw("URL") }),
    ).toEqual([]);
  });
});
