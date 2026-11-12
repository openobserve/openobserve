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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { formatTimestampInTimezone } from "@/utils/date";
import {
  ANNOTATION_PREVIEW_ROW_LIMIT,
  type AnnotationPreviewRow,
  type AnnotationPreviewSummary,
} from "@/utils/dashboard/annotationSources";

const props = defineProps<{
  summary: AnnotationPreviewSummary | null;
  error: string;
  endTimeField: string;
  timezone: string;
}>();

const { t } = useI18nTyped();

const TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

const formatTime = (us: number | null) =>
  us === null ? "—" : formatTimestampInTimezone(us, TIME_FORMAT, props.timezone);

const tableRows = computed(() =>
  (props.summary?.rows ?? []).map((row, index) => ({ ...row, key: String(index) })),
);

const columns = computed<OTableColumnDef<AnnotationPreviewRow>[]>(() => [
  {
    id: "time",
    header: t("dashboard.annotationSources.previewTime"),
    accessorFn: (row) => formatTime(row.time),
    size: 170,
  },
  {
    id: "title",
    header: t("dashboard.annotationSources.markerTitle"),
    accessorKey: "title",
    size: 200,
    meta: { autoWidth: true },
  },
  {
    id: "description",
    header: t("dashboard.annotationSources.markerDescription"),
    accessorKey: "description",
    size: 220,
  },
  ...(props.endTimeField
    ? [
        {
          id: "end",
          header: t("dashboard.annotationSources.previewEnd"),
          accessorFn: (row: AnnotationPreviewRow) => formatTime(row.end),
          size: 170,
        },
      ]
    : []),
]);

const flags = computed<I18nText[]>(() => {
  const summary = props.summary;
  if (!summary) return [];
  const result: I18nText[] = [];
  if (summary.timestampMissing) result.push(t("dashboard.annotationSources.timestampMissing"));
  else if (!summary.rows.length) result.push(t("dashboard.annotationSources.noRowsInRange"));
  result.push(
    ...summary.missingFields.map((field) =>
      t("dashboard.annotationSources.placeholderMissing", { field: raw(`{${field}}`) }),
    ),
  );
  if (summary.endFieldMissing) {
    result.push(
      t("dashboard.annotationSources.endFieldMissing", { field: raw(props.endTimeField) }),
    );
  }
  if (summary.rows.length && summary.rows.every((row) => !row.title)) {
    result.push(t("dashboard.annotationSources.titleEmpty"));
  }
  if (summary.truncated) {
    result.push(
      t("dashboard.annotationSources.previewTruncated", {
        limit: raw(String(ANNOTATION_PREVIEW_ROW_LIMIT)),
      }),
    );
  }
  return result;
});
</script>

<template>
  <div class="flex flex-col gap-2 py-2" data-test="dashboard-annotation-source-preview">
    <OBanner
      v-if="error"
      variant="error-soft"
      dense
      preserve-whitespace
      :content="raw(error)"
      data-test="dashboard-annotation-source-preview-error"
    />
    <template v-else-if="summary">
      <OTable
        v-if="summary.rows.length"
        :data="tableRows"
        :columns="columns"
        row-key="key"
        pagination="none"
        sorting="none"
        selection="none"
        :default-columns="false"
        :show-global-filter="false"
        data-test="dashboard-annotation-source-preview-table"
      />
      <p
        v-for="(flag, index) in flags"
        :key="index"
        class="text-text-secondary flex items-start gap-1.5 text-xs"
        data-test="dashboard-annotation-source-preview-flag"
      >
        <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
        <span>{{ flag }}</span>
      </p>
    </template>
    <p
      v-if="!error && !summary"
      class="text-text-secondary text-xs"
      data-test="dashboard-annotation-source-preview-hint"
    >
      {{ t("dashboard.annotationSources.previewHint") }}
    </p>
  </div>
</template>
