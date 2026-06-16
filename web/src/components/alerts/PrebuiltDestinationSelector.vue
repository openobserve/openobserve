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
    <div class="selector-grid tw:grid tw:gap-3 tw:mb-4 tw:[grid-template-columns:repeat(auto-fill,minmax(8.75rem,1fr))]">
      <div
        v-for="type in filteredDestinationTypes"
        :key="type.id"
        data-test="destination-type-card"
        :data-type="type.id"
        class="destination-card tw:relative tw:py-5 tw:px-3 tw:border-2 tw:border-[var(--o2-border-color)] tw:rounded-xl tw:bg-[var(--o2-card-bg)] tw:cursor-pointer tw:transition-all tw:duration-300 tw:[min-height:7.5rem] tw:flex tw:flex-col"
        :class="{ selected: selectedType === type.id }"
        @click="selectType(type.id)"
      >
        <!-- Card Content -->
        <div class="card-content tw:flex tw:flex-col tw:items-center tw:text-center tw:h-full tw:relative">
          <!-- Icon/Image -->
          <div class="card-icon tw:mb-2 tw:text-[var(--o2-icon-color)]">
            <img
              v-if="type.image"
              :src="type.image"
              :alt="type.name"
              class="destination-logo tw:w-6 tw:h-6 tw:[object-fit:contain]"
            />
            <OIcon
              v-else
              :name="getIconName(type.icon)"
              size="md"
            />
          </div>

          <!-- Name -->
          <h3 data-test="destination-type-name" class="card-title tw:text-[0.8125rem] tw:font-medium tw:mt-1 tw:mb-0 tw:text-[var(--q-text-primary)] tw:[line-height:1.3] tw:text-center">
            {{ type.name }}
          </h3>

          <!-- Description -->
          <p data-test="destination-type-description" class="card-description tw:text-[0.6875rem] tw:text-[var(--q-text-secondary)] tw:mt-1 tw:mb-0 tw:[line-height:1.2] tw:grow tw:text-center tw:hidden">
            {{ type.description }}
          </p>
        </div>

        <!-- Selection Indicator -->
        <div
          v-if="selectedType === type.id"
          class="check-icon tw:absolute tw:top-[0.375rem] tw:right-[0.375rem] tw:w-5 tw:h-5 tw:rounded-full tw:overflow-hidden tw:bg-[var(--o2-positive)] tw:text-white tw:flex tw:items-center tw:justify-center tw:z-[1]"
        >
          <OIcon name="check" size="xs" />
        </div>
      </div>

      <!-- Custom Option Card -->
      <div
        data-test="destination-type-card"
        data-type="custom"
        class="destination-card custom-card tw:relative tw:py-5 tw:px-3 tw:border-2 tw:border-[var(--o2-border-color)] tw:border-dashed tw:rounded-xl tw:bg-[var(--o2-card-bg)] tw:cursor-pointer tw:transition-all tw:duration-300 tw:[min-height:7.5rem] tw:flex tw:flex-col"
        :class="{ selected: selectedType === 'custom' }"
        @click="selectType('custom')"
      >
        <div class="card-content tw:flex tw:flex-col tw:items-center tw:text-center tw:h-full tw:relative">
          <div class="card-icon tw:mb-2 tw:text-[var(--o2-icon-color)]">
            <OIcon name="settings" size="md" />
          </div>
          <h3 data-test="destination-type-name" class="card-title tw:text-[0.8125rem] tw:font-medium tw:mt-1 tw:mb-0 tw:text-[var(--q-text-primary)] tw:[line-height:1.3] tw:text-center">
            {{ t('alerts.customDestination') }}
          </h3>
          <p data-test="destination-type-description" class="card-description tw:text-[0.6875rem] tw:text-[var(--q-text-secondary)] tw:mt-1 tw:mb-0 tw:[line-height:1.2] tw:grow tw:text-center tw:hidden">
            {{ t('alerts.customDestinationDescription') }}
          </p>
        </div>

        <!-- Selection Indicator -->
        <div
          v-if="selectedType === 'custom'"
          class="check-icon tw:absolute tw:top-[0.375rem] tw:right-[0.375rem] tw:w-5 tw:h-5 tw:rounded-full tw:overflow-hidden tw:bg-[var(--o2-positive)] tw:text-white tw:flex tw:items-center tw:justify-center tw:z-[1]"
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
  // Map destination type icons to Quasar icon names
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
.destination-selector .destination-card:hover {
  transform: translateY(-0.125rem);
  box-shadow: 0 0.25rem 0.75rem rgba(25, 118, 210, 0.15);
  border-color: var(--q-primary);
}

.destination-selector .destination-card.selected {
  border-color: var(--q-primary);
  background: color-mix(in srgb, var(--q-primary) 10%, var(--o2-card-bg));
  box-shadow: 0 0.25rem 1rem rgba(25, 118, 210, 0.2);
}

.destination-selector .destination-card.selected .card-icon {
  color: var(--q-primary);
}

@media (min-width: 75rem) {
  .destination-selector .destination-card .card-description {
    display: block;
  }
}
</style>