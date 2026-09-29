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
//
// @vitest-environment jsdom
//
// AIObservabilityShell's rail is the single source of truth for what's
// reachable in the AI Observability module. On a true OSS build, only
// LLM Insights + Sessions have OSS-registered routes (see
// web/src/composables/router.ts) — everything else here (Agent Graph/
// Behavior, Discovery, Queues, Datasets, Playground, Experiments, Remote
// Tasks, Quality, Eval Jobs, Scorers, Score Configs) would 404, so the rail
// must not link to any of it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

let mockIsEnterprise = "false";
let mockIsCloud = "false";
vi.mock("@/aws-exports", () => ({
  default: {
    get isEnterprise() {
      return mockIsEnterprise;
    },
    get isCloud() {
      return mockIsCloud;
    },
  },
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "test-org" } } }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "aiLLMInsights", query: {} }),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const SectionRailStub = {
  props: ["groups", "activeKey", "title", "icon", "collapsible", "collapsed"],
  template: '<div class="section-rail" />',
};

async function mountShell() {
  const Index = (await import("./Index.vue")).default;
  return mount(Index, {
    global: {
      stubs: {
        SectionRail: SectionRailStub,
        OPageLayout: { template: '<div><slot name="sidebar" /><slot /></div>' },
      },
    },
  });
}

function groupsOf(wrapper: Awaited<ReturnType<typeof mountShell>>) {
  return wrapper.findComponent(SectionRailStub).props("groups") as Array<{
    label: string;
    items: Array<{ key: string; to: unknown }>;
  }>;
}

beforeEach(() => {
  vi.resetModules();
  mockIsEnterprise = "false";
  mockIsCloud = "false";
});

describe("AIObservabilityShell — OSS builds (isEnterprise and isCloud both false)", () => {
  it("shows only the Monitor group, with exactly LLM Insights + Sessions", async () => {
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("aiObservability.sections.monitor");
    expect(groups[0].items.map((i) => i.key)).toEqual(["llmInsights", "sessions"]);
  });

  it("does not link to Agent Graph or Agent Behavior — Monitor's other two items have no OSS route", async () => {
    const wrapper = await mountShell();
    const keys = groupsOf(wrapper).flatMap((g) => g.items.map((i) => i.key));
    expect(keys).not.toContain("agentGraph");
    expect(keys).not.toContain("agentBehavior");
  });

  it("hides Annotate, Experiment, and Evaluate entirely", async () => {
    const wrapper = await mountShell();
    const labels = groupsOf(wrapper).map((g) => g.label);
    expect(labels).not.toContain("aiObservability.sections.annotate");
    expect(labels).not.toContain("aiObservability.sections.experiment");
    expect(labels).not.toContain("aiObservability.sections.evaluate");
  });

  it("points LLM Insights and Sessions at the same route names the enterprise rail uses", async () => {
    const wrapper = await mountShell();
    const items = groupsOf(wrapper)[0].items;
    expect((items[0].to as any).name).toBe("aiLLMInsights");
    expect((items[1].to as any).name).toBe("aiSessions");
  });
});

describe("AIObservabilityShell — enterprise/cloud builds", () => {
  it("shows every group and every item when isEnterprise is true", async () => {
    mockIsEnterprise = "true";
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups.map((g) => g.label)).toEqual([
      "aiObservability.sections.monitor",
      "aiObservability.sections.evaluate",
      "aiObservability.sections.experiment",
      "aiObservability.sections.annotate",
    ]);
    const monitorKeys = groups[0].items.map((i) => i.key);
    expect(monitorKeys).toEqual(["llmInsights", "sessions", "agentGraph", "agentBehavior"]);
  });

  it("shows every group and every item when isCloud is true, even with isEnterprise false", async () => {
    mockIsCloud = "true";
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups).toHaveLength(4);
    expect(groups[0].items.map((i) => i.key)).toEqual([
      "llmInsights",
      "sessions",
      "agentGraph",
      "agentBehavior",
    ]);
  });
});
