// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallScheduleContext from "@/components/oncall/OnCallScheduleContext.vue";
import i18n from "@/locales";
import type { OnCallSlot, ResolvedSegment, TeamReachability } from "@/ts/interfaces/oncall";

const NOW = 1_800_000_000_000_000;
const HOUR = 3_600_000_000;

const stubs = {
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallScheduleContext, {
    props: { now: NOW, timezone: "UTC", ...props },
    global: { plugins: [i18n], stubs },
  });
}

const slots: OnCallSlot[] = [
  { slot: "primary", rotation: "Primary", user_email: "ana@o2.ai", next_user_email: "bo@o2.ai" },
  { slot: "secondary", rotation: "Secondary", user_email: "cy@o2.ai", next_user_email: null },
];

const segments: ResolvedSegment[] = [
  { slot: "primary", from: NOW - HOUR, to: NOW + 2 * HOUR, user_email: "ana@o2.ai", rotation: "Primary" },
  { slot: "primary", from: NOW + 2 * HOUR, to: NOW + 8 * HOUR, user_email: "bo@o2.ai", rotation: "Primary" },
];

describe("OnCallScheduleContext", () => {
  it("counts down to the handover and names who catches it", () => {
    const text = render({ slots, segments }).text();
    expect(text).toContain("2h");
    expect(text).toContain("bo@o2.ai");
  });

  // A countdown with no successor is half an answer: "who do I brief" is the
  // reason anybody reads this cell.
  it("says so when the shift hands over to nobody", () => {
    const text = render({ slots, segments: [segments[0]] }).text();
    expect(text).toContain("nobody");
  });

  // The secondary SLOT, never the next person in the primary cycle — with a
  // second pool staffed those are different people.
  it("shows the secondary slot holder, not the next primary", () => {
    const text = render({ slots, segments }).text();
    expect(text).toContain("cy@o2.ai");
    expect(text).not.toContain("Cannot be paged");
  });

  // A team on the default has ONE member list and the secondary is derived
  // from it — so the cell is filled, and it must say where that person came
  // from or the first question anybody asks is why them.
  it("names the derived secondary and its offset when no slot is staffed", () => {
    const derived = { ...slots[0], next_offset: 5 };
    const text = render({ slots: [derived], segments }).text();
    expect(text).toContain("bo@o2.ai");
    expect(text).toContain("+5");
  });

  it("falls back to +1 when the server has not sent an offset", () => {
    expect(render({ slots: [slots[0]], segments }).text()).toContain("+1");
  });

  // Only a one-person rotation genuinely has nobody behind it.
  it("says nobody backs a one-person rotation", () => {
    const alone = { ...slots[0], next_user_email: null };
    const wrapper = render({ slots: [alone], segments });
    expect(wrapper.find('[data-test="oncall-schedule-context-no-secondary"]').exists()).toBe(true);
  });

  // A staffed slot is an explicit pool, not a computed person: it must not
  // carry the "derived" annotation.
  it("labels a staffed slot by its rotation, never as derived", () => {
    const text = render({ slots, segments }).text();
    expect(text).toContain("cy@o2.ai");
    expect(text).not.toContain("Derived from the rotation");
  });

  it("totals the gaps ahead and names the first window", () => {
    const withGap: ResolvedSegment[] = [
      segments[0],
      { slot: "primary", from: NOW + 2 * HOUR, to: NOW + 5 * HOUR, rotation: "Primary" },
    ];
    const text = render({ slots, segments: withGap }).text();
    expect(text).toContain("1 gap");
    expect(text).toContain("3h");
  });

  it("says plainly when nothing in the window is uncovered", () => {
    const text = render({ slots, segments }).text();
    expect(text).toContain("No gaps");
  });

  // An unreachable pager is the same class of fact as an empty rotation, so it
  // rides beside the name rather than in a panel further down.
  it("marks the holder unreachable when no channel would deliver", () => {
    const reachability = {
      team_id: "t1",
      team_name: "Search",
      smtp_configured: false,
      members: [{ user_email: "ana@o2.ai", channels: [{ channel: "email", deliverable: false }] }],
      reachable: 0,
      total: 1,
      unreachable_members: ["ana@o2.ai"],
    } as unknown as TeamReachability;
    expect(render({ slots, segments, reachability }).text()).toContain("Cannot be paged");
  });

  // A member the report never mentions is a missing answer, not an outage —
  // rendering it as "cannot be paged" would invent one.
  it("does not invent an outage for a member the report omits", () => {
    const reachability = {
      team_id: "t1",
      team_name: "Search",
      smtp_configured: true,
      members: [],
      reachable: 0,
      total: 0,
      unreachable_members: [],
    } as unknown as TeamReachability;
    expect(render({ slots, segments, reachability }).text()).toContain("Reachable");
  });
});
