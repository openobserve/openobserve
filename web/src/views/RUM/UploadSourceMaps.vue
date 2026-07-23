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
    class="bg-surface-base"
    title="Upload Source Maps"
    :back="{ label: 'Source Maps', onClick: navigateBack, dataTest: 'add-alert-back-btn' }"
    bleed
  >
    <OForm
      id="upload-source-maps-form"
      class="contents"
      :schema="uploadSourceMapsSchema"
      :default-values="uploadSourceMapsDefaults"
      @submit="uploadSourceMaps"
      v-slot="{ isSubmitting }"
    >
      <!-- Form Content Area -->
      <div
        class="bg-card-glass-bg mb-[0.675rem] flex-1 overflow-auto overflow-y-auto p-6"
        style="height: calc(100vh - 172px)"
      >
        <div class="mx-auto max-w-300">
          <!-- Input Fields -->
          <div class="mb-6 grid grid-cols-1 gap-4">
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
            <div class="mb-2 text-sm font-medium">Source Map ZIP File *</div>
            <SourceMapDropzone name="file" />
          </div>
        </div>
      </div>

      <!-- Bottom Action Bar -->
      <div
        class="action-bar bg-card-glass-bg border-card-glass-border sticky flex shrink-0 items-center justify-end gap-3 border-t py-3 pr-3"
        style="z-index: 2"
      >
        <OButton
          data-test="rum-upload-source-maps-cancel-btn"
          variant="outline"
          size="sm-action"
          type="button"
          @click="navigateBack"
          :disabled="isSubmitting"
          >Cancel</OButton
        >
        <OButton
          data-test="rum-upload-source-maps-upload-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
          >Upload</OButton
        >
      </div>
    </OForm>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import sourcemapsService from "@/services/sourcemaps";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import SourceMapDropzone from "./SourceMapDropzone.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeUploadSourceMapsSchema, type UploadSourceMapsForm } from "./UploadSourceMaps.schema";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const route = useRoute();

const uploadSourceMapsSchema = makeUploadSourceMapsSchema(t);

// Dynamic (query-param prefill) defaults → a typed component computed. The
// service/version/environment are seeded from the route query; `file` always
// starts empty.
const uploadSourceMapsDefaults = computed(
  (): UploadSourceMapsForm => ({
    service: (route.query.service as string) || "",
    version: (route.query.version as string) || "",
    environment: (route.query.environment as string) || "",
    // Empty file slot at init; schema is `.nullable()` so null is valid at runtime.
    file: null as unknown as File,
  }),
);

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
      uploadData,
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
