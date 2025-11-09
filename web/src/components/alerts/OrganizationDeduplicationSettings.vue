<!-- Copyright 2025 OpenObserve Inc.

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
  <q-card flat class="tw-p-6">
    <div class="tw-mb-6">
      <div class="text-h6 tw-mb-2">Alert Correlation & Deduplication</div>
      <div class="text-body2 text-grey-7">
        Configure default correlation and deduplication settings that apply to
        all alerts in this organization. Individual alerts can override these
        settings.
      </div>
    </div>

    <q-separator class="tw-mb-6" />

    <!-- Semantic Field Groups Configuration -->
    <div class="tw-mb-6">
      <SemanticFieldGroupsConfig
        v-model:semantic-field-groups="localSemanticGroups"
        v-model:fingerprint-fields="localConfig.fingerprint_fields"
        @update:semantic-field-groups="handleSemanticGroupsUpdate"
        @update:fingerprint-fields="handleFingerprintFieldsUpdate"
      />
    </div>

    <!-- Time Window -->
    <div class="tw-mb-6">
      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
        Default Correlation Window (minutes)
        <q-icon
          :name="outlinedInfo"
          size="17px"
          class="q-ml-xs cursor-pointer"
          :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
        >
          <q-tooltip
            anchor="center right"
            self="center left"
            max-width="300px"
            style="font-size: 12px"
          >
            In absence of semantic field match, alerts and data from given
            duration is considered related
          </q-tooltip>
        </q-icon>
      </div>
      <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
        In absence of semantic field match, alerts and data from given duration
        is considered related
      </div>
      <q-input
        v-model.number="localConfig.time_window_minutes"
        type="number"
        dense
        filled
        min="1"
        placeholder="Use alert period by default"
        :class="
          store.state.theme === 'dark'
            ? 'input-box-bg-dark input-border-dark'
            : 'input-box-bg-light input-border-light'
        "
        @update:model-value="emitUpdate"
      />
    </div>

    <div class="tw-flex tw-justify-end tw-gap-3">
      <q-btn outline label="Cancel" @click="$emit('cancel')" class="tw-px-4" />
      <q-btn
        label="Save Settings"
        color="primary"
        @click="saveSettings"
        :loading="saving"
        class="tw-px-4"
      />
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import SemanticFieldGroupsConfig from "./SemanticFieldGroupsConfig.vue";
import alertsService from "@/services/alerts";

const store = useStore();
const $q = useQuasar();

interface SemanticFieldGroup {
  id: string;
  display_name: string;
  field_names: string[];
  normalize: boolean;
}

interface DeduplicationConfig {
  enabled: boolean;
  fingerprint_fields: string[];
  time_window_minutes?: number;
  semantic_field_groups?: SemanticFieldGroup[];
}

interface Props {
  orgId: string;
  config?: DeduplicationConfig | null;
  availableFields?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  config: null,
  availableFields: () => [],
});

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const saving = ref(false);

const localConfig = ref<DeduplicationConfig>({
  enabled: true,
  fingerprint_fields: props.config?.fingerprint_fields ?? [],
  time_window_minutes: props.config?.time_window_minutes ?? undefined,
  semantic_field_groups: props.config?.semantic_field_groups ?? [],
});

const localSemanticGroups = ref<SemanticFieldGroup[]>(
  props.config?.semantic_field_groups ?? [],
);

const handleSemanticGroupsUpdate = (groups: SemanticFieldGroup[]) => {
  localConfig.value.semantic_field_groups = groups;
};

const handleFingerprintFieldsUpdate = (fields: string[]) => {
  localConfig.value.fingerprint_fields = fields;
};

const emitUpdate = () => {
  // Just update local state, don't auto-save
};

const saveSettings = async () => {
  saving.value = true;
  try {
    await alertsService.setOrganizationDeduplicationConfig(
      props.orgId,
      localConfig.value,
    );

    $q.notify({
      type: "positive",
      message:
        "Organization correlation & deduplication settings saved successfully",
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving deduplication settings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || "Failed to save settings",
      timeout: 3000,
    });
  } finally {
    saving.value = false;
  }
};

// Watch for external changes
watch(
  () => props.config,
  (newVal) => {
    if (newVal) {
      localConfig.value = {
        enabled: true,
        fingerprint_fields: newVal.fingerprint_fields ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        semantic_field_groups: newVal.semantic_field_groups ?? [],
      };
      localSemanticGroups.value = newVal.semantic_field_groups ?? [];
    }
  },
  { deep: true, immediate: true },
);
</script>

<style scoped lang="scss">
.q-card {
  max-width: 1200px;
}
</style>
