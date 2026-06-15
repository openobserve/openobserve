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

    <!-- Form content -->
    <div class="card-container tw:flex-1 tw:min-h-0 tw:mb-2 tw:flex tw:flex-col tw:overflow-y-auto tw:p-4">
      <div class="tw:flex tw:flex-col tw:gap-4 tw:max-w-[40rem]">
          <OInput
            v-model="formData.name"
            data-test="add-enrichment-table-name"
            :label="t('function.name')"
            :readonly="isUpdating"
            :disabled="isUpdating"
            :error="!!nameError"
            :error-message="nameError"
            @update:model-value="nameError = ''"
          />

          <!-- Data Source Selection (only for new tables) -->
          <div v-if="!isUpdating" class="tw:flex tw:flex-col tw:gap-2">
            <div class="tw:text-gray-500 tw:font-bold">{{ t('function.dataSource') }}</div>
            <OOptionGroup
              v-model="formData.source"
              data-test="add-enrichment-table-source"
              :options="sourceOptions"
              orientation="horizontal"
            />
          </div>

          <!-- Upload File Option -->
          <OFile
            v-if="!isUpdating && formData.source === 'file'"
            v-model="formData.file"
            data-test="add-enrichment-table-file"
            :label="t('function.uploadCSVFile')"
            accept=".csv"
            :error="!!fileError"
            :error-message="fileError"
            @update:model-value="fileError = ''"
          />

          <!-- File Upload for Update Mode (only for file-based tables) -->
          <OFile
            v-if="isUpdating && formData.source === 'file'"
            v-model="formData.file"
            data-test="add-enrichment-table-file"
            :label="t('function.uploadCSVFile')"
            accept=".csv"
            :error="!!fileError"
            :error-message="fileError"
            @update:model-value="fileError = ''"
          />

          <!-- Append Toggle for File Upload (only when updating file-based tables) -->
          <OSwitch
            v-if="isUpdating && formData.source === 'file'"
            v-model="formData.append"
            data-test="add-enrichment-table-append-switch"
            :label="t('function.appendData')"
          />

          <!-- Append/Replace Mode Toggle (only when updating URL-based tables) -->
          <div v-if="isUpdating && formData.source === 'url'" class="tw:flex tw:flex-col tw:gap-2">
            <div class="tw:text-gray-500 tw:font-bold">Update Mode</div>
            <OOptionGroup
              v-model="formData.updateMode"
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
                      { 'rotate-animation': job.status === 'processing' },
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
          <OInput
            v-if="isUpdating && formData.source === 'url' && (formData.updateMode === 'append' || formData.updateMode === 'replace_failed' || formData.updateMode === 'replace')"
            v-model="formData.url"
            data-test="add-enrichment-table-new-url"
            :label="formData.updateMode === 'append' ? 'New CSV File URL' : 'Replacement CSV File URL'"
            placeholder="https://example.com/data.csv"
            :error="!!urlError"
            :error-message="urlError"
            @update:model-value="urlError = ''"
          >
            <template v-slot:hint>
              <div class="tw:text-xs">
                <template v-if="formData.updateMode === 'append'">
                  Enter a new URL to add to this enrichment table
                </template>
                <template v-else>
                  Enter a URL to replace all existing URLs
                </template>
              </div>
            </template>
          </OInput>

          <!-- From URL Option (only for new tables) -->
          <OInput
            v-if="!isUpdating && formData.source === 'url'"
            v-model="formData.url"
            data-test="add-enrichment-table-url"
            label="CSV File URL"
            placeholder="https://example.com/data.csv"
            :error="!!urlError"
            :error-message="urlError"
            @update:model-value="urlError = ''"
          >
            <template v-slot:hint>
              <div class="tw:text-xs">
                Must be a publicly accessible CSV file
              </div>
            </template>
          </OInput>

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
        @click="$emit('cancel:hideform')"
      >
        {{ t('function.cancel') }}
      </OButton>
      <OButton
        data-test="add-enrichment-table-save-btn"
        variant="primary"
        size="sm-action"
        @click="onSubmit"
      >
        {{ t('function.save') }}
      </OButton>
    </div>
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
import OInput from "@/lib/forms/Input/OInput.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import OOptionGroup from "@/lib/forms/OptionGroup/OOptionGroup.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OCard from "@/lib/core/Card/OCard.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
const defaultValue: any = () => {
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
  components: { OSeparator, OButton, OInput, OFile, OOptionGroup, OSwitch,
    OIcon, OCard, AppPageHeader,
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
    const addJSTransformForm: any = ref(null);
    const disableColor: any = ref("");
    const nameError = ref("");
    const fileError = ref("");
    const urlError = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const { t } = useI18n();
    const editorRef: any = ref(null);
    let editorobj: any = null;
    const isFetchingStreams = ref(false);
    const { track } = useReo();

    let compilationErr = ref("");

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

    const editorUpdate = (e: any) => {
      formData.value.function = e.target.value;
    };

    const onSubmit = () => {
      // Validate required fields
      nameError.value = "";
      fileError.value = "";
      urlError.value = "";
      if (!formData.value.name?.toString().trim()) {
        nameError.value = "Field is required!";
        return;
      }
      if (formData.value.source === 'file' && !formData.value.file) {
        fileError.value = "CSV File is required!";
        return;
      }
      if (
        formData.value.source === 'url' &&
        (!props.isUpdating || formData.value.updateMode !== 'reload')
      ) {
        // New tables always require a URL. In update mode the URL field is
        // only shown for non-reload modes (append / replace_failed / replace),
        // so validation is skipped for reload-only updates.
        const url = formData.value.url;
        if (!url) {
          urlError.value = "URL is required!";
          return;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          urlError.value = "URL must start with http:// or https://";
          return;
        }
      }

      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
              timeout: 0,
});

      // Handle URL-based enrichment table creation
      if (formData.value.source === 'url') {
        // Determine the flags based on update mode
        let appendFlag = false;
        let retryFlag = false;
        let replaceFailedFlag = false;
        let urlToSend = formData.value.url;

        if (props.isUpdating) {
          // Update mode logic
          if (formData.value.updateMode === 'reload') {
            // Reload: Trigger retry of all existing jobs (no new URL)
            urlToSend = '';
            appendFlag = false;
            retryFlag = true;
            replaceFailedFlag = false;
          } else if (formData.value.updateMode === 'append') {
            // Append: Add new URL to existing ones
            appendFlag = true;
            retryFlag = false;
            replaceFailedFlag = false;
          } else if (formData.value.updateMode === 'replace_failed') {
            // Replace failed URL only
            appendFlag = false;
            retryFlag = false;
            replaceFailedFlag = true;
          } else if (formData.value.updateMode === 'replace') {
            // Replace: Delete all and use new URL
            appendFlag = false;
            retryFlag = false;
            replaceFailedFlag = false;
          }
        } else {
          // Create mode: just use the URL as-is
          appendFlag = false;
          retryFlag = false;
          replaceFailedFlag = false;
        }

        jsTransformService
          .create_enrichment_table_from_url(
            store.state.selectedOrganization.identifier,
            formData.value.name,
            urlToSend,
            appendFlag,
            false, // resume
            retryFlag,
            replaceFailedFlag
          )
          .then(() => {
            formData.value = { ...defaultValue() };
            emit("update:list");

            dismiss();
            toast({
              variant: "success",
              message: formData.value.updateMode === 'reload'
                ? "Enrichment table reload started. Processing in background..."
                : "Enrichment table job started. Processing in background...",
            });
          })
          .catch((err) => {
            compilationErr.value = err.response?.data?.["message"] || err.message || "Unknown error";
            if(err.response?.status != 403){
              toast({
                variant: "error",
                message:
                  err.response?.data?.["message"] ||
                  "Enrichment Table creation failed",
              });
            }
            dismiss();
          });

        segment.track("Button Click", {
          button: props.isUpdating ? `Update Enrichment Table (${formData.value.updateMode})` : "Save Enrichment Table from URL",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          function_name: formData.value.name,
          page: "Add/Update Enrichment Table",
        });
        track("Button Click", {
          button: props.isUpdating ? `Update Enrichment Table (${formData.value.updateMode})` : "Save Enrichment Table from URL",
          page: "Add/Update Enrichment Table"
        });
      }
      // Handle file upload enrichment table creation (existing logic)
      else {
        let reqformData = new FormData();
        reqformData.append("file", formData.value.file);

        jsTransformService
          .create_enrichment_table(
            store.state.selectedOrganization.identifier,
            formData.value.name,
            reqformData,
            formData.value.append
          )
          .then((res) => {
            formData.value = { ...defaultValue() };
            emit("update:list");

            dismiss();
            toast({
              variant: "success",
              message: res.data.message,
            });
          })
          .catch((err) => {
            compilationErr.value = err.response?.data?.["message"] || err.message || "Unknown error";
            if(err.response?.status != 403){
              toast({
              variant: "error",
              message:
                JSON.stringify(err.response?.data?.["error"]) ||
                "Enrichment Table creation failed",
            });
            }
            dismiss();
          });

        segment.track("Button Click", {
          button: "Save Enrichment Table",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          function_name: formData.value.name,
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
      addJSTransformForm,
      store,
      compilationErr,
      indexOptions,
      editorRef,
      editorobj,
      editorUpdate,
      isFetchingStreams,
      onSubmit,
      sourceOptions,
      updateModeOptions,
      nameError,
      fileError,
      urlError,
    };
  },
  created() {
    this.formData = { ...defaultValue(), ...this.modelValue };

    if (this.isUpdating) {
      this.disableColor = "grey-5";
      this.formData = this.modelValue;
      if (this.formData.append == undefined) this.formData.append = false;

      // Detect if this is a URL-based enrichment table
      if (this.formData.urlJobs && this.formData.urlJobs.length > 0) {
        this.formData.source = 'url';
        // Leave URL field empty so user can enter a new URL
        this.formData.url = '';
        // Default to reload mode (safest - just reprocesses existing URLs)
        if (this.formData.updateMode === undefined) {
          this.formData.updateMode = 'reload';
        }
      } else {
        this.formData.source = 'file';
      }
    }
  },
});
</script>

<style scoped>
#editor {
  width: 100%;
  min-height: 15rem;
  padding-bottom: 14px;
  resize: both;
}

.rotate-animation {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
<style lang="scss">
.no-case .q-field__native span {
  text-transform: none !important;
}

.lookup-table-file-uploader {
  .q-field__label {
    left: -30px;
  }
}

.lookup-table-append-toggle {
  .q-toggle__inner {
    padding: 0.325em !important;
    font-size: 40px !important;
  }

  .q-toggle__thumb:before {
    background: transparent !important;
  }
}
</style>
