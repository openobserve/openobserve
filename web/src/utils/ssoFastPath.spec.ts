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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const indexHtml = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const inlineScripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]);
const fastPathSource = inlineScripts.find((src) => src.includes("__o2SsoFastPath"));

interface Env {
  cloud?: string;
  endpoint?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  body?: string;
  ok?: boolean;
  reject?: boolean;
  referrer?: string;
  hang?: boolean;
}

const run = (env: Env = {}) => {
  const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
    env.hang
      ? new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        )
      : env.reject
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ ok: env.ok ?? true, text: () => Promise.resolve(env.body ?? "") }),
  );
  const location = {
    pathname: env.pathname ?? "/web/login",
    search: env.search ?? "",
    hash: env.hash ?? "",
    origin: "https://app.example.com",
    href: "https://app.example.com/web/login",
  };
  const win: Record<string, any> = { location, fetch: fetchMock };
  const source = (fastPathSource ?? "")
    .replace(/%VITE_OPENOBSERVE_CLOUD%/g, env.cloud ?? "true")
    .replace(/%VITE_OPENOBSERVE_ENDPOINT%/g, env.endpoint ?? "https://api.example.com/");
  new Function(
    "window",
    "location",
    "fetch",
    "URL",
    "URLSearchParams",
    "AbortController",
    "setTimeout",
    "document",
    source,
  )(win, location, fetchMock, URL, URLSearchParams, AbortController, setTimeout, {
    referrer: env.referrer ?? "",
  });
  return { win, location, fetchMock };
};

describe("index.html cloud SSO fast path", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("exists as an inline script, so cloud logins need not wait for the app bundle", () => {
    expect(fastPathSource).toBeDefined();
  });

  it("requests dex_login with cookies and redirects to the returned URL", async () => {
    const { win, location, fetchMock } = run({
      body: JSON.stringify("https://dex.example.com/auth?x=1"),
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/config/dex_login", {
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
    await expect(win.__o2SsoFastPath).resolves.toBe(true);
    expect(location.href).toBe("https://dex.example.com/auth?x=1");
  });

  it("opens the Create account tab when the signup link was used", async () => {
    const { win, location } = run({
      search: "?mode=signup",
      body: JSON.stringify("https://dex.example.com/auth?x=1"),
    });
    await win.__o2SsoFastPath;
    expect(location.href).toBe("https://dex.example.com/auth?x=1&screen_hint=signup");
  });

  it("does not add a second screen_hint", async () => {
    const { win, location } = run({
      search: "?mode=signup",
      body: JSON.stringify("https://dex.example.com/auth?screen_hint=login"),
    });
    await win.__o2SsoFastPath;
    expect(location.href).toBe("https://dex.example.com/auth?screen_hint=login");
  });

  it("derives the API from the page origin when no endpoint is baked into the build", () => {
    const { fetchMock } = run({ endpoint: "%VITE_OPENOBSERVE_ENDPOINT%" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://app.example.com/config/dex_login");
  });

  it("keeps a path prefix in front of /web/ when deriving the API", () => {
    const { fetchMock } = run({
      endpoint: "%VITE_OPENOBSERVE_ENDPOINT%",
      pathname: "/o2/web/login",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://app.example.com/o2/config/dex_login");
  });

  it("still redirects when login_as_internal_user is set, as the app did on cloud", async () => {
    const { win, location } = run({
      search: "?login_as_internal_user=true",
      body: JSON.stringify("https://dex.example.com/auth"),
    });
    await expect(win.__o2SsoFastPath).resolves.toBe(true);
    expect(location.href).toBe("https://dex.example.com/auth");
  });

  it("treats the signup page as a signup visit", async () => {
    const { win, location } = run({
      pathname: "/web/signup",
      body: JSON.stringify("https://dex.example.com/auth?x=1"),
    });
    await win.__o2SsoFastPath;
    expect(location.href).toBe("https://dex.example.com/auth?x=1&screen_hint=signup");
  });

  it("aborts a request that hangs and resolves false so the app can take over", async () => {
    vi.useFakeTimers();
    try {
      const { win } = run({ hang: true });
      vi.advanceTimersByTime(10000);
      await expect(win.__o2SsoFastPath).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["a self-hosted build", { cloud: "%VITE_OPENOBSERVE_CLOUD%" }],
    ["a cloud build off the login page", { pathname: "/web/logs" }],
    ["the Dex callback", { pathname: "/web/cb", hash: "#id_token=abc" }],
    ["a Dex callback that lands on the login page", { hash: "#id_token=abc" }],
    ["a signup link carrying utm_content", { search: "?mode=signup&utm_content=rum" }],
    ["a visit from the docs", { referrer: "https://openobserve.ai/docs/ingestion/logs/" }],
  ])("stays out of the way on %s", (_name, env) => {
    const { win, fetchMock } = run(env);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.__o2SsoFastPath).toBeUndefined();
  });

  it.each([
    ["a failed request", { reject: true }],
    ["an error status", { ok: false, body: "boom" }],
    ["an empty body", { body: "" }],
    ["a non-URL body", { body: "<html>fallback page</html>" }],
  ])("resolves false after %s so the app falls back to its own flow", async (_name, env) => {
    const { win, location } = run(env);
    await expect(win.__o2SsoFastPath).resolves.toBe(false);
    expect(location.href).toBe("https://app.example.com/web/login");
  });
});
