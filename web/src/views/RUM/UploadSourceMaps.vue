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
  <div class="w-full h-full flex flex-col min-h-0 px-2.5 bg-(--q-background)">
    <!-- Top Header Bar -->
    <AppPageHeader
      title="Upload Source Maps"
      :back="{ onClick: navigateBack, dataTest: 'add-alert-back-btn' }"
      class="px-4 border-b border-border-default"
    />

    <OForm
      id="upload-source-maps-form"
      class="contents"
      :schema="uploadSourceMapsSchema"
      :default-values="uploadSourceMapsDefaults"
      @submit="uploadSourceMaps"
      v-slot="{ isSubmitting }"
    >
      <!-- Form Content Area -->
      <div class="flex-1 overflow-y-auto card-container mb-[0.675rem] p-6" style="height: calc(100vh - 172px); overflow: auto">
        <div class="max-w-300 mx-auto">
          <!-- Input Fields -->
          <div class="grid grid-cols-1 gap-4 mb-6">
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
          <div class="mb-6">
            <div class="text-sm font-medium text-weight-medium mb-2">Source Map ZIP File *</div>
            <SourceMapDropzone name="file" />
          </div>
        </div>
      </div>

      <!-- Bottom Action Bar -->
      <div class="action-bar shrink-0 card-container flex items-center justify-end gap-3 py-3 pr-3 border-t border-[var(--o2-border-color)]"
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
import AppPageHeader from "@/components/common/AppPageHeader.vue";
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
