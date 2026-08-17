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
  Annotate a trace/span/session directly — no queue involved. The reviewer picks
  whichever dimensions they want to judge, fills them in, and saves them as ONE
  annotation (the API records every score under a single annotation id). Unlike
  the queue Workbench there is no bound set of dimensions and no N/N rule, so a
  partial pick is legitimate: you score what you have an opinion about.
-->
<template>
  <ODrawer
    :open="open"
    side="right"
    size="lg"
    :title="t('aiObservability.annotate.title', { scope: scopeLabel })"
    :primary-button-label="t('aiObservability.annotate.save')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!filledCount"
    :primary-button-loading="saving"
    data-test="annotate-drawer"
    @update:open="(value: boolean) => emit('update:open', value)"
    @click:primary="save"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <span class="text-text-heading min-w-0 truncate text-sm font-semibold">
          {{ targetLabel }}
        </span>
        <OTag variant="default-soft" shape="rounded" class="ml-auto shrink-0">
          {{ t("aiObservability.annotate.viaAnnotation") }}
        </OTag>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
          {{ t("aiObservability.annotate.addDimension") }}
        </span>
        <span class="text-text-secondary text-2xs">
          {{ t("aiObservability.annotate.addDimensionHint") }}
        </span>
        <OSelect
          :model-value="''"
          :options="availableOptions"
          label-key="label"
          value-key="value"
          searchable
          :loading="loadingConfigs"
          :placeholder="t('aiObservability.annotate.searchDimensions')"
          class="w-full"
          data-test="annotate-drawer-dimension-select"
          @update:model-value="addDimension"
        />
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-2xs font-semibold uppercase">
          {{
            picked.length
              ? t("aiObservability.annotate.toScoreFilled", {
                  filled: filledCount,
                  total: picked.length,
                })
              : t("aiObservability.annotate.toScore")
          }}
        </span>

        <div
          v-if="!picked.length"
          class="text-text-secondary flex flex-col items-center gap-1 py-10 text-center"
          data-test="annotate-drawer-empty"
        >
          <OIcon name="fact-check" class="text-text-disabled h-8 w-8" />
          <span class="text-sm">{{ t("aiObservability.annotate.emptyTitle") }}</span>
          <span class="text-xs">{{ t("aiObservability.annotate.emptyBody") }}</span>
        </div>

        <div
          v-for="dimension in picked"
          :key="dimension.rowId"
          class="border-border-default rounded-surface flex flex-col gap-2 border px-3 py-2.5"
          :data-test="`annotate-drawer-dimension-${dimension.id}`"
        >
          <div class="flex items-center gap-2">
            <span class="text-text-heading min-w-0 truncate font-mono text-sm font-semibold">
              {{ raw(dimension.name) }}
            </span>
            <OTag variant="default-soft" shape="rounded" class="shrink-0">
              {{ raw(dimension.dataType) }}
            </OTag>
            <OTag variant="default-outline" shape="rounded" class="shrink-0">
              {{ t("aiObservability.annotate.version", { version: dimension.version }) }}
            </OTag>
            <OButton
              variant="ghost"
              size="icon-xs"
              class="ml-auto"
              :aria-label="t('common.remove')"
              :data-test="`annotate-drawer-remove-${dimension.id}`"
              @click="removeDimension(dimension.rowId)"
            >
              <OIcon name="close" size="xs" />
            </OButton>
          </div>

          <!-- Numeric: the slider carries the config's own range and threshold. -->
          <template v-if="dimension.dataType === 'numeric'">
            <div class="flex items-baseline gap-2">
              <span
                class="font-mono text-lg font-bold"
                :class="isHealthy(dimension) ? 'text-text-heading' : 'text-status-warning-text'"
              >
                {{ numericDisplay(dimension) }}
              </span>
              <span class="text-text-secondary text-2xs ml-auto">
                {{
                  t("aiObservability.annotate.range", {
                    min: dimension.min,
                    max: dimension.max,
                  })
                }}
              </span>
            </div>
            <OSlider
              :model-value="Number(draft[dimension.rowId] ?? dimension.min)"
              :min="dimension.min"
              :max="dimension.max"
              :step="dimension.step"
              :data-test="`annotate-drawer-slider-${dimension.id}`"
              @update:model-value="(v: number | number[]) => setValue(dimension.rowId, v)"
            />
          </template>

          <!-- Categorical: one option per allowed category. -->
          <ORadioGroup
            v-else-if="dimension.dataType === 'categorical'"
            :model-value="String(draft[dimension.rowId] ?? '')"
            class="flex flex-wrap gap-3"
            :data-test="`annotate-drawer-categories-${dimension.id}`"
            @update:model-value="(v: unknown) => setValue(dimension.rowId, String(v ?? ''))"
          >
            <ORadio
              v-for="category in dimension.categories"
              :key="category"
              :value="category"
              :label="raw(category)"
            />
          </ORadioGroup>

          <ORadioGroup
            v-else
            :model-value="String(draft[dimension.rowId] ?? '')"
            class="flex gap-4"
            :data-test="`annotate-drawer-boolean-${dimension.id}`"
            @update:model-value="(v: unknown) => setValue(dimension.rowId, String(v ?? ''))"
          >
            <ORadio value="true" :label="t('aiObservability.queues.workbench.true')" />
            <ORadio value="false" :label="t('aiObservability.queues.workbench.false')" />
          </ORadioGroup>

          <OTextarea
            :model-value="reasons[dimension.rowId] ?? ''"
            :placeholder="t('aiObservability.annotate.reasonPlaceholder')"
            :rows="2"
            :data-test="`annotate-drawer-reason-${dimension.id}`"
            @update:model-value="(v: string) => (reasons[dimension.rowId] = v)"
          />
        </div>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmQueuesService, { type LlmScoreConfigOption } from "@/services/llm-queues.service";
import llmAnnotationsService, { type AnnotationScope } from "@/services/llm-annotations.service";

defineOptions({ name: "AnnotateDrawer" });

const props = defineProps<{
  open: boolean;
  scope: AnnotationScope;
  targetId: string;
  traceId?: string | null;
  sessionId?: string | null;
  /** The evaluated object's timestamp, MICROSECONDS. */
  refTimestamp: number;
  sourceStream: string;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "annotated"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

/** One pickable dimension, flattened to its LATEST pinned version. */
interface Dimension {
  id: string;
  rowId: string;
  name: string;
  dataType: string;
  version: number;
  categories: string[];
  min: number;
  max: number;
  step: number;
  healthyMin: number | null;
}

const configs = ref<LlmScoreConfigOption[]>([]);
const loadingConfigs = ref(false);
const saving = ref(false);
const picked = ref<Dimension[]>([]);
const draft = reactive<Record<string, number | string>>({});
const reasons = reactive<Record<string, string>>({});

const scopeLabel = computed(() => t(`aiObservability.annotate.scope.${props.scope}`));
const targetLabel = computed(() => raw(props.targetId));

function orgId(): string {
  return store.state.selectedOrganization?.identifier ?? "";
}

/** A dimension is "filled" once the reviewer has actually set a value. */
const filledCount = computed(
  () => picked.value.filter((d) => draft[d.rowId] !== undefined && draft[d.rowId] !== "").length,
);

const availableOptions = computed(() =>
  configs.value
    .filter((config) => !picked.value.some((d) => d.id === config.id))
    .map((config) => ({ label: raw(config.name), value: config.id })),
);

function toDimension(config: LlmScoreConfigOption): Dimension {
  const details = config.versionDetails?.[config.latestVersion];
  const range = details?.numericRange;
  // A numeric config without an explicit range is scored 0–1, the convention the
  // score configs themselves default to.
  const min = range?.min ?? 0;
  const max = range?.max ?? 1;
  const healthy = details?.healthyThreshold as Record<string, unknown> | undefined;
  const healthyMin = Number(healthy?.min ?? healthy?.gte ?? NaN);
  return {
    id: config.id,
    rowId: details?.rowId ?? "",
    name: config.name,
    dataType: config.dataType,
    version: config.latestVersion,
    categories: details?.categories ?? config.categories ?? [],
    min,
    max,
    // 100 steps across the range keeps the slider usable for 0–1 and 1–5 alike.
    step: (max - min) / 100,
    healthyMin: Number.isFinite(healthyMin) ? healthyMin : null,
  };
}

function addDimension(value: unknown) {
  const config = configs.value.find((c) => c.id === String(value ?? ""));
  if (!config) return;
  const dimension = toDimension(config);
  if (!dimension.rowId || picked.value.some((d) => d.rowId === dimension.rowId)) return;
  picked.value = [...picked.value, dimension];
}

function removeDimension(rowId: string) {
  picked.value = picked.value.filter((d) => d.rowId !== rowId);
  delete draft[rowId];
  delete reasons[rowId];
}

function setValue(rowId: string, value: number | number[] | string) {
  draft[rowId] = Array.isArray(value) ? Number(value[0]) : value;
}

function numericDisplay(dimension: Dimension) {
  const value = draft[dimension.rowId];
  return value === undefined ? raw("—") : raw(Number(value).toFixed(2));
}

function isHealthy(dimension: Dimension) {
  const value = draft[dimension.rowId];
  if (value === undefined || dimension.healthyMin === null) return true;
  return Number(value) >= dimension.healthyMin;
}

// Score Configs load on first open, never with the trace view.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    picked.value = [];
    for (const key of Object.keys(draft)) delete draft[key];
    for (const key of Object.keys(reasons)) delete reasons[key];
    if (configs.value.length || loadingConfigs.value || !orgId()) return;
    loadingConfigs.value = true;
    try {
      configs.value = await llmQueuesService.listScoreConfigOptions(orgId());
    } catch {
      toast({ variant: "error", message: t("aiObservability.annotate.loadError") });
    } finally {
      loadingConfigs.value = false;
    }
  },
  { immediate: true },
);

async function save() {
  if (!filledCount.value || saving.value) return;
  saving.value = true;
  try {
    await llmAnnotationsService.annotate(orgId(), {
      scope: props.scope,
      targetId: props.targetId,
      traceId: props.traceId ?? null,
      sessionId: props.sessionId ?? null,
      refTimestamp: props.refTimestamp,
      sourceStream: props.sourceStream,
      scores: picked.value
        .filter((d) => draft[d.rowId] !== undefined && draft[d.rowId] !== "")
        .map((d) => ({
          scoreConfigRowId: d.rowId,
          value:
            d.dataType === "boolean"
              ? draft[d.rowId] === "true"
              : d.dataType === "numeric"
                ? Number(draft[d.rowId])
                : String(draft[d.rowId]),
          reasoning: reasons[d.rowId] ?? null,
        })),
    });
    toast({
      variant: "success",
      message: t("aiObservability.annotate.success", { count: filledCount.value }),
    });
    emit("annotated");
    emit("update:open", false);
  } catch {
    toast({ variant: "error", message: t("aiObservability.annotate.error") });
  } finally {
    saving.value = false;
  }
}
</script>
