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
  <div class="w-full h-full">
    <!-- Toolbar: refresh -->
    <div class="flex items-center justify-end px-2 py-2 gap-2">
      <OTableColumnToggle
        :columns="columns"
        :column-visibility="columnVisibility"
        @update:column-visibility="setColumnVisibility"
      />
      <OButton
        variant="outline"
        size="sm"
        :loading="loading"
        data-test="anomaly-detection-list-refresh-btn"
        @click="loadConfigs"
      >
        <template #icon-left><OIcon name="refresh" size="sm" /></template>
        {{ t('common.refresh') }}
      </OButton>
    </div>

    <OTable
      data-test="anomaly-detection-list-table"
      :data="displayConfigs"
      :columns="columns"
      :column-visibility="columnVisibility"
      row-key="anomaly_id"
      :loading="loading"
      pagination="client"
      :page-size="20"
      sorting="client"
      filter-mode="client"
      :default-columns="false"
      :show-global-filter="false"
      class="h-full"
    >
      <!-- Status column -->
      <template #cell-status="{ row }">
        <div class="flex items-center gap-2">
          <OTag
            type="anomalyStatus"
            :value="row.enabled ? row.status : 'disabled'"
            data-test="anomaly-detection-status-badge"
          >
            {{ statusLabel(row) }}
            <OSpinner
              v-if="row.status === 'training'"
              size="xs"
              class="ml-1"
            />
          </OTag>
          <OTooltip v-if="row.status === 'failed'" :content="row.last_error || t('alerts.anomalyStatus.failed')" />
        </div>
      </template>

      <!-- Look back window column -->
      <template #cell-detection_window="{ row }">
        <span v-if="row.detection_window_seconds">
          {{ formatSeconds(row.detection_window_seconds) }}
        </span>
        <span v-else class="text-text-primary">—</span>
      </template>

      <!-- Last Triggered At column -->
      <template #cell-last_triggered_at="{ row }">
        <OTimeCell :value="row.last_detection_run" unit="us" empty-label="—" />
      </template>

      <!-- Last Anomaly Detected At column -->
      <template #cell-last_anomaly_detected_at="{ row }">
        <OTimeCell :value="row.last_anomaly_detected_at" unit="us" empty-label="—" />
      </template>

      <!-- Last Trained At column -->
      <template #cell-last_trained_at="{ row }">
        <OTimeCell :value="row.training_completed_at" unit="us" empty-label="—" />
      </template>

      <!-- Actions column -->
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-center gap-1">
          <!-- Edit -->
          <OButton
          icon-left="edit"
          variant="ghost"
          size="icon-sm"
          :title="t('alerts.edit')"
          data-row-action="edit"
          @click="editConfig(row)"
          />
          <!-- Pause / Resume — hidden while training or failed -->
          <OButton
            v-if="row.status !== 'training' && row.status !== 'failed'"
          :icon-left="row.enabled ? 'pause' : 'play-arrow'"
          :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
          size="icon-sm"
          :title="row.enabled ? 'Pause' : 'Resume'"
          :data-row-action="row.enabled ? 'pause' : 'resume'"
          @click="toggleEnabled(row)"
          />
          <!-- Stop Training — only shown while training -->
          <OButton
            v-if="row.status === 'training'"
          icon-left="stop-circle"
          variant="ghost-warning"
          size="icon-sm"
          title="Stop Training"
          :loading="cancellingId === row.anomaly_id"
          data-row-action="pause"
          @click="confirmCancelTraining(row)"
          />
          <!-- Retrain / Retry -->
          <OButton
            v-if="row.is_trained || row.status === 'failed'"
            :variant="row.status === 'failed' ? 'ghost-destructive' : 'ghost'"
            size="icon-sm"
            :title="row.status === 'failed' ? 'Retry Training' : t('alerts.triggerTraining')"
            :loading="retrainingId === row.anomaly_id"
            data-row-action="resume"
            @click="confirmRetrain(row)"
          >
            <OIcon name="brain-circuit" size="sm" />
          </OButton>
          <!-- Delete -->
          <OButton
          icon-left="delete"
          variant="ghost-destructive"
          size="icon-sm"
          :title="t('alerts.delete')"
          data-row-action="delete"
          @click="confirmDelete(row)"
          />
        </div>
      </template>

      <!-- Empty state -->
      <template #empty>
        <OEmptyState size="hero" preset="no-anomaly-configs" hide-action />
      </template>
    </OTable>

    <!-- Confirm delete dialog -->
    <ODialog data-test="anomaly-detection-list-delete-dialog"
      v-model:open="showDeleteDialog"
      persistent
      size="xs"
      :title="t('alerts.delete')"
      :secondary-button-label="t('alerts.cancel')"
      :primary-button-label="t('alerts.delete')"
      primary-button-variant="destructive"
      :primary-button-loading="deleting"
      @click:secondary="showDeleteDialog = false"
      @click:primary="deleteConfig"
    >
      <p>
        Are you sure you want to delete
        <strong>{{ pendingDeleteRow?.name }}</strong>?
        This will also delete the trained model.
      </p>
    </ODialog>

    <!-- Confirm cancel training dialog -->
    <ODialog data-test="anomaly-detection-list-cancel-training-dialog"
      v-model:open="showCancelTrainingDialog"
      persistent
      size="xs"
      title="Stop Training"
      :secondary-button-label="t('alerts.cancel')"
      primary-button-label="Stop Training"
      primary-button-variant="ghost-warning"
      :primary-button-loading="cancellingId === pendingCancelRow?.anomaly_id"
      @click:secondary="showCancelTrainingDialog = false"
      @click:primary="cancelTraining"
    >
      <p>
        Stop the ongoing training for <strong>{{ pendingCancelRow?.name }}</strong>?
        The model will not be updated. You can retrigger training afterwards.
      </p>
    </ODialog>

    <!-- Confirm retrain dialog -->
    <ODialog data-test="anomaly-detection-list-retrain-dialog"
      v-model:open="showRetrainDialog"
      persistent
      size="sm"
      :title="pendingRetrainRow?.status === 'failed' ? 'Retry Training' : t('alerts.triggerTraining')"
      :secondary-button-label="t('alerts.cancel')"
      :primary-button-label="pendingRetrainRow?.status === 'failed' ? 'Retry Training' : t('alerts.triggerTraining')"
      :primary-button-variant="pendingRetrainRow?.status === 'failed' ? 'destructive' : 'primary'"
      :primary-button-loading="retrainingId === pendingRetrainRow?.anomaly_id"
      @click:secondary="showRetrainDialog = false"
      @click:primary="retrain"
    >
      <!-- Error detail for failed state -->
      <template v-if="pendingRetrainRow?.status === 'failed' && pendingRetrainRow?.last_error">
        <div class="text-sm mb-2">
          Training failed for <strong>{{ pendingRetrainRow?.name }}</strong> with the following error:
        </div>
        <pre
          class="text-xs whitespace-pre-wrap break-all rounded p-2 mb-2"
          style="background: rgba(0,0,0,0.06); max-height: 120px; overflow-y: auto"
        >{{ pendingRetrainRow.last_error }}</pre>
        <div class="text-sm">Fix the issue above, then retry training.</div>
      </template>
      <template v-else-if="pendingRetrainRow?.status === 'failed'">
        <p>Training failed for <strong>{{ pendingRetrainRow?.name }}</strong>. Retry training now?</p>
      </template>
      <template v-else>
        <p>
          Trigger retraining for
          <strong>{{ pendingRetrainRow?.name }}</strong>?
          The existing model will be replaced once training completes.
        </p>
        <div v-if="pendingRetrainRow?.training_completed_at" class="text-xs text-gray-400">
          Last trained: {{ formatTimestamp(pendingRetrainRow.training_completed_at) }}
        </div>
      </template>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import anomalyDetectionService from "@/services/anomaly_detection";
import { formatToISO } from "@/utils/date";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "AnomalyDetectionList",
  components: { OTag, OButton, ODialog, OEmptyState, OIcon, OSpinner, OTable, OTableColumnToggle, OTimeCell, OTooltip },

  props: {
    org_identifier: {
      type: String,
      required: true,
    },
  },

  setup(props) {
    const router = useRouter();
    const { t } = useI18n();

    const loading = ref(false);
    const configs = ref<any[]>([]);

    const showDeleteDialog = ref(false);
    const pendingDeleteRow = ref<any>(null);
    const deleting = ref(false);

    const showRetrainDialog = ref(false);
    const pendingRetrainRow = ref<any>(null);
    const retrainingId = ref<string | null>(null);

    const showCancelTrainingDialog = ref(false);
    const pendingCancelRow = ref<any>(null);
    const cancellingId = ref<string | null>(null);

    const { columnVisibility, setColumnVisibility } = useExternalColumnToggle(
      "alerts-anomaly-detection-list",
    );

    const columns: OTableColumnDef[] = [
      { id: "#", header: "#", accessorKey: "#", size: TABLE_INDEX_COL_SIZE, meta: { align: "left" } },
      { id: "name", header: t("alerts.name"), accessorKey: "name", sortable: true, hideable: true, size: COL.name, meta: { align: "left", autoWidth: true } },
      { id: "stream", header: "Stream", accessorKey: "stream_name", sortable: true, hideable: true, size: COL.streamName, meta: { align: "left" } },
      { id: "status", header: "Status", accessorKey: "status", sortable: true, hideable: true, size: COL.status, meta: { align: "left" } },
      { id: "detection_window", header: "Look back window", accessorKey: "detection_window_seconds", sortable: true, hideable: true, size: COL.duration, meta: { align: "left" } },
      { id: "check_every", header: t("alerts.frequency"), accessorKey: "schedule_interval", sortable: true, hideable: true, size: COL.frequency, meta: { align: "left" } },
      { id: "last_triggered_at", header: t("alerts.lastTriggered"), accessorKey: "last_detection_run", sortable: true, hideable: true, size: COL.date, meta: { align: "left" } },
      { id: "last_anomaly_detected_at", header: t("alerts.lastSatisfied"), accessorKey: "last_anomaly_detected_at", sortable: true, hideable: true, size: COL.date, meta: { align: "left" } },
      { id: "last_trained_at", header: "Last Trained At", accessorKey: "training_completed_at", sortable: true, hideable: true, size: COL.date, meta: { align: "left" } },
      { id: "actions", header: t("alerts.actions"), isAction: true, size: 140, meta: { align: "center" } },
    ];

    const displayConfigs = computed(() =>
      configs.value.map((c, i) => ({ ...c, "#": i + 1 }))
    );

    const statusLabel = (row: any) => {
      if (!row.enabled) return t("alerts.anomalyStatus.disabled");
      return t(`alerts.anomalyStatus.${row.status}`) || row.status;
    };

    const formatTimestamp = (ts: number) => {
      // timestamps come back in microseconds
      return formatToISO(ts);
    };

    const formatSeconds = (secs: number) => {
      if (secs >= 3600) {
        const h = Math.floor(secs / 3600);
        const m = Math.round((secs % 3600) / 60);
        return m === 0 ? `${h} Hours` : `${h} Hours ${m} Mins`;
      }
      return `${Math.round(secs / 60)} mins`;
    };

    const loadConfigs = async () => {
      loading.value = true;
      try {
        const res = await anomalyDetectionService.list(props.org_identifier);
        configs.value = res.data?.configs ?? res.data ?? [];
      } catch {
        toast({ variant: "error", message: "Failed to load anomaly detection configs." });
      } finally {
        loading.value = false;
      }
    };

    const editConfig = (row: any) => {
      router.push({
        name: "editAnomalyDetection",
        params: { anomaly_id: row.anomaly_id },
        query: { org_identifier: props.org_identifier },
      });
    };

    const toggleEnabled = async (row: any) => {
      try {
        await anomalyDetectionService.toggleEnabled(
          props.org_identifier,
          row.anomaly_id,
          !row.enabled,
        );
        // Reload from server so the trigger status and timestamps are fresh.
        await loadConfigs();
      } catch {
        toast({ variant: "error", message: "Failed to update config." });
      }
    };

    const confirmDelete = (row: any) => {
      pendingDeleteRow.value = row;
      showDeleteDialog.value = true;
    };

    const deleteConfig = async () => {
      if (!pendingDeleteRow.value) return;
      deleting.value = true;
      try {
        await anomalyDetectionService.delete(
          props.org_identifier,
          pendingDeleteRow.value.anomaly_id,
        );
        configs.value = configs.value.filter(
          (c) => c.anomaly_id !== pendingDeleteRow.value.anomaly_id,
        );
        showDeleteDialog.value = false;
        toast({ variant: "success", message: "Anomaly detection config deleted." });
      } catch {
        toast({ variant: "error", message: "Failed to delete config." });
      } finally {
        deleting.value = false;
      }
    };

    const confirmCancelTraining = (row: any) => {
      pendingCancelRow.value = row;
      showCancelTrainingDialog.value = true;
    };

    const cancelTraining = async () => {
      if (!pendingCancelRow.value) return;
      cancellingId.value = pendingCancelRow.value.anomaly_id;
      try {
        await anomalyDetectionService.cancelTraining(
          props.org_identifier,
          pendingCancelRow.value.anomaly_id,
        );
        showCancelTrainingDialog.value = false;
        toast({ variant: "success", message: "Training cancelled. You can now retrigger it." });
        await loadConfigs();
      } catch {
        toast({ variant: "error", message: "Failed to cancel training." });
      } finally {
        cancellingId.value = null;
      }
    };

    const confirmRetrain = (row: any) => {
      pendingRetrainRow.value = row;
      showRetrainDialog.value = true;
    };

    const retrain = async () => {
      if (!pendingRetrainRow.value) return;
      retrainingId.value = pendingRetrainRow.value.anomaly_id;
      try {
        await anomalyDetectionService.triggerTraining(
          props.org_identifier,
          pendingRetrainRow.value.anomaly_id,
        );
        showRetrainDialog.value = false;
        toast({ variant: "success", message: "Training started. Status will update shortly." });
        // Refresh list to pick up status change
        await loadConfigs();
      } catch {
        toast({ variant: "error", message: "Failed to trigger training." });
      } finally {
        retrainingId.value = null;
      }
    };

    onMounted(() => {
      loadConfigs();
    });

    return {
      t,
      loading,
      configs,
      displayConfigs,
      columns,
      columnVisibility,
      setColumnVisibility,
      showDeleteDialog,
      pendingDeleteRow,
      deleting,
      showRetrainDialog,
      pendingRetrainRow,
      retrainingId,
      showCancelTrainingDialog,
      pendingCancelRow,
      cancellingId,
      confirmCancelTraining,
      cancelTraining,
      statusLabel,
      formatTimestamp,
      formatSeconds,
      loadConfigs,
      editConfig,
      toggleEnabled,
      confirmDelete,
      deleteConfig,
      confirmRetrain,
      retrain,
    };
  },
});
</script>
