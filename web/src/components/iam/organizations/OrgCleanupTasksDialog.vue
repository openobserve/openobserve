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
  <ODialog
    :open="open"
    :title="t('iam.orgCleanupTasksDialog.deletionProgress', { orgName })"
    size="md"
    data-test="org-cleanup-tasks-dialog"
    @update:open="$emit('update:open', $event)"
  >
    <!-- ODialog has no #body slot; content goes in the default slot -->
    <div>
      <!-- Progress header: overall state chip + bar -->
      <div v-if="tasks.length" class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-text-body">
            {{
              t("iam.orgCleanupTasksDialog.stepsComplete", { done: doneCount, total: tasks.length })
            }}
          </span>
          <OBadge
            :variant="
              overallStatus === 'completed'
                ? 'success-soft'
                : overallStatus === 'failed'
                  ? 'error-soft'
                  : 'primary-soft'
            "
            size="sm"
          >
            <OIcon
              v-if="overallStatus === 'in_progress'"
              name="autorenew"
              size="xs"
              class="mr-1 animate-spin"
            />
            {{
              overallStatus === "completed"
                ? t("iam.orgCleanupTasksDialog.completed")
                : overallStatus === "failed"
                  ? t("iam.orgCleanupTasksDialog.failed")
                  : t("iam.orgCleanupTasksDialog.inProgress")
            }}
          </OBadge>
        </div>
        <OProgressBar :value="progressValue" :variant="progressBarVariant" size="sm" />
      </div>

      <!-- Loading -->
      <div v-if="loading && !tasks.length" class="py-8 text-center text-text-secondary text-sm">
        {{ t("iam.orgCleanupTasksDialog.loading") }}
      </div>

      <!-- Empty -->
      <div v-else-if="!tasks.length" class="py-8 text-center text-text-secondary text-sm">
        {{ t("iam.orgCleanupTasksDialog.noTasks") }}
      </div>

      <!-- Task rows -->
      <div v-else class="space-y-1.5">
        <template v-for="row in displayRows" :key="row.key">
          <!-- Collapsed group header (e.g. the per-stream delete steps) -->
          <div
            v-if="row.type === 'group'"
            class="flex flex-col rounded-default"
            :class="rowAccentClass(row.status)"
          >
            <!-- Clickable summary line -->
            <button
              type="button"
              class="flex items-center gap-3 px-3 py-2 w-full text-left bg-transparent border-0 cursor-pointer"
              :aria-expanded="expandedGroups[row.key] ? 'true' : 'false'"
              :data-test="`org-cleanup-group-${row.key}`"
              @click="toggleGroup(row.key)"
            >
              <!-- Expand/collapse chevron -->
              <OIcon
                :name="expandedGroups[row.key] ? 'expand_more' : 'chevron_right'"
                size="sm"
                class="text-text-secondary"
              />

              <!-- Group status icon -->
              <OIcon
                :name="statusIcon(row.status)"
                size="sm"
                :class="{
                  'text-success': row.status === 'done',
                  'text-primary animate-spin': row.status === 'running',
                  'text-error': row.status === 'failed',
                  'text-text-secondary': row.status === 'pending',
                }"
              />

              <!-- Group label + child count -->
              <span class="flex-1 font-medium text-sm text-text-body min-w-0 truncate">
                {{ row.label }}
                <span class="text-text-secondary font-normal">({{ row.children.length }})</span>
              </span>

              <!-- Aggregate progress e.g. "8/10" -->
              <span class="text-text-secondary text-xs tabular-nums whitespace-nowrap">
                {{ row.doneCount }}/{{ row.children.length }}
              </span>

              <!-- Group status badge -->
              <OBadge :variant="badgeVariant(row.status)" size="sm" class="whitespace-nowrap">
                {{ row.status }}
              </OBadge>
            </button>

            <!-- Expanded children -->
            <div v-if="expandedGroups[row.key]" class="px-3 pb-2 space-y-1">
              <div
                v-for="child in row.children"
                :key="child.id"
                class="flex flex-col gap-1 pl-6 pr-2 py-1.5 rounded-default"
                :class="rowAccentClass(child.status)"
              >
                <div class="flex items-center gap-3">
                  <OIcon
                    :name="statusIcon(child.status)"
                    size="xs"
                    :class="{
                      'text-success': child.status === 'done',
                      'text-primary animate-spin': child.status === 'running',
                      'text-error': child.status === 'failed',
                      'text-text-secondary': child.status === 'pending',
                    }"
                  />
                  <span class="flex-1 text-sm text-text-body min-w-0 truncate">
                    {{ streamChildLabel(child.step) }}
                  </span>
                  <span
                    v-if="child.attempts > 0"
                    class="text-text-secondary text-xs tabular-nums whitespace-nowrap"
                    :title="t('iam.orgCleanupTasksDialog.attempts', { n: child.attempts })"
                  >
                    {{ child.attempts }}×
                  </span>
                  <OBadge :variant="badgeVariant(child.status)" size="sm" class="whitespace-nowrap">
                    {{ child.status }}
                  </OBadge>
                </div>
                <div
                  v-if="child.last_error"
                  class="ml-6 text-xs text-error bg-surface-secondary rounded-default px-2 py-1 break-words whitespace-pre-wrap"
                >
                  {{ child.last_error }}
                </div>
              </div>
            </div>
          </div>

          <!-- Regular single-step row -->
          <div
            v-else
            class="flex flex-col gap-1 px-3 py-2 rounded-default"
            :class="rowAccentClass(row.task.status)"
          >
            <div class="flex items-center gap-3">
              <!-- Status icon -->
              <OIcon
                :name="statusIcon(row.task.status)"
                size="sm"
                :class="{
                  'text-success': row.task.status === 'done',
                  'text-primary animate-spin': row.task.status === 'running',
                  'text-error': row.task.status === 'failed',
                  'text-text-secondary': row.task.status === 'pending',
                }"
              />

              <!-- Step name -->
              <span class="flex-1 font-medium text-sm text-text-body min-w-0 truncate">
                {{ formatStepName(row.task.step) }}
              </span>

              <!-- Attempts (only when relevant) -->
              <span
                v-if="row.task.attempts > 0"
                class="text-text-secondary text-xs tabular-nums whitespace-nowrap"
                :title="t('iam.orgCleanupTasksDialog.attempts', { n: row.task.attempts })"
              >
                {{ row.task.attempts }}×
              </span>

              <!-- Status badge -->
              <OBadge :variant="badgeVariant(row.task.status)" size="sm" class="whitespace-nowrap">
                {{ row.task.status }}
              </OBadge>
            </div>

            <!-- Error message — full, wrapping, contained (no cut-off) -->
            <div
              v-if="row.task.last_error"
              class="ml-8 text-xs text-error bg-surface-secondary rounded-default px-2 py-1 break-words whitespace-pre-wrap"
            >
              {{ row.task.last_error }}
            </div>
          </div>
        </template>
      </div>

      <!-- Refresh hint while in progress -->
      <div
        v-if="tasks.length && overallStatus === 'in_progress'"
        class="mt-3 text-xs text-text-secondary flex items-center gap-1.5"
      >
        <OIcon name="autorenew" size="xs" class="animate-spin" />
        <span>{{ t("iam.orgCleanupTasksDialog.refreshingEvery5s") }}</span>
      </div>
      <div v-else-if="tasks.length && overallStatus === 'failed'" class="mt-3 text-xs text-error">
        {{ t("iam.orgCleanupTasksDialog.stepsFailedPermanently", { n: failedCount }) }}
      </div>
    </div>

    <template #footer>
      <OButton variant="outline" size="sm" @click="$emit('update:open', false)">
        {{ t("iam.orgCleanupTasksDialog.close") }}
      </OButton>
      <OButton variant="ghost" size="sm" :disabled="loading" @click="fetchTasks">
        <OIcon name="refresh" size="sm" />
        {{ t("iam.orgCleanupTasksDialog.refresh") }}
      </OButton>
    </template>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import organizationsService from "@/services/organizations";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

interface CleanupTask {
  id: string;
  org_id: string;
  org_name: string;
  step: string;
  step_order: number;
  status: string;
  attempts: number;
  last_error?: string | null;
  created_at: number;
  updated_at: number;
}

export default defineComponent({
  name: "OrgCleanupTasksDialog",
  components: { ODialog, OButton, OBadge, OIcon, OProgressBar },
  props: {
    open: { type: Boolean, required: true },
    orgId: { type: String, required: true },
    orgName: { type: String, default: "" },
  },
  emits: ["update:open"],
  setup(props) {
    const { t } = useI18n();
    const tasks = ref<CleanupTask[]>([]);
    const loading = ref(false);
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const sortedTasks = computed(() =>
      [...tasks.value].sort((a, b) => a.step_order - b.step_order),
    );

    // Which collapsible groups are expanded. Collapsed by default; state is keyed
    // by group key so it survives poll refreshes.
    const expandedGroups = ref<Record<string, boolean>>({});
    const toggleGroup = (key: string) => {
      expandedGroups.value[key] = !expandedGroups.value[key];
    };

    // Aggregate a group's status from its children: failed if any failed, running
    // if any running, done only if all done, else pending.
    const aggregateStatus = (children: CleanupTask[]): string => {
      if (children.some((c) => c.status === "failed")) return "failed";
      if (children.some((c) => c.status === "running")) return "running";
      if (children.length && children.every((c) => c.status === "done")) return "done";
      return "pending";
    };

    // Build the render list: consecutive `delete_stream:*` tasks collapse into one
    // group row; every other task stays a standalone row. Order follows step_order.
    const displayRows = computed(() => {
      const rows: any[] = [];
      const streamChildren = sortedTasks.value.filter((t) => t.step.startsWith("delete_stream:"));
      let groupInserted = false;

      for (const task of sortedTasks.value) {
        if (task.step.startsWith("delete_stream:")) {
          // Emit a single group row at the position of the first stream task.
          if (!groupInserted) {
            groupInserted = true;
            rows.push({
              type: "group",
              key: "delete_streams_group",
              label: t("iam.orgCleanupTasksDialog.deleteStreams"),
              children: streamChildren,
              status: aggregateStatus(streamChildren),
              doneCount: streamChildren.filter((c) => c.status === "done").length,
            });
          }
          continue;
        }
        rows.push({ type: "task", key: task.id, task });
      }
      return rows;
    });

    // "delete_stream:logs/app_logs" → "logs/app_logs"
    const streamChildLabel = (step: string): string => {
      const idx = step.indexOf(":");
      return idx >= 0 ? step.slice(idx + 1) : step;
    };

    const doneCount = computed(() => tasks.value.filter((t) => t.status === "done").length);

    const failedCount = computed(
      () => tasks.value.filter((t) => t.status === "failed" && t.attempts >= 10).length,
    );

    const isComplete = computed(
      () => tasks.value.length > 0 && tasks.value.every((t) => t.status === "done"),
    );

    const hasFailed = computed(() => failedCount.value > 0 && isComplete.value === false);

    // Progress fraction (0–1) for the bar.
    const progressValue = computed(() =>
      tasks.value.length ? doneCount.value / tasks.value.length : 0,
    );

    // Overall state: completed / failed / in-progress — drives the header chip + bar colour.
    const overallStatus = computed<"completed" | "failed" | "in_progress">(() => {
      if (isComplete.value) return "completed";
      if (hasFailed.value) return "failed";
      return "in_progress";
    });

    const progressBarVariant = computed<"default" | "warning" | "danger">(() => {
      if (overallStatus.value === "completed") return "default";
      if (overallStatus.value === "failed") return "danger";
      return "default";
    });

    // Per-row left accent tint by status — gives a quick visual scan.
    const rowAccentClass = (status: string): string => {
      switch (status) {
        case "done":
          return "border border-border-default";
        case "running":
          return "border border-border-default bg-surface-secondary";
        case "failed":
          return "border border-error";
        default:
          return "border border-border-default";
      }
    };

    // Status icon name per state.
    const statusIcon = (status: string): string => {
      switch (status) {
        case "done":
          return "check_circle";
        case "running":
          return "autorenew";
        case "failed":
          return "error";
        default:
          return "schedule"; // pending
      }
    };

    const fetchTasks = async () => {
      if (!props.orgId) return;
      loading.value = true;
      try {
        const res = await organizationsService.get_cleanup_tasks(props.orgId);
        tasks.value = res.data ?? [];
      } catch (e) {
        // silently fail — next poll will retry
      } finally {
        loading.value = false;
      }
    };

    const startPolling = () => {
      stopPolling();
      fetchTasks();
      pollTimer = setInterval(() => {
        if (!isComplete.value) fetchTasks();
      }, 5000);
    };

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          tasks.value = [];
          startPolling();
        } else {
          stopPolling();
        }
      },
    );

    onUnmounted(stopPolling);

    const formatStepName = (step: string): string => {
      // "delete_stream:logs/mystream" → "Delete stream: logs/mystream"
      if (step.includes(":")) {
        const [prefix, rest] = step.split(":", 2);
        return `${prefix.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}: ${rest}`;
      }
      return step.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    };

    const badgeVariant = (status: string): BadgeVariant => {
      switch (status) {
        case "done":
          return "success";
        case "running":
          return "primary";
        case "failed":
          return "error";
        default:
          return "default-outline"; // pending
      }
    };

    return {
      t,
      tasks,
      loading,
      sortedTasks,
      displayRows,
      expandedGroups,
      toggleGroup,
      streamChildLabel,
      doneCount,
      failedCount,
      isComplete,
      hasFailed,
      progressValue,
      overallStatus,
      progressBarVariant,
      rowAccentClass,
      statusIcon,
      fetchTasks,
      formatStepName,
      badgeVariant,
    };
  },
});
</script>
