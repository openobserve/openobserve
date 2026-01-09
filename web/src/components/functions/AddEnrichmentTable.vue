<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
    <div class="q-px-md q-py-md card-container tw:h-[calc(100vh-50px)]">
      <div class="row items-center no-wrap">
        <div class="col">
          <div v-if="isUpdating" class="text-h6">
            {{ t("function.updateEnrichmentTable") }}
          </div>
          <div v-else class="text-h6">{{ t("function.addEnrichmentTable") }}</div>
        </div>
      </div>

      <q-separator />
      <div>
        <q-form ref="addJSTransformForm" @submit="onSubmit">
          <div class="row">
            <q-input
              v-model="formData.name"
              :label="t('function.name')"
              color="input-border"
              bg-color="input-bg"
              class="col-12 q-py-md showLabelOnTop text-grey-8 text-bold"
              stack-label
              outlined
              filled
              dense
              v-bind:readonly="isUpdating"
              v-bind:disable="isUpdating"
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
            />

            <!-- Data Source Selection (only for new tables) -->
            <div v-if="!isUpdating" class="col-12 q-py-md">
              <div class="text-grey-8 text-bold tw:mb-2">{{ t('function.dataSource') }}</div>
              <q-option-group
                v-model="formData.source"
                :options="sourceOptions"
                color="primary"
                inline
              />
            </div>

            <!-- Upload File Option -->
            <q-file
              v-if="!isUpdating && formData.source === 'file'"
              filled
              v-model="formData.file"
              :label="t('function.uploadCSVFile')"
              class="col-12 q-py-md showLabelOnTop lookup-table-file-uploader"
              stack-label
              outlined
              accept=".csv"
              dense
              :rules="[(val: any) => !!val || 'CSV File is required!']"
              hide-bottom-space
            >
              <template v-slot:prepend>
                <q-icon name="attachment" />
              </template>
            </q-file>

            <!-- File Upload for Update Mode (only for file-based tables) -->
            <q-file
              v-if="isUpdating && formData.source === 'file'"
              filled
              v-model="formData.file"
              :label="t('function.uploadCSVFile')"
              class="col-12 q-py-md showLabelOnTop lookup-table-file-uploader"
              stack-label
              outlined
              accept=".csv"
              dense
              :rules="[(val: any) => !!val || 'CSV File is required!']"
              hide-bottom-space
            >
              <template v-slot:prepend>
                <q-icon name="attachment" />
              </template>
            </q-file>

            <!-- Append Toggle for File Upload (only when updating file-based tables) -->
            <div v-if="isUpdating && formData.source === 'file'" class="col-12">
              <q-toggle
                class="q-py-md text-grey-8 text-bold lookup-table-append-toggle"
                v-model="formData.append"
                :label="t('function.appendData')"
              />
            </div>

            <!-- Append/Replace Mode Toggle (only when updating URL-based tables) -->
            <div v-if="isUpdating && formData.source === 'url'" class="col-12 q-py-md">
              <div class="text-grey-8 text-bold tw:mb-2">Update Mode</div>
              <q-option-group
                v-model="formData.updateMode"
                :options="updateModeOptions"
                color="primary"
                inline
              />
            </div>

            <!-- Show existing URLs (only when updating URL-based tables) -->
            <div v-if="isUpdating && formData.source === 'url' && formData.urlJobs && formData.urlJobs.length > 0" class="col-12 q-py-md">
              <div class="text-grey-8 text-bold q-mb-sm" style="font-size: 13px;">Existing URLs ({{ formData.urlJobs.length }})</div>
              <q-card flat bordered class="q-pa-sm" style="background-color: #fafafa;">
                <div v-for="(job, index) in formData.urlJobs" :key="job.id" class="q-mb-xs">
                  <div class="row items-center q-gutter-x-xs">
                    <div class="col-auto">
                      <span class="text-weight-medium text-grey-7" style="font-size: 12px;">{{ Number(index) + 1 }}.</span>
                    </div>
                    <div class="col-auto">
                      <q-icon
                        :name="job.status === 'completed' ? 'check_circle' : job.status === 'failed' ? 'warning' : job.status === 'processing' ? 'sync' : 'schedule'"
                        :color="job.status === 'completed' ? 'positive' : job.status === 'failed' ? 'negative' : job.status === 'processing' ? 'primary' : 'grey'"
                        size="16px"
                        :class="{'rotate-animation': job.status === 'processing'}"
                      />
                    </div>
                    <div class="col text-grey-8" style="font-size: 13px; word-break: break-all;">
                      {{ job.url }}
                    </div>
                  </div>
                  <q-separator v-if="Number(index) < formData.urlJobs.length - 1" class="q-my-xs" />
                </div>
              </q-card>
            </div>

            <!-- Mode explanation (always show for URL-based tables in edit mode) -->
            <div v-if="isUpdating && formData.source === 'url'" class="col-12">
              <div class="tw:text-sm tw:text-gray-600 tw:mb-4 tw:p-3 tw:rounded-lg" :class="{
                'tw:bg-blue-50': formData.updateMode === 'reload',
                'tw:bg-green-50': formData.updateMode === 'append',
                'tw:bg-yellow-50': formData.updateMode === 'replace_failed',
                'tw:bg-orange-50': formData.updateMode === 'replace'
              }">
                <template v-if="formData.updateMode === 'reload'">
                  <strong>🔄 Reload Mode:</strong> Re-process all existing URLs from scratch. Use this when the CSV file content at the URLs has been updated but the URLs themselves haven't changed.
                </template>
                <template v-else-if="formData.updateMode === 'append'">
                  <strong>➕ Append Mode:</strong> Add a new URL to existing ones. Data from all URLs will be combined.
                  <div class="tw:mt-2 tw:text-orange-700">
                    ⚠️ <strong>Important:</strong> The new CSV file must have the same columns as the existing data. The enrichment table schema cannot be changed.
                  </div>
                </template>
                <template v-else-if="formData.updateMode === 'replace_failed'">
                  <strong>🔧 Replace Failed URL:</strong> Replace only the failed URL with a new one. All successful URLs and their data will be kept. Use this to fix typos or broken URLs.
                </template>
                <template v-else-if="formData.updateMode === 'replace'">
                  <strong>⚠️ Replace Mode:</strong> Delete all existing URLs and data, then use only the new URL you provide below.
                </template>
              </div>
            </div>

            <!-- URL input field for append, replace_failed, or replace mode (only when updating URL-based tables) -->
            <div v-if="isUpdating && formData.source === 'url' && (formData.updateMode === 'append' || formData.updateMode === 'replace_failed' || formData.updateMode === 'replace')" class="col-12">
              <q-input
                v-model="formData.url"
                :label="formData.updateMode === 'append' ? 'New CSV File URL' : 'Replacement CSV File URL'"
                color="input-border"
                bg-color="input-bg"
                class="q-py-md showLabelOnTop text-grey-8 text-bold"
                stack-label
                outlined
                filled
                dense
                placeholder="https://example.com/data.csv"
                :rules="[
                  (val: any) => {
                    if (formData.updateMode === 'reload') return true;
                    return !!val || 'URL is required!';
                  },
                  (val: any) => {
                    if (formData.updateMode === 'reload' || !val) return true;
                    return (val.startsWith('http://') || val.startsWith('https://')) || 'URL must start with http:// or https://';
                  }
                ]"
                tabindex="0"
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
              </q-input>
            </div>

            <!-- From URL Option (only for new tables) -->
            <div v-if="!isUpdating && formData.source === 'url'" class="col-12">
              <q-input
                v-model="formData.url"
                :label="'CSV File URL'"
                color="input-border"
                bg-color="input-bg"
                class="q-py-md showLabelOnTop text-grey-8 text-bold"
                stack-label
                outlined
                filled
                dense
                placeholder="https://example.com/data.csv"
                :rules="[
                  (val: any) => !!val || 'URL is required!',
                  (val: any) => (val && (val.startsWith('http://') || val.startsWith('https://'))) || 'URL must start with http:// or https://'
                ]"
                tabindex="0"
              >
                <template v-slot:hint>
                  <div class="tw:text-xs">
                    Must be a publicly accessible CSV file
                  </div>
                </template>
              </q-input>
            </div>
          </div>

          <pre v-if="compilationErr" class="q-py-md showLabelOnTop text-bold text-h7">{{
            compilationErr
          }}</pre>

          <div class="flex justify-start q-mt-md">
            <q-btn
              v-close-popup
              class="q-mr-md o2-secondary-button tw:h-[36px]"
              :label="t('function.cancel')"
              no-caps
              flat
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              @click="$emit('cancel:hideform')"
            />
            <q-btn
              class="o2-primary-button no-border tw:h-[36px]"
              :label="t('function.save')"
              type="submit"
              no-caps
              flat
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            />
          </div>
        </q-form>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import jsTransformService from "../../services/jstransform";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import segment from "../../services/segment_analytics";
import { useReo } from "@/services/reodotdev_analytics";

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
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const { t } = useI18n();
    const q = useQuasar();
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
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
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
            q.notify({
              type: "positive",
              message: formData.value.updateMode === 'reload'
                ? "Enrichment table reload started. Processing in background..."
                : "Enrichment table job started. Processing in background...",
            });
          })
          .catch((err) => {
            compilationErr.value = err.response?.data?.["message"] || err.message || "Unknown error";
            if(err.response?.status != 403){
              q.notify({
                type: "negative",
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
            q.notify({
              type: "positive",
              message: res.data.message,
            });
          })
          .catch((err) => {
            compilationErr.value = err.response?.data?.["message"] || err.message || "Unknown error";
            if(err.response?.status != 403){
              q.notify({
              type: "negative",
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
      q,
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
