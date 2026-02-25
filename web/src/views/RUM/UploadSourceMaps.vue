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
  <div class="upload-source-maps-page tw:w-full tw:h-full tw:px-[0.625rem] q-mt-xs">
    <!-- Top Header Bar -->
    <div class="header-bar card-container tw:flex tw:items-center tw:justify-between tw:py-[0.675rem] tw:h-[64px] tw:px-[0.675rem] tw:mb-[0.675rem]">
      <div class="tw:flex tw:items-center tw:gap-3">
        <div
          data-test="add-alert-back-btn"
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px; 
          "
          title="Go Back"
          @click="navigateBack()"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div>
          <div class="text-h6 text-weight-medium">Upload Source Maps</div>
        </div>
      </div>
    </div>

    <!-- Form Content Area -->
    <div class="form-content-area card-container tw:mb-[0.675rem] tw:p-6" style="height: calc(100vh - 192px); overflow: auto">
      <q-form @submit="uploadSourceMaps" class="upload-form">
        <!-- Input Fields -->
        <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-3 tw:gap-4 tw:mb-6">
          <!-- Service Input -->
          <div>
            <div class="text-subtitle2 text-weight-medium tw:mb-2">Service *</div>
            <q-input
              v-model="formData.service"
              placeholder="Enter service name"
              borderless
              dense
              :rules="[val => !!val || 'Service is required']"
            />
          </div>

          <!-- Version Input -->
          <div>
            <div class="text-subtitle2 text-weight-medium tw:mb-2">Version *</div>
            <q-input
              v-model="formData.version"
              placeholder="Enter version (e.g., 1.0.0)"
              borderless
              dense
              :rules="[val => !!val || 'Version is required']"
            />
          </div>

          <!-- Environment Input -->
          <div>
            <div class="text-subtitle2 text-weight-medium tw:mb-2">Environment</div>
            <q-input
              v-model="formData.environment"
              placeholder="Enter environment (optional)"
              borderless
              dense
            />
          </div>
        </div>

        <!-- File Upload Area -->
        <div class="tw:mb-6">
          <div class="text-subtitle2 text-weight-medium tw:mb-2">Source Map ZIP File *</div>
          <div
            class="upload-area"
            :class="{ 'drag-over': isDragging, 'has-file': formData.file }"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            @click="triggerFileInput"
          >
            <input
              ref="fileInputRef"
              type="file"
              accept=".zip"
              style="display: none"
              @change="handleFileInput"
            />

            <div v-if="!formData.file" class="upload-content">
              <q-icon name="cloud_upload" size="3rem" color="grey-6" class="tw:mb-3" />
              <div class="text-h6 text-grey-8 tw:mb-2">Drop your file here</div>
              <div class="text-body2 text-grey-6 tw:mb-3">or click to browse</div>
              <div class="text-caption text-grey-5">.zip files only</div>
            </div>

            <div v-else class="file-info">
              <div class="tw:flex tw:items-center tw:justify-between">
                <div class="tw:flex tw:items-center tw:gap-3">
                  <q-icon name="insert_drive_file" size="2rem" color="primary" />
                  <div>
                    <div class="text-subtitle2 text-weight-medium">{{ formData.file.name }}</div>
                    <div class="text-caption text-grey-6">{{ formatFileSize(formData.file.size) }}</div>
                  </div>
                </div>
                <q-btn
                  flat
                  round
                  dense
                  icon="close"
                  color="grey-7"
                  @click.stop="removeFile"
                />
              </div>
            </div>
          </div>
        </div>
      </q-form>
    </div>

    <!-- Bottom Action Bar -->
    <div class="action-bar card-container tw:flex tw:items-center tw:justify-end tw:gap-3 tw:py-3 tw:pr-3"
      style="position: sticky; z-index: 2">
      <q-btn
        label="Cancel"
        unelevated
        no-caps
        class="o2-secondary-button"
        style="min-width: 100px"
        @click="navigateBack"
        :disable="isUploading"
      />
      <q-btn
        label="Upload"
        unelevated
        no-caps
        class="o2-primary-button"
        style="min-width: 100px"
        :loading="isUploading"
        :disable="isUploading"
        @click="uploadSourceMaps"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { useQuasar } from "quasar";
import sourcemapsService from "@/services/sourcemaps";

const store = useStore();
const router = useRouter();
const route = useRoute();
const $q = useQuasar();

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
    $q.notify({
      type: "negative",
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
  if (!formData.value.file) {
    $q.notify({
      type: "negative",
      message: "Please select a ZIP file to upload",
    });
    return;
  }

  if (!formData.value.service || !formData.value.version) {
    $q.notify({
      type: "negative",
      message: "Please fill in all required fields",
    });
    return;
  }

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

    $q.notify({
      type: "positive",
      message: "Source maps uploaded successfully",
    });

    // Navigate back to source maps list
    navigateBack();
  } catch (error: any) {
    console.error("Error uploading source maps:", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.message || error?.message || "Failed to upload source maps",
    });
  } finally {
    isUploading.value = false;
  }
};
</script>

<style lang="scss" scoped>
.upload-source-maps-page {
  height: calc(100vh - 3.25rem);
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

.upload-area {
  border: 2px dashed var(--q-border-color, #e0e0e0);
  border-radius: 8px;
  padding: 2rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background-color: var(--q-background);

  &:hover {
    border-color: var(--q-primary);
    background-color: rgba(var(--q-primary-rgb), 0.02);
  }

  &.drag-over {
    border-color: var(--q-primary);
    background-color: rgba(var(--q-primary-rgb), 0.05);
    border-style: solid;
  }

  &.has-file {
    padding: 1.5rem;
    text-align: left;
    border-style: solid;
    border-color: var(--q-positive);
    background-color: rgba(var(--q-positive-rgb), 0.02);
  }
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.file-info {
  .q-icon {
    flex-shrink: 0;
  }
}

:deep(.q-dark) {
  .upload-area {
    border-color: rgba(255, 255, 255, 0.1);

    &:hover {
      background-color: rgba(var(--q-primary-rgb), 0.05);
    }

    &.drag-over {
      background-color: rgba(var(--q-primary-rgb), 0.1);
    }

    &.has-file {
      background-color: rgba(var(--q-positive-rgb), 0.05);
    }
  }
}
</style>
