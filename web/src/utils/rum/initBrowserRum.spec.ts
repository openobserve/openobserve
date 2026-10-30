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

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserRumConfig } from "./initBrowserRum";

const rumInit = vi.hoisted(() => vi.fn());
const logsInit = vi.hoisted(() => vi.fn());

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { init: rumInit },
}));
vi.mock("@openobserve/browser-logs", () => ({ openobserveLogs: { init: logsInit } }));

const EXT = "chrome-extension://abcdefghijklmnop";

const RUM: BrowserRumConfig = {
  enabled: true,
  client_token: "token",
  application_id: "app",
  site: "rum.example.com",
  service: "web",
  env: "test",
  version: "v0.70.0",
  organization_identifier: "org",
  api_version: "v1",
  insecure_http: false,
};

// The SDK may be initialised once per page load, so each case gets a fresh module.
const loadHelper = async () => (await import("./initBrowserRum")).initBrowserRum;

const rumBeforeSend = (): ((event: Record<string, unknown>) => boolean) =>
  rumInit.mock.calls[0][0].beforeSend;

const errorEvent = (stack: string) => ({
  type: "error",
  view: { url: "https://cloud.openobserve.ai/web/logs", referrer: "" },
  error: { message: "boom", stack },
});

beforeEach(() => {
  vi.resetModules();
  rumInit.mockReset();
  logsInit.mockReset();
});

describe("initBrowserRum", () => {
  it("initialises the RUM and logs SDKs from the full config's rum block", async () => {
    const initBrowserRum = await loadHelper();

    expect(initBrowserRum(RUM, "http://localhost:5080")).toBe(true);

    expect(rumInit).toHaveBeenCalledTimes(1);
    expect(rumInit.mock.calls[0][0]).toMatchObject({
      applicationId: "app",
      clientToken: "token",
      site: "rum.example.com",
      organizationIdentifier: "org",
      service: "web",
      env: "test",
      version: "v0.70.0",
      apiVersion: "v1",
      insecureHTTP: false,
      startSessionReplayRecordingManually: true,
    });
    expect(logsInit).toHaveBeenCalledTimes(1);
    expect(logsInit.mock.calls[0][0]).toMatchObject({
      clientToken: "token",
      site: "rum.example.com",
      organizationIdentifier: "org",
      version: "v0.70.0",
    });
  });

  it("initialises only once when the full config arrives again for another org", async () => {
    const initBrowserRum = await loadHelper();

    expect(initBrowserRum(RUM, "http://localhost:5080")).toBe(true);
    expect(initBrowserRum({ ...RUM }, "http://localhost:5080")).toBe(true);

    expect(rumInit).toHaveBeenCalledTimes(1);
    expect(logsInit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["disabled", { ...RUM, enabled: false }],
  ])("does not initialise when rum is %s", async (_label, rum) => {
    const initBrowserRum = await loadHelper();

    expect(initBrowserRum(rum, "http://localhost:5080")).toBe(false);

    expect(rumInit).not.toHaveBeenCalled();
    expect(logsInit).not.toHaveBeenCalled();
  });

  it("never throws into the config path and still starts logs when the RUM SDK throws", async () => {
    const initBrowserRum = await loadHelper();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rumInit.mockImplementation(() => {
      throw new Error("rum boom");
    });

    expect(() => initBrowserRum(RUM, "")).not.toThrow();

    expect(logsInit).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports RUM off and retries it on the next config after the RUM SDK throws", async () => {
    const initBrowserRum = await loadHelper();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rumInit.mockImplementationOnce(() => {
      throw new Error("rum boom");
    });

    expect(initBrowserRum(RUM, "")).toBe(false);
    expect(initBrowserRum(RUM, "")).toBe(true);

    expect(rumInit).toHaveBeenCalledTimes(2);
    expect(logsInit).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it.each([["client_token"], ["application_id"], ["site"]])(
    "does not start RUM without %s and starts it from a corrected config",
    async (field) => {
      const initBrowserRum = await loadHelper();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(initBrowserRum({ ...RUM, [field]: "" }, "")).toBe(false);
      expect(rumInit).not.toHaveBeenCalled();

      expect(initBrowserRum(RUM, "")).toBe(true);
      expect(rumInit).toHaveBeenCalledTimes(1);
      expect(rumInit.mock.calls[0][0]).toMatchObject({
        applicationId: "app",
        clientToken: "token",
      });
      expect(logsInit).toHaveBeenCalledTimes(1);
      consoleError.mockRestore();
    },
  );
});

describe("initBrowserRum beforeSend", () => {
  beforeEach(async () => {
    (await loadHelper())(RUM, "");
  });

  it("drops an error whose every frame is a Chrome extension", () => {
    const stack = `TypeError: boom\n    at inject (${EXT}/content.js:1:1)\n    at ${EXT}/x.js:2:2`;
    expect(rumBeforeSend()(errorEvent(stack))).toBe(false);
  });

  it("sends an error with at least one app frame", () => {
    const stack = `TypeError: boom\n    at inject (${EXT}/content.js:1:1)\n    at setup (https://cloud.openobserve.ai/web/assets/index.js:3:4)`;
    expect(rumBeforeSend()(errorEvent(stack))).toBe(true);
  });

  it("drops an error matching an ignored pattern", () => {
    const event = {
      type: "error",
      view: { url: "https://cloud.openobserve.ai/web/logs", referrer: "" },
      error: { message: "ResizeObserver loop completed with undelivered notifications", stack: "" },
    };
    expect(rumBeforeSend()(event)).toBe(false);
  });

  it("still scrubs sign-in tokens from the view URL of an event it sends", () => {
    const event = {
      type: "view",
      view: { url: "https://cloud.openobserve.ai/web/cb#id_token=abc", referrer: "" },
    };
    expect(rumBeforeSend()(event)).toBe(true);
    expect(event.view.url).toBe("https://cloud.openobserve.ai/web/cb#id_token=redacted");
  });

  it("drops a JWT from a click's target name", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
    const event = {
      type: "action",
      view: { url: "https://cloud.openobserve.ai/web/logs", referrer: "" },
      action: { target: { name: `Copy ${jwt}` } },
    };
    expect(rumBeforeSend()(event)).toBe(true);
    expect(event.action.target.name).toBe("Copy ");
  });

  it("drops a log matching an ignored pattern and scrubs the view URL of one it sends", () => {
    const logsBeforeSend = logsInit.mock.calls[0][0].beforeSend as (
      log: Record<string, unknown>,
    ) => boolean;
    expect(logsBeforeSend({ message: "ResizeObserver loop limit exceeded" })).toBe(false);
    const log = {
      message: "hello",
      view: { url: "https://cloud.openobserve.ai/web/cb#id_token=abc" },
    };
    expect(logsBeforeSend(log)).toBe(true);
    expect(log.view.url).toBe("https://cloud.openobserve.ai/web/cb#id_token=redacted");
  });

  it("scrubs a public dashboard slug from a resource URL", () => {
    const event = {
      type: "resource",
      view: { url: "https://cloud.openobserve.ai/web/logs", referrer: "" },
      resource: { url: "https://cloud.openobserve.ai/api/public_dashboards/s3cr3t/panels" },
    };
    expect(rumBeforeSend()(event)).toBe(true);
    expect(event.resource.url).toBe(
      "https://cloud.openobserve.ai/api/public_dashboards/redacted/panels",
    );
  });

  it("scrubs secrets from an error's message and resource URL", () => {
    const event = {
      type: "error",
      view: { url: "https://cloud.openobserve.ai/web/logs", referrer: "" },
      error: {
        message: "Failed to fetch https://cloud.openobserve.ai/web/cb#access_token=abc",
        stack: "",
        resource: { url: "https://cloud.openobserve.ai/api/public_dashboards/s3cr3t/data" },
      },
    };
    expect(rumBeforeSend()(event)).toBe(true);
    expect(event.error.message).toBe(
      "Failed to fetch https://cloud.openobserve.ai/web/cb#access_token=redacted",
    );
    expect(event.error.resource.url).toBe(
      "https://cloud.openobserve.ai/api/public_dashboards/redacted/data",
    );
  });

  it("scrubs secrets from a log's referrer, HTTP URL and message", () => {
    const logsBeforeSend = logsInit.mock.calls[0][0].beforeSend as (
      log: Record<string, unknown>,
    ) => boolean;
    const log = {
      message: "GET https://cloud.openobserve.ai/web/public/dashboards/s3cr3t failed",
      view: {
        url: "https://cloud.openobserve.ai/web/logs",
        referrer: "https://cloud.openobserve.ai/web/cb#id_token=abc",
      },
      http: { url: "https://cloud.openobserve.ai/api/public_dashboards/s3cr3t/data" },
    };
    expect(logsBeforeSend(log)).toBe(true);
    expect(log.view.referrer).toBe("https://cloud.openobserve.ai/web/cb#id_token=redacted");
    expect(log.http.url).toBe("https://cloud.openobserve.ai/api/public_dashboards/redacted/data");
    expect(log.message).toBe(
      "GET https://cloud.openobserve.ai/web/public/dashboards/redacted failed",
    );
  });
});
