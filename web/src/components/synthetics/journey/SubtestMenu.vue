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

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SubtestRef } from "@/types/synthetics";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import SubtestMenuRow from "./SubtestMenuRow.vue";
import {
  candidateSummary,
  loadPickedSubtest,
  useSubtestCandidates,
  type SubtestCandidate,
} from "./useSubtestCandidates";

const props = defineProps<{
  ownCheckId?: string;
  /** The journey cannot take a new row right now (recording, replay, restore, readonly). */
  disabled: boolean;
}>();

const emit = defineEmits<{ pick: [child: SubtestRef] }>();

const { t } = useI18nTyped();

const open = ref(false);
const query = ref("");
const pickingId = ref<string | null>(null);
const searchRef = ref<HTMLElement | null>(null);
// Latched on first open so the page load never fetches the list; closing keeps the query alive.
const hasOpened = ref(false);

const { org, usable, blocked, isLoading, isEmpty, loadError, refetch } = useSubtestCandidates(
  () => props.ownCheckId,
  {
    enabled: hasOpened,
    onError: (err) =>
      console.error("[synthetics] failed to load browser tests for the subtest menu", err),
  },
);

const matches = (c: SubtestCandidate) =>
  c.name.toLowerCase().includes(query.value.trim().toLowerCase());
const visibleUsable = computed(() => usable.value.filter(matches));
const visibleBlocked = computed(() => blocked.value.filter(matches));
const noMatch = computed(
  () =>
    !isEmpty.value &&
    !loadError.value &&
    visibleUsable.value.length === 0 &&
    visibleBlocked.value.length === 0,
);

function rowSummary(c: SubtestCandidate) {
  return raw(candidateSummary([c.stepsLabel, c.usedByLabel, c.pausedLabel]));
}

watch(open, (isOpen) => {
  if (!isOpen) {
    query.value = "";
    return;
  }
  hasOpened.value = true;
  nextTick(() => searchRef.value?.querySelector("input")?.focus());
});

function onRetry() {
  void refetch();
}

async function onPick(c: SubtestCandidate) {
  if (pickingId.value) return;
  pickingId.value = c.id;
  try {
    const { reference } = await loadPickedSubtest(org.value, c.id, c.name);
    emit("pick", reference);
    open.value = false;
  } catch (err) {
    console.error("[synthetics] failed to load the picked browser test", err);
    toast({
      variant: "error",
      message: t("synthetics.journey.subtestMenu.pickFailed", { name: c.name }),
    });
  } finally {
    pickingId.value = null;
  }
}
</script>

<template>
  <OPopover
    v-model:open="open"
    side="bottom"
    align="start"
    :aria-label="t('synthetics.journey.addMenu.addSubtest')"
    content-class="w-[min(24rem,calc(100vw-1.5rem))]"
  >
    <template #trigger>
      <OButton
        variant="outline"
        size="xs"
        :disabled="disabled"
        data-test="synthetics-journey-add-subtest-btn"
      >
        <!-- First child so it anchors to the whole button; suppressed while the menu is open. -->
        <OTooltip
          :content="t('synthetics.journey.addMenu.subtestHint')"
          side="bottom"
          :disabled="open"
        />
        <OIcon name="account-tree" size="sm" aria-hidden="true" />
        <span>{{ t("synthetics.journey.addMenu.addSubtest") }}</span>
        <OIcon name="arrow-drop-down" size="sm" aria-hidden="true" />
      </OButton>
    </template>

    <div class="flex flex-col" data-test="synthetics-subtest-menu">
      <div class="flex flex-col gap-1 px-3 pt-3">
        <span class="text-text-heading text-sm font-semibold">
          {{ t("synthetics.journey.addMenu.addSubtest") }}
        </span>
        <span class="text-text-secondary text-xs">
          {{ t("synthetics.journey.subtestMenu.help") }}
        </span>
      </div>
      <div ref="searchRef" class="px-3 py-2">
        <OSearchInput
          v-model="query"
          :placeholder="t('synthetics.journey.subtestMenu.searchPlaceholder')"
          :aria-label="t('synthetics.journey.subtestMenu.searchPlaceholder')"
          data-test="synthetics-subtest-menu-search"
        />
      </div>

      <div class="flex max-h-80 min-h-0 flex-col overflow-y-auto px-1 pb-1">
        <div
          v-if="isLoading"
          class="text-text-secondary flex items-center justify-center gap-2 py-4 text-xs"
          role="status"
          data-test="synthetics-subtest-menu-loading"
        >
          <OSpinner size="sm" />
          <span>{{ t("synthetics.journey.subtestMenu.loading") }}</span>
        </div>
        <OEmptyState
          v-else-if="loadError"
          size="inline"
          icon="error"
          :title="t('synthetics.journey.subtest.pickLoadFailed')"
          :action-label="t('common.retry')"
          data-test="synthetics-subtest-menu-load-error"
          @action="onRetry"
        />
        <OEmptyState
          v-else-if="isEmpty"
          size="inline"
          icon="account-tree"
          :title="t('synthetics.journey.subtest.pickEmpty')"
          data-test="synthetics-subtest-menu-empty"
        />
        <OEmptyState
          v-else-if="noMatch"
          size="inline"
          icon="search"
          :title="t('synthetics.journey.subtestMenu.noMatch', { query: query.trim() })"
          data-test="synthetics-subtest-menu-no-match"
        />
        <template v-else>
          <SubtestMenuRow
            v-for="c in visibleUsable"
            :key="c.id"
            :title="raw(c.name)"
            :subtitle="rowSummary(c)"
            :loading="pickingId === c.id"
            :disabled="pickingId !== null && pickingId !== c.id"
            :aria-label="t('synthetics.journey.subtestMenu.addRow', { name: c.name })"
            :data-test="`synthetics-subtest-menu-row-${c.id}`"
            @select="onPick(c)"
          />
          <template v-if="visibleBlocked.length">
            <OSeparator class="my-1" />
            <span
              class="text-text-secondary px-3 py-1 text-xs"
              data-test="synthetics-subtest-menu-blocked-group"
            >
              {{ t("synthetics.journey.subtestMenu.blockedGroup") }}
            </span>
            <SubtestMenuRow
              v-for="c in visibleBlocked"
              :key="c.id"
              :title="raw(c.name)"
              :subtitle="t('synthetics.journey.subtest.pickNested')"
              disabled
              :data-test="`synthetics-subtest-menu-row-${c.id}`"
            />
          </template>
        </template>
      </div>

      <OSeparator />
      <p class="text-text-secondary m-0 flex items-center gap-2 px-3 py-2 text-xs">
        <OIcon name="info" size="sm" class="shrink-0" aria-hidden="true" />
        {{ t("synthetics.journey.subtestMenu.tip") }}
      </p>
    </div>
  </OPopover>
</template>
