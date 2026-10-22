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

import { reactive, watch } from "vue";

import { missingOrganizationsOf } from "@/composables/usePaidOverageConsent";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { PaidOverageFeature, PaidOverageStatus } from "@/services/paidOverage";
import { raw, type I18nKey } from "@/types/i18n";

import { runtimeHandle } from "./runtimeHandle";

import type {
  AssistantHint,
  AssistantSession,
  AssistantState,
  ConsentService,
  CreditMode,
  PendingConsent,
  Sid,
} from "./assistantStore.types";

/** After Enable the status is read until it is in effect, at most this many times. */
export const CONSENT_READS = 3;

export const CONSENT_READ_INTERVAL_MS = 500;

/** The resolved line stays this long before the turn is resent, so it is read, not flashed. */
export const RESOLVED_LINE_MS = 1_200;

/** What the card shows of its own progress; the pending consent itself lives on the session. */
export type ConsentCardState =
  "shown" | "submitting" | "error" | "resolved_here" | "resolved_elsewhere";

export interface ConsentView {
  state: ConsentCardState;
  /** `still_required` when the PUTs went through and the status still is not in effect. */
  error?: "failed" | "still_required";
  /** Where a grant it did not make came from: another tab (the hint) or a focus re-read. */
  via?: "tab" | "focus";
}

/** The card's props; the container fills them from the session's pending consent. */
export interface AssistantConsentCardProps {
  sid: Sid;
  orgName: string;
  payerName?: string;
  planType: "direct" | "payer";
  canEnable: boolean;
  variant: "card" | "compact";
  state: ConsentCardState;
}

/** Everything a container binds on `AssistantConsentCard` for one session. */
export interface ConsentCardBinding extends AssistantConsentCardProps {
  orgId: string;
  payerOnly: boolean;
  error?: ConsentView["error"];
  via?: ConsentView["via"];
  promptPreview: string;
}

/** What the consent runtime reads and calls; `runtime.ts` provides it, specs pass fakes. */
export interface ConsentDeps {
  state(): AssistantState;
  /** Re-sends the waiting turn under its own id. */
  send(sid: Sid, turnId: string): Promise<unknown>;
  /** Stop on a waiting turn is a decline: nothing written, the prompt comes back. */
  stop(sid: Sid): Promise<void>;
  /** Ends the waiting turn unsent with its prompt back, with no claim about paid usage. */
  withdraw(sid: Sid): void;
  /** PUTs paid usage on for one organization. */
  enable(org: string, feature: PaidOverageFeature): Promise<unknown>;
  /** A fresh `GET paid_overage`. */
  read(org: string, feature: PaidOverageFeature): Promise<PaidOverageStatus>;
  hints: {
    on<T extends AssistantHint["type"]>(
      type: T,
      handler: (hint: Extract<AssistantHint, { type: T }>) => void,
    ): () => void;
    postFor(userOrgKey: string, hint: AssistantHint): void;
  };
  announce(sid: Sid, key: I18nKey): void;
  currentOrg(): string | null;
  currentUser(): string;
  now(): number;
  delay?(ms: number): Promise<void>;
  onVisible?(cb: () => void): () => void;
}

/** `ConsentService` plus the card's view state and the session surface `usePaidOverageConsent` routes to. */
export interface ConsentRuntime extends ConsentService {
  view(sid: Sid): ConsentView | null;
  /** A non-turn caller's prompt on a session card; settles with the answer. */
  promptFor(
    sid: Sid,
    org: string,
    feature: PaidOverageFeature,
    status: PaidOverageStatus,
  ): Promise<boolean>;
  dispose(): void;
}

/** True where a turn can cost the org money, so cost lines and hints render. */
export function isMeteredCredit(mode: CreditMode | undefined): boolean {
  return mode === "consent_required" || mode === "pay_as_you_go";
}

/** The org's display name for consent copy; the identifier when the selected org is another. */
export function orgDisplayName(
  id: string,
  selected: { identifier?: unknown; label?: unknown } | null | undefined,
): string {
  return selected?.identifier === id && selected?.label ? String(selected.label) : id;
}

/** The built runtime's consent, for the card; `null` before it exists. */
export function assistantConsent(): ConsentRuntime | null {
  return runtimeHandle().value?.consent ?? null;
}

/** The card's bindings for a session's pending consent; `null` when nothing waits. */
export function consentCardFor(
  session: AssistantSession | null,
  orgName: (id: string) => string,
  variant: AssistantConsentCardProps["variant"],
): ConsentCardBinding | null {
  const pending = session?.pendingConsent;
  if (!session || !pending) return null;
  const view = assistantConsent()?.view(session.sid) ?? { state: "shown" as const };
  const { organization, payer } = pending.status;
  const missing = [organization, payer].filter((o) => !!o && !o.enabled);
  return {
    sid: session.sid,
    orgName: orgName(pending.org),
    orgId: pending.org,
    payerName: payer?.org_id ?? "",
    planType: payer ? "payer" : "direct",
    payerOnly: !!payer && !payer.enabled && organization.enabled,
    canEnable: missing.length > 0 && missing.every((o) => o!.can_manage),
    variant,
    state: view.state,
    ...(view.error && { error: view.error }),
    ...(view.via && { via: view.via }),
    promptPreview: pending.snapshot.text,
  };
}

/** Consent as a turn state of the session that asked: one card per session, one grant per org and feature. */
export function createConsentRuntime(deps: ConsentDeps): ConsentRuntime {
  const views = reactive<Record<Sid, ConsentView>>({});
  // Non-turn callers wait on these; a turn's consent resumes the turn instead.
  const callers = new Map<Sid, (accepted: boolean) => void>();
  // An Enable on its way, or a grant whose line still shows before the resend, is never cancelled under it; a cancel asked meanwhile waits for its outcome.
  const submitting = new Set<Sid>();
  const holding = new Set<Sid>();
  const cancelAfter = new Set<Sid>();
  const busy = (sid: Sid) => submitting.has(sid) || holding.has(sid);
  const delay = deps.delay ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const sessionOf = (sid: Sid) => deps.state().sessions[sid] as AssistantSession | undefined;
  const live = (sid: Sid, pending: PendingConsent) => sessionOf(sid)?.pendingConsent === pending;

  const track = (
    step: "shown" | "enabled" | "declined" | "resolved_elsewhere" | "still_required",
    pending: PendingConsent,
  ) =>
    trackAssistant("ai_consent", {
      step,
      surface: "chat",
      org_match: pending.org === deps.currentOrg(),
      plan_type: pending.status.payer ? "payer" : "direct",
    });

  const settle = (sid: Sid, accepted: boolean) => {
    const caller = callers.get(sid);
    if (!caller) return false;
    callers.delete(sid);
    delete views[sid];
    const session = sessionOf(sid);
    if (session) session.pendingConsent = null;
    caller(accepted);
    return true;
  };

  // The note goes where the grant happened: before the resent turn's answer, or after a turn stopped meanwhile.
  const noteGrant = (
    session: AssistantSession,
    pending: PendingConsent,
    org = pending.org,
    by?: string,
  ) => {
    const block = {
      type: "consent_note" as const,
      consentNote: { org, by: by ?? deps.currentUser(), at: deps.now() },
    };
    session.messages.push({
      role: "assistant",
      content: raw(""),
      contentBlocks: [block],
      turnId: pending.turnId,
    });
  };

  const granted = (
    sid: Sid,
    pending: PendingConsent,
    via: "here" | "tab" | "focus",
    status?: PaidOverageStatus,
  ) => {
    const session = sessionOf(sid);
    if (!session || !live(sid, pending)) return;
    views[sid] = via === "here" ? { state: "resolved_here" } : { state: "resolved_elsewhere", via };
    deps.announce(
      sid,
      via === "here"
        ? "assistant.consent.resolvedHere"
        : via === "tab"
          ? "assistant.consent.resolvedElsewhere"
          : "assistant.consent.resolvedElsewhereFocus",
    );
    if (settle(sid, true)) return;
    holding.add(sid);
    void delay(RESOLVED_LINE_MS).then(() => {
      holding.delete(sid);
      // A Stop deferred into the hold ends with it, so it never stops the next card's Enable.
      const stopped = cancelAfter.delete(sid);
      if (!live(sid, pending)) return void delete views[sid];
      // Stopped while the line showed: paid usage is on, so the note says so and the prompt comes back unsent.
      if (stopped) return stopAfterEnable(session, pending, [pending.org]);
      noteGrant(session, pending, pending.org, enabledBy(status));
      void deps.send(sid, pending.turnId).finally(() => {
        if (!sessionOf(sid)?.pendingConsent) delete views[sid];
      });
    });
  };

  // One grant covers every card waiting on the same org and feature in this tab.
  const grantSiblings = (sid: Sid, pending: PendingConsent) => {
    for (const session of Object.values(deps.state().sessions)) {
      const other = session.pendingConsent;
      if (session.sid === sid || !other) continue;
      if (other.org === pending.org && other.feature === pending.feature)
        granted(session.sid, other, "here");
    }
  };

  const readUntilEffective = async (org: string, feature: PaidOverageFeature) => {
    let status = await deps.read(org, feature);
    for (let n = 1; n < CONSENT_READS && !status.effective; n++) {
      await delay(CONSENT_READ_INTERVAL_MS);
      status = await deps.read(org, feature);
    }
    return status;
  };

  // A re-read for a live card only; a cancelled one ignores hints and focus.
  const recheck = (via: "tab" | "focus", org?: string, feature?: PaidOverageFeature) => {
    for (const session of Object.values(deps.state().sessions)) {
      const pending = session.pendingConsent;
      if (!pending || (org && pending.org !== org) || (feature && pending.feature !== feature))
        continue;
      if (views[session.sid]?.state === "submitting") continue;
      void deps
        .read(pending.org, pending.feature)
        .then((status) => {
          if (!status.effective || !live(session.sid, pending)) return;
          track("resolved_elsewhere", pending);
          granted(session.sid, pending, via, status);
        })
        .catch(() => undefined);
    }
  };

  const offs: (() => void)[] = [
    deps.hints.on("consent_granted", (hint) => recheck("tab", hint.org, hint.feature)),
    ...(deps.onVisible ? [deps.onVisible(() => recheck("focus"))] : []),
  ];
  // A chat that is gone (deleted, signed out) answers its caller and drops its card state; watched from the first card, as the store comes later.
  let sessionsWatched = false;
  const watchSessions = () => {
    if (sessionsWatched) return;
    sessionsWatched = true;
    offs.push(
      watch(
        () => Object.keys(deps.state().sessions).join(),
        () => {
          for (const sid of new Set([...callers.keys(), ...Object.keys(views)]))
            if (!sessionOf(sid) && !settle(sid, false)) delete views[sid];
        },
      ),
    );
  };

  const enable = async (
    session: AssistantSession,
    pending: PendingConsent,
    missing: ReturnType<typeof missingOrganizationsOf>,
  ): Promise<{ on: string[]; granted: boolean }> => {
    const sid = session.sid;
    const on: string[] = [];
    try {
      for (const organization of missing) {
        await deps.enable(organization.org_id, pending.feature);
        on.push(organization.org_id);
      }
      const status = await readUntilEffective(pending.org, pending.feature);
      if (!live(sid, pending)) return { on, granted: false };
      if (!status.effective) {
        views[sid] = { state: "error", error: "still_required" };
        return { on, granted: false };
      }
      deps.hints.postFor(session.userOrgKey, {
        v: 1,
        type: "consent_granted",
        org: pending.org,
        feature: pending.feature,
        at: deps.now(),
      });
      track("enabled", pending);
      // A Stop asked while this ran keeps the grant but sends nothing.
      if (!cancelAfter.has(sid)) granted(sid, pending, "here", status);
      grantSiblings(sid, pending);
      return { on, granted: true };
    } catch {
      if (live(sid, pending)) views[sid] = { state: "error", error: "failed" };
      return { on, granted: false };
    }
  };

  // Stopped while Enable ran: what went on stays on and the transcript says so; the message is not sent and comes back.
  const stopAfterEnable = (session: AssistantSession, pending: PendingConsent, on: string[]) => {
    if (!on.length) return runtime.cancel(session.sid, "stopped");
    delete views[session.sid];
    // The turn ends first: its rollback of the unsent prompt must not take the note with it.
    if (!settle(session.sid, true)) deps.withdraw(session.sid);
    for (const org of on) noteGrant(session, pending, org);
  };

  const runtime: ConsentRuntime = {
    onConsentRequired(sid) {
      const pending = sessionOf(sid)?.pendingConsent;
      if (!pending) return;
      watchSessions();
      views[sid] = { state: "shown" };
      track("shown", pending);
    },
    async resolve(sid, accepted, acknowledged) {
      const session = sessionOf(sid);
      const pending = session?.pendingConsent;
      if (!session || !pending) return;
      if (!accepted) {
        if (busy(sid)) return void cancelAfter.add(sid);
        track("declined", pending);
        if (settle(sid, false)) return;
        delete views[sid];
        return deps.stop(sid);
      }
      const missing = missingOrganizationsOf(pending.status);
      // The card's tick and the admin role are checked here too, so no other caller can turn billing on.
      if (!acknowledged || !missing.every((organization) => organization.can_manage)) return;
      if (submitting.has(sid)) return;
      submitting.add(sid);
      views[sid] = { state: "submitting" };
      let on: string[] = [];
      try {
        ({ on } = await enable(session, pending, missing));
      } finally {
        submitting.delete(sid);
        if (cancelAfter.delete(sid) && live(sid, pending)) stopAfterEnable(session, pending, on);
      }
    },
    cancel(sid) {
      if (!sessionOf(sid)?.pendingConsent) return;
      if (busy(sid)) return void cancelAfter.add(sid);
      if (settle(sid, false)) return;
      delete views[sid];
      void deps.stop(sid);
    },
    busy,

    view: (sid) => views[sid] ?? null,
    promptFor(sid, org, feature, status) {
      const session = sessionOf(sid);
      if (!session || session.pendingConsent) return Promise.resolve(false);
      session.pendingConsent = {
        org,
        feature,
        status,
        turnId: "",
        snapshot: { text: "", chips: [], images: [], mentions: [], timeOverride: null },
      };
      watchSessions();
      views[sid] = { state: "shown" };
      track("shown", session.pendingConsent);
      return new Promise((resolve) => callers.set(sid, resolve));
    },
    dispose() {
      offs.forEach((off) => off());
      for (const sid of [...callers.keys()]) settle(sid, false);
    },
  };
  return runtime;
}

/** Closing the container that shows a card cancels it; moving the session between containers does not. */
export function cancelConsentOnClose(
  state: () => AssistantState,
  consent: Pick<ConsentService, "cancel">,
): () => void {
  return watch(
    () => [state().shell.placement.kind, state().shell.activeSid] as const,
    ([kind], [before, sid]) => {
      if (!sid || kind === before || kind !== "hidden") return;
      if (state().sessions[sid]?.pendingConsent) consent.cancel(sid, "container_closed");
    },
  );
}

// The server's record of who allowed it wins over this tab's user once it is sent.
function enabledBy(status: PaidOverageStatus | undefined): string | undefined {
  for (const side of [status?.organization, status?.payer]) {
    const email = side?.enabled_by?.email;
    if (typeof email === "string" && email && email.length <= 200) return email;
  }
  return undefined;
}
