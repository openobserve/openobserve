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
  <li
    class="border-b-border-default @container/row flex min-w-0 flex-col gap-1 border-b-[0.0625em] px-3 py-2.5 last:border-b-0"
    data-test="home-failed-run"
    :data-run="run.run_id"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @[40rem]/row:flex-nowrap">
      <!-- The error glyph marks the failure; the text stays neutral, red is for firing only (H4) -->
      <span class="flex size-3 shrink-0 items-center justify-center" aria-hidden="true">
        <OIcon :name="assistantGlyph.failed" size="xs" class="text-status-error-text" />
      </span>
      <div
        class="flex min-w-0 flex-1 basis-[calc(100%-2rem)] flex-col gap-0.5 @[40rem]/row:basis-0"
      >
        <OTruncatedText class="text-text-heading min-w-0 text-sm font-medium">{{
          t("home.agent.failedRunTitle", { title })
        }}</OTruncatedText>
        <span class="text-text-secondary text-xs" data-test="home-failed-run-detail">{{
          detail
        }}</span>
      </div>
      <div
        class="flex shrink-0 items-center justify-end gap-2 ps-6 @[40rem]/row:w-36 @[40rem]/row:ps-0"
      >
        <OTag
          variant="default-outline"
          size="xs"
          :label="t('alerts.incidents.rcaRun.state.failed')"
          data-test="home-failed-run-state"
        />
      </div>
      <span
        class="text-text-secondary w-12 shrink-0 text-xs tabular-nums max-md:hidden"
        data-test="home-failed-run-time"
        >{{ time }}</span
      >
      <div
        class="flex shrink-0 items-center justify-end gap-1 ps-6 @[40rem]/row:w-64 @[40rem]/row:ps-0"
      >
        <OButton
          variant="outline"
          size="sm"
          :icon-left="assistantGlyph.regenerate"
          :loading="busy"
          class="max-md:min-h-11"
          data-test="home-failed-run-retry"
          @click="emit('retry', run)"
        >
          {{ t("common.retry") }}
        </OButton>
        <OButton
          variant="ghost-primary"
          size="sm"
          class="max-md:min-h-11"
          data-test="home-failed-run-open"
          @click="emit('open', run)"
        >
          {{ t("home.agent.openIncident") }}
        </OButton>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { runTitle } from "@/components/ai-assistant/history/autoRuns";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { OrgRcaRun } from "@/services/rca_runs_org";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";

const props = withDefaults(defineProps<{ run: OrgRcaRun; timezone: string; busy?: boolean }>(), {
  busy: false,
});

const emit = defineEmits<{ retry: [run: OrgRcaRun]; open: [run: OrgRcaRun] }>();

const { t } = useI18nTyped();

const title = computed(() => runTitle(props.run));
const time = computed(() =>
  raw(
    formatTimestampInTimezone(props.run.ended_at ?? props.run.started_at, "HH:mm", props.timezone),
  ),
);
// The stored error code is the server's own word, so it is shown as is.
const detail = computed(() =>
  props.run.error_code
    ? t("home.agent.failedRunDetail", { code: raw(props.run.error_code) })
    : t("home.agent.autoRun"),
);
</script>
