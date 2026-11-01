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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAssistant } from "@/components/ai-assistant/__tests__/fakeAssistant";
import { composerUi } from "@/components/ai-assistant/composer/composerUi";
import type { CapabilityAgent, ContextChip } from "@/composables/assistant";
import { queryClient } from "@/composables/query/queryClient";
import { alertKeys } from "@/services/alerts.querykeys";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";

import AssistantMentionMenu, {
  MENTION_GROUP_LIMIT,
  MENTION_SEARCH_LIMIT,
  type MentionOption,
} from "./AssistantMentionMenu.vue";

const { breakpoint, fake } = vi.hoisted(() => ({
  breakpoint: { md: true },
  fake: { current: null as any },
}));

vi.mock("@/composables/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...actual,
    useAssistantStore: () => fake.current?.store ?? actual.useAssistantStore(),
    useAssistantCapability: () => fake.current?.handle ?? actual.useAssistantCapability(),
  };
});

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({ mdUp: computed(() => breakpoint.md), lgUp: computed(() => breakpoint.md) }),
  };
});

vi.mock("@/services/dashboards", () => ({
  default: { list: vi.fn(() => Promise.reject({ response: { status: 403 } })) },
}));

enableAutoUnmount(afterEach);

const ORG = "acme-prod";

function seed(dashboardsError = false) {
  queryClient.clear();
  const streams = Array.from({ length: 10 }, (_, i) => ({
    name: i === 0 ? "checkout" : `stream-${i}`,
  }));
  queryClient.setQueryData(streamKeys.nameList(ORG, "logs"), streams);
  queryClient.setQueryData(streamKeys.nameList(ORG, "metrics"), []);
  queryClient.setQueryData(streamKeys.nameList(ORG, "traces"), []);
  queryClient.setQueryData(alertKeys.list(ORG, "default", undefined, undefined), [
    { alert_id: "a1", name: "checkout-latency" },
  ]);
  queryClient.setQueryData(pipelineKeys.list(ORG), [{ pipeline_id: "p1", name: "ingest-k8s" }]);
  if (!dashboardsError)
    queryClient.setQueryData(dashboardKeys.byFolder(ORG, "default"), [
      { dashboard_id: "d1", title: "Checkout" },
    ]);
}

async function open(query = "", dashboardsError = false) {
  seed(dashboardsError);
  const wrapper = mount(AssistantMentionMenu, {
    props: { open: true, query, org: ORG, listboxId: "lb" },
    attachTo: document.body,
  });
  await flushPromises();
  const options = () => [
    ...document.body.querySelectorAll<HTMLElement>('[data-test="assistant-mention-option"]'),
  ];
  return { wrapper, options };
}

beforeEach(() => {
  breakpoint.md = true;
  fake.current = null;
});

const ROSTER: CapabilityAgent[] = [
  { id: "o2-ai", pickable: true, available: true },
  { id: "sre", pickable: true, available: true },
  { id: "generate-query", pickable: true, available: false, reason: "role" },
];

function withAgents(roster: CapabilityAgent[] = ROSTER) {
  fake.current = fakeAssistant("available", { agents: roster });
  const { store } = fake.current;
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  store.state.shell.activeSid = sid;
  return { store, sid };
}

const agentRows = (wrapper: {
  findAll(q: string): { attributes(n: string): string | undefined }[];
}) =>
  wrapper
    .findAll('[data-test="assistant-mention-agent"]')
    .map((row) => row.attributes("data-agent"));

describe("AssistantMentionMenu: Agents group (MULTI-AGENT-02)", () => {
  it("leads with Agents, filters by name prefix and id, and highlights the match", async () => {
    withAgents();
    const { wrapper } = await open();
    expect(wrapper.findAll('[role="group"]')[0].attributes("data-test")).toBe(
      "assistant-mention-group-agents",
    );
    expect(agentRows(wrapper)).toEqual(["o2-ai", "sre", "generate-query"]);
    for (const query of ["inv", "sre", "Investigator"]) {
      await wrapper.setProps({ query });
      expect(agentRows(wrapper)).toEqual(["sre"]);
      expect(wrapper.vm.current()?.agent).toBe("sre");
    }
  });

  it("renders no group for one agent, without a roster, or in the + menu", async () => {
    withAgents([ROSTER[0]]);
    const one = await open();
    expect(one.wrapper.find('[data-test="assistant-mention-group-agents"]').exists()).toBe(false);
    fake.current = fakeAssistant("available");
    const none = await open();
    expect(none.wrapper.find('[data-test="assistant-mention-group-agents"]').exists()).toBe(false);
    withAgents();
    const plus = mount(AssistantMentionMenu, {
      props: { open: true, query: "", org: ORG, listboxId: "lb", inline: true },
    });
    await flushPromises();
    expect(plus.find('[data-test="assistant-mention-group-agents"]').exists()).toBe(false);
  });

  it("hands a pick to the composer, sets the agent and speaks once, with no chip", async () => {
    const { store, sid } = withAgents();
    const { wrapper } = await open("inv");
    wrapper.vm.choose(wrapper.vm.current()!);
    const [picked] = wrapper.emitted("select")![0] as [MentionOption];
    expect(picked.chip).toBeUndefined();
    expect(store.state.sessions[sid].agentId).toBe("sre");
    expect(composerUi(sid).status?.text).toBe("Investigator will answer.");
  });

  it("keeps a disabled agent reachable: Enter reads the reason and chooses nothing", async () => {
    const { store, sid } = withAgents();
    const { wrapper } = await open("query");
    const row = wrapper.vm.current()!;
    expect(row.agent).toBe("generate-query");
    expect(row.disabled).toBe(true);
    wrapper.vm.choose(row);
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(store.state.sessions[sid].agentId).toBeUndefined();
    expect(composerUi(sid).status?.text).toBe("Not available · Ask an admin");
  });
});

describe("AssistantMentionMenu", () => {
  it("never offers internal streams and finds a name by any of its parts (BUG-015)", async () => {
    queryClient.clear();
    seed();
    queryClient.setQueryData(streamKeys.nameList(ORG, "logs"), [
      { name: "_o2_alert_calibration_digests" },
      { name: "audit" },
      { name: "cart_api_errors" },
    ]);
    const wrapper = mount(AssistantMentionMenu, {
      props: { open: true, query: "", org: ORG, listboxId: "lb" },
      attachTo: document.body,
    });
    await flushPromises();
    const streamLabels = () =>
      wrapper
        .findAll('[data-test="assistant-mention-option"][data-kind="stream"]')
        .map((option) => option.text());
    expect(streamLabels().join(" ")).not.toMatch(/_o2_|audit/);
    await wrapper.setProps({ query: "errors" });
    expect(streamLabels()).toEqual([expect.stringContaining("cart_api_errors")]);
    await wrapper.setProps({ query: "cart err" });
    expect(streamLabels()).toEqual([expect.stringContaining("cart_api_errors")]);
    await wrapper.setProps({ query: "digests" });
    expect(streamLabels()).toEqual([]);
  });

  it("adds an Image row for the + menu and hands it over like an option", async () => {
    seed();
    const wrapper = mount(AssistantMentionMenu, {
      props: { open: true, query: "", org: ORG, listboxId: "lb", inline: true, withImage: true },
      attachTo: document.body,
    });
    await flushPromises();
    const image = wrapper.get('[data-test="assistant-mention-image"]');
    expect(wrapper.get('[data-test="assistant-mention-panel"]').classes()).not.toContain("border");
    await image.trigger("click");
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ action: "image" });
  });

  it("lists the groups as a listbox with the first option active, and no time group (CT-05 AC 1, 9)", async () => {
    const { wrapper, options } = await open();
    const listbox = document.body.querySelector('[data-test="assistant-mention-menu"]')!;
    expect(listbox.getAttribute("role")).toBe("listbox");
    expect(listbox.id).toBe("lb");
    const groups = [...document.body.querySelectorAll('[role="group"]')].map((g) =>
      g.getAttribute("aria-label"),
    );
    expect(groups).toEqual(["Streams", "Dashboards", "Alerts"]);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect((wrapper.vm as unknown as { activeId: string }).activeId).toBe(options()[0].id);
    expect(options()[0].getAttribute("aria-label")).toContain("Streams, ");
  });

  it("filters across groups, a query showing more per group, with Show all (CT-05 AC 2)", async () => {
    const first = await open("che");
    const { options } = first;
    expect(options().map((o) => o.textContent?.trim().split("\n")[0].trim())).toEqual([
      expect.stringContaining("checkout"),
      expect.stringContaining("Checkout"),
      expect.stringContaining("checkout-latency"),
    ]);
    first.wrapper.unmount();
    const all = await open("stream");
    expect(all.options().filter((o) => o.dataset.kind === "stream")).toHaveLength(
      MENTION_SEARCH_LIMIT,
    );
    expect(
      document.body.querySelector('[data-test="assistant-mention-more"]')?.textContent,
    ).toContain("Show all");
    all.wrapper.unmount();
    const plain = await open();
    expect(plain.options().filter((o) => o.dataset.kind === "stream")).toHaveLength(
      MENTION_GROUP_LIMIT,
    );
  });

  it("emits the chosen chip with the ids the wire reads (CT-05 AC 3, 12)", async () => {
    const { wrapper, options } = await open("che");
    options()[2].click();
    const [[option]] = wrapper.emitted("select") as [[{ chip: { ref: unknown; kind: string } }]];
    expect(option.chip).toMatchObject({
      kind: "alert",
      short: "checkout-latency",
      ref: { type: "alert", id: "a1", org: ORG },
      provenance: "mention",
    });
  });

  it("gives each mentioned object its name, never its id, as the phone text (F12)", async () => {
    const { wrapper, options } = await open();
    for (const node of options()) node.click();
    const picked = (wrapper.emitted("select") as [{ chip?: ContextChip }][])
      .map(([option]) => option.chip)
      .filter((chip): chip is ContextChip => !!chip);
    expect(picked.length).toBeGreaterThan(3);
    for (const chip of picked) {
      expect(["a1", "d1", "p1"]).not.toContain(chip.short);
      if (chip.short) expect(chip.label).toContain(chip.short);
    }
    expect(picked.find((chip) => chip.kind === "panel")?.short).toBe("Checkout");
    expect(picked.find((chip) => chip.kind === "alert")?.short).toBe("checkout-latency");
  });

  it("moves the highlight from the textbox and hands Enter the current option", async () => {
    const { wrapper } = await open();
    const vm = wrapper.vm as unknown as { move(d: number): void; current(): { id: string } | null };
    vm.move(1);
    expect(vm.current()?.id).toMatch(/^mention:stream:/);
    vm.move(-2);
    expect(vm.current()).not.toBeNull();
  });

  it("says nothing matches and has nothing for Enter (CT-05 AC 5)", async () => {
    const { wrapper } = await open("zzz");
    expect(
      document.body.querySelector('[data-test="assistant-mention-empty"]')?.textContent,
    ).toContain('Nothing matches "zzz"');
    expect((wrapper.vm as unknown as { current(): unknown }).current()).toBeNull();
  });

  it("shows No access for a 403 group and keeps the rest (CT-05 AC 8)", async () => {
    await open("", true);
    expect(
      document.body.querySelector('[data-test="assistant-mention-no-access"]')?.textContent,
    ).toContain("No access to dashboards");
    expect(
      document.body.querySelector('[data-test="assistant-mention-group-alerts"]'),
    ).not.toBeNull();
  });

  it("renders in place above the textbox, with 2.75 rem rows below md and on touch (CT-05 AC 10)", async () => {
    const { wrapper, options } = await open();
    expect(wrapper.get('[data-test="assistant-mention-panel"]').attributes("data-dd-privacy")).toBe(
      "mask",
    );
    expect(options()[0].className).toContain("max-md:min-h-11");
    expect(options()[0].className).toContain("pointer-coarse:min-h-11");
  });

  it("puts Show all and Retry in the arrow cycle, acted on by Enter (CT-05 AC 2, 11)", async () => {
    const { wrapper } = await open("stream");
    const vm = wrapper.vm as unknown as {
      move(d: number): void;
      current(): { action?: string } | null;
      choose(o: unknown): void;
    };
    vm.move(-1);
    expect(vm.current()?.action).toBe("more");
    vm.choose(vm.current());
    await flushPromises();
    expect(
      document.body.querySelectorAll('[data-test="assistant-mention-option"][data-kind="stream"]'),
    ).toHaveLength(9);
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
