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

import { scrubAuthParams, scrubSharePath, scrubShareTokens } from "./scrubAuthParams";

describe("scrubAuthParams", () => {
  it("redacts the SSO callback tokens in the hash and keeps the other markers", () => {
    expect(
      scrubAuthParams(
        "https://cloud.openobserve.ai/web/cb#id_token=eyJhbGci.abc.def&access_token=ya29.x-y&new_user_login=true&pending_invites=true",
      ),
    ).toBe(
      "https://cloud.openobserve.ai/web/cb#id_token=redacted&access_token=redacted&new_user_login=true&pending_invites=true",
    );
  });

  it("redacts query parameters too, including a refresh token and an auth code", () => {
    expect(scrubAuthParams("/web/cb?code=4%2F0AX4&state=xyz&refresh_token=1//0g")).toBe(
      "/web/cb?code=redacted&state=xyz&refresh_token=redacted",
    );
  });

  it("leaves ordinary URLs and empty values alone", () => {
    const url = "/web/logs?org_identifier=default&stream=default#/panel";
    expect(scrubAuthParams(url)).toBe(url);
    expect(scrubAuthParams("")).toBe("");
    expect(scrubAuthParams(undefined)).toBeUndefined();
  });

  it("redacts a public dashboard slug in the page URL and keeps its query and hash", () => {
    expect(
      scrubAuthParams("https://cloud.openobserve.ai/web/public/dashboards/Zx9_kQ-12ab?tz=UTC#top"),
    ).toBe("https://cloud.openobserve.ai/web/public/dashboards/redacted?tz=UTC#top");
    expect(scrubAuthParams("/web/public/dashboards/Zx9_kQ-12ab")).toBe(
      "/web/public/dashboards/redacted",
    );
  });

  it("redacts a public dashboard slug in its API URLs, under any base path", () => {
    expect(scrubAuthParams("https://o2.example.com/api/public_dashboards/Zx9_kQ-12ab")).toBe(
      "https://o2.example.com/api/public_dashboards/redacted",
    );
    expect(scrubAuthParams("/o2/api/public_dashboards/Zx9_kQ-12ab/data?key=r3600&rev=a1")).toBe(
      "/o2/api/public_dashboards/redacted/data?key=r3600&rev=a1",
    );
  });

  it("redacts a slug inside a network error message", () => {
    expect(
      scrubAuthParams("XHR error GET https://o2.example.com/api/public_dashboards/Zx9/data"),
    ).toBe("XHR error GET https://o2.example.com/api/public_dashboards/redacted/data");
  });

  it("leaves the signed-in public link admin APIs alone", () => {
    const url = "/api/default/public_dashboards/status?ids=a,b";
    expect(scrubAuthParams(url)).toBe(url);
    expect(scrubAuthParams("/web/dashboards/public-links?org_identifier=default")).toBe(
      "/web/dashboards/public-links?org_identifier=default",
    );
  });

  it("does not touch parameters that merely contain the token names", () => {
    const url = "/web/tokens?id_token_name=prod&use_code=true";
    expect(scrubAuthParams(url)).toBe(url);
  });
});

describe("scrubSharePath", () => {
  it.each([
    [
      "https://o2.example.com/web/ai/public/tok-abc123?x=1",
      "https://o2.example.com/web/ai/public/:token?x=1",
    ],
    [
      "/web/ai/shared/tok-abc123?org_identifier=default",
      "/web/ai/shared/:token?org_identifier=default",
    ],
    [
      "https://o2.example.com/api/public/ai_chats/tok-abc123?known_seq=4",
      "https://o2.example.com/api/public/ai_chats/:token?known_seq=4",
    ],
    [
      "https://o2.example.com/api/default/ai/shared/tok-abc123/fork",
      "https://o2.example.com/api/default/ai/shared/:token/fork",
    ],
    [
      "https://o2.example.com/web/login?redirect=https%3A%2F%2Fo2.example.com%2Fweb%2Fai%2Fpublic%2FAbC123tok",
      "https://o2.example.com/web/login?redirect=https%3A%2F%2Fo2.example.com%2Fweb%2Fai%2Fpublic%2F:token",
    ],
    [
      "/web/login?redirect=%2fweb%2fai%2fshared%2fAbC123tok%3Forg_identifier%3Ddefault",
      "/web/login?redirect=%2fweb%2fai%2fshared%2f:token%3Forg_identifier%3Ddefault",
    ],
    [
      "/web/login?next=%252Fweb%252Fai%252Fpublic%252FAbC123tok&x=1",
      "/web/login?next=%252Fweb%252Fai%252Fpublic%252F:token&x=1",
    ],
  ])("replaces the token in %s", (url, scrubbed) => {
    expect(scrubSharePath(url)).toBe(scrubbed);
  });

  it("leaves other URLs and empty values alone", () => {
    expect(scrubSharePath("/web/logs?stream=default")).toBe("/web/logs?stream=default");
    expect(scrubSharePath(undefined)).toBeUndefined();
  });

  it("scrubs the resource, error resource and action target of a RUM event", () => {
    const event = {
      resource: { url: "/api/public/ai_chats/tok-1" },
      error: { resource: { url: "/api/default/ai/shared/tok-2" } },
      action: { target: { name: "Open /web/ai/public/tok-3" } },
    };
    scrubShareTokens(event);
    expect(JSON.stringify(event)).not.toMatch(/tok-\d/);
  });
});
