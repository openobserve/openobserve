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

import { ref, watch, type Ref } from "vue";
import { useRoute, useRouter, type LocationQuery } from "vue-router";
import { useStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { alertDetailQuery } from "@/services/alerts.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { gt, raw, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { formatBytes } from "@/utils/formatters";

import type {
  EntryVerb,
  GateCode,
  GateReason,
  ObjectKind,
  OpenAssistantArgs,
} from "./assistantStore.types";
import { useAssistantStore } from "./assistantStore";
import { ASSISTANT_QUERY_KEYS, openAssistant, type OpenAssistantCall } from "./openAssistant";
import { useAssistantCapability } from "./useAssistantCapability";
import { readIncidentReport, type IncidentReportRun } from "./useAssistantClient";

/** What a resolver knows besides the `ref`: the org and zone the prompt is worded in. */
export interface DeepLinkContext {
  org: string;
  timeZone: string;
  verb: EntryVerb;
}

/** Turns a `ref` into the object's prompt and chips; `null` when it does not resolve. */
export type DeepLinkResolver = (
  ref: string,
  ctx: DeepLinkContext,
) => Promise<OpenAssistantArgs["payload"] | null>;

export interface DeepLinkDoorDeps {
  resolvers?: Partial<Record<string, { objectKind: ObjectKind; resolve: DeepLinkResolver }>>;
  open?: (args: OpenAssistantCall) => unknown;
  notify?: (message: I18nText) => void;
  userOrgKey?: () => string | null;
}

// `?assistant=` takes a verb; `open` is the plain "open the assistant" link.
const VERBS: Readonly<Record<string, EntryVerb>> = {
  open: "ask",
  ask: "ask",
  explain: "explain",
  troubleshoot: "troubleshoot",
  fix: "fix",
};

// A ref goes into an API path, so only an id-shaped value is ever resolved.
const REF = /^[A-Za-z0-9_-]{1,64}$/;

// The deep link renders the gate's banner for these; every other gate opens the assistant.
const BLOCKED: ReadonlySet<GateCode> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
  "no_permission",
]);

// The incident's Time chip pads its alert span so the lead-up and the recovery are in range.
const INCIDENT_WINDOW_PAD_MS = 15 * 60_000;

/** The objects a link can name today: alerts, their firings and incidents, resolved by id. */
export const DEEP_LINK_RESOLVERS: NonNullable<DeepLinkDoorDeps["resolvers"]> = {
  alert: { objectKind: "alert", resolve: resolveAlert },
  alert_firing: { objectKind: "alert_firing", resolve: resolveAlertFiring },
  incident: { objectKind: "incident", resolve: resolveIncident },
};

/** Reads `assistant`, `object`, `ref` on a layout route, stages (never sends), and strips the keys. */
export function useDeepLinkDoor(deps: DeepLinkDoorDeps = {}): { blocked: Ref<GateReason | null> } {
  const route = useRoute();
  const router = useRouter();
  const vuex = useStore();
  const capability = useAssistantCapability();
  const blocked = ref<GateReason | null>(null);
  const resolvers = deps.resolvers ?? DEEP_LINK_RESOLVERS;
  const open = deps.open ?? openAssistant;
  const notify = deps.notify ?? ((message: I18nText) => toast({ variant: "default", message }));
  const userOrgKey = deps.userOrgKey ?? (() => useAssistantStore().state.userOrgKey);
  const gateWaiters = new Set<(gate: GateCode) => void>();
  // A newer link supersedes a run still waiting on the gate or the resolver.
  let runToken = 0;

  async function run(query: LocationQuery): Promise<void> {
    if (!query.assistant) return;
    const token = ++runToken;
    const key = userOrgKey();
    const verb = VERBS[String(query.assistant)];
    const object = String(query.object ?? "");
    const id = String(query.ref ?? "");
    await stripKeys(query);
    const gate = await settledGate();
    if (token !== runToken) return;
    if (BLOCKED.has(gate)) {
      blocked.value = gate as GateReason;
      trackAssistant("ai_gate_blocked", { reason: gate as GateReason, cta: "deep_link" });
      return;
    }
    blocked.value = null;
    const entryVerb = verb ?? "ask";
    if (!object) return void open(plainOpen(entryVerb));
    const resolver = resolvers[object];
    const ctx = { org: orgOf(), timeZone: timeZoneOf(), verb: entryVerb };
    const payload =
      resolver && REF.test(id) ? await resolver.resolve(id, ctx).catch(() => null) : null;
    if (token !== runToken) return;
    if (!resolver || !payload) {
      notify(gt("assistant.entry.deepLinkMissing"));
      return void open(plainOpen(entryVerb));
    }
    void open({
      entryKind: "deep_link",
      entryVerb,
      objectKind: resolver.objectKind,
      intent: "stage",
      thread: "new",
      payload,
      ...(key && { userOrgKey: key }),
    });
  }

  function plainOpen(entryVerb: EntryVerb): OpenAssistantCall {
    return {
      entryKind: "deep_link",
      entryVerb,
      objectKind: "none",
      intent: "open",
      thread: "current",
    };
  }

  // The keys never outlive the visit: a reload or a shared URL must not stage again.
  async function stripKeys(query: LocationQuery): Promise<void> {
    const rest = Object.fromEntries(
      Object.entries(query).filter(
        ([key]) => !(ASSISTANT_QUERY_KEYS as readonly string[]).includes(key),
      ),
    );
    await router.replace({ query: rest }).catch(() => undefined);
  }

  function settledGate(): Promise<GateCode> {
    if (capability.gate.value !== "loading") return Promise.resolve(capability.gate.value);
    return new Promise((resolve) => gateWaiters.add(resolve));
  }

  function orgOf(): string {
    return vuex.state.selectedOrganization?.identifier ?? "";
  }

  function timeZoneOf(): string {
    return vuex.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  watch(capability.gate, (gate) => {
    if (gate === "loading") return;
    for (const resolve of gateWaiters) resolve(gate);
    gateWaiters.clear();
  });
  // The banner belongs to the page the link opened; leaving it takes the banner away.
  watch(
    () => route.path,
    () => (blocked.value = null),
  );
  watch(
    () => route.query.assistant,
    (value) => {
      if (value) void run({ ...route.query });
    },
    { immediate: true },
  );

  return { blocked };
}

async function resolveAlert(id: string, ctx: DeepLinkContext) {
  const alert = await queryClient.fetchQuery(alertDetailQuery(ctx.org, id));
  if (!alert) return null;
  const prompts = await import("@/utils/assistant/prompts");
  const input = prompts.alertInputOf({ ...alert, id }, { org: ctx.org, timeZone: ctx.timeZone });
  return prompts.buildAlertPrompt(input, ctx.verb === "explain" ? "explain" : "troubleshoot");
}

async function resolveAlertFiring(id: string, ctx: DeepLinkContext) {
  const alert = await queryClient.fetchQuery(alertDetailQuery(ctx.org, id));
  if (!alert) return null;
  const prompts = await import("@/utils/assistant/prompts");
  const input = prompts.alertInputOf({ ...alert, id }, { org: ctx.org, timeZone: ctx.timeZone });
  if (input.lastFiredAt === undefined) return prompts.buildAlertPrompt(input, "troubleshoot");
  return prompts.buildAlertFiringPrompt({
    ...input,
    firedAt: input.lastFiredAt,
    query: input.condition,
  });
}

async function resolveIncident(id: string, ctx: DeepLinkContext) {
  const read = await readIncidentReport(ctx.org, id);
  if (!read) return null;
  const prompts = await import("@/utils/assistant/prompts");
  const { incident, run } = read;
  const firstMs = Math.floor(incident.first_alert_at / 1000);
  const lastMs = Math.ceil((incident.resolved_at ?? incident.last_alert_at) / 1000);
  return prompts.buildIncidentReportPrompt({
    org: ctx.org,
    incidentId: id,
    title: incident.title ?? "",
    severity: incident.severity,
    status: incident.status,
    ...(run && { runId: run.id, report: run.report, reportLabel: reportLabel(run) }),
    ...(firstMs > 0 && {
      window: {
        from: firstMs - INCIDENT_WINDOW_PAD_MS,
        to: Math.max(firstMs, lastMs) + INCIDENT_WINDOW_PAD_MS,
      },
    }),
  });
}

function reportLabel(run: IncidentReportRun): I18nText {
  // The run label names UTC, as the analysis tab's run selector does.
  const time = formatTimestampInTimezone(run.startedAt, "MMM D, HH:mm", "UTC");
  const name =
    run.number === null
      ? raw(`${time} UTC`)
      : gt("alerts.incidents.rcaRun.runAt", { number: run.number, time });
  return gt("assistant.rca.reportChip", {
    run: name,
    size: raw(formatBytes(new TextEncoder().encode(run.report).length)),
  });
}
