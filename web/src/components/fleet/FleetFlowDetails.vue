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
  <div
    class="rounded-surface border-border-default bg-surface-base flex max-h-full w-96 flex-col overflow-hidden border shadow-md max-md:max-w-full"
    data-test="fleet-flow-details"
  >
    <div class="border-border-default flex items-start gap-2 border-b px-4 py-3">
      <div class="flex min-w-0 flex-1 flex-col">
        <OText variant="body-strong" truncate>{{ title }}</OText>
        <OText variant="meta">{{
          throughput !== null
            ? t("fleet.flowIssues.throughput", { rate: throughput })
            : restricted
              ? t("fleet.flow.metricsRestricted")
              : t("fleet.flow.noThroughputData")
        }}</OText>
      </div>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        data-test="fleet-flow-details-close"
        @click="emit('close')"
      >
        <OTooltip :content="t('common.close')" />
      </OButton>
    </div>
    <div class="flex min-h-0 flex-col overflow-y-auto">
      <div
        v-for="issue in issues"
        :key="issue.id"
        class="border-border-default flex flex-col gap-1.5 border-b px-4 py-2.5 last:border-b-0"
        :data-test="`fleet-flow-details-issue-${issue.id}`"
      >
        <span class="inline-flex items-center gap-2">
          <span class="h-2 w-2 shrink-0 rounded-full" :class="SEVERITY_DOT[issue.severity]" />
          <span class="text-sm font-medium" :class="SEVERITY_TEXT[issue.severity]">{{
            issue.title
          }}</span>
        </span>
        <span class="text-text-secondary text-xs">{{ issue.evidence }}</span>
        <OButton
          class="self-start"
          variant="outline"
          size="xs"
          :data-test="`fleet-flow-details-action-${issue.id}`"
          @click="emit('action', issue.action)"
        >
          {{ issue.actionLabel }}
        </OButton>
      </div>
      <div v-if="!issues.length" class="text-text-secondary px-4 py-3 text-sm">
        {{ t("fleet.flowIssues.noIssues") }}
      </div>
    </div>
    <div
      v-if="fleetId || !hideConfig"
      class="border-border-default flex items-center gap-2 border-t px-4 py-2.5"
    >
      <OButton
        v-if="fleetId"
        variant="outline"
        size="xs"
        icon-left="folder-open"
        data-test="fleet-flow-details-open-fleet"
        @click="emit('open-fleet')"
      >
        {{ t("fleet.flowIssues.openFleet") }}
      </OButton>
      <OButton
        v-if="!hideConfig"
        variant="outline"
        size="xs"
        icon-left="visibility"
        data-test="fleet-flow-details-open-config"
        @click="emit('open-config')"
      >
        {{ t("fleet.flowIssues.openConfig") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { SEVERITY_DOT, SEVERITY_TEXT, type IssueAction, type PathIssue } from "./flowIssues";

defineProps<{
  title: I18nText;
  throughput: I18nText | null;
  /** The caller may not read the metric streams behind a missing throughput. */
  restricted?: boolean;
  issues: PathIssue[];
  /** Nothing to open, such as for a destination. */
  hideConfig?: boolean;
  /** The fleet behind the selection; a destination has none. */
  fleetId?: string | null;
}>();
const emit = defineEmits<{
  close: [];
  action: [action: IssueAction];
  "open-config": [];
  "open-fleet": [];
}>();

const { t } = useI18nTyped();
</script>
