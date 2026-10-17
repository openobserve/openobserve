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

import type { ContextChip } from "@/composables/assistant";
import { queryClient } from "@/composables/query/queryClient";
import { alertKeys } from "@/services/alerts.querykeys";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";

import AssistantMentionMenu, { MENTION_GROUP_LIMIT } from "./AssistantMentionMenu.vue";

const { breakpoint } = vi.hoisted(() => ({ breakpoint: { md: true } }));

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
});

describe("AssistantMentionMenu", () => {
  it("lists the five groups as a listbox with the first option active (CT-05 AC 1, 9)", async () => {
    const { wrapper, options } = await open();
    const listbox = document.body.querySelector('[data-test="assistant-mention-menu"]')!;
    expect(listbox.getAttribute("role")).toBe("listbox");
    expect(listbox.id).toBe("lb");
    const groups = [...document.body.querySelectorAll('[role="group"]')].map((g) =>
      g.getAttribute("aria-label"),
    );
    expect(groups).toEqual(["Time range", "Streams", "Dashboards", "Alerts", "Pipelines"]);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect((wrapper.vm as unknown as { activeId: string }).activeId).toBe(options()[0].id);
    expect(options()[0].getAttribute("aria-label")).toBe("Time range, last 15 min");
  });

  it("filters across groups, at most 8 per group with Show more (CT-05 AC 2)", async () => {
    const first = await open("che");
    const { options } = first;
    expect(options().map((o) => o.textContent?.trim().split("\n")[0].trim())).toEqual([
      expect.stringContaining("Stream · checkout"),
      expect.stringContaining("Dashboard · Checkout"),
      expect.stringContaining("Alert · checkout-latency"),
    ]);
    first.wrapper.unmount();
    const all = await open("stream");
    expect(all.options().filter((o) => o.dataset.kind === "stream")).toHaveLength(
      MENTION_GROUP_LIMIT,
    );
    expect(document.body.querySelector('[data-test="assistant-mention-more"]')).not.toBeNull();
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
    expect(picked.find((chip) => chip.kind === "pipeline_node")?.short).toBe("ingest-k8s");
  });

  it("moves the highlight from the textbox and hands Enter the current option", async () => {
    const { wrapper } = await open();
    const vm = wrapper.vm as unknown as { move(d: number): void; current(): { id: string } | null };
    vm.move(1);
    expect(vm.current()?.id).toBe("time:1h");
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

  it("puts Show more and Retry in the arrow cycle, acted on by Enter (CT-05 AC 2, 11)", async () => {
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
    ).toHaveLength(10);
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
