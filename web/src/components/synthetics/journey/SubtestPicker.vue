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
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { formatDistanceToNowStrict } from "date-fns";
import { raw, useI18nTyped } from "@/types/i18n";
import syntheticsService from "@/services/synthetics";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { resolveBadgeLabel } from "@/lib/core/Badge/badgeGroups";
import { syntheticsFolderName } from "@/utils/synthetics/routes";
import { MAX_STEPS } from "@/utils/synthetics/runBudget";

/**
 * `ownStepCount` is the EXECUTED count of the journey as it stands, not
 * `journey.length`: the warning and the 50-step cap are both measured in
 * executed steps, so a parent that already holds one reference must not
 * report its authored count when it executes more.
 *
 * It already includes this reference's own expansion, so it is the `after` figure; when the
 * host cannot expand the journey it is `undefined` and the delta is withheld, never guessed.
 */
const props = defineProps<{
  modelValue?: { id: string; name?: string };
  /** Shown for an `{ id }`-only persisted reference until the list supplies the real row. */
  fallbackName?: string;
  ownCheckId?: string;
  ownStepCount?: number;
  journeyBudgetMs?: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: { id: string; name: string } | undefined];
}>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed(() => store.state.selectedOrganization.identifier as string);

const DEFAULT_JOURNEY_BUDGET_MS = 300_000;

interface ListRow {
  id: string;
  name: string;
  type: string;
  folder_id?: string;
  steps?: number | null;
  referenced_by?: number;
  references?: number | null;
  enabled?: boolean;
  status?: string;
  last_check_at?: number | null;
}

const listOptions = ref<SelectOption[]>([]);
const isLoading = ref(true);
/** True only once the list has loaded and holds no other browser test. */
const isEmpty = ref(false);
// OSelect renders the raw value when no option matches, so the saved name is seeded until the list has it.
const options = computed<SelectOption[]>(() => {
  const saved = props.modelValue;
  const name = saved?.name ?? props.fallbackName;
  if (!saved || !name || listOptions.value.some((o) => o.value === saved.id)) {
    return listOptions.value;
  }
  return [{ label: raw(name), value: saved.id }, ...listOptions.value];
});
const childSteps = ref<number | null>(null);
const lastRunSeconds = ref<number | null>(null);

/** Everything on a row comes from the list response — nothing costs a request per option. */
function rowOption(r: ListRow): SelectOption {
  const folders = store.state.organizationData?.foldersByType?.synthetics ?? [];
  const steps =
    r.steps != null ? t("synthetics.journey.subtest.pickSteps", { count: r.steps }) : "";
  const usedByCount = r.referenced_by ?? 0;
  const usedBy =
    usedByCount > 0
      ? t("synthetics.journey.subtest.pickUsedBy", { count: usedByCount }, usedByCount)
      : "";
  const paused = r.enabled === false ? resolveBadgeLabel("alertStatus", "paused") : "";
  const lastRun =
    r.last_check_at && r.status !== "unknown"
      ? t("synthetics.journey.subtest.pickLastRun", {
          status: resolveBadgeLabel("serviceStatus", r.status),
          ago: formatDistanceToNowStrict(new Date(r.last_check_at / 1000), { addSuffix: true }),
        })
      : "";
  return {
    label: raw(r.name),
    value: r.id,
    badge: syntheticsFolderName(folders, r.folder_id),
    badgeMuted: true,
    subLabel: raw([steps, usedBy, paused, lastRun].filter(Boolean).join(" · ")),
  };
}

onMounted(async () => {
  try {
    // undefined omits ?folder= so every folder is listed: references are cross-folder by design.
    const res = await syntheticsService.listByFolderId(org.value, undefined);
    const rows = ((res.data.checks ?? []) as ListRow[]).filter(
      (r) => r.type === "browser" && r.id !== props.ownCheckId,
    );
    // Nesting is one level deep, so a check that already holds a reference is shown but not pickable.
    listOptions.value = rows.map((r) =>
      (r.references ?? 0) > 0
        ? { ...rowOption(r), disabled: true, subLabel: t("synthetics.journey.subtest.pickNested") }
        : rowOption(r),
    );
    isEmpty.value = rows.length === 0;
  } catch (err) {
    console.error("[synthetics] failed to load browser tests for the subtest picker", err);
    toast({ variant: "error", message: t("synthetics.journey.subtest.pickLoadFailed") });
  } finally {
    isLoading.value = false;
  }
});

async function onPick(id: string) {
  const check = (await syntheticsService.get(org.value, id)).data;
  const runs = (await syntheticsService.getRuns(org.value, id, { page_size: 1 })).data.runs ?? [];
  const last = runs[0];
  emit("update:modelValue", { id, name: check.name });
  // Written after the emit and in one tick: a half-applied pick would render this component's
  // new child against the host's previous count.
  childSteps.value = check.config?.steps?.length ?? 0;
  lastRunSeconds.value = last?.completed_at
    ? Math.round((last.completed_at - last.created_at) / 1_000_000)
    : null;
}

const after = computed(() => props.ownStepCount);
const before = computed(() => {
  const child = childSteps.value ?? 0;
  // A count smaller than the child it is supposed to contain has not caught up with this pick.
  if (after.value === undefined || after.value < child) return undefined;
  return after.value - child;
});
const budgetSeconds = computed(() =>
  Math.round((props.journeyBudgetMs ?? DEFAULT_JOURNEY_BUDGET_MS) / 1000),
);
// A recent run within 80% of the allowance is close enough to worth flagging
// before it starts being cut short by the runner.
const isSlow = computed(
  () => lastRunSeconds.value !== null && lastRunSeconds.value > budgetSeconds.value * 0.8,
);
</script>

<template>
  <div class="flex w-full flex-col gap-2" data-test="synthetics-subtest-picker">
    <OSelect
      :model-value="modelValue?.id"
      :label="t('synthetics.journey.subtest.pickLabel')"
      :options="options"
      :loading="isLoading"
      :disabled="isEmpty"
      class="w-full"
      data-test="synthetics-subtest-select"
      @update:model-value="(v) => onPick(v as string)"
    />
    <p v-if="isEmpty" class="text-text-secondary m-0 text-xs" data-test="synthetics-subtest-empty">
      {{ t("synthetics.journey.subtest.pickEmpty") }}
    </p>

    <div v-if="childSteps !== null" class="flex flex-col gap-1">
      <p
        v-if="before !== undefined"
        class="text-text-secondary m-0 text-xs"
        data-test="synthetics-subtest-delta"
      >
        {{
          t("synthetics.journey.subtest.delta", {
            name: modelValue?.name ?? "",
            before,
            after,
            limit: MAX_STEPS,
          })
        }}
      </p>
      <p
        v-else
        class="text-text-secondary m-0 text-xs"
        data-test="synthetics-subtest-delta-unknown"
      >
        {{ t("synthetics.journey.subtest.deltaUnknown") }}
      </p>
      <p
        v-if="lastRunSeconds !== null"
        class="m-0 text-xs"
        :class="isSlow ? 'text-status-warning-text' : 'text-text-secondary'"
        data-test="synthetics-subtest-lastrun"
      >
        {{
          t("synthetics.journey.subtest.lastRun", {
            seconds: lastRunSeconds,
            budget: budgetSeconds,
          })
        }}
      </p>
      <!-- Silence would be indistinguishable from a broken warning, so say it is unknown. -->
      <p
        v-else
        class="text-text-secondary m-0 text-xs"
        data-test="synthetics-subtest-lastrun-unknown"
      >
        {{ t("synthetics.journey.subtest.lastRunUnknown") }}
      </p>
      <!-- The remedy comes before the number, mirroring validate_browser_config's
           convention of naming the fix before the figure that triggered it. -->
      <p
        v-if="isSlow"
        class="text-status-warning-text m-0 text-xs"
        data-test="synthetics-subtest-raise-budget"
      >
        {{ t("synthetics.journey.subtest.raiseBudget") }}
      </p>
    </div>
  </div>
</template>
