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
    ref="rootEl"
    data-test="alert-triggers-table"
    class="alert-triggers-table flex h-full flex-col overflow-hidden"
  >
    <OTable
      data-test="triggers-qtable"
      :data="triggers"
      :columns="columns"
      row-key="created_at"
      pagination="client"
      :page-size="20"
      :page-size-options="[20, 50, 100, 250, 500]"
      sorting="client"
      :default-columns="false"
      :enable-column-resize="true"
      :persist-columns="true"
      :table-id="tableId"
      :show-global-filter="false"
      @row-click="onRowClick"
      @pagination-change="refitLabels"
      @sort-change="refitLabels"
      @update:column-sizes="refitLabels"
    >
      <template #empty>
        <div data-test="no-triggers-message" class="py-8 text-center">
          <span class="text-text-secondary text-sm">
            {{ t("alerts.noTriggersLoaded") }}
          </span>
        </div>
      </template>

      <template #cell-alert_name="{ row }">
        <span data-test="alert-name-text" class="text-text-body text-xs font-medium">
          {{ row.alert_name }}
        </span>
      </template>

      <template #cell-alert_fired_at="{ row }">
        <span v-if="formatTime !== null" data-test="fired-at-timestamp" class="text-xs">
          {{ formatTimestamp(row.alert_fired_at) }}
        </span>
        <span v-else data-test="fired-at-timestamp" class="text-xs">
          <OTimeCell
            :value="row.alert_fired_at"
            unit="us"
            mode="relative"
            :now="now"
            :timezone="store.state.timezone"
            :empty-label="raw('—')"
          />
        </span>
      </template>

      <template #cell-detected_source="{ row }">
        <OTag
          v-if="row.alert_kind === 'external' && row.detected_source"
          data-test="trigger-source-badge"
          variant="default-outline"
        >
          {{ row.detected_source }}
        </OTag>
        <OTag
          v-else-if="row.alert_kind === 'autoobserve'"
          data-test="trigger-source-autoobserve"
          variant="default-outline"
        >
          {{ t("alerts.incidents.triggerSourceAutoObserve") }}
        </OTag>
        <span v-else class="text-text-secondary text-xs">—</span>
      </template>

      <template #cell-labels="{ row }">
        <div
          v-if="labelPairs(row.labels).length"
          data-test="trigger-labels"
          class="flex min-w-0 flex-nowrap items-center gap-1"
        >
          <div
            data-label-fit
            :data-row="row.created_at"
            class="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
          >
            <OTag
              v-for="pair in labelPairs(row.labels)"
              :key="pair"
              data-test="trigger-label-chip"
              variant="default-outline"
              class="max-w-full min-w-0"
            >
              <OTruncatedText :tooltip="hiddenLabels[row.created_at] ? false : undefined">
                {{ pair }}
              </OTruncatedText>
            </OTag>
          </div>
          <span v-if="hiddenLabels[row.created_at]" data-test="trigger-label-more" class="shrink-0">
            <OTag variant="default-outline">{{ raw(`+${hiddenLabels[row.created_at]}`) }}</OTag>
            <OTooltip :content="labelsText(row.labels)" side="top" />
          </span>
        </div>
        <span v-else class="text-text-secondary text-xs">—</span>
      </template>

      <template #cell-correlation_reason="{ row }">
        <template v-if="reasonLabel">
          <OTag
            v-if="reasonLabel(row)"
            data-test="correlation-reason-label"
            variant="default-soft"
            size="sm"
            :label="raw(reasonLabel(row) ?? '')"
          />
        </template>
        <span v-else class="inline-flex">
          <OTag
            data-test="correlation-reason-badge"
            type="correlationReason"
            :value="row.correlation_reason"
          />
          <OTooltip :content="raw(getReasonTooltip(row.correlation_reason))" side="top" />
        </span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          v-if="row.alert_kind === 'external'"
          data-test="trigger-view-payload-btn"
          variant="ghost"
          size="icon-sm"
          icon-left="visibility"
          :title="t('alerts.incidents.viewPayload')"
          @click.stop="openPayload(row)"
        />
      </template>
    </OTable>

    <ODialog
      data-test="trigger-payload-dialog"
      v-model:open="payloadDialogOpen"
      size="md"
      :title="t('alerts.incidents.rawPayloadTitle')"
      :primary-button-label="t('common.close')"
      @click:primary="payloadDialogOpen = false"
    >
      <div v-if="payloadLoading" class="text-text-secondary py-4 text-center text-sm">
        {{ t("common.loading") }}
      </div>
      <div v-else-if="payloadError" class="text-status-error-text py-4 text-center text-sm">
        {{ payloadError }}
      </div>
      <template v-else-if="payloadData">
        <div class="text-text-secondary mb-2 text-xs">
          <span
            >{{ t("alerts.incidents.payloadSourceLabel") }} {{ payloadData.detected_source }}</span
          >
          <span v-if="payloadData.source_url" class="ms-3">{{ payloadData.source_url }}</span>
        </div>
        <pre
          data-test="trigger-payload-json"
          class="bg-surface-secondary rounded-surface max-h-[60vh] overflow-auto p-3 text-xs"
          >{{ formattedPayload }}</pre>
      </template>
    </ODialog>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  PropType,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  watch,
  ref,
} from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { useNow } from "@/composables/useNow";

// gap-1 between chips; room kept for the "+N" tag; a cut chip narrower than this reads as noise.
const LABEL_GAP_PX = 4;
const MORE_TAG_PX = 36;
const MIN_CUT_CHIP_PX = 72;

import incidentsService, { type ExternalAlertPayload } from "@/services/incidents";

interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  alert_name: string;
  alert_kind?: "internal" | "external" | "autoobserve";
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "primary_match" | "secondary_match" | "alert_id";
  created_at: number;
  source_url?: string | null;
  labels?: Record<string, string> | null;
  detected_source?: string | null;
}

export default defineComponent({
  name: "IncidentAlertTriggersTable",
  components: {
    OTag,
    OTooltip,
    OTable,
    OButton,
    ODialog,
    OTruncatedText,
    OTimeCell,
  },
  props: {
    triggers: {
      type: Array as PropType<IncidentAlert[]>,
      required: true,
    },
    isDarkMode: {
      type: Boolean,
      required: true,
    },
    // Per-page options: the AutoObserve drawer keeps its own column widths, clock and reasons.
    tableId: {
      type: String,
      default: "incidents-alert-triggers",
    },
    hideEmptyColumns: {
      type: Boolean,
      default: false,
    },
    showCorrelationReason: {
      type: Boolean,
      default: true,
    },
    formatTime: {
      type: Function as PropType<(us: number) => string>,
      default: null,
    },
    reasonLabel: {
      type: Function as PropType<(row: IncidentAlert) => string | null>,
      default: null,
    },
  },
  emits: ["row-click"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();
    const now = useNow();

    const allColumns = computed<OTableColumnDef[]>(() => [
      {
        id: "alert_name",
        header: t("alerts.incidents.alertName"),
        accessorKey: "alert_name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 260,
        minSize: 160,
        meta: { align: "left" },
      },
      {
        id: "detected_source",
        header: t("alerts.incidents.source"),
        accessorKey: "detected_source",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "labels",
        header: t("alerts.incidents.labels"),
        accessorKey: "labels",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 220,
        meta: { align: "left", flex: true },
      },
      {
        id: "alert_fired_at",
        header: t("alerts.incidents.firedAt"),
        accessorKey: "alert_fired_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "correlation_reason",
        header: t("alerts.incidents.correlationReason"),
        accessorKey: "correlation_reason",
        sortable: false,
        resizable: true,
        hideable: true,
        size: props.reasonLabel !== null ? 200 : 150,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: raw(""),
        isAction: true,
        size: 60,
        meta: { align: "left" },
      },
    ]);

    const columns = computed(() => {
      const shown = props.showCorrelationReason
        ? allColumns.value
        : allColumns.value.filter((c) => c.id !== "correlation_reason");
      if (!props.hideEmptyColumns) return shown;
      const filled: Record<string, boolean> = {
        detected_source: props.triggers.some(
          (row) =>
            (row.alert_kind === "external" && !!row.detected_source) ||
            row.alert_kind === "autoobserve",
        ),
        labels: props.triggers.some((row) => row.labels && Object.keys(row.labels).length),
        actions: props.triggers.some((row) => row.alert_kind === "external"),
      };
      return shown.filter((c) => filled[c.id] ?? true);
    });

    const formatTimestamp = (timestamp: number) => {
      if (!timestamp) return raw("N/A");
      return raw(props.formatTime?.(timestamp) ?? "");
    };

    const getReasonTooltip = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return t("alerts.incidents.correlationServiceDiscoveryTooltip");
        case "primary_match":
          return t("alerts.incidents.correlationPrimaryMatchTooltip");
        case "secondary_match":
          return t("alerts.incidents.correlationSecondaryMatchTooltip");
        case "alert_id":
          return t("alerts.incidents.correlationAlertIdTooltip");
        default:
          return "";
      }
    };

    const onRowClick = (row: IncidentAlert) => {
      emit("row-click", row.alert_name);
    };

    // Sorted by key: the server sends labels in no fixed order, so rows would lead with different keys.
    const labelPairs = (labels?: Record<string, string> | null) =>
      Object.entries(labels ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`);

    const labelsText = (labels?: Record<string, string> | null) =>
      raw(labelPairs(labels).join(", "));

    // Whole chips first, then one cut to the room left (when readable), then "+N" for the rest.
    const rootEl = ref<HTMLElement | null>(null);
    const hiddenLabels = ref<Record<string, number>>({});
    const fitLabels = () => {
      const next: Record<string, number> = {};
      rootEl.value?.querySelectorAll<HTMLElement>("[data-label-fit]").forEach((box) => {
        const chips = Array.from(box.children) as HTMLElement[];
        const cell = box.parentElement;
        // A hidden cell measures zero; fitting it then would hide every chip.
        if (!chips.length || !cell?.clientWidth) return;
        chips.forEach((chip) => {
          chip.style.display = "";
          chip.style.maxWidth = "";
          chip.style.flexShrink = "0";
        });
        let used = 0;
        let shown = 0;
        for (let i = 0; i < chips.length; i++) {
          const rest = chips.length - i - 1;
          const room = cell.clientWidth - used - (rest ? MORE_TAG_PX + LABEL_GAP_PX : 0);
          if (chips[i].offsetWidth <= room) {
            used += chips[i].offsetWidth + LABEL_GAP_PX;
            shown++;
            continue;
          }
          if (i === 0 || room >= MIN_CUT_CHIP_PX) {
            chips[i].style.maxWidth = `${Math.max(0, room)}px`;
            chips[i].style.flexShrink = "1";
            shown++;
          }
          break;
        }
        chips.slice(shown).forEach((chip) => (chip.style.display = "none"));
        if (chips.length > shown) next[box.dataset.row ?? ""] = chips.length - shown;
      });
      const now = hiddenLabels.value;
      const same =
        Object.keys(next).length === Object.keys(now).length &&
        Object.entries(next).every(([key, n]) => now[key] === n);
      if (!same) hiddenLabels.value = next;
    };
    let fitObserver: ResizeObserver | null = null;
    onMounted(() => {
      nextTick(() => fitLabels());
      if (typeof ResizeObserver !== "undefined" && rootEl.value) {
        fitObserver = new ResizeObserver(() => fitLabels());
        fitObserver.observe(rootEl.value);
      }
    });
    // Cells re-render inside the table (paging, sorting, column resize), so this component does not
    // see their updates; the table's events bump this version to refit after its render.
    const layoutVersion = ref(0);
    const refitLabels = () => layoutVersion.value++;
    watch([hiddenLabels, () => props.triggers, layoutVersion], () => fitLabels(), {
      flush: "post",
    });
    onBeforeUnmount(() => fitObserver?.disconnect());

    const payloadDialogOpen = ref(false);
    const payloadLoading = ref(false);
    const payloadError = ref("");
    const payloadData = ref<ExternalAlertPayload | null>(null);

    const formattedPayload = computed(() => {
      if (!payloadData.value) return "";
      try {
        return JSON.stringify(payloadData.value.last_payload, null, 2);
      } catch {
        return String(payloadData.value.last_payload);
      }
    });

    const openPayload = async (row: IncidentAlert) => {
      payloadDialogOpen.value = true;
      payloadLoading.value = true;
      payloadError.value = "";
      payloadData.value = null;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const response = await incidentsService.getExternalAlertPayload(orgId, row.alert_id);
        payloadData.value = response.data;
      } catch (err: any) {
        payloadError.value = err?.response?.data?.message || t("alerts.incidents.rawPayloadError");
      } finally {
        payloadLoading.value = false;
      }
    };

    return {
      rootEl,
      hiddenLabels,
      refitLabels,
      now,
      raw,
      t,
      store,
      columns,
      formatTimestamp,
      getReasonTooltip,
      onRowClick,
      labelPairs,
      labelsText,
      payloadDialogOpen,
      payloadLoading,
      payloadError,
      payloadData,
      formattedPayload,
      openPayload,
    };
  },
});
</script>
