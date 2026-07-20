<!-- Copyright 2026 OpenObserve Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. -->

<template>
  <div data-test="prebuilt-destination-selector" class="destination-selector">
    <!-- Destination Type Grid -->
    <div class="selector-grid grid gap-3 mb-4 [grid-template-columns:repeat(auto-fill,minmax(8.75rem,1fr))]">
      <div
        v-for="type in filteredDestinationTypes"
        :key="type.id"
        data-test="destination-type-card"
        :data-type="type.id"
        class="destination-card group/dest-card relative py-5 px-3 border-2 border-[var(--o2-border-color)] rounded-xl cursor-pointer transition-all duration-300 [min-height:7.5rem] flex flex-col hover:-translate-y-0.5 hover:shadow-[0_0.25rem_0.75rem_rgba(25,118,210,0.15)] hover:border-[var(--o2-primary-color)]"
        :class="selectedType === type.id ? 'selected border-[var(--o2-primary-color)] bg-[color-mix(in_srgb,var(--o2-primary-color)_10%,var(--o2-card-bg))] shadow-[0_0.25rem_1rem_rgba(25,118,210,0.2)]' : 'bg-[var(--o2-card-bg)]'"
        @click="selectType(type.id)"
      >
        <!-- Card Content -->
        <div class="card-content flex flex-col items-center text-center h-full relative">
          <!-- Icon/Image -->
          <div data-test="destination-type-icon" class="mb-2 text-[var(--o2-icon-color)] group-[.selected]/dest-card:text-[var(--o2-primary-color)]">
            <img
              v-if="type.image"
              :src="type.image"
              :alt="type.name"
              class="destination-logo w-6 h-6 [object-fit:contain]"
            />
            <OIcon
              v-else
              :name="getIconName(type.icon)"
              size="md"
            />
          </div>

          <!-- Name -->
          <div data-test="destination-type-name" class="card-title text-[0.8125rem] font-medium mt-1 mb-0 text-[var(--o2-text-primary)] [line-height:1.3] text-center">
            {{ type.name }}
          </div>

          <!-- Description -->
          <div data-test="destination-type-description" class="card-description text-[0.6875rem] text-[var(--o2-text-secondary)] mt-1 mb-0 [line-height:1.2] grow text-center hidden">
            {{ type.description }}
          </div>
        </div>

        <!-- Selection Indicator -->
        <div
          v-if="selectedType === type.id"
          class="check-icon absolute top-[0.375rem] right-[0.375rem] w-5 h-5 rounded-full overflow-hidden bg-[var(--o2-positive)] text-white flex items-center justify-center z-[1]"
        >
          <OIcon name="check" size="xs" />
        </div>
      </div>

      <!-- Custom Option Card -->
      <div
        data-test="destination-type-card"
        data-type="custom"
        class="destination-card custom-card group/dest-card relative py-5 px-3 border-2 border-[var(--o2-border-color)] border-dashed rounded-xl cursor-pointer transition-all duration-300 [min-height:7.5rem] flex flex-col hover:-translate-y-0.5 hover:shadow-[0_0.25rem_0.75rem_rgba(25,118,210,0.15)] hover:border-[var(--o2-primary-color)]"
        :class="selectedType === 'custom' ? 'selected border-[var(--o2-primary-color)] bg-[color-mix(in_srgb,var(--o2-primary-color)_10%,var(--o2-card-bg))] shadow-[0_0.25rem_1rem_rgba(25,118,210,0.2)]' : 'bg-[var(--o2-card-bg)]'"
        @click="selectType('custom')"
      >
        <div class="card-content flex flex-col items-center text-center h-full relative">
          <div data-test="destination-type-icon" class="mb-2 text-[var(--o2-icon-color)] group-[.selected]/dest-card:text-[var(--o2-primary-color)]">
            <OIcon name="settings" size="md" />
          </div>
          <div data-test="destination-type-name" class="card-title text-[0.8125rem] font-medium mt-1 mb-0 text-[var(--o2-text-primary)] [line-height:1.3] text-center">
            {{ t('alerts.customDestination') }}
          </div>
          <div data-test="destination-type-description" class="card-description text-[0.6875rem] text-[var(--o2-text-secondary)] mt-1 mb-0 [line-height:1.2] grow text-center hidden">
            {{ t('alerts.customDestinationDescription') }}
          </div>
        </div>

        <!-- Selection Indicator -->
        <div
          v-if="selectedType === 'custom'"
          class="check-icon absolute top-[0.375rem] right-[0.375rem] w-5 h-5 rounded-full overflow-hidden bg-[var(--o2-positive)] text-white flex items-center justify-center z-[1]"
        >
          <OIcon name="check" size="xs" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { PREBUILT_DESTINATION_TYPES } from '@/utils/prebuilt-templates';
import type { PrebuiltTypeId } from '@/utils/prebuilt-templates/types';
import OIcon from "@/lib/core/Icon/OIcon.vue";

// Define component props
interface Props {
  modelValue?: PrebuiltTypeId | 'custom' | null;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null
});

// Define component emits
interface Emits {
  (e: 'update:modelValue', value: PrebuiltTypeId | 'custom' | null): void;
  (e: 'select', value: PrebuiltTypeId | 'custom'): void;
}

const emit = defineEmits<Emits>();

// Composables
const { t } = useI18n();

// Reactive state
const selectedType = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

// Computed properties
const filteredDestinationTypes = computed(() => PREBUILT_DESTINATION_TYPES);

// Methods
function selectType(typeId: PrebuiltTypeId | 'custom') {
  selectedType.value = typeId;
  emit('select', typeId);
}

function getIconName(icon: string): string {
  // Map destination type icons to icon names
  const iconMap: Record<string, string> = {
    slack: 'chat',
    discord: 'forum',
    msteams: 'groups',
    email: 'email',
    pagerduty: 'warning',
    opsgenie: 'notifications_active',
    servicenow: 'support_agent',
    custom: 'settings'
  };

  return iconMap[icon] || icon;
}
</script>

<style>
@media (min-width: 75rem) {
  .destination-selector .destination-card .card-description {
    display: block;
  }
}
</style>