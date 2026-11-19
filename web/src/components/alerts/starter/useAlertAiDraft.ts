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

import { computed, type ComputedRef } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useAiDraft, type AiDraft } from "@/composables/alerts/useAiDraft";
import { createAlertTestRun, type AlertTestRun } from "@/composables/alerts/useAlertTestRun";
import type { AiDraftIssue } from "@/components/ai-draft/aiDraftEvents";
import { destinationsQuery } from "@/services/alert_destination.queries";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { dayVerdict, type DayVerdict } from "@/utils/alerts/alertTestRun";
import type { EvaluateAlertBody } from "@/utils/alerts/alertEvaluate.types";
import { describeConditionInPlainWords, type ReadBackAlert } from "@/utils/alerts/alertReadBack";
import {
  buildPrefillFromAssistant,
  makeAlertProposalSchema,
  type AlertProposal,
} from "@/utils/alerts/prefill/fromAssistant";

/** The agent tool whose call the pane approves. */
export const CREATE_ALERT_TOOL = "CreateAlert";

export interface AlertAiDraft {
  ai: AiDraft<AlertProposal>;
  /** The proposal's 24 h dry run, run as its check, so the read-back line costs no second request. */
  testRun: AlertTestRun;
  verdict: ComputedRef<DayVerdict | null>;
  condition: ComputedRef<I18nText>;
  /** Who the proposal tells; approving runs it as proposed, so changing it goes through the form. */
  destinations: ComputedRef<string[]>;
  folderId: () => string;
  prefill: () => AlertPrefill | null;
}

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
  });

  const verdict = computed<DayVerdict | null>(() => {
    if (testRun.state.value === "failed") return { state: "failed", reason: testRun.failure.value };
    return testRun.state.value === "ready" && testRun.result.value
      ? dayVerdict(testRun.result.value)
      : null;
  });

  // The payload's flags are booleans where the form's read-back expects strings.
  const condition = computed<I18nText>(() => {
    const proposal = ai.result.value?.draft;
    if (!proposal) return raw("");
    const alert = { ...proposal, is_real_time: String(!!proposal.is_real_time) };
    return describeConditionInPlainWords(alert as unknown as ReadBackAlert, t);
  });

  const destinations = computed(() => ai.result.value?.draft.destinations ?? []);

  const prefill = (): AlertPrefill | null => {
    const proposal = ai.result.value?.draft;
    return proposal ? buildPrefillFromAssistant(proposal, ai.prompt.value) : null;
  };

  return { ai, testRun, verdict, condition, destinations, folderId: folder, prefill };
}
