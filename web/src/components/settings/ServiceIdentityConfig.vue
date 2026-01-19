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
  <div class="tw:w-full service-identity-config q-mt-sm">
    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-8">
      <q-spinner-hourglass color="primary" size="30px" />
    </div>

    <div v-else>
      <!-- Section Header -->
      <GroupHeader :title="t('settings.correlation.serviceIdentityTitle')" :showIcon="false" class="tw:mb-2" />
      <div class="text-body2 tw:mb-4">
        {{ t("settings.correlation.serviceIdentityDescription") }}
      </div>

    <!-- How it works explanation -->
    <q-expansion-item
      dense
      dense-toggle
      icon="help_outline"
      :label="t('settings.correlation.howItWorksTitle')"
      class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid expanstion-item-o2"
      :class="store.state.theme === 'dark' ? 'bg-grey-9 tw:border-gray-700' : 'bg-grey-2 tw:border-gray-200'"
    >
      <div class="tw:p-4 text-body2 tw:leading-relaxed">
        <div class="tw:mb-3">
          <div class="tw:font-semibold text-primary tw:mb-1">{{ t("settings.correlation.serviceIdentityLabel") }}</div>
          <div>{{ t("settings.correlation.howItWorksDescription") }}</div>
        </div>
        <div class="tw:mb-3">
          <div class="tw:font-semibold text-primary tw:mb-1">{{ t("settings.correlation.compoundFqnLabel") }}</div>
          <div>{{ t("settings.correlation.compoundFqnDescription") }}</div>
        </div>
        <div class="tw:mb-3 tw:p-3 tw:rounded" :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-white'">
          <div class="tw:font-semibold text-primary tw:mb-1">{{ t("settings.correlation.exampleLabel") }}</div>
          <div>
            <i18n-t keypath="settings.correlation.exampleText" tag="span">
              <template #dim1>
                <q-chip dense size="sm" color="primary" text-color="white" class="tw:mx-1 tw:my-1 example-chip">k8s-cluster=prod</q-chip>
              </template>
              <template #dim2>
                <q-chip dense size="sm" color="secondary" text-color="white" class="tw:mx-1 tw:my-1 example-chip">k8s-deployment=api-server</q-chip>
              </template>
              <template #value>
                <q-chip dense size="sm" color="positive" text-color="white" class="tw:mx-1 tw:my-1 example-chip">prod/api-server</q-chip>
              </template>
            </i18n-t>
          </div>
        </div>
        <div>
          <div class="tw:font-semibold text-primary tw:mb-1">{{ t("settings.correlation.correlationLabel") }}</div>
          <div>
            <i18n-t keypath="settings.correlation.correlationDescription" tag="span">
              <template #field>
                <span class="tw:font-mono tw:font-semibold tw:text-sm">service</span>
              </template>
            </i18n-t>
          </div>
        </div>
      </div>
    </q-expansion-item>

    <!-- FQN Formula Preview -->
    <div
      class="tw:mb-4 tw:p-4 tw:rounded-lg tw:border tw:border-solid"
      :class="store.state.theme === 'dark' ? 'bg-grey-9 tw:border-gray-700' : 'bg-grey-2 tw:border-gray-200'"
    >
      <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
        <q-icon name="functions" size="sm" color="primary" />
        <span class="tw:font-semibold">{{ t('settings.correlation.fqnFormulaTitle') }}</span>
        <q-icon name="info" size="xs" class="tw:text-gray-400 tw:cursor-help">
          <q-tooltip max-width="350px">{{ t('settings.correlation.fqnFormulaTooltip') }}</q-tooltip>
        </q-icon>
      </div>

      <!-- Environment-grouped FQN patterns -->
      <div class="fqn-formula-box tw:p-3 tw:rounded tw:overflow-x-auto">
        <div v-if="fqnFormula.envPatterns.length > 0" class="tw:space-y-2">
          <div
            v-for="env in fqnFormula.envPatterns"
            :key="env.name"
            class="tw:flex tw:items-center tw:flex-wrap tw:gap-1"
          >
            <span class="fqn-env-label tw:font-semibold tw:text-sm tw:min-w-[100px]">{{ env.name }}:</span>
            <!-- Scope dimensions for this environment -->
            <template v-for="(dim, idx) in env.scopeDims" :key="'scope-' + dim">
              <q-chip
                dense
                size="sm"
                color="primary"
                text-color="white"
                class="tw:mx-0.5"
              >
                {{ getDimensionDisplay(dim) }}
                <q-tooltip>{{ t('settings.correlation.scopeDimension') }}</q-tooltip>
              </q-chip>
              <span v-if="idx < env.scopeDims.length - 1 || env.workloadDims.length > 0" class="fqn-separator">/</span>
            </template>
            <!-- Workload dimensions for this environment -->
            <template v-if="env.workloadDims.length > 0">
              <template v-if="env.workloadDims.length === 1">
                <q-chip
                  dense
                  size="sm"
                  color="secondary"
                  text-color="white"
                  class="tw:mx-0.5"
                >
                  {{ getDimensionDisplay(env.workloadDims[0]) }}
                  <q-tooltip>{{ t('settings.correlation.workloadDimension') }}</q-tooltip>
                </q-chip>
              </template>
              <template v-else>
                <span class="fqn-text-muted tw:text-xs tw:italic">{{ t('settings.correlation.firstNonNull') }} (</span>
                <template v-for="(dim, idx) in env.workloadDims" :key="'workload-' + dim">
                  <q-chip
                    dense
                    size="sm"
                    color="secondary"
                    text-color="white"
                    class="tw:mx-0.5"
                  >
                    {{ getDimensionDisplay(dim) }}
                    <q-tooltip>{{ t('settings.correlation.workloadDimension') }}</q-tooltip>
                  </q-chip>
                  <span v-if="idx < env.workloadDims.length - 1" class="fqn-comma">,</span>
                </template>
                <span class="fqn-text-muted tw:text-xs">)</span>
              </template>
            </template>
            <!-- Show placeholder if no workload dims -->
            <span v-if="env.scopeDims.length > 0 && env.workloadDims.length === 0" class="fqn-text-muted tw:text-xs tw:italic">
              ({{ t('settings.correlation.scopeOnly') }})
            </span>
          </div>
        </div>

        <!-- Fallback when no dimensions -->
        <span v-if="fqnFormula.envPatterns.length === 0" class="fqn-text-muted tw:italic">
          {{ t('settings.correlation.noFormulaConfigured') }}
        </span>

        <!-- Fallback note when "Other" or "Common" group exists with workload dimensions -->
        <div
          v-if="hasFallbackDimensions"
          class="fqn-fallback-note tw:mt-3 tw:pt-2 tw:border-t tw:border-dashed tw:text-xs tw:italic"
          :class="store.state.theme === 'dark' ? 'tw:border-gray-600' : 'tw:border-gray-300'"
        >
          <q-icon name="info" size="xs" class="tw:mr-1" />
          {{ t('settings.correlation.fallbackNote') }}
        </div>
      </div>

      <!-- Legend -->
      <div class="fqn-legend tw:flex tw:gap-4 tw:mt-3 tw:text-xs">
        <div class="tw:flex tw:items-center tw:gap-1">
          <span class="fqn-legend-dot fqn-legend-dot--scope"></span>
          <span>{{ t('settings.correlation.scopeLegend') }}</span>
        </div>
        <div class="tw:flex tw:items-center tw:gap-1">
          <span class="fqn-legend-dot fqn-legend-dot--workload"></span>
          <span>{{ t('settings.correlation.workloadLegend') }}</span>
        </div>
      </div>
    </div>

    <!-- FQN Priority Dimensions - Collapsible Section -->
    <q-expansion-item
      v-model="fqnSectionExpanded"
      icon="reorder"
      :label="t('settings.correlation.fqnPriorityTitle')"
      :caption="t('settings.correlation.fqnPriorityDescription')"
      header-class="section-header"
      class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid expanstion-item-o2"
      :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'"
      default-opened
    >
      <div class="tw:p-4">
        <div class="tw:flex tw:gap-4">
          <!-- Priority Order (Left) -->
          <div class="tw:flex-1">
            <div class="tw:text-sm tw:font-semibold tw:mb-2">{{ t('settings.correlation.priorityOrderLabel') }}</div>
            <q-input
              v-model="prioritySearchQuery"
              dense
              outlined
              :placeholder="t('common.search') + '...'"
              class="tw:mb-2"
            >
              <template #prepend><q-icon name="search" /></template>
            </q-input>
            <q-list bordered class="tw:rounded-lg tw:h-80 tw:overflow-auto">
              <q-item
                v-for="item in filteredPriorityDimensions"
                :key="item.dim"
                clickable
                @click="togglePrioritySelection(item.dim)"
                :active="selectedPriorityDimensions.includes(item.dim)"
                dense
                class="tw:py-2 tw:cursor-move"
                draggable="true"
                @dragstart="handleDragStart(item.actualIndex, $event)"
                @dragover.prevent
                @drop="handleDrop(item.actualIndex, $event)"
              >
                <q-item-section avatar class="tw:min-w-0 tw:mr-1">
                  <q-icon name="drag_indicator" size="sm" class="tw:text-gray-400" />
                </q-item-section>
                <q-item-section avatar class="tw:min-w-0 tw:mr-3">
                  <q-badge
                    :color="isDimensionScope(item.dim) ? 'primary' : 'secondary'"
                    text-color="white"
                    class="tw:w-6 tw:h-6 tw:flex tw:items-center tw:justify-center tw:rounded-full"
                  >
                    {{ item.actualIndex + 1 }}
                  </q-badge>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="tw:font-medium">
                    {{ getDimensionDisplay(item.dim) }}
                    <span class="tw:font-normal tw:text-xs tw:opacity-70">({{ item.dim }})</span>
                    <q-badge
                      :color="isDimensionScope(item.dim) ? 'primary' : 'secondary'"
                      text-color="white"
                      class="tw:ml-2 tw:text-xs"
                      dense
                    >
                      {{ isDimensionScope(item.dim) ? t('settings.correlation.scopeTag') : t('settings.correlation.workloadTag') }}
                    </q-badge>
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="tw:flex tw:gap-1">
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="arrow_upward"
                      :disable="item.actualIndex === 0"
                      @click.stop="moveFqnDimensionUp(item.actualIndex)"
                    >
                      <q-tooltip>{{ t("settings.correlation.moveUp") }}</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="arrow_downward"
                      :disable="item.actualIndex === localFqnPriority.length - 1"
                      @click.stop="moveFqnDimensionDown(item.actualIndex)"
                    >
                      <q-tooltip>{{ t("settings.correlation.moveDown") }}</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="delete"
                      color="negative"
                      @click.stop="removeFqnDimension(item.actualIndex)"
                    >
                      <q-tooltip>{{ t("settings.correlation.removeFromList") }}</q-tooltip>
                    </q-btn>
                  </div>
                </q-item-section>
              </q-item>
              <q-item v-if="filteredPriorityDimensions.length === 0" class="tw:py-4 tw:text-center tw:text-gray-500">
                {{ prioritySearchQuery ? t("settings.correlation.noMatchingDimensions") : t("settings.correlation.noDimensionsConfigured") }}
              </q-item>
            </q-list>
          </div>

          <!-- Center Buttons -->
          <div class="tw:flex tw:flex-col tw:justify-center tw:gap-2">
            <q-btn
              data-test="correlation-service-identity-backward-btn"
              class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              no-caps
              flat
              icon="arrow_back"
              @click="addSelectedDimensions"
              :disable="selectedAvailableDimensions.length === 0"
            />
            <q-btn
              data-test="correlation-service-identity-forward-btn"
              class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              no-caps
              flat
              icon="arrow_forward"
              @click="removeSelectedDimensions"
              :disable="selectedPriorityDimensions.length === 0"
            />
          </div>

          <!-- Available Semantic Groups (Right) -->
          <div class="tw:flex-1">
            <div class="tw:text-sm tw:font-semibold tw:mb-2">{{ t('settings.correlation.availableDimensions') }}</div>
            <q-input
              data-test="correlation-service-identity-available-search-input"
              v-model="availableSearchQuery"
              dense
              outlined
              :placeholder="t('common.search') + '...'"
              class="tw:mb-2"
            >
              <template #prepend><q-icon name="search" /></template>
            </q-input>
            <q-list bordered class="tw:rounded-lg tw:h-80 tw:overflow-auto">
              <q-item
                v-for="group in filteredAvailableGroups"
                :key="group.value"
                clickable
                @click="toggleAvailableSelection(group.value)"
                :active="selectedAvailableDimensions.includes(group.value)"
                dense
              >
                <q-item-section>
                  <q-item-label>{{ group.label }} <span class="tw:font-normal tw:text-xs">({{ group.value }})</span></q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="filteredAvailableGroups.length === 0" class="tw:py-4 tw:text-center tw:text-gray-500">
                {{ availableSearchQuery ? t("settings.correlation.noMatchingGroups") : t("settings.correlation.noSemanticGroupsAvailable") }}
              </q-item>
            </q-list>
          </div>
        </div>

        <!-- Reset and Save Buttons -->
        <div class="tw:flex tw:justify-end tw:gap-2 tw:mt-4">
          <q-btn
            data-test="correlation-service-identity-reset-btn"
            class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            flat
            :label="t('settings.correlation.resetToDefaults')"
            @click="resetFqnPriority"
          />
          <q-btn
            data-test="correlation-service-identity-save-btn"
            class="text-bold o2-primary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            :label="t('common.save')"
            @click="saveFqnPriority"
            :loading="savingFqn"
          />
        </div>

        <div v-if="availableSemanticGroups.length === 0 && localSemanticGroups.length === 0" class="tw:mt-2 tw:text-sm tw:text-amber-600 dark:tw:text-amber-400">
          {{ t("settings.correlation.noSemanticGroupsConfigured") }}
        </div>
      </div>
    </q-expansion-item>

    <!-- Semantic Field Groups - Collapsible Section -->
    <q-expansion-item
      v-model="semanticSectionExpanded"
      icon="category"
      :label="t('settings.correlation.semanticFieldTitle')"
      :caption="t('settings.correlation.semanticFieldDescription')"
      header-class="section-header"
      class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid expanstion-item-o2"
      :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'"
      default-opened
    >
      <div class="tw:p-4">
          <SemanticFieldGroupsConfig
          v-model:semantic-field-groups="localSemanticGroups"
          @update:semantic-field-groups="handleSemanticGroupsUpdate"
        />

        <!-- Save Semantic Mappings Button -->
        <div class="tw:flex tw:justify-end tw:mt-4">
          <q-btn
            class="text-bold o2-primary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            :label="t('common.save')"
            @click="saveSemanticMappings"
            :loading="savingSemanticMappings"
          />
        </div>
      </div>
    </q-expansion-item>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";
import GroupHeader from "@/components/common/GroupHeader.vue";
import alertsService from "@/services/alerts";
import settingsService from "@/services/settings";

const store = useStore();
const $q = useQuasar();
const { t } = useI18n();

interface SemanticFieldGroup {
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
const savingFqn = ref(false);
const savingSemanticMappings = ref(false);
const fqnSectionExpanded = ref(true);
const semanticSectionExpanded = ref(true);
const localFqnPriority = ref<string[]>([]);
const localSemanticGroups = ref<SemanticFieldGroup[]>([]);
const selectedSemanticGroup = ref<string | null>(null);

// Dual-list selector state
const prioritySearchQuery = ref('');
const availableSearchQuery = ref('');
const selectedAvailableDimensions = ref<string[]>([]);
const selectedPriorityDimensions = ref<string[]>([]);
const draggedIndex = ref<number | null>(null);

// Reserved IDs that should not be used as semantic groups
// service-fqn is the OUTPUT of correlation, not an input dimension
const RESERVED_GROUP_IDS = ['service-fqn', 'servicefqn', 'fqn'];

// Computed: Get semantic groups not already in the priority list
const availableSemanticGroups = computed(() => {
  return localSemanticGroups.value
    .filter(group => {
      // Exclude reserved/computed fields like service-fqn (it's the output, not an input)
      if (RESERVED_GROUP_IDS.includes(group.id?.toLowerCase())) {
        return false;
      }
      // Exclude groups already in the priority list
      return !localFqnPriority.value.includes(group.id);
    })
    .map(group => ({
      label: group.display || group.id,
      value: group.id
    }));
});

// Filtered priority dimensions with actual indices
const filteredPriorityDimensions = computed(() => {
  const items = localFqnPriority.value.map((dim, actualIndex) => ({ dim, actualIndex }));

  if (!prioritySearchQuery.value) return items;

  const query = prioritySearchQuery.value.toLowerCase();
  return items.filter(({ dim }) => {
    const display = getDimensionDisplay(dim).toLowerCase();
    return display.includes(query) || dim.toLowerCase().includes(query);
  });
});

// Filtered available groups based on search
const filteredAvailableGroups = computed(() => {
  const available = availableSemanticGroups.value;
  if (!availableSearchQuery.value) return available;
  const query = availableSearchQuery.value.toLowerCase();
  return available.filter(g =>
    g.label.toLowerCase().includes(query) || g.value.toLowerCase().includes(query)
  );
});

// Environment pattern type for FQN formula display
interface EnvironmentPattern {
  name: string;
  scopeDims: string[];
  workloadDims: string[];
}

// Computed: Derive FQN formula grouped by environment/semantic group
// Shows patterns like: K8s: cluster/deployment, AWS: region/ecs-cluster/task
const fqnFormula = computed(() => {
  // Build a lookup map for semantic groups
  const groupLookup = new Map<string, SemanticFieldGroup>();
  localSemanticGroups.value.forEach(g => groupLookup.set(g.id, g));

  // Group dimensions by their semantic group category
  const envPatterns: EnvironmentPattern[] = [];
  const groupedDims = new Map<string, { scope: string[], workload: string[] }>();

  // Categorize each priority dimension by its group
  // Rename "Common" to "Fallback" for clarity in the UI
  const fallbackLabel = t('settings.correlation.fallbackGroup');
  for (const dimId of localFqnPriority.value) {
    const group = groupLookup.get(dimId);
    // Use "Fallback" label for "Common" group to make it clearer
    let groupName = group?.group || t('settings.correlation.otherGroup');
    if (groupName === 'Common') {
      groupName = fallbackLabel;
    }
    const isScope = group?.is_scope ?? false;

    if (!groupedDims.has(groupName)) {
      groupedDims.set(groupName, { scope: [], workload: [] });
    }

    const dims = groupedDims.get(groupName)!;
    if (isScope) {
      dims.scope.push(dimId);
    } else {
      dims.workload.push(dimId);
    }
  }

  // Convert to array of patterns, only include groups that have at least one dimension
  for (const [name, dims] of groupedDims) {
    if (dims.scope.length > 0 || dims.workload.length > 0) {
      envPatterns.push({
        name,
        scopeDims: dims.scope,
        workloadDims: dims.workload
      });
    }
  }

  // Also compute flat lists for legacy display
  const scopeDims: string[] = [];
  const workloadDims: string[] = [];
  for (const dimId of localFqnPriority.value) {
    const group = groupLookup.get(dimId);
    const isScope = group?.is_scope ?? false;
    if (isScope) {
      scopeDims.push(dimId);
    } else {
      workloadDims.push(dimId);
    }
  }

  return { scopeDims, workloadDims, envPatterns };
});

// Check if there are fallback dimensions (in "Fallback" or "Other" group with workload dimensions)
// This indicates dimensions like "service" that apply across all environments
const hasFallbackDimensions = computed(() => {
  const otherGroupName = t('settings.correlation.otherGroup');
  const fallbackGroupName = t('settings.correlation.fallbackGroup');
  return fqnFormula.value.envPatterns.some(
    env => (env.name === otherGroupName || env.name === fallbackGroupName) && env.workloadDims.length > 0
  );
});

// Check if a dimension is a scope dimension
const isDimensionScope = (dimId: string): boolean => {
  const group = localSemanticGroups.value.find(g => g.id === dimId);
  return group?.is_scope ?? false;
};

// Toggle selection in priority list
const togglePrioritySelection = (value: string) => {
  const index = selectedPriorityDimensions.value.indexOf(value);
  if (index > -1) {
    selectedPriorityDimensions.value.splice(index, 1);
  } else {
    selectedPriorityDimensions.value.push(value);
  }
};

// Toggle selection in available list
const toggleAvailableSelection = (value: string) => {
  const index = selectedAvailableDimensions.value.indexOf(value);
  if (index > -1) {
    selectedAvailableDimensions.value.splice(index, 1);
  } else {
    selectedAvailableDimensions.value.push(value);
  }
};

// Drag and drop handlers
const handleDragStart = (index: number, event: DragEvent) => {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
};

const handleDrop = (targetIndex: number, event: DragEvent) => {
  event.preventDefault();
  if (draggedIndex.value === null || draggedIndex.value === targetIndex) return;

  const newList = [...localFqnPriority.value];
  const draggedItem = newList[draggedIndex.value];
  newList.splice(draggedIndex.value, 1);
  newList.splice(targetIndex, 0, draggedItem);

  localFqnPriority.value = newList;
  draggedIndex.value = null;
};

// Add selected dimensions from right to left
const addSelectedDimensions = () => {
  localFqnPriority.value.push(...selectedAvailableDimensions.value);
  selectedAvailableDimensions.value = [];
};

// Remove selected dimensions from left
const removeSelectedDimensions = () => {
  localFqnPriority.value = localFqnPriority.value.filter(
    d => !selectedPriorityDimensions.value.includes(d)
  );
  selectedPriorityDimensions.value = [];
};

// Get display name for a dimension - check semantic groups first, then format the ID
const getDimensionDisplay = (dimId: string): string => {
  const group = localSemanticGroups.value.find(g => g.id === dimId);
  if (group?.display) {
    return group.display;
  }
  // Format the dimension ID as a display name (e.g., "k8s-deployment" -> "K8s Deployment")
  return dimId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const handleSemanticGroupsUpdate = (groups: SemanticFieldGroup[]) => {
  // Filter out reserved IDs like service-fqn (it's the output, not an input)
  const filteredGroups = groups.filter(g => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));
  localSemanticGroups.value = filteredGroups;
};

// FQN Priority dimension management
const moveFqnDimensionUp = (index: number) => {
  if (index === 0) return;
  const dims = [...localFqnPriority.value];
  [dims[index - 1], dims[index]] = [dims[index], dims[index - 1]];
  localFqnPriority.value = dims;
};

const moveFqnDimensionDown = (index: number) => {
  if (index >= localFqnPriority.value.length - 1) return;
  const dims = [...localFqnPriority.value];
  [dims[index], dims[index + 1]] = [dims[index + 1], dims[index]];
  localFqnPriority.value = dims;
};

const removeFqnDimension = (index: number) => {
  localFqnPriority.value.splice(index, 1);
};

const addFqnDimension = () => {
  if (selectedSemanticGroup.value && !localFqnPriority.value.includes(selectedSemanticGroup.value)) {
    localFqnPriority.value.push(selectedSemanticGroup.value);
    selectedSemanticGroup.value = null;
  }
};

const resetFqnPriority = () => {
  // Reset to backend defaults from O2_FQN_PRIORITY_DIMENSIONS
  const backendDefaults = store.state.zoConfig?.fqn_priority_dimensions || [];
  localFqnPriority.value = [...backendDefaults];
};

const saveFqnPriority = async () => {
  savingFqn.value = true;
  try {
    // Save FQN priority dimensions using settings v2 API (org-level setting)
    await settingsService.setOrgSetting(
      props.orgId,
      "fqn_priority_dimensions",
      localFqnPriority.value,
      "correlation",
      "FQN priority dimensions for service correlation"
    );

    $q.notify({
      type: "positive",
      message: t("settings.correlation.fqnPrioritySaved"),
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving FQN priority settings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || t("settings.correlation.configSaveFailed"),
      timeout: 3000,
    });
  } finally {
    savingFqn.value = false;
  }
};

const saveSemanticMappings = async () => {
  savingSemanticMappings.value = true;
  try {
    // Save semantic field groups using settings v2 API (org-level setting)
    await settingsService.setOrgSetting(
      props.orgId,
      "semantic_field_groups",
      localSemanticGroups.value,
      "correlation",
      "Semantic field groups for dimension extraction and correlation"
    );

    $q.notify({
      type: "positive",
      message: t("settings.correlation.semanticMappingsSaved"),
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving semantic mappings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || t("settings.correlation.configSaveFailed"),
      timeout: 3000,
    });
  } finally {
    savingSemanticMappings.value = false;
  }
};

// Fetch config on mount
const loadConfig = async () => {
  loading.value = true;
  // Get backend defaults for FQN priority dimensions
  const backendDefaults = store.state.zoConfig?.fqn_priority_dimensions || [];

  try {
    // Load FQN priority from settings v2 API
    let fqnPriorityFromSettings: string[] | null = null;
    try {
      const settingResponse = await settingsService.getSetting(props.orgId, "fqn_priority_dimensions");
      const setting = settingResponse.data;
      if (setting?.setting_value && Array.isArray(setting.setting_value) && setting.setting_value.length > 0) {
        fqnPriorityFromSettings = setting.setting_value;
      }
    } catch (settingError: any) {
      // Error loading setting, use defaults
    }

    // Load semantic field groups from settings v2 API
    let semanticGroupsFromSettings: SemanticFieldGroup[] | null = null;
    try {
      const semanticSettingResponse = await settingsService.getSetting(props.orgId, "semantic_field_groups");
      const semanticSetting = semanticSettingResponse.data;
      if (semanticSetting?.setting_value && Array.isArray(semanticSetting.setting_value) && semanticSetting.setting_value.length > 0) {
        semanticGroupsFromSettings = semanticSetting.setting_value;
      }
    } catch (settingError: any) {
      // Error loading setting, will use defaults
    }

    // Use settings v2 FQN priority if available, otherwise use backend defaults
    const fqnPriority = fqnPriorityFromSettings ?? [...backendDefaults];

    // Use settings v2 semantic groups if available, otherwise load defaults from backend
    let semanticGroups: SemanticFieldGroup[] = [];
    if (semanticGroupsFromSettings) {
      semanticGroups = semanticGroupsFromSettings;
    } else {
      // Load default semantic groups from backend
      try {
        const semanticGroupsResponse = await alertsService.getSemanticGroups(props.orgId);
        semanticGroups = semanticGroupsResponse.data ?? [];
      } catch (semanticError) {
        console.error("Failed to load default semantic groups:", semanticError);
      }
    }

    // Filter out reserved IDs like service-fqn (it's the output, not an input)
    const filteredSemanticGroups = semanticGroups
      .filter((g: SemanticFieldGroup) => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));

    localFqnPriority.value = fqnPriority;
    localSemanticGroups.value = filteredSemanticGroups;
  } catch (error) {
    // Error loading config, using defaults
    localFqnPriority.value = [...backendDefaults];
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

:deep(.q-expansion-item__content) {
  background: var(--o2-card-bg);
}

:deep(.tooltip-text) {
  font-size: 0.75rem;
}

// Custom highlight for selected items in dual-list
:deep(.q-item.q-item--active) {
  background-color: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%) !important;
  color: black;
}

:deep(.example-chip) {
  font-size: 13px;
}

:deep(.text-caption) {
  color: var(--o2-text-primary);
}

body.body--dark {
  .q-list .q-item__label {
    color: white !important;
  }
}

</style>
<style lang="scss">
.expanstion-item-o2 {
  .q-item__section--side {
    min-width: auto;
  }
}

// FQN Formula Box styles
.service-identity-config {
  .fqn-formula-box {
    background-color: #f5f5f5;
  }

  .fqn-env-label {
    color: #424242;
  }

  .fqn-separator {
    color: var(--q-primary);
    font-weight: 600;
    margin: 0 2px;
  }

  .fqn-text-muted {
    color: #757575;
  }

  .fqn-comma {
    color: #757575;
    margin: 0 2px;
  }

  .fqn-legend {
    color: #616161;
  }

  .fqn-legend-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .fqn-legend-dot--scope {
    background-color: var(--q-primary);
  }

  .fqn-legend-dot--workload {
    background-color: var(--q-secondary);
  }

  .fqn-fallback-note {
    color: #616161;
  }
}

// Dark mode overrides
body.body--dark .service-identity-config {
  .fqn-formula-box {
    background-color: #1d1d1d;
  }

  .fqn-env-label {
    color: #e0e0e0;
  }

  .fqn-text-muted {
    color: #9e9e9e;
  }

  .fqn-comma {
    color: #9e9e9e;
  }

  .fqn-legend {
    color: #9e9e9e;
  }

  .fqn-fallback-note {
    color: #9e9e9e;
  }
}
</style>