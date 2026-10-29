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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";

import {
  ERROR_LEDGER,
  WIRE_ACTIONS,
  toAssistantError,
} from "@/composables/assistant/assistantErrors";
import type { AssistantError, AssistantErrorCode } from "@/composables/assistant/pure";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";

import { ASSISTANT_SETUP_DOCS_URL } from "@/components/ai-assistant/common/AssistantErrorDetails.vue";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantTurnOutcome, { type AssistantTurnOutcomeProps } from "./AssistantTurnOutcome.vue";

vi.mock("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue", () => ({
  __esModule: true,
  default: {
    name: "AskAdminStub",
    template: '<div data-test="ask-admin-stub"><slot name="trigger" /></div>',
  },
}));

const error = (code: AssistantErrorCode, over: Partial<AssistantError> = {}): AssistantError => ({
  code,
  ...ERROR_LEDGER[code],
  ...over,
});

function mountOutcome(props: Partial<AssistantTurnOutcomeProps>) {
  return mount(AssistantTurnOutcome, {
    props: {
      kind: "failed",
      role: "admin",
      retrySnapshotAvailable: true,
      org: "acme",
      now: () => 0,
      at: 0,
      ...props,
    },
  });
}

const title = (w: ReturnType<typeof mountOutcome>) =>
  w.get('[data-test="assistant-turn-outcome-title"]').text();
const buttons = (w: ReturnType<typeof mountOutcome>) =>
  w.findAll('[data-test="assistant-turn-outcome-action"]');
const label = (w: ReturnType<typeof mountOutcome>) => buttons(w)[0]?.text();

// `80` §1.3: code → kind, title, admin action label, member action label (null = no button).
const LEDGER: [AssistantErrorCode, "failed" | "refused", string, string | null, string | null][] = [
  ["offline", "refused", "You're offline. Your message wasn't sent.", "Retry", "Retry"],
  [
    "unreachable",
    "refused",
    "Couldn't reach OpenObserve. Your message wasn't sent.",
    "Retry",
    "Retry",
  ],
  ["session_expired", "refused", "Your session expired. Your draft is kept.", "Sign in", "Sign in"],
  [
    "permission_denied",
    "refused",
    "O2 Assistant isn't available to your role.",
    "Open IAM roles",
    "Ask an admin",
  ],
  [
    "not_enabled",
    "refused",
    "O2 Assistant is off for this organization.",
    "Read the setup guide (opens in a new tab)",
    "Ask an admin",
  ],
  [
    "credits_exhausted",
    "refused",
    "AI credits are used up for acme.",
    "Manage paid usage",
    "Ask an admin",
  ],
  [
    "subscription_required",
    "refused",
    "Included AI credits are used up for acme.",
    "View plans",
    "Ask an admin",
  ],
  [
    "consent_declined",
    "refused",
    "Paid usage wasn't enabled. Your message wasn't sent.",
    null,
    null,
  ],
  [
    "authorization_unavailable",
    "refused",
    "Couldn't check AI credits. Your message wasn't sent.",
    "Retry",
    "Retry",
  ],
  [
    "turn_limit",
    "refused",
    "Too many answers are running. Wait for one to finish.",
    "Retry",
    "Retry",
  ],
  [
    "rate_limited",
    "refused",
    "The AI provider is rate-limiting requests. Try again in about a minute.",
    "Retry",
    "Retry",
  ],
  [
    "turn_busy",
    "refused",
    "Another answer is still running in this chat. Your message wasn't sent.",
    "Stop it",
    "Stop it",
  ],
  [
    "already_submitted",
    "refused",
    "This message was already sent. Reload the chat to see its answer.",
    "Reload chat",
    "Reload chat",
  ],
  ["agent_unavailable", "failed", "The assistant service didn't respond.", "Retry", "Retry"],
  ["provider_error", "failed", "The AI provider failed.", "Retry", "Retry"],
  [
    "stream_dropped",
    "failed",
    "Connection lost after 40 s. Nothing was changed.",
    "Retry",
    "Retry",
  ],
  [
    "session_owner_unavailable",
    "failed",
    "The chat moved to another server and couldn't be resumed.",
    "Retry",
    "Retry",
  ],
  [
    "stale_epoch",
    "failed",
    "This chat was reset on the server. Reload to continue.",
    "Reload chat",
    "Reload chat",
  ],
  ["empty_response", "failed", "The assistant didn't answer.", "Retry", "Retry"],
  [
    "signed_out",
    "failed",
    "You signed out in another tab. This answer was stopped.",
    "Sign in",
    "Sign in",
  ],
  ["stream_oversized", "failed", "This answer was too large to display.", "Retry", "Retry"],
  ["unknown", "failed", "Something went wrong.", "Retry", "Retry"],
];

describe("AssistantTurnOutcome", () => {
  it.each(LEDGER)(
    "renders %s with its title and at most one action, by role",
    async (code, kind, text, admin, member) => {
      const asAdmin = mountOutcome({ kind, error: error(code), elapsedMs: 40_000 });
      expect(title(asAdmin)).toBe(text);
      expect(buttons(asAdmin).length).toBe(admin ? 1 : 0);
      if (admin) expect(label(asAdmin)).toBe(admin);
      const asMember = mountOutcome({
        kind,
        error: error(code),
        role: "member",
        elapsedMs: 40_000,
      });
      await flushPromises();
      if (member) expect(label(asMember)).toBe(member);
      expect(asAdmin.attributes("data-code")).toBe(code);
      expect(asAdmin.attributes("data-kind")).toBe(kind);
    },
  );

  it("offers Open in Logs instead on a provider failure with a query, and emits it", async () => {
    const manualRoute = { language: "sql" as const, text: "SELECT 1", stream: "default", org: "o" };
    const wrapper = mountOutcome({ kind: "failed", error: error("provider_error"), manualRoute });
    const manual = wrapper.get('[data-test="assistant-turn-outcome-manual"]');
    expect(manual.text()).toBe("Open in Logs instead");
    await manual.trigger("click");
    expect(wrapper.emitted("manual")?.[0]).toEqual([manualRoute]);
    expect(
      mountOutcome({ kind: "failed", error: error("rate_limited"), manualRoute })
        .find('[data-test="assistant-turn-outcome-manual"]')
        .exists(),
    ).toBe(false);
    expect(
      mountOutcome({ kind: "failed", error: error("provider_error") })
        .find('[data-test="assistant-turn-outcome-manual"]')
        .exists(),
    ).toBe(false);
  });

  it("uses the Calm Signal looks and suppresses the banner's own role (`30` §4.2, `95` §2.3)", () => {
    const failed = mountOutcome({ kind: "failed", error: error("unknown") });
    expect(failed.attributes("role")).toBe("presentation");
    expect(failed.classes().join(" ")).toContain("bg-banner-error-soft-bg");
    const refused = mountOutcome({ kind: "refused", error: error("offline") });
    expect(refused.classes().join(" ")).toContain("bg-banner-info-bg");
    expect(mountOutcome({ kind: "stopped" }).classes().join(" ")).toContain("bg-banner-default-bg");
  });

  it("names the action by the title and says the findings line only when findings exist", () => {
    const bare = mountOutcome({ error: error("provider_error", { reason: "overloaded" }) });
    expect(title(bare)).toBe("The AI provider failed: overloaded.");
    expect(bare.find('[data-test="assistant-turn-outcome-body"]').exists()).toBe(false);
    const titleId = bare.get('[data-test="assistant-turn-outcome-title"]').attributes("id");
    expect(buttons(bare)[0].attributes("aria-describedby")).toBe(titleId);
    const partial = mountOutcome({ error: error("provider_error"), partial: true });
    expect(partial.get('[data-test="assistant-turn-outcome-body"]').text()).toBe(
      "Findings so far are kept above.",
    );
  });

  it("reads Ask again with the undo line after a mutating tool, Edit and resend for an unrecoverable failure", () => {
    const again = mountOutcome({ error: error("agent_unavailable", { action: "ask_again" }) });
    expect(label(again)).toBe("Ask again");
    expect(again.text()).toContain("Retrying won't undo anything already changed.");
    expect(label(mountOutcome({ error: error("provider_error", { action: "edit_resend" }) }))).toBe(
      "Edit and resend",
    );
  });

  it("disables Retry with a reason while offline and once the snapshot is gone (HT-02 AC 7, HT-03 AC 5)", async () => {
    const offline = mountOutcome({ kind: "refused", error: error("offline"), online: false });
    const button = buttons(offline)[0];
    expect(button.attributes("aria-disabled")).toBe("true");
    expect(offline.text()).toContain("Retry when you're back online");
    await button.trigger("click");
    expect(offline.emitted("action")).toBeUndefined();
    const gone = mountOutcome({ error: error("unknown"), retrySnapshotAvailable: false });
    expect(buttons(gone)[0].attributes("aria-disabled")).toBe("true");
  });

  it("disables Continue and Retry while another tab signed out, saying why; Sign in stays", async () => {
    setRuntimeHandle({
      lifecycle: { signedOutElsewhere: computed(() => true), turnLock: () => "signed_out" },
    } as never);
    const stopped = mountOutcome({ kind: "stopped", steps: 3, partial: true });
    expect(buttons(stopped)[0].attributes("aria-disabled")).toBe("true");
    expect(stopped.text()).toContain("You signed out in another tab.");
    await buttons(stopped)[0].trigger("click");
    expect(stopped.emitted("action")).toBeUndefined();
    const failed = mountOutcome({ error: error("unknown") });
    expect(buttons(failed)[0].attributes("aria-disabled")).toBe("true");
    setRuntimeHandle(null);
  });

  it("disables Continue while another tab holds this chat's approval card", () => {
    setRuntimeHandle({
      lifecycle: {
        signedOutElsewhere: computed(() => false),
        turnLock: (sid: string | null) => (sid === "s1" ? "approval_elsewhere" : null),
      },
    } as never);
    const held = mountOutcome({ kind: "stopped", steps: 3, partial: true, sid: "s1" });
    expect(buttons(held)[0].attributes("aria-disabled")).toBe("true");
    expect(held.text()).toContain("Another tab is waiting for your approval on this chat.");
    const free = mountOutcome({ kind: "stopped", steps: 3, partial: true, sid: "s2" });
    expect(buttons(free)[0].attributes("aria-disabled")).toBeUndefined();
    setRuntimeHandle(null);
  });

  it("emits its one action, Continue on a stop and Retry save only in server mode", async () => {
    const stopped = mountOutcome({ kind: "stopped", steps: 3, partial: true });
    expect(title(stopped)).toBe("Stopped after 3 steps · findings kept");
    expect(title(mountOutcome({ kind: "stopped", steps: 3 }))).toBe("Stopped");
    await buttons(stopped)[0].trigger("click");
    expect(stopped.emitted("action")).toEqual([["continue"]]);
    expect(title(mountOutcome({ kind: "stopped", steps: 0 }))).toBe("Stopped");
    expect(buttons(mountOutcome({ kind: "doneNotSaved" }))).toHaveLength(0);
    const saved = mountOutcome({ kind: "doneNotSaved", persistence: true });
    expect(title(saved)).toBe("Answered, but not saved to history.");
    expect(label(saved)).toBe("Retry save");
    expect(buttons(mountOutcome({ kind: "restored" }))).toHaveLength(0);
    expect(
      buttons(mountOutcome({ kind: "cancelledElsewhere", error: error("cancelled_elsewhere") })),
    ).toHaveLength(0);
  });

  it.each([
    ["retry", "Retry"],
    ["sign_in", "Sign in"],
    ["enable_paid_usage", "Manage paid usage"],
    ["manage_billing", "Manage paid usage"],
    ["ask_admin", "Ask an admin"],
    ["reload", "Reload chat"],
    ["none", null],
  ] as const)("labels an unknown code by its wire action %s (`80` §1.5)", async (wire, text) => {
    expect(WIRE_ACTIONS).toContain(wire);
    const unknown = toAssistantError({ status: 500, body: { code: "brand_new", action: wire } });
    expect(unknown.code).toBe("unknown");
    const wrapper = mountOutcome({ error: unknown });
    await flushPromises();
    expect(buttons(wrapper)).toHaveLength(text ? 1 : 0);
    if (text) expect(label(wrapper)).toBe(text);
  });

  it("covers every wire action in the label table", () => {
    expect([...WIRE_ACTIONS].sort()).toEqual([
      "ask_admin",
      "enable_paid_usage",
      "manage_billing",
      "none",
      "reload",
      "retry",
      "sign_in",
    ]);
  });

  it("puts the action before Details in reading and tab order (`30` §4.4, HT-10 AC 5)", () => {
    const wrapper = mountOutcome({ error: error("agent_unavailable") });
    const action = buttons(wrapper)[0].element;
    const details = wrapper.get('[data-test="assistant-error-details"]').element;
    expect(action.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leads settings actions to the setup guide as a labelled new-tab link (HT-02 AC 6)", () => {
    for (const code of ["not_enabled", "data_level_blocked", "permission_denied_tool"] as const) {
      const wrapper = mountOutcome({ kind: "refused", error: error(code) });
      const link = buttons(wrapper)[0];
      expect(link.element.tagName).toBe("A");
      expect(link.attributes()).toMatchObject({
        href: ASSISTANT_SETUP_DOCS_URL,
        target: "_blank",
        rel: "noopener noreferrer",
      });
      expect(link.text()).toBe("Read the setup guide (opens in a new tab)");
    }
  });

  it("claims kept findings only when answer text is visible, never for steps alone", () => {
    const steps = mountOutcome({ error: error("stream_dropped"), steps: 2, elapsedMs: 1_000 });
    expect(steps.find('[data-test="assistant-turn-outcome-body"]').exists()).toBe(false);
  });

  it("drops the minute estimate when the countdown is on the button (`80` §2.4)", () => {
    const timed = mountOutcome({
      kind: "refused",
      error: error("rate_limited", { retryAfterMs: 30_000 }),
    });
    expect(title(timed)).toBe("The AI provider is rate-limiting requests.");
    expect(label(timed)).toBe("Retry in 30 s");
  });

  it("adds the unconfirmed-cancel line with Details to a stop the server did not acknowledge (HT-04 AC 4)", () => {
    const stopped = mountOutcome({ kind: "stopped", cancelUnconfirmed: true });
    expect(stopped.text()).toContain("The server may still be finishing this answer.");
  });

  it("offers Ask an admin through the request flow for a member", async () => {
    const wrapper = mountOutcome({
      kind: "refused",
      error: error("credits_exhausted"),
      role: "member",
    });
    await flushPromises();
    expect(wrapper.find('[data-test="ask-admin-stub"]').exists()).toBe(true);
  });

  it("words a 402 by the overage read: billing in a new tab, contract copy, payer", async () => {
    const plans = [{ path: "/billings/plans", name: "plans", component: {} }];
    const withRouter = (credits: AssistantTurnOutcomeProps["credits"]) =>
      mount(AssistantTurnOutcome, {
        props: {
          kind: "refused",
          role: "admin",
          retrySnapshotAvailable: true,
          org: "acme",
          error: error("credits_exhausted"),
          credits,
        },
        global: { plugins: [fakeRouter(plans)] },
      });
    const eligible = withRouter({ canManage: true, billingStatus: "eligible" });
    const link = eligible.get('[data-test="assistant-turn-outcome-action"]');
    expect(link.attributes("target")).toBe("_blank");
    expect(link.text()).toContain("Manage paid usage");
    expect(eligible.text()).toContain("Included credits don't renew.");
    const contract = withRouter({ canManage: true, billingStatus: "additional_credits_required" });
    const copy = contract.get('[data-test="assistant-turn-outcome-action"]');
    expect(copy.text()).toBe("Copy request");
    await copy.trigger("click");
    expect(contract.emitted("action")).toEqual([["copy_request"]]);
    expect(contract.text()).toContain("Contact your account manager to add credits.");
    const payer = withRouter({ canManage: false, payer: "acme-billing" });
    expect(payer.get('[data-test="assistant-turn-outcome-title"]').text()).toBe(
      "AI credits are used up for acme, billed to acme-billing.",
    );
    expect(payer.text()).toContain("An admin of acme-billing can allow paid usage.");
  });

  it("flips Sign in to Retry once the new-tab sign-in re-probed (`80` §2.3)", () => {
    expect(
      label(mountOutcome({ kind: "refused", error: error("session_expired"), signedIn: true })),
    ).toBe("Retry");
  });

  it("is one line with no button and no Details when readonly (HT-02 AC 11)", () => {
    const wrapper = mountOutcome({ error: error("agent_unavailable"), readonly: true });
    expect(wrapper.text()).toBe("Failed: The assistant service didn't respond.");
    expect(wrapper.find("button").exists()).toBe(false);
  });

  describe("retry_after countdown (`80` §2.4)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("counts down once a second, then enables Retry and asks for one announcement", async () => {
      let now = 0;
      const wrapper = mountOutcome({
        kind: "refused",
        error: error("rate_limited", { retryAfterMs: 42_000 }),
        now: () => now,
      });
      expect(label(wrapper)).toBe("Retry in 42 s");
      expect(buttons(wrapper)[0].attributes("aria-disabled")).toBe("true");
      now = 41_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(label(wrapper)).toBe("Retry in 1 s");
      now = 42_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(label(wrapper)).toBe("Retry");
      expect(wrapper.emitted("retry-ready")).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("says Try again later above ten minutes", () => {
      const wrapper = mountOutcome({
        kind: "refused",
        error: error("rate_limited", { retryAfterMs: 900_000 }),
      });
      expect(label(wrapper)).toBe("Try again later");
    });
  });
});
