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
  <div class="flex flex-col gap-3 px-3 py-2" data-test="downtime-summary">
    <p class="text-text-body text-sm leading-relaxed" data-test="downtime-summary-sentence">
      {{ sentence }}
    </p>

    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt class="text-text-secondary">{{ t("alerts.downtimes.summaryPane.filedIn") }}</dt>
      <dd class="text-text-body" data-test="downtime-summary-folder">{{ folderLabel }}</dd>
      <template v-if="window">
        <dt class="text-text-secondary">
          {{
            request.schedule.repeat === "none"
              ? t("alerts.downtimes.summaryPane.window")
              : t("alerts.downtimes.summaryPane.nextWindow")
          }}
        </dt>
        <dd class="text-text-body" data-test="downtime-summary-window">
          {{ formatWindow(window, request.schedule.timezone, t) }}
        </dd>
        <template v-if="request.schedule.timezone !== 'UTC'">
          <dt class="text-text-secondary">{{ t("alerts.downtimes.summaryPane.inUtc") }}</dt>
          <dd class="text-text-body" data-test="downtime-summary-window-utc">
            {{ formatWindow(window, "UTC", t) }}
          </dd>
        </template>
      </template>
    </dl>

    <OBanner
      v-if="largeModules.length"
      variant="warning"
      dense
      data-test="downtime-summary-large-match"
      :content="t('alerts.downtimes.summaryPane.largeMatch', { modules: largeModuleNames })"
    />

    <div v-if="needsConfirm" class="flex flex-col gap-1">
      <OFormCheckbox
        name="confirm_all"
        :label="t('alerts.downtimes.summaryPane.confirm')"
        required
        data-test="downtime-summary-confirm"
      />
      <span class="text-text-secondary text-xs">
        {{ t("alerts.downtimes.summaryPane.confirmCaption") }}
      </span>
    </div>

    <div class="flex flex-col gap-1" data-test="downtime-summary-what-happens">
      <span class="text-text-heading text-xs font-semibold">
        {{ t("alerts.downtimes.summaryPane.whatHappens") }}
      </span>
      <ul class="text-text-body flex list-disc flex-col gap-0.5 ps-5 text-xs">
        <li>{{ t("alerts.downtimes.summaryPane.keepRunning") }}</li>
        <li>{{ t("alerts.downtimes.summaryPane.noNotifications") }}</li>
        <li>{{ t("alerts.downtimes.summaryPane.mutedIncidents") }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { DowntimeRequest, TargetModule } from "@/services/downtimes";
import { currentOrNextWindow, formatWindow } from "@/utils/downtimes/schedule";
import { summarySentence } from "@/utils/downtimes/summary";
import { MODULE_LABEL_KEYS, type FolderNameFn } from "@/utils/downtimes/targetSummary";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";

const props = withDefaults(
  defineProps<{
    request: Pick<DowntimeRequest, "condition" | "targets" | "schedule">;
    folderLabel: I18nText;
    folderName?: FolderNameFn;
    /** Modules whose match is more than half of their items. */
    largeModules?: TargetModule[];
    /** A chosen module narrows nothing, so the confirmation tick is required. */
    needsConfirm?: boolean;
  }>(),
  { folderName: undefined, largeModules: () => [], needsConfirm: false },
);

const { t } = useI18nTyped();

const sentence = computed(() => summarySentence(props.request, t, props.folderName));

const window = computed(() => currentOrNextWindow(props.request.schedule, Date.now() * 1000));

const largeModuleNames = computed(() =>
  props.largeModules.map((m) => t(MODULE_LABEL_KEYS[m])).join(", "),
);
</script>
