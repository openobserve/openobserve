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
  <div class="tw:w-full tw:h-full">
    <!-- Toolbar: search + refresh -->
    <div class="tw:flex tw:items-center tw:justify-end tw:px-2 tw:py-2 tw:gap-2">
      <OButton
        icon-left="refresh"
        variant="ghost"
        size="icon-sm"
        :loading="loading"
        title="Refresh"
        @click="loadConfigs"
      />
    </div>

    <OTable
      data-test="anomaly-detection-list-table"
      :data="displayConfigs"
      :columns="columns"
      row-key="anomaly_id"
      :loading="loading"
      pagination="client"
      :page-size="20"
      sorting="client"
      filter-mode="client"
      :show-global-filter="false"
      class="tw:h-full"
    >
      <!-- Status column -->
      <template #cell-status="{ row }">
        <div class="tw:flex tw:items-center tw:gap-2">
          <q-badge
            :color="statusColor(row)"
            :label="statusLabel(row)"
          >
            <OSpinner
              v-if="row.status === 'training'"
              size="xs"
              class="q-ml-xs"
            />
          </q-badge>
          <q-tooltip v-if="row.status === 'failed'">
            {{ row.last_error || t("alerts.anomalyStatus.failed") }}
          </q-tooltip>
        </div>
      </template>

      <!-- Look back window column -->
      <template #cell-detection_window="{ row }">
        <span v-if="row.detection_window_seconds">
          {{ formatSeconds(row.detection_window_seconds) }}
        </span>
        <span v-else class="text-grey-5">—</span>
      </template>

      <!-- Last Triggered At column -->
      <template #cell-last_triggered_at="{ row }">
        <span v-if="row.last_detection_run && row.last_detection_run > 0">
          {{ formatTimestamp(row.last_detection_run) }}
        </span>
        <span v-else class="text-grey-5">—</span>
      </template>

      <!-- Last Anomaly Detected At column -->
      <template #cell-last_anomaly_detected_at="{ row }">
        <span v-if="row.last_anomaly_detected_at">
          {{ formatTimestamp(row.last_anomaly_detected_at) }}
        </span>
        <span v-else class="text-grey-5">—</span>
      </template>

      <!-- Last Trained At column -->
      <template #cell-last_trained_at="{ row }">
        <span v-if="row.training_completed_at">
          {{ formatTimestamp(row.training_completed_at) }}
        </span>
        <span v-else class="text-grey-5">—</span>
      </template>

      <!-- Actions column -->
      <template #cell-actions="{ row }">
        <div class="tw:flex tw:items-center tw:justify-center tw:gap-1">
          <!-- Edit -->
          <OButton
          icon-left="edit"
          variant="ghost"
          size="icon-sm"
          :title="t('alerts.edit')"
          @click="editConfig(row)"
          />
          <!-- Pause / Resume — hidden while training or failed -->
          <OButton
            v-if="row.status !== 'training' && row.status !== 'failed'"
          :icon-left="row.enabled ? 'pause' : 'play-arrow'"
          variant="ghost"
          size="icon-sm"
          :title="row.enabled ? 'Pause' : 'Resume'"
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
          @click="confirmCancelTraining(row)"
          />
          <!-- Retrain / Retry -->
          <OButton
            v-if="row.is_trained || row.status === 'failed'"
            :variant="row.status === 'failed' ? 'ghost-destructive' : 'ghost'"
            size="icon-sm"
            :title="row.status === 'failed' ? 'Retry Training' : t('alerts.triggerTraining')"
            :loading="retrainingId === row.anomaly_id"
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
          @click="confirmDelete(row)"
          />
        </div>
      </template>

      <!-- Empty state -->
      <template #empty>
        <div class="tw:w-full tw:text-center tw:py-12 text-grey-6">
          {{ t("alerts.noDestinations") }}
        </div>
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
        <div class="text-body2 q-mb-sm">
          Training failed for <strong>{{ pendingRetrainRow?.name }}</strong> with the following error:
        </div>
        <pre
          class="tw:text-xs tw:whitespace-pre-wrap tw:break-all tw:rounded tw:p-2 q-mb-sm"
          style="background: rgba(0,0,0,0.06); max-height: 120px; overflow-y: auto"
        >{{ pendingRetrainRow.last_error }}</pre>
        <div class="text-body2">Fix the issue above, then retry training.</div>
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
        <div v-if="pendingRetrainRow?.training_completed_at" class="text-caption text-grey-6">
          Last trained: {{ formatTimestamp(pendingRetrainRow.training_completed_at) }}
        </div>
      </template>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import anomalyDetectionService from "@/services/anomaly_detection";
import { date } from "quasar";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "AnomalyDetectionList",
  components: { OButton, ODialog, OIcon, OSpinner, OTable },

  props: {
    org_identifier: {
      type: String,
      required: true,
    },
  },

  setup(props) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

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

    const columns: OTableColumnDef[] = [
      { id: "#", header: "#", accessorKey: "#", size: 50, meta: { align: "left" } },
      { id: "name", header: t("alerts.name"), accessorKey: "name", sortable: true, meta: { align: "left" } },
      { id: "stream", header: "Stream", accessorKey: "stream_name", sortable: true, meta: { align: "left" } },
      { id: "status", header: "Status", accessorKey: "status", sortable: true, meta: { align: "left" } },
      { id: "detection_window", header: "Look back window", accessorKey: "detection_window_seconds", sortable: true, meta: { align: "left" } },
      { id: "check_every", header: t("alerts.frequency"), accessorKey: "schedule_interval", sortable: true, meta: { align: "left" } },
      { id: "last_triggered_at", header: t("alerts.lastTriggered"), accessorKey: "last_detection_run", sortable: true, meta: { align: "left" } },
      { id: "last_anomaly_detected_at", header: t("alerts.lastSatisfied"), accessorKey: "last_anomaly_detected_at", sortable: true, meta: { align: "left" } },
      { id: "last_trained_at", header: "Last Trained At", accessorKey: "training_completed_at", sortable: true, meta: { align: "left" } },
      { id: "actions", header: t("alerts.actions"), accessorKey: "actions", size: 140, meta: { align: "center" } },
    ];

    const displayConfigs = computed(() =>
      configs.value.map((c, i) => ({ ...c, "#": i + 1 }))
    );

    const statusColor = (row: any) => {
      if (!row.enabled) return "grey";
      switch (row.status) {
        case "ready":     return "positive";
        case "training":  return "info";
        case "failed":    return "negative";
        case "waiting":   return "grey";
        default:          return "grey";
      }
    };

    const statusLabel = (row: any) => {
      if (!row.enabled) return t("alerts.anomalyStatus.disabled");
      return t(`alerts.anomalyStatus.${row.status}`) || row.status;
    };

    const formatTimestamp = (ts: number) => {
      // timestamps come back in microseconds
      return date.formatDate(ts / 1000, "YYYY-MM-DDTHH:mm:ssZ");
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
        $q.notify({ type: "negative", message: "Failed to load anomaly detection configs." });
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
        $q.notify({ type: "negative", message: "Failed to update config." });
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
        $q.notify({ type: "positive", message: "Anomaly detection config deleted." });
      } catch {
        $q.notify({ type: "negative", message: "Failed to delete config." });
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
        $q.notify({ type: "positive", message: "Training cancelled. You can now retrigger it." });
        await loadConfigs();
      } catch {
        $q.notify({ type: "negative", message: "Failed to cancel training." });
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
        $q.notify({ type: "positive", message: "Training started. Status will update shortly." });
        // Refresh list to pick up status change
        await loadConfigs();
      } catch {
        $q.notify({ type: "negative", message: "Failed to trigger training." });
      } finally {
        retrainingId.value = null;
      }
    };

    let pollTimer: ReturnType<typeof setInterval> | null = null;

    onMounted(() => {
      loadConfigs();
      // Auto-refresh every 30 s so Last Triggered At / Status stay current.
      pollTimer = setInterval(loadConfigs, 30_000);
    });

    onUnmounted(() => {
      if (pollTimer !== null) clearInterval(pollTimer);
    });

    return {
      t,
      loading,
      configs,
      displayConfigs,
      columns,
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
      statusColor,
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
