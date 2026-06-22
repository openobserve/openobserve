<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { BrowserCheck } from '@/types/synthetics'
import useSyntheticsRecorder from '@/composables/useSyntheticsRecorder'
import AppPageHeader from '@/components/common/AppPageHeader.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import BrowserJourney from '@/components/synthetics/journey/BrowserJourney.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'

const router = useRouter()

// Three top-level phases:
//   gate            → URL + name inputs
//   extension-setup → install extension checklist (only when extension not yet installed)
//   editor          → tabbed check editor
const phase = ref<'gate' | 'extension-setup' | 'editor'>('gate')
const activeTab = ref<'journey' | 'configure' | 'results'>('journey')
const checkName = ref('')
const startUrl = ref('')

// Extension setup state — persists across phases in this session.
// `extensionInstalled` is now driven by a real runtime probe (not a manual click).
const recorder = useSyntheticsRecorder()
const extensionInstalled = ref(false)
const incognitoAllowed = ref(false)
const extensionReady = ref(false)
const checkingExtension = ref(false)

async function probeExtension() {
  checkingExtension.value = true
  try {
    extensionInstalled.value = await recorder.detectExtension()
  } finally {
    checkingExtension.value = false
  }
  return extensionInstalled.value
}

onMounted(() => {
  // Warm detection so an already-installed extension lets Record skip setup.
  probeExtension()
    .then((installed) => { extensionReady.value = installed })
    .catch(() => { /* extension messaging unavailable — handled in setup screen */ })
})

// When true, BrowserJourney starts recording immediately on mount
const autoRecord = ref(false)

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

function commitGate() {
  check.value = { ...check.value, url: startUrl.value, name: checkName.value }
}

async function onRecordClick() {
  commitGate()
  const installed = await probeExtension()
  extensionReady.value = installed
  if (installed) {
    autoRecord.value = true
    phase.value = 'editor'
  } else {
    phase.value = 'extension-setup'
  }
}

function buildManually() {
  commitGate()
  autoRecord.value = false
  phase.value = 'editor'
}

function onExtensionSetupRecord() {
  extensionReady.value = true
  autoRecord.value = true
  phase.value = 'editor'
}

function onExtensionSetupSkip() {
  autoRecord.value = false
  phase.value = 'editor'
}

// Called when BrowserJourney's Record button is clicked while in editor
// and extension isn't ready yet
function onNeedExtensionSetup() {
  phase.value = 'extension-setup'
}

function saveCheck() {
  const id = crypto.randomUUID()
  router.push({ name: 'synthetic-detail', params: { id }, query: { tab: 'results', saved: '1' } })
}
</script>

<template>
  <!-- ── Gate phase: URL + name ── -->
  <main v-if="phase === 'gate'" class="tw:min-h-screen tw:flex tw:flex-col tw:items-center tw:justify-center tw:bg-[var(--o2-body-primary-bg)]">
    <div class="tw:max-w-lg tw:w-full tw:mx-auto tw:py-16 tw:px-4">
      <h1 class="tw:mb-3">New browser check</h1>
      <p class="tw:mb-8">
        Tell us where to start — you'll record the journey next. Everything else (schedule, alerts, RUM) gets set up after.
      </p>

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

      <div class="tw:flex tw:gap-3 tw:mb-6">
        <OButton
          variant="primary"
          :disabled="!startUrl.trim()"
          data-test="synthetics-create-record-btn"
          @click="onRecordClick"
        >
          <template #prefix>
            <OIcon name="fiber-manual-record" size="sm" />
          </template>
          Record journey
        </OButton>
        <OButton
          variant="outline"
          :disabled="!startUrl.trim()"
          data-test="synthetics-create-build-btn"
          @click="buildManually"
        >
          <template #prefix>
            <OIcon name="edit" size="sm" />
          </template>
          Build manually
        </OButton>
      </div>

      <small class="tw:flex tw:items-center tw:gap-1">
        <OIcon name="bolt" size="sm" aria-hidden="true" />
        This is all we need to start. After recording you can replay it here, then save to configure schedule, alerts and more.
      </small>
    </div>
  </main>

  <!-- ── Extension setup phase (only when extension not yet installed) ── -->
  <main v-else-if="phase === 'extension-setup'" class="tw:min-h-screen tw:flex tw:flex-col tw:items-center tw:justify-center tw:bg-[var(--o2-body-primary-bg)]">
    <div class="tw:max-w-lg tw:w-full tw:mx-auto tw:py-16 tw:px-4">
      <div class="tw:flex tw:justify-center tw:mb-6">
        <div class="tw:rounded-2xl tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:flex tw:items-center tw:justify-center">
          <OIcon name="open-in-browser" size="xl" class="tw:text-[var(--o2-primary-color)]" aria-hidden="true" />
        </div>
      </div>

      <h1 class="tw:mb-3 tw:text-center">Set up the recorder</h1>
      <p class="tw:mb-8 tw:text-center">
        We'll open <strong>{{ check.url }}</strong> in a fresh incognito tab and capture your clicks and inputs — no code.
      </p>

      <div class="tw:rounded-xl tw:border tw:border-[var(--o2-border-color)] tw:divide-y tw:divide-[var(--o2-border-color)] tw:mb-6">
        <!-- Step 1 -->
        <div class="tw:flex tw:items-start tw:gap-4 tw:p-4">
          <span class="tw:flex-shrink-0 tw:w-7 tw:h-7 tw:rounded-full tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)] tw:flex tw:items-center tw:justify-center tw:text-sm tw:font-semibold">1</span>
          <div class="tw:flex-1 tw:min-w-0">
            <h4 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0 tw:mb-1">Install the OpenObserve Recorder</h4>
            <p class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:m-0 tw:mb-3">A lightweight Chrome extension that captures your actions.</p>
            <div class="tw:flex tw:items-center tw:gap-3">
              <a
                href="https://openobserve.ai/docs/synthetics/recorder/"
                target="_blank"
                rel="noopener noreferrer"
                class="tw:text-sm tw:text-[var(--o2-text-link)] tw:underline"
                data-test="synthetics-setup-install-link"
              >Add to Chrome</a>
              <OButton
                v-if="!extensionInstalled"
                variant="outline"
                size="sm"
                :loading="checkingExtension"
                data-test="synthetics-setup-recheck-btn"
                @click="probeExtension"
              >
                Check again
              </OButton>
              <span
                v-else
                class="tw:text-sm tw:font-medium tw:text-[var(--o2-status-success)]"
                data-test="synthetics-setup-installed-label"
              >Installed ✓</span>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div class="tw:flex tw:items-start tw:gap-4 tw:p-4" :class="{ 'tw:opacity-60': !extensionInstalled }">
          <span
            class="tw:flex-shrink-0 tw:w-7 tw:h-7 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:text-sm tw:font-semibold"
            :class="extensionInstalled ? 'tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)]' : 'tw:bg-[var(--o2-bg-subtle)] tw:text-[var(--o2-text-muted)]'"
          >2</span>
          <div class="tw:flex-1 tw:min-w-0">
            <h4 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0 tw:mb-1">Allow it in Incognito</h4>
            <p class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:m-0 tw:mb-3">Open <code>chrome://extensions</code> → Details → enable Allow in Incognito.</p>
            <OSwitch
              v-model="incognitoAllowed"
              label="Done"
              :disabled="!extensionInstalled"
              data-test="synthetics-setup-incognito-switch"
            />
          </div>
        </div>
      </div>

      <OButton
        variant="primary"
        size="lg"
        class="tw:w-full tw:mb-4"
        :disabled="!extensionInstalled || !incognitoAllowed"
        data-test="synthetics-setup-open-record-btn"
        @click="onExtensionSetupRecord"
      >
        Open &amp; Record
      </OButton>

      <div class="tw:text-center">
        <button
          type="button"
          class="tw:text-sm tw:text-[var(--o2-text-link)] tw:underline tw:bg-transparent tw:border-0 tw:cursor-pointer tw:p-0"
          data-test="synthetics-setup-skip-link"
          @click="onExtensionSetupSkip"
        >
          Skip — I'll build the steps manually
        </button>
      </div>
    </div>
  </main>

  <!-- ── Editor phase ── -->
  <div v-else class="tw:flex tw:flex-col tw:h-full tw:bg-[var(--o2-body-primary-bg)]">
    <AppPageHeader
      :title="check.name || 'Untitled check'"
      :back="{ label: 'Checks', to: { name: 'synthetic' }, dataTest: 'synthetics-create-back-btn' }"
    >
      <template #title-trail>
        <OBadge variant="warning">Draft — not saved</OBadge>
      </template>
    </AppPageHeader>

    <OTabs v-model="activeTab" bordered class="tw:px-2 tw:bg-[var(--o2-card-bg)]">
      <OTab name="journey" label="Journey">
        <template #icon><OIcon name="stacked-line-chart" size="sm" /></template>
      </OTab>
      <OTab name="configure" label="Configure">
        <template #icon><OIcon name="tune" size="sm" /></template>
      </OTab>
      <OTab name="results" label="Results" :disable="true">
        <template #default>
          <span class="tw:flex tw:items-center tw:gap-1">
            <OIcon name="bar-chart" size="sm" />
            Results
            <OBadge variant="default" size="sm">After save</OBadge>
          </span>
        </template>
      </OTab>
    </OTabs>

    <OTabPanels :model-value="activeTab" class="tw:flex-1 tw:overflow-y-auto tw:min-h-0">
      <OTabPanel name="journey" class="tw:h-full">
        <BrowserJourney
          v-model="check.journey"
          :start-url="check.url"
          :extension-ready="extensionReady"
          :auto-record="autoRecord"
          @need-extension-setup="onNeedExtensionSetup"
        />
      </OTabPanel>
      <OTabPanel name="configure" class="tw:h-full">
        <CheckConfigure v-model:check="check" check-type="browser" />
      </OTabPanel>
      <OTabPanel name="results" class="tw:h-full">
        <div class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-64 tw:gap-3 tw:text-[var(--o2-text-muted)]">
          <OIcon name="lock" size="xl" aria-hidden="true" />
          <p>Save the check to see results here.</p>
        </div>
      </OTabPanel>
    </OTabPanels>

    <!-- Sticky footer — tab-aware, always visible -->
    <div class="tw:flex tw:items-center tw:justify-end tw:px-3 tw:py-2.5 tw:gap-2 tw:border-t tw:border-[var(--o2-border-color)] tw:shrink-0 tw:bg-[var(--o2-body-primary-bg)]">
      <!-- Journey tab: Replay + Continue -->
      <template v-if="activeTab === 'journey'">
        <OButton variant="outline" size="sm" data-test="synthetics-create-replay-btn">
          <template #prefix><OIcon name="replay" size="sm" /></template>
          Replay
        </OButton>
        <OButton variant="primary" size="sm" data-test="synthetics-create-continue-btn" @click="activeTab = 'configure'">
          Continue
          <template #suffix><OIcon name="chevron-right" size="sm" /></template>
        </OButton>
      </template>

      <!-- Configure tab: Save check only -->
      <template v-else-if="activeTab === 'configure'">
        <OButton variant="primary" size="sm" data-test="synthetics-create-save-btn" @click="saveCheck">
          Save check
          <template #suffix><OIcon name="save" size="sm" /></template>
        </OButton>
      </template>
    </div>
  </div>
</template>
