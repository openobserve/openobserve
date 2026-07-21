<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck, SyntheticsLocation } from '@/types/synthetics'
import awsSvgUrl from '@/assets/images/ingestion/aws.svg'
import gcpSvgUrl from '@/assets/images/ingestion/gcp.svg'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OCheckboxGroup from '@/lib/forms/Checkbox/OCheckboxGroup.vue'
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue'

const props = defineProps<{ check: BrowserCheck; locations: SyntheticsLocation[] }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const { t } = useI18n()

function locationIcon(provider: string): string {
  const p = provider.toLowerCase()
  if (p === 'aws') return 'img:' + awsSvgUrl
  if (p === 'gcp') return 'img:' + gcpSvgUrl
  return 'location-on'
}

const selectedLocations = computed({
  get: () => props.check.locations,
  set: (v: (string | number)[]) =>
    emit('update:check', { ...props.check, locations: v.map(String) }),
})
</script>

<template>
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-primary-600" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t('synthetics.locations.title') }}
      </h3>
    </div>
    <div class="px-3 py-2">

    <OCheckboxGroup
      v-if="locations.length"
      v-model="selectedLocations"
      data-test="synthetics-check-locations-group"
    >
      <OCheckbox
        v-for="location in locations"
        :key="location.id"
        :value="location.id"
        :data-test="`synthetics-check-locations-option-${location.id}`"
        class="pb-2"
      >
        <template #label>
          <span class="flex items-center gap-1.5">
            <OIcon :name="locationIcon(location.provider)" size="sm" />
            {{ location.name }} · {{ location.region }}
          </span>
        </template>
      </OCheckbox>
    </OCheckboxGroup>

    <div
      v-else
      class="flex items-center justify-center rounded-default border border-dashed border-border-default px-3 py-3 text-sm text-text-muted"
      data-test="synthetics-check-locations-empty"
    >
      {{ t('synthetics.locations.empty') }}
    </div>
    </div>
  </div>
</template>
