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
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";

import AssistantMentionMenu, {
  MENTION_GROUP_LIMIT,
  MENTION_SEARCH_LIMIT,
  type MentionOption,
} from "./AssistantMentionMenu.vue";

const { breakpoint, fake, dashboardsApi } = vi.hoisted(() => ({
  breakpoint: { md: true },
  fake: { current: null as any },
  dashboardsApi: { forbidden: false },
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

// As the API answers: no folder and no title lists the default folder; a title alone, even empty, searches every folder.
const DASHBOARDS = [
  { dashboard_id: "d1", title: "Checkout", folder_id: "default", folder_name: "default" },
  { dashboard_id: "d2", title: "Payments SLOs", folder_id: "f2", folder_name: "Payments" },
];
vi.mock("@/services/dashboards", () => ({
  default: {
    list: vi.fn(async (...args: unknown[]) => {
      if (dashboardsApi.forbidden) throw { response: { status: 403 } };
      const [folder, title] = [args[6] as string, (args[7] as string).toLowerCase()];
      const rows = DASHBOARDS.filter((row) =>
        title ? row.title.toLowerCase().includes(title) : row.folder_id === (folder || "default"),
      );
      return { data: { dashboards: rows } };
    }),
    listAcrossFolders: vi.fn(async () => {
      if (dashboardsApi.forbidden) throw { response: { status: 403 } };
      return { data: { dashboards: DASHBOARDS } };
    }),
  },
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
  queryClient.setQueryData(alertKeys.list(ORG, "", undefined, undefined), [
    { alert_id: "a1", name: "checkout-latency" },
  ]);
  queryClient.setQueryData(pipelineKeys.list(ORG), [{ pipeline_id: "p1", name: "ingest-k8s" }]);
  dashboardsApi.forbidden = dashboardsError;
}

async function open(query = "", dashboardsError = false, sid: string | null = null) {
  seed(dashboardsError);
  const wrapper = mount(AssistantMentionMenu, {
    props: { open: true, query, org: ORG, listboxId: "lb", sid: sid ?? fakeActiveSid() },
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

const fakeActiveSid = (): string | null => fake.current?.store.state.shell.activeSid ?? null;

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

  it("says a policy every agent shares once in the header, and lists agents by name only (K10)", async () => {
    withAgents([
      { id: "o2-ai", pickable: true, available: true, readOnly: true },
      { id: "sre", pickable: true, available: true, readOnly: true },
      { id: "generate-query", pickable: true, available: true, readOnly: true },
    ]);
    const { wrapper } = await open();
    const group = wrapper.get('[data-test="assistant-mention-group-agents"]');
    const note = group.get('[data-test="assistant-mention-group-note"]');
    expect(note.text()).toBe("Read-only");
    expect(group.attributes("aria-describedby")).toBe(note.attributes("id"));
    expect(group.find('[data-test="assistant-mention-group-count"]').exists()).toBe(false);
    const clauses = group
      .findAll('[data-test="assistant-mention-agent-clause"]')
      .map((c) => c.text());
    expect(clauses).toEqual([]);
  });

  it("never words a policy or a purpose for agents that are not read-only", async () => {
    withAgents([
      { id: "o2-ai", pickable: true, available: true },
      { id: "sre", pickable: true, available: true },
    ]);
    const { wrapper } = await open();
    const group = wrapper.get('[data-test="assistant-mention-group-agents"]');
    expect(group.find('[data-test="assistant-mention-group-note"]').exists()).toBe(false);
    expect(
      group.findAll('[data-test="assistant-mention-agent-clause"]').map((c) => c.text()),
    ).toEqual([]);
  });

  it("renders no group for one agent or without a roster", async () => {
    withAgents([ROSTER[0]]);
    const one = await open();
    expect(one.wrapper.find('[data-test="assistant-mention-group-agents"]').exists()).toBe(false);
    fake.current = fakeAssistant("available");
    const none = await open();
    expect(none.wrapper.find('[data-test="assistant-mention-group-agents"]').exists()).toBe(false);
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

  it("sets the agent of the chat it was typed in, not the active sidebar chat", async () => {
    const { store, sid: sidebar } = withAgents();
    const floating = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "window" },
      detached: true,
    });
    expect(store.state.shell.activeSid).toBe(sidebar);
    const { wrapper } = await open("inv", false, floating);
    wrapper.vm.choose(wrapper.vm.current()!);
    expect(store.state.sessions[floating].agentId).toBe("sre");
    expect(store.state.sessions[sidebar].agentId).toBeUndefined();
    expect(composerUi(floating).status?.text).toBe("Investigator will answer.");
    const disabled = await open("query", false, floating);
    disabled.wrapper.vm.choose(disabled.wrapper.vm.current()!);
    expect(composerUi(floating).status?.text).toBe("Not available · Ask an admin");
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
  it("never offers streams the server marks internal and finds a name by any of its parts (BUG-015)", async () => {
    queryClient.clear();
    seed();
    queryClient.setQueryData(streamKeys.nameList(ORG, "logs"), [
      { name: "_o2_alert_calibration_digests", is_internal: true },
      { name: "audit", is_internal: true },
      { name: "_rumdata", is_internal: true },
      { name: "cart_api_errors" },
    ]);
    const wrapper = mount(AssistantMentionMenu, {
      props: { open: true, query: "", org: ORG, listboxId: "lb", sid: null },
      attachTo: document.body,
    });
    await flushPromises();
    const streamLabels = () =>
      wrapper
        .findAll('[data-test="assistant-mention-option"][data-kind="stream"]')
        .map((option) => option.text());
    expect(streamLabels().join(" ")).not.toMatch(/_o2_|audit/);
    expect(streamLabels().join(" ")).toContain("_rumdata");
    await wrapper.setProps({ query: "errors" });
    expect(streamLabels()).toEqual([expect.stringContaining("cart_api_errors")]);
    await wrapper.setProps({ query: "cart err" });
    expect(streamLabels()).toEqual([expect.stringContaining("cart_api_errors")]);
    await wrapper.setProps({ query: "digests" });
    expect(streamLabels()).toEqual([]);
  });

  it("scrolls the active row into view as the arrows move it", async () => {
    const { wrapper, options } = await open();
    const scrolled: string[] = [];
    HTMLElement.prototype.scrollIntoView ??= () => {};
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (
      this: HTMLElement,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      expect(arg).toEqual({ block: "nearest" });
      scrolled.push(this.id);
    });
    wrapper.vm.move(1);
    await flushPromises();
    expect(scrolled.at(-1)).toBe(options()[1].id);
    wrapper.vm.move(-2);
    await flushPromises();
    expect(scrolled.at(-1)).toBe(wrapper.vm.activeId);
    HTMLElement.prototype.scrollTo ??= () => {};
    const top = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    wrapper.vm.move(1);
    await flushPromises();
    expect(top).toHaveBeenCalledWith({ top: 0 });
    expect(top.mock.contexts[0]).toBe(wrapper.get('[data-test="assistant-mention-panel"]').element);
    top.mockRestore();
    spy.mockRestore();
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

  it("marks every option with its kind's glyph and its type, and keeps Show all as plain link text", async () => {
    const { options } = await open();
    for (const row of options())
      expect(row.querySelector('[data-test="assistant-mention-glyph"]')).not.toBeNull();
    const stream = options().find((o) => o.dataset.kind === "stream")!;
    expect(stream.textContent).toContain("logs");
    const more = document.body.querySelector<HTMLElement>('[data-test="assistant-mention-more"]')!;
    expect(more.querySelector('[data-test="assistant-mention-glyph"]')).toBeNull();
    expect(more.className).toContain("text-text-link");
    const groups = [...document.body.querySelectorAll<HTMLElement>('[role="group"]')];
    expect(groups[0].className).not.toContain("border-t");
    expect(groups.slice(1).every((g) => g.className.includes("border-t"))).toBe(true);
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

  it("M1: a typed mention finds dashboards and alerts outside the default folder", async () => {
    queryClient.clear();
    const { options } = await open("slo");
    const labels = options().map((o) => o.textContent ?? "");
    expect(labels.some((label) => label.includes("Payments SLOs"))).toBe(true);
    const { default: api } = await import("@/services/dashboards");
    expect(vi.mocked(api.list).mock.calls.at(-1)?.[6]).toBe("");
  });

  it("M1-R: a bare @ lists dashboards from every folder, not only the default one", async () => {
    queryClient.clear();
    const { options } = await open("");
    const labels = options().map((o) => o.textContent ?? "");
    expect(labels.some((label) => label.includes("Checkout"))).toBe(true);
    expect(labels.some((label) => label.includes("Payments SLOs"))).toBe(true);
  });

  it("M2: gives streams whose names differ only by punctuation distinct option ids", async () => {
    seed();
    queryClient.setQueryData(streamKeys.nameList(ORG, "logs"), [
      { name: "app.log" },
      { name: "app_log" },
    ]);
    const wrapper = mount(AssistantMentionMenu, {
      props: { open: true, query: "app", org: ORG, listboxId: "lb", sid: null },
      attachTo: document.body,
    });
    await flushPromises();
    const ids = wrapper
      .findAll('[data-test="assistant-mention-option"][data-kind="stream"]')
      .map((row) => row.attributes("id"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
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
