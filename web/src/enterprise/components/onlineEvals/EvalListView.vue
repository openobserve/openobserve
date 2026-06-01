<template>
  <section class="online-evals__list">
    <div class="online-evals__toolbar">
      <div class="online-evals__search">
        <OIcon name="search" size="xs" />
        <input
          :value="search"
          :placeholder="t('onlineEvals.search', { label: tabLabel.toLowerCase() })"
          @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="online-evals__toolbar-actions">
        <select
          v-if="activeTab === 'jobs'"
          :value="jobStatusFilter"
          class="online-evals__select"
          @change="$emit('update:jobStatusFilter', ($event.target as HTMLSelectElement).value as EvalJobStatus | '')"
        >
          <option value="">{{ t("onlineEvals.allStatuses") }}</option>
          <option value="draft">{{ t("onlineEvals.jobStatus.draft") }}</option>
          <option value="active">{{ t("onlineEvals.jobStatus.active") }}</option>
          <option value="paused">{{ t("onlineEvals.jobStatus.paused") }}</option>
          <option value="degraded">{{ t("onlineEvals.jobStatus.degraded") }}</option>
          <option value="archived">{{ t("onlineEvals.jobStatus.archived") }}</option>
        </select>

        <OButton
          icon-left="refresh"
          variant="outline"
          size="sm"
          :loading="isLoading"
          @click="$emit('refresh')"
        >
          {{ t("onlineEvals.refresh") }}
        </OButton>
        <OButton size="sm" @click="$emit('create')">
          {{ createButtonLabel }}
        </OButton>
      </div>
    </div>

    <div v-if="rows.length === 0" class="online-evals__empty">
      <OIcon name="rule" size="md" />
      <strong>{{ t("onlineEvals.noRowsFound", { label: tabLabel.toLowerCase() }) }}</strong>
      <span>{{ t("onlineEvals.getStartedHint") }}</span>
    </div>

    <div v-else class="online-evals__table">
      <div class="online-evals__thead" :class="tableClass">
        <span>{{ t("onlineEvals.columns.name") }}</span>
        <span>{{ secondaryColumnLabel }}</span>
        <span>{{ t("onlineEvals.columns.status") }}</span>
        <span>{{ t("onlineEvals.columns.updated") }}</span>
        <span></span>
      </div>

      <div
        v-for="row in rows"
        :key="rowKey(row)"
        class="online-evals__row"
        :class="tableClass"
      >
        <span>
          <strong>{{ row.name }}</strong>
          <small>{{ rowDescription(row) }}</small>
        </span>
        <span>{{ rowSecondary(row) }}</span>
        <span>
          <i class="eval-pill" :class="statusClass(rowStatus(row))">{{ rowStatus(row) }}</i>
        </span>
        <span>{{ formatDate(rowUpdatedAt(row)) }}</span>
        <span class="online-evals__row-actions" @click.stop>
          <OButton
            icon-left="edit"
            variant="ghost"
            size="icon-sm"
            :title="t('onlineEvals.actions.edit')"
            @click="$emit('edit', row)"
          />
          <OButton
            icon-left="delete"
            variant="ghost-destructive"
            size="icon-sm"
            :title="t('onlineEvals.actions.delete')"
            @click="$emit('delete', row)"
          />
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type {
  EvalJob,
  EvalJobStatus,
  Provider,
  ScoreConfig,
  Scorer,
} from "@/services/online-evals.service";
import {
  booleanOf,
  dataTypeOf,
  defaultModelOf,
  entityId,
  providerTypeOf,
  scorerTypeOf,
  statusOf,
  streamTypeOf,
  valueOf,
} from "./utils/evalEntity";
import { formatDate, statusClass } from "./utils/evalFormat";

type ActiveTab = "jobs" | "scorers" | "scoreConfigs" | "providers";
type AnyRow = EvalJob | Scorer | ScoreConfig | Provider;

const props = defineProps<{
  activeTab: ActiveTab;
  tabLabel: string;
  rows: AnyRow[];
  isLoading: boolean;
  search: string;
  jobStatusFilter: EvalJobStatus | "";
  createButtonLabel: string;
  secondaryColumnLabel: string;
}>();

defineEmits<{
  (e: "update:search", value: string): void;
  (e: "update:jobStatusFilter", value: EvalJobStatus | ""): void;
  (e: "refresh"): void;
  (e: "create"): void;
  (e: "edit", row: AnyRow): void;
  (e: "delete", row: AnyRow): void;
}>();

const { t } = useI18n();

const tableClass = computed(() => `online-evals__row--${props.activeTab}`);

function rowKey(row: AnyRow) {
  return props.activeTab === "jobs" || props.activeTab === "providers"
    ? row.id
    : entityId(row as ScoreConfig | Scorer);
}

function rowDescription(row: AnyRow) {
  if (props.activeTab === "jobs")
    return (
      (row as EvalJob).description ||
      `Pipeline: ${valueOf(row, "pipelineId", "pipeline_id") || "pending"}`
    );
  if (props.activeTab === "scorers")
    return (row as Scorer).description || `${(row as Scorer).variables?.length || 0} variables`;
  if (props.activeTab === "scoreConfigs")
    return (row as ScoreConfig).description || `v${(row as ScoreConfig).version}`;
  return (row as Provider).endpoint || defaultModelOf(row as Provider);
}

function rowSecondary(row: AnyRow) {
  if (props.activeTab === "jobs")
    return `${(row as EvalJob).stream} (${streamTypeOf(row as EvalJob)})`;
  if (props.activeTab === "scorers")
    return scorerTypeOf(row as Scorer).replace("_", " ");
  if (props.activeTab === "scoreConfigs") return dataTypeOf(row as ScoreConfig);
  return providerTypeOf(row as Provider);
}

function rowStatus(row: AnyRow) {
  if (props.activeTab === "jobs") return statusOf(row as EvalJob);
  if (props.activeTab === "providers")
    return booleanOf(row, "isDefault", "is_default") ? "default" : "configured";
  return booleanOf(row, "isActive", "is_active") ? "active" : "inactive";
}

function rowUpdatedAt(row: AnyRow) {
  return Number(
    valueOf(row, "updatedAt", "updated_at") || valueOf(row, "createdAt", "created_at") || 0,
  );
}
</script>
