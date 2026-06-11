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
    class="tw:flex tw:flex-col tw:px-2.5"
    style="height: calc(100vh - var(--navbar-height) - 14px)"
  >
    <!-- Standard app header: back tile + title (Save/Cancel stay in the footer). -->
    <AppPageHeader
      :title="isEdit ? t('evalTemplate.editTemplate') : t('evalTemplate.createTemplate')"
      :back="{
        label: t('pipeline.evalTemplates'),
        onClick: cancel,
        dataTest: 'eval-template-editor-back-btn',
      }"
      class="tw:-mx-2.5 tw:px-4 tw:border-b tw:border-border-default tw:mb-2 tw:shrink-0"
    >
      <template #title>
        <span data-test="eval-template-editor-title">{{
          isEdit ? t("evalTemplate.editTemplate") : t("evalTemplate.createTemplate")
        }}</span>
      </template>
    </AppPageHeader>

    <!-- Form content -->
    <div class="card-container tw:flex-1 tw:min-h-0 tw:mb-2 tw:flex tw:flex-col" style="padding: 1rem">
      <!-- Row 1: Name & Description -->
      <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
        <div style="flex: 1; display: flex; flex-direction: column">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("evalTemplate.templateName") }} *</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <OTooltip :content="t('evalTemplate.tooltipName')" side="top" />
            </OIcon>
          </div>
          <div class="o2-input" :class="{ 'field-error': errors.name }">
            <OInput
              v-model="form.name"
              @update:model-value="errors.name = false"
            />
          </div>
        </div>
        <div style="flex: 1; display: flex; flex-direction: column">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("common.description") }}</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <OTooltip :content="t('evalTemplate.tooltipDescription')" side="top" />
            </OIcon>
          </div>
          <div class="o2-input">
            <OInput v-model="form.description" />
          </div>
        </div>
      </div>

      <!-- Row 2: Response Type & Dimensions -->
      <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
        <div style="flex: 0 0 200px; display: flex; flex-direction: column">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("evalTemplate.responseType") }} *</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <OTooltip :content="t('evalTemplate.tooltipResponseType')" side="top" />
            </OIcon>
          </div>
          <div class="o2-input" :class="{ 'field-error': errors.response_type }">
            <OSelect
              v-model="form.response_type"
              :options="responseTypes"
              labelKey="label"
              valueKey="value"
              @update:model-value="errors.response_type = false"
            />
          </div>
        </div>
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden">
          <div class="field-label-row">
            <label class="textarea-label">{{ t("evalTemplate.dimensions") }} *</label>
            <OIcon name="info" size="xs" class="field-info-icon">
              <OTooltip :content="t('evalTemplate.tooltipDimensions')" side="top" />
            </OIcon>
          </div>
          <div :class="{ 'field-error': errors.dimensions }">
            <OSelect
              v-model="dimensionsInput"
              :options="defaultDimensionOptions"
              class="no-case dimensions-select tw:w-full"
              multiple
              searchable
              creatable
              @update:model-value="errors.dimensions = false"
            />
          </div>
          <OTooltip v-if="dimensionsInput.length >= 5" :content="dimensionsInput.join(', ')" side="top" />
        </div>
      </div>

      <!-- Row 3: Prompt Template -->
      <div style="display: flex; flex-direction: column; flex: 1; min-height: 0">
        <div class="field-label-row">
          <label class="textarea-label">{{ t("evalTemplate.promptTemplate") }} *</label>
          <OIcon name="info" size="xs" class="field-info-icon">
            <OTooltip :content="t('evalTemplate.tooltipPromptTemplate')" side="top" />
          </OIcon>
        </div>
          <OTextarea
            v-model="form.content"
            fill
            @update:model-value="errors.content = false"
          />
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
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { evalTemplateService } from "@/services/eval-template.service";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OTextarea from '@/lib/forms/Input/OTextarea.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toast } from "@/lib/feedback/Toast/useToast";


const { t } = useI18n();
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
  errors.value.name = !form.value.name;
  errors.value.response_type = !form.value.response_type;
  errors.value.content = !form.value.content;
  errors.value.dimensions = !dimensionsInput.value.length;

  if (
    errors.value.name ||
    errors.value.response_type ||
    errors.value.content ||
    errors.value.dimensions
  ) {
    toast({ variant: "warning", message: t("evalTemplate.saveRequiredFields") });
    return;
  }

  saving.value = true;
  const dismiss = toast({ variant: "loading", message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const payload = { ...form.value, dimensions: dimensionsInput.value };

    if (isEdit.value) {
      await evalTemplateService.updateTemplate(orgId, route.params.id as string, payload);
      toast({ variant: "success", message: t("evalTemplate.updateSuccess") });
    } else {
      await evalTemplateService.createTemplate(orgId, payload);
      toast({ variant: "success", message: t("evalTemplate.createSuccess") });
    }

    router.push({ name: "evalTemplates" });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        (isEdit.value ? t("evalTemplate.updateFailed") : t("evalTemplate.createFailed")),
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
      toast({
        variant: "error",
        message: err?.response?.data?.message || t("evalTemplate.loadFailed"),
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

  input {
    min-width: 80px !important;
    flex-shrink: 0 !important;
  }
}

// NOTE: Dark/light chip styling removed — `.q-chip` and `.body--dark/--light` selectors
// no longer match post-Quasar removal. Chip-like visuals are now provided by OBadge
// variants (use `<OBadge variant="default">` for the dimensions-select tag tokens).

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
  height: 100%;

}
</style>
