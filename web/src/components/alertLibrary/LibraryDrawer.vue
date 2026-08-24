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
  LibraryDrawer — one library alert in full: what it detects, and the query it
  would run.

  Opening it is the second (and only other) GET the library makes: the gallery
  renders entirely from the manifest, and the query arrives with the file.

  It never rewrites query text. The library stores exports of real alerts, so
  the query is shown exactly as published and handed to "Customize in editor"
  for any change (settled decision 2).
-->
<template>
  <ODrawer
    :open="open"
    size="xl"
    :title="drawerTitle"
    :sub-title="drawerSubtitle"
    title-data-test="alert-library-drawer-title"
    data-test="alert-library-drawer"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="entry" class="flex flex-col gap-5">
      <div class="flex flex-wrap items-center gap-1.5">
        <OTag
          type="severity"
          size="xs"
          :value="severityValue"
          :label="severityText"
          data-test="alert-library-drawer-severity"
        />
        <OTag
          variant="default-soft"
          size="xs"
          :label="queryTypeLabel"
          data-test="alert-library-drawer-query-type"
        />
        <OTag
          :variant="availability.variant"
          size="xs"
          :icon="availability.icon"
          :label="availability.label"
          data-test="alert-library-drawer-availability"
        />
      </div>

      <section>
        <h3 class="text-text-secondary text-2xs pb-1 font-semibold uppercase">
          {{ t("alert_library.drawer.detects") }}
        </h3>
        <p class="text-text-body text-sm" data-test="alert-library-drawer-description">
          {{ entry.description || t("alert_library.drawer.noDescription") }}
        </p>
      </section>

      <!-- Stated before the query, not after: an alert that cannot fire is the
           first thing worth knowing about it. -->
      <OBanner
        v-if="availability.callout"
        variant="warning"
        icon="sensors-off"
        dense
        :content="availability.callout"
        data-test="alert-library-drawer-needs-data"
      />

      <OBanner
        v-if="loadFailed"
        variant="error"
        icon="warning-amber"
        dense
        :content="t('alert_library.drawer.loadFailed')"
        data-test="alert-library-drawer-load-failed"
      />

      <div
        v-else-if="isLoading"
        class="flex flex-col gap-3"
        data-test="alert-library-drawer-loading"
      >
        <span class="sr-only">{{ t("alert_library.drawer.loading") }}</span>
        <OSkeleton type="rect" class="rounded-default h-24 w-full" />
        <OSkeleton type="rect" class="rounded-default h-32 w-full" />
      </div>

      <template v-else-if="file">
        <section>
          <h3
            class="text-text-secondary text-2xs flex items-center gap-1.5 pb-2 font-semibold uppercase"
          >
            <OIcon name="code" size="xs" />
            <span>{{ t("alert_library.drawer.query") }}</span>
          </h3>
          <AlertQueryPreview
            :query="queryText"
            :language="codeLang"
            data-test="alert-library-drawer-query"
          />

          <dl
            class="mt-3 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-xs"
            data-test="alert-library-drawer-kv"
          >
            <dt class="text-text-secondary">{{ t("alert_library.drawer.stream") }}</dt>
            <dd class="text-text-body font-mono break-all">{{ streamName }}</dd>

            <dt class="text-text-secondary">{{ t("alert_library.drawer.streamType") }}</dt>
            <dd class="text-text-body font-mono">{{ streamType }}</dd>

            <dt class="text-text-secondary">{{ thresholdLabel }}</dt>
            <dd class="text-text-body font-mono" data-test="alert-library-drawer-threshold">
              {{ thresholdText }}
            </dd>
          </dl>
        </section>

        <section data-test="alert-library-drawer-preview">
          <h3
            class="text-text-secondary text-2xs flex items-center gap-1.5 pb-2 font-semibold uppercase"
          >
            <OIcon name="query-stats" size="xs" />
            <span>{{ t("alerts.preview") }}</span>
            <template v-if="evaluation">
              <OTag
                :variant="evaluation.wouldTrigger ? 'error-soft' : 'success-soft'"
                size="xs"
                :label="
                  evaluation.wouldTrigger
                    ? t('alert_library.drawer.wouldTrigger')
                    : t('alert_library.drawer.wouldNotTrigger')
                "
                data-test="alert-library-drawer-evaluation"
              />
              <span class="text-text-secondary normal-case">{{ raw(evaluation.reason) }}</span>
            </template>
          </h3>

          <p v-if="!ready" class="text-text-secondary text-xs">
            {{ t("alert_library.drawer.previewBlocked", { stream: entry.stream }) }}
          </p>
          <!-- PanelSchemaRenderer draws its own loading bar, "No Data" and error
               message, so the drawer adds no second set of those states. -->
          <div v-else class="h-64">
            <PreviewAlert
              :key="previewRunId"
              ref="previewRef"
              class="h-full w-full"
              :query="queryText"
              :form-data="previewFormData"
              :is-aggregation-enabled="isAggregationEnabled"
              :selected-tab="codeLang"
              :is-using-backend-sql="false"
              :is-editor-open="false"
            />
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="edit"
          :disabled="!file"
          :title="t('alert_library.drawer.customizeHint')"
          data-test="alert-library-drawer-customize"
          @click="customize"
        >
          {{ t("alert_library.drawer.customize") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="download"
          :disabled="!file"
          data-test="alert-library-drawer-install"
          @click="install"
        >
          {{ t("alert_library.drawer.install") }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import AlertQueryPreview from "@/components/alerts/AlertQueryPreview.vue";
import PreviewAlert from "@/components/alerts/PreviewAlert.vue";
import { useAlertCreation } from "@/composables/alerts/useAlertCreation";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type { AlertLibraryEntry, AlertLibraryFile, StreamDataState } from "@/types/alertLibrary";
import { formatDistanceToNowStrict } from "date-fns";
import { raw, useI18nTyped } from "@/types/i18n";
import { buildPrefillFromLibrary } from "@/utils/alerts/prefill/fromLibrary";

import { categoryLabel, packLabel, severityBadgeValue, severityLabel } from "./libraryFacets";
import { readTunables, applyTunables } from "./libraryTunables";

const props = defineProps<{
  open: boolean;
  /** `null` while nothing is selected — the drawer keeps its mount, not its data. */
  entry: AlertLibraryEntry | null;
  /** Whether every stream this alert queries exists in the org. */
  ready: boolean;
  /** What those streams would actually give it — see streamDataState. */
  dataState?: StreamDataState;
  /** Microsecond epoch of their oldest last-ingest, when they have one. */
  lastIngestedMicros?: number | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  /** The wizard owns install; this hands it the file the drawer fetched. */
  (e: "install", payload: { entry: AlertLibraryEntry; file: AlertLibraryFile }): void;
}>();

const { t } = useI18nTyped();
const { loadAlertFile } = useAlertLibrary();
const { openAlertCreation } = useAlertCreation();

const file = ref<AlertLibraryFile | null>(null);
const isLoading = ref(false);
const loadFailed = ref(false);
/** Bumped per open so the chart remounts instead of showing the last alert's. */
const previewRunId = ref(0);
const previewRef = ref<{
  refreshData: () => void;
  evaluationStatus: { wouldTrigger: boolean; reason: string } | null;
} | null>(null);

/** Only the newest open may write the state; an abandoned fetch is discarded. */
let loadToken = 0;

const reset = () => {
  file.value = null;
  loadFailed.value = false;
};

const load = async (entry: AlertLibraryEntry) => {
  const token = ++loadToken;
  reset();
  isLoading.value = true;
  try {
    const loaded = await loadAlertFile(entry);
    if (token !== loadToken) return;
    file.value = loaded;
  } catch {
    if (token !== loadToken) return;
    loadFailed.value = true;
  } finally {
    if (token === loadToken) isLoading.value = false;
  }

  // After the skeleton is gone, or the chart it must drive is not mounted yet.
  if (token === loadToken && file.value) {
    previewRunId.value += 1;
    await runPreview();
  }
};

watch(
  // Keyed on the content hash too, so a republished alert reloads rather than
  // showing the copy that was open when it changed.
  () => [props.open, props.entry?.id, props.entry?.content_hash] as const,
  ([open, id]) => {
    if (!open || !id || !props.entry) {
      loadToken += 1;
      reset();
      return;
    }
    void load(props.entry);
  },
  { immediate: true },
);

// ── display ────────────────────────────────────────────────────────────────
const drawerTitle = computed(() => raw(props.entry?.title ?? ""));

const drawerSubtitle = computed(() => {
  const entry = props.entry;
  if (!entry) return raw("");
  return raw(`${entry.id} · ${categoryLabel(entry.category)} · ${packLabel(entry.pack)}`);
});

const severityValue = computed(() => severityBadgeValue(props.entry?.severity ?? ""));
const severityText = computed(() => severityLabel(t, props.entry?.severity ?? ""));
// A query language, not prose — one correct form worldwide.
const queryTypeLabel = computed(() => raw(String(props.entry?.query_type ?? "").toUpperCase()));

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const queryCondition = computed(() => asRecord(file.value?.query_condition));
const triggerCondition = computed(() => asRecord(file.value?.trigger_condition));

const isPromql = computed(
  () => (queryCondition.value.type ?? props.entry?.query_type) === "promql",
);
const codeLang = computed<"sql" | "promql">(() => (isPromql.value ? "promql" : "sql"));

const queryText = computed(() => {
  const query = isPromql.value ? queryCondition.value.promql : queryCondition.value.sql;
  return typeof query === "string" ? query : "";
});

const streamName = computed(() =>
  typeof file.value?.stream_name === "string"
    ? file.value.stream_name
    : (props.entry?.stream ?? ""),
);
const streamType = computed(() =>
  typeof file.value?.stream_type === "string"
    ? file.value.stream_type
    : (props.entry?.stream_type ?? ""),
);

/**
 * The number that decides whether the alert fires. PromQL alerts keep it in a
 * structured field beside the query; SQL alerts have only the row count the
 * trigger compares.
 */
const tunables = computed(() => (file.value ? readTunables(file.value) : null));

/**
 * The file with readTunables' floors written back — what the preview evaluates
 * and what install receives.
 *
 * A published file may carry `period: 0` or `threshold: 0`, or no
 * `trigger_condition` at all (`assertAlertFile` only checks it is an object).
 * Raw, that previews over a zero-length window — or an `undefined` relative time
 * that reaches the search API as `new Date(NaN)` — and installs an alert that
 * fires on every evaluation. It would also contradict the panel above it, which
 * shows the FLOORED threshold.
 */
const tunedFile = computed(() =>
  file.value && tunables.value ? applyTunables(file.value, tunables.value) : null,
);
const tunedQueryCondition = computed(() => asRecord(tunedFile.value?.query_condition));
const tunedTriggerCondition = computed(() => asRecord(tunedFile.value?.trigger_condition));

const thresholdLabel = computed(() =>
  tunables.value?.promqlOperator != null
    ? t("alert_library.drawer.metricCondition")
    : t("alert_library.drawer.matchCount"),
);

const thresholdText = computed(() => {
  const current = tunables.value;
  if (!current) return raw("");
  if (current.promqlOperator !== null) {
    return raw(`${current.promqlOperator} ${current.promqlValue ?? 0}`);
  }
  const operator = triggerCondition.value.operator;
  return raw(`${typeof operator === "string" ? operator : ">="} ${current.threshold}`);
});

/**
 * The one place the stream posture is turned into words.
 *
 * "The stream exists" and "the stream has data" are different answers, and only
 * the first was ever shown: an alert on a stream created months ago and never
 * written to read "Data available" and previewed as "would not fire", which
 * blames the alert for a gap in ingestion.
 */
const availability = computed(() => {
  const state: StreamDataState = props.ready ? (props.dataState ?? "fresh") : "missing";
  const stream = props.entry?.stream ?? "";

  if (state === "missing") {
    return {
      variant: "default-soft" as const,
      icon: "sensors-off",
      label: t("alert_library.drawer.streamNotFound"),
      callout: t("alert_library.drawer.needsDataCallout", { stream }),
    };
  }
  if (state === "never") {
    return {
      variant: "default-soft" as const,
      icon: "sensors-off",
      label: t("alert_library.drawer.neverIngested"),
      callout: t("alert_library.drawer.neverIngestedCallout", { stream }),
    };
  }
  if (state === "stale") {
    return {
      variant: "warning-quiet" as const,
      icon: "schedule",
      label: t("alert_library.drawer.lastData", { when: lastIngestedLabel.value }),
      callout: t("alert_library.drawer.staleCallout", {
        stream,
        when: lastIngestedLabel.value,
      }),
    };
  }
  return {
    variant: "success-soft" as const,
    icon: "check-circle",
    label: t("alert_library.drawer.dataAvailable"),
    callout: null,
  };
});

// Relative ("3 days ago"), the same reading the streams list gives — an absolute
// timestamp makes the reader do the subtraction that is the point of showing it.
const lastIngestedLabel = computed(() => {
  if (!props.lastIngestedMicros) return t("alert_library.drawer.unknownTime");
  return raw(
    formatDistanceToNowStrict(new Date(props.lastIngestedMicros / 1000), {
      addSuffix: true,
    }),
  );
});

// ── preview ────────────────────────────────────────────────────────────────
// PreviewAlert reads stream, query and trigger off this; without all four
// refreshData() silently returns.
const previewFormData = computed(() => ({
  stream_name: streamName.value,
  stream_type: streamType.value,
  query_condition: tunedQueryCondition.value,
  trigger_condition: tunedTriggerCondition.value,
}));

const isAggregationEnabled = computed(
  () => Object.keys(asRecord(tunedQueryCondition.value.aggregation)).length > 0,
);

const evaluation = computed(() => previewRef.value?.evaluationStatus ?? null);

/**
 * PreviewAlert evaluates itself on mount for SQL, but deliberately skips PromQL
 * there and waits for the alert form's watcher — which the drawer has no
 * equivalent of, so it starts that case through the exposed ref.
 */
const runPreview = async () => {
  await nextTick();
  if (isPromql.value) previewRef.value?.refreshData();
};

// The chart is mounted behind `v-if="ready"`, so a file that loads while the
// stream is still missing has nothing to start. Refreshing the gallery can flip
// readiness afterwards, mounting PreviewAlert for the first time — and its own
// onMounted deliberately skips PromQL. Without this it would sit blank forever.
watch(
  () => props.ready,
  (isReady, was) => {
    if (isReady && !was && file.value) {
      previewRunId.value += 1;
      void runPreview();
    }
  },
);

// ── actions ────────────────────────────────────────────────────────────────
const customize = () => {
  if (!props.entry || !file.value) return;

  const opened = openAlertCreation(
    buildPrefillFromLibrary({ entry: props.entry, file: file.value }),
  );
  if (!opened) {
    toast({ variant: "error", message: t("alert_library.drawer.customizeFailed") });
    return;
  }
  emit("update:open", false);
};

const install = () => {
  if (!props.entry || !tunedFile.value) return;
  emit("install", { entry: props.entry, file: tunedFile.value });
};
</script>
