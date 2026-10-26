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
  buildAgentPrompt,
  buildAgentSetupFile,
  type AgentFocus,
  type AgentSetupContext,
} from "./agentSetupFile";

const ctx = (focus: AgentFocus, endpoint = "https://api.example.test"): AgentSetupContext => ({
  endpoint,
  org: "acme",
  stream: "default",
  focus,
});

const SECTIONS: Record<Exclude<AgentFocus, "auto">, string> = {
  kubernetes: "## Kubernetes cluster",
  host: "## Linux, macOS or Windows host",
  backend: "## Backend service (OpenTelemetry)",
  llm: "## LLM app",
  frontend: "## Web frontend",
  logs: "## Logs only",
};
const FOCUSES = Object.keys(SECTIONS) as Exclude<AgentFocus, "auto">[];
const ALL: AgentFocus[] = ["auto", ...FOCUSES];

describe("buildAgentSetupFile", () => {
  it.each(ALL)("reads the credential from O2_ACCESS_KEY only, for focus %s", (focus) => {
    const file = buildAgentSetupFile(ctx(focus));
    // No placeholder the setup cards fill with the real token is left in.
    expect(file).not.toMatch(/\{token\}|\{url\}|\{org\}|\{stream\}|\{cluster\}|\[BASIC_PASSCODE\]/);
    // Every credential slot names the variable, never a value.
    for (const [, after] of file.matchAll(/Basic (\S+)/g)) {
      expect(after).toMatch(/^\$O2_ACCESS_KEY/);
    }
    for (const [, after] of file.matchAll(
      /(?:--access-key=|-AUTH_KEY |\.\/install\.sh \S+ )(\S+)/g,
    )) {
      expect(after).toMatch(/^"?\$(env:)?O2_ACCESS_KEY/);
    }
  });

  it.each(FOCUSES)("keeps only the %s section for that focus", (focus) => {
    const file = buildAgentSetupFile(ctx(focus));
    expect(file).toContain(SECTIONS[focus]);
    for (const other of FOCUSES.filter((f) => f !== focus)) {
      expect(file).not.toContain(SECTIONS[other]);
    }
    expect(file).not.toContain("## What to set up");
  });

  it("prints the OpenTelemetry exporter settings once, for backend and LLM only", () => {
    const auto = buildAgentSetupFile(ctx("auto"));
    expect(auto.match(/OTEL_EXPORTER_OTLP_ENDPOINT=/g)).toHaveLength(1);
    expect(auto.match(/## OpenTelemetry exporter settings/g)).toHaveLength(1);
    for (const focus of FOCUSES) {
      const has = buildAgentSetupFile(ctx(focus)).includes("## OpenTelemetry exporter settings");
      expect(has).toBe(focus === "backend" || focus === "llm");
    }
  });

  it("lists what to look for, then every section, for auto", () => {
    const file = buildAgentSetupFile(ctx("auto"));
    expect(file).toContain("## What to set up");
    for (const heading of Object.values(SECTIONS)) expect(file).toContain(heading);
  });

  it("strips a trailing slash from the endpoint", () => {
    const file = buildAgentSetupFile(ctx("auto", "https://api.example.test///"));
    expect(file).toContain("- Endpoint: https://api.example.test\n");
    expect(file).toContain('OTEL_EXPORTER_OTLP_ENDPOINT="https://api.example.test/api/acme"');
    expect(file).toContain("https://api.example.test/api/acme/default/_json");
    expect(file).not.toContain("test//");
  });

  it("ends with a test event, its success check and the report", () => {
    const file = buildAgentSetupFile(ctx("backend"));
    expect(file).toContain("## Verify");
    expect(file).toContain('curl -sS -X POST "https://api.example.test/api/acme/default/_json"');
    expect(file).toContain("`status[0].successful` is 1");
    expect(file).toContain("turns green by itself");
    expect(file).not.toMatch(/GET .*\/streams/);
    expect(file.indexOf("## Verify")).toBeGreaterThan(file.indexOf(SECTIONS.backend));
    expect(file.indexOf("## Report back")).toBeGreaterThan(file.indexOf("## Verify"));
  });

  it("uses the setup cards' commands with the variable in the token slot", () => {
    expect(buildAgentSetupFile(ctx("kubernetes"))).toContain('--access-key="$O2_ACCESS_KEY"');
    expect(buildAgentSetupFile(ctx("host"))).toContain(
      'sudo ./install.sh https://api.example.test/api/acme/ "$O2_ACCESS_KEY"',
    );
    expect(buildAgentSetupFile(ctx("host"))).toContain("-AUTH_KEY $env:O2_ACCESS_KEY");
    expect(buildAgentSetupFile(ctx("llm"))).toContain(
      'OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $O2_ACCESS_KEY,stream-name=default"',
    );
    expect(buildAgentSetupFile(ctx("frontend"))).toContain("Never put `O2_ACCESS_KEY` in browser");
    // The browser SDK collects nothing without an application id.
    expect(buildAgentSetupFile(ctx("frontend"))).toContain("- `applicationId`:");
  });
});

describe("buildAgentPrompt", () => {
  it("is one instruction line, a blank line, then the file", () => {
    const [first, blank, ...rest] = buildAgentPrompt(ctx("logs")).split("\n");
    expect(first).toMatch(/^Set up OpenObserve/);
    expect(blank).toBe("");
    expect(rest.join("\n")).toBe(buildAgentSetupFile(ctx("logs")));
  });
});
