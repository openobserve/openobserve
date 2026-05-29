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
  <div class="tw:w-full service-identity-config tw:mt-2">
    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-8">
      <OSpinner size="sm" />
    </div>

    <div v-else>
      <!-- Section Header -->
      <GroupHeader
        :title="t('settings.correlation.serviceIdentityTitle')"
        :showIcon="false"
        class="tw:mb-2"
      />
      <div class="tw:text-sm tw:mb-4">
        {{ t("settings.correlation.serviceIdentityDescription") }}
      </div>

      <!-- How it works explanation -->
      <OCollapsible
        v-model="howItWorksOpen"
        icon="help-outline"
        :label="t('settings.correlation.howItWorksTitle')"
        class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid"
        :class="
          store.state.theme === 'dark'
            ? 'tw:bg-gray-700 tw:border-gray-700'
            : 'tw:bg-gray-100 tw:border-gray-200'
        "
      >
        <div class="tw:p-4 tw:text-sm tw:leading-relaxed">
          <div class="tw:mb-3">
            <div class="tw:font-semibold text-primary tw:mb-1">
              {{ t("settings.correlation.serviceIdentityLabel") }}
            </div>
            <div>{{ t("settings.correlation.howItWorksDescription") }}</div>
          </div>
          <div
            class="tw:mb-3 tw:p-3 tw:rounded"
            :class="store.state.theme === 'dark' ? 'tw:bg-gray-800' : 'bg-white'"
          >
            <div class="tw:font-semibold text-primary tw:mb-1">
              {{ t("settings.correlation.exampleLabel") }}
            </div>
            <div>
              <i18n-t keypath="settings.correlation.exampleText" tag="span">
                <template #dim1>
                  <OBadge
                    size="sm"
                    variant="primary"
                    class="tw:mx-1 tw:my-1 example-chip"
                    >k8s-cluster=prod</OBadge
                  >
                </template>
                <template #dim2>
                  <OBadge
                    size="sm"
                    variant="primary"
                    class="tw:mx-1 tw:my-1 example-chip"
                    >k8s-deployment=api-server</OBadge
                  >
                </template>
                <template #value>
                  <OBadge
                    size="sm"
                    variant="success"
                    class="tw:mx-1 tw:my-1 example-chip"
                    >prod/api-server</OBadge
                  >
                </template>
              </i18n-t>
            </div>
          </div>
          <div>
            <div class="tw:font-semibold text-primary tw:mb-1">
              {{ t("settings.correlation.correlationLabel") }}
            </div>
            <div>
              <i18n-t
                keypath="settings.correlation.correlationDescription"
                tag="span"
              >
                <template #field>
                  <span class="tw:font-mono tw:font-semibold tw:text-sm"
                    >service</span
                  >
                </template>
              </i18n-t>
            </div>
          </div>
        </div>
      </OCollapsible>

      <!-- Semantic Field Groups - Collapsible Section -->
      <OCollapsible
        v-model="semanticSectionExpanded"
        icon="category"
        :label="t('settings.correlation.semanticFieldTitle')"
        :caption="t('settings.correlation.semanticFieldDescription')"
        class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid"
        :class="
          store.state.theme === 'dark'
            ? 'tw:border-gray-700'
            : 'tw:border-gray-200'
        "
      >
        <div class="tw:p-4">
          <SemanticFieldGroupsConfig
            v-model:semantic-field-groups="localSemanticGroups"
            @update:semantic-field-groups="handleSemanticGroupsUpdate"
          />

          <!-- Save Semantic Mappings Button -->
          <div class="tw:flex tw:justify-end tw:mt-4">
            <OButton
              variant="primary"
              size="sm-action"
              @click="saveSemanticMappings"
              :loading="savingSemanticMappings"
            >{{ t('common.save') }}</OButton>
          </div>
        </div>
      </OCollapsible>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";
import GroupHeader from "@/components/common/GroupHeader.vue";
import alertsService from "@/services/alerts";
import settingsService from "@/services/settings";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const store = useStore();
const { t } = useI18n();

interface FieldAlias {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
  is_stable?: boolean;
  is_scope?: boolean;
}

interface Props {
  orgId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const loading = ref(true);
const savingSemanticMappings = ref(false);
const semanticSectionExpanded = ref(true);
const howItWorksOpen = ref(false);
const localSemanticGroups = ref<SemanticFieldGroup[]>([]);

const handleSemanticGroupsUpdate = (groups: SemanticFieldGroup[]) => {
  localSemanticGroups.value = groups;
};

const saveSemanticMappings = async () => {
  savingSemanticMappings.value = true;
  try {
    // Check for duplicate IDs before saving
    const idCounts = new Map<string, number>();
    const duplicateIds: string[] = [];

    // Check for duplicate display names within the same category
    const categoryDisplayNames = new Map<string, Map<string, string>>();

    for (const group of localSemanticGroups.value) {
      if (!group.id) {
        toast({
          variant: "error",
          message: group.group + t("settings.correlation.emptyIdError"),
        });
        savingSemanticMappings.value = false;
        return;
      }

      // Validate display name is not empty
      if (!group.display || group.display.trim() === "") {
        toast({
          variant: "error",
          message: t("common.nameRequired"),
        });
        savingSemanticMappings.value = false;
        return;
      }

      // Validate fields array is not empty
      if (!group.fields || group.fields.length === 0) {
        toast({
          variant: "error",
          message: `"${group.display || group.id}": ${t("settings.correlation.emptyFieldsError")}`,
        });
        savingSemanticMappings.value = false;
        return;
      }

      // Check for duplicate display names within the same category
      const category = group.group || "Other";
      const displayNameLower = group.display.trim().toLowerCase();

      if (!categoryDisplayNames.has(category)) {
        categoryDisplayNames.set(category, new Map<string, string>());
      }

      const categoryMap = categoryDisplayNames.get(category)!;
      if (categoryMap.has(displayNameLower)) {
        const existingId = categoryMap.get(displayNameLower);
        // Only flag as duplicate if it's a different group (different ID)
        if (existingId !== group.id) {
          toast({
            variant: "error",
            message: t("settings.correlation.duplicateNamesInCategoryError", {
              name: group.display,
              category: category,
            }),
            timeout: 5000,
          });
          savingSemanticMappings.value = false;
          return;
        }
      } else {
        categoryMap.set(displayNameLower, group.id);
      }

      const count = idCounts.get(group.id) || 0;
      idCounts.set(group.id, count + 1);

      if (count === 1 && !duplicateIds.includes(group.id)) {
        duplicateIds.push(group.id);
      }
    }

    if (duplicateIds.length > 0) {
      toast({
        variant: "error",
        message: t("settings.correlation.duplicateIdsError", {
          ids: duplicateIds.join(", "),
        }),
        timeout: 5000,
      });
      savingSemanticMappings.value = false;
      return;
    }

    // Save semantic field groups using settings v2 API (org-level setting)
    await settingsService.setOrgSetting(
      props.orgId,
      "semantic_field_groups",
      localSemanticGroups.value,
      "correlation",
      "Semantic field groups for dimension extraction and correlation",
    );

    toast({
      variant: "success",
      message: t("settings.correlation.semanticMappingsSaved"),
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving semantic mappings:", error);
    toast({
      variant: "error",
      message: error?.message || t("settings.correlation.configSaveFailed"),
    });
  } finally {
    savingSemanticMappings.value = false;
  }
};

// Fetch config on mount
const loadConfig = async () => {
  loading.value = true;

  try {
    // Load semantic field groups from settings v2 API
    let semanticGroupsFromSettings: FieldAlias[] | null = null;
    try {
      const semanticSettingResponse = await settingsService.getSetting(
        props.orgId,
        "semantic_field_groups",
      );
      const semanticSetting = semanticSettingResponse.data;
      if (
        semanticSetting?.setting_value &&
        Array.isArray(semanticSetting.setting_value) &&
        semanticSetting.setting_value.length > 0
      ) {
        semanticGroupsFromSettings = semanticSetting.setting_value;
      }
    } catch (settingError: any) {
      // Error loading setting, will use defaults
    }

    // Use settings v2 semantic groups if available, otherwise load defaults from backend
    let semanticGroups: FieldAlias[] = [];
    if (semanticGroupsFromSettings) {
      semanticGroups = semanticGroupsFromSettings;
    } else {
      // Load default semantic groups from backend
      try {
        const semanticGroupsResponse = await alertsService.getSemanticGroups(
          props.orgId,
        );
        semanticGroups = semanticGroupsResponse.data ?? [];
      } catch (semanticError) {
        console.error("Failed to load default semantic groups:", semanticError);
      }
    }

    localSemanticGroups.value = semanticGroups;
  } catch (error) {
    // Error loading config, using defaults
    localSemanticGroups.value = [];
  } finally {
    loading.value = false;
  }
};

// Load config on mount
loadConfig();
</script>

<style scoped lang="scss">
.service-identity-config {
  // Match parent card-container background
  background: var(--o2-card-bg);
}

:deep(.section-header) {
  font-weight: 600;
}

:deep(.tooltip-text) {
  font-size: 0.75rem;
}

:deep(.example-chip) {
  font-size: 13px;
}

:deep(.text-caption) {
  color: var(--o2-text-primary);
}

</style>
