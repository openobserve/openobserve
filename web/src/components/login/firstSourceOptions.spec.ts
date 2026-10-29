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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enLocale from "@/locales/languages/en-US.json";
import {
  FIRST_SOURCE_OPTIONS,
  FIRST_SOURCE_PREFILL_KEY,
  FIRST_SOURCE_STORAGE_PREFIX,
  capturePrefill,
  clearPrefill,
  docsReferrerSource,
  firstSourceOption,
  firstSourcePickRoute,
  prefillFirstSource,
  readFirstSource,
  readPrefill,
  writeFirstSource,
} from "./firstSourceOptions";

const lookup = (key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], enLocale);

describe("firstSourceOptions", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("FIRST_SOURCE_OPTIONS", () => {
    it("lists the 11 options in the approved order", () => {
      expect(FIRST_SOURCE_OPTIONS.map((o) => o.id)).toEqual([
        "kubernetes",
        "linux",
        "windows",
        "webserver",
        "otel",
        "http",
        "cloud",
        "rum",
        "llm",
        "agent",
        "unsure",
      ]);
    });

    it("gives each option an English label in en-US.json", () => {
      expect(FIRST_SOURCE_OPTIONS.map((o) => lookup(o.labelKey))).toEqual([
        "Kubernetes",
        "Linux or VM host",
        "Windows host",
        "Web server logs",
        "OpenTelemetry app or collector",
        "Logs over HTTP",
        "AWS, Azure or GCP",
        "Browser (RUM)",
        "LLM or AI app",
        "Let an AI agent set it up",
        "Not sure yet",
      ]);
    });

    it("maps each option to its guide route, Not sure yet to none", () => {
      expect(Object.fromEntries(FIRST_SOURCE_OPTIONS.map((o) => [o.id, o.route]))).toEqual({
        kubernetes: "ingestFromKubernetes",
        linux: "ingestFromLinux",
        windows: "ingestFromWindows",
        webserver: "nginx",
        otel: "otelCollector",
        http: "curl",
        cloud: "AWSConfig",
        rum: "frontendMonitoring",
        llm: "ai-integrations",
        agent: "recommendedMcp",
        unsure: undefined,
      });
    });

    it("shows the OpenTelemetry pick's card on Logs, Traces and Metrics", () => {
      expect(firstSourceOption("otel")?.signals).toEqual(["logs", "metrics", "traces"]);
    });

    it("has a logo or a glyph for every option, logos from the data sources assets", () => {
      for (const option of FIRST_SOURCE_OPTIONS) {
        expect(Boolean(option.logo) !== Boolean(option.icon)).toBe(true);
      }
      expect(FIRST_SOURCE_OPTIONS.filter((o) => o.logo).map((o) => o.logo)).toEqual([
        "images/common/kubernetes.svg",
        "images/common/linux.svg",
        "images/common/windows.svg",
        "images/ingestion/nginx.svg",
        "images/ingestion/otlp.svg",
        "images/ingestion/aws.svg",
        "images/common/ai_icon.svg",
      ]);
    });

    it("is frozen", () => {
      expect(Object.isFrozen(FIRST_SOURCE_OPTIONS)).toBe(true);
    });
  });

  describe("prefillFirstSource", () => {
    it.each(FIRST_SOURCE_OPTIONS.map((o) => o.id))("accepts utm_content=%s", (id) => {
      expect(prefillFirstSource({ utm_content: id })).toBe(id);
    });

    it("leaves no pick for an unknown or differently cased utm_content", () => {
      expect(prefillFirstSource({ utm_content: "banner" })).toBeUndefined();
      expect(prefillFirstSource({ utm_content: "Kubernetes" })).toBeUndefined();
      expect(prefillFirstSource({ utm_content: "" })).toBeUndefined();
      expect(prefillFirstSource(undefined)).toBeUndefined();
    });

    it("prefers utm_content over the referrer", () => {
      expect(
        prefillFirstSource(
          { utm_content: "rum" },
          "https://openobserve.ai/docs/ingestion/logs/kubernetes/",
        ),
      ).toBe("rum");
    });

    it("falls back to a docs referrer when utm_content is unknown", () => {
      expect(
        prefillFirstSource(
          { utm_content: "x" },
          "https://openobserve.ai/docs/ingestion/logs/linux/",
        ),
      ).toBe("linux");
    });

    it("reads the referrer stored beside utm_content", () => {
      expect(
        prefillFirstSource({ referrer: "https://openobserve.ai/docs/integration/nginx/" }),
      ).toBe("webserver");
    });
  });

  describe("docsReferrerSource", () => {
    it.each([
      ["https://openobserve.ai/docs/ingestion/logs/kubernetes/", "kubernetes"],
      ["https://openobserve.ai/docs/integration/k8s/", "kubernetes"],
      ["https://openobserve.ai/docs/ingestion/logs/windows", "windows"],
      ["https://openobserve.ai/docs/integration/servers/apache/", "webserver"],
      ["https://openobserve.ai/docs/integration/servers/iis/", "webserver"],
      ["https://openobserve.ai/docs/ingestion/traces/opentelemetry/", "otel"],
      ["https://openobserve.ai/docs/ingestion/logs/curl/", "http"],
      ["https://openobserve.ai/docs/integration/aws/cloudwatch-logs/", "cloud"],
      ["https://openobserve.ai/docs/integration/gcp/", "cloud"],
      ["https://openobserve.ai/docs/rum/", "rum"],
      ["https://openobserve.ai/docs/integration/llm/openai/", "llm"],
      ["https://openobserve.ai/docs/mcp/", "agent"],
      ["https://www.openobserve.ai/docs/ingestion/logs/linux/", "linux"],
    ])("maps %s to %s", (url, id) => {
      expect(docsReferrerSource(url)).toBe(id);
    });

    it("takes the deepest matching segment", () => {
      expect(docsReferrerSource("https://openobserve.ai/docs/opentelemetry/kubernetes/")).toBe(
        "kubernetes",
      );
    });

    it("ignores other hosts, non-docs paths, unmapped guides and junk", () => {
      expect(docsReferrerSource("https://evil.example/docs/kubernetes/")).toBeUndefined();
      expect(
        docsReferrerSource("https://openobserve.ai.evil.example/docs/kubernetes/"),
      ).toBeUndefined();
      expect(docsReferrerSource("https://openobserve.ai/blog/kubernetes/")).toBeUndefined();
      expect(docsReferrerSource("https://openobserve.ai/docs/alerts/")).toBeUndefined();
      expect(docsReferrerSource("not a url")).toBeUndefined();
      expect(docsReferrerSource("")).toBeUndefined();
    });
  });

  describe("capturePrefill / readPrefill", () => {
    it("stores the raw utm_content and a docs referrer", () => {
      capturePrefill("kubernetes", "https://openobserve.ai/docs/ingestion/logs/linux/");
      expect(readPrefill()).toEqual({
        utm_content: "kubernetes",
        referrer: "https://openobserve.ai/docs/ingestion/logs/linux/",
      });
    });

    it("keeps an unknown utm_content raw; mapping happens when the dialog reads it", () => {
      capturePrefill("banner", "");
      expect(readPrefill()).toEqual({ utm_content: "banner" });
      expect(prefillFirstSource(readPrefill())).toBeUndefined();
    });

    it("never replaces a stored pair with nothing (the SSO callback has neither)", () => {
      capturePrefill("rum", "");
      capturePrefill(undefined, "https://dex.openobserve.ai/auth");
      expect(readPrefill()).toEqual({ utm_content: "rum" });
    });

    it("ignores a non-string utm_content and a non-docs referrer", () => {
      capturePrefill(["a", "b"], "https://google.com/");
      expect(sessionStorage.getItem(FIRST_SOURCE_PREFILL_KEY)).toBeNull();
    });

    it("clears the stored pair", () => {
      capturePrefill("rum", "");
      clearPrefill();
      expect(readPrefill()).toBeUndefined();
    });

    it("reads nothing from a corrupt record", () => {
      sessionStorage.setItem(FIRST_SOURCE_PREFILL_KEY, "{oops");
      expect(readPrefill()).toBeUndefined();
    });

    it("survives a storage that throws", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      expect(() => capturePrefill("rum", "")).not.toThrow();
    });
  });

  describe("readFirstSource / writeFirstSource", () => {
    it("round-trips the pick under o2.onboarding.firstSource.<org>", () => {
      writeFirstSource("acme", "otel");
      expect(localStorage.getItem(`${FIRST_SOURCE_STORAGE_PREFIX}acme`)).toBe("otel");
      expect(readFirstSource("acme")).toBe("otel");
      expect(readFirstSource("other")).toBeUndefined();
    });

    it("ignores an unknown stored id and an empty org", () => {
      localStorage.setItem(`${FIRST_SOURCE_STORAGE_PREFIX}acme`, "nope");
      expect(readFirstSource("acme")).toBeUndefined();
      writeFirstSource("", "otel");
      expect(localStorage.length).toBe(1);
      expect(readFirstSource("")).toBeUndefined();
    });

    it("gives the pick's guide route, and none for Not sure yet or no pick", () => {
      writeFirstSource("acme", "webserver");
      expect(firstSourcePickRoute("acme")).toBe("nginx");
      writeFirstSource("acme", "unsure");
      expect(firstSourcePickRoute("acme")).toBeUndefined();
      expect(firstSourcePickRoute("other")).toBeUndefined();
    });

    it("survives a storage that throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      expect(readFirstSource("acme")).toBeUndefined();
    });
  });

  it("firstSourceOption finds by id", () => {
    expect(firstSourceOption("agent")?.route).toBe("recommendedMcp");
    expect(firstSourceOption("missing")).toBeUndefined();
    expect(firstSourceOption(null)).toBeUndefined();
  });
});
