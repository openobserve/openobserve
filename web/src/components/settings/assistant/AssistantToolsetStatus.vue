<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="flex flex-wrap items-center gap-1" data-test="ai-toolset-status">
    <template v-if="!tagsOnly">
      <OSpinner v-if="testing" size="xs" :aria-label="t('assistant.toolsets.testing')" />
      <OTag
        v-else-if="result"
        :variant="result.ok ? 'success-soft' : 'error-soft'"
        :label="resultLabel"
      />
      <OTag
        v-else-if="health === 'failing' && row.failingSince"
        variant="error-soft"
        :data-test="`ai-toolset-${row.name}-status`"
      >
        <i18n-t keypath="assistant.toolsets.status.failingSince" tag="span">
          <template #when><OTimeCell :value="row.failingSince" mode="relative" /></template>
        </i18n-t>
      </OTag>
      <OTag
        v-else
        :variant="HEALTH_VARIANT[health]"
        :label="t(HEALTH_KEY[health])"
        :data-test="`ai-toolset-${row.name}-status`"
      />
      <span
        v-if="!testing && !result && health === 'failing' && row.lastError"
        class="text-text-secondary text-xs"
        :data-test="`ai-toolset-${row.name}-last-error`"
        >{{ row.lastError }}</span
      >
    </template>
    <OTooltip v-if="clash" :content="t('assistant.toolsets.clashTip', { agent: row.agentName })">
      <OTag
        variant="warning-soft"
        :label="t('assistant.toolsets.clash')"
        tabindex="0"
        :data-test="`ai-toolset-${row.name}-clash`"
      />
    </OTooltip>
    <OTag
      v-if="unguarded"
      variant="warning-soft"
      :label="t('assistant.toolsets.unguarded')"
      :data-test="`ai-toolset-${row.name}-unguarded`"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";

import {
  healthOf,
  runsWithoutApproval,
  type ToolsetHealth,
  type ToolsetRow,
} from "./assistantToolsets";

export interface ToolsetTestOutcome {
  ok: boolean;
  durationMs?: number;
  cause?: I18nText | string;
}

const HEALTH_VARIANT: Record<ToolsetHealth, BadgeVariant> = {
  ok: "success-soft",
  failing: "error-soft",
  never: "default-outline",
  disabled: "default-soft",
};

const HEALTH_KEY: Record<ToolsetHealth, I18nKey> = {
  ok: "assistant.toolsets.status.ok",
  failing: "assistant.toolsets.status.failing",
  never: "assistant.toolsets.status.never",
  disabled: "assistant.toolsets.status.disabled",
};

const props = withDefaults(
  defineProps<{
    row: ToolsetRow;
    testing?: boolean;
    result?: ToolsetTestOutcome;
    clash?: boolean;
    tagsOnly?: boolean;
  }>(),
  { testing: false, result: undefined, clash: false, tagsOnly: false },
);

const { t } = useI18nTyped();

const health = computed(() => healthOf(props.row));
const unguarded = computed(() => runsWithoutApproval(props.row));
const resultLabel = computed(() => {
  const result = props.result!;
  if (result.ok) return t("assistant.toolsets.status.okIn", { ms: result.durationMs ?? 0 });
  return result.cause
    ? t("assistant.toolsets.status.failingNow", { cause: result.cause })
    : t("assistant.toolsets.status.failingNowPlain");
});
</script>
