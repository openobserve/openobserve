<template>
  <section class="online-evals__list">
    <div class="online-evals__toolbar">
      <div class="online-evals__search">
        <OIcon name="search" size="xs" />
        <input
          :value="search"
          :placeholder="`Search ${tabLabel.toLowerCase()}`"
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
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="degraded">Degraded</option>
          <option value="archived">Archived</option>
        </select>

        <OButton
          icon-left="refresh"
          variant="outline"
          size="sm"
          :loading="isLoading"
          @click="$emit('refresh')"
        >
          Refresh
        </OButton>
        <OButton icon-left="add" size="sm" @click="$emit('create')">
          {{ createButtonLabel }}
        </OButton>
      </div>
    </div>

    <div v-if="rows.length === 0" class="online-evals__empty">
      <OIcon name="rule" size="md" />
      <strong>No {{ tabLabel.toLowerCase() }} found</strong>
      <span>Create one to start wiring online evaluation.</span>
    </div>

    <div v-else class="online-evals__table">
      <div class="online-evals__thead" :class="tableClass">
        <span>Name</span>
        <span>{{ secondaryColumnLabel }}</span>
        <span>Status</span>
        <span>Updated</span>
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
            title="Edit"
            @click="$emit('edit', row)"
          />
          <OButton
            icon-left="delete"
            variant="ghost-destructive"
            size="icon-sm"
            title="Delete"
            @click="$emit('delete', row)"
          />
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
