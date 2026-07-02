<template>
  <!-- Standard shared drawer (same wiring as AddStream's ODialog): the drawer
       owns the header (title + ×), the scrim, and the footer buttons. The body
       form is tied to the footer's primary button via `form-id`, so Save (and
       Enter) route through @submit.prevent="save". -->
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
    :primary-button-loading="isSaving"
    :primary-button-disabled="mode === 'edit' && !isDirty"
    @update:open="handleOpenChange"
    @click:secondary="$emit('cancel')"
  >
      <form id="score-config-form" class="sc-form" @submit.prevent="save">
        <div v-if="mode === 'edit'" class="sc-callout">
          <OIcon name="info" size="xs" />
          <div class="sc-callout__text tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0">
            <i18n-t
              :keypath="`onlineEvals.scoreConfig.editInfoBannerEmphasis.${form.dataType}`"
              tag="span"
              class="sc-callout__lead tw:font-normal"
            >
              <template #nextVersion>
                <strong>{{ nextVersionLabel }}</strong>
              </template>
            </i18n-t>
            <em class="sc-callout__detail tw:italic tw:font-normal tw:text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.editInfoBannerDetail") }}</em>
          </div>
        </div>

        <!-- Name -->
        <div class="sc-field">
          <!-- Label via OInput's :label/:required (AddStream convention). In edit
               the name can't change — just disable the input, no lock chrome.
               Validated as a lowercase identifier; the error shows inline. -->
          <OInput
            v-model.trim="form.name"
            :label="t('onlineEvals.scoreConfig.nameLabel')"
            :required="mode === 'create'"
            :disabled="mode === 'edit'"
            :placeholder="t('onlineEvals.scoreConfig.namePlaceholder')"
            size="sm"
            :error="!!nameError"
            :error-message="nameError"
            data-test="score-config-name-input"
            @update:model-value="validateName"
          />
        </div>

        <!-- Description -->
        <div class="sc-field">
          <OInput
            v-model.trim="form.description"
            :label="t('onlineEvals.scoreConfig.descriptionLabel')"
            type="textarea"
            :placeholder="t('onlineEvals.scoreConfig.descriptionPlaceholder')"
            size="sm"
            :rows="3"
            data-test="score-config-description-input"
          />
          <div v-if="mode === 'edit'" class="sc-field__help tw:text-[11px] tw:text-(--color-text-secondary) tw:mt-1">
            {{ t("onlineEvals.scoreConfig.descriptionHelp") }}
          </div>
        </div>

        <!-- Data type -->
        <div class="sc-field">
          <label class="sc-field__label o-input-label">
            {{ t("onlineEvals.scoreConfig.dataTypeLabel")
            }}<span v-if="mode === 'create'" class="tw:select-none" aria-hidden="true">&nbsp;*</span>
          </label>
          <!-- Radio cards reuse ORadio inside ORadioGroup. ORadio doesn't accept a
               fallthrough class, so the card chrome (border + selected highlight)
               lives on the wrapper div, parent-controlled via form.dataType; each
               option's help shows inline via the #label slot. Locked in edit. -->
          <ORadioGroup
            v-model="form.dataType"
            :disabled="mode === 'edit'"
            orientation="horizontal"
            class="sc-dtype-radios"
            data-test="score-config-datatype-radios"
          >
            <div
              v-for="type in DATA_TYPES"
              :key="type"
              class="sc-dtype-radio"
              :class="{
                'sc-dtype-radio--selected': form.dataType === type,
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
        <div v-if="form.dataType === 'numeric'" class="sc-field">
          <label class="sc-field__label o-input-label">
            {{ t("onlineEvals.scoreConfig.numericRangeLabel") }}
          </label>
          <div class="sc-range-row tw:flex tw:items-center tw:gap-[10px]">
            <span class="sc-range-row__label tw:text-(--color-text-secondary) tw:text-[11px]">{{ t("onlineEvals.scoreConfig.minLabel") }}</span>
            <OInput
              v-model.number="form.min"
              type="number"
              size="sm"
              field-width="xs"
              data-test="score-config-min-input"
            />
            <span class="sc-range-row__label tw:text-(--color-text-secondary) tw:text-[11px]">{{ t("onlineEvals.scoreConfig.maxLabel") }}</span>
            <OInput
              v-model.number="form.max"
              type="number"
              size="sm"
              field-width="xs"
              data-test="score-config-max-input"
            />
          </div>
        </div>

        <!-- Categories -->
        <div v-if="form.dataType === 'categorical'" class="sc-field">
          <label class="sc-field__label o-input-label">
            {{ t("onlineEvals.scoreConfig.categoriesLabel") }}
          </label>
          <!-- Shared TagInput (same as SemanticGroupItem) — handles Enter/comma
               to add, chip × / backspace to remove. -->
          <TagInput
            v-model="form.categories"
            :placeholder="t('onlineEvals.scoreConfig.addCategoryPlaceholder')"
            data-test="score-config-categories-input"
          />
        </div>

        <!-- Boolean info banner -->
        <div
          v-if="form.dataType === 'boolean'"
          class="sc-callout sc-callout--neutral tw:flex tw:gap-[10px] tw:items-start tw:px-3 tw:py-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary,var(--o2-text-secondary))_12%,transparent)] tw:border tw:border-(--color-dialog-header-border) tw:rounded-md tw:text-xs tw:leading-normal tw:text-(--color-text-primary) tw:mb-4"
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
              <!-- The longer explanation now lives in a hover tooltip on the info
                   icon, right after the title. -->
              <OIcon name="info-outline" size="sm" class="sc-ht-section__info">
                <OTooltip
                  :content="t('onlineEvals.scoreConfig.healthyThresholdIntro')"
                  max-width="300px"
                />
              </OIcon>
            </span>
            <OBadge variant="default-outline" size="sm">{{ t("onlineEvals.scoreConfig.optional") }}</OBadge>
          </div>

          <!-- Numeric threshold -->
          <template v-if="form.dataType === 'numeric'">
            <div class="sc-ht-field-label tw:text-[11.5px] tw:font-semibold tw:text-(--color-text-primary) tw:mb-1.5">{{ t("onlineEvals.scoreConfig.healthyWhenValueIs") }}</div>
            <div class="sc-ht-radio-row tw:flex tw:flex-col tw:gap-1.5">
              <label
                class="sc-ht-num-radio tw:grid tw:grid-cols-[18px_22px_1fr_110px] tw:items-center tw:gap-[10px] tw:px-3 tw:py-1.5 tw:border tw:border-(--color-dialog-header-border) tw:rounded-[5px] tw:bg-(--color-card-bg) tw:cursor-pointer tw:transition-[border-color,background] tw:duration-[120ms]"
                :class="{ 'sc-ht-num-radio--selected': form.healthyDirection === 'gte' }"
              >
                <input type="radio" class="sc-radio" value="gte" v-model="form.healthyDirection" />
                <span class="sc-ht-sym sc-mono tw:text-[17px] tw:font-bold tw:text-(--color-text-primary) tw:text-center">≥</span>
                <span class="sc-ht-op tw:text-[12.5px] tw:text-(--color-text-primary)">{{ t("onlineEvals.scoreConfig.gteLabel") }}</span>
                <OInput
                  v-model.number="form.healthyGteValue"
                  type="number"
                  size="sm"
                  field-width="xs"
                  :placeholder="String(defaultGteValue)"
                  data-test="score-config-gte-value-input"
                  @focus="form.healthyDirection = 'gte'"
                />
              </label>
              <label
                class="sc-ht-num-radio tw:grid tw:grid-cols-[18px_22px_1fr_110px] tw:items-center tw:gap-[10px] tw:px-3 tw:py-1.5 tw:border tw:border-(--color-dialog-header-border) tw:rounded-[5px] tw:bg-(--color-card-bg) tw:cursor-pointer tw:transition-[border-color,background] tw:duration-[120ms]"
                :class="{ 'sc-ht-num-radio--selected': form.healthyDirection === 'lte' }"
              >
                <input type="radio" class="sc-radio" value="lte" v-model="form.healthyDirection" />
                <span class="sc-ht-sym sc-mono tw:text-[17px] tw:font-bold tw:text-(--color-text-primary) tw:text-center">≤</span>
                <span class="sc-ht-op tw:text-[12.5px] tw:text-(--color-text-primary)">{{ t("onlineEvals.scoreConfig.lteLabel") }}</span>
                <OInput
                  v-model.number="form.healthyLteValue"
                  type="number"
                  size="sm"
                  field-width="xs"
                  :placeholder="String(defaultLteValue)"
                  data-test="score-config-lte-value-input"
                  @focus="form.healthyDirection = 'lte'"
                />
              </label>
            </div>
          </template>

          <!-- Categorical threshold -->
          <template v-else-if="form.dataType === 'categorical'">
            <div class="sc-ht-field-label tw:text-[11.5px] tw:font-semibold tw:text-(--color-text-primary) tw:mb-1.5">{{ t("onlineEvals.scoreConfig.healthyCategories") }}</div>
            <div v-if="form.categories.length === 0" class="sc-ht-empty tw:text-[11.5px] tw:italic tw:text-(--color-text-secondary) tw:px-3 tw:py-[10px] tw:border tw:border-dashed tw:border-(--color-dialog-header-border) tw:rounded-[5px] tw:bg-(--color-card-bg)">
              {{ t("onlineEvals.scoreConfig.addCategoryPlaceholder") }}…
            </div>
            <div v-else class="sc-ht-checks tw:flex tw:flex-col tw:gap-0.5 tw:border tw:border-(--color-dialog-header-border) tw:rounded-[5px] tw:bg-(--color-card-bg) tw:p-1">
              <label
                v-for="cat in form.categories"
                :key="cat"
                class="sc-ht-check tw:flex tw:items-center tw:gap-[10px] tw:px-[10px] tw:py-[7px] tw:rounded tw:cursor-pointer tw:transition-[background] tw:duration-[120ms]"
                :class="{ 'sc-ht-check--on': form.healthyCategories.includes(cat) }"
              >
                <input
                  type="checkbox"
                  class="sc-checkbox"
                  :checked="form.healthyCategories.includes(cat)"
                  @change="toggleHealthyCategory(cat)"
                />
                <span class="sc-mono tw:font-[var(--o2-font-mono)]">{{ cat }}</span>
              </label>
            </div>
            <div class="sc-ht-example tw:flex tw:items-center tw:gap-1.5 tw:mt-2 tw:text-[11px] tw:text-(--color-text-secondary)">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.scoreConfig.healthyCategoriesHint") }}</span>
            </div>
          </template>

          <!-- Boolean threshold -->
          <template v-else>
            <div class="sc-ht-field-label tw:text-[11.5px] tw:font-semibold tw:text-(--color-text-primary) tw:mb-1.5">{{ t("onlineEvals.scoreConfig.healthyValue") }}</div>
            <div class="sc-ht-bool-radios tw:flex tw:flex-col tw:gap-1.5">
              <label
                class="sc-ht-bool-radio tw:grid tw:grid-cols-[16px_1fr] tw:items-start tw:gap-[10px] tw:px-3 tw:py-[7px] tw:border tw:border-(--color-dialog-header-border) tw:rounded-[5px] tw:bg-(--color-card-bg) tw:cursor-pointer tw:transition-[border-color,background] tw:duration-[120ms]"
                :class="{ 'sc-ht-bool-radio--selected': form.healthyBool === true }"
              >
                <input type="radio" class="sc-radio" :value="true" v-model="form.healthyBool" />
                <div>
                  <div class="sc-ht-bool-radio__hd tw:text-(--color-text-primary) tw:font-[var(--o2-font-mono)]">{{ t("onlineEvals.scoreConfig.trueIsHealthy") }}</div>
                  <div class="sc-ht-bool-radio__sub tw:text-[11px] tw:text-(--color-text-secondary) tw:mt-0.5 tw:leading-[1.4]">{{ t("onlineEvals.scoreConfig.trueIsHealthyHint") }}</div>
                </div>
              </label>
              <label
                class="sc-ht-bool-radio tw:grid tw:grid-cols-[16px_1fr] tw:items-start tw:gap-[10px] tw:px-3 tw:py-[7px] tw:border tw:border-(--color-dialog-header-border) tw:rounded-[5px] tw:bg-(--color-card-bg) tw:cursor-pointer tw:transition-[border-color,background] tw:duration-[120ms]"
                :class="{ 'sc-ht-bool-radio--selected': form.healthyBool === false }"
              >
                <input type="radio" class="sc-radio" :value="false" v-model="form.healthyBool" />
                <div>
                  <div class="sc-ht-bool-radio__hd tw:text-(--color-text-primary) tw:font-[var(--o2-font-mono)]">{{ t("onlineEvals.scoreConfig.falseIsHealthy") }}</div>
                  <div class="sc-ht-bool-radio__sub tw:text-[11px] tw:text-(--color-text-secondary) tw:mt-0.5 tw:leading-[1.4]">{{ t("onlineEvals.scoreConfig.falseIsHealthyHint") }}</div>
                </div>
              </label>
            </div>
          </template>

          <div class="sc-ht-section__foot tw:flex tw:items-start tw:gap-1.5 tw:mt-[10px] tw:pt-2 tw:border-t tw:border-dashed tw:border-(--color-dialog-header-border) tw:text-[11px] tw:text-(--color-text-secondary) tw:leading-normal">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.thresholdEmptyHint") }}</span>
          </div>
        </div>
      </form>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import TagInput from "@/components/alerts/TagInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type ScoreConfig,
  type ScoreDataType,
} from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "../utils/evalEntity";
import { showError } from "../utils/evalFormat";

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
const isSaving = ref(false);
const form = ref(initForm(props.row));
const initialFormSnapshot = JSON.stringify(form.value);

// Drawer open state — starts open (parent mounts this only when creating/editing
// a score config). Any dismiss path (× / Escape / overlay) flows through
// ODrawer's update:open(false) → we forward `cancel`, and the parent unmounts.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("cancel");
}

// Plain-text drawer title. Edit mode shows just the (immutable) config name —
// the name alone is enough context, no "Edit ·" prefix needed.
const drawerTitle = computed(() =>
  props.mode === "edit" && props.row
    ? props.row.name
    : t("onlineEvals.scoreConfig.createTitle"),
);

// Data-type radio options. Each option's help text renders inline (see template).
const DATA_TYPES = ["numeric", "categorical", "boolean"] as const;

// Name validation — a stable lowercase identifier (letters, digits, underscores).
// Only enforced on create; the name is immutable (disabled) in edit.
const nameError = ref("");
const NAME_PATTERN = /^[a-z0-9_]+$/;
function validateName(): boolean {
  if (props.mode === "edit") {
    nameError.value = "";
    return true;
  }
  const value = form.value.name.trim();
  if (!value) {
    nameError.value = t("onlineEvals.scoreConfig.nameRequired");
    return false;
  }
  if (!NAME_PATTERN.test(value)) {
    nameError.value = t("onlineEvals.scoreConfig.nameFormat");
    return false;
  }
  nameError.value = "";
  return true;
}

const nextVersionLabel = computed(() => {
  const v = props.row?.version ?? 0;
  return `v${v + 1}`;
});

const isDirty = computed(() => JSON.stringify(form.value) !== initialFormSnapshot);

const defaultGteValue = computed(() => {
  if (form.value.dataType !== "numeric") return 0;
  const max = Number(form.value.max ?? 1);
  return max ? Math.round(max * 0.7 * 100) / 100 : 0.7;
});

const defaultLteValue = computed(() => {
  if (form.value.dataType !== "numeric") return 0;
  const max = Number(form.value.max ?? 1);
  return max ? Math.round(max * 0.3 * 100) / 100 : 0.3;
});

function initForm(row: ScoreConfig | null) {
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

// TagInput owns add/remove of categories. Keep the healthy-category selection in
// sync: whenever a category disappears, drop it from the healthy set too.
watch(
  () => form.value.categories,
  (cats) => {
    form.value.healthyCategories = form.value.healthyCategories.filter((c) =>
      cats.includes(c),
    );
  },
  { deep: true },
);

function toggleHealthyCategory(cat: string) {
  if (form.value.healthyCategories.includes(cat)) {
    form.value.healthyCategories = form.value.healthyCategories.filter((c) => c !== cat);
  } else {
    form.value.healthyCategories = [...form.value.healthyCategories, cat];
  }
}

function buildNumericRange() {
  if (form.value.dataType !== "numeric") return null;
  if (typeof form.value.min !== "number" || typeof form.value.max !== "number") return null;
  return { min: form.value.min, max: form.value.max };
}

function buildCategories() {
  if (form.value.dataType !== "categorical") return null;
  return form.value.categories.length ? form.value.categories : null;
}

function buildHealthyThreshold() {
  if (form.value.dataType === "numeric") {
    const value =
      form.value.healthyDirection === "gte"
        ? form.value.healthyGteValue
        : form.value.healthyLteValue;
    if (value === undefined || Number.isNaN(value)) return null;
    return { direction: form.value.healthyDirection, value };
  }
  if (form.value.dataType === "categorical") {
    if (!form.value.healthyCategories.length) return null;
    return { healthy_categories: form.value.healthyCategories };
  }
  if (form.value.healthyBool === null) return null;
  return { healthy_value: form.value.healthyBool };
}

async function save() {
  if (!props.orgId) return;
  if (!validateName()) return;
  isSaving.value = true;
  try {
    const basePayload: Record<string, any> = {
      name: form.value.name,
      description: form.value.description || null,
      numericRange: buildNumericRange(),
      categories: buildCategories(),
      healthyThreshold: buildHealthyThreshold(),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scoreConfigs.update(props.orgId, entityId(props.row), basePayload);
    } else {
      await onlineEvalsService.scoreConfigs.create(props.orgId, {
        ...basePayload,
        dataType: form.value.dataType,
      });
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.scoreConfigs") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.scoreConfig.saveError"));
  } finally {
    isSaving.value = false;
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
  background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--o2-status-info-text) 20%, transparent);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 16px;
}

.sc-callout > :first-child {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--o2-status-info-text);
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
  color: var(--o2-status-info-text);
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
  background: color-mix(in srgb, color-mix(in srgb, var(--o2-status-success-text) 14%, transparent) 35%, transparent);
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
