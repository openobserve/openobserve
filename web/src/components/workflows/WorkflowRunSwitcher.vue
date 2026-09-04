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

<!--
  Shared run-history picker — a dropdown of a workflow's past runs, used both in
  the NDV header (read-only Runs view) and the editor toolbar. The trigger is
  supplied by the parent (an icon button in the NDV, a "History" button in the
  editor) via the #trigger slot; picking a run emits `select` so the parent loads
  it onto the canvas.

  The runs list is SHARED state (workflowObj.runsHistory), fetched once by the
  Runs page and reused here — no re-fetch on open unless the list is empty (an
  editor that never visited the Runs page). A titled header carries the
  ORefreshButton (its own "last refreshed" + staleness dot) to pull the latest.
  On open it auto-scrolls to the currently-loaded run so a long list lands on it.
-->
<template>
  <ODropdown v-model:open="open" align="start" side="bottom">
    <template #trigger>
      <slot name="trigger" />
    </template>
    <div class="w-72">
      <!-- Titled, with a refresh (its own dot + "last refreshed" relative time). -->
      <div
        class="border-border-default flex items-center justify-between gap-2 border-b px-2 py-1.5"
      >
        <span class="text-text-body truncate text-xs font-semibold">
          {{ t("workflow.history.title") }}
        </span>
        <ORefreshButton
          :last-run-at="workflowObj.runsHistory.fetchedAt || null"
          :loading="runsLoading"
          data-test="workflow-run-switcher-refresh"
          @click="refresh"
        />
      </div>
      <div ref="scrollEl" class="max-h-80 overflow-auto py-1">
        <ODropdownItem
          v-for="run in sortedRuns"
          :key="run.run_id"
          :data-test="`workflow-run-switcher-run-${run.run_id}`"
          :data-run-id="run.run_id"
          @click="onSelect(run.run_id)"
        >
          <div class="flex w-full items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-1.5">
              <OIcon
                v-if="run.run_id === currentRunId"
                name="check"
                size="xs"
                class="text-accent shrink-0"
              />
              <span v-else class="w-3.5 shrink-0" aria-hidden="true"></span>
              <OTimeCell
                :value="run.start_time"
                unit="us"
                mode="absolute"
                :timezone="store.state.timezone"
                :empty-label="raw('—')"
              />
            </span>
            <span class="flex shrink-0 items-center gap-1">
              <OBadge v-if="isTestRun(run)" variant="default-soft" size="xs">
                {{ t("workflow.history.testRun") }}
              </OBadge>
              <OBadge :variant="run.error ? 'error-soft' : 'success-soft'" size="xs">
                {{ run.error ? t("workflow.history.failed") : t("workflow.history.success") }}
              </OBadge>
            </span>
          </div>
          <!-- Hover a failed run to read WHY it failed without leaving the menu. -->
          <OTooltip
            v-if="run.error"
            :content="raw(String(run.error))"
            side="left"
            max-width="22rem"
          />
        </ODropdownItem>
        <div
          v-if="!sortedRuns.length"
          data-test="workflow-run-switcher-empty"
          class="text-text-secondary px-3 py-4 text-center text-xs italic"
        >
          {{ t("workflow.ndv.noRunsList") }}
        </div>
      </div>
      <!-- Rows are only ever withheld as a CLASS (test runs), so the menu says so
           and offers them back rather than shrinking silently. -->
      <div v-if="testRunCount > 0" class="border-border-default border-t px-2 py-1.5">
        <OButton
          variant="ghost"
          size="sm"
          class="w-full"
          data-test="workflow-run-switcher-show-test"
          @click="showTestRuns = !showTestRuns"
        >
          {{
            showTestRuns
              ? t("workflow.history.hideTestRuns")
              : t("workflow.history.showTestRuns", { count: hiddenTestRunCount })
          }}
        </OButton>
      </div>
      <!-- Optional footer (e.g. the editor's "Open Full Runs View" link). -->
      <div v-if="$slots.footer" class="border-border-default border-t px-2 py-1.5">
        <slot name="footer" />
      </div>
    </div>
  </ODropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { isTestRun, useTestRunVisibility } from "@/plugins/workflows/useWorkflowCanvas";
import { workflowObj, loadRunsHistory } from "@/plugins/workflows/useWorkflowCanvas";
import OButton from "@/lib/core/Button/OButton.vue";

const props = defineProps<{
  // The run currently loaded on the canvas — check-marked and auto-scrolled to.
  currentRunId: string;
  orgId: string;
  workflowId: string;
}>();
const emit = defineEmits<{ (e: "select", runId: string): void }>();

const { t } = useI18nTyped();
const store = useStore();

const open = ref(false);
const runsLoading = computed(() => workflowObj.runsHistory.loading);
// Shared with the Runs table so the two surfaces cannot disagree about what a
// published workflow's history should show.
const { showTestRuns, testRunCount, visibleRuns } = useTestRunVisibility();
// The run on the canvas stays listed even when hidden as a class, or the
// check-marked "current" row would vanish from its own menu.
const sortedRuns = computed(() =>
  visibleRuns(workflowObj.runsHistory.list)
    .concat(
      workflowObj.runsHistory.list.filter(
        (r: any) => r.run_id === props.currentRunId && isTestRun(r) && !showTestRuns.value,
      ),
    )
    .sort((a: any, b: any) => (b.start_time || 0) - (a.start_time || 0)),
);
// Only offered while runs are actually being withheld — a control that claims to
// hide something when nothing is hidden is noise.
const hiddenTestRunCount = computed(() => (showTestRuns.value ? 0 : testRunCount.value));

const fetchRuns = async () => {
  if (!props.workflowId || runsLoading.value) return;
  // Re-pull the window the Runs page fetched for; fall back to a wide 10y window
  // when this view was deep-linked / opened without the list ever being fetched.
  const { start, end } = workflowObj.runsHistory.params;
  const nowUs = Date.now() * 1000;
  await loadRunsHistory({
    orgId: props.orgId,
    workflowId: props.workflowId,
    start: start || nowUs - 10 * 365 * 24 * 60 * 60 * 1_000_000,
    end: end || nowUs,
  });
};
const refresh = () => fetchRuns();

const onSelect = (runId: string) => {
  open.value = false;
  if (!runId || runId === props.currentRunId) return;
  emit("select", runId);
};

// On open: fetch the list if we don't have one yet (an editor that never visited
// the Runs page), then scroll to the CURRENT run so a long list lands on it.
const scrollEl = ref<HTMLElement | null>(null);
watch(open, async (isOpen) => {
  if (!isOpen) return;
  if (!workflowObj.runsHistory.list.length) await fetchRuns();
  if (!props.currentRunId) return;
  await nextTick();
  const box = scrollEl.value;
  const row = box?.querySelector<HTMLElement>(`[data-run-id="${CSS.escape(props.currentRunId)}"]`);
  if (!box || !row) return;
  box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTop -= (box.clientHeight - row.clientHeight) / 2; // center it
});
</script>
