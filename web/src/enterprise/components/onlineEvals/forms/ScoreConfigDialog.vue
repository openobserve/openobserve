<template>
  <div class="sc-drawer-scrim" role="dialog" aria-modal="true" @click.self="$emit('cancel')">
    <aside class="sc-drawer" @click.stop>
      <header class="sc-drawer__header">
        <span class="sc-drawer__title">
          <template v-if="mode === 'edit' && row">
            {{ t("onlineEvals.scoreConfig.editTitlePrefix") }} ·
            <span class="sc-mono">{{ row.name }}</span>
          </template>
          <template v-else>{{ t("onlineEvals.scoreConfig.createTitle") }}</template>
        </span>
        <div class="sc-drawer__header-spacer" />
        <button
          type="button"
          class="sc-drawer__close"
          aria-label="Close drawer"
          data-test="score-config-close-btn"
          @click="$emit('cancel')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <form class="sc-drawer__body" @submit.prevent="save">
        <div v-if="mode === 'edit'" class="sc-callout">
          <OIcon name="info" size="xs" />
          <div class="sc-callout__text">
            <i18n-t
              :keypath="`onlineEvals.scoreConfig.editInfoBannerEmphasis.${form.dataType}`"
              tag="span"
              class="sc-callout__lead"
            >
              <template #nextVersion>
                <strong>{{ nextVersionLabel }}</strong>
              </template>
            </i18n-t>
            <em class="sc-callout__detail">{{ t("onlineEvals.scoreConfig.editInfoBannerDetail") }}</em>
          </div>
        </div>

        <!-- Name -->
        <div class="sc-field">
          <label class="sc-field__label">
            {{ t("onlineEvals.scoreConfig.nameLabel") }}
            <span v-if="mode === 'create'" class="sc-field__req">*</span>
            <span v-else class="sc-field__lock">
              <OIcon name="lock" size="xs" />
              {{ t("onlineEvals.scoreConfig.cannotBeRenamed") }}
            </span>
          </label>
          <OInput
            v-model.trim="form.name"
            :disabled="mode === 'edit'"
            :placeholder="t('onlineEvals.scoreConfig.namePlaceholder')"
            size="sm"
            data-test="score-config-name-input"
          />
          <div v-if="mode === 'create'" class="sc-field__help">
            {{ t("onlineEvals.scoreConfig.nameHelp") }}
          </div>
        </div>

        <!-- Description -->
        <div class="sc-field">
          <label class="sc-field__label">{{ t("onlineEvals.scoreConfig.descriptionLabel") }}</label>
          <OInput
            v-model.trim="form.description"
            type="textarea"
            :placeholder="t('onlineEvals.scoreConfig.descriptionPlaceholder')"
            size="sm"
            :rows="3"
            data-test="score-config-description-input"
          />
          <div v-if="mode === 'edit'" class="sc-field__help">
            {{ t("onlineEvals.scoreConfig.descriptionHelp") }}
          </div>
        </div>

        <!-- Data type -->
        <div class="sc-field">
          <label class="sc-field__label">
            {{ t("onlineEvals.scoreConfig.dataTypeLabel") }}
            <span v-if="mode === 'create'" class="sc-field__req">*</span>
            <span v-else class="sc-field__lock">
              <OIcon name="lock" size="xs" />
              {{ t("onlineEvals.scoreConfig.dataTypeLocked") }}
            </span>
          </label>
          <div v-if="mode === 'edit'" class="sc-locked-row">
            <span class="sc-dtype-chip" :class="`sc-dtype-chip--${form.dataType}`">{{ form.dataType }}</span>
          </div>
          <template v-else>
            <div class="sc-dtype-grid">
              <label
                v-for="type in (['numeric', 'categorical', 'boolean'] as const)"
                :key="type"
                class="sc-dtype-radio"
                :class="{ 'sc-dtype-radio--selected': form.dataType === type }"
              >
                <input type="radio" class="sc-radio" :value="type" v-model="form.dataType" />
                <div>
                  <div class="sc-dtype-radio__hd">{{ t(`onlineEvals.scoreConfig.dataTypes.${type}`) }}</div>
                  <div class="sc-dtype-radio__sub">{{ t(`onlineEvals.scoreConfig.dataTypeHelp.${type}`) }}</div>
                </div>
              </label>
            </div>
            <div class="sc-field__help sc-field__help--lock">
              <OIcon name="lock" size="xs" />
              {{ t("onlineEvals.scoreConfig.dataTypeCannotChange") }}
            </div>
          </template>
        </div>

        <!-- Numeric range -->
        <div v-if="form.dataType === 'numeric'" class="sc-field">
          <label class="sc-field__label">
            {{ t("onlineEvals.scoreConfig.numericRangeLabel") }}
          </label>
          <div class="sc-range-row">
            <span class="sc-range-row__label">{{ t("onlineEvals.scoreConfig.minLabel") }}</span>
            <OInput
              v-model.number="form.min"
              type="number"
              size="sm"
              field-width="xs"
              data-test="score-config-min-input"
            />
            <span class="sc-range-row__label">{{ t("onlineEvals.scoreConfig.maxLabel") }}</span>
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
          <label class="sc-field__label">
            {{ t("onlineEvals.scoreConfig.categoriesLabel") }}
          </label>
          <div class="sc-tag-input">
            <span v-for="(cat, idx) in form.categories" :key="`${cat}-${idx}`" class="sc-tag">
              {{ cat }}
              <button type="button" class="sc-tag__x" @click="removeCategory(idx)">
                <OIcon name="close" size="xs" />
              </button>
            </span>
            <input
              class="sc-tag-input__field"
              v-model.trim="newCategory"
              :placeholder="form.categories.length ? '' : t('onlineEvals.scoreConfig.addCategoryPlaceholder')"
              @keydown.enter.prevent="addCategory"
              @keydown.,.prevent="addCategory"
            />
            <OButton
              type="button"
              variant="ghost"
              size="sm-action"
              icon-left="add"
              :disabled="!newCategory"
              @click="addCategory"
            >
              {{ t("onlineEvals.scoreConfig.addCategoryButton") }}
            </OButton>
          </div>
        </div>

        <!-- Boolean info banner -->
        <div v-if="form.dataType === 'boolean'" class="sc-callout sc-callout--neutral">
          <OIcon name="info" size="xs" />
          <span>
            {{ t("onlineEvals.scoreConfig.booleanInfo", { trueLabel: "true", falseLabel: "false" }) }}
          </span>
        </div>

        <!-- Healthy threshold -->
        <div class="sc-ht-section">
          <div class="sc-ht-section__head">
            <span class="sc-ht-section__kicker">{{ t("onlineEvals.scoreConfig.healthyThresholdTitle") }}</span>
            <span class="sc-ht-section__optional">{{ t("onlineEvals.scoreConfig.optional") }}</span>
          </div>
          <p class="sc-ht-section__intro">{{ t("onlineEvals.scoreConfig.healthyThresholdIntro") }}</p>

          <!-- Numeric threshold -->
          <template v-if="form.dataType === 'numeric'">
            <div class="sc-ht-field-label">{{ t("onlineEvals.scoreConfig.healthyWhenValueIs") }}</div>
            <div class="sc-ht-radio-row">
              <label
                class="sc-ht-num-radio"
                :class="{ 'sc-ht-num-radio--selected': form.healthyDirection === 'gte' }"
              >
                <input type="radio" class="sc-radio" value="gte" v-model="form.healthyDirection" />
                <span class="sc-ht-sym sc-mono">≥</span>
                <span class="sc-ht-op">{{ t("onlineEvals.scoreConfig.gteLabel") }}</span>
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
                class="sc-ht-num-radio"
                :class="{ 'sc-ht-num-radio--selected': form.healthyDirection === 'lte' }"
              >
                <input type="radio" class="sc-radio" value="lte" v-model="form.healthyDirection" />
                <span class="sc-ht-sym sc-mono">≤</span>
                <span class="sc-ht-op">{{ t("onlineEvals.scoreConfig.lteLabel") }}</span>
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
            <div class="sc-ht-field-label">{{ t("onlineEvals.scoreConfig.healthyCategories") }}</div>
            <div v-if="form.categories.length === 0" class="sc-ht-empty">
              {{ t("onlineEvals.scoreConfig.addCategoryPlaceholder") }}…
            </div>
            <div v-else class="sc-ht-checks">
              <label
                v-for="cat in form.categories"
                :key="cat"
                class="sc-ht-check"
                :class="{ 'sc-ht-check--on': form.healthyCategories.includes(cat) }"
              >
                <input
                  type="checkbox"
                  class="sc-checkbox"
                  :checked="form.healthyCategories.includes(cat)"
                  @change="toggleHealthyCategory(cat)"
                />
                <span class="sc-mono">{{ cat }}</span>
              </label>
            </div>
            <div class="sc-ht-example">
              <OIcon name="info" size="xs" />
              <span>{{ t("onlineEvals.scoreConfig.healthyCategoriesHint") }}</span>
            </div>
          </template>

          <!-- Boolean threshold -->
          <template v-else>
            <div class="sc-ht-field-label">{{ t("onlineEvals.scoreConfig.healthyValue") }}</div>
            <div class="sc-ht-bool-radios">
              <label
                class="sc-ht-bool-radio"
                :class="{ 'sc-ht-bool-radio--selected': form.healthyBool === true }"
              >
                <input type="radio" class="sc-radio" :value="true" v-model="form.healthyBool" />
                <div>
                  <div class="sc-ht-bool-radio__hd">{{ t("onlineEvals.scoreConfig.trueIsHealthy") }}</div>
                  <div class="sc-ht-bool-radio__sub">{{ t("onlineEvals.scoreConfig.trueIsHealthyHint") }}</div>
                </div>
              </label>
              <label
                class="sc-ht-bool-radio"
                :class="{ 'sc-ht-bool-radio--selected': form.healthyBool === false }"
              >
                <input type="radio" class="sc-radio" :value="false" v-model="form.healthyBool" />
                <div>
                  <div class="sc-ht-bool-radio__hd">{{ t("onlineEvals.scoreConfig.falseIsHealthy") }}</div>
                  <div class="sc-ht-bool-radio__sub">{{ t("onlineEvals.scoreConfig.falseIsHealthyHint") }}</div>
                </div>
              </label>
            </div>
          </template>

          <div class="sc-ht-section__foot">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.thresholdEmptyHint") }}</span>
          </div>
        </div>
      </form>

      <footer class="sc-drawer__foot">
        <OButton
          data-test="score-config-cancel-btn"
          type="button"
          variant="outline"
          size="sm-action"
          @click="$emit('cancel')"
        >
          {{ t("onlineEvals.buttons.cancel") }}
        </OButton>
        <OButton
          data-test="score-config-save-btn"
          type="button"
          variant="primary"
          size="sm-action"
          :loading="isSaving"
          :disabled="mode === 'edit' && !isDirty"
          @click="save"
        >
          {{ mode === "create" ? t("onlineEvals.scoreConfig.createButton") : t("onlineEvals.scoreConfig.saveButton") }}
        </OButton>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
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
const newCategory = ref("");
const form = ref(initForm(props.row));
const initialFormSnapshot = JSON.stringify(form.value);

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

function addCategory() {
  const value = newCategory.value.trim();
  if (!value || form.value.categories.includes(value)) {
    newCategory.value = "";
    return;
  }
  form.value.categories.push(value);
  newCategory.value = "";
}

function removeCategory(index: number) {
  const removed = form.value.categories[index];
  form.value.categories.splice(index, 1);
  if (removed) {
    form.value.healthyCategories = form.value.healthyCategories.filter((c) => c !== removed);
  }
}

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
.sc-drawer-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 6000;
  animation: sc-scrim-in 0.15s ease-out;
}

.sc-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 50vw;
  min-width: 560px;
  max-width: 760px;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-dialog-header-border, var(--o2-border));
  box-shadow: var(--o2-shadow-lg, 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08));
  display: flex;
  flex-direction: column;
  z-index: 6001;
  animation: sc-drawer-in 0.2s ease-out;
}

.sc-drawer__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  flex-shrink: 0;
}

.sc-drawer__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  min-width: 0;
}

.sc-drawer__header-spacer { flex: 1; }

.sc-drawer__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.sc-drawer__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.sc-drawer__body {
  flex: 1;
  overflow: auto;
  padding: 14px 22px 8px;
}

.sc-drawer__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px;
  border-top: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
  z-index: 1;
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

.sc-callout__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sc-callout__lead { font-weight: 400; }
.sc-callout__lead strong { font-weight: 700; }

.sc-callout__detail {
  font-style: italic;
  font-weight: 400;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-callout--neutral {
  background: color-mix(in srgb, var(--color-text-secondary, var(--o2-text-secondary)) 12%, transparent);
  border-color: var(--color-dialog-header-border, var(--o2-border));
}

.sc-callout--neutral > :first-child { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.sc-field {
  margin-bottom: 10px;
}

.sc-field__label {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 4px;
}

.sc-field__req {
  color: var(--o2-status-error-text);
  margin-left: 2px;
}

.sc-field__lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-weight: 400;
  font-size: 11px;
}

.sc-field__help {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-top: 4px;
}

.sc-field__help--lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sc-locked-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--color-text-secondary, var(--o2-text-secondary)) 12%, transparent);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
}

.sc-dtype-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 11px/1.5 var(--o2-font);
}
.sc-dtype-chip--numeric { background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent); color: var(--o2-status-info-text); }
.sc-dtype-chip--categorical { background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent); color: var(--o2-status-warning-text); }
.sc-dtype-chip--boolean { background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent); color: var(--o2-status-success-text); }

.sc-dtype-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-top: 2px;
}

.sc-dtype-radio {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
  cursor: pointer;
  align-items: start;
  transition: border-color 0.12s, background 0.12s;
}

.sc-dtype-radio:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border, var(--o2-border)));
}

.sc-dtype-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--color-card-bg));
}

.sc-dtype-radio__hd {
  font: 700 12.5px var(--o2-font);
  color: var(--color-text-primary, currentColor);
}

.sc-dtype-radio__sub {
  font-size: 11px;
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

.sc-tag-input {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 4px;
  background: var(--color-card-bg);
}

.sc-tag-input__field {
  flex: 1;
  min-width: 120px;
  border: 0;
  outline: 0;
  background: transparent;
  font: 400 12px inherit;
  color: var(--color-text-primary, currentColor);
}

.sc-tag-input__field::placeholder {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px 1px 8px;
  background: color-mix(in srgb, var(--color-text-secondary, var(--o2-text-secondary)) 12%, transparent);
  border-radius: 999px;
  font: 600 11px var(--o2-font);
  color: var(--color-text-primary, currentColor);
}

.sc-tag__x {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sc-tag__x:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--o2-status-error-text);
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
  margin-bottom: 4px;
}

.sc-ht-section__kicker {
  font: 700 11px var(--o2-font);
  letter-spacing: 0.02em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-ht-section__optional {
  font: 600 10px var(--o2-font);
  letter-spacing: 0.02em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  background: color-mix(in srgb, var(--color-text-secondary, var(--o2-text-secondary)) 12%, transparent);
  border-radius: 3px;
  padding: 1px 6px;
}


.sc-ht-section__intro {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  line-height: 1.5;
  max-width: 520px;
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

.sc-ht-section__foot > :first-child {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-ht-field-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 6px;
}

.sc-ht-radio-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sc-ht-num-radio {
  display: grid;
  grid-template-columns: 18px 22px 1fr 110px;
  align-items: center;
  gap: 10px;
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

.sc-ht-example > :first-child {
  flex-shrink: 0;
  color: var(--o2-status-info-text);
}

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
  flex-direction: column;
  gap: 6px;
}

.sc-ht-bool-radio {
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

.sc-ht-bool-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
}

.sc-ht-bool-radio__hd {
  color: var(--color-text-primary, currentColor);
  font-family: var(--o2-font-mono);
}

.sc-ht-bool-radio__sub {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-top: 2px;
  line-height: 1.4;
}

.sc-radio {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 50%;
  background: var(--color-card-bg);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
}

.sc-radio:checked { border-color: var(--color-primary-600, #3F7994); }

.sc-radio:checked::after {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary-600, #3F7994);
}

.sc-checkbox {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 3px;
  background: var(--color-card-bg);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  vertical-align: middle;
  flex-shrink: 0;
}

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

@keyframes sc-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes sc-drawer-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

@media (max-width: 900px) {
  .sc-drawer {
    width: 100vw;
    min-width: 0;
    max-width: none;
  }
  .sc-dtype-grid { grid-template-columns: 1fr; }
}
</style>
