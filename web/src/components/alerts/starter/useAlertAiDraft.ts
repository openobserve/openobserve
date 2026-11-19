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

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useAiDraft, type AiDraft } from "@/composables/alerts/useAiDraft";
import { createAlertTestRun, type AlertTestRun } from "@/composables/alerts/useAlertTestRun";
import type { AiDraftIssue } from "@/components/ai-draft/aiDraftEvents";
import { destinationsQuery } from "@/services/alert_destination.queries";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { getIntlLocale } from "@/locales";
import type { AiConfirmAnswer } from "@/composables/useAiChat";
import { raw, useI18nTyped, type I18nText, type TranslateFn } from "@/types/i18n";
import { dayVerdict, type DayVerdict } from "@/utils/alerts/alertTestRun";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import {
  describeConditionInPlainWords,
  describeQueryAlert,
  type ReadBackAlert,
} from "@/utils/alerts/alertReadBack";
import {
  buildPrefillFromAssistant,
  makeAlertProposalSchema,
  type AlertProposal,
} from "@/utils/alerts/prefill/fromAssistant";

/** The agent tool whose call the pane approves. */
export const CREATE_ALERT_TOOL = "CreateAlert";

// Refusals about Who to tell; the agent keeps the proposal waiting, so the user can fix the list.
const DESTINATION_REFUSALS = new Set([
  "unknown_destinations",
  "invalid_destinations",
  "destinations_unchecked",
]);
const MAX_NAMED = 3;

export interface AlertAiDraft {
  ai: AiDraft<AlertProposal>;
  /** The proposal's 24 h dry run, run as its check, so the read-back line costs no second request. */
  testRun: AlertTestRun;
  verdict: ComputedRef<DayVerdict | null>;
  condition: ComputedRef<I18nText>;
  /** An SQL or PromQL proposal's test, query and schedule; the query decides firing, so it is shown as written. */
  queryReadBack: ComputedRef<ReturnType<typeof describeQueryAlert>>;
  /** Who to tell, seeded from the proposal and editable; Create and Edit in form both use this list. */
  destinations: Ref<string[]>;
  setDestinations: (names: string[]) => void;
  folderId: () => string;
  prefill: () => AlertPrefill | null;
}

interface RefusalDetail {
  code?: unknown;
  unknown?: unknown;
  message?: unknown;
}

// OpenObserve may relay the agent's refusal as a 500 whose message embeds the agent's JSON body.
const refusalDetail = (body: unknown): RefusalDetail | null => {
  const reply = body as { detail?: unknown; message?: unknown } | null;
  if (reply?.detail && typeof reply.detail === "object") return reply.detail as RefusalDetail;
  const message = typeof reply?.message === "string" ? reply.message : "";
  const start = message.indexOf("{");
  if (start < 0) return null;
  try {
    return refusalDetail(JSON.parse(message.slice(start)));
  } catch {
    return null;
  }
};

const nameList = (names: string[], t: TranslateFn): string => {
  const shown = names.length > MAX_NAMED + 1 ? names.slice(0, MAX_NAMED) : names;
  const rest = names.length - shown.length;
  const items = rest ? [...shown, t("alertStarter.whoToTell.more", { count: rest }, rest)] : shown;
  return new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(items);
};

/** Why the agent refused Who to tell and still waits; null for any other failure. */
export const readDestinationRefusal = (
  answer: AiConfirmAnswer,
  t: TranslateFn,
): I18nText | null => {
  const detail = refusalDetail(answer.body);
  if (typeof detail?.code !== "string" || !DESTINATION_REFUSALS.has(detail.code)) return null;
  const unknown = Array.isArray(detail.unknown)
    ? detail.unknown.filter((name): name is string => typeof name === "string" && !!name)
    : [];
  if (detail.code === "unknown_destinations" && unknown.length) {
    return t(
      "alertStarter.ai.unknownDestinations",
      { names: raw(nameList(unknown, t)) },
      unknown.length,
    );
  }
  const said = typeof detail.message === "string" ? detail.message : "";
  return raw(said) || t("alertStarter.ai.destinationsRefused");
};

/** The alert host of the drafting loop, shared by the starter's AI pane and its footer. */
export function useAlertAiDraft(folder: () => string = () => "default"): AlertAiDraft {
  const { t } = useI18nTyped();
  const store = useStore();
  const queryClient = useQueryClient();
  const testRun = createAlertTestRun({ track: false });

  const org = (): string => store.state.selectedOrganization?.identifier ?? "";

  // A destination is never invented: a name the org does not have goes back to the agent.
  const unknownDestinations = async (names: string[]): Promise<AiDraftIssue[]> => {
    if (!names.length) return [];
    const list = (await queryClient.fetchQuery(destinationsQuery(org(), "alert", true))) as Array<{
      name?: string;
    }>;
    const known = new Set(list.map((d) => d?.name));
    return names
      .filter((name) => !known.has(name))
      .map((name) => ({
        path: "destinations",
        message: t("alertStarter.ai.unknownDestination", { name: raw(name) }),
      }));
  };

  const check = async (proposal: AlertProposal, signal: AbortSignal): Promise<AiDraftIssue[]> => {
    const unknown = await unknownDestinations(proposal.destinations ?? []);
    if (unknown.length) return unknown;
    signal.addEventListener("abort", () => testRun.cancel(), { once: true });
    await testRun.run(org(), proposal as unknown as EvaluateAlertBody, t, folder());
    if (testRun.state.value === "failed") return [{ message: testRun.failure.value ?? "" }];
    const verdict = testRun.result.value ? dayVerdict(testRun.result.value) : null;
    return verdict?.state === "failed"
      ? [{ path: "query_condition", message: verdict.reason ?? t("alertStarter.dayTest.failed") }]
      : [];
  };

  const ai = useAiDraft<AlertProposal>({
    kind: "alert",
    tool: CREATE_ALERT_TOOL,
    schema: makeAlertProposalSchema(t),
    check,
    readRefusal: (answer) => readDestinationRefusal(answer, t),
  });

  const verdict = computed<DayVerdict | null>(() => {
    if (testRun.state.value === "failed") return { state: "failed", reason: testRun.failure.value };
    return testRun.state.value === "ready" && testRun.result.value
      ? dayVerdict(testRun.result.value)
      : null;
  });

  // The payload's flags are booleans where the form's read-back expects strings.
  const readBackAlert = computed<ReadBackAlert | null>(() => {
    const proposal = ai.result.value?.draft;
    if (!proposal) return null;
    return {
      ...proposal,
      is_real_time: String(!!proposal.is_real_time),
    } as unknown as ReadBackAlert;
  });
  const condition = computed<I18nText>(() =>
    readBackAlert.value ? describeConditionInPlainWords(readBackAlert.value, t) : raw(""),
  );
  const queryReadBack = computed(() =>
    readBackAlert.value ? describeQueryAlert(readBackAlert.value, t) : null,
  );

  // The check already sent back any name the org lacks, so the seed holds only real destinations.
  const destinations = ref<string[]>([]);
  watch(
    () => ai.result.value,
    (result) => (destinations.value = [...(result?.draft.destinations ?? [])]),
  );
  // A refusal names the list that was sent; a changed list makes it stale.
  watch(destinations, () => (ai.refused.value = null));

  const setDestinations = (names: string[]) => {
    destinations.value = names;
  };

  const prefill = (): AlertPrefill | null => {
    const proposal = ai.result.value?.draft;
    if (!proposal) return null;
    return buildPrefillFromAssistant(
      { ...proposal, destinations: destinations.value },
      ai.prompt.value,
    );
  };

  return {
    ai,
    testRun,
    verdict,
    condition,
    queryReadBack,
    destinations,
    setDestinations,
    folderId: folder,
    prefill,
  };
}
