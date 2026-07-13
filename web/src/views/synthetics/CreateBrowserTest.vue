<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter, useRoute, onBeforeRouteLeave } from 'vue-router'
import { useStore } from 'vuex'
import type { BrowserCheck, SyntheticsLocation, SyntheticsDevice, SyntheticsFolder } from '@/types/synthetics'
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
import ODialog from '@/lib/overlay/Dialog/ODialog.vue'
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
const headerTitle = computed(() => {
  if (phase.value === 'gate') return 'New browser check'
  if (phase.value === 'extension-setup') return 'Set up the recorder'
  return check.value.name || 'Untitled check'
})
const folderName = computed(() => {
  const fid = check.value.folder
  if (!fid || fid === 'default') return ''
  return folders.value.find((f) => f.folderId === fid)?.name ?? ''
})
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
const browsers = ref<string[]>([])
const devices = ref<SyntheticsDevice[]>([])
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
    const data = res.data ?? {}
    locations.value = (data.locations ?? []) as SyntheticsLocation[]
    browsers.value = (data.browsers ?? []) as string[]
    devices.value = (data.devices ?? []) as SyntheticsDevice[]
  } catch {
    // Enterprise-gated endpoint — community builds return 403; fall back to empty.
    locations.value = []
    browsers.value = []
    devices.value = []
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
  locations: [],
  retries: 0,
  waitBeforeRetrySecs: 5,
  alertIfFails: 1,
  cooldownMins: 5,
  notifications: { destinations: [] },
  rum: { collect: true, sessionReplay: false },
  capture: { screenshot: 'on-fail' as const, trace: 'on-fail' as const },
  variables: [],
})

function commitGate() {
  check.value = { ...check.value, url: startUrl.value, name: checkName.value }
  isDirty.value = true
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

// ── Unsaved changes guard ───────────────────────────────────────────────────
const isDirty = ref(false)
const showUnsavedDialog = ref(false)
let pendingLeavePath: string | null = null
let forceLeave = false

watch(() => check.value.journey.length, (len) => {
  if (len > 0) isDirty.value = true
})

function onConfigureUpdate(val: BrowserCheck) {
  check.value = val
  isDirty.value = true
}

function stopActiveExtension() {
  const journey = journeyRef.value
  // BrowserJourney owns the recorder instance — check and stop via exposed methods
  if (journey?.stopActiveRecording()) {
    /* recording was stopped */
  }
  if (recorder.replayPhase.value === 'running') {
    recorder.stopReplayAndForget()
  }
}

function onConfirmLeave() {
  stopActiveExtension()
  showUnsavedDialog.value = false
  forceLeave = true
  if (pendingLeavePath) {
    router.push(pendingLeavePath)
    pendingLeavePath = null
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnloadHandler)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnloadHandler)
})

onBeforeRouteLeave((to, from, next) => {
  if (forceLeave) {
    forceLeave = false
    next()
    return
  }
  if (!isDirty.value) {
    next()
    return
  }
  // Cancel the route; show a Vue dialog instead
  next(false)
  pendingLeavePath = to.fullPath
  showUnsavedDialog.value = true
})

function beforeUnloadHandler(e: BeforeUnloadEvent) {
  if (!isDirty.value) return
  // Sync stop the extension before the page goes away
  stopActiveExtension()
  e.preventDefault()
}

async function saveCheck() {
  isSaving.value = true
  const dismiss = toast({ variant: 'loading', message: 'Saving check…', timeout: 0 })
  try {
    const org = store.state.selectedOrganization.identifier
    if (editId.value) {
      await syntheticsService.update(org, editId.value, apiPayload.value, check.value.folder)
      dismiss()
      toast({ variant: 'success', message: 'Check updated successfully.' })
      isDirty.value = false
      router.push({ name: 'synthetic', query: { folder: check.value.folder } })
    } else {
      const res = await syntheticsService.create(org, apiPayload.value, check.value.folder)
      const savedId = res.data?.id ?? crypto.randomUUID()
      dismiss()
      toast({ variant: 'success', message: 'Check saved successfully.' })
      isDirty.value = false
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

// ── Selection state (synced from BrowserJourney) ───────────────────────────
const journeyRef = ref<InstanceType<typeof BrowserJourney>>()
const journeySelectionState = ref({ count: 0, isRecording: false })
const showBulkDeleteDialog = ref(false)

function onDeleteSelected() {
  journeyRef.value?.deleteSelectedSteps()
  showBulkDeleteDialog.value = false
}

// ── Replay — uses the composable's phase-based state machine ────────────────
/** Local unwraps so the template can read these without `.value`. */
const replayPhase = computed(() => recorder.replayPhase.value)
const stepResults = computed(() => recorder.stepResults)
const activeStepId = computed(() => recorder.activeStepId.value)
const blockedReason = computed<'incognito' | null>(() =>
  recorder.replayPhase.value === 'idle' &&
  recorder.replayResult.value != null &&
  !recorder.replayResult.value.success &&
  !recorder.replayResult.value.stopped &&
  recorder.stepResults.size === 0
    ? 'incognito'
    : null
)

function onReplay() {
  const steps = journeyToWireSteps(check.value.journey)
  if (steps.length === 0) return
  recorder.replay(
    steps,
    check.value.url,
    check.value.variables,
    check.value.auth,
    check.value.headers,
    check.value.cookies,
  ).catch((err) => {
    recorder.error.value = err instanceof Error ? err.message : String(err)
  })
}

function onStopReplay() {
  recorder.stopReplay().catch(() => {})
}

function onClearResults() {
  // Reset replay state through the composable
  recorder.replayPhase.value = 'idle'
  recorder.replayResult.value = null
  recorder.stepResults.clear()
}
</script>

<template>
  <!-- ── Non-loading: shared wrapper with page header ── -->
  <div class="flex flex-col h-full bg-[var(--o2-body-primary-bg)]">
    <AppPageHeader
      :title="headerTitle"
      :subtitle="folderName"
      :back="{ label: 'Checks', to: { name: 'synthetic' }, dataTest: 'synthetics-create-back-btn' }"
      class="shrink-0 px-4 border-b border-border-default"
    />

    <main
      v-if="isLoadingEdit"
      class="min-h-full flex items-center justify-center bg-[var(--o2-body-primary-bg)]"
    >
      <div class="flex flex-col items-center gap-3">
        <OIcon name="hourglass-empty" size="lg" class="text-[var(--o2-primary-color)] animate-spin" />
        <p class="text-[var(--o2-text-secondary)]">Loading check…</p>
      </div>
    </main>
    <!-- ── Gate phase: URL + name ── -->
    <main v-else-if="phase === 'gate'" class="flex-1 flex flex-col items-center justify-center">
      <div class="max-w-[48rem] w-full mx-auto py-4 px-4">
        <div class="flex justify-center mb-6">
          <EmptyBrowserCheck :width="140" />
        </div>
        <p class="mb-8 pb-4 ">
          Tell us where to start — you'll record the journey next. Everything else (schedule, alerts, RUM) gets set up after.
        </p>

        <div class="mb-6">
          <label for="synthetics-start-url" class="mb-1 block">
            Starting URL <span class="text-[var(--o2-status-error-text)]">*</span>
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
          <small class="mt-1 block">Supports &#123;&#123;variables&#125;&#125; like &#123;&#123;baseUrl&#125;&#125;.</small>
        </div>

        <div class="mb-8">
          <label for="synthetics-check-name" class="mb-1 block">Name</label>
          <OInput
            id="synthetics-check-name"
            v-model="checkName"
            placeholder="Checkout Smoke Test"
            data-test="synthetics-create-name-input"
          />
          <small class="mt-1 block">Auto-filled from the page — edit if you like.</small>
        </div>

        <div class="flex gap-3 mb-6">
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

        <small class="flex items-center gap-1">
          <OIcon name="bolt" size="sm" aria-hidden="true" />
          This is all we need to start. After recording you can replay it here, then save to configure schedule, alerts and more.
        </small>
      </div>
    </main>

    <!-- ── Extension setup phase (only when extension not yet installed) ── -->
    <main v-else-if="phase === 'extension-setup'" class="flex-1 flex flex-col items-center justify-center">
      <div class="max-w-[48rem] w-full mx-auto py-4 px-4">
        <div class="flex justify-center mb-6">
          <div class="rounded-2xl border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] p-6 flex items-center justify-center">
            <OIcon name="open-in-browser" size="xl" class="text-[var(--o2-primary-color)]" aria-hidden="true" />
          </div>
        </div>

        <p class="mb-8 text-left pb-4">
          We'll open <strong>{{ check.url }}</strong> in a fresh incognito tab and capture your clicks and inputs — <strong>no code</strong>.
        </p>

        <div class="rounded-xl border border-[var(--o2-border-color)] divide-y divide-[var(--o2-border-color)] mb-6">
          <!-- Step 1 -->
          <div class="flex items-start gap-4 p-4">
            <span
            class="flex-shrink-0 w-7 h-7 rounded-full bg-[var(--o2-primary-color)] text-[var(--o2-text-inverse)] flex items-center justify-center text-sm font-semibold"
            :class="extensionInstalled ? 'bg-[var(--o2-status-success-text)]!': ''"
            >
              1
            </span>
            <div class="flex-1 min-w-0 flex justify-between">
              <div class="flex flex-col items-start">
                <h4 class="text-sm font-semibold text-[var(--o2-text-heading)] m-0 pb-1">Install the OpenObserve Recorder</h4>
                <p class="text-xs text-[var(--o2-text-secondary)] m-0 mb-3">A lightweight Chrome extension that captures your actions.</p>
              </div>
              <div class="flex items-center gap-3 px-3">
                <!-- <a
                  href="https://openobserve.ai/docs/synthetics/recorder/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-[var(--o2-text-link)] underline"
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
                  class="text-sm font-medium text-[var(--o2-status-success-text)]!"
                  data-test="synthetics-setup-installed-label"
                >Installed ✓</span>
              </div>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="flex items-start gap-4 p-4" :class="{ 'opacity-60': !extensionInstalled }">
            <span
              class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold"
              :class="extensionInstalled ? incognitoAllowed ? 'bg-[var(--o2-status-success-text)]! text-[var(--o2-text-inverse)]' : 'bg-[var(--o2-primary-color)] text-[var(--o2-text-inverse)]' : 'bg-[var(--o2-bg-subtle)] text-[var(--o2-text-muted)]'"
            >2</span>
            <div class="flex-1 min-w-0 flex justify-between">
              <div class="flex flex-col items-start">
                <h4 class="text-sm font-semibold text-[var(--o2-text-heading)] m-0 mb-1">Allow it in Incognito</h4>
                <p class="text-xs text-[var(--o2-text-secondary)] m-0 mb-3">Open <code>chrome://extensions</code> → Details → enable Allow in Incognito.</p>
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
          class="w-full mb-4"
          :disabled="!extensionInstalled || !incognitoAllowed"
          data-test="synthetics-setup-open-record-btn"
          icon-left="smart-display"
          @click="onExtensionSetupRecord"
        >
          Open &amp; Record
        </OButton>

        <div class="text-center">
          <button
            type="button"
            class="text-sm text-[var(--o2-text-link)] underline bg-transparent border-0 cursor-pointer p-0"
            data-test="synthetics-setup-skip-link"
            @click="onExtensionSetupSkip"
          >
            Skip — I'll build the steps manually
          </button>
        </div>
      </div>
    </main>

    <!-- ── Editor phase ── -->
    <template v-else>
      <OStepper
        v-model="currentStep"
        :navigable="true"
        class="flex-1 overflow-y-auto min-h-0 my-2 h-full"
      >
        <OStep
          :name="1"
          title="Journey"
          icon="stacked-line-chart"
          :done="journeyStepDone"
          class="h-full!"
        >
          <BrowserJourney
            ref="journeyRef"
            v-model="check.journey"
            :start-url="check.url"
            :extension-ready="extensionReady"
            :auto-record="autoRecord"
            :replay-phase="replayPhase"
            :step-results="stepResults"
            :active-step-id="activeStepId"
            :blocked-reason="blockedReason"
            class="h-full!"
            @need-extension-setup="onNeedExtensionSetup"
            @replay="onReplay"
            @stop-replay="onStopReplay"
            @clear-results="onClearResults"
            @auto-record-consumed="autoRecord = false"
            @selection-changed="journeySelectionState = $event"
          />
        </OStep>
        <OStep
          :name="2"
          title="Configure"
          icon="tune"
          :done="false"
        >
          <CheckConfigure
            :check="check"
            check-type="browser"
            :locations="locations"
            :browsers="browsers"
            :devices="devices"
            :destinations="destinations"
            :folders="folders"
            class="w-full!"
            @refresh:destinations="fetchDestinations"
            @update:check="onConfigureUpdate"
          />
        </OStep>
      </OStepper>

      <!-- Sticky footer — tab-aware, always visible -->
      <div class="flex items-center px-3 py-2.5 gap-2 border-t border-[var(--o2-border-color)] shrink-0 bg-[var(--o2-body-primary-bg)]">
        <!-- Journey step: Cancel | Selection actions (left) | Replay status + Continue (right) -->
        <template v-if="currentStep === 1">
          <!-- Selection actions — moved from BrowserJourney, kept on the left -->
          <template v-if="journeySelectionState.count > 0 && !journeySelectionState.isRecording">
            <span class="text-sm text-[var(--o2-text-secondary)] whitespace-nowrap">{{ journeySelectionState.count }} selected</span>
            <OButton
              variant="outline-destructive"
              size="sm"
              data-test="synthetics-journey-delete-selected-btn"
              @click="showBulkDeleteDialog = true"
            >
              <template #icon-left><OIcon name="delete" size="sm" /></template>
              Delete
            </OButton>
          </template>
          <span class="flex-1" aria-hidden="true" />

          <OButton variant="ghost" size="sm" data-test="synthetics-create-cancel-btn" @click="router.push({ name: 'synthetic' })">
            Cancel
          </OButton>
          <OButton variant="primary" size="sm" data-test="synthetics-create-continue-btn" @click="journeyStepDone = true; currentStep = 2">
            Continue
            <template #suffix><OIcon name="chevron-right" size="sm" /></template>
          </OButton>
        </template>

        <!-- Configure step: Cancel | Back + Save -->
        <template v-else-if="currentStep === 2">
          <span class="flex-1" aria-hidden="true" />
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

      <!-- Unsaved changes dialog (route leave) -->
      <ODialog
        v-model:open="showUnsavedDialog"
        size="sm"
        title="Unsaved changes"
        primary-button-label="Leave"
        secondary-button-label="Stay"
        data-test="synthetics-create-unsaved-dialog"
        @click:primary="onConfirmLeave"
        @click:secondary="showUnsavedDialog = false"
      >
        <p class="py-2">You have unsaved changes. Are you sure you want to leave?</p>
      </ODialog>

      <!-- Bulk delete confirmation dialog — moved from BrowserJourney -->
      <ODialog
        v-model:open="showBulkDeleteDialog"
        size="sm"
        title="Delete steps"
        primary-button-label="Delete"
        secondary-button-label="Cancel"
        primary-button-variant="destructive"
        data-test="synthetics-journey-bulk-delete-dialog"
        @click:primary="onDeleteSelected"
        @click:secondary="showBulkDeleteDialog = false"
      >
        <p class="py-2">
          Delete {{ journeySelectionState.count }} step{{ journeySelectionState.count !== 1 ? 's' : '' }}? This cannot be undone.
        </p>
      </ODialog>
    </template>
  </div>
</template>
