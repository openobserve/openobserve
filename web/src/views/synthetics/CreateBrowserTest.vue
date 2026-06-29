<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useStore } from 'vuex'
import type { BrowserCheck, SyntheticsLocation, SyntheticsFolder } from '@/types/synthetics'
import useSyntheticsRecorder from '@/composables/useSyntheticsRecorder'
import { journeyToWireSteps } from '@/utils/synthetics/mapRecordedStep'
import { buildCreateBrowserTestPayload, mapResponseToBrowserCheck } from '@/utils/synthetics/buildPayload'
import { getFoldersListByType } from '@/utils/commons'
import syntheticsService from '@/services/synthetics'
import destinationService from '@/services/alert_destination'
import { toast } from '@/lib/feedback/Toast/useToast'
import AppPageHeader from '@/components/common/AppPageHeader.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OStepper from '@/lib/navigation/Stepper/OStepper.vue'
import OStep from '@/lib/navigation/Stepper/OStep.vue'
import BrowserJourney from '@/components/synthetics/journey/BrowserJourney.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'
import EmptyBrowserCheck from '@/lib/core/EmptyState/illustrations/EmptyBrowserCheck.vue'

const router = useRouter()
const route = useRoute()
const store = useStore()

// Three top-level phases:
//   gate            → URL + name inputs
//   extension-setup → install extension checklist (only when extension not yet installed)
//   editor          → tabbed check editor
const phase = ref<'gate' | 'extension-setup' | 'editor'>('gate')
const currentStep = ref(1)
const journeyStepDone = ref(false)
const checkName = ref('')
const startUrl = ref('')
const editId = ref<string | null>(null)
const isLoadingEdit = ref(false)

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

// Server-driven lists fetched once here and threaded down to CheckConfigure.
const locations = ref<SyntheticsLocation[]>([])
const destinations = ref<string[]>([])
const folders = ref<SyntheticsFolder[]>([])

async function fetchFolders() {
  try {
    const res = await getFoldersListByType(store, 'synthetics')
    folders.value = (res ?? []) as SyntheticsFolder[]
  } catch {
    folders.value = []
  }
}

async function fetchLocations() {
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.getLocations(org)
    locations.value = (res.data ?? []) as SyntheticsLocation[]
  } catch {
    // Enterprise-gated endpoint — community builds return 403; fall back to empty.
    locations.value = []
  }
}

async function fetchDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: store.state.selectedOrganization.identifier,
      page_num: 1,
      page_size: 1000,
      sort_by: 'name',
      desc: false,
    })
    destinations.value = (res.data ?? []).map((d: any) => d.name as string)
  } catch {
    destinations.value = []
  }
}

async function loadForEdit(id: string) {
  isLoadingEdit.value = true
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.get(org, id)
    const mapped = mapResponseToBrowserCheck(res.data as Record<string, unknown>)
    check.value = mapped
    checkName.value = mapped.name
    startUrl.value = mapped.url
    editId.value = id
    journeyStepDone.value = true
    phase.value = 'editor'
  } catch (err) {
    console.error('[synthetics] failed to load check for edit', err)
  } finally {
    isLoadingEdit.value = false
  }
}

onMounted(() => {
  // Warm detection so an already-installed extension lets Record skip setup.
  probeExtension()
    .then((installed) => { extensionReady.value = installed })
    .catch(() => { /* extension messaging unavailable — handled in setup screen */ })

  fetchFolders()
  fetchLocations()
  fetchDestinations()

  const editQueryId = route.query.edit
  if (typeof editQueryId === 'string' && editQueryId) {
    loadForEdit(editQueryId).catch(console.error)
  } else {
    // Preselect the folder the user came from (New Monitor within a folder).
    const folderQuery = route.query.folder
    if (typeof folderQuery === 'string' && folderQuery) {
      check.value = { ...check.value, folder: folderQuery }
    }
  }
})

// When true, BrowserJourney starts recording immediately on mount
const autoRecord = ref(false)

const check = ref<BrowserCheck>({
  name: '',
  url: '',
  enabled: true,
  folder: 'default',
  tags: [],
  journey: [],
  schedule: { type: 'interval', intervalValue: 5, intervalUnit: 'minutes' },
  locations: ['aws-us-east-1'],
  retries: 0,
  waitBeforeRetrySecs: 5,
  alertIfFails: 1,
  cooldownMins: 5,
  notifications: { destinations: [] },
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

const isSaving = ref(false)
const apiPayload = computed(() => buildCreateBrowserTestPayload(check.value))

async function saveCheck() {
  isSaving.value = true
  const dismiss = toast({ variant: 'loading', message: 'Saving check…', timeout: 0 })
  try {
    const org = store.state.selectedOrganization.identifier
    if (editId.value) {
      await syntheticsService.update(org, editId.value, apiPayload.value, check.value.folder)
      dismiss()
      toast({ variant: 'success', message: 'Check updated successfully.' })
      router.push({ name: 'synthetic', query: { folder: check.value.folder } })
    } else {
      const res = await syntheticsService.create(org, apiPayload.value, check.value.folder)
      const savedId = res.data?.id ?? crypto.randomUUID()
      dismiss()
      toast({ variant: 'success', message: 'Check saved successfully.' })
      router.push({ name: 'synthetic', query: { folder: check.value.folder } })
    }
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || 'Failed to save check.',
    })
    console.error('[synthetics] save failed', err)
  } finally {
    isSaving.value = false
  }
}

// ── Replay ──────────────────────────────────────────────────────────────────
const isReplaying = recorder.isReplaying
const replayResult = recorder.replayResult
const skippedSteps = ref(0)

function onReplay() {
  const steps = journeyToWireSteps(check.value.journey)
  skippedSteps.value = check.value.journey.length - steps.length
  if (steps.length === 0) return
  recorder.replay(steps, check.value.url).catch((err) => {
    recorder.error.value = err instanceof Error ? err.message : String(err)
  })
}

function onStopReplay() {
  recorder.stopReplay()
}

// Inline footer status reflecting the overall replay outcome.
const replayStatus = computed<{ text: string; tone: 'muted' | 'success' | 'error' } | null>(() => {
  if (isReplaying.value) return { text: 'Replaying…', tone: 'muted' }
  const r = replayResult.value
  if (!r) return null
  if (r.stopped) return { text: 'Replay stopped', tone: 'muted' }
  if (r.passed) return { text: 'Replay passed', tone: 'success' }
  return { text: `Replay failed: ${r.error ?? 'a step did not pass'}`, tone: 'error' }
})
</script>

<template>
  <!-- ── Edit mode loading ── -->
  <main
    v-if="isLoadingEdit"
    class="tw:min-h-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-body-primary-bg)]"
  >
    <div class="tw:flex tw:flex-col tw:items-center tw:gap-3">
      <OIcon name="hourglass-empty" size="lg" class="tw:text-[var(--o2-primary-color)] tw:animate-spin" />
      <p class="tw:text-[var(--o2-text-secondary)]">Loading check…</p>
    </div>
  </main>

  <!-- ── Gate phase: URL + name ── -->
  <main v-else-if="phase === 'gate'" class="tw:min-h-full tw:flex tw:flex-col tw:items-center tw:justify-center tw:bg-[var(--o2-body-primary-bg)]">
    <div class="tw:max-w-[48rem] tw:w-full tw:mx-auto tw:py-4 tw:px-4">
      <div class="tw:flex tw:justify-center tw:mb-6">
        <EmptyBrowserCheck :width="140" />
      </div>
      <h1 class="tw:mb-3 tw:pb-4 tw:text-center">New browser check</h1>
      <p class="tw:mb-8 tw:pb-4 ">
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
            <OIcon name="smart-display" size="sm" />
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
  <main v-else-if="phase === 'extension-setup'" class="tw:min-h-full tw:flex tw:flex-col tw:items-center tw:justify-center tw:bg-[var(--o2-body-primary-bg)]">
    <div class="tw:max-w-[48rem] tw:w-full tw:mx-auto tw:py-4 tw:px-4">
      <div class="tw:flex tw:justify-center tw:mb-6">
        <div class="tw:rounded-2xl tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:flex tw:items-center tw:justify-center">
          <OIcon name="open-in-browser" size="xl" class="tw:text-[var(--o2-primary-color)]" aria-hidden="true" />
        </div>
      </div>

      <h1 class="tw:mb-3 tw:text-center tw:pb-4">Set up the recorder</h1>
      <p class="tw:mb-8 tw:text-left tw:pb-4">
        We'll open <strong>{{ check.url }}</strong> in a fresh incognito tab and capture your clicks and inputs — <strong>no code</strong>.
      </p>

      <div class="tw:rounded-xl tw:border tw:border-[var(--o2-border-color)] tw:divide-y tw:divide-[var(--o2-border-color)] tw:mb-6">
        <!-- Step 1 -->
        <div class="tw:flex tw:items-start tw:gap-4 tw:p-4">
          <span 
          class="tw:flex-shrink-0 tw:w-7 tw:h-7 tw:rounded-full tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)] tw:flex tw:items-center tw:justify-center tw:text-sm tw:font-semibold" 
          :class="extensionInstalled ? 'tw:bg-[var(--o2-status-success-text)]!': ''"
          >
            1
          </span>
          <div class="tw:flex-1 tw:min-w-0 tw:flex tw:justify-between">
            <div class="tw:flex tw:flex-col tw:items-start">
              <h4 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0 tw:pb-1">Install the OpenObserve Recorder</h4>
              <p class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:m-0 tw:mb-3">A lightweight Chrome extension that captures your actions.</p>
            </div>
            <div class="tw:flex tw:items-center tw:gap-3 tw:px-3">
              <!-- <a
                href="https://openobserve.ai/docs/synthetics/recorder/"
                target="_blank"
                rel="noopener noreferrer"
                class="tw:text-sm tw:text-[var(--o2-text-link)] tw:underline"
                data-test="synthetics-setup-install-link"
              >              
                <OButton
                  v-if="!extensionInstalled"
                  variant="outline"
                  size="sm"
                  :loading="checkingExtension"
                  iconLeft="download"
                  data-test="synthetics-setup-recheck-btn"
                  @click="probeExtension"
                >
                  Add to Chrome
                </OButton>
              </a> -->
              <OButton
                v-if="!extensionInstalled"
                variant="outline"
                size="sm"
                :loading="checkingExtension"
                iconLeft="refresh"
                data-test="synthetics-setup-recheck-btn"
                @click="probeExtension"
              >
                Check again
              </OButton>
              <span
                v-else
                class="tw:text-sm tw:font-medium tw:text-[var(--o2-status-success-text)]!"
                data-test="synthetics-setup-installed-label"
              >Installed ✓</span>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div class="tw:flex tw:items-start tw:gap-4 tw:p-4" :class="{ 'tw:opacity-60': !extensionInstalled }">
          <span
            class="tw:flex-shrink-0 tw:w-7 tw:h-7 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:text-sm tw:font-semibold"
            :class="extensionInstalled ? incognitoAllowed ? 'tw:bg-[var(--o2-status-success-text)]! tw:text-[var(--o2-text-inverse)]' : 'tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)]' : 'tw:bg-[var(--o2-bg-subtle)] tw:text-[var(--o2-text-muted)]'"
          >2</span>
          <div class="tw:flex-1 tw:min-w-0 tw:flex tw:justify-between">
            <div class="tw:flex tw:flex-col tw:items-start">
              <h4 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0 tw:mb-1">Allow it in Incognito</h4>
              <p class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:m-0 tw:mb-3">Open <code>chrome://extensions</code> → Details → enable Allow in Incognito.</p>
            </div>
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
        icon-left="smart-display"
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
        class="tw:shrin-0 tw:px-4 tw:border-b tw:border-border-default"
      />

    <OStepper
      v-model="currentStep"
      :navigable="true"
      class="tw:flex-1 tw:overflow-y-auto tw:min-h-0 tw:p-2 tw:h-full"
    >
      <OStep
        :name="1"
        title="Journey"
        icon="stacked-line-chart"
        :done="journeyStepDone"
        class="tw:h-full!"
      >
        <BrowserJourney
          v-model="check.journey"
          :start-url="check.url"
          :extension-ready="extensionReady"
          :auto-record="autoRecord"
          :is-replaying="isReplaying"
          class="tw:h-full! tw:border-t! tw:border-border-default!"
          @need-extension-setup="onNeedExtensionSetup"
          @replay="onReplay"
          @stop-replay="onStopReplay"
          @auto-record-consumed="autoRecord = false"
        />
      </OStep>
      <OStep
        :name="2"
        title="Configure"
        icon="tune"
        :done="false"
      >
        <CheckConfigure
          v-model:check="check"
          check-type="browser"
          :locations="locations"
          :destinations="destinations"
          :folders="folders"
          class="tw:border-t! tw:border-border-default! tw:w-full!"
          @refresh:destinations="fetchDestinations"
        />
      </OStep>
    </OStepper>

    <!-- Sticky footer — tab-aware, always visible -->
    <div class="tw:flex tw:items-center tw:justify-end tw:px-3 tw:py-2.5 tw:gap-2 tw:border-t tw:border-[var(--o2-border-color)] tw:shrink-0 tw:bg-[var(--o2-body-primary-bg)]">
      <!-- Journey step: Cancel | Replay status + Continue -->
      <template v-if="currentStep === 1">
        <OButton variant="ghost" size="sm" data-test="synthetics-create-cancel-btn" @click="router.push({ name: 'synthetic' })">
          Cancel
        </OButton>
        <span
          v-if="replayStatus"
          class="tw:mr-auto tw:text-xs tw:flex tw:items-center tw:gap-2"
          role="status"
          data-test="synthetics-create-replay-status"
        >
          <span
            :class="{
              'tw:text-[var(--o2-text-muted)]': replayStatus.tone === 'muted',
              'tw:text-[var(--o2-status-success)]': replayStatus.tone === 'success',
              'tw:text-[var(--o2-status-error)]': replayStatus.tone === 'error',
            }"
          >{{ replayStatus.text }}</span>
          <span v-if="skippedSteps > 0" class="tw:text-[var(--o2-text-muted)]">
            ({{ skippedSteps }} step{{ skippedSteps === 1 ? '' : 's' }} skipped)
          </span>
        </span>

        <OButton variant="primary" size="sm" data-test="synthetics-create-continue-btn" @click="journeyStepDone = true; currentStep = 2">
          Continue
          <template #suffix><OIcon name="chevron-right" size="sm" /></template>
        </OButton>
      </template>

      <!-- Configure step: Cancel | Back + Save -->
      <template v-else-if="currentStep === 2">
        <OButton variant="ghost" size="sm" data-test="synthetics-create-cancel-btn" @click="router.push({ name: 'synthetic' })">
          Cancel
        </OButton>
        <OButton variant="outline" size="sm" data-test="synthetics-create-back-to-journey-btn" @click="currentStep = 1">
          <template #prefix><OIcon name="chevron-left" size="sm" /></template>
          Back
        </OButton>
        <OButton variant="primary" size="sm" :loading="isSaving" data-test="synthetics-create-save-btn" @click="saveCheck">
          {{ editId ? 'Update check' : 'Save check' }}
          <template #suffix><OIcon name="save" size="sm" /></template>
        </OButton>
      </template>
    </div>
  </div>
</template>
