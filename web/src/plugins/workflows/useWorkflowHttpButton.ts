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

import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useOrgId } from "@/composables/query/useOrgId";
import type { I18nKey } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { HttpTriggerState } from "@/services/workflows";
import { workflowHttpTriggerQuery } from "@/services/workflows.queries";
import { workflowHooksEnabled } from "./httpEndpoint";

/** Where a workflow's endpoint stands for the header button. */
export type HttpButtonState = "none" | "off" | "on" | "draft" | "paused";

export interface HttpButtonChip {
  variant: BadgeVariant;
  labelKey: I18nKey;
}

export interface UseWorkflowHttpButtonArgs {
  workflowId: Ref<string>;
  isDraft: Ref<boolean>;
  workflowEnabled: Ref<boolean>;
}

const CHIPS: Record<HttpButtonState, HttpButtonChip | null> = {
  none: null,
  off: { variant: "default-soft", labelKey: "workflow.http.editorButtonOff" },
  on: { variant: "success-soft", labelKey: "workflow.http.editorButtonOn" },
  draft: { variant: "warning-soft", labelKey: "workflow.http.editorButtonOn" },
  paused: { variant: "warning-soft", labelKey: "workflow.http.editorButtonOn" },
};

const TOOLTIPS: Record<HttpButtonState, I18nKey | null> = {
  none: "workflow.http.editorButtonTooltip",
  off: "workflow.http.editorButtonTooltip",
  on: null,
  draft: "workflow.http.editorButtonRefusedDraft",
  paused: "workflow.http.editorButtonRefusedPaused",
};

/** Draft wins over paused, the same order as the panel's status. */
export function httpButtonState(
  data: HttpTriggerState | undefined,
  isDraft: boolean,
  workflowEnabled: boolean,
): HttpButtonState {
  if (!data?.configured) return "none";
  if (!data.enabled) return "off";
  if (isDraft) return "draft";
  if (!workflowEnabled) return "paused";
  return "on";
}

export function httpButtonChip(state: HttpButtonState): HttpButtonChip | null {
  return CHIPS[state];
}

export function httpButtonTooltip(state: HttpButtonState): I18nKey | null {
  return TOOLTIPS[state];
}

/** The header button's gate, chip and tooltip, shared by the editor and the runs page. */
export function useWorkflowHttpButton(args: UseWorkflowHttpButtonArgs) {
  const store = useStore();
  const orgId = useOrgId();
  const visible = computed(() => workflowHooksEnabled(store.state.zoConfig));
  const trigger = useQuery(() =>
    workflowHttpTriggerQuery(orgId.value, visible.value ? args.workflowId.value : ""),
  );
  const state = computed(() =>
    httpButtonState(
      visible.value ? trigger.data.value : undefined,
      args.isDraft.value,
      args.workflowEnabled.value,
    ),
  );
  return {
    visible,
    state,
    endpointOn: computed(() => state.value !== "none" && state.value !== "off"),
    chip: computed(() => httpButtonChip(state.value)),
    tooltipKey: computed(() => httpButtonTooltip(state.value)),
  };
}
