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

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LINK_REQUEST_TTL_MS,
  classifySlackLinkError,
  forgetLinkRequest,
  isSafeReturnUrl,
  isSlackUrl,
  parseLinkRequestParam,
  recallLinkRequest,
  rememberLinkRequest,
} from "./slackLink";

const refusal = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error("refused"), { response: { status, data: { code: status, ...data } } });

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("classifySlackLinkError (spec 7.3 error table)", () => {
  it.each([
    [400, "expired"],
    [410, "expired"],
    [404, "unknown"],
    [429, "rateLimited"],
    [500, "failed"],
  ])("maps %i to %s", (status, kind) => {
    expect(classifySlackLinkError(refusal(status), "noAccess").kind).toBe(kind);
  });

  it("reads a network failure as failed", () => {
    expect(classifySlackLinkError(new Error("Network Error"), "noAccess").kind).toBe("failed");
  });

  it("splits the two 403s by error_detail and keeps the server sentence and help contact", () => {
    const noAccess = classifySlackLinkError(
      refusal(403, {
        message: "You don't have access to OpenObserve in Acme yet",
        error_detail: "no_access",
        hint: "#observability-help",
      }),
      "wrongAccount",
    );
    expect(noAccess).toEqual({
      kind: "noAccess",
      message: "You don't have access to OpenObserve in Acme yet",
      helpContact: "#observability-help",
    });

    const wrong = classifySlackLinkError(
      refusal(403, { message: "This link was sent to @dana", error_detail: "wrong_account" }),
      "noAccess",
    );
    expect(wrong.kind).toBe("wrongAccount");
    expect(wrong.helpContact).toBeNull();
  });

  it("falls back to the page's reading of a 403 without error_detail", () => {
    expect(classifySlackLinkError(refusal(403), "noAccess").kind).toBe("noAccess");
    expect(classifySlackLinkError(refusal(403), "wrongAccount").kind).toBe("wrongAccount");
  });
});

describe("parseLinkRequestParam", () => {
  it("splits the request id from a signature that contains dots", () => {
    expect(parseLinkRequestParam("req-1.abc.def")).toEqual({ requestId: "req-1", sig: "abc.def" });
    expect(parseLinkRequestParam(["req-2.sig", "other"])).toEqual({
      requestId: "req-2",
      sig: "sig",
    });
  });

  it.each(["", "req-1", ".sig", "req-1.", undefined, null])("rejects %s", (value) => {
    expect(parseLinkRequestParam(value)).toBeNull();
  });
});

describe("remembered link request", () => {
  it("round-trips through localStorage and can be forgotten", () => {
    rememberLinkRequest("req-1.sig", "#help");
    expect(recallLinkRequest()).toEqual({ r: "req-1.sig", helpContact: "#help" });
    forgetLinkRequest();
    expect(recallLinkRequest()).toBeNull();
  });

  it("ignores a malformed entry", () => {
    localStorage.setItem("o2.slack.linkRequest", "{not json");
    expect(recallLinkRequest()).toBeNull();
    localStorage.setItem("o2.slack.linkRequest", JSON.stringify({ r: "nodot" }));
    expect(recallLinkRequest()).toBeNull();
  });
});

describe("remembered link request expiry", () => {
  it("is ignored and dropped once the 30 minute link lifetime has passed", () => {
    vi.useFakeTimers({ now: new Date("2026-10-15T10:00:00Z") });
    rememberLinkRequest("req-1.sig", null);
    vi.setSystemTime(Date.now() + LINK_REQUEST_TTL_MS - 1);
    expect(recallLinkRequest()?.r).toBe("req-1.sig");
    vi.setSystemTime(Date.now() + 2);
    expect(recallLinkRequest()).toBeNull();
    expect(localStorage.getItem("o2.slack.linkRequest")).toBeNull();
  });

  it("drops an entry stored without an expiry", () => {
    localStorage.setItem("o2.slack.linkRequest", JSON.stringify({ r: "req-1.sig" }));
    expect(recallLinkRequest()).toBeNull();
  });
});

describe("isSlackUrl", () => {
  it.each([
    "https://slack.com/oauth/v2/authorize?client_id=1&state=s",
    "https://slack.com/openid/connect/authorize?state=s",
    "https://acme.slack.com/archives/C0/p1",
  ])("accepts %s", (url) => {
    expect(isSlackUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(document.domain)",
    "http://slack.com/oauth/v2/authorize",
    "https://slack.com.evil.example/oauth",
    "https://evilslack.com/oauth",
    "https://user:pass@slack.com/oauth",
    "https://slack.com:8443/oauth",
    "data:text/html,hi",
    "",
    undefined,
  ])("rejects %s", (url) => {
    expect(isSlackUrl(url)).toBe(false);
  });

  it("pins an exact host when one is given", () => {
    expect(isSlackUrl("https://api.slack.com/apps/A0/general", "api.slack.com")).toBe(true);
    expect(isSlackUrl("https://slack.com/apps/A0", "api.slack.com")).toBe(false);
    expect(isSlackUrl("https://evil.api.slack.com/apps", "api.slack.com")).toBe(false);
  });
});

describe("isSafeReturnUrl", () => {
  it("accepts a Slack permalink or a page of this OpenObserve", () => {
    expect(isSafeReturnUrl("https://slack.com/app_redirect?team=T0&channel=C0")).toBe(true);
    expect(isSafeReturnUrl(`${window.location.origin}/web/logs`)).toBe(true);
  });

  it.each(["javascript:alert(1)", "https://evil.example/phish", "http://slack.com/app_redirect"])(
    "rejects %s",
    (url) => {
      expect(isSafeReturnUrl(url)).toBe(false);
    },
  );
});
