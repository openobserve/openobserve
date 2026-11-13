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
  <OFormSection
    v-if="rows.length"
    variant="plain"
    class="mt-4"
    :title="t('about.waivers_title')"
    :description="t('about.waivers_from_key')"
    data-test="license-waivers-card"
  >
    <div class="rounded-b-surface -mx-4 -my-3 overflow-hidden">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="id"
        pagination="none"
        sorting="none"
        :frame="false"
        :default-columns="false"
        :dense="false"
        wrap
        :show-global-filter="false"
        table-id="license-waivers"
        data-test="license-waivers-table"
      >
        <template #cell-waiver="{ row }">
          <div :data-test="`license-waiver-row-${row.id}`">
            <div
              class="flex flex-wrap items-center gap-2"
              :data-test="`license-waiver-heading-${row.id}`"
            >
              <span :data-test="`license-waiver-label-${row.id}`">{{
                waiverKindLabel(row, t, locale)
              }}</span>
              <OTag
                type="licenseWaiverStatus"
                :value="waiverStatus(row, nowUs)"
                :label="
                  row.type === 'breach_days' && waiverStatus(row, nowUs) === 'ended'
                    ? t('about.waiver_expired')
                    : undefined
                "
                :data-test="`license-waiver-status-${row.id}`"
              />
            </div>
            <div
              v-if="waiverSummary(row, nowUs, locale, t)"
              class="text-text-secondary mt-1 text-xs"
              :data-test="`license-waiver-summary-${row.id}`"
            >
              {{ waiverSummary(row, nowUs, locale, t) }}
            </div>
          </div>
        </template>
        <template #cell-window="{ row }">
          <span :data-test="`license-waiver-window-${row.id}`">{{
            waiverWindowLabel(row, nowUs, locale, t)
          }}</span>
        </template>
        <template #cell-note="{ row }">
          <span :data-test="`license-waiver-note-${row.id}`">{{ row.note }}</span>
        </template>
      </OTable>
      <div
        v-if="!canUpdate"
        class="text-text-secondary border-border-default border-t px-4 py-3 text-sm"
        data-test="license-waivers-ask-admin"
      >
        {{ t("about.waivers_ask_admin") }}
      </div>
    </div>
  </OFormSection>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  MAX_TIMEOUT_MS,
  breachRetentionEndUs,
  waiverSummary,
  waiverKindLabel,
  waiverWindowLabel,
  knownWaivers,
  waiverStatus,
  type LicenseWaiver,
} from "@/utils/licenseWaivers";

const props = withDefaults(
  defineProps<{ waivers: LicenseWaiver[] | undefined; canUpdate?: boolean }>(),
  { canUpdate: true },
);

const emit = defineEmits<{ boundary: [atUs: number] }>();

const { t, locale } = useI18nTyped();

const nowUs = ref(Date.now() * 1000);

const rows = computed(() => knownWaivers(props.waivers));

let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
let armedBoundary: number | undefined;

const clearBoundaryTimer = () => {
  if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
  boundaryTimer = undefined;
  armedBoundary = undefined;
};

// far boundaries re-arm in steps, so only a timer that reached its boundary reports it
const onBoundaryTimer = () => {
  const reached = armedBoundary;
  armBoundaryTimer();
  if (reached !== undefined && reached <= nowUs.value) emit("boundary", reached);
};

const armBoundaryTimer = () => {
  clearBoundaryTimer();
  nowUs.value = Date.now() * 1000;
  const upcoming = rows.value
    .flatMap((w) => [
      w.starts_at,
      w.ends_at,
      ...(w.type === "breach_days" ? [breachRetentionEndUs(w)] : []),
    ])
    .filter((b) => b > nowUs.value);
  if (!upcoming.length) return;
  armedBoundary = Math.min(...upcoming);
  boundaryTimer = setTimeout(
    onBoundaryTimer,
    Math.min(Math.ceil((armedBoundary - nowUs.value) / 1000), MAX_TIMEOUT_MS),
  );
};

watch(rows, armBoundaryTimer, { immediate: true });

onBeforeUnmount(clearBoundaryTimer);

const columns = computed<OTableColumnDef[]>(() => [
  { id: "waiver", header: t("about.waiver_col_waiver"), cell: " ", size: 360 },
  { id: "window", header: t("about.waiver_col_window"), cell: " ", size: 220 },
  {
    id: "note",
    header: t("about.waiver_col_note"),
    accessorKey: "note",
    meta: { autoWidth: true, fillRemaining: true },
  },
]);
</script>
