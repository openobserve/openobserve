<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { ref, onMounted } from 'vue'
import { useStore } from 'vuex'
import type { BrowserCheck } from '@/types/synthetics'
import destinationService from '@/services/alert_destination'
import CheckDetails from './CheckDetails.vue'
import CheckScheduleAlert from './CheckScheduleAlert.vue'
import CheckLocations from './CheckLocations.vue'
import CheckRUM from './CheckRUM.vue'
import CheckAuthNetwork from './CheckAuthNetwork.vue'

const props = defineProps<{
  check: BrowserCheck
  checkType?: 'browser' | 'api'
}>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const store = useStore()
const destinations = ref<string[]>([])

async function fetchDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: store.state.selectedOrganization.identifier,
      page_num: 1,
      page_size: 1000,
      sort_by: 'name',
      desc: false,
    })
    destinations.value = (res.data?.list ?? []).map((d: any) => d.name as string)
  } catch {
    destinations.value = []
  }
}

onMounted(() => {
  fetchDestinations()
})

function handleUpdate(value: BrowserCheck) {
  emit('update:check', value)
}
</script>

<template>
  <div class="tw:w-full tw:max-w-[53.75rem] tw:px-6 tw:py-4">
    <CheckDetails
      :check="check"
      data-test="synthetics-check-configure-details"
      @update:check="handleUpdate"
    />
    <CheckScheduleAlert
      :check="check"
      :destinations="destinations"
      data-test="synthetics-check-configure-schedule-alert"
      @update:check="handleUpdate"
      @refresh:destinations="fetchDestinations"
    />
    <CheckLocations
      :check="check"
      data-test="synthetics-check-configure-locations"
      @update:check="handleUpdate"
    />
    <CheckRUM
      v-if="(checkType ?? 'browser') === 'browser'"
      :check="check"
      :check-type="checkType"
      data-test="synthetics-check-configure-rum"
      @update:check="handleUpdate"
    />
    <CheckAuthNetwork
      :check="check"
      data-test="synthetics-check-configure-auth-network"
      @update:check="handleUpdate"
    />
  </div>
</template>
