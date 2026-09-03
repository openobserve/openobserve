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

import i18n from "@/locales";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallTeamDetail from "@/views/OnCall/OnCallTeamDetail.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    getTeam: vi.fn(),
    listMembers: vi.fn(),
    getSchedule: vi.fn(),
    getPolicy: vi.fn(),
    whoIsOnCall: vi.fn(),
    listTeams: vi.fn(),
    listOwnershipRules: vi.fn(),
    listResponses: vi.fn(),
    resolvedSchedule: vi.fn(),
    escalationPreview: vi.fn(),
    createOverride: vi.fn(),
    // The undo half of a swap: without it here, a spec asserting the rollback
    // fails on the mock rather than on the behaviour.
    deleteOverride: vi.fn(),
    // What the Covers panel under the calendar reads. Absent, its fetch throws
    // into its own catch and the panel is empty for the wrong reason.
    listOverrides: vi.fn(),
    teamOverview: vi.fn(),
    teamReachability: vi.fn(),
    teamConfigRisks: vi.fn(),
    teamLoad: vi.fn(),
    // Deleting a rotation is a whole-schedule save with one layer removed —
    // there is no per-rotation endpoint.
    setSchedule: vi.fn(),
  },
}));

const routeParams: Record<string, string> = { teamId: "team_1" };
// One router object, not a fresh mock per call: the view writes the tab back
// into the URL, and a `useRouter()` that handed out a new spy each time would
// make that unobservable.
const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: routeParams }),
  useRouter: () => router,
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const service = vi.mocked(oncallService);
const toasted = vi.mocked(toast);

// The tab strip and the attention banner are what is under test, so they
// render for real; everything they sit beside is a panel with its own spec.
const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    template: "<div><slot name='title-trail' /><slot name='actions' /><slot /></div>",
  },
  OTable: { name: "OTable", props: ["data", "columns"], template: "<div />" },
  OnCallScheduleTimeline: true,
  OnCallScheduleEditor: true,
  OnCallEscalationLadder: true,
  OnCallCoverForm: true,
  OnCallMembers: true,
  OnCallPolicyEditor: true,
  OnCallOwnership: true,
  OnCallTeamForm: true,
};

function render() {
  return mount(OnCallTeamDetail, { global: { plugins: [i18n, store], stubs } });
}

/// A rotation with one ordinary rule — what almost every team has. The id is
/// the handle: a level stores it, a lane keys on it, and a delete is written
/// against it, because two rotations may share a name.
const rotation = (id: string, name: string) => ({
  id,
  name,
  shift_rules: [
    {
      name,
      members: ["ana@o2.ai"],
      shift_micros: 604_800_000_000,
      anchor_micros: 0,
    },
  ],
});

describe("OnCallTeamDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete routeParams.tab;
    service.getTeam.mockResolvedValue({
      data: { id: "team_1", name: "Platform", timezone: "UTC" },
    } as any);
    service.listMembers.mockResolvedValue({ data: [{ user_email: "ana@corp.com" }] } as any);
    service.getSchedule.mockResolvedValue({ data: { rotations: [] } } as any);
    service.getPolicy.mockResolvedValue({ data: { rungs: [] } } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    service.listOwnershipRules.mockResolvedValue({ data: [] } as any);
    service.listResponses.mockResolvedValue({ data: [] } as any);
    service.resolvedSchedule.mockResolvedValue({ data: [] } as any);
    service.escalationPreview.mockResolvedValue({ data: null } as any);
    service.teamOverview.mockResolvedValue({ data: null } as any);
    service.teamReachability.mockResolvedValue({ data: null } as any);
    service.teamConfigRisks.mockResolvedValue({ data: null } as any);
    service.teamLoad.mockResolvedValue({ data: null } as any);
    service.listOverrides.mockResolvedValue({ data: [] } as any);
  });

  /// Overview first — what the team HAS been doing — then the chain that
  /// decides it: when each person is on, what happens if nobody answers, what
  /// reaches the team at all, and finally who the people are.
  it("orders the tabs the way a team is actually set up", async () => {
    const wrapper = render();
    await flushPromises();

    const names = wrapper.findAllComponents({ name: "OTab" }).map((tab) => tab.props("name"));
    expect(names).toEqual(["overview", "schedule", "policy", "ownership", "members"]);
  });

  /// A team with nobody in it cannot have an overview worth reading, so it
  /// lands where the work is instead.
  it("lands on members while the team is still empty", async () => {
    service.listMembers.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("members");
  });

  /// The setup checklist and the policies list both deep-link here with a
  /// `tab` param. The view was not reading it — the links only appeared to work
  /// because the default landing tab happened to be the one they asked for.
  it("opens the tab the URL asked for", async () => {
    routeParams.tab = "policy";
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("policy");
  });

  /// I5: rostered and reachable are two questions. A green `Covered` used to
  /// sit in the header beside a panel reading "no page can be delivered to
  /// anyone" — the chip answering the first question in a voice that sounded
  /// like an answer to both.
  describe("the coverage chip", () => {
    function onCall(email: string) {
      service.whoIsOnCall.mockResolvedValue({
        data: [
          {
            rotation_id: "rot_primary",
            rotation_name: "Weekdays",
            rule: "Base",
            user_email: email,
          },
        ],
      } as any);
    }

    function verdict(email: string, lands: boolean) {
      service.teamReachability.mockResolvedValue({
        data: {
          team_id: "team_1",
          smtp_configured: lands,
          members: [
            {
              user_email: email,
              is_org_user: true,
              mailbox_shaped: true,
              channels: [],
              deliverable_channels: lands ? ["email"] : [],
              configured_but_unverified: [],
              would_a_page_land: lands,
            },
          ],
          reachable: lands ? 1 : 0,
          total: 1,
          unreachable_members: lands ? [] : [email],
        },
      } as any);
    }

    function chip(wrapper: ReturnType<typeof render>) {
      return wrapper.find('[data-test="oncall-team-coverage"]').text();
    }

    it("says rostered, not covered, when no page would reach the holder", async () => {
      onCall("ana@corp.com");
      verdict("ana@corp.com", false);
      const wrapper = render();
      await flushPromises();

      expect(chip(wrapper)).toContain("Rostered, unreachable");
    });

    it("stays covered while the holder can actually be paged", async () => {
      onCall("ana@corp.com");
      verdict("ana@corp.com", true);
      const wrapper = render();
      await flushPromises();

      expect(chip(wrapper)).toContain("Covered");
    });

    /// An unanswered question is not a finding: reachability failing to load
    /// must not paint the header red.
    it("does not invent a verdict when reachability did not load", async () => {
      onCall("ana@corp.com");
      service.teamReachability.mockResolvedValue({ data: null } as any);
      const wrapper = render();
      await flushPromises();

      expect(chip(wrapper)).toContain("Covered");
    });

    it("still reports a gap when nobody is on call at all", async () => {
      verdict("ana@corp.com", false);
      const wrapper = render();
      await flushPromises();

      expect(chip(wrapper)).toContain("Nobody on call");
    });
  });

  /// I13: the route said `policy` and `ownership`; the tabs said Escalation and
  /// Routing. A link somebody pastes into a thread and the tab it opens were
  /// using two vocabularies for one thing.
  describe("the tab vocabulary", () => {
    it("opens Escalation for the word the tab actually uses", async () => {
      routeParams.tab = "escalation";
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("policy");
    });

    it("opens Routing for the word the tab actually uses", async () => {
      routeParams.tab = "routing";
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("ownership");
    });

    /// The old spellings are in setup checklists and Slack threads already;
    /// tidying a vocabulary is not worth breaking a link somebody saved.
    it("still honours the spelling the old links use", async () => {
      routeParams.tab = "ownership";
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("ownership");
    });

    /// The route always carried `:tab` and the view always read it — but
    /// nothing wrote it, so clicking a tab and copying the address bar sent
    /// somebody to the landing tab. Half a deep link is worse than none.
    it("writes the tab back into the URL, in the visible word", async () => {
      const wrapper = render();
      await flushPromises();
      router.replace.mockClear();

      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
      await flushPromises();

      expect(router.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "onCallTeamDetail",
          params: expect.objectContaining({ tab: "escalation" }),
        }),
      );
    });

    /// Back should leave the team, not walk the five tabs somebody clicked
    /// through on the way to this one.
    it("replaces rather than pushes, so Back leaves the page", async () => {
      const wrapper = render();
      await flushPromises();
      router.push.mockClear();

      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();

      expect(router.push).not.toHaveBeenCalled();
    });

    /// Rewriting the URL while the first fetch is still deciding where to land
    /// would overwrite the address somebody just typed.
    it("does not rewrite the URL before the team has loaded", async () => {
      service.getTeam.mockReturnValue(new Promise(() => {}) as any);
      const wrapper = render();
      await flushPromises();

      // Even a tab change mid-load must not overwrite the address somebody
      // just typed — the landing tab has not been decided yet.
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
      await flushPromises();

      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  /// The header verb is *take*, so the reader is who it opens on. Three
  /// openers share this one dialog and each arrives with a different opinion
  /// about the person and the window — the state one leaves behind is the
  /// state the next one offers.
  describe("taking an override from the header", () => {
    const button = (wrapper: ReturnType<typeof render>) =>
      wrapper.find('[data-test="oncall-team-override-btn"]');
    const cover = (wrapper: ReturnType<typeof render>) =>
      wrapper.findComponent({ name: "OnCallCoverForm" });

    it("opens the cover dialog on the person reading the page", async () => {
      const wrapper = render();
      await flushPromises();
      await button(wrapper).trigger("click");

      expect(cover(wrapper).props("open")).toBe(true);
      expect(cover(wrapper).props("defaultUser")).toBe("example@gmail.com");
      // "Until when" has no safe default — a cover saved over hours nobody
      // chose reassigns a night nobody agreed to.
      expect(cover(wrapper).props("gap")).toBe(null);
    });

    /// A cover is a shift handed to somebody. With an empty roster the dialog
    /// would open on a picker with nothing in it.
    it("is not offered while the team has nobody in it", async () => {
      service.listMembers.mockResolvedValue({ data: [] } as any);
      const wrapper = render();
      await flushPromises();

      expect(button(wrapper).exists()).toBe(false);
    });

    /// The schedule tab's opener has no opinion about the person, and must not
    /// inherit one — nor the window a gap-fill left behind.
    it("leaves nothing behind for the schedule tab's own opener", async () => {
      const wrapper = render();
      await flushPromises();
      await button(wrapper).trigger("click");

      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      const timeline = wrapper.findComponent({ name: "OnCallScheduleTimeline" });
      timeline.vm.$emit("fill-gap", { from: 1_000, to: 2_000 });
      await flushPromises();
      expect(cover(wrapper).props("defaultUser")).toBe("");

      timeline.vm.$emit("override");
      await flushPromises();
      expect(cover(wrapper).props("gap")).toBe(null);
      expect(cover(wrapper).props("defaultUser")).toBe("");
    });
  });

  /// Saving a cover is three things, and only the first had a test: the write,
  /// the panels that must catch up with it, and what the reader is told. A
  /// cover that lands and leaves the Covers panel empty is indistinguishable
  /// from one that never landed.
  describe("saving a cover", () => {
    const COVER = {
      user_email: "bo@corp.com",
      start_at: 1_000,
      end_at: 2_000,
      rotation_id: "rot_primary",
    };

    async function save(wrapper: ReturnType<typeof render>) {
      wrapper.findComponent({ name: "OnCallCoverForm" }).vm.$emit("save", COVER);
      await flushPromises();
    }

    it("writes the cover the dialog handed it", async () => {
      service.createOverride.mockResolvedValue({ data: { id: "ov_1" } } as any);
      const wrapper = render();
      await flushPromises();
      await save(wrapper);

      expect(service.createOverride).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: "team_1", data: COVER }),
      );
    });

    /// The panel that lists covers sits directly under the calendar, on the
    /// tab the reader is standing on while they take one. It reads its own
    /// endpoint, so a save it is never told about leaves them looking at a list
    /// that does not contain what they just saved.
    it("re-reads the Covers panel so the new cover appears in it", async () => {
      service.createOverride.mockResolvedValue({ data: { id: "ov_1" } } as any);
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      const before = service.listOverrides.mock.calls.length;
      expect(before).toBeGreaterThan(0);

      await save(wrapper);
      expect(service.listOverrides.mock.calls.length).toBeGreaterThan(before);
    });

    /// A swap is two covers written back to back, so it invalidates exactly
    /// what one cover invalidates.
    it("re-reads the Covers panel after a swap too", async () => {
      service.createOverride.mockResolvedValue({ data: { id: "ov_1" } } as any);
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      const before = service.listOverrides.mock.calls.length;

      wrapper.findComponent({ name: "OnCallCoverForm" }).vm.$emit("swap", {
        first: { user_email: "bo@corp.com", start_at: 1_000, end_at: 2_000 },
        second: { user_email: "ana@corp.com", start_at: 2_000, end_at: 3_000 },
      });
      await flushPromises();

      expect(service.listOverrides.mock.calls.length).toBeGreaterThan(before);
    });

    /// The toast is the whole report a save makes. Its message names who, which
    /// team and which hours — all three interpolated, or it reads as a sentence
    /// with the nouns cut out of it.
    it("names who covers what in the success toast", async () => {
      service.createOverride.mockResolvedValue({ data: { id: "ov_1" } } as any);
      const wrapper = render();
      await flushPromises();
      await save(wrapper);

      const message = String(toasted.mock.calls.at(-1)?.[0]?.message ?? "");
      expect(message).toContain("bo@corp.com");
      expect(message).toContain("Platform");
      expect(message).not.toMatch(/\{\w+\}/);
      // " covers  · " — the shape the sentence collapses to when vue-i18n is
      // handed no params for its placeholders.
      expect(message).not.toMatch(/^\s*covers\s/);
    });
  });

  /// F6: a swap is two writes behind one button, which is exactly where a UI
  /// lies. The second can be refused — the server 409s when somebody already
  /// covers that window — and by then the first has landed.
  describe("swapping two shifts", () => {
    const SWAP = {
      first: { user_email: "bo@corp.com", start_at: 1_000, end_at: 2_000 },
      second: { user_email: "ana@corp.com", start_at: 2_000, end_at: 3_000 },
    };

    async function swap(wrapper: ReturnType<typeof render>) {
      wrapper.findComponent({ name: "OnCallCoverForm" }).vm.$emit("swap", SWAP);
      await flushPromises();
    }

    it("writes one cover each way", async () => {
      service.createOverride.mockResolvedValue({ data: { id: "ov_1" } } as any);
      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(service.createOverride).toHaveBeenCalledTimes(2);
      expect(service.createOverride).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: SWAP.first }),
      );
      expect(service.createOverride).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: SWAP.second }),
      );
    });

    /// Half a swap is worse than none: one person has been given a week they
    /// did not agree to cover, and nobody has taken theirs.
    it("undoes the first cover when the second is refused", async () => {
      service.createOverride
        .mockResolvedValueOnce({ data: { id: "ov_1" } } as any)
        .mockRejectedValueOnce({ response: { data: { message: "already covered" } } });
      service.deleteOverride.mockResolvedValue({} as any);

      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(service.deleteOverride).toHaveBeenCalledWith(
        expect.objectContaining({ override_id: "ov_1" }),
      );
    });

    /// Nothing was written, so there is nothing to undo — a delete here would
    /// be a request against an id that does not exist.
    it("undoes nothing when the first cover was the one refused", async () => {
      service.createOverride.mockRejectedValue({
        response: { data: { message: "already covered" } },
      });

      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(service.deleteOverride).not.toHaveBeenCalled();
    });

    /// A refused swap leaves the dialog open on the two shifts somebody chose:
    /// closing it would report the errand as done and make them rebuild the
    /// same pair from scratch to try again.
    it("keeps the dialog open when the swap did not happen", async () => {
      service.createOverride
        .mockResolvedValueOnce({ data: { id: "ov_1" } } as any)
        .mockRejectedValueOnce({ response: { data: { message: "already covered" } } });
      service.deleteOverride.mockResolvedValue({} as any);

      const wrapper = render();
      await flushPromises();
      // The dialog is open, the way it is when somebody has just picked two
      // shifts in it.
      wrapper.findComponent({ name: "OnCallCoverForm" }).vm.$emit("update:open", true);
      await flushPromises();
      await swap(wrapper);

      expect(wrapper.findComponent({ name: "OnCallCoverForm" }).props("open")).toBe(true);
    });

    it("closes the dialog once both covers are written", async () => {
      service.createOverride.mockResolvedValue({ data: { id: "ov_1" } } as any);

      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(wrapper.findComponent({ name: "OnCallCoverForm" }).props("open")).toBe(false);
    });
  });

  it("ignores a tab the URL invented", async () => {
    routeParams.tab = "not-a-tab";
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTabPanels" }).props("modelValue")).toBe("overview");
  });

  describe("the schedule tab", () => {
    /// The delete confirm, told apart from the presets dialog's own by title.
    function deleteConfirm(wrapper: any) {
      return wrapper
        .findAllComponents({ name: "ConfirmDialog" })
        .find((c: any) => c.props("title") === "Delete this rotation?");
    }

    async function openSchedule() {
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      return wrapper;
    }

    /// The editor carries its OWN draft calendar and rotation table, so showing
    /// it beneath the resolved pair put two of each on the screen.
    /// The editor rides along drawer-only: the resolved view is never swapped
    /// out for a page-sized editing mode. "Add rotation" opening a page whose
    /// own button is also "Add rotation" was the bug.
    it("keeps the resolved schedule mounted, with the editor as a drawer beside it", async () => {
      const wrapper = await openSchedule();

      expect(wrapper.findComponent({ name: "OnCallScheduleTimeline" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallScheduleAnswer" }).exists()).toBe(true);
      const editor = wrapper.findComponent({ name: "OnCallScheduleEditor" });
      expect(editor.exists()).toBe(true);
      expect(editor.props("drawerOnly")).toBe(true);
    });

    /// One click on a row lands on THAT rotation: the click's intent reaches
    /// the editor, and the read view stays underneath it.
    it("hands the clicked rotation to the editor without unmounting the view", async () => {
      const wrapper = await openSchedule();
      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("edit", "Primary");
      await flushPromises();

      const editor = wrapper.findComponent({ name: "OnCallScheduleEditor" });
      expect(editor.props("intent")).toEqual({ mode: "edit", id: "Primary" });
      expect(wrapper.findComponent({ name: "OnCallScheduleTimeline" }).exists()).toBe(true);
    });

    /// Until the lane menu carried it, a rotation could be created and never
    /// removed: the only delete control lived in the bulk table, which
    /// `drawer-only` — the mode this tab has always used — does not render.
    /// The lane emits the rotation's ID; the prompt has to name it. Two
    /// rotations in one team routinely differ by one word, and deleting the
    /// wrong one silently stops paging — but a name cannot key the delete,
    /// because two of them may share it.
    it("deletes a rotation by saving the schedule without it", async () => {
      service.setSchedule.mockResolvedValue({ data: {} });
      service.getSchedule.mockResolvedValue({
        data: { timezone: "UTC", rotations: [rotation("rot_primary", "Primary")] },
      } as any);
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "rot_primary");
      await flushPromises();

      // BY TITLE, not `findComponent`: the presets dialog mounts a ConfirmDialog
      // of its own and sits earlier in the tree, so the first match is its
      // "Replace the current schedule?" — which is always closed, and would
      // make this assertion pass for the wrong reason if it ever inverted.
      const confirm = deleteConfirm(wrapper);
      // Named in the prompt: two rotations in one team routinely differ by one
      // word, and deleting the wrong one silently stops paging.
      expect(confirm!.props("modelValue")).toBe(true);
      expect(confirm!.props("message")).toContain("Primary");
      expect(service.setSchedule).not.toHaveBeenCalled();

      confirm!.vm.$emit("update:ok");
      await flushPromises();

      const sent = service.setSchedule.mock.calls[0][0];
      expect(sent.data.rotations.map((r: any) => r.name)).not.toContain("Primary");
    });

    /// Nothing is sent until the reader confirms — the dialog is the guard, not
    /// a receipt for a delete that already happened.
    it("leaves the schedule alone when the delete is cancelled", async () => {
      service.setSchedule.mockResolvedValue({ data: {} });
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "Primary");
      await flushPromises();
      deleteConfirm(wrapper)!.vm.$emit("update:cancel");
      await flushPromises();

      expect(service.setSchedule).not.toHaveBeenCalled();
      expect(deleteConfirm(wrapper)!.props("modelValue")).toBe(false);
    });

    /// The point of saving is to see what the engine now says.
    it("refetches the schedule once the editor saves", async () => {
      const wrapper = await openSchedule();
      const before = service.getSchedule.mock.calls.length;

      wrapper.findComponent({ name: "OnCallScheduleEditor" }).vm.$emit("saved");
      await flushPromises();

      expect(service.getSchedule.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe("the escalation tab", () => {
    async function openEscalation() {
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
      await flushPromises();
      return wrapper;
    }

    /// One rail, and the editor only on demand.
    it("shows the ladder, with the editor drawer closed, by default", async () => {
      const wrapper = await openEscalation();

      expect(wrapper.findComponent({ name: "OnCallEscalationLadder" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("open")).toBe(false);
    });

    /// Which priorities share a ladder is a fact about the POLICY — without it
    /// the strip cannot fold, so it must reach the ladder.
    it("hands the policy to the ladder so its chips can fold", async () => {
      const wrapper = await openEscalation();

      expect(wrapper.findComponent({ name: "OnCallEscalationLadder" }).props("policy")).toEqual({
        rungs: [],
      });
    });

    /// The read view is what the edit is checked against, so it stays on
    /// screen behind the drawer rather than being swapped out for it.
    it("opens the editor as a drawer over the read view", async () => {
      const wrapper = await openEscalation();
      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("edit");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("open")).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallEscalationLadder" }).exists()).toBe(true);
    });

    /// The chips are labels ("P3"); the policy's rungs are numbered. Editing
    /// from P3 must open on P3, not send the reader back to find it.
    it("opens the drawer on the priority the ladder is showing", async () => {
      const wrapper = await openEscalation();
      const ladder = wrapper.findComponent({ name: "OnCallEscalationLadder" });
      ladder.vm.$emit("update:selected", "P3");
      await flushPromises();

      ladder.vm.$emit("edit");
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("priority")).toBe(3);
    });

    /// Closing from inside the drawer (× / Escape / Cancel) has to reach the
    /// page state, or the drawer reopens itself on the next render.
    it("closes when the drawer asks to close", async () => {
      const wrapper = await openEscalation();
      const editor = wrapper.findComponent({ name: "OnCallPolicyEditor" });
      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("edit");
      await flushPromises();

      editor.vm.$emit("update:open", false);
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("open")).toBe(false);
    });

    /// The answer depends on who is on call at THIS instant, so switching
    /// priority has to re-ask rather than filter something already fetched.
    it("re-asks the server when the priority changes", async () => {
      const wrapper = await openEscalation();
      const before = service.escalationPreview.mock.calls.length;

      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("update:selected", "P3");
      await flushPromises();

      expect(service.escalationPreview.mock.calls.length).toBeGreaterThan(before);
      expect(service.escalationPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ priority: 3 }),
      );
    });
  });

  /// The banner maps each finding's `kind` to the tab that repairs it and emits
  /// that tab, so the view only has to obey.
  it.each([["policy"], ["schedule"], ["ownership"]])(
    "opens the %s tab the banner asked for",
    async (expectedTab) => {
      const wrapper = render();
      await flushPromises();

      const panels = wrapper.findComponent({ name: "OTabPanels" });
      expect(panels.props("modelValue")).not.toBe(expectedTab);

      wrapper.findComponent({ name: "OnCallTeamAttention" }).vm.$emit("act", expectedTab);
      await flushPromises();

      expect(panels.props("modelValue")).toBe(expectedTab);
    },
  );

  /// A finding that names a rotation ("single_member_rotation") has to open
  /// THAT rotation's own drawer — landing on the bare table again is
  /// indistinguishable from nothing having happened when the reader was
  /// already on the Schedule tab, since `activeTab` would be a no-op write.
  it("opens the named rotation's drawer, not just the schedule tab", async () => {
    service.getSchedule.mockResolvedValue({
      data: { timezone: "UTC", rotations: [rotation("rot_2", "Rotation 2")] },
    } as any);
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OnCallTeamAttention" }).vm.$emit("act", "schedule", "Rotation 2");
    await flushPromises();

    const panels = wrapper.findComponent({ name: "OTabPanels" });
    expect(panels.props("modelValue")).toBe("schedule");
    const editor = wrapper.findComponent({ name: "OnCallScheduleEditor" });
    expect(editor.props("intent")).toEqual({ mode: "edit", id: "rot_2" });
  });

  /// "coverage_gap" findings name no rotation — the hole is in the schedule as
  /// a whole. Landing on the bare table there is the exact "Fill gap did
  /// nothing" bug; the drawer has to open in create mode instead.
  it("opens the drawer in create mode for a finding with no rotation", async () => {
    const wrapper = render();
    await flushPromises();

    wrapper.findComponent({ name: "OnCallTeamAttention" }).vm.$emit("act", "schedule");
    await flushPromises();

    const panels = wrapper.findComponent({ name: "OTabPanels" });
    expect(panels.props("modelValue")).toBe("schedule");
    const editor = wrapper.findComponent({ name: "OnCallScheduleEditor" });
    expect(editor.props("intent")).toEqual({ mode: "new" });
  });

  /// A rotation the schedule fetch never returned (renamed or deleted between
  /// the check and the click) must not crash the page or fling the reader at
  /// a drawer for an id nothing recognises — the tab switch is still the
  /// whole answer.
  it("still switches tabs when the named rotation cannot be found", async () => {
    const wrapper = render();
    await flushPromises();

    wrapper
      .findComponent({ name: "OnCallTeamAttention" })
      .vm.$emit("act", "schedule", "Some Deleted Rotation");
    await flushPromises();

    const panels = wrapper.findComponent({ name: "OTabPanels" });
    expect(panels.props("modelValue")).toBe("schedule");
    const editor = wrapper.findComponent({ name: "OnCallScheduleEditor" });
    expect(editor.props("intent")).toBeFalsy();
  });

  /// The panel and the overview list both read this team's own pages; asking
  /// for the whole org's would count other teams' work as this team's.
  it("asks only for this team's pages", async () => {
    render();
    await flushPromises();

    expect(service.listResponses).toHaveBeenCalledWith(
      expect.objectContaining({ team_id: "team_1", include_resolved: true }),
    );
  });

  /// A failed page fetch costs the activity panel, never the rest of the page.
  it("still renders the team when its pages cannot be loaded", async () => {
    service.listResponses.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OnCallTeamAttention" }).exists()).toBe(true);
  });
  /// B8. With the load failed, the page below would render a team with no
  /// members, no schedule and no policy — indistinguishable from one nobody
  /// configured, on the screen whose job is "would a page land".
  it("renders a failed load as an error page, not an unconfigured team", async () => {
    service.getTeam.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-team-detail-error"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OnCallTeamAttention" }).exists()).toBe(false);
  });
  /// `resolved-schedule` answers for ONE slot and defaults to the default one,
  /// so a two-slot team was only ever asked about primary — and the timeline
  /// drew a secondary lane it could never fill, then said so. The data was
  /// there the whole time; nothing asked for it.
  describe("the resolved timeline", () => {
    /// The timeline owns the visible range and the fetch follows it, so
    /// nothing is asked for until it has said which week it is showing.
    async function showWeek(wrapper: any) {
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .vm.$emit("update:window", { from: 1_000, to: 2_000 });
      await flushPromises();
    }

    /// Every rotation the team has, on one chart, with every cover under it.
    /// The picker that used to scope the tab to one rotation hid lanes on
    /// exactly the teams whose lanes are worth reading against each other —
    /// and a cover list scoped to a rotation the reader had forgotten choosing
    /// looked like a week with no covers in it.
    it("draws every rotation the team has, and every cover with them", async () => {
      service.getSchedule.mockResolvedValue({
        data: {
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_backup", "Backup")],
        },
      } as any);

      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      expect(
        wrapper
          .findComponent({ name: "OnCallScheduleTimeline" })
          .props("rotations")
          .map((r: any) => r.id),
      ).toEqual(["rot_primary", "rot_backup"]);
      expect(wrapper.findComponent({ name: "OnCallCoverList" }).props("rotationId")).toBe(null);
    });

    /// The endpoint resolves ONE rotation per call, so a team with two needs
    /// two — asking once got primary segments only, and every other rotation
    /// was drawn a lane it could never fill.
    it("asks once per rotation", async () => {
      service.getSchedule.mockResolvedValue({
        data: {
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_backup", "Backup")],
        },
      } as any);

      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      const asked = service.resolvedSchedule.mock.calls.map((call: any) => call[0].rotation_id);
      expect(asked).toContain("rot_primary");
      expect(asked).toContain("rot_backup");
    });

    /// The primary may answer without echoing its own id, and a lane keyed on
    /// an absent field matches nothing.
    it("stamps the rotation it asked for onto the segments that come back", async () => {
      service.getSchedule.mockResolvedValue({
        data: { timezone: "UTC", rotations: [rotation("rot_backup", "Backup")] },
      } as any);
      service.resolvedSchedule.mockResolvedValue({
        data: [{ from: 0, to: 1, rotation: "Base", user_email: "ana@o2.ai" }],
      } as any);

      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      const drawn = wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .props("segments") as any[];
      expect(drawn[0].rotation_id).toBe("rot_backup");
    });

    /// **A team with no rotations has no position to be unstaffed.** It answers
    /// `[]` rather than one long gap, so asking at all spends a call to learn
    /// nothing — and the old fallback asked about a "primary" slot that no
    /// longer exists as a keyword.
    it("asks nothing at all when the team has no rotations", async () => {
      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      expect(service.resolvedSchedule).not.toHaveBeenCalled();
      expect(
        wrapper.findComponent({ name: "OnCallScheduleTimeline" }).props("segments"),
      ).toEqual([]);
    });
  });
});
