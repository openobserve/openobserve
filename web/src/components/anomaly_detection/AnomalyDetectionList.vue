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
        variant="ghost"
        size="icon-sm"
        :loading="loading"
        title="Refresh"
        @click="loadConfigs"
      >
        <RefreshCw class="tw:size-4" />
      </OButton>
    </div>

    <q-table
      data-test="anomaly-detection-list-table"
      :rows="configs"
      :columns="columns"
      row-key="anomaly_id"
      :loading="loading"
      :pagination="{ rowsPerPage: 20 }"
      class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
      style="width: 100%; height: calc(100vh - 160px)"
    >
      <!-- # column -->
      <template #body-cell-rownum="props">
        <q-td :props="props">{{ props.rowIndex + 1 }}</q-td>
      </template>

      <!-- Status column -->
      <template #body-cell-status="props">
        <q-td :props="props">
          <q-badge
            :color="statusColor(props.row)"
            :label="statusLabel(props.row)"
          >
            <OSpinner
              v-if="props.row.status === 'training'"
              size="xs"
              class="q-ml-xs"
            />
          </q-badge>
          <q-tooltip v-if="props.row.status === 'failed'">
            {{ props.row.last_error || t("alerts.anomalyStatus.failed") }}
          </q-tooltip>
        </q-td>
      </template>

      <!-- Look back window column -->
      <template #body-cell-detection_window="props">
        <q-td :props="props">
          <span v-if="props.row.detection_window_seconds">
            {{ formatSeconds(props.row.detection_window_seconds) }}
          </span>
          <span v-else class="text-grey-5">—</span>
        </q-td>
      </template>

      <!-- Last Triggered At column -->
      <template #body-cell-last_triggered_at="props">
        <q-td :props="props">
          <span v-if="props.row.last_detection_run && props.row.last_detection_run > 0">
            {{ formatTimestamp(props.row.last_detection_run) }}
          </span>
          <span v-else class="text-grey-5">—</span>
        </q-td>
      </template>

      <!-- Last Anomaly Detected At column -->
      <template #body-cell-last_anomaly_detected_at="props">
        <q-td :props="props">
          <span v-if="props.row.last_anomaly_detected_at">
            {{ formatTimestamp(props.row.last_anomaly_detected_at) }}
          </span>
          <span v-else class="text-grey-5">—</span>
        </q-td>
      </template>

      <!-- Last Trained At column -->
      <template #body-cell-last_trained_at="props">
        <q-td :props="props">
          <span v-if="props.row.training_completed_at">
            {{ formatTimestamp(props.row.training_completed_at) }}
          </span>
          <span v-else class="text-grey-5">—</span>
        </q-td>
      </template>

      <!-- Actions column -->
      <template #body-cell-actions="props">
        <q-td :props="props" class="tw:text-center">
          <!-- Edit -->
          <OButton
            variant="ghost"
            size="icon-sm"
            :title="t('alerts.edit')"
            @click="editConfig(props.row)"
          >
            <Pencil class="tw:size-4" />
          </OButton>
          <!-- Pause / Resume — hidden while training or failed -->
          <OButton
            v-if="props.row.status !== 'training' && props.row.status !== 'failed'"
            variant="ghost"
            size="icon-sm"
            :title="props.row.enabled ? 'Pause' : 'Resume'"
            @click="toggleEnabled(props.row)"
          >
            <Pause v-if="props.row.enabled" class="tw:size-4" />
            <Play v-else class="tw:size-4" />
          </OButton>
          <!-- Stop Training — only shown while training -->
          <OButton
            v-if="props.row.status === 'training'"
            variant="ghost-warning"
            size="icon-sm"
            title="Stop Training"
            :loading="cancellingId === props.row.anomaly_id"
            @click="confirmCancelTraining(props.row)"
          >
            <StopCircle class="tw:size-4" />
          </OButton>
          <!-- Retrain / Retry -->
          <OButton
            v-if="props.row.is_trained || props.row.status === 'failed'"
            :variant="props.row.status === 'failed' ? 'ghost-destructive' : 'ghost'"
            size="icon-sm"
            :title="props.row.status === 'failed' ? 'Retry Training' : t('alerts.triggerTraining')"
            :loading="retrainingId === props.row.anomaly_id"
            @click="confirmRetrain(props.row)"
          >
            <BrainCircuit class="tw:size-4" />
          </OButton>
          <!-- Delete -->
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            :title="t('alerts.delete')"
            @click="confirmDelete(props.row)"
          >
            <Trash2 class="tw:size-4" />
          </OButton>
        </q-td>
      </template>

      <!-- Empty state -->
      <template #no-data>
        <div class="tw:w-full tw:text-center tw:py-12 text-grey-6">
          {{ t("alerts.noDestinations") }}
        </div>
      </template>
    </q-table>

    <!-- Confirm delete dialog -->
    <q-dialog v-model="showDeleteDialog" persistent>
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">{{ t("alerts.delete") }}</div>
        </q-card-section>
        <q-card-section>
          Are you sure you want to delete
          <strong>{{ pendingDeleteRow?.name }}</strong>?
          This will also delete the trained model.
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <OButton variant="outline" size="sm-action" @click="showDeleteDialog = false">{{ t('alerts.cancel') }}</OButton>
          <OButton
            variant="destructive"
            size="sm-action"
            :loading="deleting"
            @click="deleteConfig"
          >
            {{ t('alerts.delete') }}
          </OButton>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Confirm cancel training dialog -->
    <q-dialog v-model="showCancelTrainingDialog" persistent>
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Stop Training</div>
        </q-card-section>
        <q-card-section>
          Stop the ongoing training for <strong>{{ pendingCancelRow?.name }}</strong>?
          The model will not be updated. You can retrigger training afterwards.
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <OButton variant="outline" size="sm-action" @click="showCancelTrainingDialog = false">{{ t('alerts.cancel') }}</OButton>
          <OButton
            variant="ghost-warning"
            size="sm-action"
            :loading="cancellingId === pendingCancelRow?.anomaly_id"
            @click="cancelTraining"
          >
            Stop Training
          </OButton>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Confirm retrain dialog -->
    <q-dialog v-model="showRetrainDialog" persistent>
      <q-card style="min-width: 380px; max-width: 480px">
        <q-card-section>
          <div class="text-h6">
            {{ pendingRetrainRow?.status === 'failed' ? 'Retry Training' : t("alerts.triggerTraining") }}
          </div>
        </q-card-section>
        <q-card-section>
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
            Training failed for <strong>{{ pendingRetrainRow?.name }}</strong>. Retry training now?
          </template>
          <template v-else>
            Trigger retraining for
            <strong>{{ pendingRetrainRow?.name }}</strong>?
            The existing model will be replaced once training completes.
            <div v-if="pendingRetrainRow?.training_completed_at" class="text-caption text-grey-6 q-mt-xs">
              Last trained: {{ formatTimestamp(pendingRetrainRow.training_completed_at) }}
            </div>
          </template>
        </q-card-section>
        <q-card-actions align="right" class="tw:gap-2">
          <OButton variant="outline" size="sm-action" @click="showRetrainDialog = false">{{ t('alerts.cancel') }}</OButton>
          <OButton
            :variant="pendingRetrainRow?.status === 'failed' ? 'destructive' : 'primary'"
            size="sm-action"
            :loading="retrainingId === pendingRetrainRow?.anomaly_id"
            @click="retrain"
          >
            {{ pendingRetrainRow?.status === 'failed' ? 'Retry Training' : t('alerts.triggerTraining') }}
          </OButton>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import anomalyDetectionService from "@/services/anomaly_detection";
import { date } from "quasar";
import OButton from '@/lib/core/Button/OButton.vue';
import { RefreshCw, Pencil, Pause, Play, StopCircle, BrainCircuit, Trash2 } from 'lucide-vue-next';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "AnomalyDetectionList",
  components: { OButton, RefreshCw, Pencil, Pause, Play, StopCircle, BrainCircuit, Trash2, OSpinner },

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

    const columns: any[] = [
      { name: "rownum",         label: "#",                        field: "rownum",              align: "left",   style: "width: 50px" },
      { name: "name",           label: t("alerts.name"),           field: "name",               sortable: true, align: "left" },
      { name: "stream",         label: "Stream",                   field: "stream_name",         sortable: true, align: "left" },
      { name: "status",         label: "Status",                   field: "status",              sortable: true, align: "left" },
      { name: "detection_window",         label: "Look back window",         field: "detection_window_seconds", sortable: true, align: "left" },
      { name: "check_every",              label: t("alerts.frequency"),      field: "schedule_interval",       sortable: true, align: "left" },
      { name: "last_triggered_at",        label: t("alerts.lastTriggered"),  field: "last_detection_run",      sortable: true, align: "left" },
      { name: "last_anomaly_detected_at", label: t("alerts.lastSatisfied"),  field: "last_anomaly_detected_at", sortable: true, align: "left" },
      { name: "last_trained_at",          label: "Last Trained At",          field: "training_completed_at",   sortable: true, align: "left" },
      { name: "actions",        label: t("alerts.actions"),        field: "actions",             align: "center", style: "width: 140px" },
    ];

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
