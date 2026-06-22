<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import type { BrowserCheck, BrowserStep } from '@/types/synthetics'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import BrowserJourney from '@/components/synthetics/journey/BrowserJourney.vue'
import RecordJourney from '@/components/synthetics/journey/RecordJourney.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'

const router = useRouter()

const phase = ref<'gate' | 'editor'>('gate')
const activeTab = ref<'journey' | 'configure' | 'results'>('journey')
const showRecorder = ref(false)
const checkName = ref('')
const startUrl = ref('')

const check = ref<BrowserCheck>({
  id: '',
  name: '',
  url: '',
  enabled: true,
  folder: 'default',
  tags: [],
  journey: [],
  schedule: { type: 'interval', intervalValue: 5, intervalUnit: 'minutes', retries: 0 },
  locations: ['us-east-1'],
  notifications: { destinations: [], silenceMinutes: 60 },
  rum: { collect: true, sessionReplay: false },
})

function startRecording() {
  check.value = { ...check.value, url: startUrl.value, name: checkName.value }
  phase.value = 'editor'
  showRecorder.value = true
}

function buildManually() {
  check.value = { ...check.value, url: startUrl.value, name: checkName.value }
  phase.value = 'editor'
  activeTab.value = 'journey'
}

function onRecordDone(capturedSteps: BrowserStep[]) {
  check.value = { ...check.value, journey: capturedSteps }
  showRecorder.value = false
  activeTab.value = 'journey'
}

function saveCheck() {
  const id = crypto.randomUUID()
  router.push({ name: 'synthetic-detail', params: { id }, query: { tab: 'results', saved: '1' } })
}
</script>

<template>
  <!-- Gate phase -->
  <main v-if="phase === 'gate'" class="tw:min-h-screen tw:flex tw:flex-col tw:items-center tw:justify-center tw:bg-[var(--o2-body-primary-bg)]">
    <div class="tw:max-w-lg tw:w-full tw:mx-auto tw:py-16 tw:px-4">
      <h1 class="tw:mb-3">New browser check</h1>
      <p class="tw:mb-8">
        Tell us where to start — you'll record the journey next. Everything else (schedule, alerts, RUM) gets set up after.
      </p>

      <!-- Starting URL field -->
      <div class="tw:mb-6">
        <label for="synthetics-start-url" class="tw:mb-1 tw:block">
          Starting URL <span class="tw:text-[var(--o2-status-error-text)]">*</span>
        </label>
        <OInput
          id="synthetics-start-url"
          v-model="startUrl"
          placeholder="https://shop.example.com/"
          data-test="synthetics-create-url-input"
        >
          <template #prefix>
            <OIcon name="link" size="sm" />
          </template>
        </OInput>
        <small class="tw:mt-1 tw:block">Supports &#123;&#123;variables&#125;&#125; like &#123;&#123;baseUrl&#125;&#125;.</small>
      </div>

      <!-- Name field -->
      <div class="tw:mb-8">
        <label for="synthetics-check-name" class="tw:mb-1 tw:block">Name</label>
        <OInput
          id="synthetics-check-name"
          v-model="checkName"
          placeholder="Checkout Smoke Test"
          data-test="synthetics-create-name-input"
        />
        <small class="tw:mt-1 tw:block">Auto-filled from the page — edit if you like.</small>
      </div>

      <!-- Action buttons -->
      <div class="tw:flex tw:gap-3 tw:mb-6">
        <OButton
          variant="primary"
          data-test="synthetics-create-record-btn"
          @click="startRecording"
        >
          <template #prefix>
            <span class="material-icons-outlined tw:text-base tw:leading-none">fiber_manual_record</span>
          </template>
          Record journey
        </OButton>
        <OButton
          variant="outline"
          data-test="synthetics-create-build-btn"
          @click="buildManually"
        >
          <template #prefix>
            <span class="material-icons-outlined tw:text-base tw:leading-none">edit</span>
          </template>
          Build manually
        </OButton>
      </div>

      <!-- Footer hint -->
      <small class="tw:flex tw:items-center tw:gap-1">
        <span class="material-icons-outlined tw:text-base tw:leading-none">bolt</span>
        This is all we need to start. After recording you can replay it here, then save to configure schedule, alerts and more.
      </small>
    </div>
  </main>

  <!-- Editor phase -->
  <div v-else class="tw:flex tw:flex-col tw:min-h-screen tw:bg-[var(--o2-body-primary-bg)] tw:relative">
    <!-- Header row -->
    <header class="tw:flex tw:items-center tw:justify-between tw:px-6 tw:py-3 tw:border-b tw:border-[var(--o2-border-color)]">
      <div class="tw:flex tw:items-center tw:gap-3">
        <RouterLink :to="{ name: 'synthetic' }" class="tw:text-sm tw:text-[var(--o2-text-link)] tw:hover:text-[var(--o2-text-link-hover)] tw:flex tw:items-center tw:gap-1">
          ← Back to checks
        </RouterLink>
        <h2 class="tw:text-base tw:font-semibold">{{ check.name || 'Untitled check' }}</h2>
        <OBadge variant="warning">Draft — not saved</OBadge>
      </div>
      <div class="tw:flex tw:items-center tw:gap-2">
        <OButton variant="ghost" size="sm">
          <template #prefix>
            <span class="material-icons-outlined tw:text-base tw:leading-none">replay</span>
          </template>
          Replay
        </OButton>
        <OButton variant="primary" size="sm" @click="saveCheck">
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
      <OTab name="results" label="Results" :disable="true">
        <template #default>
          <span class="tw:flex tw:items-center tw:gap-1">
            <span class="material-icons-outlined tw:text-base tw:leading-none">bar_chart</span>
            Results
            <OBadge variant="default" size="sm">After save</OBadge>
          </span>
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
        <div class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-64 tw:gap-3 tw:text-[var(--o2-text-muted)]">
          <span class="material-icons-outlined tw:text-4xl">lock</span>
          <p>Save the check to see results here.</p>
        </div>
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
