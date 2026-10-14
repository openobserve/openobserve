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

<script setup lang="ts">
import { computed } from "vue";
import { formatDistanceToNowStrict } from "date-fns";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FirstDataStream } from "@/composables/firstEvent/useFirstDataNotice";

const props = defineProps<{
  stream?: FirstDataStream;
  /** Microseconds; the oldest user stream's created_at, held between the last empty visit and now. */
  arrivedAt?: number;
}>();

const emit = defineEmits<{ open: []; dismiss: [] }>();

const { t } = useI18nTyped();

const when = computed(() =>
  props.arrivedAt
    ? raw(formatDistanceToNowStrict(new Date(props.arrivedAt / 1000), { addSuffix: true }))
    : raw(""),
);
const typeText = computed(() => {
  switch (props.stream?.streamType) {
    case "metrics":
      return t("ingestion.firstDataNotice.typeMetrics");
    case "traces":
      return t("ingestion.firstDataNotice.typeTraces");
    default:
      return t("ingestion.firstDataNotice.typeLogs");
  }
});
const openLabel = computed(() => {
  switch (props.stream?.streamType) {
    case "metrics":
      return t("ingestion.firstEvent.openInMetrics");
    case "traces":
      return t("ingestion.firstEvent.openInTraces");
    default:
      return t("ingestion.firstEvent.openInLogs");
  }
});
</script>

<template>
  <OBanner variant="success" inline-actions dense data-test="first-data-notice">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <OTag
        :label="t('ingestion.firstDataNotice.pill')"
        variant="success"
        icon="check-circle"
        size="sm"
      />
      <i18n-t
        keypath="ingestion.firstDataNotice.text"
        tag="span"
        data-test="first-data-notice-text"
      >
        <template #when
          ><strong>{{ when }}</strong></template
        >
        <template #type>{{ typeText }}</template>
        <template #stream
          ><strong>{{ raw(stream?.name ?? "") }}</strong></template
        >
      </i18n-t>
    </div>
    <template #actions>
      <div class="flex items-center gap-2">
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="first-data-notice-dismiss-btn"
          @click="emit('dismiss')"
        >
          {{ t("ingestion.firstDataNotice.dismiss") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="open-in-new"
          data-test="first-data-notice-open-btn"
          @click="emit('open')"
        >
          {{ openLabel }}
        </OButton>
      </div>
    </template>
  </OBanner>
</template>
