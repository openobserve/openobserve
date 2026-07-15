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
    class="flex flex-col px-2.5"
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
      class="-mx-2.5 px-4 border-b border-border-default mb-2 shrink-0"
    >
      <template #title>
        <span data-test="eval-template-editor-title">{{
          isEdit ? t("evalTemplate.editTemplate") : t("evalTemplate.createTemplate")
        }}</span>
      </template>
    </AppPageHeader>

    <OForm
      class="flex flex-col flex-1 min-h-0"
      :form="form"
      v-slot="{ isSubmitting }"
    >
      <!-- Form content -->
      <div class="card-container flex-1 min-h-0 mb-2 flex flex-col" style="padding: 1rem">
        <!-- Row 1: Name & Description -->
        <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
          <div style="flex: 1; display: flex; flex-direction: column">
            <div class="flex items-center gap-1 mb-2">
              <label class="text-xs font-medium mb-0 text-(--q-color-text) leading-none">{{ t("evalTemplate.templateName") }} *</label>
              <OIcon name="info" size="xs" class="opacity-45 cursor-default shrink-0 hover:opacity-75">
                <OTooltip :content="t('evalTemplate.tooltipName')" side="top" />
              </OIcon>
            </div>
            <div class="o2-input">
              <OFormInput name="name" data-test="eval-template-editor-name-input" />
            </div>
          </div>
          <div style="flex: 1; display: flex; flex-direction: column">
            <div class="flex items-center gap-1 mb-2">
              <label class="text-xs font-medium mb-0 text-(--q-color-text) leading-none">{{ t("common.description") }}</label>
              <OIcon name="info" size="xs" class="opacity-45 cursor-default shrink-0 hover:opacity-75">
                <OTooltip :content="t('evalTemplate.tooltipDescription')" side="top" />
              </OIcon>
            </div>
            <div class="o2-input">
              <OFormInput name="description" data-test="eval-template-editor-description-input" />
            </div>
          </div>
        </div>

        <!-- Row 2: Response Type & Dimensions -->
        <div style="display: flex; gap: 1rem; margin-bottom: 1rem">
          <div style="flex: 0 0 200px; display: flex; flex-direction: column">
            <div class="flex items-center gap-1 mb-2">
              <label class="text-xs font-medium mb-0 text-(--q-color-text) leading-none">{{ t("evalTemplate.responseType") }} *</label>
              <OIcon name="info" size="xs" class="opacity-45 cursor-default shrink-0 hover:opacity-75">
                <OTooltip :content="t('evalTemplate.tooltipResponseType')" side="top" />
              </OIcon>
            </div>
            <div class="o2-input">
              <OFormSelect
                name="response_type"
                :options="responseTypes"
                labelKey="label"
                valueKey="value"
                data-test="eval-template-editor-response-type-select"
              />
            </div>
          </div>
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden">
            <div class="flex items-center gap-1 mb-2">
              <label class="text-xs font-medium mb-0 text-(--q-color-text) leading-none">{{ t("evalTemplate.dimensions") }} *</label>
              <OIcon name="info" size="xs" class="opacity-45 cursor-default shrink-0 hover:opacity-75">
                <OTooltip :content="t('evalTemplate.tooltipDimensions')" side="top" />
              </OIcon>
            </div>
            <OFormSelect
              name="dimensions"
              :options="defaultDimensionOptions"
              class="no-case dimensions-select w-full"
              multiple
              searchable
              creatable
              data-test="eval-template-editor-dimensions-select"
            />
            <OTooltip v-if="dimensions.length >= 5" :content="dimensions.join(', ')" side="top" />
          </div>
        </div>

        <!-- Row 3: Prompt Template -->
        <div style="display: flex; flex-direction: column; flex: 1; min-height: 0">
          <div class="flex items-center gap-1 mb-2">
            <label class="text-xs font-medium mb-0 text-(--q-color-text) leading-none">{{ t("evalTemplate.promptTemplate") }} *</label>
            <OIcon name="info" size="xs" class="opacity-45 cursor-default shrink-0 hover:opacity-75">
              <OTooltip :content="t('evalTemplate.tooltipPromptTemplate')" side="top" />
            </OIcon>
          </div>
          <OFormTextarea name="content" fill data-test="eval-template-editor-content-input" />
        </div>
      </div>

      <!-- Footer -->
      <div
        class="card-container flex items-center justify-end px-3 py-2.5 shrink-0 gap-2"
      >
        <OButton
          data-test="eval-template-editor-cancel-btn"
          type="button"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </OButton>
        <OButton
          data-test="eval-template-editor-save-btn"
          type="submit"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting"
        >
          {{ isEdit ? t('common.update') : t('common.save') }}
        </OButton>
      </div>
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { evalTemplateService } from "@/services/eval-template.service";
import OButton from '@/lib/core/Button/OButton.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import { useOForm } from '@/lib/forms/Form/useOForm';
import OFormInput from '@/lib/forms/Input/OFormInput.vue';
import OFormTextarea from '@/lib/forms/Input/OFormTextarea.vue';
import OFormSelect from '@/lib/forms/Select/OFormSelect.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeEvalTemplateSchema,
  evalTemplateDefaults,
  type EvalTemplateForm,
} from "./EvalTemplateEditor.schema";


const { t } = useI18n();
const store = useStore();
const router = useRouter();
const route = useRoute();

const isEdit = computed(() => !!route.params.id);

// Co-located Zod schema replaces the hand-rolled `errors` ref + manual checks.
const evalTemplateSchema = makeEvalTemplateSchema(t);

// OWNER pattern (Rule ③): this component owns <OForm>, so it creates the form
// with useOForm — a SINGLE source of truth, NO mirror. `dimensions` is read
// reactively via form.useStore for the parent template's ">= 5" overflow
// tooltip; the @submit handler reads the validated `value`. Edit data arrives
// async (onBeforeMount) → form.reset(record) once it loads.
const form = useOForm<EvalTemplateForm>({
  defaultValues: evalTemplateDefaults(),
  schema: evalTemplateSchema,
  onSubmit: saveTemplate,
});
const dimensions = form.useStore((s: any) => s.values.dimensions as string[]);

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

// @submit handler — OForm only calls this once the schema passes (name/
// response_type/content required + dimensions ≥ 1), so the schema (not the old
// manual `errors` checks) gates the save. OForm awaits this → the Save spinner
// is form-driven (no manual `saving` ref).
async function saveTemplate(value: EvalTemplateForm) {
  const dismiss = toast({ variant: "loading", message: t("common.loading"), timeout: 0 });

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const payload = {
      name: value.name,
      response_type: value.response_type,
      description: value.description,
      content: value.content,
      dimensions: value.dimensions,
    };

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
    dismiss();
  }
}

// ── Lifecycle: load template for edit ─────────────────────────────────────────
onBeforeMount(async () => {
  if (!isEdit.value) return;

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const template = await evalTemplateService.getTemplate(
      orgId,
      route.params.id as string,
    );
    // Edit data arrives AFTER mount → reset the one form once it loads (not a
    // per-field write); the `dimensions` useStore view updates with it.
    form.reset({
      name: template.name,
      response_type: template.response_type,
      description: template.description || "",
      content: template.content,
      dimensions: [...(template.dimensions ?? [])],
    });
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
</style>
