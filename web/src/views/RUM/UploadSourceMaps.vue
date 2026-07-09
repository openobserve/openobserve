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

    <!-- Form Content Area -->
    <div class="flex-1 overflow-y-auto card-container mb-[0.675rem] p-6" style="height: calc(100vh - 172px); overflow: auto">
      <div class="max-w-300 mx-auto">
        <!-- Input Fields -->
        <div class="grid grid-cols-1 gap-4 mb-6">
          <!-- Service Input -->
          <div>
            <div class="text-sm font-medium text-weight-medium mb-2">Service *</div>
            <OInput
              data-test="rum-upload-source-maps-service-input"
              v-model="formData.service"
              placeholder="Enter service name"
              :error="!!serviceError"
              :error-message="serviceError"
              @update:model-value="serviceError = ''"
            />
          </div>

          <!-- Version Input -->
          <div>
            <div class="text-sm font-medium text-weight-medium mb-2">Version *</div>
            <OInput
              data-test="rum-upload-source-maps-version-input"
              v-model="formData.version"
              placeholder="Enter version (e.g., 1.0.0)"
              :error="!!versionError"
              :error-message="versionError"
              @update:model-value="versionError = ''"
            />
          </div>

          <!-- Environment Input -->
          <div>
            <div class="text-sm font-medium text-weight-medium mb-2">Environment</div>
            <OInput
              data-test="rum-upload-source-maps-environment-input"
              v-model="formData.environment"
              placeholder="Enter environment (optional)"
            />
          </div>
        </div>

        <!-- File Upload Area -->
        <div class="mb-6">
          <div class="text-sm font-medium text-weight-medium mb-2">Source Map ZIP File *</div>
          <div
            data-test="rum-upload-source-maps-file-dropzone"
            class="border-2 border-dashed border-[var(--o2-border-color)] rounded-lg p-8 text-center cursor-pointer transition-all duration-300 bg-(--q-background) hover:border-(--q-primary) dark:border-[rgba(255,255,255,0.1)] dark:hover:bg-[rgba(var(--q-primary-rgb),0.05)]"
            :class="[
              isDragging ? 'border-[var(--q-primary)]! bg-[rgba(var(--q-primary-rgb),0.05)]! border-solid! dark:bg-[rgba(var(--q-primary-rgb),0.1)]!' : '',
              formData.file ? 'p-6! text-left! border-solid! border-[var(--q-positive)]! bg-[rgba(var(--q-positive-rgb),0.02)]! dark:bg-[rgba(var(--q-positive-rgb),0.05)]!' : ''
            ]"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            @click="triggerFileInput"
          >
            <input
              ref="fileInputRef"
              data-test="rum-upload-source-maps-file-input"
              type="file"
              accept=".zip"
              style="display: none"
              @change="handleFileInput"
            />

            <div v-if="!formData.file" class="flex flex-col items-center justify-center">
              <OIcon name="backup" size="xl" class="mb-3" />
              <div class="text-xl font-semibold text-gray-500 mb-2">Drop your file here</div>
              <div class="text-sm text-gray-400 mb-3">or click to browse</div>
              <div class="text-xs text-gray-400">.zip files only</div>
            </div>

            <div v-else class="file-info">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <OIcon name="draft" size="lg" />
                  <div>
                    <div class="text-sm font-medium text-weight-medium">{{ formData.file.name }}</div>
                    <div class="text-xs text-gray-400">{{ formatFileSize(formData.file.size) }}</div>
                  </div>
                </div>
                <OButton
                  variant="ghost"
                  size="icon"
                  icon-left="close"
                  @click.stop="removeFile"
                />
              </div>
            </div>
          </div>
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
        @click="navigateBack"
        :disabled="isUploading"
      >Cancel</OButton>
      <OButton
        data-test="rum-upload-source-maps-upload-btn"
        variant="primary"
        size="sm-action"
        :loading="isUploading"
        :disabled="isUploading"
        @click="uploadSourceMaps"
      >Upload</OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import sourcemapsService from "@/services/sourcemaps";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const store = useStore();
const router = useRouter();
const route = useRoute();

// Form data
const formData = ref({
  service: "",
  version: "",
  environment: "",
  file: null as File | null,
});

const isUploading = ref(false);
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const serviceError = ref("");
const versionError = ref("");

// Pre-fill form data from query parameters on mount
onMounted(() => {
  if (route.query.service) {
    formData.value.service = route.query.service as string;
  }
  if (route.query.version) {
    formData.value.version = route.query.version as string;
  }
  if (route.query.environment) {
    formData.value.environment = route.query.environment as string;
  }
});

// Navigate back to source maps list
const navigateBack = () => {
  router.push({
    name: "SourceMaps",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

// Trigger file input click
const triggerFileInput = () => {
  fileInputRef.value?.click();
};

// Handle file input change
const handleFileInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    validateAndSetFile(file);
  }
};

// Handle drag and drop
const handleDrop = (event: DragEvent) => {
  isDragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) {
    validateAndSetFile(file);
  }
};

// Validate and set file
const validateAndSetFile = (file: File) => {
  if (!file.name.endsWith('.zip')) {
    toast({
      variant: "error",
      message: "Only ZIP files are allowed",
    });
    return;
  }
  formData.value.file = file;
};

// Remove file
const removeFile = () => {
  formData.value.file = null;
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
};

// Upload source maps
const uploadSourceMaps = async () => {
  // Validate every required field top-to-bottom and surface all errors at once:
  // Service / Version as inline field errors, the ZIP file as a toast.
  serviceError.value = formData.value.service ? "" : "Service is required";
  versionError.value = formData.value.version ? "" : "Version is required";

  let hasError = !formData.value.service || !formData.value.version;

  if (!formData.value.file) {
    toast({
      variant: "error",
      message: "Please select a ZIP file to upload",
    });
    hasError = true;
  }

  if (hasError) return;

  isUploading.value = true;

  try {
    const uploadData = new FormData();
    uploadData.append("service", formData.value.service);
    uploadData.append("version", formData.value.version);
    uploadData.append("env", formData.value.environment);
    uploadData.append("file", formData.value.file);

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
  } finally {
    isUploading.value = false;
  }
};
</script>

