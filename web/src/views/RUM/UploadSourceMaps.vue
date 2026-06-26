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
  <div class="upload-source-maps-page tw:w-full tw:h-full tw:px-[0.625rem]">
    <!-- Top Header Bar -->
    <div class="header-bar card-container tw:flex tw:items-center tw:justify-between tw:py-[0.675rem] tw:h-[64px] tw:px-[0.675rem] tw:mb-[0.675rem]">
      <div class="tw:flex tw:items-center tw:gap-3">
        <div
          data-test="add-alert-back-btn"
          class="tw:flex tw:justify-center tw:items-center tw:mr-3 tw:cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px; 
          "
          title="Go Back"
          @click="navigateBack()"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <div>
          <div class="tw:text-xl tw:font-semibold text-weight-medium">Upload Source Maps</div>
        </div>
      </div>
    </div>

    <OForm
      id="upload-source-maps-form"
      :schema="uploadSourceMapsSchema"
      :default-values="uploadSourceMapsDefaults"
      @submit="uploadSourceMaps"
      v-slot="{ isSubmitting }"
    >
      <!-- Form Content Area -->
      <div class="form-content-area card-container tw:mb-[0.675rem] tw:p-6" style="height: calc(100vh - 172px); overflow: auto">
        <div class="upload-form">
          <!-- Input Fields -->
          <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-3 tw:gap-4 tw:mb-6">
            <!-- Service Input -->
            <OFormInput
              name="service"
              data-test="rum-upload-source-maps-service-input"
              label="Service"
              required
              placeholder="Enter service name"
            />

            <!-- Version Input -->
            <OFormInput
              name="version"
              data-test="rum-upload-source-maps-version-input"
              label="Version"
              required
              placeholder="Enter version (e.g., 1.0.0)"
            />

            <!-- Environment Input -->
            <OFormInput
              name="environment"
              data-test="rum-upload-source-maps-environment-input"
              label="Environment"
              placeholder="Enter environment (optional)"
            />
          </div>

          <!-- File Upload Area (form-owned `file` field, schema-validated) -->
          <div class="tw:mb-6">
            <div class="tw:text-sm tw:font-medium text-weight-medium tw:mb-2">Source Map ZIP File *</div>
            <SourceMapDropzone name="file" />
          </div>
        </div>
      </div>

      <!-- Bottom Action Bar -->
      <div class="action-bar card-container tw:flex tw:items-center tw:justify-end tw:gap-3 tw:py-3 tw:pr-3"
        style="position: sticky; z-index: 2">
        <OButton
          data-test="rum-upload-source-maps-cancel-btn"
          variant="outline"
          size="sm-action"
          type="button"
          @click="navigateBack"
          :disabled="isSubmitting"
        >Cancel</OButton>
        <OButton
          data-test="rum-upload-source-maps-upload-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
        >Upload</OButton>
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import sourcemapsService from "@/services/sourcemaps";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import SourceMapDropzone from "./SourceMapDropzone.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeUploadSourceMapsSchema,
  type UploadSourceMapsForm,
} from "./UploadSourceMaps.schema";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const route = useRoute();

const uploadSourceMapsSchema = makeUploadSourceMapsSchema(t);

// Dynamic (query-param prefill) defaults → a typed component computed. The
// service/version/environment are seeded from the route query; `file` always
// starts empty.
const uploadSourceMapsDefaults = computed((): UploadSourceMapsForm => ({
  service: (route.query.service as string) || "",
  version: (route.query.version as string) || "",
  environment: (route.query.environment as string) || "",
  file: null,
}));

// Navigate back to source maps list
const navigateBack = () => {
  router.push({
    name: "SourceMaps",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

// Upload source maps. @submit fires only once the schema passes, so service /
// version are non-empty and `file` is a `.zip` File — no imperative guards.
// Loading is form-driven (OForm awaits this handler → the Upload button spins).
const uploadSourceMaps = async (value: UploadSourceMapsForm) => {
  try {
    const uploadData = new FormData();
    uploadData.append("service", value.service);
    uploadData.append("version", value.version);
    uploadData.append("env", value.environment ?? "");
    uploadData.append("file", value.file as File);

    await sourcemapsService.uploadSourceMaps(
      store.state.selectedOrganization.identifier,
      uploadData
    );

    toast({
      variant: "success",
      message: "Source maps uploaded successfully",
    });

    // Navigate back to source maps list
    navigateBack();
  } catch (error: any) {
    console.error("Error uploading source maps:", error);
    toast({
      variant: "error",
      message: error?.response?.data?.message || error?.message || "Failed to upload source maps",
    });
  }
};
</script>

<style lang="scss" scoped>
.upload-source-maps-page {
  display: flex;
  flex-direction: column;
  background-color: var(--q-background);
}

.header-bar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--q-border-color, #e0e0e0);
}

.form-content-area {
  flex: 1;
  overflow-y: auto;
}

.upload-form {
  max-width: 1200px;
  margin: 0 auto;
}

.action-bar {
  flex-shrink: 0;
  border-top: 1px solid var(--q-border-color, #e0e0e0);
}

/* The dropzone styles (.upload-area / .upload-content / dark-mode) moved to
   SourceMapDropzone.vue along with the dropzone markup. */
</style>
