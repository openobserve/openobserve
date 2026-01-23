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
        <!-- Card Content -->
        <div class="card-content">
          <!-- Icon/Image -->
          <div class="card-icon">
            <img
              v-if="type.image"
              :src="type.image"
              :alt="type.name"
              class="destination-logo"
            />
            <q-icon
              v-else
              :name="getIconName(type.icon)"
              size="1.5rem"
            />
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
          <div
            v-if="selectedType === type.id"
            class="check-icon"
          >
            <q-icon name="check_circle" size="1.25rem" color="positive" />
          </div>
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
            <q-icon name="settings" size="1.5rem" />
          </div>
          <h3 data-test="destination-type-name" class="card-title">
            {{ t('alerts.customDestination') }}
          </h3>
          <p data-test="destination-type-description" class="card-description">
            {{ t('alerts.customDestinationDescription') }}
          </p>
          <div
            v-if="selectedType === 'custom'"
            class="check-icon"
          >
            <q-icon name="check_circle" size="1.25rem" color="positive" />
          </div>
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

<style scoped lang="scss">
.destination-selector {
  .selector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.75rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .destination-card {
    position: relative;
    padding: 1.25rem 0.75rem;
    border: 0.125rem solid #e0e0e0;
    border-radius: 0.75rem;
    background: #ffffff;
    cursor: pointer;
    transition: all 0.3s ease;
    min-height: 7.5rem;
    display: flex;
    flex-direction: column;

    &:hover {
      transform: translateY(-0.125rem);
      box-shadow: 0 0.25rem 0.75rem rgba(25, 118, 210, 0.15);
      border-color: #1976d2;
    }

    &.selected {
      border-color: #1976d2;
      background: linear-gradient(135deg, #e3f2fd 0%, #ffffff 100%);
      box-shadow: 0 0.25rem 1rem rgba(25, 118, 210, 0.2);

      .card-icon {
        color: #1976d2;
      }
    }

    &.custom-card {
      border-style: dashed;
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
      margin-bottom: 0.5rem;
      color: #666;

      .destination-logo {
        width: 1.5rem;
        height: 1.5rem;
        object-fit: contain;
      }
    }

    .card-title {
      font-size: 0.8125rem;
      font-weight: 500;
      margin: 0.25rem 0 0 0;
      color: var(--q-text-primary);
      line-height: 1.3;
      text-align: center;
    }

    .card-description {
      font-size: 0.6875rem;
      color: var(--q-text-secondary);
      margin: 0.25rem 0 0 0;
      line-height: 1.2;
      flex-grow: 1;
      text-align: center;
      display: none; // Hide description to save space

      @media (min-width: 75rem) {
        display: block; // Show on larger screens
      }
    }

    .check-icon {
      position: absolute;
      bottom: 0.5rem;
      right: 0.5rem;
    }
  }
}

// Dark mode adjustments
body.body--dark {
  .destination-card {
    background: #1e1e1e;
    border-color: #424242;

    &:hover {
      box-shadow: 0 0.25rem 0.75rem rgba(25, 118, 210, 0.3);
      border-color: #1976d2;
    }

    &.selected {
      border-color: #1976d2;
      background: linear-gradient(135deg, rgba(25, 118, 210, 0.2) 0%, #1e1e1e 100%);
      box-shadow: 0 0.25rem 1rem rgba(25, 118, 210, 0.3);
    }
  }
}
</style>