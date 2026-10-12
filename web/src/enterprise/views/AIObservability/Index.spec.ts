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
// AIObservabilityShell's rail shows every section on every build — on a true
// OSS build, everything beyond Monitor's LLM Insights + Sessions renders
// LOCKED (lock icon + pitch-card tooltip) rather than being hidden, so OSS
// users can discover the rest of the module instead of never knowing it
// exists. All of it is still reachable (not a 404): `web/src/composables/
// router.ts` registers every one of these routes too, each gated with
// `withFeatureGate` so OSS actually landing on one redirects to the shared
// locked-feature page instead of breaking.

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

interface RailItem {
  key: string;
  to: unknown;
  locked?: boolean;
  lockedMessage?: unknown;
}

function groupsOf(wrapper: Awaited<ReturnType<typeof mountShell>>) {
  return wrapper.findComponent(SectionRailStub).props("groups") as Array<{
    label: string;
    items: RailItem[];
  }>;
}

function itemsOf(wrapper: Awaited<ReturnType<typeof mountShell>>) {
  return groupsOf(wrapper).flatMap((g) => g.items);
}

const ALL_GROUP_LABELS = [
  "aiObservability.sections.monitor",
  "aiObservability.sections.evaluate",
  "aiObservability.sections.experiment",
  "aiObservability.sections.annotate",
];

beforeEach(() => {
  vi.resetModules();
  mockIsEnterprise = "false";
  mockIsCloud = "false";
});

describe("AIObservabilityShell — OSS builds (isEnterprise and isCloud both false)", () => {
  it("still shows every group and every item — nothing is hidden", async () => {
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups.map((g) => g.label)).toEqual(ALL_GROUP_LABELS);
    // Rendered in group order (Monitor, Evaluate, Experiment, Annotate —
    // see `sectionGroupOrder`), not AI_OBSERVABILITY_SECTIONS's flat order.
    const keys = itemsOf(wrapper).map((i) => i.key);
    expect(keys).toEqual([
      "llmInsights",
      "sessions",
      "agentGraph",
      "agentBehavior",
      "quality",
      "jobs",
      "scorers",
      "scoreConfigs",
      "prompts",
      "playground",
      "experiments",
      "remoteTasks",
      "discovery",
      "queues",
      "datasets",
    ]);
  });

  it("leaves LLM Insights + Sessions unlocked — OSS serves them for real", async () => {
    const wrapper = await mountShell();
    const items = itemsOf(wrapper);
    const llmInsights = items.find((i) => i.key === "llmInsights")!;
    const sessions = items.find((i) => i.key === "sessions")!;
    expect(llmInsights.locked).toBeFalsy();
    expect(sessions.locked).toBeFalsy();
  });

  it("locks every other item with a message, instead of hiding it", async () => {
    const wrapper = await mountShell();
    const items = itemsOf(wrapper);
    const lockedKeys = [
      "agentGraph",
      "agentBehavior",
      "discovery",
      "queues",
      "datasets",
      "prompts",
      "playground",
      "experiments",
      "remoteTasks",
      "quality",
      "jobs",
      "scorers",
      "scoreConfigs",
    ];
    for (const key of lockedKeys) {
      const item = items.find((i) => i.key === key)!;
      expect(item.locked, `${key} should be locked on a true OSS build`).toBe(true);
      expect(item.lockedMessage, `${key} should carry a lockedMessage`).toBeTruthy();
    }
  });

  it("points every item at the route name the enterprise rail uses too — same registry, same names", async () => {
    const wrapper = await mountShell();
    const items = itemsOf(wrapper);
    expect((items.find((i) => i.key === "llmInsights")!.to as any).name).toBe("aiLLMInsights");
    expect((items.find((i) => i.key === "sessions")!.to as any).name).toBe("aiSessions");
    expect((items.find((i) => i.key === "agentGraph")!.to as any).name).toBe("aiAgentGraph");
    // The four Evaluate tabs all share one route, distinguished by `tab`.
    for (const key of ["quality", "jobs", "scorers", "scoreConfigs"]) {
      const to = items.find((i) => i.key === key)!.to as any;
      expect(to.name).toBe("aiEvaluations");
      expect(to.query.tab).toBe(key);
    }
  });
});

describe("AIObservabilityShell — enterprise/cloud builds", () => {
  it("shows every group and every item, all unlocked, when isEnterprise is true", async () => {
    mockIsEnterprise = "true";
    const wrapper = await mountShell();
    const groups = groupsOf(wrapper);
    expect(groups.map((g) => g.label)).toEqual(ALL_GROUP_LABELS);
    const monitorKeys = groups[0].items.map((i) => i.key);
    expect(monitorKeys).toEqual(["llmInsights", "sessions", "agentGraph", "agentBehavior"]);
    expect(itemsOf(wrapper).every((i) => !i.locked)).toBe(true);
  });

  it("shows every group and every item, all unlocked, when isCloud is true, even with isEnterprise false", async () => {
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
    expect(itemsOf(wrapper).every((i) => !i.locked)).toBe(true);
  });
});
