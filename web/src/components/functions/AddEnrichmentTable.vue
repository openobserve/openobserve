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
  <OPageLayout
    data-test="add-enrichment-table-page"
    class="h-[calc(100vh-var(--navbar-height)-0.875rem)]"
    :title="isUpdating ? t('function.updateEnrichmentTable') : t('function.addEnrichmentTable')"
    title-data-test="add-enrichment-table-title"
    :back="{
      label: t('function.enrichmentTables'),
      onClick: () => $emit('cancel:hideform'),
      dataTest: 'add-enrichment-table-back-btn',
    }"
  >

    <!-- Inline page form. Save lives in the footer INSIDE the <OForm>, so it is a
         native type="submit" (Enter submits) — no form-id needed. -->
    <OForm
      id="add-enrichment-table-form"
      :form="addEnrichmentTableForm"
      class="flex flex-col flex-1 min-h-0"
      v-slot="{ isSubmitting }"
    >
      <!-- Form content -->
      <div class="bg-card-glass-bg flex-1 min-h-0 mb-2 flex flex-col overflow-y-auto p-4">
        <div class="flex flex-col gap-4 max-w-[40rem]">
            <OFormInput
              name="name"
              data-test="add-enrichment-table-name"
              :label="t('function.name')"
              required
              :readonly="isUpdating"
              :disabled="isUpdating"
            />

            <!-- Data Source Selection (only for new tables) -->
            <div v-if="!isUpdating" class="flex flex-col gap-2">
              <div class="text-text-label font-bold">{{ t('function.dataSource') }}</div>
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
            <div v-if="isUpdating && formData.source === 'url'" class="flex flex-col gap-2">
              <div class="text-text-label font-bold">{{ t('function.updateModeLabel') }}</div>
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
              class="flex flex-col gap-2"
            >
              <div class="text-text-label font-bold text-compact">
                {{ t('function.existingUrlsCount', { count: formData.urlJobs.length }) }}
              </div>
              <div class="rounded-default border border-card-glass-border bg-surface-panel p-2 flex flex-col gap-1">
                <div v-for="(job, index) in formData.urlJobs" :key="job.id">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-text-secondary text-xs">{{ Number(index) + 1 }}.</span>
                    <OIcon
                      :name="job.status === 'completed' ? 'check-circle' : job.status === 'failed' ? 'warning' : job.status === 'processing' ? 'sync' : 'schedule'"
                      size="sm"
                      :class="[
                        job.status === 'processing' ? 'animate-[spin_2s_linear_infinite]' : '',
                        job.status === 'completed' ? 'text-status-positive' :
                        job.status === 'failed' ? 'text-status-negative' :
                        job.status === 'processing' ? 'text-accent' :
                        'text-icon-color'
                      ]"
                    />
                    <div class="text-text-secondary text-compact break-all">
                      {{ job.url }}
                    </div>
                  </div>
                  <OSeparator v-if="Number(index) < formData.urlJobs.length - 1" class="my-1" />
                </div>
              </div>
            </div>

            <!-- Mode explanation (always show for URL-based tables in edit mode) -->
            <div
              v-if="isUpdating && formData.source === 'url'"
              class="text-sm text-text-secondary p-3 rounded-default"
              :class="{
                'bg-status-info-bg': formData.updateMode === 'reload',
                'bg-status-success-bg': formData.updateMode === 'append',
                'bg-status-warning-bg': formData.updateMode === 'replace_failed',
                'bg-status-error-bg': formData.updateMode === 'replace'
              }"
            >
              <template v-if="formData.updateMode === 'reload'">
                <strong>{{ t('function.reloadModeLabel') }}</strong> {{ t('function.reloadModeDescription') }}
              </template>
              <template v-else-if="formData.updateMode === 'append'">
                <strong>{{ t('function.appendModeLabel') }}</strong> {{ t('function.appendModeDescription') }}
                <div class="mt-2 text-status-warning-text">
                  <strong>{{ t('function.importantLabel') }}</strong> {{ t('function.appendModeWarning') }}
                </div>
              </template>
              <template v-else-if="formData.updateMode === 'replace_failed'">
                <strong>{{ t('function.replaceFailedUrlLabel') }}</strong> {{ t('function.replaceFailedUrlDescription') }}
              </template>
              <template v-else-if="formData.updateMode === 'replace'">
                <strong>{{ t('function.replaceModeLabel') }}</strong> {{ t('function.replaceModeDescription') }}
              </template>
            </div>

            <!-- URL input field for append, replace_failed, or replace mode (only when updating URL-based tables) -->
            <OFormInput
              v-if="isUpdating && formData.source === 'url' && (formData.updateMode === 'append' || formData.updateMode === 'replace_failed' || formData.updateMode === 'replace')"
              name="url"
              data-test="add-enrichment-table-new-url"
              :label="formData.updateMode === 'append' ? 'New CSV File URL' : 'Replacement CSV File URL'"
              :placeholder="t('function.csvUrlPlaceholder')"
              :help-text="formData.updateMode === 'append'
                ? 'Enter a new URL to add to this enrichment table'
                : 'Enter a URL to replace all existing URLs'"
            />

            <!-- From URL Option (only for new tables) -->
            <OFormInput
              v-if="!isUpdating && formData.source === 'url'"
              name="url"
              data-test="add-enrichment-table-url"
              :label="t('function.csvFileUrlLabel')"
              :placeholder="t('function.csvUrlPlaceholder')"
              :help-text="t('function.csvUrlHelpText')"
            />

            <pre
              v-if="compilationErr"
              class="font-bold text-sm text-status-error-text whitespace-pre-wrap"
            >{{ compilationErr }}</pre>
          </div>
      </div>

      <!-- Footer -->
      <div
        class="bg-card-glass-bg flex items-center justify-end -mx-2.5 px-3 py-2.5 shrink-0 gap-2 border-t border-border-default"
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
  </OPageLayout>
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
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
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
    OIcon, OPageLayout,
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
      t,
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
      // Clear any stale error from a previous failed submit so a subsequent
      // successful (or retried) submit doesn't keep showing the old message.
      compilationErr.value = "";

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

