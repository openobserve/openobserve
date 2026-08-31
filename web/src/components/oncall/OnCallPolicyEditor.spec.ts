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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import i18n from "@/locales";
import destinationService from "@/services/alert_destination";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { OnCallPolicy } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: {
    setPolicy: vi.fn(),
    listMembers: vi.fn(),
    whoIsOnCall: vi.fn(),
    getRoutingConfig: vi.fn(),
    getTeamChannel: vi.fn(),
    setTeamChannel: vi.fn(),
  },
}));
vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));

const service = vi.mocked(oncallService);
const destinations = vi.mocked(destinationService);

const stubs = {
  ODrawer: {
    name: "ODrawer",
    props: ["open"],
    template: `<div v-if="open"><slot /><slot name="footer" /></div>`,
  },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: "<select />",
  },
  OCheckbox: {
    name: "OCheckbox",
    props: ["modelValue", "label"],
    template: `<label><input type="checkbox" :checked="modelValue" />{{ label }}</label>`,
  },
  /// Delivery and AI triage are tabs now. These stubs render every tab's
  /// label and every panel's body regardless of which is "active" — that
  /// switching behaviour is OTabs/OTabPanels' own and is tested there; here
  /// it would only hide the controls these tests are about.
  OTabs: { name: "OTabs", template: `<div><slot /></div>` },
  OTab: { name: "OTab", template: `<div><slot /></div>` },
  OTabPanels: { name: "OTabPanels", template: `<div><slot /></div>` },
  OTabPanel: { name: "OTabPanel", template: `<div><slot /></div>` },
};

/// **The shape the server actually sends** — D-33 in the defect register. This
/// fixture carried a `level: "primary"` field the type dropped long ago and no
/// `targets` array, which `LadderStep` requires on both sides of the wire. So
/// every test here drove a policy the server would answer 400 to, and the
/// editor's own `step.targets` reads had nothing to read.
/// The team's rotations. A level stores an id, so a chip can only be read back
/// as a name when the editor is told which rotations exist.
const ROTATIONS = [{ id: "rot_primary", name: "Primary", shift_rules: [] }];

const policy: OnCallPolicy = {
  id: "pol_1",
  org_id: "default",
  team_id: "team_1",
  rungs: [
    {
      priority: 1,
      steps: [{ after_micros: 0, targets: [{ kind: "rotation", rotation_id: "rot_primary" }] }],
      channels: ["email"],
    },
    { priority: 4, steps: [], channels: [] },
  ],
};

function render() {
  return mount(OnCallPolicyEditor, {
    props: { teamId: "team_1", policy, open: true, rotations: ROTATIONS },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallPolicyEditor", () => {
  beforeEach(() => {
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: ["slack-eng"], source: "policy" },
    } as any);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    // The catch-all is cached module-wide so one screen reads it once;
    // without this it survives into the next test.
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  // A checkbox for a channel nothing can send lets somebody tick SMS and
  // receive nothing, with no error — the worst failure a pager can have.
  it("offers only channels that can actually be delivered", async () => {
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-channel-1-email"]').exists()).toBe(true);
    for (const unimplemented of ["sms", "voice", "chat", "push", "in_app"]) {
      expect(
        wrapper.find(`[data-test="oncall-policy-channel-1-${unimplemented}"]`).exists(),
        `${unimplemented} has no Notifier and must not be offered`,
      ).toBe(false);
    }
  });

  // The short list should read as deliberate, not as something missing.
  it("says why the other channels are absent", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("when they can actually deliver");
  });

  it("shows a non-paging priority as paging nobody", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("Pages nobody");
  });

  /// A long ladder scrolls past the only thing saying which priority is being
  /// edited, so the chips live in their own bar rather than in the scroll flow.
  it("keeps the priority chips out of the scrolling body", async () => {
    const wrapper = render();
    await flushPromises();

    const bar = wrapper.find('[data-test="oncall-policy-priority-bar"]');
    expect(bar.exists()).toBe(true);
    expect(bar.classes()).toContain("sticky");
    expect(bar.find('[data-test="oncall-policy-priority-1"]').exists()).toBe(true);
  });

  /// Reading P3 and pressing Edit has to land on P3. Opening on P1 asks the
  /// reader to re-find the ladder they were already looking at.
  describe("the priority the drawer opens on", () => {
    it("opens on the priority the reader had selected", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy, open: true, priority: 4 },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-add-step-4"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-policy-add-step-1"]').exists()).toBe(false);
    });

    /// The read view lists every priority; the policy only carries the ones
    /// with rungs. Asking for an absent one must not open an empty editor.
    it("falls back to a priority the policy actually has", async () => {
      // No P1 either, so landing on a real chip cannot be the default's doing.
      const wrapper = mount(OnCallPolicyEditor, {
        props: {
          teamId: "team_1",
          policy: { ...policy, rungs: [{ priority: 4, steps: [], channels: [] }] },
          open: true,
          priority: 3,
        },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-add-step-4"]').exists()).toBe(true);
    });

    /// The drawer stays mounted between visits, so the selection has to
    /// follow each open rather than only the first.
    it("re-selects on every open, not just the first", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy, open: true, priority: 1 },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true, priority: 4 });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-add-step-4"]').exists()).toBe(true);
    });
  });

  /// Ticking `webhook` says HOW to page; the destination says WHERE. Offering
  /// the channel without the target lets someone turn on a page that silently
  /// reaches nobody.
  describe("webhook destinations", () => {
    beforeEach(() => {
      destinations.list.mockResolvedValue({
        data: [{ name: "slack-oncall" }, { name: "pagerduty" }],
      } as any);
    });

    const webhookPolicy: OnCallPolicy = {
      ...policy,
      rungs: [
        {
          priority: 1,
          // Same D-33 shape as the fixture above: `level` was dropped from the
          // type long ago and `targets` is required on the wire.
          steps: [{ after_micros: 0, targets: [{ kind: "on_call_now" as const }] }],
          channels: ["webhook" as const],
        },
      ],
      destinations: ["slack-oncall"],
    };

    it("hides the picker when nothing pages by webhook", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy, open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-destinations"]').exists()).toBe(false);
    });

    it("warns when the webhook channel has nowhere to go", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: { ...webhookPolicy, destinations: [] }, open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-destinations-warning"]').text()).toContain(
        "reach nobody",
      );
    });

    it("does not warn once a destination is chosen", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: webhookPolicy, open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-destinations-warning"]').exists()).toBe(false);
    });

    it("saves the destinations alongside the rungs", async () => {
      service.setPolicy.mockResolvedValue({ data: {} } as any);
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: webhookPolicy, open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
      await flushPromises();

      expect(service.setPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ destinations: ["slack-oncall"] }),
        }),
      );
    });

    /// The editor is still worth using when the destination list is unreachable.
    it("still renders when destinations cannot be loaded", async () => {
      destinations.list.mockRejectedValue(new Error("boom"));
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: webhookPolicy, open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-policy-save"]').exists()).toBe(true);
    });
  });

  /// A ladder built out of target kinds does not answer "who does this wake".
  it("names the people a rung would actually reach", async () => {
    service.whoIsOnCall.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_primary",
          rotation_name: "Primary",
          rule: "Weekdays",
          user_email: "ana@o2.ai",
          next_user_email: "bob@o2.ai",
        },
      ],
    } as any);
    const wrapper = mount(OnCallPolicyEditor, {
      props: {
        teamId: "team_1",
        rotations: ROTATIONS,
        policy: {
          ...policy,
          rungs: [
            {
              priority: 1,
              channels: ["email"],
              steps: [
                { after_micros: 0, targets: [{ kind: "rotation", rotation_id: "rot_primary" }] },
              ],
            },
          ],
        },
        open: true,
      },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-preview-1"]').text()).toContain("ana@o2.ai");
  });

  /// The failure worth seeing before a save: configured, and wakes nobody.
  it("warns when a rung resolves to nobody", async () => {
    service.whoIsOnCall.mockResolvedValue({
      data: [{ rotation: "Solo", user_email: "ana@o2.ai", next_user_email: null }],
    } as any);
    const wrapper = mount(OnCallPolicyEditor, {
      props: {
        teamId: "team_1",
        policy: {
          ...policy,
          rungs: [
            {
              priority: 1,
              channels: ["email"],
              steps: [{ after_micros: 0, targets: [{ kind: "next_on_call" }] }],
            },
          ],
        },
        open: true,
      },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-preview-nobody-1-0"]').exists()).toBe(true);
  });

  // The connector edits the WAIT between neighbours; the model stores
  // absolute offsets. Changing one wait shifts that rung and everything below
  // it, preserving the later gaps — pulling a wait in must not stretch the
  // rest of the ladder.
  it("shifts the rungs below when a wait between rungs changes", async () => {
    const threeRungs: OnCallPolicy = {
      ...policy,
      rungs: [
        {
          priority: 1,
          steps: [
            { after_micros: 0, targets: [{ kind: "on_call_now" }] },
            { after_micros: 5 * 60_000_000, targets: [{ kind: "next_on_call" }] },
            { after_micros: 15 * 60_000_000, targets: [{ kind: "whole_team" }] },
          ],
          channels: ["email"],
        },
      ],
    };
    const wrapper = mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy: threeRungs, open: true },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    // The 5m wait before rung 2 becomes 1m: rung 2 lands at +1m and rung 3
    // keeps its 10m spacing, landing at +11m.
    wrapper
      .findComponent('[data-test="oncall-policy-step-delay-1-1"]')
      .vm.$emit("update:modelValue", 1 * 60_000_000);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("+1m");
    expect(text).toContain("+11m");
    expect(text).not.toContain("+15m");
  });

  // Removing a rung pulls the ones below up by its wait — the ladder gets
  // shorter, not sparser.
  it("closes the gap a removed rung leaves behind", async () => {
    const threeRungs: OnCallPolicy = {
      ...policy,
      rungs: [
        {
          priority: 1,
          steps: [
            { after_micros: 0, targets: [{ kind: "on_call_now" }] },
            { after_micros: 5 * 60_000_000, targets: [{ kind: "next_on_call" }] },
            { after_micros: 15 * 60_000_000, targets: [{ kind: "whole_team" }] },
          ],
          channels: ["email"],
        },
      ],
    };
    const wrapper = mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy: threeRungs, open: true },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    await wrapper.find('[data-test="oncall-policy-remove-rung-1-1"]').trigger("click");

    const text = wrapper.text();
    expect(text).toContain("+10m");
    expect(text).not.toContain("+15m");
  });
  /// §G.9 #9: notify_default_team with no team nominated is indistinguishable
  /// from stop. The warning belongs where the policy is WRITTEN — a routing
  /// screen the author may never open cannot warn them.
  describe("the ladder's end", () => {
    function policyEnding(final_action: string) {
      return {
        ...policy,
        repeat_count: 2,
        final_action,
        rungs: [
          {
            priority: 1,
            steps: [{ after_micros: 0, targets: [{ kind: "on_call_now" }] }],
            channels: ["email"],
          },
        ],
      } as any;
    }

    it("warns when the final action hands to a default team nobody nominated", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: policyEnding("notify_default_team"), open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-policy-no-default-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-policy-ladder-end"]').text()).toContain("2 times");
    });

    it("names the default team once one exists, and does not warn", async () => {
      service.getRoutingConfig.mockResolvedValue({
        data: {
          org_id: "default",
          default_team_id: "t9",
          default_team_name: "Platform",
          updated_at: 1,
        },
      } as any);
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: policyEnding("notify_default_team"), open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-policy-no-default-warning"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-policy-ladder-end"]').text()).toContain("Platform");
    });

    it("says a stopping ladder marks the record never answered", async () => {
      const wrapper = mount(OnCallPolicyEditor, {
        props: { teamId: "team_1", policy: policyEnding("stop"), open: true },
        global: { plugins: [i18n, store], stubs },
      });
      await flushPromises();
      const line = wrapper.find('[data-test="oncall-policy-ladder-end"]').text();
      expect(line).toContain("never answered");
      expect(wrapper.find('[data-test="oncall-policy-no-default-warning"]').exists()).toBe(false);
    });
  });

  /// C15/C16. `source` is the point: precedence must be visible, or "I set
  /// the team channel and pages still go to the old room" is unanswerable.
  describe("the team channel", () => {
    it("names where the current answer came from", async () => {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-team-channel-source"]').text()).toContain(
        "from the policy",
      );
    });

    /// null and [] are different facts on the wire: back-to-policy versus
    /// silence-on-purpose. Two controls, two payloads.
    it("clears back to the policy with null, never an empty array", async () => {
      service.getTeamChannel.mockResolvedValue({
        data: { team_id: "team_1", destinations: ["slack-eng"], source: "team" },
      } as any);
      service.setTeamChannel.mockResolvedValue({
        data: { team_id: "team_1", destinations: [], source: "policy" },
      } as any);
      const wrapper = render();
      await flushPromises();

      await wrapper.find('[data-test="oncall-team-channel-clear"]').trigger("click");
      await flushPromises();

      expect(service.setTeamChannel).toHaveBeenCalledWith(
        expect.objectContaining({ data: { destinations: null } }),
      );
    });

    it("says so when the team's channel is empty on purpose", async () => {
      service.getTeamChannel.mockResolvedValue({
        data: { team_id: "team_1", destinations: [], source: "team" },
      } as any);
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-team-channel-silent"]').exists()).toBe(true);
    });
  });
});

/// **The three targets a rung could not name.** `TARGET_KINDS` offered five of
/// eight, so from 2026-08-18 — when every ≥2-person rotation gained a derived
/// secondary slot — there was a real, staffed, coverable position that no rung
/// in any ladder could page. The engine resolved it, the calendar drew it, the
/// cover dialog could hand it to somebody, and escalation could not reach it.
describe("targets that name a rotation", () => {
  /// Its own, because this block is a top-level `describe` and the suite above
  /// does not reach it — without this, `setPolicy.mock.calls[0]` is whichever
  /// test saved first, not this one's.
  beforeEach(() => {
    // The catch-all is cached module-wide so one screen reads it once;
    // without this it survives into the next test.
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: [], source: "policy" },
    } as any);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  const rota = (id: string, name: string) => ({ id, name, shift_rules: [] });

  function renderWithRotations(rotations: { id: string; name: string; shift_rules: [] }[]) {
    return mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy, open: true, rotations },
      global: { plugins: [i18n, store], stubs },
    });
  }

  const TWO = [rota("rot_primary", "Primary"), rota("rot_secondary", "Secondary")];

  const targetPicker = (wrapper: ReturnType<typeof renderWithRotations>) =>
    wrapper.findComponent('[data-test="oncall-policy-add-target-1-0"]');

  const kinds = (wrapper: ReturnType<typeof renderWithRotations>) =>
    (targetPicker(wrapper).props("options") as { value: string }[]).map((o) => o.value);

  /// The rung this suite edits, out of the payload the save actually sent.
  const savedTargets = () => {
    const { rungs } = (service.setPolicy.mock.calls.at(-1)![0] as any).data;
    return rungs.find((r: any) => r.priority === 1).steps[0].targets;
  };

  /// **Eight kinds became three.** Six of the old ones existed only to name a
  /// slot or to describe a derivation, and the picker offered "the on-call"
  /// beside "the primary on-call" — a distinction that did not exist. The
  /// fourth row is the same kind with `mode: "all"`, because "everyone on
  /// Platform" and "whoever is on call in Platform" are different errands.
  it("offers three kinds and the everyone-on variant, whatever the team staffs", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    expect(kinds(wrapper)).toEqual(["rotation", "user", "whole_team", "rotation_all"]);

    // Not gated on how many rotations exist: naming the only one is meaningful.
    const one = renderWithRotations([rota("rot_primary", "Primary")]);
    await flushPromises();
    expect(kinds(one)).toEqual(["rotation", "user", "whole_team", "rotation_all"]);
  });

  /// A level pointed at a rotation the team does not have pages nobody and the
  /// ladder skips it in silence — the `level_names_a_rotation_that_does_not_exist`
  /// risk. Picking from the team's own schedule is how that never gets written.
  it("asks which rotation, offering only the ones this team staffs", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-pick-rotation-1-0"]').exists()).toBe(false);

    targetPicker(wrapper).vm.$emit("update:modelValue", "rotation");
    await flushPromises();

    const picker = wrapper.findComponent('[data-test="oncall-policy-pick-rotation-1-0"]');
    expect(picker.exists()).toBe(true);
    // Offered by NAME, sent as the ID: a rotation is renameable, and a stored
    // policy must not start paging a different position because of a typo fix.
    expect((picker.props("options") as { label: string; value: string }[])).toEqual([
      { label: "Primary", value: "rot_primary" },
      { label: "Secondary", value: "rot_secondary" },
    ]);
  });

  /// `mode` is omitted from the wire when it is `on_call`, so a level written
  /// without it round-trips unchanged rather than gaining a field it never had.
  it("saves a rotation target by id, with no mode on the ordinary one", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    targetPicker(wrapper).vm.$emit("update:modelValue", "rotation");
    await flushPromises();
    wrapper
      .findComponent('[data-test="oncall-policy-pick-rotation-1-0"]')
      .vm.$emit("update:modelValue", "rot_secondary");
    await flushPromises();

    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();

    expect(savedTargets()).toContainEqual({ kind: "rotation", rotation_id: "rot_secondary" });
  });

  /// "Everyone on this rotation" is a MODE, not a fourth kind — which is why
  /// three kinds are enough.
  it("saves the everyone-on variant as the same kind with mode all", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    targetPicker(wrapper).vm.$emit("update:modelValue", "rotation_all");
    await flushPromises();
    wrapper
      .findComponent('[data-test="oncall-policy-pick-rotation-1-0"]')
      .vm.$emit("update:modelValue", "rot_primary");
    await flushPromises();

    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();

    expect(savedTargets()).toContainEqual({
      kind: "rotation",
      rotation_id: "rot_primary",
      mode: "all",
    });
  });

  /// **Several targets on one step is now the ONLY way a level pages more than
  /// one person**, so the duplicate check has to be on the rotation, not the
  /// kind.
  it("allows two rotations on one step", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    for (const id of ["rot_primary", "rot_secondary"]) {
      targetPicker(wrapper).vm.$emit("update:modelValue", "rotation");
      await flushPromises();
      wrapper
        .findComponent('[data-test="oncall-policy-pick-rotation-1-0"]')
        .vm.$emit("update:modelValue", id);
      await flushPromises();
    }

    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();

    expect(savedTargets().filter((t: any) => t.kind === "rotation")).toHaveLength(2);
  });

  /// The same rotation and mode twice is one target. Written twice it pages the
  /// same person twice on one level, which reads on the timeline as a retry.
  /// Counted against `rot_secondary` alone: the fixture's step already names
  /// `rot_primary`, and that one is a different target.
  it("refuses the same rotation and mode twice", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    for (let i = 0; i < 2; i++) {
      targetPicker(wrapper).vm.$emit("update:modelValue", "rotation");
      await flushPromises();
      wrapper
        .findComponent('[data-test="oncall-policy-pick-rotation-1-0"]')
        .vm.$emit("update:modelValue", "rot_secondary");
      await flushPromises();
    }

    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();

    expect(
      savedTargets().filter((t: any) => t.rotation_id === "rot_secondary"),
    ).toHaveLength(1);
  });

  /// The same rotation in both modes is two different errands, so it is two
  /// targets rather than a duplicate.
  it("allows one rotation in both modes", async () => {
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    for (const kind of ["rotation", "rotation_all"]) {
      targetPicker(wrapper).vm.$emit("update:modelValue", kind);
      await flushPromises();
      wrapper
        .findComponent('[data-test="oncall-policy-pick-rotation-1-0"]')
        .vm.$emit("update:modelValue", "rot_primary");
      await flushPromises();
    }

    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();

    expect(
      savedTargets().filter((t: any) => t.rotation_id === "rot_primary"),
    ).toHaveLength(2);
  });

  /// Found by this suite leaking between tests: `reset` shallow-copied each
  /// step, so the draft shared `targets` with `props.policy` and every add or
  /// remove edited the policy in place. Cancel throws the draft away, which
  /// discarded nothing — the rung read as reverted and the next save wrote the
  /// abandoned edit.
  it("discards target edits on cancel instead of writing them into the policy", async () => {
    const before = JSON.stringify(policy);
    const wrapper = renderWithRotations(TWO);
    await flushPromises();

    targetPicker(wrapper).vm.$emit("update:modelValue", "rotation");
    await flushPromises();
    wrapper
      .findComponent('[data-test="oncall-policy-pick-rotation-1-0"]')
      .vm.$emit("update:modelValue", "rot_secondary");
    await flushPromises();

    await wrapper.setProps({ open: false });
    await flushPromises();

    expect(JSON.stringify(policy)).toBe(before);
  });
});

/// **What the ladder does when it runs out was read-only.** The editor
/// rendered a sentence describing `repeat_count` and `final_action`, and warned
/// that `notify_default_team` had no team nominated — for a value it would not
/// let anybody set. A screen telling somebody to fix something it will not let
/// them touch.
///
/// The two fields are ONE control now: "runs twice" and "then stops" is a
/// single decision an operator reads as a single sentence. The wire still
/// carries both, so the select encodes them as `<repeats>:<action>`.
describe("the end of the ladder, as an edit", () => {
  beforeEach(() => {
    // The catch-all is cached module-wide so one screen reads it once;
    // without this it survives into the next test.
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: [], source: "policy" },
    } as any);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  function renderWith(over: Record<string, unknown> = {}) {
    return mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy: { ...policy, ...over }, open: true },
      global: { plugins: [i18n, store], stubs },
    });
  }

  const endSelect = (wrapper: ReturnType<typeof renderWith>) =>
    wrapper.findComponent('[data-test="oncall-policy-ladder-end-select"]');

  const saved = () => (service.setPolicy.mock.calls.at(-1)![0] as any).data;

  async function save(wrapper: ReturnType<typeof renderWith>) {
    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();
  }

  it("opens on what the policy already says", async () => {
    const wrapper = renderWith({ repeat_count: 3, final_action: "notify_default_team" });
    await flushPromises();

    expect(endSelect(wrapper).props("modelValue")).toBe("3:notify_default_team");
  });

  /// `repeat_count` 1 means the ladder runs once; there is no zero.
  it("defaults to one pass, then stop", async () => {
    const wrapper = renderWith();
    await flushPromises();

    expect(endSelect(wrapper).props("modelValue")).toBe("1:stop");
  });

  /// Every option has to be a pair the server accepts — a select offering a
  /// repeat count it cannot send is a save that 400s.
  it("offers every pass count against both endings", async () => {
    const wrapper = renderWith();
    await flushPromises();

    const values = (endSelect(wrapper).props("options") as { value: string }[]).map((o) => o.value);
    expect(values).toHaveLength(10);
    expect(values).toContain("1:stop");
    expect(values).toContain("5:notify_default_team");
  });

  it("sends both halves, so the ladder's end is part of the save", async () => {
    const wrapper = renderWith();
    await flushPromises();

    endSelect(wrapper).vm.$emit("update:modelValue", "3:notify_default_team");
    await flushPromises();
    await save(wrapper);

    expect(saved()).toMatchObject({ repeat_count: 3, final_action: "notify_default_team" });
  });

  /// The sentence has to track the control, not the last save — otherwise it
  /// describes a ladder the reader has already changed. It says what the
  /// option label cannot: which team the page would actually land on.
  it("re-words itself as the control moves", async () => {
    const wrapper = renderWith();
    await flushPromises();
    const line = () => wrapper.find('[data-test="oncall-policy-ladder-end"]').text();

    expect(line()).toContain("never answered");

    endSelect(wrapper).vm.$emit("update:modelValue", "1:notify_default_team");
    await flushPromises();

    expect(line()).not.toContain("never answered");
  });

  /// §G.9 #9: `notify_default_team` with nobody nominated is indistinguishable
  /// from stop — the ladder ends silently while the policy reads as having a
  /// safety net. The warning now follows the control instead of the last save.
  it("warns as soon as the catch-all is chosen and none is nominated", async () => {
    const wrapper = renderWith();
    await flushPromises();
    const warning = '[data-test="oncall-policy-no-default-warning"]';

    expect(wrapper.find(warning).exists()).toBe(false);

    endSelect(wrapper).vm.$emit("update:modelValue", "1:notify_default_team");
    await flushPromises();

    expect(wrapper.find(warning).exists()).toBe(true);
  });

  it("drops an abandoned edit when the drawer is reopened", async () => {
    const wrapper = renderWith({ repeat_count: 2 });
    await flushPromises();

    endSelect(wrapper).vm.$emit("update:modelValue", "5:stop");
    await flushPromises();

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(endSelect(wrapper).props("modelValue")).toBe("2:stop");
  });
});

/// **The ladder said out loud.** The editor is built out of target KINDS and
/// absolute offsets, neither of which is how anybody describes a policy. The
/// sentence is the plain reading of what the controls below it add up to, and
/// it has to track them rather than the last save.
describe("the ladder as one sentence", () => {
  beforeEach(() => {
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: [], source: "policy" },
    } as any);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  const threeSteps: OnCallPolicy = {
    ...policy,
    rungs: [
      {
        priority: 1,
        steps: [
          { after_micros: 0, targets: [{ kind: "rotation", rotation_id: "rot_primary" }] },
          { after_micros: 5 * 60_000_000, targets: [{ kind: "rotation", rotation_id: "rot_second" }] },
          { after_micros: 15 * 60_000_000, targets: [{ kind: "whole_team" }] },
        ],
        channels: ["email"],
      },
    ],
  };

  function renderWith(over: Partial<OnCallPolicy> = {}) {
    return mount(OnCallPolicyEditor, {
      props: {
        teamId: "team_1",
        policy: { ...threeSteps, ...over },
        open: true,
        rotations: [
          { id: "rot_primary", name: "Primary", shift_rules: [] },
          { id: "rot_second", name: "Secondary", shift_rules: [] },
        ],
      },
      global: { plugins: [i18n, store], stubs },
    });
  }

  it("names every step, when it fires, and how the ladder ends", async () => {
    const wrapper = renderWith();
    await flushPromises();

    const line = wrapper.find('[data-test="oncall-policy-sentence"]').text();
    // Each level NAMES its rotation. "The on-call" and "the secondary" were
    // role words two screens resolved differently, and both were right.
    expect(line).toContain("Whoever is on call in Primary now");
    expect(line).toContain("Whoever is on call in Secondary at 5m");
    expect(line).toContain("The whole team at 15m");
    expect(line).toContain("then stops");
  });

  /// A priority with no steps pages nobody. Saying "A P4 pages ." would read
  /// as a rendering bug rather than as a decision.
  it("says so plainly when a priority pages nobody", async () => {
    const wrapper = mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy, open: true, priority: 4 },
      global: { plugins: [i18n, store], stubs },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-sentence"]').text()).toContain("pages nobody");
  });

  it("follows the controls rather than the stored policy", async () => {
    const wrapper = renderWith();
    await flushPromises();

    wrapper
      .findComponent('[data-test="oncall-policy-ladder-end-select"]')
      .vm.$emit("update:modelValue", "1:notify_default_team");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-sentence"]').text()).toContain("hands off");
  });
});

/// **The first page's own delay had no control.** The connectors edit the wait
/// BETWEEN steps, so on a ladder whose first step is held — which is what a P2
/// usually is — the hold was visible and unreachable. It is edited in the first
/// step's own offset cell, where the reader is already looking.
describe("the first step's delay", () => {
  beforeEach(() => {
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: [], source: "policy" },
    } as any);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    service.setPolicy.mockResolvedValue({ data: {} } as any);
  });

  const twoSteps: OnCallPolicy = {
    ...policy,
    rungs: [
      {
        priority: 1,
        steps: [
          { after_micros: 0, targets: [{ kind: "on_call_now" }] },
          { after_micros: 5 * 60_000_000, targets: [{ kind: "next_on_call" }] },
        ],
        channels: ["email"],
      },
    ],
  };

  function renderWith() {
    return mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy: twoSteps, open: true },
      global: { plugins: [i18n, store], stubs },
    });
  }

  /// Zero is legal and usual before the first step — P1 pages at once — and is
  /// the only place in the ladder where it is.
  it("offers paging at once, which no gap between steps may be", async () => {
    const wrapper = renderWith();
    await flushPromises();

    const lead = wrapper.findComponent('[data-test="oncall-policy-step-delay-1-0"]');
    const between = wrapper.findComponent('[data-test="oncall-policy-step-delay-1-1"]');

    expect((lead.props("options") as { value: number }[]).map((o) => o.value)).toContain(0);
    expect((between.props("options") as { value: number }[]).map((o) => o.value)).not.toContain(0);
  });

  /// Holding the first page must not close the gaps below it — the whole
  /// ladder shifts, keeping its spacing.
  it("shifts the whole ladder when the first page is held", async () => {
    const wrapper = renderWith();
    await flushPromises();

    wrapper
      .findComponent('[data-test="oncall-policy-step-delay-1-0"]')
      .vm.$emit("update:modelValue", 5 * 60_000_000);
    await flushPromises();

    await wrapper.find('[data-test="oncall-policy-save"]').trigger("click");
    await flushPromises();

    const { rungs } = (service.setPolicy.mock.calls.at(-1)![0] as any).data;
    expect(rungs[0].steps.map((s: any) => s.after_micros)).toEqual([
      5 * 60_000_000,
      10 * 60_000_000,
    ]);
  });
});

/// **A channel that is on and delivers nowhere looks identical to working.**
/// Delivery and AI triage are tabs, so the problem count belongs on the tab
/// itself — a tab that hides its own breakage behind the other one reads as
/// fine.
describe("the delivery card", () => {
  beforeEach(() => {
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.getTeamChannel.mockResolvedValue({
      data: { team_id: "team_1", destinations: ["seed_dest"], source: "policy" },
    } as any);
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: null, default_team_name: null, updated_at: 0 },
    } as any);
    service.setPolicy.mockResolvedValue({ data: {} } as any);
    destinations.list.mockResolvedValue({ data: [{ name: "slack-oncall" }] } as any);
  });

  const webhookPolicy: OnCallPolicy = {
    ...policy,
    rungs: [
      {
        priority: 1,
        steps: [{ after_micros: 0, targets: [{ kind: "on_call_now" as const }] }],
        channels: ["webhook" as const],
      },
    ],
    destinations: [],
  };

  function renderWith(over: Partial<OnCallPolicy> = {}) {
    return mount(OnCallPolicyEditor, {
      props: { teamId: "team_1", policy: { ...webhookPolicy, ...over }, open: true },
      global: { plugins: [i18n, store], stubs },
    });
  }

  it("counts the problem on the card, not only inside it", async () => {
    const wrapper = renderWith();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-delivery-problems"]').text()).toContain(
      "1 problem",
    );
  });

  it("stops counting once the destination is chosen", async () => {
    const wrapper = renderWith({ destinations: ["slack-oncall"] });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-policy-delivery-problems"]').exists()).toBe(false);
  });

  /// There is no folded summary to keep in sync any more — the Delivery tab
  /// shows the channels and the room through its own live controls.
  it("shows the channels and the room directly on the tab", async () => {
    const wrapper = renderWith();
    await flushPromises();

    expect(wrapper.text()).toContain("Chat / webhook");
    expect(
      wrapper.findComponent('[data-test="oncall-team-channel-select"]').props("modelValue"),
    ).toEqual(["seed_dest"]);
  });
});
