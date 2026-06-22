<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import type { BrowserCheck, BrowserStep } from '@/types/synthetics'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import BrowserJourney from '@/components/synthetics/journey/BrowserJourney.vue'
import RecordJourney from '@/components/synthetics/journey/RecordJourney.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'
import BrowserCheckResults from '@/components/synthetics/results/BrowserCheckResults.vue'

const route = useRoute()

const activeTab = ref<'journey' | 'configure' | 'results'>('journey')
const showRecorder = ref(false)
const showSavedBanner = ref(route.query.saved === '1')

onMounted(() => {
  const tabParam = route.query.tab
  if (tabParam === 'journey' || tabParam === 'configure' || tabParam === 'results') {
    activeTab.value = tabParam
  }
  if (showSavedBanner.value) {
    setTimeout(() => {
      showSavedBanner.value = false
    }, 4000)
  }
})

// Mock check data (in real app, fetch by route.params.id)
const check = ref<BrowserCheck>({
  id: route.params.id as string,
  name: 'Checkout Smoke Test',
  url: 'https://shop.example.com/checkout',
  enabled: true,
  folder: 'ecommerce',
  tags: ['checkout', 'smoke'],
  journey: [],
  schedule: { type: 'interval', intervalValue: 5, intervalUnit: 'minutes', retries: 1 },
  locations: ['us-east-1'],
  notifications: { destinations: [], silenceMinutes: 60 },
  rum: { collect: true, sessionReplay: false },
})

function onRecordDone(capturedSteps: BrowserStep[]) {
  check.value.journey = capturedSteps
  showRecorder.value = false
  activeTab.value = 'journey'
}

function saveCheck() {
  // In real app, call API
  showSavedBanner.value = true
  setTimeout(() => {
    showSavedBanner.value = false
  }, 4000)
}

</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-h-screen tw:bg-[var(--o2-body-primary-bg)] tw:relative">
    <!-- Saved banner -->
    <div
      v-if="showSavedBanner"
      class="tw:bg-[var(--o2-status-success-subtle)] tw:border-b tw:border-[var(--o2-border-color)] tw:px-6 tw:py-2 tw:flex tw:items-center tw:gap-2"
      data-test="synthetics-detail-saved-banner"
    >
      <OIcon name="check-circle" size="sm" />
      <span class="tw:text-sm tw:text-[var(--o2-text-body)]">Browser check saved successfully!</span>
      <button
        type="button"
        class="tw:ml-auto tw:text-[var(--o2-text-secondary)] tw:hover:text-[var(--o2-text-body)] tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-lg tw:leading-none"
        aria-label="Dismiss"
        @click="showSavedBanner = false"
      >
        ×
      </button>
    </div>

    <!-- Header row -->
    <header class="tw:flex tw:items-center tw:justify-between tw:px-6 tw:py-3 tw:border-b tw:border-[var(--o2-border-color)]">
      <div class="tw:flex tw:items-center tw:gap-3">
        <RouterLink :to="{ name: 'synthetic' }" class="tw:text-sm tw:text-[var(--o2-text-link)] tw:hover:text-[var(--o2-text-link-hover)] tw:flex tw:items-center tw:gap-1">
          ← Back to checks
        </RouterLink>
        <h2 class="tw:text-base tw:font-semibold">{{ check.name }}</h2>
        <OSwitch
          v-model="check.enabled"
          size="sm"
          data-test="synthetics-detail-enabled-switch"
        />
      </div>
      <div class="tw:flex tw:items-center tw:gap-2">
        <OButton variant="ghost" size="sm">
          <template #prefix>
            <span class="material-icons-outlined tw:text-base tw:leading-none">replay</span>
          </template>
          Replay
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          data-test="synthetics-detail-save-btn"
          @click="saveCheck"
        >
          Save check
          <template #suffix>
            <span class="material-icons-outlined tw:text-base tw:leading-none">save</span>
          </template>
        </OButton>
      </div>
    </header>

    <!-- Tab bar -->
    <OTabs v-model="activeTab" bordered class="tw:px-6 tw:bg-[var(--o2-card-bg)]">
      <OTab name="journey" label="Journey">
        <template #icon>
          <span class="material-icons-outlined tw:text-base tw:leading-none">stacked_line_chart</span>
        </template>
      </OTab>
      <OTab name="configure" label="Configure">
        <template #icon>
          <span class="material-icons-outlined tw:text-base tw:leading-none">tune</span>
        </template>
      </OTab>
      <OTab name="results" label="Results">
        <template #icon>
          <span class="material-icons-outlined tw:text-base tw:leading-none">bar_chart</span>
        </template>
      </OTab>
    </OTabs>

    <!-- Tab panels -->
    <OTabPanels :model-value="activeTab" class="tw:flex-1">
      <OTabPanel name="journey" class="tw:h-full">
        <BrowserJourney v-model="check.journey" @record="showRecorder = true" />
      </OTabPanel>
      <OTabPanel name="configure" class="tw:h-full">
        <CheckConfigure v-model:check="check" check-type="browser" />
      </OTabPanel>
      <OTabPanel name="results" class="tw:h-full">
        <BrowserCheckResults :check-id="check.id" />
      </OTabPanel>
    </OTabPanels>

    <!-- Record journey overlay -->
    <div
      v-if="showRecorder"
      class="tw:fixed tw:inset-0 tw:z-50 tw:bg-[var(--o2-body-primary-bg)]"
    >
      <RecordJourney
        :start-url="check.url"
        @done="onRecordDone"
        @skip="showRecorder = false"
      />
    </div>
  </div>
</template>
