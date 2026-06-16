<template>
  <div
    class="sc-drawer-scrim tw:fixed tw:inset-0 tw:bg-[rgba(0,0,0,0.32)] tw:z-[6000]"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('cancel')"
  >
    <aside
      class="sc-drawer tw:fixed tw:top-0 tw:right-0 tw:bottom-0 tw:w-[50vw] tw:min-w-[560px] tw:max-w-[760px] tw:bg-(--color-card-bg) tw:border-l tw:border-(--color-dialog-header-border) tw:shadow-[var(--o2-shadow-lg,0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08))] tw:flex tw:flex-col tw:z-[6001]"
      @click.stop
    >
      <header class="tw:flex tw:items-center tw:gap-3 tw:px-5.5 tw:py-3.5 tw:border-b tw:border-dialog-header-border tw:shrink-0">
        <span class="tw:text-base tw:font-semibold tw:text-text-primary tw:min-w-0">
          <template v-if="mode === 'edit' && row">
            {{ t("onlineEvals.scoreConfig.editTitlePrefix") }} ·
            <span class="sc-mono tw:font-[var(--o2-font-mono)]">{{ row.name }}</span>
          </template>
          <template v-else>{{ t("onlineEvals.scoreConfig.createTitle") }}</template>
        </span>
        <div class="tw:flex-1" />
        <button
          type="button"
          class="sc-drawer__close tw:inline-flex tw:items-center tw:justify-center tw:w-7 tw:h-7 tw:p-0 tw:text-(--color-text-secondary) tw:bg-transparent tw:border-0 tw:rounded-md tw:cursor-pointer tw:transition-[background,color] tw:duration-150"
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

      <form class="tw:flex-1 tw:overflow-auto tw:px-5.5 tw:pt-3.5 tw:pb-2" @submit.prevent="save">
        <div
          v-if="mode === 'edit'"
          class="sc-callout tw:flex tw:gap-[10px] tw:items-start tw:px-3 tw:py-[10px] tw:bg-[color-mix(in_srgb,var(--o2-status-info-text)_14%,transparent)] tw:border tw:border-[color-mix(in_srgb,var(--o2-status-info-text)_20%,transparent)] tw:rounded-md tw:text-xs tw:leading-normal tw:text-(--color-text-primary) tw:mb-4"
        >
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
        <div class="sc-field tw:mb-[10px]">
          <label class="sc-field__label tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
            {{ t("onlineEvals.scoreConfig.nameLabel") }}
            <span v-if="mode === 'create'" class="sc-field__req tw:text-(--o2-status-error-text) tw:ml-0.5">*</span>
            <span v-else class="sc-field__lock tw:inline-flex tw:items-center tw:gap-1 tw:ml-2 tw:text-(--color-text-secondary) tw:font-normal tw:text-[11px]">
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
          <div v-if="mode === 'create'" class="sc-field__help tw:text-[11px] tw:text-(--color-text-secondary) tw:mt-1">
            {{ t("onlineEvals.scoreConfig.nameHelp") }}
          </div>
        </div>

        <!-- Description -->
        <div class="sc-field tw:mb-[10px]">
          <label class="sc-field__label tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">{{ t("onlineEvals.scoreConfig.descriptionLabel") }}</label>
          <OInput
            v-model.trim="form.description"
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
        <div class="sc-field tw:mb-[10px]">
          <label class="sc-field__label tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
            {{ t("onlineEvals.scoreConfig.dataTypeLabel") }}
            <span v-if="mode === 'create'" class="sc-field__req tw:text-(--o2-status-error-text) tw:ml-0.5">*</span>
            <span v-else class="sc-field__lock tw:inline-flex tw:items-center tw:gap-1 tw:ml-2 tw:text-(--color-text-secondary) tw:font-normal tw:text-[11px]">
              <OIcon name="lock" size="xs" />
              {{ t("onlineEvals.scoreConfig.dataTypeLocked") }}
            </span>
          </label>
          <div v-if="mode === 'edit'" class="sc-locked-row tw:inline-flex tw:items-center tw:gap-2 tw:px-[10px] tw:py-1.5 tw:bg-[color-mix(in_srgb,var(--color-text-secondary,var(--o2-text-secondary))_12%,transparent)] tw:border tw:border-(--color-dialog-header-border) tw:rounded-md">
            <span class="sc-dtype-chip tw:inline-flex tw:items-center tw:gap-1 tw:px-[7px] tw:py-px tw:rounded-[3px] tw:font-semibold tw:text-[11px] tw:leading-normal" :class="`sc-dtype-chip--${form.dataType}`">{{ form.dataType }}</span>
          </div>
          <template v-else>
            <div class="sc-dtype-grid tw:grid tw:grid-cols-3 tw:gap-2 tw:mt-0.5">
              <label
                v-for="type in (['numeric', 'categorical', 'boolean'] as const)"
                :key="type"
                class="sc-dtype-radio tw:grid tw:grid-cols-[16px_1fr] tw:gap-2 tw:p-2 tw:px-3 tw:border tw:border-(--color-dialog-header-border) tw:rounded-md tw:bg-(--color-card-bg) tw:cursor-pointer tw:items-start tw:transition-[border-color,background] tw:duration-[120ms]"
                :class="{ 'sc-dtype-radio--selected': form.dataType === type }"
              >
                <input type="radio" class="sc-radio" :value="type" v-model="form.dataType" />
                <div>
                  <div class="sc-dtype-radio__hd tw:text-[12.5px] tw:font-bold tw:text-(--color-text-primary)">{{ t(`onlineEvals.scoreConfig.dataTypes.${type}`) }}</div>
                  <div class="sc-dtype-radio__sub tw:text-[11px] tw:text-(--color-text-secondary) tw:mt-[3px] tw:leading-[1.4]">{{ t(`onlineEvals.scoreConfig.dataTypeHelp.${type}`) }}</div>
                </div>
              </label>
            </div>
            <div class="sc-field__help sc-field__help--lock tw:text-[11px] tw:text-(--color-text-secondary) tw:mt-1 tw:inline-flex tw:items-center tw:gap-1">
              <OIcon name="lock" size="xs" />
              {{ t("onlineEvals.scoreConfig.dataTypeCannotChange") }}
            </div>
          </template>
        </div>

        <!-- Numeric range -->
        <div v-if="form.dataType === 'numeric'" class="sc-field tw:mb-[10px]">
          <label class="sc-field__label tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
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
        <div v-if="form.dataType === 'categorical'" class="sc-field tw:mb-[10px]">
          <label class="sc-field__label tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
            {{ t("onlineEvals.scoreConfig.categoriesLabel") }}
          </label>
          <div class="sc-tag-input tw:flex tw:items-center tw:flex-wrap tw:gap-1.5 tw:min-h-8 tw:px-2 tw:py-[5px] tw:border tw:border-(--color-input-border) tw:rounded tw:bg-(--color-card-bg)">
            <span
              v-for="(cat, idx) in form.categories"
              :key="`${cat}-${idx}`"
              class="sc-tag tw:inline-flex tw:items-center tw:gap-1 tw:pl-2 tw:pr-1 tw:py-px tw:bg-[color-mix(in_srgb,var(--color-text-secondary,var(--o2-text-secondary))_12%,transparent)] tw:rounded-full tw:font-semibold tw:text-[11px] tw:text-(--color-text-primary)"
            >
              {{ cat }}
              <button
                type="button"
                class="sc-tag__x tw:w-[18px] tw:h-[18px] tw:rounded-full tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-(--color-text-secondary) tw:inline-flex tw:items-center tw:justify-center"
                @click="removeCategory(idx)"
              >
                <OIcon name="close" size="xs" />
              </button>
            </span>
            <input
              class="sc-tag-input__field tw:flex-1 tw:min-w-[120px] tw:border-0 tw:outline-0 tw:bg-transparent tw:text-xs tw:text-(--color-text-primary)"
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
        <div class="sc-ht-section tw:mt-1 tw:px-3.5 tw:pt-3 tw:pb-[10px] tw:border tw:border-(--color-dialog-header-border) tw:rounded-md tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_2.5%,var(--color-card-bg))]">
          <div class="sc-ht-section__head tw:flex tw:items-center tw:gap-[10px] tw:mb-1">
            <span class="sc-ht-section__kicker tw:font-bold tw:text-[11px] tw:tracking-[0.02em] tw:text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.healthyThresholdTitle") }}</span>
            <span class="sc-ht-section__optional tw:font-semibold tw:text-[10px] tw:tracking-[0.02em] tw:text-(--color-text-secondary) tw:bg-[color-mix(in_srgb,var(--color-text-secondary,var(--o2-text-secondary))_12%,transparent)] tw:rounded-[3px] tw:px-1.5 tw:py-px">{{ t("onlineEvals.scoreConfig.optional") }}</span>
          </div>
          <p class="sc-ht-section__intro tw:m-0 tw:mb-[10px] tw:text-xs tw:text-(--color-text-secondary) tw:leading-normal tw:max-w-[520px]">{{ t("onlineEvals.scoreConfig.healthyThresholdIntro") }}</p>

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

      <footer class="tw:sticky tw:bottom-0 tw:flex tw:items-center tw:justify-end tw:gap-2 tw:px-5.5 tw:py-3 tw:border-t tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0 tw:z-1">
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

<style>
/* sc-drawer-scrim: animation cannot be inlined */
.sc-drawer-scrim {
  animation: sc-scrim-in 0.15s ease-out;
}

/* sc-drawer: animation cannot be inlined */
.sc-drawer {
  animation: sc-drawer-in 0.2s ease-out;
}

/* hover pseudo-class: cannot be inlined */
.sc-drawer__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

/* child selector: cannot be inlined */
.sc-callout > :first-child {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--o2-status-info-text);
}

/* descendant selector: cannot be inlined */
.sc-callout__lead strong { font-weight: 700; }

/* child selector for neutral callout icon: cannot be inlined */
.sc-callout--neutral > :first-child { color: var(--color-text-secondary, var(--o2-text-secondary)); }

/* dtype chip color variants — dynamic class applied via :class binding */
.sc-dtype-chip--numeric { background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent); color: var(--o2-status-info-text); }
.sc-dtype-chip--categorical { background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent); color: var(--o2-status-warning-text); }
.sc-dtype-chip--boolean { background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent); color: var(--o2-status-success-text); }

/* hover pseudo-class: cannot be inlined */
.sc-dtype-radio:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border, var(--o2-border)));
}

/* dynamic selected state: cannot be inlined */
.sc-dtype-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--color-card-bg));
}

/* tag__x hover: cannot be inlined */
.sc-tag__x:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--o2-status-error-text);
}

/* placeholder pseudo-element: cannot be inlined */
.sc-tag-input__field::placeholder {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* hover pseudo-class: cannot be inlined */
.sc-ht-num-radio:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 40%, var(--color-dialog-header-border, var(--o2-border)));
}

/* dynamic selected state: cannot be inlined */
.sc-ht-num-radio--selected {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
}

/* child selector: cannot be inlined */
.sc-ht-section__foot > :first-child {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* hover pseudo-class: cannot be inlined */
.sc-ht-check:hover { background: color-mix(in srgb, var(--color-text-primary) 6%, transparent); }

/* dynamic checked state: cannot be inlined */
.sc-ht-check--on {
  background: color-mix(in srgb, color-mix(in srgb, var(--o2-status-success-text) 14%, transparent) 35%, transparent);
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

/* hover pseudo-class: cannot be inlined */
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
