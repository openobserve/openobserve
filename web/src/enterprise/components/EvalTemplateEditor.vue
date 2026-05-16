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

<template>
  <div
    data-test="eval-template-editor-page"
    class="tw:flex tw:flex-col tw:pr-[0.625rem]"
    style="height: calc(100vh - var(--navbar-height) - 14px)"
  >
    <!-- Header bar -->
    <div class="card-container tw:mb-2 tw:shrink-0">
      <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:h-[64px]">
        <OButton
          data-test="eval-template-editor-back-btn"
          icon-left="chevron-left"
          variant="outline"
          size="icon-xs-sq"
          @click="cancel"
        />
        <span class="q-table__title tw:font-[600]" data-test="eval-template-editor-title">
          {{ isEdit ? t("evalTemplate.editTemplate") : t("evalTemplate.createTemplate") }}
        </span>
      </div>
    </div>

    <!-- Form content -->
    <div class="card-container tw:flex-1 tw:min-h-0 tw:mb-2 tw:flex tw:flex-col" style="padding: 1rem">
      <!-- Row 1: Name & Description -->
      <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
        <div style="flex: 1; display: flex; flex-direction: column">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("evalTemplate.templateName") }} *</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <q-tooltip>{{ t("evalTemplate.tooltipName") }}</q-tooltip>
            </OIcon>
          </div>
          <div class="o2-input" :class="{ 'field-error': errors.name }">
            <q-input
              v-model="form.name"
              borderless
              dense
              @update:model-value="errors.name = false"
            />
          </div>
        </div>
        <div style="flex: 1; display: flex; flex-direction: column">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("common.description") }}</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <q-tooltip>{{ t("evalTemplate.tooltipDescription") }}</q-tooltip>
            </OIcon>
          </div>
          <div class="o2-input">
            <q-input v-model="form.description" borderless dense />
          </div>
        </div>
      </div>

      <!-- Row 2: Response Type & Dimensions -->
      <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
        <div style="flex: 0 0 200px; display: flex; flex-direction: column">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("evalTemplate.responseType") }} *</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <q-tooltip>{{ t("evalTemplate.tooltipResponseType") }}</q-tooltip>
            </OIcon>
          </div>
          <div class="o2-input">
            <q-select
              v-model="form.response_type"
              :options="responseTypes"
              emit-value
              map-options
              borderless
              dense
              :rules="[(val) => !!val || t('evalTemplate.responseTypeRequired')]"
            />
          </div>
        </div>
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("evalTemplate.dimensions") }} *</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <q-tooltip>{{ t("evalTemplate.tooltipDimensions") }}</q-tooltip>
            </OIcon>
          </div>
          <q-select
            v-model="dimensionsInput"
            :options="filteredDimensionOptions"
            color="input-border"
            bg-color="input-bg"
            class="no-case dimensions-select tw:w-full"
            dense
            borderless
            multiple
            use-chips
            use-input
            input-debounce="300"
            new-value-mode="add-unique"
            no-error-icon
            @filter="filterDimensions"
            :rules="[
              (val) =>
                (val && val.length > 0) || t('evalTemplate.dimensionRequired'),
            ]"
          >
            <q-tooltip v-if="dimensionsInput.length >= 5" anchor="top middle" self="bottom middle">
              {{ dimensionsInput.join(", ") }}
            </q-tooltip>
          </q-select>
        </div>
      </div>

      <!-- Row 3: Prompt Template -->
      <div style="display: flex; flex-direction: column; flex: 1; min-height: 0">
        <div class="field-label-row">
          <label class="textarea-label">{{ t("evalTemplate.promptTemplate") }} *</label>
          <OIcon name="info" size="xs" class="field-info-icon">
            <q-tooltip>{{ t("evalTemplate.tooltipPromptTemplate") }}</q-tooltip>
          </OIcon>
        </div>
        <div class="textarea-border" style="flex: 1; display: flex; flex-direction: column">
          <q-input
            v-model="form.content"
            borderless
            dense
            type="textarea"
            class="prompt-input"
            no-error-icon
            :rules="[(val) => !!val || t('evalTemplate.contentRequired')]"
            input-style="resize: none; height: 100%"
          />
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="card-container tw:flex tw:items-center tw:justify-end tw:px-3 tw:py-2.5 tw:shrink-0 tw:gap-2"
    >
      <OButton
        data-test="eval-template-editor-cancel-btn"
        variant="outline"
        size="sm-action"
        @click="cancel"
      >
        {{ t('common.cancel') }}
      </OButton>
      <OButton
        data-test="eval-template-editor-save-btn"
        variant="primary"
        size="sm-action"
        :loading="saving"
        @click="saveTemplate"
      >
        {{ isEdit ? t('common.update') : t('common.save') }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { evalTemplateService } from "@/services/eval-template.service";
import OButton from '@/lib/core/Button/OButton.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";


const { t } = useI18n();
const q = useQuasar();
const store = useStore();
const router = useRouter();
const route = useRoute();

const isEdit = computed(() => !!route.params.id);
const saving = ref(false);

const form = ref({
  name: "",
  response_type: "",
  description: "",
  content: "",
});

const dimensionsInput = ref<string[]>([]);
const errors = ref({ name: false, response_type: false, dimensions: false, content: false });

// ── Dimension options ──────────────────────────────────────────────────────────
const defaultDimensionOptions = [
  "accuracy",
  "clarity",
  "completeness",
  "coherence",
  "conciseness",
  "correctness",
  "faithfulness",
  "helpfulness",
  "relevance",
  "safety",
  "toxicity",
];

const filteredDimensionOptions = ref<string[]>(defaultDimensionOptions);

const filterDimensions = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (!val) {
      filteredDimensionOptions.value = defaultDimensionOptions;
    } else {
      const needle = val.toLowerCase();
      filteredDimensionOptions.value = defaultDimensionOptions.filter((d) =>
        d.includes(needle),
      );
    }
  });
};

const responseTypes = [
  { label: t("evalTemplate.typeScore"), value: "score" },
  { label: t("evalTemplate.typeBoolean"), value: "boolean" },
  { label: t("evalTemplate.typeCustom"), value: "custom" },
];

// ── Actions ────────────────────────────────────────────────────────────────────
const cancel = () => {
  router.push({ name: "evalTemplates" });
};

const saveTemplate = async () => {
  if (
    !form.value.name ||
    !form.value.response_type ||
    !form.value.content ||
    !dimensionsInput.value.length
  ) {
    q.notify({ type: "warning", message: t("evalTemplate.saveRequiredFields") });
    return;
  }

  saving.value = true;
  const dismiss = q.notify({ spinner: true, message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const payload = { ...form.value, dimensions: dimensionsInput.value };

    if (isEdit.value) {
      await evalTemplateService.updateTemplate(orgId, route.params.id as string, payload);
      q.notify({ type: "positive", message: t("evalTemplate.updateSuccess") });
    } else {
      await evalTemplateService.createTemplate(orgId, payload);
      q.notify({ type: "positive", message: t("evalTemplate.createSuccess") });
    }

    router.push({ name: "evalTemplates" });
  } catch (err: any) {
    q.notify({
      type: "negative",
      message:
        err?.response?.data?.message ||
        (isEdit.value ? t("evalTemplate.updateFailed") : t("evalTemplate.createFailed")),
      timeout: 3000,
    });
  } finally {
    saving.value = false;
    dismiss();
  }
};

// ── Lifecycle: load template for edit ─────────────────────────────────────────
onBeforeMount(async () => {
  if (!isEdit.value) return;

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const template = await evalTemplateService.getTemplate(
      orgId,
      route.params.id as string,
    );
    form.value = {
      name: template.name,
      response_type: template.response_type,
      description: template.description || "",
      content: template.content,
    };
    dimensionsInput.value = [...(template.dimensions ?? [])];
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      q.notify({
        type: "negative",
        message: err?.response?.data?.message || t("evalTemplate.loadFailed"),
        timeout: 3000,
      });
    }
    router.push({ name: "evalTemplates" });
  }
});
</script>

<style scoped lang="scss">
:deep(.dimensions-select) {
  .q-field__bottom {
    display: none !important;
  }
}

:deep(.dimensions-select.q-field--auto-height) {
  max-width: 100%;
  min-width: 0;

  .q-field__control {
    height: 40px !important;
    max-height: 40px !important;
    overflow: hidden !important;
    display: flex;
    align-items: center;
  }

  .q-field__control-container {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    padding-right: 36px;
    display: flex;
    align-items: center;
    overflow: hidden;
    height: 100%;
  }

  .q-field__native {
    height: 100% !important;
    min-height: unset !important;
    gap: 4px;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: center !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    scrollbar-width: none;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .q-chip {
    margin: 0 !important;
    font-size: 13px;
    flex-shrink: 0;
  }

  input {
    min-width: 80px !important;
    flex-shrink: 0 !important;
  }

  .q-field__append {
    padding-left: 8px;
    height: 40px !important;
  }
}

.body--dark :deep(.dimensions-select) .q-chip {
  background-color: rgba(255, 255, 255, 0.1) !important;
  color: #e0e0e0 !important;

  .OIcon {
    color: #e0e0e0 !important;
    opacity: 0.8;
    &:hover { opacity: 1; }
  }
}

.body--light :deep(.dimensions-select) .q-chip {
  background-color: rgba(0, 0, 0, 0.08) !important;
  color: #424242 !important;

  .OIcon {
    color: #424242 !important;
    opacity: 0.7;
    &:hover { opacity: 1; }
  }
}

// ── Fields ────────────────────────────────────────────────────────────────────
.field-label-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 0.5rem;

  .textarea-label {
    margin-bottom: 0;
  }
}

.field-info-icon {
  color: var(--q-color-text);
  opacity: 0.45;
  cursor: default;
  flex-shrink: 0;

  &:hover {
    opacity: 0.75;
  }
}

.textarea-border {
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;

  :deep(.q-field__control) {
    border: none !important;
    box-shadow: none !important;
  }
}

.textarea-label {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--q-color-text);
  line-height: 1;
}

.prompt-input {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;

  :deep(.q-field__inner) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  :deep(.q-field__control) {
    flex: 1;
    min-height: 0;
    height: auto !important;
    align-items: stretch;
  }

  :deep(.q-field__control-container) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  :deep(textarea) {
    flex: 1;
    min-height: 0;
    height: 100% !important;
    resize: none !important;
    padding: 8px 12px !important;
  }
}
</style>
