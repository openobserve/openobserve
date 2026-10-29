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

import { computed, inject, type ComputedRef } from "vue";
import { useRouter } from "vue-router";

import { assistantEvidenceHostKey, type Sid, type StepFacts } from "@/composables/assistant/pure";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { explorerOf, explorerTarget } from "@/utils/assistant/explorerRoutes";
import { copyToClipboard } from "@/utils/clipboard";

import { revealStep } from "./revealStep";

/** Where a step action was taken, as `ai_evidence_action` names it. */
export type StepActionSurface = "trail" | "query" | "claim";

export interface StepActions {
  /** A shared page or a reader who prefers it follows the link in a new tab. */
  opensElsewhere: ComputedRef<boolean>;
  hrefOf(step: StepFacts): string | undefined;
  open(step: StepFacts, event: MouseEvent): Promise<void>;
  copy(step: StepFacts): Promise<void>;
  showInSteps(step: StepFacts, from: HTMLElement | null): Promise<void>;
}

/** Open, copy and "Show in steps" for one step's query, shared by the trail, the Queries group and the claim peek. */
export function useStepActions(
  sid: () => Sid | null,
  readonly: () => boolean,
  surface: StepActionSurface,
): StepActions {
  const { t } = useI18nTyped();
  const router = useRouter();
  const host = readonly() ? null : inject(assistantEvidenceHostKey, null);
  const opensElsewhere = computed(() => !sid() || !host || host.prefersNewTab());

  function hrefOf(step: StepFacts): string | undefined {
    if (!step.query || !router) return undefined;
    return router.resolve(explorerTarget(step.query, explorerOf(step.query), String(Date.now())))
      .href;
  }

  // A shared page follows the link itself; a live chat opens through the applier, which loads the query and never runs it.
  async function open(step: StepFacts, event: MouseEvent): Promise<void> {
    if (!step.query) return;
    trackAssistant("ai_evidence_action", {
      action: surface === "trail" ? "open_step_logs" : "open_explorer",
      block_kind: surface,
    });
    const current = sid();
    if (!current || !host) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    const result = await host.dispatch(current, {
      kind: "open_in_explorer",
      query: step.query,
      explorer: explorerOf(step.query),
    });
    if (!result.ok && result.reason === "other_org")
      host.announce(current, t("assistant.evidence.otherOrg", { org: raw(step.query.org) }));
  }

  async function copy(step: StepFacts): Promise<void> {
    if (!step.query) return;
    trackAssistant("ai_evidence_action", {
      action: surface === "trail" ? "copy_step_query" : "copy_query",
      block_kind: surface,
    });
    const current = sid();
    if (!current || !host) {
      await copyToClipboard(step.query.text, t, { successMessage: t("assistant.evidence.copied") });
      return;
    }
    const result = await host.dispatch(current, {
      kind: "copy",
      text: step.query.text,
      what: "query",
    });
    host.announce(
      current,
      result.ok ? t("assistant.evidence.copied") : t("assistant.client.copyManually"),
    );
  }

  async function showInSteps(step: StepFacts, from: HTMLElement | null): Promise<void> {
    trackAssistant("ai_evidence_action", { action: "open_claim_step", block_kind: surface });
    const current = sid();
    if (current && host) await host.dispatch(current, { kind: "open_step", callId: step.callId });
    await revealStep(from, step.callId);
  }

  return { opensElsewhere, hrefOf, open, copy, showInSteps };
}
