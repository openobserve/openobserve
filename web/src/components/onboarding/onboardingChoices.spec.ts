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

import { describe, expect, it, vi } from "vitest";

import { aiCategories } from "@/components/ingestion/ai/data";
import { hasDataSourceCard } from "@/components/ingestion/setupCard/registry";
import useEnterpriseRoutes from "@/composables/shared/useEnterpriseRoutes";
import useIngestionRoutes from "@/composables/shared/useIngestionRoutes";
import en from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";

import {
  buildChoices,
  cardGuidePath,
  findGuides,
  readTraces,
  resolvePath,
  tracesQuery,
} from "./onboardingChoices";

const missing: string[] = [];
const t = ((key: string) => {
  const hit = key.split(".").reduce<any>((o, k) => o?.[k], en);
  if (typeof hit !== "string") missing.push(key);
  return hit ?? key;
}) as unknown as TranslateFn;

const choices = buildChoices(t);

const routeNames = (routes: any[]): string[] =>
  routes.flatMap((r) => [r.name, ...routeNames(r.children ?? [])]).filter(Boolean);

const allGuides = () =>
  choices.flatMap((c) =>
    c.rows.flatMap((r) => [
      ...(r.route ? [{ route: r.route, cardSlug: r.cardSlug }] : []),
      ...(r.groups ?? []).flatMap((g) => g.guides),
    ]),
  );

describe("onboardingChoices", () => {
  it("lists the five choices in the brief's order", () => {
    expect(choices.map((c) => c.id)).toEqual([
      "infrastructure",
      "backend",
      "frontend",
      "logs",
      "llm",
    ]);
  });

  it("points every guide at a route the app registers", () => {
    const registered = new Set([
      ...routeNames(useIngestionRoutes()),
      ...routeNames(useEnterpriseRoutes()),
    ]);
    const used = new Set(allGuides().map((g) => g.route));
    expect([...used].filter((r) => !registered.has(r))).toEqual([]);
  });

  it("has an English string for every key it asks for", () => {
    expect(missing).toEqual([]);
  });

  it("gives every row exactly one way to open: a guide, or a which-one page", () => {
    for (const row of choices.flatMap((c) => c.rows)) {
      expect(Boolean(row.route) !== Boolean(row.groups?.length)).toBe(true);
    }
  });

  it("gives a card slug only to guides whose page renders that registered card", () => {
    const withCard = allGuides().filter((g) => g.cardSlug && !g.otelDocs);
    expect(withCard.filter((g) => !hasDataSourceCard(g.cardSlug))).toEqual([]);
    // Each pair was checked against the route's component (<DataSourceSetupCard slug="...">).
    expect(Object.fromEntries(withCard.map((g) => [g.route, g.cardSlug]))).toEqual({
      ingestFromKubernetes: "kubernetes",
      ingestFromLinux: "linux",
      ingestFromWindows: "windows",
      ingestFromMacOS: "macos",
      GCPConfig: "gcp",
      postgres: "postgres",
      mysql: "mySQL",
      mongodb: "mongoDB",
      redis: "redis",
      sqlserver: "sqlServer",
      oracle: "oracle",
      mariadb: "mariaDB",
      cassandra: "cassandra",
      dynamodb: "dynamoDB",
      snowflake: "snowflake",
      databricks: "databricks",
      aerospike: "aerospike",
      zookeeper: "zookeeper",
      tracesOTLP: "otlpTraces",
    });
  });

  // R16: the language pages are an HTTP logs snippet, so the tiles open the OTLP traces card.
  it.each([
    ["node-js", "nodejs", "js", "Node.js"],
    ["python", "python", "python", "Python"],
    ["java", "java", "java", "Java"],
    ["go", "go", "go", "Go"],
    ["net", "dotnettracing", "dotnet", ".NET"],
    ["rust", "rust", "rust", "Rust"],
    ["fastapi", "fastapi", "python", "Python"],
  ])("opens the OTLP traces card for the %s tile", (id, route, slug, language) => {
    const g = resolvePath(choices, ["backend", "add-a-library-to-your-code", id]);
    expect(g.step).toBe("guide");
    if (g.step !== "guide") return;
    expect(g.guide).toMatchObject({
      id,
      route,
      cardSlug: "otlpTraces",
      otelDocs: { slug, language },
    });
    expect(hasDataSourceCard("otlpTraces")).toBe(true);
  });

  it("finds the onboarding path of a guide with a card by its route", () => {
    expect(cardGuidePath(choices, "ingestFromLinux")).toEqual([
      "infrastructure",
      "linux-windows-or-macos-host",
      "linux",
    ]);
    expect(cardGuidePath(choices, "ingestFromKubernetes")).toEqual([
      "infrastructure",
      "kubernetes-cluster",
    ]);
    expect(cardGuidePath(choices, "curl")).toBeUndefined();
  });

  it("carries a row's card slug onto its guide", () => {
    const g = resolvePath(choices, ["backend", "any-language-with-opentelemetry"]);
    expect(g.step === "guide" && g.guide.cardSlug).toBe("otlpTraces");
  });

  it("builds the AI groups from aiCategories", () => {
    const row = choices.find((c) => c.id === "llm")!.rows.find((r) => r.id === "something-else")!;
    expect(row.groups).toHaveLength(aiCategories.length);
    const total = row.groups!.reduce((n, g) => n + g.guides.length, 0);
    expect(total).toBe(aiCategories.reduce((n, c) => n + c.integrations.length, 0));
  });

  it("splits the host row into three guides", () => {
    const row = choices[0].rows.find((r) => r.id === "linux-windows-or-macos-host")!;
    expect(row.groups).toHaveLength(1);
    expect(row.groups![0].heading).toBeUndefined();
    expect(row.groups![0].guides.map((g) => g.route)).toEqual([
      "ingestFromLinux",
      "ingestFromWindows",
      "ingestFromMacOS",
    ]);
  });

  it("resolves each step and redirects bad segments", () => {
    expect(resolvePath(choices, []).step).toBe("choose");
    expect(resolvePath(choices, ["logs"]).step).toBe("rows");
    expect(resolvePath(choices, ["logs", "something-else"]).step).toBe("which");
    const g = resolvePath(choices, ["infrastructure", "kubernetes-cluster"]);
    expect(g.step === "guide" && g.guide.route).toBe("ingestFromKubernetes");
    const g2 = resolvePath(choices, ["infrastructure", "databases", "postgresql"]);
    expect(g2.step === "guide" && g2.guide.route).toBe("postgres");
    expect(resolvePath(choices, ["infrastructure", "nope"])).toEqual({
      step: "redirect",
      path: ["infrastructure"],
    });
    expect(resolvePath(choices, ["infrastructure", "databases", "nope"])).toEqual({
      step: "redirect",
      path: ["infrastructure", "databases"],
    });
    expect(resolvePath(choices, ["nope"])).toEqual({ step: "redirect", path: [] });
  });

  it("asks about traces only on the Kubernetes cluster row, at its traces segment", () => {
    const asking = choices.flatMap((c) => c.rows.filter((r) => r.traces).map((r) => r.id));
    expect(asking).toEqual(["kubernetes-cluster"]);
    const k8s = ["infrastructure", "kubernetes-cluster"];
    expect(resolvePath(choices, [...k8s, "traces"]).step).toBe("traces");
    expect(resolvePath(choices, [...k8s, "traces", "x"])).toEqual({ step: "redirect", path: k8s });
    expect(resolvePath(choices, [...k8s, "nope"])).toEqual({ step: "redirect", path: k8s });
    const backend = ["backend", "kubernetes-workloads-no-code-changes"];
    expect(resolvePath(choices, [...backend, "traces"])).toEqual({
      step: "redirect",
      path: backend,
    });
  });

  it("reads the tracing answer from a query and writes it back", () => {
    expect(readTraces({})).toEqual({ traces: undefined, languages: [] });
    expect(readTraces({ traces: "nope", langs: "java" })).toEqual({
      traces: undefined,
      languages: [],
    });
    expect(readTraces({ traces: "ebpf", langs: "java" })).toEqual({
      traces: "ebpf",
      languages: [],
    });
    const library = readTraces({ traces: "library", langs: "java,,python" });
    expect(library).toEqual({ traces: "library", languages: ["java", "python"] });
    expect(tracesQuery(library)).toEqual({ traces: "library", langs: "java,python" });
    expect(tracesQuery({ traces: "off", languages: [] })).toEqual({ traces: "off" });
    expect(tracesQuery({ languages: [] })).toEqual({});
  });

  it("resolves the coding agent page, and sends extra segments back to it", () => {
    expect(resolvePath(choices, ["agent"])).toEqual({ step: "agent" });
    expect(resolvePath(choices, ["agent", "claude-code"])).toEqual({
      step: "redirect",
      path: ["agent"],
    });
  });

  it("offers the coding agent on the backend rows that change code", () => {
    const backend = choices.find((c) => c.id === "backend")!;
    expect(backend.rows.filter((r) => r.agent).map((r) => r.id)).toEqual([
      "add-a-library-to-your-code",
      "any-language-with-opentelemetry",
    ]);
    expect(choices.flatMap((c) => c.rows).filter((r) => r.agent)).toHaveLength(2);
  });

  it("finds a guide in another choice", () => {
    // skipRowId is "<choice id>/<row id>": row ids repeat across choices.
    const hits = findGuides(choices, "kafka", "logs/something-else");
    expect(hits).toHaveLength(1);
    expect(hits[0].choice.id).toBe("infrastructure");
    expect(findGuides(choices, "kafka", "infrastructure/something-else")).toHaveLength(0);
  });

  it("lists a guide once when two rows hold it", () => {
    const routes = findGuides(choices, "langchain", "logs/something-else").map(
      (h) => h.guide.route,
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toEqual([...new Set(routes)]);
  });

  it("skips an AI slug the catalog no longer has, and drops a row left empty", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saved = aiCategories.map((c) => c.integrations);
    const gone = new Set([
      "openai",
      "openai-jsts",
      "openai-agents",
      "openai-assistants",
      "anthropic",
    ]);
    aiCategories.forEach((c) => (c.integrations = c.integrations.filter((i) => !gone.has(i.slug))));
    try {
      const llm = buildChoices(t).find((c) => c.id === "llm")!;
      expect(llm.rows.map((r) => r.id)).toEqual([
        "anthropic",
        "langchain-or-langgraph",
        "something-else",
      ]);
      const anthropic = llm.rows.find((r) => r.id === "anthropic")!;
      expect(anthropic.groups![0].guides.map((g) => g.id)).toEqual([
        "anthropic-jsts",
        "claude-agent-sdk",
      ]);
      expect(warn).toHaveBeenCalled();
    } finally {
      aiCategories.forEach((c, i) => (c.integrations = saved[i]));
      warn.mockRestore();
    }
  });
});
