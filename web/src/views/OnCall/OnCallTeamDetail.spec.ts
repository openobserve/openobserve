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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { ComponentPublicInstance } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import { queryClient } from "@/composables/query/queryClient";
import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import i18n from "@/locales";
import { toast } from "@/lib/feedback/Toast/useToast";
import { destinationKeys } from "@/services/alert_destination.querykeys";
import oncallService from "@/services/oncall";
import { oncallKeys } from "@/services/oncall.querykeys";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import { userKeys } from "@/services/users.querykeys";
import { orgUsersQuery } from "@/services/users.queries";
import { resolveBadge } from "@/lib/core/Badge/badgeGroups";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import { ok } from "@/test/unit/helpers/mockService";
import store from "@/test/unit/helpers/store";
import type { UpcomingShift } from "@/components/oncall/OnCallCoverForm.vue";
import type { ResolvedSegment, Rotation, Unavailability } from "@/ts/interfaces/oncall";
import OnCallTeamDetail from "@/views/OnCall/OnCallTeamDetail.vue";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

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
    testPage: vi.fn(),
    listUnavailability: vi.fn(),
    createUnavailability: vi.fn(),
    deleteUnavailability: vi.fn(),
    getRoutingConfig: vi.fn(),
    setRoutingConfig: vi.fn(),
    coverageGaps: vi.fn(),
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
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
import analytics from "@/services/product_analytics";

const service = vi.mocked(oncallService);

// A selector lookup cannot know the component it lands on, so its props are read by name.
type AnyPropsWrapper = VueWrapper<ComponentPublicInstance<Record<string, unknown>>>;
type Reply<K extends keyof typeof oncallService> = Awaited<ReturnType<(typeof oncallService)[K]>>;
const toasted = vi.mocked(toast);

// The tab strip and the attention banner are what is under test, so they
// render for real; everything they sit beside is a panel with its own spec.
const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    template:
      "<div><slot name='title-trail' /><slot name='actions' /><slot name='actions-overflow' /><slot name='header-tabs' /><slot /></div>",
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
    localStorage.clear();
    vi.clearAllMocks();
    delete routeParams.tab;
    service.getTeam.mockResolvedValue(ok({ id: "team_1", name: "Platform", timezone: "UTC" }));
    service.listMembers.mockResolvedValue(ok([{ user_email: "ana@corp.com" }]));
    service.getSchedule.mockResolvedValue(ok({ rotations: [] }));
    service.getPolicy.mockResolvedValue(ok({ rungs: [] }));
    service.whoIsOnCall.mockResolvedValue(ok([]));
    service.listTeams.mockResolvedValue(ok([]));
    service.listOwnershipRules.mockResolvedValue(ok([]));
    service.listResponses.mockResolvedValue(ok([]));
    service.resolvedSchedule.mockResolvedValue(ok([]));
    service.escalationPreview.mockResolvedValue(ok(null));
    service.teamOverview.mockResolvedValue(ok(null));
    service.teamReachability.mockResolvedValue(ok(null));
    service.teamConfigRisks.mockResolvedValue(ok(null));
    service.teamLoad.mockResolvedValue(ok(null));
    service.listOverrides.mockResolvedValue(ok([]));
    service.listUnavailability.mockResolvedValue(ok([]));
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

  // The e2e roster check reads this chip, so it must carry the roster's own count.
  it("counts the roster on the Members tab", async () => {
    service.listMembers.mockResolvedValue(
      ok([{ user_email: "ana@corp.com" }, { user_email: "bo@corp.com" }]),
    );
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-team-tab-members-count"]').text()).toBe("2");
  });

  /// A team with nobody in it cannot have an overview worth reading, so it
  /// lands where the work is instead.
  it("lands on members while the team is still empty", async () => {
    service.listMembers.mockResolvedValue(ok([]));
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
  /// The heaviest read in the module — thirteen requests for one team — and the
  /// tabs above it send people back and forth all day.
  it("serves a revisit from the cache, and rechecks against the server", async () => {
    const first = render();
    await flushPromises();
    expect(service.getTeam).toHaveBeenCalledTimes(1);
    expect(service.teamOverview).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render();
    await flushPromises();
    expect(service.getTeam).toHaveBeenCalledTimes(1);
    expect(service.teamOverview).toHaveBeenCalledTimes(1);

    // "Recheck" is a reader saying the findings may be out of date, so it is
    // the one path here that must not be answered from what we already hold.
    second.findComponent({ name: "OnCallTeamAttention" }).vm.$emit("recheck");
    await flushPromises();
    expect(service.teamOverview).toHaveBeenCalledTimes(2);
  });

  // A policy written while its channel failed leaves the drawer open, and the page re-reads the ladder behind it.
  it("re-reads the policy when the editor wrote it but stayed open", async () => {
    const wrapper = render();
    await flushPromises();
    wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
    await flushPromises();
    const before = service.getPolicy.mock.calls.length;
    await queryClient.invalidateQueries();

    wrapper.findComponent({ name: "OnCallPolicyEditor" }).vm.$emit("policy-written");
    await flushPromises();

    expect(service.getPolicy.mock.calls.length).toBeGreaterThan(before);
  });

  // S7: the attention banner carries the findings; the header does not repeat them.
  it("keeps the config-risk count out of the header", async () => {
    service.teamConfigRisks.mockResolvedValue(
      ok({ team_id: "team_1", horizon_days: 14, total: 3, risks: [] }),
    );
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-team-config-risks"]').exists()).toBe(false);
  });

  // S6: the strip is told who cannot be reached, from the reachability the page already read.
  it("hands the coverage strip the people a page would not reach", async () => {
    service.teamReachability.mockResolvedValue(
      ok({
        members: [
          { user_email: "ana@corp.com", would_a_page_land: false },
          { user_email: "bob@corp.com", would_a_page_land: true },
        ],
      }),
    );
    const wrapper = render();
    await flushPromises();
    wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "overview");
    await flushPromises();

    expect(wrapper.findComponent({ name: "OnCallCoverageStrip" }).props("unreachable")).toEqual([
      "ana@corp.com",
    ]);
  });

  // S4: a test page is confirmed against who it would reach, then reported by count.
  describe("sending a test page from the ladder", () => {
    beforeEach(() => {
      service.escalationPreview.mockResolvedValue(
        ok({
          priority: "P1",
          pages_anyone: true,
          channels: ["sms", "email", "voice"],
          // Out of delay order on purpose: the server sends to the earliest step, not the first listed.
          rungs: [
            {
              after_micros: 300_000_000,
              targets: [],
              recipients: [{ user_email: "cara@corp.com", deliverable_channels: ["voice"] }],
              resolves_to_nobody: false,
            },
            {
              after_micros: 0,
              targets: [],
              recipients: [
                { user_email: "ana@corp.com", deliverable_channels: ["email", "sms"] },
                { user_email: "bob@corp.com", deliverable_channels: ["email"] },
              ],
              resolves_to_nobody: false,
            },
          ],
        }),
      );
    });

    const DialogStub = {
      name: "ODialog",
      props: ["open", "title"],
      template: "<div v-if='open'><slot /></div>",
    };

    async function ask() {
      const wrapper = mount(OnCallTeamDetail, {
        global: { plugins: [i18n, store], stubs: { ...stubs, ODialog: DialogStub } },
      });
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
      await flushPromises();
      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("send-test");
      await flushPromises();
      const confirm = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((c) => c.props("title") === "Send a test page?")!;
      return { wrapper, confirm };
    }

    // The first step by delay, and only the channels its people can receive, which is what the server sends.
    it("names the recipients and channels before sending anything", async () => {
      const { wrapper, confirm } = await ask();

      expect(confirm.props("open")).toBe(true);
      expect(wrapper.find('[data-test="oncall-team-test-page-message"]').text()).toBe(
        "Send a test page for P1 to ana@corp.com, bob@corp.com? Email, SMS. It does not escalate.",
      );
      // Each name carries its email in a tooltip, because two people can share a name.
      const people = wrapper.findAllComponents({ name: "OnCallPersonName" });
      expect(people.map((one) => one.props("email"))).toEqual(["ana@corp.com", "bob@corp.com"]);
      expect(service.testPage).not.toHaveBeenCalled();
    });

    it("sends the selected priority on confirm and reports how many went out", async () => {
      service.testPage.mockResolvedValue(
        ok({
          reached_anyone: true,
          channels: ["email"],
          attempts: [
            { channel: "email", recipient: "ana@corp.com", reason: "", delivered: true },
            { channel: "sms", recipient: "ana@corp.com", reason: "", delivered: false },
          ],
        }),
      );
      const { confirm } = await ask();
      confirm.vm.$emit("click:primary");
      await flushPromises();

      expect(service.testPage).toHaveBeenCalledWith(expect.objectContaining({ priority: 1 }));
      expect(toasted).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warning", message: "Sent 1 of 2 messages" }),
      );
    });
  });

  describe("the coverage chip", () => {
    function onCall(email: string) {
      service.whoIsOnCall.mockResolvedValue(
        ok([
          {
            rotation_id: "rot_primary",
            rotation_name: "Weekdays",
            rule: "Base",
            user_email: email,
          },
        ]),
      );
    }

    function verdict(email: string, lands: boolean) {
      service.teamReachability.mockResolvedValue(
        ok({
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
        }),
      );
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
      const tag = wrapper
        .findAllComponents({ name: "OTag" })
        .find((one) => one.props("type") === "oncallCoverage")!;
      expect(tag.props("value")).toBe("allunreachable");
      expect(resolveBadge("oncallCoverage", "allunreachable").variant).toBe("error-soft");
    });

    // Green only when every holder can be paged, so the chip agrees with the banner naming the one who cannot.
    it("is not green while one of two people on call cannot be reached", async () => {
      service.whoIsOnCall.mockResolvedValue(
        ok([
          {
            rotation_id: "rot_primary",
            rotation_name: "Primary",
            rule: "Base",
            user_email: "ana@corp.com",
          },
          {
            rotation_id: "rot_secondary",
            rotation_name: "Secondary",
            rule: "Base",
            user_email: "bob@corp.com",
          },
        ]),
      );
      service.teamReachability.mockResolvedValue(
        ok({
          team_id: "team_1",
          smtp_configured: true,
          members: [
            {
              user_email: "ana@corp.com",
              would_a_page_land: false,
              channels: [],
              deliverable_channels: [],
            },
            {
              user_email: "bob@corp.com",
              would_a_page_land: true,
              channels: [],
              deliverable_channels: ["email"],
            },
          ],
          reachable: 1,
          total: 2,
          unreachable_members: ["ana@corp.com"],
        }),
      );
      const wrapper = render();
      await flushPromises();

      expect(chip(wrapper)).toContain("On call but can't be reached");
      const tag = wrapper
        .findAllComponents({ name: "OTag" })
        .find((one) => one.props("type") === "oncallCoverage")!;
      expect(tag.props("value")).toBe("unreachable");
      const tip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((one) => String(one.props("content")).includes("can't be reached"));
      expect(tip!.props("content")).toBe("1 of 2 on call can't be reached");
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
      service.teamReachability.mockResolvedValue(ok(null));
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

    /// The skeleton keeps the tabs out of the DOM until load finishes, so
    /// nothing can attempt a switch that would overwrite the address bar.
    it("does not rewrite the URL before the team has loaded", async () => {
      service.getTeam.mockReturnValue(new Promise<Reply<"getTeam">>(() => {}));
      const wrapper = render();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OTabPanels" }).exists()).toBe(false);
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
      service.listMembers.mockResolvedValue(ok([]));
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
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
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
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .vm.$emit("update:window", { from: 1_000, to: 2_000 });
      await flushPromises();
      const before = service.listOverrides.mock.calls.length;
      expect(before).toBeGreaterThan(0);

      await save(wrapper);
      expect(service.listOverrides.mock.calls.length).toBeGreaterThan(before);
    });

    // The resolved schedule already drops hours outside a rule's active window and the covers on top.
    it("offers swap shifts from the resolved schedule, without gaps or covers", async () => {
      const HOUR = 3_600_000_000;
      const base = Math.floor((Date.now() * 1000) / HOUR) * HOUR;
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_1", "Primary")] }),
      );
      service.resolvedSchedule.mockImplementation(async (args) =>
        ok(
          args.from === base
            ? [
                {
                  rotation_id: "rot_1",
                  from: base,
                  to: base + 8 * HOUR,
                  user_email: "ana@corp.com",
                },
                { rotation_id: "rot_1", from: base + 8 * HOUR, to: base + 24 * HOUR },
                {
                  rotation_id: "rot_1",
                  from: base + 24 * HOUR,
                  to: base + 32 * HOUR,
                  user_email: "bo@corp.com",
                  override_id: "ov_9",
                },
                {
                  rotation_id: "rot_1",
                  from: base + 48 * HOUR,
                  to: base + 56 * HOUR,
                  user_email: "bo@corp.com",
                },
              ]
            : [],
        ),
      );
      const wrapper = render();
      await flushPromises();
      await wrapper.find('[data-test="oncall-team-override-btn"]').trigger("click");
      await flushPromises();

      const shifts = wrapper
        .findComponent({ name: "OnCallCoverForm" })
        .props("shifts") as UpcomingShift[];
      expect(shifts.map((one) => [one.member, one.startMicros, one.endMicros])).toEqual([
        ["ana@corp.com", base, base + 8 * HOUR],
        ["bo@corp.com", base + 48 * HOUR, base + 56 * HOUR],
      ]);
      service.resolvedSchedule.mockReset();
    });

    /// A swap is two covers written back to back, so it invalidates exactly
    /// what one cover invalidates.
    it("re-reads the Covers panel after a swap too", async () => {
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .vm.$emit("update:window", { from: 1_000, to: 2_000 });
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
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
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

    it("names the person by display name in the success toast", async () => {
      queryClient.setQueryData(orgUsersQuery("default").queryKey, [
        { email: "bo@corp.com", first_name: "Bo", last_name: "Lin" },
      ]);
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      await save(wrapper);

      const message = String(toasted.mock.calls.at(-1)?.[0]?.message ?? "");
      expect(message).toMatch(/^Bo Lin covers Platform/);
      queryClient.removeQueries({ queryKey: orgUsersQuery("default").queryKey });
    });

    // B4: the toast says what the dialog's summary said, in the page's own day format.
    it("names whom the cover relieves and on which rotation in the toast", async () => {
      service.getSchedule.mockResolvedValue(
        ok({ rotations: [rotation("rot_primary", "Primary")] }),
      );
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      wrapper
        .findComponent({ name: "OnCallCoverForm" })
        .vm.$emit("save", { ...COVER, covering_for: "ana@corp.com" });
      await flushPromises();

      const message = String(toasted.mock.calls.at(-1)?.[0]?.message ?? "");
      expect(message).toMatch(/^bo@corp\.com covers ana@corp\.com on Primary, .+\.$/);
      expect(message).not.toMatch(/GMT|\d{2}:\d{2}/);
    });

    it("passes covering_for through to the write", async () => {
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      wrapper
        .findComponent({ name: "OnCallCoverForm" })
        .vm.$emit("save", { ...COVER, covering_for: "ana@corp.com" });
      await flushPromises();

      expect(service.createOverride).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ...COVER, covering_for: "ana@corp.com" } }),
      );
    });

    it("tracks oncall_override_created as a cover once it is saved", async () => {
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      await save(wrapper);

      expect(analytics.track).toHaveBeenCalledWith("oncall_override_created", { kind: "cover" });
    });

    it("does not track a refused cover", async () => {
      service.createOverride.mockRejectedValue({ response: { status: 409 } });
      const wrapper = render();
      await flushPromises();
      await save(wrapper);

      expect(analytics.track).not.toHaveBeenCalled();
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
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
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
        .mockResolvedValueOnce(ok({ id: "ov_1" }))
        .mockRejectedValueOnce({ response: { data: { message: "already covered" } } });
      service.deleteOverride.mockResolvedValue(ok(undefined));

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
        .mockResolvedValueOnce(ok({ id: "ov_1" }))
        .mockRejectedValueOnce({ response: { data: { message: "already covered" } } });
      service.deleteOverride.mockResolvedValue(ok(undefined));

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
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));

      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(wrapper.findComponent({ name: "OnCallCoverForm" }).props("open")).toBe(false);
    });

    it("tracks one oncall_override_created swap once both covers are written", async () => {
      service.createOverride.mockResolvedValue(ok({ id: "ov_1" }));
      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(analytics.track).toHaveBeenCalledTimes(1);
      expect(analytics.track).toHaveBeenCalledWith("oncall_override_created", { kind: "swap" });
    });

    it("tracks nothing for a swap that was rolled back", async () => {
      service.createOverride
        .mockResolvedValueOnce(ok({ id: "ov_1" }))
        .mockRejectedValueOnce({ response: { data: { message: "already covered" } } });
      service.deleteOverride.mockResolvedValue(ok(undefined));
      const wrapper = render();
      await flushPromises();
      await swap(wrapper);

      expect(analytics.track).not.toHaveBeenCalled();
    });
  });

  /// The form writes name, timezone and description back together, so it
  /// starts from the server's team, not the copy this page cached.
  it("reads the team from the server before the edit form opens", async () => {
    const wrapper = render();
    await flushPromises();
    const before = service.getTeam.mock.calls.length;

    await wrapper.find('[data-test="oncall-team-detail-edit-btn"]').trigger("click");
    await flushPromises();

    expect(service.getTeam.mock.calls.length).toBe(before + 1);
    expect(wrapper.findComponent({ name: "OnCallTeamForm" }).props("open")).toBe(true);
  });

  /// The header's Edit team is the Teams list's drawer, Default switch included.
  describe("default team switch", () => {
    beforeEach(() => {
      __resetOnCallRoutingConfig();
      service.coverageGaps.mockResolvedValue(ok({ teams: [] }));
      service.setRoutingConfig.mockResolvedValue(ok({}));
    });

    it("offers the switch, locked on while this team is the default", async () => {
      service.getRoutingConfig.mockResolvedValue(
        ok({ org_id: "default", default_team_id: "team_1", updated_at: 0 }),
      );
      const wrapper = render();
      await flushPromises();

      const form = wrapper.findComponent({ name: "OnCallTeamForm" });
      expect(form.props("offerDefault")).toBe(true);
      expect(form.props("isDefault")).toBe(true);
    });

    it("nominates this team when saved with the switch on", async () => {
      service.getRoutingConfig.mockResolvedValue(
        ok({ org_id: "default", default_team_id: "team_2", updated_at: 0 }),
      );
      const wrapper = render();
      await flushPromises();

      const form = wrapper.findComponent({ name: "OnCallTeamForm" });
      expect(form.props("isDefault")).toBe(false);
      form.vm.$emit("saved", "team_1", true);
      await flushPromises();
      expect(service.setRoutingConfig).toHaveBeenCalledWith(
        expect.objectContaining({ data: { default_team_id: "team_1" } }),
      );
    });

    it("leaves the default alone when saved with the switch off", async () => {
      service.getRoutingConfig.mockResolvedValue(
        ok({ org_id: "default", default_team_id: "team_2", updated_at: 0 }),
      );
      const wrapper = render();
      await flushPromises();

      wrapper.findComponent({ name: "OnCallTeamForm" }).vm.$emit("saved", "team_1", false);
      await flushPromises();
      expect(service.setRoutingConfig).not.toHaveBeenCalled();
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
    function deleteConfirm(wrapper: ReturnType<typeof render>) {
      return wrapper.findComponent({ name: "OnCallRemoveRotationDialog" });
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
    // U16: with no rotation there is no first to back up, so the answer bar offers no secondary.
    it("offers Assign secondary only once a rotation exists", async () => {
      const empty = await openSchedule();
      expect(empty.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);

      queryClient.clear();
      service.getSchedule.mockResolvedValue(ok({ rotations: [rotation("rot_p", "Primary")] }));
      const staffed = await openSchedule();
      expect(staffed.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(true);

      // B9: a second rotation off-hours right now is still a secondary; nothing to assign.
      queryClient.clear();
      service.getSchedule.mockResolvedValue(
        ok({ rotations: [rotation("rot_p", "Primary"), rotation("rot_s", "Secondary")] }),
      );
      const two = await openSchedule();
      expect(two.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);
    });

    // D3: the timeline reads the policy to tell a gap a level needs covered from an Off stretch.
    it("hands the timeline the team's policy", async () => {
      const policy = { id: "p", team_id: "team_1", rungs: [] };
      service.getPolicy.mockResolvedValue(ok(policy));
      const wrapper = await openSchedule();

      expect(
        wrapper.findComponent({ name: "OnCallScheduleTimeline" }).props("policy"),
      ).toMatchObject(policy);
    });

    // U15: the away lane's Clear away is the Members tab's delete, then both lanes re-read.
    // B7: an absence holds on every team, so clearing it asks first, naming whose and when.
    it("clears an absence from the timeline after a confirm, and re-reads the lanes", async () => {
      const DAY = 86_400_000_000;
      const away = {
        id: "u1",
        org_id: "default",
        user_email: "ana@corp.com",
        start_at: Date.UTC(2026, 10, 9) * 1000,
        end_at: Date.UTC(2026, 10, 9) * 1000 + 2 * DAY,
        created_by: "ana@corp.com",
        created_at: 0,
      };
      service.listUnavailability.mockResolvedValue(ok([away]));
      service.deleteUnavailability.mockResolvedValue(ok(null));
      service.getSchedule.mockResolvedValue(ok({ rotations: [rotation("rot_p", "Primary")] }));
      const wrapper = await openSchedule();
      const timeline = wrapper.findComponent({ name: "OnCallScheduleTimeline" });
      timeline.vm.$emit("update:window", { from: 1_000, to: away.end_at });
      await flushPromises();
      const absences = service.listUnavailability.mock.calls.length;
      const segments = service.resolvedSchedule.mock.calls.length;

      timeline.vm.$emit("clear-away", "u1");
      await flushPromises();
      expect(service.deleteUnavailability).not.toHaveBeenCalled();
      const confirm = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((c) => c.props("title") === "Clear away")!;
      expect(confirm.props("open")).toBe(true);
      expect(confirm.props("primaryButtonLabel")).toBe("Clear");
      // The dialog body is teleported to the document.
      const message = [...document.querySelectorAll('[data-test="oncall-away-clear-message"]')].at(
        -1,
      );
      expect(message?.textContent?.trim()).toMatch(
        /^Clear ana@corp\.com's away, .+\? It applies on every team\.$/,
      );

      confirm.vm.$emit("click:primary");
      await flushPromises();

      expect(service.deleteUnavailability).toHaveBeenCalledWith(
        expect.objectContaining({ unavailability_id: "u1" }),
      );
      expect(toasted).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: "Absence removed" }),
      );
      expect(service.listUnavailability.mock.calls.length).toBeGreaterThan(absences);
      expect(service.resolvedSchedule.mock.calls.length).toBeGreaterThan(segments);
    });

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

    /// The editor's save writes the whole schedule back, so its draft has to
    /// start from the server's copy: the cached one may be missing a rotation a
    /// colleague added since, and saving over it deletes that rotation.
    it("reads the schedule from the server before the editor opens", async () => {
      const wrapper = await openSchedule();
      const before = service.getSchedule.mock.calls.length;

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("edit", "Primary");
      await flushPromises();

      expect(service.getSchedule.mock.calls.length).toBe(before + 1);
      expect(wrapper.findComponent({ name: "OnCallScheduleEditor" }).props("intent")).toEqual({
        mode: "edit",
        id: "Primary",
      });
    });

    /// U1: the template drawer opens on the lane it was asked from, or on a new rotation from Add rotation.
    it.each([
      { from: "rot_second", startOn: "rot_second" },
      { from: undefined, startOn: "" },
    ])("opens the template drawer on $startOn", async ({ from, startOn }) => {
      service.getSchedule.mockResolvedValue(
        ok({
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_second", "Secondary")],
        }),
      );
      const wrapper = await openSchedule();
      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("presets", from);
      await flushPromises();

      const drawer = wrapper.findComponent({ name: "OnCallSchedulePresets" });
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("startOn")).toBe(startOn);
      expect(drawer.props("rotations").map((r: { id: string }) => r.id)).toEqual([
        "rot_primary",
        "rot_second",
      ]);
    });

    it("deletes from the schedule the server has now, not the cached copy", async () => {
      service.setSchedule.mockResolvedValue(ok({}));
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_primary", "Primary")] }),
      );
      const wrapper = await openSchedule();
      // A colleague added a rotation after this page cached its copy.
      service.getSchedule.mockResolvedValue(
        ok({
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_second", "Secondary")],
        }),
      );

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "rot_primary");
      await flushPromises();
      deleteConfirm(wrapper)!.vm.$emit("confirm");
      await flushPromises();

      const sent = service.setSchedule.mock.calls[0][0];
      expect(sent.data.rotations.map((r) => r.name)).toEqual(["Secondary"]);
    });

    /// Until the lane menu carried it, a rotation could be created and never
    /// removed: the only delete control lived in the bulk table, which
    /// `drawer-only` — the mode this tab has always used — does not render.
    /// The lane emits the rotation's ID; the prompt has to name it. Two
    /// rotations in one team routinely differ by one word, and deleting the
    /// wrong one silently stops paging — but a name cannot key the delete,
    /// because two of them may share it.
    it("deletes a rotation by saving the schedule without it", async () => {
      service.setSchedule.mockResolvedValue(ok({}));
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_primary", "Primary")] }),
      );
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "rot_primary");
      await flushPromises();

      const confirm = deleteConfirm(wrapper);
      // Named in the prompt: two rotations in one team routinely differ by one
      // word, and deleting the wrong one silently stops paging.
      expect(confirm!.props("open")).toBe(true);
      // The title names the rotation; the body says who holds it now, by name.
      expect(document.body.textContent).toContain("Delete the Primary rotation?");
      expect(
        document.body.querySelector('[data-test="oncall-remove-rotation-body"]')?.textContent,
      ).toBe("Nobody is on call in Primary now. Once it's deleted, nobody takes over its shifts.");
      // S11: the dialog reads the policy to say which escalation steps go with it.
      expect(confirm!.props("rotationId")).toBe("rot_primary");
      expect(confirm!.props("policy")).toEqual({ rungs: [] });
      expect(service.setSchedule).not.toHaveBeenCalled();

      confirm!.vm.$emit("confirm");
      await flushPromises();

      const sent = service.setSchedule.mock.calls[0][0];
      expect(sent.data.rotations.map((r) => r.name)).not.toContain("Primary");
    });

    // S11: a hand-edited ladder that pages the rotation is edited first, from the dialog's link.
    it("opens the policy editor when the dialog asks for the policy first", async () => {
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_primary", "Primary")] }),
      );
      const wrapper = await openSchedule();
      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "rot_primary");
      await flushPromises();

      deleteConfirm(wrapper)!.vm.$emit("open-policy");
      await flushPromises();

      expect(deleteConfirm(wrapper)!.props("open")).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("open")).toBe(true);
      expect(service.setSchedule).not.toHaveBeenCalled();
    });

    // The lane menu's delete is a human save too, so what is kept loses the default marker.
    it("clears the default-staffing marker from the rotations a lane delete keeps", async () => {
      service.setSchedule.mockResolvedValue(ok({}));
      service.getSchedule.mockResolvedValue(
        ok({
          timezone: "UTC",
          rotations: [
            { ...rotation("rot_primary", "Primary"), source: "default" },
            { ...rotation("rot_second", "Secondary"), source: "default" },
          ],
        }),
      );
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "rot_second");
      await flushPromises();
      deleteConfirm(wrapper)!.vm.$emit("confirm");
      await flushPromises();

      const sent = service.setSchedule.mock.calls[0][0].data.rotations;
      expect(sent.map((r) => [r.name, r.source])).toEqual([["Primary", undefined]]);
    });

    it("drops the deleted rotation's draft and keeps another rotation's", async () => {
      const scopeFor = (rotationId: string): EditorDraftScope => ({
        kind: "oncall_schedule",
        org: store.state.selectedOrganization.identifier,
        entityId: `team_1/${rotationId}`,
        userEmail: store.state.userInfo.email,
      });
      service.setSchedule.mockResolvedValue(ok({}));
      service.getSchedule.mockResolvedValue(
        ok({
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_backup", "Backup")],
        }),
      );
      writeEditorDraft(scopeFor("rot_primary"), { data: {} });
      writeEditorDraft(scopeFor("rot_backup"), { data: {} });
      // A teammate's duplicate of the deleted rotation in this browser goes with it.
      const othersCopy: EditorDraftScope = {
        ...scopeFor("rot_primary"),
        entityId: null,
        variant: "team_1/clone:rot_primary",
        userEmail: "teammate@x.io",
      };
      writeEditorDraft(othersCopy, { data: {} });
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "rot_primary");
      await flushPromises();
      deleteConfirm(wrapper)!.vm.$emit("confirm");
      await flushPromises();

      expect(readEditorDraft(scopeFor("rot_primary"))).toBeNull();
      expect(readEditorDraft(othersCopy)).toBeNull();
      expect(readEditorDraft(scopeFor("rot_backup"))).not.toBeNull();
    });

    it("opening the editor drops drafts of rotations deleted elsewhere, and keeps the rest", async () => {
      const base = {
        kind: "oncall_schedule" as const,
        org: store.state.selectedOrganization.identifier,
        userEmail: store.state.userInfo.email,
      };
      const gone: EditorDraftScope = { ...base, entityId: "team_1/rot_gone" };
      const live: EditorDraftScope = { ...base, entityId: "team_1/rot_primary" };
      const goneClone: EditorDraftScope = {
        ...base,
        entityId: null,
        variant: "team_1/clone:rot_gone",
      };
      const fresh: EditorDraftScope = { ...base, entityId: null, variant: "team_1/new" };
      for (const scope of [gone, live, goneClone, fresh]) writeEditorDraft(scope, { data: {} });
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_primary", "Primary")] }),
      );
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("edit", "rot_primary");
      await flushPromises();

      expect(readEditorDraft(gone)).toBeNull();
      expect(readEditorDraft(goneClone)).toBeNull();
      expect(readEditorDraft(live)).not.toBeNull();
      expect(readEditorDraft(fresh)).not.toBeNull();
    });

    it("dots the Schedule and Escalation tabs while their drafts exist", async () => {
      const scope = (kind: "oncall_schedule" | "oncall_policy"): EditorDraftScope => ({
        kind,
        org: store.state.selectedOrganization.identifier,
        entityId: "team_1",
        userEmail: store.state.userInfo.email,
      });
      writeEditorDraft(
        { ...scope("oncall_schedule"), entityId: "team_1/rot_primary" },
        { data: {} },
      );
      const wrapper = await openSchedule();

      expect(wrapper.find('[data-test="oncall-team-tab-schedule-draft-dot"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-team-tab-policy-draft-dot"]').exists()).toBe(false);

      writeEditorDraft(scope("oncall_policy"), { data: {} });
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-team-tab-policy-draft-dot"]').exists()).toBe(true);
    });

    /// Nothing is sent until the reader confirms — the dialog is the guard, not
    /// a receipt for a delete that already happened.
    it("leaves the schedule alone when the delete is cancelled", async () => {
      service.setSchedule.mockResolvedValue(ok({}));
      const wrapper = await openSchedule();

      wrapper.findComponent({ name: "OnCallScheduleTimeline" }).vm.$emit("delete", "Primary");
      await flushPromises();
      deleteConfirm(wrapper)!.vm.$emit("update:open", false);
      await flushPromises();

      expect(service.setSchedule).not.toHaveBeenCalled();
      expect(deleteConfirm(wrapper)!.props("open")).toBe(false);
    });

    /// The point of saving is to see what the engine now says. The editor's own
    /// write expires the team's scope before it emits, which is what makes this
    /// page's re-read reach the server without asking it to.
    it("refetches the schedule once the editor saves", async () => {
      const wrapper = await openSchedule();
      const before = service.getSchedule.mock.calls.length;

      await queryClient.invalidateQueries({
        queryKey: [
          "org",
          store.state.selectedOrganization.identifier,
          "oncall",
          "teams",
          routeParams.teamId,
        ],
      });
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

    /// Same rule as the schedule: the save replaces the whole policy, so the
    /// draft starts from the server's copy rather than the page's cached one.
    it("reads the policy from the server before the editor opens", async () => {
      const wrapper = await openEscalation();
      const before = service.getPolicy.mock.calls.length;

      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("edit");
      await flushPromises();

      expect(service.getPolicy.mock.calls.length).toBe(before + 1);
      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("open")).toBe(true);
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

    // The Slack channel card names `/o2 oncall here {team}`.
    it("hands the drawer the team's name", async () => {
      const wrapper = await openEscalation();
      expect(wrapper.findComponent({ name: "OnCallPolicyEditor" }).props("teamName")).toBe(
        "Platform",
      );
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

    /// Going back to a priority already read answers from the cache at once,
    /// so the slower dry run for the one just left lands last — and must not
    /// show its recipients under the other priority's chip.
    it("ignores a slower dry run for a priority the reader has already left", async () => {
      service.escalationPreview.mockResolvedValue(ok({ priority: "P1" }));
      const wrapper = await openEscalation();
      let answerP3: (value: Reply<"escalationPreview">) => void = () => {};
      service.escalationPreview.mockImplementationOnce(
        () => new Promise((resolve) => (answerP3 = resolve)),
      );
      const ladder = wrapper.findComponent({ name: "OnCallEscalationLadder" });

      ladder.vm.$emit("update:selected", "P3");
      await flushPromises();
      ladder.vm.$emit("update:selected", "P1");
      await flushPromises();
      answerP3(ok({ priority: "P3" }));
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallEscalationLadder" }).props("preview")).toEqual({
        priority: "P1",
      });
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
    service.getSchedule.mockResolvedValue(
      ok({ timezone: "UTC", rotations: [rotation("rot_2", "Rotation 2")] }),
    );
    const wrapper = render();
    await flushPromises();

    wrapper
      .findComponent({ name: "OnCallTeamAttention" })
      .vm.$emit("act", "schedule", "Rotation 2");
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

  // On an empty team the reader is already on Members, so switching the tab alone would not react to the click.
  it("focuses the member picker from the attention banner, even when already on Members", async () => {
    const focusMemberPicker = vi.fn();
    service.listMembers.mockResolvedValue(ok([]));
    const wrapper = mount(OnCallTeamDetail, {
      global: {
        plugins: [i18n, store],
        stubs: {
          ...stubs,
          OnCallMembers: {
            name: "OnCallMembers",
            template: "<div />",
            setup(_: unknown, { expose }: { expose: (exposed: object) => void }) {
              expose({ focusMemberPicker });
            },
          },
        },
      },
    });
    await flushPromises();

    const panels = wrapper.findComponent({ name: "OTabPanels" });
    expect(panels.props("modelValue")).toBe("members");

    wrapper.findComponent({ name: "OnCallTeamAttention" }).vm.$emit("act", "members");
    await flushPromises();

    expect(focusMemberPicker).toHaveBeenCalled();
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

  describe("a license denial", () => {
    const DENIAL = {
      response: {
        status: 403,
        data: {
          code: 40001,
          message: "Features not included in your license: oncall",
          error_detail: "oncall",
        },
      },
    };

    function expectLocked(wrapper: ReturnType<typeof render>) {
      const lock = wrapper.findComponent(LicenseDeniedState);
      expect(lock.props("features")).toEqual(["oncall"]);
      expect(lock.attributes("data-test")).toBe("oncall-team-detail-license-denied");
      for (const gone of [
        "oncall-team-detail-error",
        "oncall-team-coverage",
        "oncall-team-refresh",
        "oncall-team-override-btn",
        "oncall-team-detail-edit-btn",
      ]) {
        expect(wrapper.find(`[data-test="${gone}"]`).exists()).toBe(false);
      }
      expect(wrapper.findComponent({ name: "OnCallTeamAttention" }).exists()).toBe(false);
    }

    /// Reads are issued together and some may be answered from cache, so any one can carry the denial.
    it.each([
      "listTeams",
      "getTeam",
      "listMembers",
      "getSchedule",
      "getPolicy",
      "whoIsOnCall",
    ] as const)("replaces the body when %s is denied", async (read) => {
      service[read].mockRejectedValueOnce(DENIAL);
      const wrapper = render();
      await flushPromises();

      expectLocked(wrapper);
    });

    it("replaces a loaded team when a refresh is denied", async () => {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-team-detail-edit-btn"]').exists()).toBe(true);

      service.getTeam.mockRejectedValueOnce(DENIAL);
      await wrapper.find('[data-test="oncall-team-refresh"]').trigger("click");
      await flushPromises();

      expectLocked(wrapper);
    });

    /// These run once the team is on screen, so a cached team can be followed by a denied insight.
    it.each([
      "listOwnershipRules",
      "listResponses",
      "teamOverview",
      "teamReachability",
      "teamConfigRisks",
      "teamLoad",
      "escalationPreview",
      "getRoutingConfig",
    ] as const)("replaces a loaded team when only %s is denied", async (read) => {
      queryClient.clear();
      __resetOnCallRoutingConfig();
      service[read].mockRejectedValueOnce(DENIAL);
      const wrapper = render();
      await flushPromises();

      expectLocked(wrapper);
      expect(toasted).not.toHaveBeenCalled();
    });

    /// Each tab reads for itself after the page settled, so each one can be the first to be refused.
    it.each([
      ["members", "OnCallMembers"],
      ["schedule", "OnCallCoverList"],
      ["schedule", "OnCallSchedulePresets"],
      ["schedule", "OnCallScheduleEditor"],
      ["policy", "OnCallPolicyEditor"],
      ["ownership", "OnCallOwnership"],
    ])("locks when the %s tab's %s reports a denial", async (tab, name) => {
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", tab);
      await flushPromises();

      wrapper.findComponent({ name }).vm.$emit("licenseDenied", ["oncall"]);
      await flushPromises();

      expectLocked(wrapper);
    });

    it("locks, with no error toast, when the read an editor starts from is denied", async () => {
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "policy");
      await flushPromises();

      service.getPolicy.mockRejectedValueOnce(DENIAL);
      wrapper.findComponent({ name: "OnCallEscalationLadder" }).vm.$emit("edit");
      await flushPromises();

      expectLocked(wrapper);
      expect(toasted).not.toHaveBeenCalled();
    });

    it("locks, with no error toast, when the calendar read is denied", async () => {
      service.getSchedule.mockResolvedValue(ok({ rotations: [rotation("rot_a", "Primary")] }));
      service.resolvedSchedule.mockRejectedValueOnce(DENIAL);
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();

      wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .vm.$emit("update:window", { from: 1_000, to: 2_000 });
      await flushPromises();

      expectLocked(wrapper);
      expect(toasted).not.toHaveBeenCalled();
    });

    it("keeps the calendar's error toast for any other failure", async () => {
      service.getSchedule.mockResolvedValue(ok({ rotations: [rotation("rot_a", "Primary")] }));
      service.resolvedSchedule.mockRejectedValueOnce({ response: { status: 500, data: {} } });
      const wrapper = render();
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();

      wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .vm.$emit("update:window", { from: 1_000, to: 2_000 });
      await flushPromises();

      expect(wrapper.findComponent(LicenseDeniedState).exists()).toBe(false);
      expect(toasted).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });
  });

  /// Deleting a team, then hitting the browser's Back button onto its now-gone
  /// detail page, made this exact 404 land on the entry-probe check and render
  /// "On-call isn't available on this deployment" — a build-wide gate — for
  /// what is really just a missing record.
  it("treats a 404 on the team's own id as a deleted team, not a missing feature", async () => {
    service.getTeam.mockRejectedValueOnce({ response: { status: 404 } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-team-detail-not-found"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-team-detail-not-available"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-team-detail-error"]').exists()).toBe(false);
  });

  /// There is no team to edit on "Team not found", including one deleted while the page was open.
  it("offers Edit team only while the team is loaded", async () => {
    service.getTeam.mockRejectedValueOnce({ response: { status: 404 } });
    const missing = render();
    await flushPromises();
    expect(missing.find('[data-test="oncall-team-detail-edit-btn"]').exists()).toBe(false);
    missing.unmount();

    queryClient.clear();
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-team-detail-edit-btn"]').exists()).toBe(true);

    service.getTeam.mockRejectedValueOnce({ response: { status: 404 } });
    await wrapper.find('[data-test="oncall-team-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-team-detail-not-found"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-team-detail-edit-btn"]').exists()).toBe(false);
  });

  /// The org-level team list is the one fetch every on-call build serves
  /// regardless of team id, so only its 404 is a real "feature unavailable" signal.
  it("still shows the unavailable gate when the build has no on-call routes at all", async () => {
    service.listTeams.mockRejectedValueOnce({ response: { status: 404 } });
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-team-detail-not-available"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-team-detail-not-found"]').exists()).toBe(false);
  });

  /// The tabs read only when they mount, so Refresh expires their reads and remounts the open one.
  describe("Refresh and Retry", () => {
    const expiries = [
      { queryKey: oncallKeys.all("default"), exact: false, refetchType: "none" },
      { queryKey: userKeys.users("default"), exact: true, refetchType: "none" },
      {
        queryKey: destinationKeys.list("default", "alert", false, ["jira"]),
        exact: true,
        refetchType: "none",
      },
      { queryKey: serviceStreamKeys.all("default"), exact: false, refetchType: "none" },
    ];
    const pageReads = () => [
      service.getTeam,
      service.listMembers,
      service.getSchedule,
      service.getPolicy,
      service.whoIsOnCall,
      service.listTeams,
      service.listOwnershipRules,
      service.listResponses,
      service.teamOverview,
      service.teamReachability,
      service.teamConfigRisks,
      service.teamLoad,
      service.escalationPreview,
    ];

    it("expires the tabs' reads, forces the page's own, and remounts the open tab", async () => {
      routeParams.tab = "members";
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      const wrapper = render();
      await flushPromises();
      for (const expiry of expiries) expect(spy).not.toHaveBeenCalledWith(expiry);
      for (const read of pageReads()) expect(read).toHaveBeenCalledTimes(1);
      const tabBefore = wrapper.findComponent({ name: "OnCallMembers" }).vm;

      await wrapper.find('[data-test="oncall-team-refresh"]').trigger("click");
      await flushPromises();

      for (const expiry of expiries) expect(spy).toHaveBeenCalledWith(expiry);
      for (const read of pageReads()) expect(read).toHaveBeenCalledTimes(2);
      expect(wrapper.findComponent({ name: "OnCallMembers" }).vm).not.toBe(tabBefore);
      spy.mockRestore();
    });

    it("runs the same refresh from the error state's Retry", async () => {
      service.getTeam.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
      const wrapper = render();
      await flushPromises();
      const spy = vi.spyOn(queryClient, "invalidateQueries");

      (wrapper.findComponent('[data-test="oncall-team-detail-error"]') as AnyPropsWrapper).vm.$emit(
        "action",
      );
      await flushPromises();

      for (const expiry of expiries) expect(spy).toHaveBeenCalledWith(expiry);
      expect(wrapper.find('[data-test="oncall-team-detail-error"]').exists()).toBe(false);
      spy.mockRestore();
    });
  });
  /// `resolved-schedule` answers for ONE slot and defaults to the default one,
  /// so a two-slot team was only ever asked about primary — and the timeline
  /// drew a secondary lane it could never fill, then said so. The data was
  /// there the whole time; nothing asked for it.
  describe("the resolved timeline", () => {
    /// The timeline owns the visible range and the fetch follows it, so
    /// nothing is asked for until it has said which week it is showing.
    async function showWeek(wrapper: ReturnType<typeof render>) {
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
      service.getSchedule.mockResolvedValue(
        ok({
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_backup", "Backup")],
        }),
      );

      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      expect(
        wrapper
          .findComponent({ name: "OnCallScheduleTimeline" })
          .props("rotations")
          .map((r: Rotation) => r.id),
      ).toEqual(["rot_primary", "rot_backup"]);
      expect(wrapper.findComponent({ name: "OnCallCoverList" }).props("rotationId")).toBe(null);
    });

    /// The endpoint resolves ONE rotation per call, so a team with two needs
    /// two — asking once got primary segments only, and every other rotation
    /// was drawn a lane it could never fill.
    it("asks once per rotation", async () => {
      service.getSchedule.mockResolvedValue(
        ok({
          timezone: "UTC",
          rotations: [rotation("rot_primary", "Primary"), rotation("rot_backup", "Backup")],
        }),
      );

      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      const asked = service.resolvedSchedule.mock.calls.map((call) => call[0].rotation_id);
      expect(asked).toContain("rot_primary");
      expect(asked).toContain("rot_backup");
    });

    /// The primary may answer without echoing its own id, and a lane keyed on
    /// an absent field matches nothing.
    it("stamps the rotation it asked for onto the segments that come back", async () => {
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_backup", "Backup")] }),
      );
      service.resolvedSchedule.mockResolvedValue(
        ok([{ from: 0, to: 1, rotation: "Base", user_email: "ana@o2.ai" }]),
      );

      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);

      const drawn = wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .props("segments") as ResolvedSegment[];
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
      expect(wrapper.findComponent({ name: "OnCallScheduleTimeline" }).props("segments")).toEqual(
        [],
      );
    });

    /// Paging back to a week already read answers from the cache at once, so
    /// the slower answer for the week just left lands last — and must not be
    /// drawn on this week's axis.
    it("ignores a slower answer for a window the calendar has already left", async () => {
      service.getSchedule.mockResolvedValue(
        ok({ timezone: "UTC", rotations: [rotation("rot_primary", "Primary")] }),
      );
      const thisWeek = { from: 0, to: 1, rotation: "Primary", user_email: "ana@o2.ai" };
      service.resolvedSchedule.mockResolvedValue(ok([thisWeek]));
      const wrapper = render();
      await flushPromises();
      await showWeek(wrapper);
      let answerNext: (value: Reply<"resolvedSchedule">) => void = () => {};
      service.resolvedSchedule.mockImplementationOnce(
        () => new Promise((resolve) => (answerNext = resolve)),
      );
      const timeline = wrapper.findComponent({ name: "OnCallScheduleTimeline" });

      timeline.vm.$emit("update:window", { from: 2_000, to: 3_000 });
      await flushPromises();
      timeline.vm.$emit("update:window", { from: 1_000, to: 2_000 });
      await flushPromises();
      answerNext(ok([{ ...thisWeek, from: 2_000, to: 3_000 }]));
      await flushPromises();

      const drawn = wrapper
        .findComponent({ name: "OnCallScheduleTimeline" })
        .props("segments") as ResolvedSegment[];
      expect(drawn.map((s) => [s.from, s.to])).toEqual([[0, 1]]);
    });
  });

  describe("acting on a shift bar", () => {
    const WEEK = 604_800_000_000;
    const DAY_MICROS = 86_400_000_000;
    const DialogStub = {
      name: "ODialog",
      props: ["open"],
      template: "<div v-if='open'><slot /><slot name='footer' /></div>",
    };

    async function onSchedule(extraStubs: Record<string, unknown> = {}) {
      service.getSchedule.mockResolvedValue(ok({ rotations: [rotation("rot_1", "Primary")] }));
      service.listMembers.mockResolvedValue(
        ok([{ user_email: "ana@o2.ai" }, { user_email: "bo@o2.ai" }]),
      );
      const wrapper = mount(OnCallTeamDetail, {
        global: { plugins: [i18n, store], stubs: { ...stubs, ...extraStubs } },
      });
      await flushPromises();
      wrapper.findComponent({ name: "OTabPanels" }).vm.$emit("update:modelValue", "schedule");
      await flushPromises();
      const timeline = wrapper.findComponent({ name: "OnCallScheduleTimeline" });
      timeline.vm.$emit("update:window", { from: 1_000, to: 3 * WEEK });
      await flushPromises();
      return { wrapper, timeline };
    }

    const future = (over: Record<string, unknown> = {}) => {
      const from = Date.now() * 1000 + 3_600_000_000;
      return { rotation_id: "rot_1", from, to: from + WEEK, user_email: "ana@o2.ai", ...over };
    };

    it("opens the cover dialog on that shift's rotation, holder and window", async () => {
      const { wrapper, timeline } = await onSchedule();
      const segment = future();
      timeline.vm.$emit("shift-action", "cover", segment);
      await flushPromises();

      const cover = wrapper.findComponent({ name: "OnCallCoverForm" });
      expect(cover.props("open")).toBe(true);
      expect(cover.props("gap")).toEqual({ from: segment.from, to: segment.to });
      expect(cover.props("defaultRotation")).toBe("rot_1");
      expect(cover.props("defaultMode")).toBe("cover");
      expect(cover.props("currentHolder")).toBe("ana@o2.ai");
    });

    /// A cover over hours that are gone pages nobody, so a running shift is covered from now.
    it("starts a running shift's cover at now, not at the shift's start", async () => {
      const { wrapper, timeline } = await onSchedule();
      const before = Date.now() * 1000;
      timeline.vm.$emit("shift-action", "cover", future({ from: 0 }));
      await flushPromises();

      const gap = wrapper.findComponent({ name: "OnCallCoverForm" }).props("gap");
      expect(gap.from).toBeGreaterThanOrEqual(before);
    });

    it("sends the team's own people's absences to the timeline, and nobody else's", async () => {
      const absence = (email: string) => ({
        id: email,
        org_id: "default",
        user_email: email,
        start_at: 2_000,
        end_at: 3_000,
        created_by: email,
        created_at: 0,
      });
      service.listUnavailability.mockResolvedValue(
        ok([absence("ana@o2.ai"), absence("stranger@o2.ai")]),
      );
      const { timeline } = await onSchedule();

      expect(service.listUnavailability).toHaveBeenCalledWith(
        expect.objectContaining({ from: 1_000, to: 3 * WEEK }),
      );
      expect(timeline.props("absences").map((a: Unavailability) => a.user_email)).toEqual([
        "ana@o2.ai",
      ]);
    });

    /// The real form, not a stub: a shift far beyond the next few still opens the swap on itself.
    it("opens the real cover form on Swap with a far-off clicked shift chosen", async () => {
      const { wrapper, timeline } = await onSchedule({
        OnCallCoverForm: false,
        ODialog: DialogStub,
      });
      expect(timeline.props("swapRotations")).toEqual(["rot_1"]);
      const far = future({ from: Date.now() * 1000 + 15 * DAY_MICROS });
      far.to = far.from + DAY_MICROS;
      const next = { ...far, from: far.to, to: far.to + DAY_MICROS, user_email: "bo@o2.ai" };
      service.resolvedSchedule.mockImplementation(async (args) =>
        ok(args.from === far.from ? [far, next] : []),
      );

      timeline.vm.$emit("shift-action", "swap", far);
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-swap-form"]').exists()).toBe(true);
      const first = wrapper.findComponent('[data-test="oncall-swap-a"]') as AnyPropsWrapper;
      expect(first.props("modelValue")).toBe(`rot_1:${far.from}`);
      const options = first.props("options") as { value: string; label: string }[];
      expect(options.map((one) => one.value)).toEqual([`rot_1:${far.from}`, `rot_1:${next.from}`]);
      expect(String(options[0].label)).toMatch(/\d{2}:\d{2}/);
      service.resolvedSchedule.mockReset();
      service.resolvedSchedule.mockResolvedValue(ok([]));
    });

    /// The calendar's read stops at its window, so a band touching the edge is a cut, not the shift's end.
    it.each([
      ["week", 7],
      ["day", 1],
    ])("covers a shift cut at the %s view's edge until its real end", async (_view, days) => {
      const { wrapper, timeline } = await onSchedule();
      const now = Date.now() * 1000;
      const windowTo = now + days * DAY_MICROS;
      timeline.vm.$emit("update:window", { from: now - DAY_MICROS, to: windowTo });
      await flushPromises();
      const drawn = future({ to: windowTo });
      const realEnd = drawn.from + 7 * DAY_MICROS;
      service.resolvedSchedule.mockImplementation(async (args) =>
        ok(args.from === drawn.from ? [{ ...drawn, to: realEnd }] : []),
      );

      timeline.vm.$emit("shift-action", "cover", drawn);
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallCoverForm" }).props("gap")).toEqual({
        from: drawn.from,
        to: realEnd,
      });
      service.resolvedSchedule.mockReset();
      service.resolvedSchedule.mockResolvedValue(ok([]));
    });

    it("hands the cover form the clicked shift's holder and everyone on call now", async () => {
      service.whoIsOnCall.mockResolvedValue(
        ok([
          { rotation_id: "rot_1", rotation_name: "Primary", rule: "Base", user_email: "bo@o2.ai" },
        ]),
      );
      const { wrapper, timeline } = await onSchedule();
      timeline.vm.$emit("shift-action", "cover", future());
      await flushPromises();
      const cover = wrapper.findComponent({ name: "OnCallCoverForm" });
      expect(cover.props("currentHolder")).toBe("ana@o2.ai");
      expect(cover.props("positions")).toMatchObject([{ user_email: "bo@o2.ai" }]);

      await wrapper.find('[data-test="oncall-team-override-btn"]').trigger("click");
      await flushPromises();
      expect(cover.props("currentHolder")).toBe(null);
    });

    /// The real away dialog: opened on the shift's person and window, and saved against them.
    it("marks the shift's person away for that shift's window", async () => {
      service.createUnavailability.mockResolvedValue(ok({}));
      const { wrapper, timeline } = await onSchedule({
        ODialog: DialogStub,
        OFormDateTimeRange: { name: "OFormDateTimeRange", template: "<span />" },
      });
      const segment = future({ user_email: "bo@o2.ai" });
      const readsBefore = service.resolvedSchedule.mock.calls.length;

      timeline.vm.$emit("shift-action", "away", segment);
      await flushPromises();
      const away = wrapper
        .findAllComponents({ name: "OForm" })
        .find((form) => form.attributes("id") === "oncall-away-form")!;
      await (
        away.vm as unknown as { form: { handleSubmit: () => Promise<void> } }
      ).form.handleSubmit();
      await flushPromises();

      const sent = service.createUnavailability.mock.calls[0][0].data;
      expect(sent.user_email).toBe("bo@o2.ai");
      // The range control holds the instants themselves, so the shift's window goes through untouched.
      expect(sent.start_at).toBe(segment.from);
      expect(sent.end_at).toBe(segment.to);
      expect(service.resolvedSchedule.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });

  describe("the header", () => {
    const headerStubs = {
      ...stubs,
      OPageLayout: {
        name: "OPageLayout",
        props: { tabsBelow: Boolean },
        template:
          "<div><slot name='title-trail' /><div data-test='header-actions-slot'><slot name='actions' /></div><div data-test='header-overflow-slot'><slot name='actions-overflow' /></div><div data-test='header-tabs-slot'><slot name='header-tabs' /></div><slot /></div>",
      },
    };
    const mountHeader = () =>
      mount(OnCallTeamDetail, { global: { plugins: [i18n, store], stubs: headerStubs } });
    const rung = (priority: string, pagesAnyone: boolean) => ({
      priority,
      rungs: pagesAnyone ? 1 : 0,
      pages_anyone: pagesAnyone,
      ends_with_whole_team: false,
      channels: [],
    });

    // On a phone the overflow folds behind one menu, so only refresh competes with the team name.
    it("keeps refresh as the header action and puts Cover and Edit in the overflow", async () => {
      const wrapper = mountHeader();
      await flushPromises();

      const actions = wrapper.find('[data-test="header-actions-slot"]');
      const overflow = wrapper.find('[data-test="header-overflow-slot"]');
      expect(actions.find('[data-test="oncall-team-refresh"]').exists()).toBe(true);
      expect(actions.find('[data-test="oncall-team-detail-edit-btn"]').exists()).toBe(false);
      expect(overflow.find('[data-test="oncall-team-detail-edit-btn"]').exists()).toBe(true);
    });

    /// Same header as the Incident page: tabs attached below the title, grey tallies.
    it("attaches tabs with icons to the header, with neutral counts", async () => {
      const wrapper = mountHeader();
      await flushPromises();

      expect(wrapper.findComponent({ name: "OPageLayout" }).props("tabsBelow")).toBe(true);
      expect(
        wrapper.find('[data-test="header-tabs-slot"] [data-test="oncall-team-tabs"]').exists(),
      ).toBe(true);
      // The header draws the one line under the tabs, so the strip draws none of its own.
      expect(wrapper.findComponent({ name: "OTabs" }).props("bordered")).toBe(false);
      // Every tab keeps its icon, so the strip reads like the rest of the app.
      expect(
        wrapper
          .findAllComponents({ name: "OTab" })
          .map((tab) => tab.findComponent({ name: "OIcon" }).exists()),
      ).toEqual([true, true, true, true, true]);
      const members = wrapper.find('[data-test="oncall-team-tab-members"]');
      expect(members.findComponent({ name: "OTag" }).props("value")).toBe("neutral");
    });

    /// P4–P5 paging nobody is the default; only a silent P1–P3 earns the warning.
    it("warns on the Escalation tab only when a P1–P3 pages nobody", async () => {
      queryClient.clear();
      service.teamOverview.mockResolvedValue(
        ok({ rungs: [rung("P1", true), rung("P4", false), rung("P5", false)] }),
      );
      const quiet = mountHeader();
      await flushPromises();
      expect(quiet.find('[data-test="oncall-team-tab-policy-warning"]').exists()).toBe(false);

      service.teamOverview.mockResolvedValue(
        ok({ rungs: [rung("P1", true), rung("P2", false), rung("P4", false)] }),
      );
      queryClient.clear();
      const loud = mountHeader();
      await flushPromises();
      const warning = loud.find('[data-test="oncall-team-tab-policy-warning"]');
      expect(warning.exists()).toBe(true);
      expect(warning.findComponent({ name: "OTooltip" }).props("content")).toBe(
        "1 priority from P1–P3 pages nobody",
      );
    });
  });

  /// The card shows three; its link must land on this team's pages, not the whole org's.
  it("opens the Pages list filtered to this team from the Recent pages card", async () => {
    const opened = Date.now() * 1000;
    service.listResponses.mockResolvedValue(
      ok(
        Array.from({ length: 5 }, (_, i) => ({
          id: `r${i}`,
          opened_at: opened - i,
          subject: { source_id: `a${i}` },
          state: "open",
          priority: 1,
        })),
      ),
    );
    const wrapper = render();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-recent-pages-window"]').text()).toBe(
      "3 of 5 in the last 7 days",
    );
    await wrapper.find('[data-test="oncall-recent-pages-view-all"]').trigger("click");
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallResponses" }));
    expect(useListViewState("oncall-responses", { teamFilter: "all" }).teamFilter).toBe("team_1");
    resetListViewState("oncall-responses");
  });

  it("counts the same routing rules in the header as the Routing tab lists", async () => {
    service.listOwnershipRules.mockResolvedValue(ok([{ id: "r1" }, { id: "r2" }]));
    service.teamOverview.mockResolvedValue(ok({ alerts_assigned: 0, members: 1 }));
    routeParams.tab = "routing";
    const wrapper = mount(OnCallTeamDetail, {
      global: {
        plugins: [i18n, store],
        stubs: {
          ...stubs,
          OPageLayout: {
            name: "OPageLayout",
            props: ["subtitle"],
            template: "<div><span class='sub'>{{ subtitle }}</span><slot /></div>",
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.find(".sub").text()).toContain("owns 2 routing rules");

    wrapper.findComponent({ name: "OnCallOwnership" }).vm.$emit("rules-loaded", 3);
    await flushPromises();
    expect(wrapper.find(".sub").text()).toContain("owns 3 routing rules");
  });
});
