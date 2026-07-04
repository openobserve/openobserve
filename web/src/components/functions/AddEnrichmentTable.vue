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
    data-test="add-enrichment-table-page"
    class="tw:flex tw:flex-col tw:px-2.5 tw:h-[calc(100vh-var(--navbar-height)-0.875rem)]"
  >
    <!-- Standard app header: back tile + title (Save/Cancel stay in the footer). -->
    <AppPageHeader
      :title="isUpdating ? t('function.updateEnrichmentTable') : t('function.addEnrichmentTable')"
      :back="{
        label: t('function.enrichmentTables'),
        onClick: () => $emit('cancel:hideform'),
        dataTest: 'add-enrichment-table-back-btn',
      }"
      class="tw:-mx-2.5 tw:px-4 tw:border-b tw:border-border-default tw:mb-2 tw:shrink-0"
    >
      <template #title>
        <span data-test="add-enrichment-table-title">{{
          isUpdating ? t("function.updateEnrichmentTable") : t("function.addEnrichmentTable")
        }}</span>
      </template>
    </AppPageHeader>

    <!-- Inline page form. Save lives in the footer INSIDE the <OForm>, so it is a
         native type="submit" (Enter submits) — no form-id needed. -->
    <OForm
      id="add-enrichment-table-form"
      :form="addEnrichmentTableForm"
      class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0"
      v-slot="{ isSubmitting }"
    >
      <!-- Form content -->
      <div class="card-container tw:flex-1 tw:min-h-0 tw:mb-2 tw:flex tw:flex-col tw:overflow-y-auto tw:p-4">
        <div class="tw:flex tw:flex-col tw:gap-4 tw:max-w-[40rem]">
            <OFormInput
              name="name"
              data-test="add-enrichment-table-name"
              :label="t('function.name')"
              required
              :readonly="isUpdating"
              :disabled="isUpdating"
            />

            <!-- Data Source Selection (only for new tables) -->
            <div v-if="!isUpdating" class="tw:flex tw:flex-col tw:gap-2">
              <div class="tw:text-gray-500 tw:font-bold">{{ t('function.dataSource') }}</div>
              <OFormOptionGroup
                name="source"
                data-test="add-enrichment-table-source"
                :options="sourceOptions"
                orientation="horizontal"
              />
            </div>

            <!-- Upload File Option (file-based tables, add or update) -->
            <OFormFile
              v-if="formData.source === 'file'"
              name="file"
              data-test="add-enrichment-table-file"
              :label="t('function.uploadCSVFile')"
              accept=".csv"
            />

            <!-- Append Toggle for File Upload (only when updating file-based tables) -->
            <OFormSwitch
              v-if="isUpdating && formData.source === 'file'"
              name="append"
              data-test="add-enrichment-table-append-switch"
              :label="t('function.appendData')"
            />

            <!-- Append/Replace Mode Toggle (only when updating URL-based tables) -->
            <div v-if="isUpdating && formData.source === 'url'" class="tw:flex tw:flex-col tw:gap-2">
              <div class="tw:text-gray-500 tw:font-bold">Update Mode</div>
              <OFormOptionGroup
                name="updateMode"
                data-test="add-enrichment-table-update-mode"
                :options="updateModeOptions"
                orientation="horizontal"
              />
            </div>

            <!-- Show existing URLs (only when updating URL-based tables) -->
            <div
              v-if="isUpdating && formData.source === 'url' && formData.urlJobs && formData.urlJobs.length > 0"
              class="tw:flex tw:flex-col tw:gap-2"
            >
              <div class="tw:text-gray-500 tw:font-bold tw:text-[0.8125rem]">
                Existing URLs ({{ formData.urlJobs.length }})
              </div>
              <div class="tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-gray-50 tw:p-2 tw:flex tw:flex-col tw:gap-1">
                <div v-for="(job, index) in formData.urlJobs" :key="job.id">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <span class="tw:font-medium tw:text-gray-400 tw:text-xs">{{ Number(index) + 1 }}.</span>
                    <OIcon
                      :name="job.status === 'completed' ? 'check-circle' : job.status === 'failed' ? 'warning' : job.status === 'processing' ? 'sync' : 'schedule'"
                      size="sm"
                      :class="[
                        job.status === 'processing' ? 'tw:[animation:rotate_2s_linear_infinite]' : '',
                        job.status === 'completed' ? 'tw:text-[var(--o2-positive)]' :
                        job.status === 'failed' ? 'tw:text-[var(--o2-negative)]' :
                        job.status === 'processing' ? 'tw:text-[var(--o2-primary)]' :
                        'tw:text-gray-500'
                      ]"
                    />
                    <div class="tw:text-gray-500 tw:text-[0.8125rem] tw:break-all">
                      {{ job.url }}
                    </div>
                  </div>
                  <OSeparator v-if="Number(index) < formData.urlJobs.length - 1" class="tw:my-1" />
                </div>
              </div>
            </div>

            <!-- Mode explanation (always show for URL-based tables in edit mode) -->
            <div
              v-if="isUpdating && formData.source === 'url'"
              class="tw:text-sm tw:text-gray-600 tw:p-3 tw:rounded-lg"
              :class="{
                'tw:bg-blue-50': formData.updateMode === 'reload',
                'tw:bg-green-50': formData.updateMode === 'append',
                'tw:bg-yellow-50': formData.updateMode === 'replace_failed',
                'tw:bg-orange-50': formData.updateMode === 'replace'
              }"
            >
              <template v-if="formData.updateMode === 'reload'">
                <strong>Reload Mode:</strong> Re-process all existing URLs from scratch. Use this when the CSV file content at the URLs has been updated but the URLs themselves haven't changed.
              </template>
              <template v-else-if="formData.updateMode === 'append'">
                <strong>Append Mode:</strong> Add a new URL to existing ones. Data from all URLs will be combined.
                <div class="tw:mt-2 tw:text-orange-700">
                  <strong>Important:</strong> The new CSV file must have the same columns as the existing data. The enrichment table schema cannot be changed.
                </div>
              </template>
              <template v-else-if="formData.updateMode === 'replace_failed'">
                <strong>Replace Failed URL:</strong> Replace only the failed URL with a new one. All successful URLs and their data will be kept. Use this to fix typos or broken URLs.
              </template>
              <template v-else-if="formData.updateMode === 'replace'">
                <strong>Replace Mode:</strong> Delete all existing URLs and data, then use only the new URL you provide below.
              </template>
            </div>

            <!-- URL input field for append, replace_failed, or replace mode (only when updating URL-based tables) -->
            <OFormInput
              v-if="isUpdating && formData.source === 'url' && (formData.updateMode === 'append' || formData.updateMode === 'replace_failed' || formData.updateMode === 'replace')"
              name="url"
              data-test="add-enrichment-table-new-url"
              :label="formData.updateMode === 'append' ? 'New CSV File URL' : 'Replacement CSV File URL'"
              placeholder="https://example.com/data.csv"
              :help-text="formData.updateMode === 'append'
                ? 'Enter a new URL to add to this enrichment table'
                : 'Enter a URL to replace all existing URLs'"
            />

            <!-- From URL Option (only for new tables) -->
            <OFormInput
              v-if="!isUpdating && formData.source === 'url'"
              name="url"
              data-test="add-enrichment-table-url"
              label="CSV File URL"
              placeholder="https://example.com/data.csv"
              help-text="Must be a publicly accessible CSV file"
            />

            <pre
              v-if="compilationErr"
              class="tw:font-bold tw:text-sm tw:text-red-600 tw:whitespace-pre-wrap"
            >{{ compilationErr }}</pre>
          </div>
      </div>

      <!-- Footer -->
      <div
        class="card-container tw:flex tw:items-center tw:justify-end tw:-mx-2.5 tw:px-3 tw:py-2.5 tw:shrink-0 tw:gap-2 tw:border-t tw:border-border-default"
      >
        <OButton
          data-test="add-enrichment-table-cancel-btn"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="$emit('cancel:hideform')"
        >
          {{ t('function.cancel') }}
        </OButton>
        <OButton
          data-test="add-enrichment-table-save-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
        >
          {{ t('function.save') }}
        </OButton>
      </div>
    </OForm>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import jsTransformService from "../../services/jstransform";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import segment from "../../services/segment_analytics";
import { useReo } from "@/services/reodotdev_analytics";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormFile from "@/lib/forms/File/OFormFile.vue";
import OFormOptionGroup from "@/lib/forms/OptionGroup/OFormOptionGroup.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import {
  makeAddEnrichmentTableSchema,
  type AddEnrichmentTableForm,
} from "./AddEnrichmentTable.schema";

export const defaultValue: any = () => {
  return {
    name: "",
    source: "file", // "file" or "url"
    file: "",
    url: "",
    append: false,
    updateMode: "reload", // "reload", "append", or "replace"
  };
};

export default defineComponent({
  name: "AddEnrichmentTable",
  components: { OSeparator, OButton, OForm, OFormInput, OFormFile, OFormOptionGroup, OFormSwitch,
    OIcon, AppPageHeader,
},
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdating: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:list", "cancel:hideform"],
  setup(props, { emit }) {
    const store: any = useStore();
    const disableColor: any = ref(props.isUpdating ? "grey-5" : "");
    const indexOptions = ref([]);
    const { t } = useI18n();
    const editorRef: any = ref(null);
    let editorobj: any = null;
    const isFetchingStreams = ref(false);
    const { track } = useReo();

    let compilationErr = ref("");

    // Zod schema (factory keeps the conditional file/url rules i18n-/prop-aware).
    // `isUpdating` is a prop, read lazily inside superRefine. Named after the
    // form per the playbook house style.
    const addEnrichmentTableSchema = makeAddEnrichmentTableSchema(
      () => props.isUpdating,
    );

    // Existing URL jobs are display-only (read straight from modelValue) — NOT a
    // form field, so they live in their own ref rather than the form.
    const mv: any = props.modelValue ?? {};
    const urlJobs = ref<any[]>(mv.urlJobs ?? []);
    const isUrlBased =
      props.isUpdating && Array.isArray(mv.urlJobs) && mv.urlJobs.length > 0;
    const initialSource: "file" | "url" = isUrlBased
      ? "url"
      : props.isUpdating
        ? "file"
        : ((mv.source as "file" | "url") ?? "file");

    // OWNER pattern (Rule ③): AddEnrichmentTable OWNS the <OForm> AND renders the
    // v-if conditionals (file vs url, update-mode, existing-URLs) that depend on
    // form values. The owner cannot inject the form it renders, so it CREATES the
    // form here with useOForm and reads it reactively with form.useStore (the ONE
    // source of truth — NO mirror, NO copy), then hands it to
    // <OForm :form="addEnrichmentTableForm">. Defaults replicate the old created()
    // prefill (a URL-based table is detected from existing urlJobs).
    const addEnrichmentTableForm = useOForm<AddEnrichmentTableForm>({
      defaultValues: {
        name: mv.name ?? "",
        source: initialSource,
        file: mv.file ?? "",
        append: mv.append ?? false,
        updateMode: mv.updateMode ?? "reload",
        url: isUrlBased ? "" : (mv.url ?? ""),
      },
      schema: addEnrichmentTableSchema,
      onSubmit: (value) => onSubmit(value),
    });

    // Reactive, read-only view of the form values + the display-only urlJobs.
    // The template's source/updateMode conditionals read THIS (the SAME form —
    // no synced copy), so toggling source/updateMode reveals the right fields.
    const formValues = addEnrichmentTableForm.useStore((s: any) => s.values);
    const formData = computed<any>(() => ({
      ...formValues.value,
      urlJobs: urlJobs.value,
    }));

    const sourceOptions = [
      { label: t('function.uploadFile'), value: 'file' },
      { label: t('function.fromUrl'), value: 'url' }
    ];

    // Computed: Dynamically change options based on failed job status
    const hasFailedJob = computed(() => {
      return formData.value.urlJobs?.some((job: any) => job.status === 'failed') || false;
    });

    const updateModeOptions = computed(() => {
      if (hasFailedJob.value) {
        // When there's a failed job, only allow: reload, replace failed, or replace all
        return [
          { label: 'Reload existing URLs', value: 'reload' },
          { label: 'Replace failed URL only', value: 'replace_failed' },
          { label: 'Replace all URLs', value: 'replace' }
        ];
      } else {
        // Normal mode: reload, append, or replace
        return [
          { label: 'Reload existing URLs', value: 'reload' },
          { label: 'Add new URL', value: 'append' },
          { label: 'Replace all URLs', value: 'replace' }
        ];
      }
    });

    // @submit handler — OForm only calls it once the whole schema passes
    // (including the conditional file/url superRefine), so the schema, not a
    // manual guard, gates the save. `value` is the validated, form-owned source
    // of truth. Awaited so OForm's isSubmitting drives the Save spinner.
    const onSubmit = async (value: AddEnrichmentTableForm) => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
      });

      // Handle URL-based enrichment table creation
      if (value.source === 'url') {
        // Determine the flags based on update mode
        let appendFlag = false;
        let retryFlag = false;
        let replaceFailedFlag = false;
        let urlToSend = value.url ?? "";

        if (props.isUpdating) {
          if (value.updateMode === 'reload') {
            // Reload: Trigger retry of all existing jobs (no new URL)
            urlToSend = '';
            retryFlag = true;
          } else if (value.updateMode === 'append') {
            // Append: Add new URL to existing ones
            appendFlag = true;
          } else if (value.updateMode === 'replace_failed') {
            // Replace failed URL only
            replaceFailedFlag = true;
          } else if (value.updateMode === 'replace') {
            // Replace: Delete all and use new URL (all flags false)
          }
        }

        try {
          await jsTransformService.create_enrichment_table_from_url(
            store.state.selectedOrganization.identifier,
            value.name,
            urlToSend,
            appendFlag,
            false, // resume
            retryFlag,
            replaceFailedFlag,
          );
          addEnrichmentTableForm.reset();
          emit("update:list");
          dismiss();
          toast({
            variant: "success",
            message: value.updateMode === 'reload'
              ? "Enrichment table reload started. Processing in background..."
              : "Enrichment table job started. Processing in background...",
          });
        } catch (err: any) {
          compilationErr.value = err.response?.data?.["message"] || err.message || "Unknown error";
          if (err.response?.status != 403) {
            toast({
              variant: "error",
              message:
                err.response?.data?.["message"] ||
                "Enrichment Table creation failed",
            });
          }
          dismiss();
        }

        segment.track("Button Click", {
          button: props.isUpdating ? `Update Enrichment Table (${value.updateMode})` : "Save Enrichment Table from URL",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          function_name: value.name,
          page: "Add/Update Enrichment Table",
        });
        track("Button Click", {
          button: props.isUpdating ? `Update Enrichment Table (${value.updateMode})` : "Save Enrichment Table from URL",
          page: "Add/Update Enrichment Table"
        });
      }
      // Handle file upload enrichment table creation (existing logic)
      else {
        let reqformData = new FormData();
        reqformData.append("file", value.file);

        try {
          const res = await jsTransformService.create_enrichment_table(
            store.state.selectedOrganization.identifier,
            value.name,
            reqformData,
            value.append,
          );
          addEnrichmentTableForm.reset();
          emit("update:list");
          dismiss();
          toast({
            variant: "success",
            message: res.data.message,
          });
        } catch (err: any) {
          compilationErr.value = err.response?.data?.["message"] || err.message || "Unknown error";
          if (err.response?.status != 403) {
            toast({
              variant: "error",
              message:
                JSON.stringify(err.response?.data?.["error"]) ||
                "Enrichment Table creation failed",
            });
          }
          dismiss();
        }

        segment.track("Button Click", {
          button: "Save Enrichment Table",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          function_name: value.name,
          page: "Add/Update Enrichment Table",
        });
        track("Button Click", {
          button: "Save Enrichment Table",
          page: "Add Enrichment Table"
        });
      }
    };

    return {
      t,
      disableColor,
      formData,
      store,
      compilationErr,
      indexOptions,
      editorRef,
      editorobj,
      isFetchingStreams,
      onSubmit,
      sourceOptions,
      updateModeOptions,
      // Returned so the Options-API template can see it (a module-level import
      // is out of scope in setup()-driven templates).
      addEnrichmentTableForm,
    };
  },
});
</script>

<style>
@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
