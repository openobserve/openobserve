<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  What an alert-based SLI has actually measured (S-16 §2), drawn from the
  availability ledger.

  A ribbon rather than a chart, because the reading is categorical and there
  are THREE states, not two: the alert was OK, the alert was firing, or the
  alert was not evaluating at all. That third band is the point of the whole
  feature — "OK for 3h" and "paused for 3h" have to look different, and grey is
  how they do. It is also why the tally names its own denominator: the SLI is
  over measured time, and a percentage that hides how much of the window that
  was is the misreading this component exists to prevent.

  Used both in the form, where it answers "what would this source give me?"
  before anything is saved, and on the detail page, where it answers "where did
  the coverage go?".
-->
<template>
  <div class="flex flex-col gap-2" data-test="slos-sloalertpreview-root">
    <div
      class="rounded-default border-border-default flex flex-col overflow-hidden border"
      data-test="slos-sloalertpreview-panel"
    >
      <PanelBar class="w-full justify-between gap-2">
        <span>{{ t("slos.alertSli.preview.title") }}</span>
        <span v-if="tally" class="font-normal tabular-nums" data-test="slos-sloalertpreview-tally">
          {{ tally }}
        </span>
      </PanelBar>

      <div
        v-if="loading"
        class="flex h-16 items-center justify-center"
        data-test="slos-sloalertpreview-loading"
      >
        <OSpinner size="sm" />
      </div>
      <div
        v-else-if="error"
        class="text-text-secondary flex h-16 items-center justify-center px-4 text-center text-sm"
        data-test="slos-sloalertpreview-error"
      >
        {{ error }}
      </div>
      <div
        v-else-if="!hasHistory"
        class="text-text-secondary flex h-16 items-center justify-center px-4 text-center text-sm"
        data-test="slos-sloalertpreview-empty"
      >
        {{ t("slos.alertSli.preview.noHistory") }}
      </div>
      <template v-else>
        <div class="p-2">
          <div class="bg-surface-subtle rounded-default relative h-6 w-full overflow-hidden">
            <div
              v-for="(band, i) in bands"
              :key="i"
              class="absolute inset-y-0"
              :class="BAND_CLASS[band.state]"
              :style="{ left: `${band.startPct}%`, width: `${band.widthPct}%` }"
              :data-state="band.state"
              data-test="slos-sloalertpreview-band"
            />
          </div>
        </div>
        <!-- The SLI above is over MEASURED time. Below the coverage floor the
             saved SLO reports no data at all, so without this the panel would
             promise a reading the SLO will refuse to give. -->
        <div
          v-if="preview?.would_freeze"
          class="border-border-default text-warning border-t px-2 py-1 text-xs"
          data-test="slos-sloalertpreview-would-freeze"
        >
          {{ t("slos.alertSli.preview.wouldFreeze") }}
        </div>
        <div
          class="border-border-default text-text-secondary flex gap-4 border-t px-2 py-1 text-xs"
          data-test="slos-sloalertpreview-legend"
        >
          <span v-for="item in legend" :key="item.state" class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-full" :class="BAND_CLASS[item.state]" />
            {{ item.label }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";

import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import sloService from "@/services/slos";
import { formatCoverage } from "@/composables/useSloFormat";
import { type UptimeBandState, uptimeBands } from "@/utils/slos/alertSource";
import type { AlertSliPreview } from "@/ts/interfaces/slo";

const props = defineProps<{
  /** The source alert. Empty means "nothing picked yet" — no request is made. */
  alertId: string;
  windowSecs: number;
  sliceIntervalSecs: number;
}>();

const { t } = useI18nTyped();
const store = useStore();

const preview = ref<AlertSliPreview | null>(null);
const loading = ref(false);
const error = ref("");

const BAND_CLASS: Record<UptimeBandState, string> = {
  good: "bg-status-positive",
  bad: "bg-status-negative",
  // Grey, and deliberately not a third signal colour: unmeasured is the
  // absence of a reading, not a milder verdict.
  unmeasured: "bg-surface-subtle-hover",
};

const legend = computed(() => [
  { state: "good" as const, label: t("slos.alertSli.preview.legendGood") },
  { state: "bad" as const, label: t("slos.alertSli.preview.legendBad") },
  { state: "unmeasured" as const, label: t("slos.alertSli.preview.legendUnmeasured") },
]);

const hasHistory = computed(() => (preview.value?.intervals.length ?? 0) > 0);

const bands = computed(() =>
  preview.value
    ? uptimeBands(
        preview.value.intervals,
        preview.value.range_start_secs,
        preview.value.range_end_secs,
      )
    : [],
);

/** The SLI next to the fraction of the window it was computed over. */
const tally = computed(() => {
  const p = preview.value;
  if (!p || !hasHistory.value || p.sli === null) return null;
  return t("slos.alertSli.preview.tally", {
    sli: p.sli.toFixed(1),
    coverage: formatCoverage(p.coverage),
  });
});

// Only the newest request may write the answer. The inputs change faster than
// the requests return — picking a source also rewrites the slice — so without
// this a slow earlier response lands last and the ribbon describes a window
// the form is no longer set to, with nothing to say so.
let latestRequest = 0;

async function load() {
  const mine = ++latestRequest;
  const org = store.state.selectedOrganization?.identifier;
  if (!org || !props.alertId) {
    preview.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await sloService.alertPreview(org, props.alertId, {
      window_secs: props.windowSecs,
      slice_interval_secs: props.sliceIntervalSecs,
    });
    if (mine !== latestRequest) return;
    preview.value = (res.data ?? null) as AlertSliPreview | null;
  } catch (e: unknown) {
    if (mine !== latestRequest) return;
    preview.value = null;
    error.value =
      raw((e as { response?: { data?: { message?: string } } })?.response?.data?.message) ||
      t("slos.alertSli.preview.loadFailed");
  } finally {
    // A superseded request must not clear the spinner the new one is showing.
    if (mine === latestRequest) loading.value = false;
  }
}

// Not debounced: every input here is a discrete pick, and the slice changes as
// a side effect of choosing a source — so a stale preview would describe a
// configuration other than the one about to be saved.
watch(() => [props.alertId, props.windowSecs, props.sliceIntervalSecs], load);
onMounted(load);
</script>
