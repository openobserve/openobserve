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
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import syntheticsService from "@/services/synthetics";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import {
  candidateSummary,
  useSubtestCandidates,
  type SubtestCandidate,
} from "./useSubtestCandidates";

const props = defineProps<{
  ownCheckId?: string;
  /** The journey cannot take a new row right now (recording, replay, restore, readonly). */
  disabled: boolean;
  compositionEnabled: boolean;
}>();

const emit = defineEmits<{ pick: [child: { id: string; name: string }] }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed(() => store.state.selectedOrganization.identifier as string);

const open = ref(false);
const query = ref("");
const pickingId = ref<string | null>(null);
const searchRef = ref<HTMLElement | null>(null);
const hasLoaded = ref(false);

const { usable, blocked, isLoading, isEmpty, loadError, reload } = useSubtestCandidates(
  () => props.ownCheckId,
  {
    onError: (err) =>
      console.error("[synthetics] failed to load browser tests for the subtest menu", err),
  },
);

const triggerDisabled = computed(() => !props.compositionEnabled || props.disabled);
const tooltip = computed(() =>
  props.compositionEnabled
    ? t("synthetics.journey.addMenu.subtestHint")
    : t("synthetics.journey.subtest.disabledTooltip"),
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
  // Fetched once per mount: the list only changes when another test is saved elsewhere.
  if (!hasLoaded.value) {
    hasLoaded.value = true;
    void reload();
  }
  nextTick(() => searchRef.value?.querySelector("input")?.focus());
});

function onRetry() {
  void reload();
}

async function onPick(c: SubtestCandidate) {
  if (pickingId.value) return;
  pickingId.value = c.id;
  try {
    const check = (await syntheticsService.get(org.value, c.id)).data;
    emit("pick", { id: c.id, name: check.name ?? c.name });
    open.value = false;
  } catch (err) {
    // No emit: a pick whose GET failed would store a reference the journey cannot expand.
    console.error("[synthetics] failed to load the picked browser test", err);
    toast({ variant: "error", message: t("synthetics.journey.subtest.pickLoadFailed") });
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
        :disabled="triggerDisabled"
        data-test="synthetics-journey-add-subtest-btn"
      >
        <!-- First child so it anchors to the whole button; suppressed while the menu is open. -->
        <OTooltip :content="tooltip" side="bottom" :disabled="open" />
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
          <OButton
            v-for="c in visibleUsable"
            :key="c.id"
            variant="ghost"
            size="md"
            block
            class="h-auto! justify-start! py-2! text-start whitespace-normal!"
            :loading="pickingId === c.id"
            :disabled="pickingId !== null && pickingId !== c.id"
            :aria-label="t('synthetics.journey.subtestMenu.addRow', { name: c.name })"
            :data-test="`synthetics-subtest-menu-row-${c.id}`"
            @click="onPick(c)"
          >
            <OIcon name="account-tree" size="sm" class="text-text-secondary" aria-hidden="true" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="text-text-body truncate text-sm">{{ c.name }}</span>
              <span v-if="rowSummary(c)" class="text-text-secondary truncate text-xs font-normal">
                {{ rowSummary(c) }}
              </span>
            </span>
            <OIcon name="add" size="sm" class="text-text-secondary" aria-hidden="true" />
          </OButton>
          <template v-if="visibleBlocked.length">
            <OSeparator class="my-1" />
            <span
              class="text-text-secondary px-3 py-1 text-xs"
              data-test="synthetics-subtest-menu-blocked-group"
            >
              {{ t("synthetics.journey.subtestMenu.blockedGroup") }}
            </span>
            <OButton
              v-for="c in visibleBlocked"
              :key="c.id"
              variant="ghost"
              size="md"
              block
              disabled
              class="h-auto! justify-start! py-2! text-start whitespace-normal!"
              :data-test="`synthetics-subtest-menu-row-${c.id}`"
            >
              <OIcon name="account-tree" size="sm" aria-hidden="true" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm">{{ c.name }}</span>
                <span class="truncate text-xs font-normal">
                  {{ t("synthetics.journey.subtest.pickNested") }}
                </span>
              </span>
            </OButton>
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
