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
  LibraryDrawer — one library alert in full, and the decision to install it.

  Opening it is the second (and only other) GET the library makes: the gallery
  renders entirely from the manifest, and the query, the trigger and the row
  template arrive with the file.

  Two things it deliberately does NOT do. It never rewrites query text — the
  library stores exports of real alerts, so a threshold living inside a
  `HAVING` is shown locked and handed to "Customize in editor" rather than
  edited through a form field (settled decision 2). And it does not install:
  that is the wizard's job, so the primary button announces the intent and
  Phase 4 answers it.
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
          :variant="ready ? 'success-soft' : 'default-soft'"
          size="xs"
          :icon="ready ? 'check-circle' : 'sensors-off'"
          :label="
            ready
              ? t('alert_library.drawer.dataAvailable')
              : t('alert_library.drawer.streamNotFound')
          "
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
        v-if="!ready"
        variant="warning"
        icon="sensors-off"
        dense
        :content="t('alert_library.drawer.needsDataCallout', { stream: entry.stream })"
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
          <OCodeBlock
            :code="queryText"
            :lang="codeLang"
            wrap
            :max-lines="14"
            :copy-message="t('alert_library.drawer.queryCopied')"
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

            <dt class="text-text-secondary">{{ t("alert_library.drawer.condition") }}</dt>
            <dd class="text-text-body font-mono" data-test="alert-library-drawer-condition">
              {{ conditionText }}
            </dd>

            <dt class="text-text-secondary">{{ t("alert_library.drawer.libraryId") }}</dt>
            <dd class="text-text-body font-mono break-all" data-test="alert-library-drawer-id">
              {{ entry.id }}
            </dd>

            <dt class="text-text-secondary">{{ t("alert_library.drawer.contentHash") }}</dt>
            <dd class="text-text-body font-mono break-all" data-test="alert-library-drawer-hash">
              {{ entry.content_hash }}
            </dd>

            <dt class="text-text-secondary">{{ t("alert_library.drawer.installsAs") }}</dt>
            <dd class="text-text-body" data-test="alert-library-drawer-priority">
              {{ priorityText }}
              <span class="text-text-secondary text-2xs block">
                {{ t("alert_library.drawer.installsAsHint") }}
              </span>
            </dd>
          </dl>
        </section>

        <section data-test="alert-library-drawer-tunables">
          <h3
            class="text-text-secondary text-2xs flex items-center gap-1.5 pb-1 font-semibold uppercase"
          >
            <OIcon name="tune" size="xs" />
            <span>{{ t("alert_library.drawer.tunables") }}</span>
          </h3>
          <p class="text-text-secondary pb-3 text-xs">
            {{ t("alert_library.drawer.tunablesHint") }}
          </p>

          <!-- PromQL alerts carry the real threshold in a field BESIDE the query,
               which is why 69 of 87 alerts are fully tunable without touching text. -->
          <div v-if="hasPromqlCondition" class="pb-3">
            <p class="text-text-body pb-1 text-xs font-medium">
              {{ t("alert_library.drawer.metricCondition") }}
            </p>
            <p class="text-text-secondary pb-2 text-xs">
              {{ t("alert_library.drawer.metricConditionHint") }}
            </p>
            <div class="grid gap-3 sm:grid-cols-2">
              <OSelect
                :model-value="tunables.promqlOperator ?? '>='"
                :options="operatorOptions"
                size="sm"
                :label="t('alert_library.drawer.operator')"
                data-test="alert-library-drawer-promql-operator"
                @update:model-value="setOperator($event)"
              />
              <OInput
                type="number"
                size="sm"
                :model-value="tunables.promqlValue ?? 0"
                :label="t('alert_library.drawer.threshold')"
                data-test="alert-library-drawer-promql-value"
                @update:model-value="setTunable('promqlValue', $event)"
              />
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <OInput
              type="number"
              size="sm"
              :model-value="tunables.threshold"
              :label="t('alert_library.drawer.threshold')"
              :help-text="thresholdHint"
              data-test="alert-library-drawer-threshold"
              @update:model-value="setTunable('threshold', $event)"
            />
            <OInput
              type="number"
              size="sm"
              :model-value="tunables.period"
              :label="t('alert_library.drawer.period')"
              :suffix="minutesSuffix"
              :help-text="t('alert_library.drawer.periodHint')"
              data-test="alert-library-drawer-period"
              @update:model-value="setTunable('period', $event)"
            />
            <OInput
              type="number"
              size="sm"
              :model-value="tunables.frequency"
              :label="t('alert_library.drawer.frequency')"
              :suffix="minutesSuffix"
              :help-text="t('alert_library.drawer.frequencyHint')"
              data-test="alert-library-drawer-frequency"
              @update:model-value="setTunable('frequency', $event)"
            />
            <OInput
              type="number"
              size="sm"
              :model-value="tunables.silence"
              :label="t('alert_library.drawer.silence')"
              :suffix="minutesSuffix"
              :help-text="t('alert_library.drawer.silenceHint')"
              data-test="alert-library-drawer-silence"
              @update:model-value="setTunable('silence', $event)"
            />
          </div>

          <!-- Locked, not hidden: the number is real and the user needs to see it
               to decide whether the editor is worth opening. -->
          <div v-if="locked" class="pt-3" data-test="alert-library-drawer-locked">
            <div class="flex items-center gap-2 pb-1">
              <span class="text-text-body text-xs font-medium">
                {{ t("alert_library.drawer.groupThreshold") }}
              </span>
              <OTag
                variant="default-soft"
                size="xs"
                icon="lock"
                :label="t('alert_library.drawer.readOnly')"
                data-test="alert-library-drawer-locked-tag"
              />
            </div>
            <OCode block data-test="alert-library-drawer-locked-clause">{{ locked.clause }}</OCode>
            <p class="text-text-secondary pt-1 text-xs">
              {{ t("alert_library.drawer.groupThresholdHint") }}
            </p>
            <OBanner
              variant="info"
              icon="info-outline"
              dense
              class="mt-2"
              :content="t('alert_library.drawer.lockedCallout')"
            />
          </div>
        </section>

        <section>
          <h3
            class="text-text-secondary text-2xs flex items-center gap-1.5 pb-2 font-semibold uppercase"
          >
            <OIcon name="bolt" size="xs" />
            <span>{{ t("alert_library.drawer.notificationPreview") }}</span>
          </h3>
          <OCode v-if="rowTemplate" block data-test="alert-library-drawer-row-template">{{
            rowTemplate
          }}</OCode>
          <p v-else class="text-text-secondary text-xs">
            {{ t("alert_library.drawer.noRowTemplate") }}
          </p>
        </section>

        <section data-test="alert-library-drawer-preview">
          <h3
            class="text-text-secondary text-2xs flex items-center gap-1.5 pb-2 font-semibold uppercase"
          >
            <OIcon name="query-stats" size="xs" />
            <span>{{ t("alert_library.drawer.runPreviewTitle") }}</span>
          </h3>

          <p v-if="!ready" class="text-text-secondary text-xs">
            {{ t("alert_library.drawer.runPreviewBlocked", { stream: entry.stream }) }}
          </p>
          <p v-else-if="!previewStarted" class="text-text-secondary text-xs">
            {{ t("alert_library.drawer.runPreviewIdle") }}
          </p>
          <template v-else>
            <OTag
              v-if="evaluation"
              :variant="evaluation.wouldTrigger ? 'error-soft' : 'success-soft'"
              size="xs"
              class="mb-2"
              :label="
                evaluation.wouldTrigger
                  ? t('alert_library.drawer.wouldTrigger')
                  : t('alert_library.drawer.wouldNotTrigger')
              "
              data-test="alert-library-drawer-evaluation"
            />
            <PreviewAlert
              ref="previewRef"
              :query="queryText"
              :form-data="previewFormData"
              :is-aggregation-enabled="isAggregationEnabled"
              :selected-tab="codeLang"
              :is-using-backend-sql="false"
              :is-editor-open="false"
            />
          </template>
        </section>

        <section>
          <h3
            class="text-text-secondary text-2xs flex items-center gap-1.5 pb-2 font-semibold uppercase"
          >
            <OIcon name="menu-book" size="xs" />
            <span>{{ t("alert_library.drawer.remediation") }}</span>
          </h3>
          <p class="text-text-secondary text-xs" data-test="alert-library-drawer-remediation">
            {{ t("alert_library.drawer.remediationEmpty") }}
          </p>
          <OButton
            v-if="entry.docs_url"
            variant="ghost-primary"
            size="sm"
            icon-left="open-in-new"
            class="mt-1"
            data-test="alert-library-drawer-runbook"
            @click="openRunbook"
          >
            {{ t("alert_library.drawer.remediationDocs") }}
          </OButton>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="play-arrow"
          :disabled="!file || !ready"
          data-test="alert-library-drawer-run-preview"
          @click="runPreview"
        >
          {{ t("alert_library.drawer.runPreview") }}
        </OButton>
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

import PreviewAlert from "@/components/alerts/PreviewAlert.vue";
import { priorityForSeverity } from "@/constants/alertLibrary";
import { useAlertCreation } from "@/composables/alerts/useAlertCreation";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { raw, useI18nTyped } from "@/types/i18n";
import { buildPrefillFromLibrary } from "@/utils/alerts/prefill/fromLibrary";

import { categoryLabel, packLabel, severityBadgeValue, severityLabel } from "./libraryFacets";
import {
  DEFAULT_TUNABLES,
  NUMERIC_OPERATORS,
  applyTunables,
  lockedSqlThreshold,
  readTunables,
  type LibraryTunables,
  type LockedSqlThreshold,
} from "./libraryTunables";

const props = defineProps<{
  open: boolean;
  /** `null` while nothing is selected — the drawer keeps its mount, not its data. */
  entry: AlertLibraryEntry | null;
  /** Whether every stream this alert queries exists in the org. */
  ready: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  /** Phase 4 owns the wizard; this hands it a file the drawer has already tuned. */
  (e: "install", payload: { entry: AlertLibraryEntry; file: AlertLibraryFile }): void;
}>();

const { t } = useI18nTyped();
const { loadAlertFile } = useAlertLibrary();
const { openAlertCreation } = useAlertCreation();

const file = ref<AlertLibraryFile | null>(null);
const isLoading = ref(false);
const loadFailed = ref(false);
const tunables = ref<LibraryTunables>({ ...DEFAULT_TUNABLES });
const locked = ref<LockedSqlThreshold | null>(null);
const previewStarted = ref(false);
const previewRef = ref<{
  refreshData: () => void;
  evaluationStatus: { wouldTrigger: boolean; reason: string } | null;
} | null>(null);

/** Only the newest open may write the state; an abandoned fetch is discarded. */
let loadToken = 0;

const reset = () => {
  file.value = null;
  loadFailed.value = false;
  locked.value = null;
  previewStarted.value = false;
  tunables.value = { ...DEFAULT_TUNABLES };
};

const load = async (entry: AlertLibraryEntry) => {
  const token = ++loadToken;
  reset();
  isLoading.value = true;
  try {
    const loaded = await loadAlertFile(entry);
    if (token !== loadToken) return;
    file.value = loaded;
    tunables.value = readTunables(loaded);
    locked.value = lockedSqlThreshold(loaded);
  } catch {
    if (token !== loadToken) return;
    loadFailed.value = true;
  } finally {
    if (token === loadToken) isLoading.value = false;
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
const minutesSuffix = computed(() => t("alert_library.drawer.minutes"));

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

const rowTemplate = computed(() =>
  typeof file.value?.row_template === "string" ? file.value.row_template : "",
);

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

/** The trigger as one line — `>= 3`, the same shape the alert list shows. */
const conditionText = computed(() => {
  const operator = triggerCondition.value.operator;
  return raw(`${typeof operator === "string" ? operator : ">="} ${tunables.value.threshold}`);
});

const priorityText = computed(() => {
  const priority = priorityForSeverity(props.entry?.severity ?? "");
  return priority === null
    ? t("alert_library.drawer.installsAsUnset")
    : t("alert_library.drawer.installsAsPriority", { priority });
});

const hasPromqlCondition = computed(() => tunables.value.promqlOperator !== null);
const operatorOptions = computed(() => NUMERIC_OPERATORS.map((operator) => raw(operator)));

const thresholdHint = computed(() => {
  const operator = triggerCondition.value.operator;
  const params = { operator: typeof operator === "string" ? operator : ">=" };
  return isPromql.value
    ? t("alert_library.drawer.thresholdHintPromql", params)
    : t("alert_library.drawer.thresholdHintSql", params);
});

// ── tuning ─────────────────────────────────────────────────────────────────
type NumericTunable = "threshold" | "period" | "frequency" | "silence" | "promqlValue";

const setTunable = (key: NumericTunable, value: string | number) => {
  const next = typeof value === "number" ? value : Number(value);
  tunables.value = { ...tunables.value, [key]: Number.isFinite(next) ? next : 0 };
};

const setOperator = (value: unknown) => {
  if (typeof value !== "string") return;
  tunables.value = { ...tunables.value, promqlOperator: value };
};

/** What install and the editor actually receive — never the fetched copy. */
const tunedFile = computed<AlertLibraryFile | null>(() =>
  file.value ? applyTunables(file.value, tunables.value) : null,
);

// ── preview ────────────────────────────────────────────────────────────────
// PreviewAlert emits nothing; it is driven through the ref it exposes. The
// form data it reads must carry stream, query and trigger or refreshData()
// silently returns.
const previewFormData = computed(() => ({
  stream_name: streamName.value,
  stream_type: streamType.value,
  query_condition: asRecord(tunedFile.value?.query_condition),
  trigger_condition: asRecord(tunedFile.value?.trigger_condition),
}));

const isAggregationEnabled = computed(
  () => Object.keys(asRecord(queryCondition.value.aggregation)).length > 0,
);

const evaluation = computed(() => previewRef.value?.evaluationStatus ?? null);

const runPreview = async () => {
  previewStarted.value = true;
  await nextTick();
  previewRef.value?.refreshData();
};

// ── actions ────────────────────────────────────────────────────────────────
const customize = () => {
  if (!props.entry || !tunedFile.value) return;

  const opened = openAlertCreation(
    buildPrefillFromLibrary({ entry: props.entry, file: tunedFile.value }),
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

const openRunbook = () => {
  if (props.entry?.docs_url) window.open(props.entry.docs_url, "_blank", "noopener");
};
</script>
