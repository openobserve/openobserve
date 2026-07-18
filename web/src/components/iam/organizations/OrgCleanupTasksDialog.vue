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
      <div v-if="tasks.length" class="tw:mb-4">
        <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
          <span class="tw:text-sm tw:font-medium tw:text-text-primary">
            {{ t('iam.orgCleanupTasksDialog.stepsComplete', { done: doneCount, total: tasks.length }) }}
          </span>
          <OBadge
            :variant="overallStatus === 'completed' ? 'success-soft' : overallStatus === 'failed' ? 'error-soft' : 'primary-soft'"
            size="sm"
          >
            <OIcon
              v-if="overallStatus === 'in_progress'"
              name="autorenew"
              size="xs"
              class="tw:mr-1 tw:animate-spin"
            />
            {{ overallStatus === 'completed' ? t('iam.orgCleanupTasksDialog.completed') : overallStatus === 'failed' ? t('iam.orgCleanupTasksDialog.failed') : t('iam.orgCleanupTasksDialog.inProgress') }}
          </OBadge>
        </div>
        <OProgressBar :value="progressValue" :variant="progressBarVariant" size="sm" />
      </div>

      <!-- Loading -->
      <div v-if="loading && !tasks.length" class="tw:py-8 tw:text-center tw:text-text-secondary tw:text-sm">
        {{ t('iam.orgCleanupTasksDialog.loading') }}
      </div>

      <!-- Empty -->
      <div v-else-if="!tasks.length" class="tw:py-8 tw:text-center tw:text-text-secondary tw:text-sm">
        {{ t('iam.orgCleanupTasksDialog.noTasks') }}
      </div>

      <!-- Task rows -->
      <div v-else class="tw:space-y-1.5">
        <template v-for="row in displayRows" :key="row.key">
          <!-- Collapsed group header (e.g. the per-stream delete steps) -->
          <div
            v-if="row.type === 'group'"
            class="tw:flex tw:flex-col tw:rounded"
            :class="rowAccentClass(row.status)"
          >
            <!-- Clickable summary line -->
            <button
              type="button"
              class="tw:flex tw:items-center tw:gap-3 tw:px-3 tw:py-2 tw:w-full tw:text-left tw:bg-transparent tw:border-0 tw:cursor-pointer"
              :aria-expanded="expandedGroups[row.key] ? 'true' : 'false'"
              :data-test="`org-cleanup-group-${row.key}`"
              @click="toggleGroup(row.key)"
            >
              <!-- Expand/collapse chevron -->
              <OIcon
                :name="expandedGroups[row.key] ? 'expand_more' : 'chevron_right'"
                size="sm"
                class="tw:text-text-secondary"
              />

              <!-- Group status icon -->
              <OIcon
                :name="statusIcon(row.status)"
                size="sm"
                :class="{
                  'tw:text-success': row.status === 'done',
                  'tw:text-primary tw:animate-spin': row.status === 'running',
                  'tw:text-error': row.status === 'failed',
                  'tw:text-text-secondary': row.status === 'pending',
                }"
              />

              <!-- Group label + child count -->
              <span class="tw:flex-1 tw:font-medium tw:text-sm tw:text-text-primary tw:min-w-0 tw:truncate">
                {{ row.label }}
                <span class="tw:text-text-secondary tw:font-normal">({{ row.children.length }})</span>
              </span>

              <!-- Aggregate progress e.g. "8/10" -->
              <span class="tw:text-text-secondary tw:text-xs tabular-nums tw:whitespace-nowrap">
                {{ row.doneCount }}/{{ row.children.length }}
              </span>

              <!-- Group status badge -->
              <OBadge :variant="badgeVariant(row.status)" size="sm" class="tw:whitespace-nowrap">
                {{ row.status }}
              </OBadge>
            </button>

            <!-- Expanded children -->
            <div v-if="expandedGroups[row.key]" class="tw:px-3 tw:pb-2 tw:space-y-1">
              <div
                v-for="child in row.children"
                :key="child.id"
                class="tw:flex tw:flex-col tw:gap-1 tw:pl-6 tw:pr-2 tw:py-1.5 tw:rounded"
                :class="rowAccentClass(child.status)"
              >
                <div class="tw:flex tw:items-center tw:gap-3">
                  <OIcon
                    :name="statusIcon(child.status)"
                    size="xs"
                    :class="{
                      'tw:text-success': child.status === 'done',
                      'tw:text-primary tw:animate-spin': child.status === 'running',
                      'tw:text-error': child.status === 'failed',
                      'tw:text-text-secondary': child.status === 'pending',
                    }"
                  />
                  <span class="tw:flex-1 tw:text-sm tw:text-text-primary tw:min-w-0 tw:truncate">
                    {{ streamChildLabel(child.step) }}
                  </span>
                  <span
                    v-if="child.attempts > 0"
                    class="tw:text-text-secondary tw:text-xs tabular-nums tw:whitespace-nowrap"
                    :title="t('iam.orgCleanupTasksDialog.attempts', { n: child.attempts })"
                  >
                    {{ child.attempts }}×
                  </span>
                  <OBadge :variant="badgeVariant(child.status)" size="sm" class="tw:whitespace-nowrap">
                    {{ child.status }}
                  </OBadge>
                </div>
                <div
                  v-if="child.last_error"
                  class="tw:ml-6 tw:text-xs tw:text-error tw:bg-surface-secondary tw:rounded tw:px-2 tw:py-1 tw:break-words tw:whitespace-pre-wrap"
                >
                  {{ child.last_error }}
                </div>
              </div>
            </div>
          </div>

          <!-- Regular single-step row -->
          <div
            v-else
            class="tw:flex tw:flex-col tw:gap-1 tw:px-3 tw:py-2 tw:rounded"
            :class="rowAccentClass(row.task.status)"
          >
            <div class="tw:flex tw:items-center tw:gap-3">
              <!-- Status icon -->
              <OIcon
                :name="statusIcon(row.task.status)"
                size="sm"
                :class="{
                  'tw:text-success': row.task.status === 'done',
                  'tw:text-primary tw:animate-spin': row.task.status === 'running',
                  'tw:text-error': row.task.status === 'failed',
                  'tw:text-text-secondary': row.task.status === 'pending',
                }"
              />

              <!-- Step name -->
              <span class="tw:flex-1 tw:font-medium tw:text-sm tw:text-text-primary tw:min-w-0 tw:truncate">
                {{ formatStepName(row.task.step) }}
              </span>

              <!-- Attempts (only when relevant) -->
              <span
                v-if="row.task.attempts > 0"
                class="tw:text-text-secondary tw:text-xs tabular-nums tw:whitespace-nowrap"
                :title="t('iam.orgCleanupTasksDialog.attempts', { n: row.task.attempts })"
              >
                {{ row.task.attempts }}×
              </span>

              <!-- Status badge -->
              <OBadge :variant="badgeVariant(row.task.status)" size="sm" class="tw:whitespace-nowrap">
                {{ row.task.status }}
              </OBadge>
            </div>

            <!-- Error message — full, wrapping, contained (no cut-off) -->
            <div
              v-if="row.task.last_error"
              class="tw:ml-8 tw:text-xs tw:text-error tw:bg-surface-secondary tw:rounded tw:px-2 tw:py-1 tw:break-words tw:whitespace-pre-wrap"
            >
              {{ row.task.last_error }}
            </div>
          </div>
        </template>
      </div>

      <!-- Refresh hint while in progress -->
      <div
        v-if="tasks.length && overallStatus === 'in_progress'"
        class="tw:mt-3 tw:text-xs tw:text-text-secondary tw:flex tw:items-center tw:gap-1.5"
      >
        <OIcon name="autorenew" size="xs" class="tw:animate-spin" />
        <span>{{ t('iam.orgCleanupTasksDialog.refreshingEvery5s') }}</span>
      </div>
      <div
        v-else-if="tasks.length && overallStatus === 'failed'"
        class="tw:mt-3 tw:text-xs tw:text-error"
      >
        {{ t('iam.orgCleanupTasksDialog.stepsFailedPermanently', { n: failedCount }) }}
      </div>
    </div>

    <template #footer>
      <OButton variant="outline" size="sm" @click="$emit('update:open', false)">
        {{ t('iam.orgCleanupTasksDialog.close') }}
      </OButton>
      <OButton variant="ghost" size="sm" :disabled="loading" @click="fetchTasks">
        <OIcon name="refresh" size="sm" />
        {{ t('iam.orgCleanupTasksDialog.refresh') }}
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
      [...tasks.value].sort((a, b) => a.step_order - b.step_order)
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
      const streamChildren = sortedTasks.value.filter((t) =>
        t.step.startsWith("delete_stream:")
      );
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

    const doneCount = computed(() =>
      tasks.value.filter((t) => t.status === "done").length
    );

    const failedCount = computed(() =>
      tasks.value.filter(
        (t) => t.status === "failed" && t.attempts >= 10
      ).length
    );

    const isComplete = computed(() =>
      tasks.value.length > 0 && tasks.value.every((t) => t.status === "done")
    );

    const hasFailed = computed(() => failedCount.value > 0 && isComplete.value === false);

    // Progress fraction (0–1) for the bar.
    const progressValue = computed(() =>
      tasks.value.length ? doneCount.value / tasks.value.length : 0
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
          return "tw:border tw:border-border-default";
        case "running":
          return "tw:border tw:border-border-default tw:bg-surface-secondary";
        case "failed":
          return "tw:border tw:border-error";
        default:
          return "tw:border tw:border-border-default";
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
      }
    );

    onUnmounted(stopPolling);

    const formatStepName = (step: string): string => {
      // "delete_stream:logs/mystream" → "Delete stream: logs/mystream"
      if (step.includes(":")) {
        const [prefix, rest] = step.split(":", 2);
        return `${prefix.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}: ${rest}`;
      }
      return step
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
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
