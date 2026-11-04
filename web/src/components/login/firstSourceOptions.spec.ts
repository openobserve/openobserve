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
  FIRST_SOURCE_STORAGE_PREFIX,
  firstSourceOption,
  firstSourcePickRoute,
  readFirstSource,
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
    it("lists the 12 options in the approved order", () => {
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
        "sample",
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
        "Explore sample data",
        "Not sure yet",
      ]);
    });

    it("maps each option to its guide route, sample data and Not sure yet to none", () => {
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
        sample: undefined,
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

    it("gives the pick's guide route, and none for sample data, Not sure yet or no pick", () => {
      writeFirstSource("acme", "webserver");
      expect(firstSourcePickRoute("acme")).toBe("nginx");
      writeFirstSource("acme", "sample");
      expect(firstSourcePickRoute("acme")).toBeUndefined();
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
