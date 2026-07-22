<template>
  <!-- The drawer owns the header (title + ×), the scrim, and the footer buttons.
       The body is an <OForm> tied to the footer's primary button via `form-id`,
       so Save (and Enter) route through the schema-validated submit; the Save
       spinner is auto-driven by the nested OForm's isSubmitting. -->
  <ODrawer
    :open="open"
    side="right"
    :width="50"
    data-test="score-config-dialog"
    :title="drawerTitle"
    form-id="score-config-form"
    :secondary-button-label="t('onlineEvals.buttons.cancel')"
    :primary-button-label="
      mode === 'create'
        ? t('onlineEvals.scoreConfig.createButton')
        : t('onlineEvals.scoreConfig.saveButton')
    "
    :primary-button-disabled="mode === 'edit' && !isDirty"
    @update:open="handleOpenChange"
    @click:secondary="$emit('cancel')"
  >
    <OForm id="score-config-form" :form="form">
      <div
        v-if="mode === 'edit'"
        class="flex gap-2.5 items-start px-3 py-2.5 bg-[color-mix(in_srgb,var(--color-status-info-text)_14%,transparent)] border border-[color-mix(in_srgb,var(--color-status-info-text)_20%,transparent)] rounded-default text-xs leading-normal text-text-body mb-4"
      >
        <OIcon name="info" size="xs" class="shrink-0 mt-px text-status-info-text" />
        <div class="flex flex-col gap-0.5 min-w-0">
          <i18n-t
            :keypath="`onlineEvals.scoreConfig.editInfoBannerEmphasis.${formValues.dataType}`"
            tag="span"
            class="font-normal"
          >
            <template #nextVersion>
              <strong class="font-bold">{{ nextVersionLabel }}</strong>
            </template>
          </i18n-t>
          <em class="italic font-normal text-text-secondary">{{
            t("onlineEvals.scoreConfig.editInfoBannerDetail")
          }}</em>
        </div>
      </div>

      <!-- Name -->
      <div class="mb-2.5">
        <OFormInput
          name="name"
          :label="t('onlineEvals.scoreConfig.nameLabel')"
          :required="mode === 'create'"
          :disabled="mode === 'edit'"
          :placeholder="t('onlineEvals.scoreConfig.namePlaceholder')"
          size="sm"
          data-test="score-config-name-input"
        />
      </div>

      <!-- Description -->
      <div class="mb-2.5">
        <OFormTextarea
          name="description"
          :label="t('onlineEvals.scoreConfig.descriptionLabel')"
          :placeholder="t('onlineEvals.scoreConfig.descriptionPlaceholder')"
          size="sm"
          :rows="3"
          data-test="score-config-description-input"
        />
        <div v-if="mode === 'edit'" class="text-2xs text-text-secondary mt-1">
          {{ t("onlineEvals.scoreConfig.descriptionHelp") }}
        </div>
      </div>

      <!-- Data type -->
      <div class="mb-2.5">
        <label
          class="o-input-label text-compact font-medium leading-tight text-input-label-text flex items-center mb-1"
        >
          {{ t("onlineEvals.scoreConfig.dataTypeLabel")
          }}<span v-if="mode === 'create'" class="select-none" aria-hidden="true">&nbsp;*</span>
        </label>
        <!-- Radio cards reuse ORadio inside ORadioGroup. `dataType` is a bespoke
             card-grid discriminator (not an OForm* input) → bridged into the one
             form via setFieldValue and read back through formValues. -->
        <ORadioGroup
          :model-value="formValues.dataType"
          :disabled="mode === 'edit'"
          orientation="horizontal"
          class="mt-0.5"
          data-test="score-config-datatype-radios"
          @update:model-value="onDataTypeChange"
        >
          <!-- `sc-dtype-radio` is kept purely as the hook for the ORadio
               :deep() keeper below; all of its own chrome is utilities. In edit
               mode the cards are locked, so the hover utility is simply not
               applied (rather than being re-neutralised by a second rule). -->
          <div
            v-for="type in DATA_TYPES"
            :key="type"
            class="sc-dtype-radio flex-1 min-w-0 border rounded-default transition-[border-color,background] duration-120"
            :class="[
              formValues.dataType === type
                ? 'border-primary-600 bg-[color-mix(in_srgb,var(--color-primary-600)_5%,var(--color-card-bg))]'
                : 'border-dialog-header-border bg-card-bg',
              mode === 'edit'
                ? ''
                : 'hover:border-[color-mix(in_srgb,var(--color-primary-600)_40%,var(--color-dialog-header-border))]',
            ]"
          >
            <ORadio
              :value="type"
              :disabled="mode === 'edit'"
              size="sm"
              :data-test="`score-config-datatype-${type}`"
            >
              <template #label>
                <span class="text-compact font-bold text-text-heading">{{
                  t(`onlineEvals.scoreConfig.dataTypes.${type}`)
                }}</span>
                <span class="text-2xs font-normal text-text-secondary mt-0.75 leading-[1.4]">{{
                  t(`onlineEvals.scoreConfig.dataTypeHelp.${type}`)
                }}</span>
              </template>
            </ORadio>
          </div>
        </ORadioGroup>
      </div>

      <!-- Numeric range -->
      <div v-if="formValues.dataType === 'numeric'" class="mb-2.5">
        <label
          class="o-input-label text-compact font-medium leading-tight text-input-label-text flex items-center mb-1"
        >
          {{ t("onlineEvals.scoreConfig.numericRangeLabel") }}
        </label>
        <div class="flex items-center gap-2.5">
          <span class="text-text-secondary text-2xs">{{
            t("onlineEvals.scoreConfig.minLabel")
          }}</span>
          <OFormInput
            name="min"
            type="number"
            size="sm"
            field-width="xs"
            data-test="score-config-min-input"
          />
          <span class="text-text-secondary text-2xs">{{
            t("onlineEvals.scoreConfig.maxLabel")
          }}</span>
          <OFormInput
            name="max"
            type="number"
            size="sm"
            field-width="xs"
            data-test="score-config-max-input"
          />
        </div>
      </div>

      <!-- Categories -->
      <div v-if="formValues.dataType === 'categorical'" class="mb-2.5">
        <label
          class="o-input-label text-compact font-medium leading-tight text-input-label-text flex items-center mb-1"
        >
          {{ t("onlineEvals.scoreConfig.categoriesLabel") }}
        </label>
        <!-- Categories are a `string[]` OForm field — OFormTagInput binds it by
             name (read/write through the form; no manual setFieldValue bridge). -->
        <OFormTagInput
          name="categories"
          :placeholder="t('onlineEvals.scoreConfig.addCategoryPlaceholder')"
          data-test="score-config-categories-input"
        />
      </div>

      <!-- Boolean info banner -->
      <div
        v-if="formValues.dataType === 'boolean'"
        class="flex gap-2.5 items-start px-3 py-2.5 bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] border border-dialog-header-border rounded-default text-xs leading-normal text-text-body mb-4"
      >
        <OIcon name="info" size="xs" class="shrink-0 mt-px text-text-secondary" />
        <span>
          {{ t("onlineEvals.scoreConfig.booleanInfo", { trueLabel: "true", falseLabel: "false" }) }}
        </span>
      </div>

      <!-- Healthy threshold -->
      <div
        class="mt-1 pt-3 px-3.5 pb-2.5 border border-dialog-header-border rounded-default bg-[color-mix(in_srgb,var(--color-primary-600)_2.5%,var(--color-card-bg))]"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <span class="inline-flex items-center gap-1">
            <span
              class="o-input-label text-compact font-medium leading-tight text-input-label-text"
              >{{ t("onlineEvals.scoreConfig.healthyThresholdTitle") }}</span
            >
            <OIcon name="info-outline" size="sm" class="text-text-secondary">
              <OTooltip
                :content="t('onlineEvals.scoreConfig.healthyThresholdIntro')"
                max-width="300px"
              />
            </OIcon>
          </span>
          <OTag type="fieldTag" value="outlinesm">{{ t("onlineEvals.scoreConfig.optional") }}</OTag>
        </div>

        <!-- Numeric threshold -->
        <template v-if="formValues.dataType === 'numeric'">
          <div class="text-xs font-medium text-text-secondary mb-2">
            {{ t("onlineEvals.scoreConfig.healthyWhenValueIs") }}
          </div>
          <!-- Narrow drawers (<51.25rem): stack so the label + input don't crush. -->
          <div class="flex flex-col gap-2.5 min-[51.25rem]:flex-row">
            <label
              class="flex-1 min-w-0 grid grid-cols-[1.125rem_1.25rem_minmax(0,1fr)_5rem] items-center gap-2 px-3 py-1.5 border rounded-default cursor-pointer transition-[border-color,background] duration-120 hover:border-[color-mix(in_srgb,var(--color-primary-600)_40%,var(--color-dialog-header-border))]"
              :class="
                formValues.healthyDirection === 'gte'
                  ? 'border-primary-600 bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))]'
                  : 'border-dialog-header-border bg-card-bg'
              "
            >
              <input
                type="radio"
                class="sc-radio"
                value="gte"
                :checked="formValues.healthyDirection === 'gte'"
                @change="form.setFieldValue('healthyDirection', 'gte')"
              />
              <span class="font-mono text-lg font-bold text-text-body text-center">≥</span>
              <span class="text-compact text-text-body">{{
                t("onlineEvals.scoreConfig.gteLabel")
              }}</span>
              <OFormInput
                name="healthyGteValue"
                type="number"
                size="sm"
                field-width="xs"
                :placeholder="String(defaultGteValue)"
                data-test="score-config-gte-value-input"
                @focus="form.setFieldValue('healthyDirection', 'gte')"
              />
            </label>
            <label
              class="flex-1 min-w-0 grid grid-cols-[1.125rem_1.25rem_minmax(0,1fr)_5rem] items-center gap-2 px-3 py-1.5 border rounded-default cursor-pointer transition-[border-color,background] duration-120 hover:border-[color-mix(in_srgb,var(--color-primary-600)_40%,var(--color-dialog-header-border))]"
              :class="
                formValues.healthyDirection === 'lte'
                  ? 'border-primary-600 bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))]'
                  : 'border-dialog-header-border bg-card-bg'
              "
            >
              <input
                type="radio"
                class="sc-radio"
                value="lte"
                :checked="formValues.healthyDirection === 'lte'"
                @change="form.setFieldValue('healthyDirection', 'lte')"
              />
              <span class="font-mono text-lg font-bold text-text-body text-center">≤</span>
              <span class="text-compact text-text-body">{{
                t("onlineEvals.scoreConfig.lteLabel")
              }}</span>
              <OFormInput
                name="healthyLteValue"
                type="number"
                size="sm"
                field-width="xs"
                :placeholder="String(defaultLteValue)"
                data-test="score-config-lte-value-input"
                @focus="form.setFieldValue('healthyDirection', 'lte')"
              />
            </label>
          </div>
        </template>

        <!-- Categorical threshold -->
        <template v-else-if="formValues.dataType === 'categorical'">
          <div class="text-xs font-medium text-text-secondary mb-2">
            {{ t("onlineEvals.scoreConfig.healthyCategories") }}
          </div>
          <div
            v-if="formValues.categories.length === 0"
            class="text-2xs italic text-text-secondary px-3 py-2.5 border border-dashed border-dialog-header-border rounded-default bg-card-bg"
          >
            {{ t("onlineEvals.scoreConfig.addCategoryPlaceholder") }}…
          </div>
          <div
            v-else
            class="flex flex-col gap-0.5 border border-dialog-header-border rounded-default bg-card-bg p-1"
          >
            <label
              v-for="cat in formValues.categories"
              :key="cat"
              class="flex items-center gap-2.5 px-2.5 py-1.75 rounded-default cursor-pointer transition-[background] duration-120 hover:bg-[color-mix(in_srgb,var(--color-text-heading)_6%,transparent)]"
              :class="
                formValues.healthyCategories.includes(cat)
                  ? 'bg-[color-mix(in_srgb,color-mix(in_srgb,var(--color-status-success-text)_14%,transparent)_35%,transparent)]'
                  : ''
              "
            >
              <input
                type="checkbox"
                class="sc-checkbox"
                :checked="formValues.healthyCategories.includes(cat)"
                @change="toggleHealthyCategory(cat)"
              />
              <span class="font-mono">{{ cat }}</span>
            </label>
          </div>
          <div class="flex items-center gap-1.5 mt-2 text-2xs text-text-secondary">
            <OIcon name="info" size="xs" class="shrink-0 text-status-info-text" />
            <span>{{ t("onlineEvals.scoreConfig.healthyCategoriesHint") }}</span>
          </div>
        </template>

        <!-- Boolean threshold -->
        <template v-else>
          <div class="text-xs font-medium text-text-secondary mb-2">
            {{ t("onlineEvals.scoreConfig.healthyValue") }}
          </div>
          <!-- Narrow drawers (<51.25rem): stack so the label + hint don't crush. -->
          <div class="flex flex-col gap-2.5 min-[51.25rem]:flex-row">
            <label
              class="flex-1 min-w-0 grid grid-cols-[1rem_1fr] items-start gap-2.5 px-3 py-1.75 border rounded-default cursor-pointer transition-[border-color,background] duration-120 hover:border-[color-mix(in_srgb,var(--color-primary-600)_40%,var(--color-dialog-header-border))]"
              :class="
                formValues.healthyBool === true
                  ? 'border-primary-600 bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))]'
                  : 'border-dialog-header-border bg-card-bg'
              "
            >
              <input
                type="radio"
                class="sc-radio"
                :value="true"
                :checked="formValues.healthyBool === true"
                @change="form.setFieldValue('healthyBool', true)"
              />
              <div>
                <div class="text-text-body font-mono">
                  {{ t("onlineEvals.scoreConfig.trueIsHealthy") }}
                </div>
                <div class="text-2xs text-text-secondary mt-0.5 leading-[1.4]">
                  {{ t("onlineEvals.scoreConfig.trueIsHealthyHint") }}
                </div>
              </div>
            </label>
            <label
              class="flex-1 min-w-0 grid grid-cols-[1rem_1fr] items-start gap-2.5 px-3 py-1.75 border rounded-default cursor-pointer transition-[border-color,background] duration-120 hover:border-[color-mix(in_srgb,var(--color-primary-600)_40%,var(--color-dialog-header-border))]"
              :class="
                formValues.healthyBool === false
                  ? 'border-primary-600 bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))]'
                  : 'border-dialog-header-border bg-card-bg'
              "
            >
              <input
                type="radio"
                class="sc-radio"
                :value="false"
                :checked="formValues.healthyBool === false"
                @change="form.setFieldValue('healthyBool', false)"
              />
              <div>
                <div class="text-text-body font-mono">
                  {{ t("onlineEvals.scoreConfig.falseIsHealthy") }}
                </div>
                <div class="text-2xs text-text-secondary mt-0.5 leading-[1.4]">
                  {{ t("onlineEvals.scoreConfig.falseIsHealthyHint") }}
                </div>
              </div>
            </label>
          </div>
        </template>

        <div
          class="flex items-start gap-1.5 mt-2.5 pt-2 border-t border-dashed border-dialog-header-border text-2xs text-text-secondary leading-normal"
        >
          <OIcon name="info" size="xs" class="shrink-0 mt-0.5 text-text-secondary" />
          <span>{{ t("onlineEvals.scoreConfig.thresholdEmptyHint") }}</span>
        </div>
      </div>
    </OForm>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import type { RadioValue } from "@/lib/forms/Radio/ORadio.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type ScoreConfig,
  type ScoreDataType,
} from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "../utils/evalEntity";
import { showError } from "../utils/evalFormat";
import { makeScoreConfigSchema, type ScoreConfigForm } from "./ScoreConfigDialog.schema";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: ScoreConfig | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

// Drawer open state — starts open (parent mounts this only when creating/editing
// a score config). Any dismiss path (× / Escape / overlay) flows through
// ODrawer's update:open(false) → we forward `cancel`, and the parent unmounts.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("cancel");
}

// Plain-text drawer title. Edit mode shows just the (immutable) config name.
const drawerTitle = computed(() =>
  props.mode === "edit" && props.row ? props.row.name : t("onlineEvals.scoreConfig.createTitle"),
);

// Data-type radio options.
const DATA_TYPES = ["numeric", "categorical", "boolean"] as const;

const onDataTypeChange = (value: RadioValue) => {
  if (value === "numeric" || value === "categorical" || value === "boolean") {
    form.setFieldValue("dataType", value);
  }
};

// Co-located Zod schema (factory keeps messages i18n-driven and branches the
// create-only name-slug rule on `mode`).
const scoreConfigSchema = makeScoreConfigSchema(t, props.mode);

// OWNER pattern (Rule ③): this component owns <OForm>, so it creates the form
// with useOForm and reads it reactively via form.useStore — a SINGLE source of
// truth, NO mirror ref. `formValues` drives the parent-side reads: the
// `dataType`/`categories` `v-if` branches and the `defaultGte/LteValue`
// computeds. The bespoke choice controls (the dataType ORadioGroup and the
// healthy-threshold radios/checkboxes) are genuine non-`OForm*` widgets, so they
// bridge into the one form via `form.setFieldValue` and read back through
// `formValues` (the sanctioned non-input bridge); the scalar inputs and the
// categories OFormTagInput are plain `name=` fields. The @submit handler reads
// the validated `value`.
const form = useOForm<ScoreConfigForm>({
  defaultValues: initForm(props.row),
  schema: scoreConfigSchema,
  onSubmit: save,
});
const formValues = form.useStore((s: any) => s.values as ScoreConfigForm);

const nextVersionLabel = computed(() => {
  const v = props.row?.version ?? 0;
  return `v${v + 1}`;
});

// Dirty affordance (a save-affordance, not a validation gate). TanStack tracks
// per-field dirtiness against the seeded defaults, so editing any field (incl.
// the bridged choice controls) flips this true.
const isDirty = form.useStore((s: any) => s.isDirty);

const defaultGteValue = computed(() => {
  if (formValues.value.dataType !== "numeric") return 0;
  const max = Number(formValues.value.max ?? 1);
  return max ? Math.round(max * 0.7 * 100) / 100 : 0.7;
});

const defaultLteValue = computed(() => {
  if (formValues.value.dataType !== "numeric") return 0;
  const max = Number(formValues.value.max ?? 1);
  return max ? Math.round(max * 0.3 * 100) / 100 : 0.3;
});

function initForm(row: ScoreConfig | null): ScoreConfigForm {
  const fallbackName = "";
  if (!row) {
    return {
      name: fallbackName,
      description: "",
      dataType: "numeric" as ScoreDataType,
      min: 0,
      max: 1,
      categories: [] as string[],
      healthyDirection: "gte" as "gte" | "lte",
      healthyGteValue: undefined as number | undefined,
      healthyLteValue: undefined as number | undefined,
      healthyCategories: [] as string[],
      healthyBool: null as boolean | null,
    };
  }
  const type = dataTypeOf(row) as ScoreDataType;
  const range = valueOf(row, "numericRange", "numeric_range") || {};
  const ht = valueOf(row, "healthyThreshold", "healthy_threshold") || {};

  return {
    name: row.name,
    description: row.description || "",
    dataType: type,
    min: typeof range.min === "number" ? range.min : 0,
    max: typeof range.max === "number" ? range.max : 1,
    categories: Array.isArray(row.categories) ? [...row.categories] : [],
    healthyDirection: ht.direction === "lte" ? "lte" : "gte",
    healthyGteValue:
      ht.direction === "gte" && ht.value !== undefined ? Number(ht.value) : undefined,
    healthyLteValue:
      ht.direction === "lte" && ht.value !== undefined ? Number(ht.value) : undefined,
    healthyCategories: Array.isArray(ht.healthy_categories)
      ? [...ht.healthy_categories]
      : Array.isArray(ht.healthyCategories)
        ? [...ht.healthyCategories]
        : [],
    healthyBool:
      ht.healthy_value !== undefined
        ? Boolean(ht.healthy_value)
        : ht.healthyValue !== undefined
          ? Boolean(ht.healthyValue)
          : null,
  };
}

// The categories OFormTagInput owns add/remove of categories. Keep the healthy-category selection in
// sync: whenever a category disappears, drop it from the healthy set too. Reads
// the form reactively and writes back via setFieldValue (no mirror).
watch(
  () => formValues.value.categories,
  (cats) => {
    const cur = formValues.value.healthyCategories;
    const pruned = cur.filter((c) => cats.includes(c));
    if (pruned.length !== cur.length) {
      form.setFieldValue("healthyCategories", pruned, { dontUpdateMeta: true });
    }
  },
  { deep: true },
);

function toggleHealthyCategory(cat: string) {
  const cur = formValues.value.healthyCategories;
  if (cur.includes(cat)) {
    form.setFieldValue(
      "healthyCategories",
      cur.filter((c) => c !== cat),
    );
  } else {
    form.setFieldValue("healthyCategories", [...cur, cat]);
  }
}

// Payload builders read the validated @submit `value` (the single source of
// truth), NOT a working mirror.
function buildNumericRange(v: ScoreConfigForm) {
  if (v.dataType !== "numeric") return null;
  // A number <input> emits a STRING and the @submit value is TanStack's RAW store
  // value (the schema's z.coerce.number coerces for validation only, not the
  // stored value) — so coerce to a number here.
  const min = Number(v.min);
  const max = Number(v.max);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

function buildCategories(v: ScoreConfigForm) {
  if (v.dataType !== "categorical") return null;
  return v.categories.length ? v.categories : null;
}

function buildHealthyThreshold(v: ScoreConfigForm) {
  if (v.dataType === "numeric") {
    const raw = v.healthyDirection === "gte" ? v.healthyGteValue : v.healthyLteValue;
    // Blank → no threshold (optional); otherwise coerce the string the number
    // <input> emits back to a number (see buildNumericRange).
    if (raw === undefined || raw === null || (raw as unknown) === "") return null;
    const value = Number(raw);
    if (Number.isNaN(value)) return null;
    return { direction: v.healthyDirection, value };
  }
  if (v.dataType === "categorical") {
    if (!v.healthyCategories.length) return null;
    return { healthy_categories: v.healthyCategories };
  }
  if (v.healthyBool === null) return null;
  return { healthy_value: v.healthyBool };
}

// @submit handler — OForm only calls this once the schema passes (name required
// + the create-only slug pattern; there is no min<max ordering rule). A
// categorical config with zero categories is allowed (buildCategories() just
// sends `categories: null`). The handler builds the payload from the validated
// `value` only. OForm awaits this, so the ODrawer Save spinner spans the save.
async function save(value: ScoreConfigForm) {
  if (!props.orgId) return;
  try {
    const basePayload: Record<string, any> = {
      name: value.name.trim(),
      description: value.description?.trim() || null,
      numericRange: buildNumericRange(value),
      categories: buildCategories(value),
      healthyThreshold: buildHealthyThreshold(value),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scoreConfigs.update(props.orgId, entityId(props.row), basePayload);
    } else {
      await onlineEvalsService.scoreConfigs.create(props.orgId, {
        ...basePayload,
        dataType: value.dataType,
      });
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.scoreConfigs") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.scoreConfig.saveError"));
  }
}
</script>

<style scoped>
/* keep(lib-override:o-radio): the data-type cards wrap <ORadio>, whose root
   <label> and label-content <span> are rendered INSIDE the ORadio component —
   this file cannot put utilities on them. The card needs that label to fill its
   full width and top-align (ORadio ships `inline-flex items-center`), and the
   label span to stack the title above the help text. Everything else on the
   card (border/radius/background/hover/selected) is utilities in the template;
   `.sc-dtype-radio` survives only as the hook for these two rules. */
.sc-dtype-radio :deep(label) {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
}

.sc-dtype-radio :deep(label > span) {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* keep(generated-content): the healthy-threshold choice controls are native
   <input type="radio"|"checkbox">; their checked affordance is drawn with
   ::after on the input itself, which no utility can express. */
.sc-radio:checked {
  border-color: var(--color-primary-600);
}

.sc-radio:checked::after {
  content: "";
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: var(--radius-full);
  background: var(--color-primary-600);
}

.sc-checkbox:checked {
  background: var(--color-primary-600);
  border-color: var(--color-primary-600);
}

.sc-checkbox:checked::after {
  content: "";
  width: 0.4375rem;
  height: 0.25rem;
  border-left: 0.09375rem solid var(--color-white);
  border-bottom: 0.09375rem solid var(--color-white);
  transform: rotate(-45deg) translate(0, -0.0625rem);
}
</style>
