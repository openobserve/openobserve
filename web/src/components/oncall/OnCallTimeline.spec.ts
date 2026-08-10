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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallTimeline from "@/components/oncall/OnCallTimeline.vue";
import i18n from "@/locales";
import type { OnCallResponseEvent } from "@/ts/interfaces/oncall";

const OPENED_AT = 1_700_000_000_000_000;

function event(
  kind: OnCallResponseEvent["kind"],
  offsetMicros = 0,
  body = "something happened",
): OnCallResponseEvent {
  return { kind, at: OPENED_AT + offsetMicros, actor: "o2-engine", body };
}

// OToggleGroup drives its state through provide/inject, which the real
// component supplies. The stub emits `update:modelValue` with the clicked
// item's value so the filter assertions exercise OUR handler rather than the
// toggle's internals — a stub that swallowed the event would make the
// switch-to-all test assert nothing.
const stubs = {
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OToggleGroup: {
    name: "OToggleGroup",
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: `<button @click="$parent.$emit('update:modelValue', value)"><slot /></button>`,
  },
};

function render(events: OnCallResponseEvent[]) {
  return mount(OnCallTimeline, {
    props: { events, openedAt: OPENED_AT },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallTimeline", () => {
  // The default view is what a responder reads during a postmortem: what
  // people did, not the engine's ladder ticks.
  it("hides engine bookkeeping by default", () => {
    const wrapper = render([
      event("sys", 0, "opened"),
      event("page", 1_000_000, "paged ana"),
      event("ack", 2_000_000, "ana acknowledged"),
      event("state", 3_000_000, "resolved"),
    ]);
    const rendered = wrapper.findAll('[data-test="oncall-timeline-event"]');
    expect(rendered).toHaveLength(2);
    const text = wrapper.text();
    expect(text).toContain("paged ana");
    expect(text).toContain("ana acknowledged");
    expect(text).not.toContain("opened");
  });

  it("shows every event once the filter is switched to all", async () => {
    const wrapper = render([
      event("sys", 0, "opened"),
      event("page", 1_000_000, "paged ana"),
      event("state", 2_000_000, "resolved"),
    ]);
    expect(wrapper.findAll('[data-test="oncall-timeline-event"]')).toHaveLength(1);

    await wrapper.find('[data-test="oncall-timeline-filter-all"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-test="oncall-timeline-event"]')).toHaveLength(3);
    expect(wrapper.text()).toContain("opened");
    expect(wrapper.text()).toContain("resolved");
  });

  // A trace is read as offsets from the firing, not as wall-clock stamps.
  it("renders each event as an offset from the record opening", () => {
    const wrapper = render([
      event("page", 0, "paged immediately"),
      event("ack", 4 * 60 * 1_000_000 + 12_000_000, "acked"),
    ]);
    const text = wrapper.text();
    expect(text).toContain("+0s");
    expect(text).toContain("+4m 12s");
  });

  it("tells the responder why the list is empty", () => {
    const onlySystem = render([event("sys", 0, "opened")]);
    expect(onlySystem.findAll('[data-test="oncall-timeline-event"]')).toHaveLength(0);
    expect(onlySystem.text()).toContain("No pages or notes yet");

    const nothing = render([]);
    expect(nothing.text()).toContain("No pages or notes yet");
  });

  // Losing "who it went to" is acceptable; losing the fact that a page
  // happened is not. An event with no level still renders.
  it("renders an event that carries no level", () => {
    const wrapper = render([{ ...event("page", 0, "paged"), level: null }]);
    expect(wrapper.findAll('[data-test="oncall-timeline-event"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("paged");
  });

  /// A rung has no name to print any more, so it is stated as when it fired.
  /// The body already says who was paged.
  it("shows which rung a page belongs to", () => {
    const wrapper = render([
      { ...event("page", 0, "paged ana@o2.ai"), rung_micros: 5 * 60 * 1_000_000 },
    ]);
    expect(wrapper.text()).toContain("rung at +5m");
    expect(wrapper.text()).toContain("paged ana@o2.ai");
  });

  it("shows no rung on an event that is not a page", () => {
    const wrapper = render([event("note", 0, "restarted the pool")]);
    expect(wrapper.text()).not.toContain("rung at");
  });
});
