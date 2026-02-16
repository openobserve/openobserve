<!--
  QuickFilterPanel - Right sidebar filters (matches design)
-->
<template>
  <div class="quick-filter-panel">
    <div class="tw:flex tw:items-center tw:justify-between tw:mb-6">
      <div class="tw:text-xs tw:font-bold tw:uppercase tw:tracking-widest tw:text-[var(--o2-text-secondary)]">
        Quick Filter
      </div>
      <button
        class="tw:text-[10px] tw:text-primary tw:uppercase tw:font-bold hover:tw:underline"
        @click="$emit('filter-reset')"
      >
        Clear All
      </button>
    </div>

    <div class="tw:space-y-8">
      <!-- Service Name Filter -->
      <div>
        <button
          class="tw:flex tw:items-center tw:justify-between tw:w-full tw:text-xs tw:font-bold tw:text-[var(--o2-text-primary)] tw:mb-4"
          @click="serviceExpanded = !serviceExpanded"
        >
          <span>Service Name</span>
          <q-icon
            :name="serviceExpanded ? 'expand_more' : 'chevron_right'"
            size="16px"
          />
        </button>
        <div v-if="serviceExpanded" class="tw:space-y-2.5 tw:pl-1">
          <label
            v-for="service in services"
            :key="service"
            class="tw:flex tw:items-center tw:text-[11px] tw:text-[var(--o2-text-secondary)] hover:tw:text-[var(--o2-text-primary)] tw:cursor-pointer tw:group"
          >
            <input
              type="checkbox"
              :checked="isServiceSelected(service)"
              @change="toggleService(service)"
              class="tw:w-3.5 tw:h-3.5 tw:rounded tw:border-slate-300 tw:bg-white tw:text-primary focus:tw:ring-primary tw:mr-2.5"
            />
            <span class="tw:flex-1 group-hover:tw:font-medium">{{ service }}</span>
            <span class="tw:text-slate-400 tw:font-mono">{{ getServiceCount(service) }}</span>
          </label>
        </div>
      </div>

      <!-- Errors Filter -->
      <div>
        <button
          class="tw:flex tw:items-center tw:justify-between tw:w-full tw:text-xs tw:font-bold tw:text-[var(--o2-text-primary)] tw:mb-4"
          @click="errorsExpanded = !errorsExpanded"
        >
          <span>Errors</span>
          <q-icon
            :name="errorsExpanded ? 'expand_more' : 'chevron_right'"
            size="16px"
          />
        </button>
        <div v-if="errorsExpanded" class="tw:space-y-2.5 tw:pl-1">
          <label class="tw:flex tw:items-center tw:text-[11px] tw:text-[var(--o2-text-secondary)] hover:tw:text-[var(--o2-text-primary)] tw:cursor-pointer tw:group">
            <input
              type="checkbox"
              :checked="errorOnly"
              @change="toggleErrorOnly"
              class="tw:w-3.5 tw:h-3.5 tw:rounded tw:border-slate-300 tw:bg-white tw:text-primary focus:tw:ring-primary tw:mr-2.5"
            />
            <span class="tw:flex-1 group-hover:tw:font-medium">True</span>
          </label>
          <label class="tw:flex tw:items-center tw:text-[11px] tw:text-[var(--o2-text-secondary)] hover:tw:text-[var(--o2-text-primary)] tw:cursor-pointer tw:group">
            <input
              type="checkbox"
              :checked="!errorOnly"
              @change="toggleErrorOnly"
              class="tw:w-3.5 tw:h-3.5 tw:rounded tw:border-slate-300 tw:bg-white tw:text-primary focus:tw:ring-primary tw:mr-2.5"
            />
            <span class="tw:flex-1 group-hover:tw:font-medium">False</span>
          </label>
        </div>
      </div>

      <!-- Span Count -->
      <div class="tw:pt-4 tw:border-t tw:border-[var(--o2-border)]">
        <div class="tw:text-[11px] tw:text-[var(--o2-text-secondary)]">
          Showing <span class="tw:font-bold tw:text-[var(--o2-text-primary)]">{{ spanCount }}</span> spans
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { type SpanFilter } from '@/types/traces/span.types';

interface Props {
  services: string[];
  activeFilters: SpanFilter;
  spanCount: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'filter-changed': [filter: Partial<SpanFilter>];
  'filter-reset': [];
}>();

// State
const serviceExpanded = ref(true);
const errorsExpanded = ref(true);
const selectedServices = ref<string[]>(props.activeFilters.services || []);
const errorOnly = ref(props.activeFilters.errorOnly || false);

// Methods
const isServiceSelected = (service: string): boolean => {
  return selectedServices.value.includes(service);
};

const toggleService = (service: string) => {
  const index = selectedServices.value.indexOf(service);
  if (index > -1) {
    selectedServices.value.splice(index, 1);
  } else {
    selectedServices.value.push(service);
  }
  emitFilterChange();
};

const toggleErrorOnly = () => {
  errorOnly.value = !errorOnly.value;
  emitFilterChange();
};

const getServiceCount = (service: string): string => {
  // Mock counts - would come from actual data
  const counts: Record<string, number> = {
    'frontend-app': 1400,
    'api-gateway': 3300,
    'order-service': 844,
    'inventory-service': 240,
  };
  return counts[service]?.toString() || '0';
};

const emitFilterChange = () => {
  emit('filter-changed', {
    services: selectedServices.value.length > 0 ? selectedServices.value : undefined,
    errorOnly: errorOnly.value,
  });
};
</script>

<style scoped lang="scss">
.quick-filter-panel {
  // Styles are inline with Tailwind
}
</style>
