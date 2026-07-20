<template>
  <!-- Standard shared drawer (main's ux-revamp): the drawer owns the header
       (title + ×), the scrim, and the footer buttons. The body is an <OForm>
       tied to the footer's primary button via `form-id`, so Save (and Enter)
       route through the schema-validated submit; the Save spinner is auto-driven
       by the nested OForm's isSubmitting (no manual `isSaving`). -->
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
    <OForm id="score-config-form" class="sc-form" :form="form">
      <div v-if="mode === 'edit'" class="sc-callout">
        <OIcon name="info" size="xs" />
        <div class="sc-callout__text flex flex-col gap-0.5 min-w-0">
          <i18n-t
            :keypath="`onlineEvals.scoreConfig.editInfoBannerEmphasis.${formValues.dataType}`"
            tag="span"
            class="sc-callout__lead font-normal"
          >
            <template #nextVersion>
              <strong>{{ nextVersionLabel }}</strong>
            </template>
          </i18n-t>
          <em class="sc-callout__detail italic font-normal text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.editInfoBannerDetail") }}</em>
        </div>
      </div>

      <!-- Name -->
      <div class="sc-field">
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
      <div class="sc-field">
        <OFormTextarea
          name="description"
          :label="t('onlineEvals.scoreConfig.descriptionLabel')"
          :placeholder="t('onlineEvals.scoreConfig.descriptionPlaceholder')"
          size="sm"
          :rows="3"
          data-test="score-config-description-input"
        />
        <div v-if="mode === 'edit'" class="sc-field__help text-[11px] text-(--color-text-secondary) mt-1">
          {{ t("onlineEvals.scoreConfig.descriptionHelp") }}
        </div>
      </div>

      <!-- Data type -->
      <div class="sc-field">
        <label class="sc-field__label o-input-label">
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
          class="sc-dtype-radios"
          data-test="score-config-datatype-radios"
          @update:model-value="onDataTypeChange"
        >
          <div
            v-for="type in DATA_TYPES"
            :key="type"
            class="sc-dtype-radio"
            :class="{
              'sc-dtype-radio--selected': formValues.dataType === type,
              'sc-dtype-radio--locked': mode === 'edit',
            }"
          >
            <ORadio
              :value="type"
              :disabled="mode === 'edit'"
              size="sm"
              :data-test="`score-config-datatype-${type}`"
            >
              <template #label>
                <span class="sc-dtype-radio__hd">{{ t(`onlineEvals.scoreConfig.dataTypes.${type}`) }}</span>
                <span class="sc-dtype-radio__sub">{{ t(`onlineEvals.scoreConfig.dataTypeHelp.${type}`) }}</span>
              </template>
            </ORadio>
          </div>
        </ORadioGroup>
      </div>

      <!-- Numeric range -->
      <div v-if="formValues.dataType === 'numeric'" class="sc-field">
        <label class="sc-field__label o-input-label">
          {{ t("onlineEvals.scoreConfig.numericRangeLabel") }}
        </label>
        <div class="sc-range-row flex items-center gap-[10px]">
          <span class="sc-range-row__label text-(--color-text-secondary) text-[11px]">{{ t("onlineEvals.scoreConfig.minLabel") }}</span>
          <OFormInput
            name="min"
            type="number"
            size="sm"
            field-width="xs"
            data-test="score-config-min-input"
          />
          <span class="sc-range-row__label text-(--color-text-secondary) text-[11px]">{{ t("onlineEvals.scoreConfig.maxLabel") }}</span>
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
      <div v-if="formValues.dataType === 'categorical'" class="sc-field">
        <label class="sc-field__label o-input-label">
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
        class="sc-callout sc-callout--neutral flex gap-[10px] items-start px-3 py-[10px] bg-[color-mix(in_srgb,var(--color-text-secondary,var(--o2-text-secondary))_12%,transparent)] border border-(--color-dialog-header-border) rounded-md text-xs leading-normal text-(--color-text-primary) mb-4"
      >
        <OIcon name="info" size="xs" />
        <span>
          {{ t("onlineEvals.scoreConfig.booleanInfo", { trueLabel: "true", falseLabel: "false" }) }}
        </span>
      </div>

      <!-- Healthy threshold -->
      <div class="sc-ht-section">
        <div class="sc-ht-section__head">
          <span class="sc-ht-section__title-group">
            <span class="o-input-label">{{ t("onlineEvals.scoreConfig.healthyThresholdTitle") }}</span>
            <OIcon name="info-outline" size="sm" class="sc-ht-section__info">
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
          <div class="sc-ht-field-label text-[11.5px] font-semibold text-(--color-text-primary) mb-1.5">{{ t("onlineEvals.scoreConfig.healthyWhenValueIs") }}</div>
          <div class="sc-ht-radio-row flex flex-col gap-1.5">
            <label
              class="sc-ht-num-radio grid grid-cols-[18px_22px_1fr_110px] items-center gap-[10px] px-3 py-1.5 border border-(--color-dialog-header-border) rounded-[5px] bg-(--color-card-bg) cursor-pointer transition-[border-color,background] duration-[120ms]"
              :class="{ 'sc-ht-num-radio--selected': formValues.healthyDirection === 'gte' }"
            >
              <input
                type="radio"
                class="sc-radio"
                value="gte"
                :checked="formValues.healthyDirection === 'gte'"
                @change="form.setFieldValue('healthyDirection', 'gte')"
              />
              <span class="sc-ht-sym sc-mono text-[17px] font-bold text-(--color-text-primary) text-center">≥</span>
              <span class="sc-ht-op text-[12.5px] text-(--color-text-primary)">{{ t("onlineEvals.scoreConfig.gteLabel") }}</span>
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
              class="sc-ht-num-radio grid grid-cols-[18px_22px_1fr_110px] items-center gap-[10px] px-3 py-1.5 border border-(--color-dialog-header-border) rounded-[5px] bg-(--color-card-bg) cursor-pointer transition-[border-color,background] duration-[120ms]"
              :class="{ 'sc-ht-num-radio--selected': formValues.healthyDirection === 'lte' }"
            >
              <input
                type="radio"
                class="sc-radio"
                value="lte"
                :checked="formValues.healthyDirection === 'lte'"
                @change="form.setFieldValue('healthyDirection', 'lte')"
              />
              <span class="sc-ht-sym sc-mono text-[17px] font-bold text-(--color-text-primary) text-center">≤</span>
              <span class="sc-ht-op text-[12.5px] text-(--color-text-primary)">{{ t("onlineEvals.scoreConfig.lteLabel") }}</span>
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
          <div class="sc-ht-field-label text-[11.5px] font-semibold text-(--color-text-primary) mb-1.5">{{ t("onlineEvals.scoreConfig.healthyCategories") }}</div>
          <div v-if="formValues.categories.length === 0" class="sc-ht-empty text-[11.5px] italic text-(--color-text-secondary) px-3 py-[10px] border border-dashed border-(--color-dialog-header-border) rounded-[5px] bg-(--color-card-bg)">
            {{ t("onlineEvals.scoreConfig.addCategoryPlaceholder") }}…
          </div>
          <div v-else class="sc-ht-checks flex flex-col gap-0.5 border border-(--color-dialog-header-border) rounded-[5px] bg-(--color-card-bg) p-1">
            <label
              v-for="cat in formValues.categories"
              :key="cat"
              class="sc-ht-check flex items-center gap-[10px] px-[10px] py-[7px] rounded cursor-pointer transition-[background] duration-[120ms]"
              :class="{ 'sc-ht-check--on': formValues.healthyCategories.includes(cat) }"
            >
              <input
                type="checkbox"
                class="sc-checkbox"
                :checked="formValues.healthyCategories.includes(cat)"
                @change="toggleHealthyCategory(cat)"
              />
              <span class="sc-mono font-[var(--o2-font-mono)]">{{ cat }}</span>
            </label>
          </div>
          <div class="sc-ht-example flex items-center gap-1.5 mt-2 text-[11px] text-(--color-text-secondary)">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.healthyCategoriesHint") }}</span>
          </div>
        </template>

        <!-- Boolean threshold -->
        <template v-else>
          <div class="sc-ht-field-label text-[11.5px] font-semibold text-(--color-text-primary) mb-1.5">{{ t("onlineEvals.scoreConfig.healthyValue") }}</div>
          <div class="sc-ht-bool-radios flex flex-col gap-1.5">
            <label
              class="sc-ht-bool-radio grid grid-cols-[16px_1fr] items-start gap-[10px] px-3 py-[7px] border border-(--color-dialog-header-border) rounded-[5px] bg-(--color-card-bg) cursor-pointer transition-[border-color,background] duration-[120ms]"
              :class="{ 'sc-ht-bool-radio--selected': formValues.healthyBool === true }"
            >
              <input
                type="radio"
                class="sc-radio"
                :value="true"
                :checked="formValues.healthyBool === true"
                @change="form.setFieldValue('healthyBool', true)"
              />
              <div>
                <div class="sc-ht-bool-radio__hd text-(--color-text-primary) font-[var(--o2-font-mono)]">{{ t("onlineEvals.scoreConfig.trueIsHealthy") }}</div>
                <div class="sc-ht-bool-radio__sub text-[11px] text-(--color-text-secondary) mt-0.5 leading-[1.4]">{{ t("onlineEvals.scoreConfig.trueIsHealthyHint") }}</div>
              </div>
            </label>
            <label
              class="sc-ht-bool-radio grid grid-cols-[16px_1fr] items-start gap-[10px] px-3 py-[7px] border border-(--color-dialog-header-border) rounded-[5px] bg-(--color-card-bg) cursor-pointer transition-[border-color,background] duration-[120ms]"
              :class="{ 'sc-ht-bool-radio--selected': formValues.healthyBool === false }"
            >
              <input
                type="radio"
                class="sc-radio"
                :value="false"
                :checked="formValues.healthyBool === false"
                @change="form.setFieldValue('healthyBool', false)"
              />
              <div>
                <div class="sc-ht-bool-radio__hd text-(--color-text-primary) font-[var(--o2-font-mono)]">{{ t("onlineEvals.scoreConfig.falseIsHealthy") }}</div>
                <div class="sc-ht-bool-radio__sub text-[11px] text-(--color-text-secondary) mt-0.5 leading-[1.4]">{{ t("onlineEvals.scoreConfig.falseIsHealthyHint") }}</div>
              </div>
            </label>
          </div>
        </template>

        <div class="sc-ht-section__foot flex items-start gap-1.5 mt-[10px] pt-2 border-t border-dashed border-(--color-dialog-header-border) text-[11px] text-(--color-text-secondary) leading-normal">
          <OIcon name="info" size="xs" />
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
import {
  makeScoreConfigSchema,
  type ScoreConfigForm,
} from "./ScoreConfigDialog.schema";

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
  props.mode === "edit" && props.row
    ? props.row.name
    : t("onlineEvals.scoreConfig.createTitle"),
);

// Data-type radio options.
const DATA_TYPES = ["numeric", "categorical", "boolean"] as const;

const onDataTypeChange = (value: RadioValue) => {
  if (value === "numeric" || value === "categorical" || value === "boolean") {
    form.setFieldValue("dataType", value);
  }
};

// Co-located Zod schema (factory keeps messages i18n-driven and branches the
// create-only name-slug rule on `mode`, matching main's validateName).
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

// Dirty affordance (a save-affordance, NOT a validation gate — R3). TanStack
// tracks per-field dirtiness against the seeded defaults, so editing any field
// (incl. the bridged choice controls) flips this true.
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
    healthyGteValue: ht.direction === "gte" && ht.value !== undefined ? Number(ht.value) : undefined,
    healthyLteValue: ht.direction === "lte" && ht.value !== undefined ? Number(ht.value) : undefined,
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
    form.setFieldValue("healthyCategories", cur.filter((c) => c !== cat));
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
  // stored value) — so coerce here, exactly as the old `v-model.number` did.
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
// + the create-only slug pattern; matching main, there is NO min<max ordering
// rule). A categorical config with zero categories is also allowed (pre-migration
// behavior: buildCategories() just sends `categories: null`). The handler builds
// the payload from the validated `value` ONLY. OForm awaits this → the ODrawer
// Save spinner spans the save (no manual `isSaving`).
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

<style lang="scss">
/* Body form inside the shared ODrawer — the drawer owns the scroll/chrome, the
   form just carries the field padding the old .sc-drawer__body had. */
.sc-form {
  padding: 14px 22px;
}

.sc-mono { font-family: var(--o2-font-mono); }

.sc-callout {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-status-info-text) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-status-info-text) 20%, transparent);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 16px;
}

.sc-callout > :first-child {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--color-status-info-text);
}

/* descendant selector: cannot be inlined */
.sc-callout__lead strong { font-weight: 700; }

/* child selector for neutral callout icon: cannot be inlined */
.sc-callout--neutral > :first-child { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.sc-field {
  margin-bottom: 10px;
}

/* Layout only — typography comes from the shared .o-input-label class (added on
   these group labels) so they match OInput's rendered labels exactly. */
.sc-field__label {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

/* Info icon sitting after a field label (e.g. Data type's "can't change"). */
.sc-field__info {
  margin-left: 4px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* ── Data-type radio cards (reuse ORadio inside ORadioGroup) ────────────────
   ORadioGroup(orientation=horizontal) lays the three wrappers in one row; each
   wrapper carries the card chrome while ORadio renders the circle + label. */
.sc-dtype-radios {
  margin-top: 2px;
}

.sc-dtype-radio {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
  transition: border-color 0.12s, background 0.12s;
}

/* ORadio renders its own <label>; make it fill the card and top-align so the
   circle lines up with the title above the inline description. */
.sc-dtype-radio > label {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
}

/* ORadio's label-content <span> → stack the title + help vertically. */
.sc-dtype-radio > label > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sc-dtype-radio:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border, var(--o2-border)));
}

/* dynamic selected state: cannot be inlined */
.sc-dtype-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--color-card-bg));
}

/* Edit mode: cards are locked — no hover affordance, but the selected card keeps
   its highlight so the current type stays obvious. */
.sc-dtype-radio--locked:hover {
  border-color: var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
}
.sc-dtype-radio--locked.sc-dtype-radio--selected,
.sc-dtype-radio--locked.sc-dtype-radio--selected:hover {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--color-card-bg));
}

.sc-dtype-radio__hd {
  font: 700 12.5px var(--o2-font);
  color: var(--color-text-primary, currentColor);
}

.sc-dtype-radio__sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-top: 3px;
  line-height: 1.4;
}

.sc-range-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sc-range-row__label {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 11px;
}

.sc-ht-section {
  margin-top: 4px;
  padding: 12px 14px 10px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 2.5%, var(--color-card-bg));
}

.sc-ht-section__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

/* Title + info icon hug together; the 10px head gap separates them from the
   "optional" badge. */
.sc-ht-section__title-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sc-ht-section__info {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-ht-section__foot {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  line-height: 1.5;
}

/* child selector: cannot be inlined */
.sc-ht-section__foot > :first-child {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-ht-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-bottom: 8px;
}

.sc-ht-radio-row {
  display: flex;
  gap: 10px;
}

/* Narrow drawers: fall back to stacked so the label + input don't crush. */
@media (max-width: 820px) {
  .sc-ht-radio-row {
    flex-direction: column;
  }
}

.sc-ht-num-radio {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 18px 20px minmax(0, 1fr) 80px;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 5px;
  background: var(--color-card-bg);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.sc-ht-num-radio:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border, var(--o2-border)));
}

.sc-ht-num-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
}

.sc-ht-sym {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text-primary, currentColor);
  text-align: center;
}

.sc-ht-op { font-size: 12.5px; color: var(--color-text-primary, currentColor); }

.sc-ht-num-input { width: 100%; }

.sc-ht-example {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* child selector: cannot be inlined */
.sc-ht-example > :first-child {
  flex-shrink: 0;
  color: var(--color-status-info-text);
}

/* descendant selector: cannot be inlined */
.sc-ht-example code {
  font-family: var(--o2-font-mono);
  font-weight: 700;
  color: var(--color-text-primary, var(--o2-text));
}

.sc-ht-checks {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 5px;
  background: var(--color-card-bg);
  padding: 4px;
}

.sc-ht-check {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s;
}

.sc-ht-check:hover { background: color-mix(in srgb, var(--color-text-primary) 6%, transparent); }

.sc-ht-check--on {
  background: color-mix(in srgb, color-mix(in srgb, var(--color-status-success-text) 14%, transparent) 35%, transparent);
}

.sc-ht-empty {
  font-size: 11.5px;
  font-style: italic;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  padding: 10px 12px;
  border: 1px dashed var(--color-dialog-header-border, var(--o2-border));
  border-radius: 5px;
  background: var(--color-card-bg);
}

.sc-ht-bool-radios {
  display: flex;
  gap: 10px;
}

/* Narrow drawers: stack so the label + hint don't crush. */
@media (max-width: 820px) {
  .sc-ht-bool-radios {
    flex-direction: column;
  }
}

.sc-ht-bool-radio {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 16px 1fr;
  align-items: start;
  gap: 10px;
  padding: 7px 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 5px;
  background: var(--color-card-bg);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.sc-ht-bool-radio:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border, var(--o2-border)));
}

/* dynamic selected state: cannot be inlined */
.sc-ht-bool-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
}

/* pseudo-class + pseudo-element: cannot be inlined */
.sc-radio:checked { border-color: var(--color-primary-600, #3F7994); }

.sc-radio:checked::after {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary-600, #3F7994);
}

/* pseudo-class + pseudo-element: cannot be inlined */
.sc-checkbox:checked {
  background: var(--color-primary-600, #3F7994);
  border-color: var(--color-primary-600, #3F7994);
}

.sc-checkbox:checked::after {
  content: "";
  width: 7px;
  height: 4px;
  border-left: 1.5px solid white;
  border-bottom: 1.5px solid white;
  transform: rotate(-45deg) translate(0, -1px);
}
</style>
