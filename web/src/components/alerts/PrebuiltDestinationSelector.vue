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
    <!-- Search Bar -->
    <div class="search-container q-mb-md">
      <q-input
        v-model="searchQuery"
        data-test="destination-search-input"
        :placeholder="t('alerts.searchDestinationType')"
        dense
        outlined
        clearable
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <!-- Destination Type Grid -->
    <div class="selector-grid">
      <div
        v-for="type in filteredDestinationTypes"
        :key="type.id"
        data-test="destination-type-card"
        :data-type="type.id"
        class="destination-card"
        :class="{ selected: selectedType === type.id }"
        @click="selectType(type.id)"
      >
        <!-- Popular Badge -->
        <q-badge
          v-if="type.popular"
          data-test="destination-popular-badge"
          color="primary"
          class="popular-badge"
        >
          {{ t('alerts.popular') }}
        </q-badge>

        <!-- Card Content -->
        <div class="card-content">
          <!-- Icon -->
          <div class="card-icon">
            <q-icon :name="getIconName(type.icon)" size="32px" />
          </div>

          <!-- Name -->
          <h3 data-test="destination-type-name" class="card-title">
            {{ type.name }}
          </h3>

          <!-- Description -->
          <p data-test="destination-type-description" class="card-description">
            {{ type.description }}
          </p>

          <!-- Selection Indicator -->
          <q-icon
            v-if="selectedType === type.id"
            name="check_circle"
            color="primary"
            size="20px"
            class="selection-indicator"
          />
        </div>
      </div>

      <!-- Custom Option Card -->
      <div
        data-test="destination-type-card"
        data-type="custom"
        class="destination-card custom-card"
        :class="{ selected: selectedType === 'custom' }"
        @click="selectType('custom')"
      >
        <div class="card-content">
          <div class="card-icon">
            <q-icon name="settings" size="32px" />
          </div>
          <h3 data-test="destination-type-name" class="card-title">
            {{ t('alerts.customDestination') }}
          </h3>
          <p data-test="destination-type-description" class="card-description">
            {{ t('alerts.customDestinationDescription') }}
          </p>
          <q-icon
            v-if="selectedType === 'custom'"
            name="check_circle"
            color="primary"
            size="20px"
            class="selection-indicator"
          />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="filteredDestinationTypes.length === 0"
      data-test="destination-search-empty"
      class="empty-state"
    >
      <q-icon name="search_off" size="48px" color="grey-5" />
      <p class="empty-text">
        {{ t('alerts.noDestinationTypesFound') }}
      </p>
      <q-btn
        flat
        color="primary"
        :label="t('alerts.clearSearch')"
        @click="searchQuery = ''"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PREBUILT_DESTINATION_TYPES } from '@/utils/prebuilt-templates';
import type { PrebuiltTypeId } from '@/utils/prebuilt-templates/types';

// Define component props
interface Props {
  modelValue?: PrebuiltTypeId | 'custom' | null;
  searchQuery?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  searchQuery: ''
});

// Define component emits
interface Emits {
  (e: 'update:modelValue', value: PrebuiltTypeId | 'custom' | null): void;
  (e: 'update:searchQuery', value: string): void;
  (e: 'select', value: PrebuiltTypeId | 'custom'): void;
}

const emit = defineEmits<Emits>();

// Composables
const { t } = useI18n();

// Reactive state
const searchQuery = ref(props.searchQuery);
const selectedType = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

// Computed properties
const filteredDestinationTypes = computed(() => {
  if (!searchQuery.value.trim()) {
    return PREBUILT_DESTINATION_TYPES;
  }

  const query = searchQuery.value.toLowerCase().trim();
  return PREBUILT_DESTINATION_TYPES.filter(type =>
    type.name.toLowerCase().includes(query) ||
    type.description.toLowerCase().includes(query) ||
    type.category.toLowerCase().includes(query)
  );
});

// Methods
function selectType(typeId: PrebuiltTypeId | 'custom') {
  selectedType.value = typeId;
  emit('select', typeId);
}

function getIconName(icon: string): string {
  // Map destination type icons to Quasar icon names
  const iconMap: Record<string, string> = {
    slack: 'chat',
    msteams: 'groups',
    email: 'email',
    pagerduty: 'warning',
    opsgenie: 'notifications_active',
    servicenow: 'support_agent',
    custom: 'settings'
  };

  return iconMap[icon] || icon;
}

// Watch search query changes
watch(() => searchQuery.value, (newValue) => {
  emit('update:searchQuery', newValue);
});
</script>

<style scoped lang="scss">
.destination-selector {
  .search-container {
    max-width: 400px;
  }

  .selector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
    margin-top: 1rem;

    @media (max-width: 768px) {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 0.75rem;
    }
  }

  .destination-card {
    position: relative;
    padding: 1.5rem 1rem;
    border: 2px solid var(--q-border-color);
    border-radius: 8px;
    background: var(--q-card-bg);
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 140px;
    display: flex;
    flex-direction: column;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border-color: var(--q-primary);
    }

    &.selected {
      border-color: var(--q-primary);
      background: linear-gradient(135deg, var(--q-primary-light) 0%, transparent 100%);
      box-shadow: 0 2px 8px rgba(var(--q-primary-rgb), 0.2);
    }

    &.custom-card {
      border-style: dashed;
    }

    .popular-badge {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      font-size: 0.7rem;
    }

    .card-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      height: 100%;
      position: relative;
    }

    .card-icon {
      margin-bottom: 0.75rem;
      color: var(--q-primary);
    }

    .card-title {
      font-size: 0.9rem;
      font-weight: 600;
      margin: 0 0 0.5rem 0;
      color: var(--q-text-primary);
      line-height: 1.2;
    }

    .card-description {
      font-size: 0.75rem;
      color: var(--q-text-secondary);
      margin: 0;
      line-height: 1.3;
      flex-grow: 1;
    }

    .selection-indicator {
      position: absolute;
      top: -8px;
      right: -8px;
      background: white;
      border-radius: 50%;
      padding: 2px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
  }

  .empty-state {
    text-align: center;
    padding: 2rem;
    color: var(--q-text-secondary);

    .empty-text {
      margin: 1rem 0;
      font-size: 0.9rem;
    }
  }
}

// Dark mode adjustments
body.body--dark {
  .destination-card {
    &:hover {
      box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
    }

    &.selected {
      box-shadow: 0 2px 8px rgba(var(--q-primary-rgb), 0.3);
    }

    .selection-indicator {
      background: var(--q-dark);
    }
  }
}
</style>