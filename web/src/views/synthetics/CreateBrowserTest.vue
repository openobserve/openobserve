<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter, useRoute, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import type { BrowserCheck, SyntheticsLocation, SyntheticsDevice, SyntheticsFolder } from '@/types/synthetics'
import useSyntheticsRecorder from '@/composables/useSyntheticsRecorder'
import { journeyToWireSteps } from '@/utils/synthetics/mapRecordedStep'
import { buildCreateBrowserTestPayload, mapResponseToBrowserCheck } from '@/utils/synthetics/buildPayload'
import { makeBrowserCheckGateSchema, makeBrowserCheckSaveSchema } from '@/components/synthetics/CreateBrowserTest.schema'
import { getFoldersListByType } from '@/utils/commons'
import syntheticsService from '@/services/synthetics'
import destinationService from '@/services/alert_destination'
import { toast } from '@/lib/feedback/Toast/useToast'
import OPageLayout from '@/lib/core/PageLayout/OPageLayout.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import ODialog from '@/lib/overlay/Dialog/ODialog.vue'
import OStepper from '@/lib/navigation/Stepper/OStepper.vue'
import OStep from '@/lib/navigation/Stepper/OStep.vue'
import BrowserJourney from '@/components/synthetics/journey/BrowserJourney.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'
import CreateBrowserTestSkeleton from '@/components/synthetics/CreateBrowserTestSkeleton.vue'
import OEmptyState from '@/lib/core/EmptyState/OEmptyState.vue'
import EmptyBrowserCheck from '@/lib/core/EmptyState/illustrations/EmptyBrowserCheck.vue'

const router = useRouter()
const route = useRoute()
const store = useStore()
const { t } = useI18n()

// Computed literals to avoid `{{` template delimiter conflicts in Vue templates.
// The i18n message "Supports {variables} like {baseUrl}." uses these params to
// show literal "{{variables}}" and "{{baseUrl}}" as user-facing syntax examples.
const variablesHintParams = computed(() => ({
  variables: "{{variables}}",
  baseUrl: "{{baseUrl}}",
}))

// Chrome UI element names — must stay in English across all locales
// because they reference the actual Chrome browser interface.
const CHROME_UI_LABELS = {
  details: 'Details',
  allowIncognito: 'Allow in Incognito',
} as const

// Three top-level phases:
//   gate            → URL + name inputs
//   extension-setup → install extension checklist (only when extension not yet installed)
//   editor          → tabbed check editor
const phase = ref<'gate' | 'extension-setup' | 'editor'>('gate')
const headerTitle = computed(() => {
  if (phase.value === 'gate') return t('synthetics.createBrowserTest.newBrowserCheck')
  if (phase.value === 'extension-setup') return t('synthetics.createBrowserTest.setupRecorder')
  if (isLoadingEdit.value) return t('synthetics.createBrowserTest.loading')
  if (loadError.value) return t('synthetics.createBrowserTest.loadFailedTitle')
  return check.value.name || t('synthetics.createBrowserTest.untitledCheck')
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
const props = defineProps<{ editId?: string | null }>()
const isLoadingEdit = ref(false)
const loadError = ref(false)
const urlError = ref('')
const validationErrors = ref<Record<string, string>>({})

const gateSchema = computed(() => makeBrowserCheckGateSchema(t))
const saveSchema = computed(() => makeBrowserCheckSaveSchema(t))

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
    // Browser tests are Lambda-only today — private (agent-served) locations
    // cannot run them, so they are excluded from this picker.
    locations.value = ((data.locations ?? []) as SyntheticsLocation[]).filter(
      (l) => l.kind !== 'private' && l.enabled !== false,
    )
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
  loadError.value = false
  phase.value = 'editor'
  try {
    const org = store.state.selectedOrganization.identifier
    if (!org) {
      throw new Error('Organization not available')
    }
    const res = await syntheticsService.get(org, id)
    const mapped = mapResponseToBrowserCheck(res.data as Record<string, unknown>)
    check.value = mapped
    checkName.value = mapped.name
    startUrl.value = mapped.url
    journeyStepDone.value = true
  } catch (err) {
    console.error('[synthetics] failed to load check for edit', err)
    loadError.value = true
    toast({
      variant: 'error',
      message: t('synthetics.createBrowserTest.loadFailed'),
    })
  } finally {
    isLoadingEdit.value = false
  }
}

function onLoadRetry(actionId?: string) {
  if (!actionId) return;
  if (actionId === 'retry' && props.editId) {
    loadForEdit(props.editId)
  }
}

onMounted(() => {
  // Warm detection so an already-installed extension lets Record skip setup.
  probeExtension()
    .then((installed) => {
      if (installed) {
        extensionInstalled.value = true
        extensionReady.value = true
      }
    })
    .catch(() => { /* extension messaging unavailable — handled in setup screen */ })

  fetchFolders()
  fetchLocations()
  fetchDestinations()

  if (props.editId) {
    loadForEdit(props.editId).catch(console.error)
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

function validateGateUrl() {
  const result = gateSchema.value.shape.url.safeParse(startUrl.value.trim())
  urlError.value = result.success ? '' : (result.error.issues[0]?.message ?? '')
  return result.success
}

function clearUrlError() {
  urlError.value = ''
}

const isGateUrlValid = computed(() => {
  const trimmed = startUrl.value.trim()
  if (!trimmed) return false
  return gateSchema.value.shape.url.safeParse(trimmed).success
})

async function onRecordClick() {
  if (!validateGateUrl()) return
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
  if (!validateGateUrl()) return
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
  // ── Pre-save validation ───────────────────────────────────────────
  validationErrors.value = {}
  const toValidate = {
    name: check.value.name,
    url: check.value.url,
    locations: check.value.locations,
    journey: check.value.journey,
  }
  const result = saveSchema.value.safeParse(toValidate)
  if (!result.success) {
    const errors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.')
      if (!errors[path]) errors[path] = issue.message
    }
    validationErrors.value = errors
    // Switch to the relevant tab so inline errors are visible
    if (errors['name'] || errors['url'] || errors['locations']) {
      currentStep.value = 2
    } else if (Object.keys(errors).some((k) => k.startsWith('journey.'))) {
      // Step selector errors — switch to Journey tab and auto-expand
      currentStep.value = 1
      journeyRef.value?.validateStepSelectors?.()
    }
    toast({
      variant: 'error',
      message: t('synthetics.validation.fixHighlightedFields'),
    })
    return
  }

  isSaving.value = true
  validationErrors.value = {}
  const dismiss = toast({ variant: 'loading', message: t('synthetics.newCheck.saving'), timeout: 0 })
  try {
    const org = store.state.selectedOrganization.identifier
    if (props.editId) {
      await syntheticsService.update(org, props.editId, apiPayload.value, check.value.folder)
      dismiss()
      toast({ variant: 'success', message: t('synthetics.newCheck.updated') })
      isDirty.value = false
      router.push({ name: 'synthetics', query: { folder: check.value.folder } })
    } else {
      const res = await syntheticsService.create(org, apiPayload.value, check.value.folder)
      const savedId = res.data?.id ?? crypto.randomUUID()
      dismiss()
      toast({ variant: 'success', message: t('synthetics.newCheck.saved') })
      isDirty.value = false
      router.push({ name: 'synthetics', query: { folder: check.value.folder } })
    }
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || t('synthetics.newCheck.saveFailed'),
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

function onContinueToConfigure() {
  // Validate step selectors before allowing transition
  const valid = journeyRef.value?.validateStepSelectors?.() ?? true
  if (!valid) return
  journeyStepDone.value = true
  currentStep.value = 2
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
  // Update UI state immediately — the SW has already stopped the replay.
  // Don't wait for the replay promise to resolve (it may take seconds or
  // never arrive if the port was disconnected from window focus changes).
  recorder.replayPhase.value = 'stopped'
  recorder.isReplaying.value = false
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
  <OPageLayout
    class="bg-surface-base"
    :title="headerTitle"
    :subtitle="folderName"
    :back="{ label: t('synthetics.newCheck.back'), to: { name: 'synthetics' }, dataTest: 'synthetics-create-back-btn' }"
    bleed
  >

    <!-- ── Gate phase: URL + name ── -->
    <main v-if="phase === 'gate'" class="flex-1 flex flex-col items-center justify-center">
      <div class="max-w-[48rem] w-full mx-auto py-4 px-4">
        <div class="flex justify-center mb-6">
          <EmptyBrowserCheck :width="140" />
        </div>
        <p class="mb-8 pb-4 ">
          {{ t('synthetics.createBrowserTest.gateDescription') }}
        </p>

        <div class="mb-6">
          <label for="synthetics-start-url" class="mb-1 block">
            {{ t('synthetics.createBrowserTest.startingUrl') }} <span class="text-status-error-text">*</span>
          </label>
          <OInput
            id="synthetics-start-url"
            v-model="startUrl"
            :placeholder="t('synthetics.checkDetails.startingUrlPlaceholder')"
            :error="!!urlError"
            :error-message="urlError"
            data-test="synthetics-create-url-input"
            @update:model-value="clearUrlError"
            @blur="validateGateUrl"
          >
            <template #prefix>
              <OIcon name="link" size="sm" />
            </template>
          </OInput>
          <small class="mt-1 block">{{ t('synthetics.createBrowserTest.variablesHint', variablesHintParams) }}</small>
        </div>

        <div class="mb-8">
          <label for="synthetics-check-name" class="mb-1 block">{{ t('synthetics.checkDetails.name') }}</label>
          <OInput
            id="synthetics-check-name"
            v-model="checkName"
            :placeholder="t('synthetics.checkDetails.namePlaceholder')"
            data-test="synthetics-create-name-input"
          />
          <small class="mt-1 block">{{ t('synthetics.createBrowserTest.nameHint') }}</small>
        </div>

        <div class="flex gap-3 mb-6">
          <OButton
            variant="primary"
            :disabled="!isGateUrlValid"
            data-test="synthetics-create-record-btn"
            @click="onRecordClick"
          >
            <template #prefix>
              <OIcon name="smart-display" size="sm" />
            </template>
            {{ t('synthetics.journey.recordJourney') }}
          </OButton>
          <OButton
            variant="outline"
            :disabled="!isGateUrlValid"
            data-test="synthetics-create-build-btn"
            @click="buildManually"
          >
            <template #prefix>
              <OIcon name="edit" size="sm" />
            </template>
            {{ t('synthetics.createBrowserTest.buildManually') }}
          </OButton>
        </div>

        <small class="flex items-center gap-1">
          <OIcon name="bolt" size="sm" aria-hidden="true" />
          {{ t('synthetics.createBrowserTest.gateFooter') }}
        </small>
      </div>
    </main>

    <!-- ── Extension setup phase (only when extension not yet installed) ── -->
    <main v-else-if="phase === 'extension-setup'" class="flex-1 flex flex-col items-center justify-center">
      <div class="max-w-[48rem] w-full mx-auto py-4 px-4">
        <div class="flex justify-center mb-6">
          <div class="rounded-default border border-border-default bg-surface-base p-6 flex items-center justify-center">
            <OIcon name="open-in-browser" size="xl" class="text-primary-500" aria-hidden="true" />
          </div>
        </div>

        <p class="mb-8 text-left pb-4">
          {{ t('synthetics.createBrowserTest.setupDescription', { url: check.url }) }}
        </p>

        <div class="rounded-default border border-border-default divide-y divide-border-default mb-6">
          <!-- Step 1: Install the OpenObserve Recorder -->
          <div class="flex items-start gap-4 p-4">
            <span
            class="flex-shrink-0 w-7 h-7 rounded-full bg-primary-500 text-text-inverse flex items-center justify-center text-sm font-semibold"
            :class="extensionInstalled ? 'bg-[var(--color-status-success-text)]!': ''"
            >
              1
            </span>
            <div class="flex-1 min-w-0 flex justify-between">
              <div class="flex flex-col items-start">
                <h4 class="text-sm font-semibold text-text-heading m-0 pb-1">{{ t('synthetics.createBrowserTest.setupStep1Title') }}</h4>
                <p class="text-xs text-text-secondary m-0 mb-3">{{ t('synthetics.createBrowserTest.setupStep1Description') }}</p>
              </div>
              <OSwitch
                v-model="extensionInstalled"
                :label="t('synthetics.createBrowserTest.setupStep1Done')"
                data-test="synthetics-setup-installed-switch"
              />
            </div>
          </div>

          <!-- Step 2: Click the extension icon to activate -->
          <div class="flex items-start gap-4 p-4" :class="{ 'opacity-60': !extensionInstalled }">
            <span
              class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold"
              :class="extensionReady ? 'bg-[var(--color-status-success-text)]! text-text-inverse' : extensionInstalled ? 'bg-primary-500 text-text-inverse' : 'bg-surface-subtle text-text-muted'"
            >2</span>
            <div class="flex-1 min-w-0 flex justify-between">
              <div class="flex flex-col items-start">
                <h4 class="text-sm font-semibold text-text-heading m-0 mb-1">{{ t('synthetics.createBrowserTest.setupStep2Title') }}</h4>
                <p class="text-xs text-text-secondary m-0 mb-3">{{ t('synthetics.createBrowserTest.setupStep2Description') }}</p>
              </div>
              <div class="flex items-center gap-3 px-3">
                <OButton
                  v-if="!extensionReady"
                  variant="outline"
                  size="sm"
                  :loading="checkingExtension"
                  iconLeft="refresh"
                  :disabled="!extensionInstalled"
                  data-test="synthetics-setup-icon-check-btn"
                  @click="probeExtension"
                >
                  {{ t('synthetics.createBrowserTest.setupCheckAgain') }}
                </OButton>
                <span
                  v-else
                  class="text-sm font-medium text-status-success-text!"
                  data-test="synthetics-setup-ready-label"
                >{{ t('synthetics.createBrowserTest.setupReady') }}</span>
              </div>
            </div>
          </div>

          <!-- Step 3: Enable incognito mode -->
          <div class="flex items-start gap-4 p-4" :class="{ 'opacity-60': !extensionInstalled }">
            <span
              class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold"
              :class="extensionInstalled ? incognitoAllowed ? 'bg-[var(--color-status-success-text)]! text-text-inverse' : 'bg-primary-500 text-text-inverse' : 'bg-surface-subtle text-text-muted'"
            >3</span>
            <div class="flex-1 min-w-0 flex justify-between">
              <div class="flex flex-col items-start">
                <h4 class="text-sm font-semibold text-text-heading m-0 mb-1">{{ t('synthetics.createBrowserTest.setupStep3Title') }}</h4>
                <p class="text-xs text-text-secondary m-0 mb-3">{{ t('synthetics.createBrowserTest.setupStep3IncognitoHint', { details: CHROME_UI_LABELS.details, setting: CHROME_UI_LABELS.allowIncognito }) }}</p>
              </div>
              <OSwitch
                v-model="incognitoAllowed"
                :label="t('synthetics.createBrowserTest.setupIncognitoDone')"
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
          :disabled="!extensionInstalled || !extensionReady || !incognitoAllowed"
          data-test="synthetics-setup-open-record-btn"
          icon-left="smart-display"
          @click="onExtensionSetupRecord"
        >
          {{ t('synthetics.createBrowserTest.setupOpenRecord') }}
        </OButton>

        <div class="text-center">
          <OButton
            variant="ghost"
            size="sm"
            class="text-sm text-text-link underline"
            data-test="synthetics-setup-skip-link"
            @click="onExtensionSetupSkip"
          >
            {{ t('synthetics.createBrowserTest.setupSkip') }}
          </OButton>
        </div>
      </div>
    </main>

    <!-- ── Editor phase ── -->
    <template v-else>
      <CreateBrowserTestSkeleton v-if="isLoadingEdit" :rows="10" />
      <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center">
        <OEmptyState
          preset="load-error"
          size="block"
          data-test="synthetics-create-load-error"
          @action="onLoadRetry"
        />
      </div>
      <div v-else class="flex-1 flex flex-col min-h-0">
          <OStepper
            v-model="currentStep"
        :navigable="true"
        class="flex-1 overflow-y-auto min-h-0 my-2 h-full"
      >
        <OStep
          :name="1"
          :title="t('synthetics.createBrowserTest.stepJourney')"
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
          :title="t('synthetics.createBrowserTest.stepConfigure')"
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
            :validation-errors="validationErrors"
            class="w-full!"
            @refresh:destinations="fetchDestinations"
            @update:check="onConfigureUpdate"
          />
        </OStep>
      </OStepper>

      <!-- Sticky footer — tab-aware, always visible -->
      <div class="flex items-center px-3 py-2.5 gap-2 border-t border-border-default shrink-0 bg-surface-base">
        <!-- Journey step: Cancel | Selection actions (left) | Replay status + Continue (right) -->
        <template v-if="currentStep === 1">
          <!-- Selection actions — moved from BrowserJourney, kept on the left -->
          <template v-if="journeySelectionState.count > 0 && !journeySelectionState.isRecording">
            <span class="text-sm text-text-secondary whitespace-nowrap">{{ t('synthetics.journey.selectedCount', { count: journeySelectionState.count }) }}</span>
            <OButton
              variant="outline-destructive"
              size="sm"
              data-test="synthetics-journey-delete-selected-btn"
              @click="showBulkDeleteDialog = true"
            >
              <template #icon-left><OIcon name="delete" size="sm" /></template>
              {{ t('synthetics.journey.delete') }}
            </OButton>
          </template>
          <span class="flex-1" aria-hidden="true" />

          <OButton variant="ghost" size="sm" data-test="synthetics-create-cancel-btn" @click="router.push({ name: 'synthetics' })">
            {{ t('common.cancel') }}
          </OButton>
          <OButton variant="outline" size="sm" data-test="synthetics-create-continue-btn" @click="onContinueToConfigure">
            {{ t('synthetics.createBrowserTest.continue') }}
            <template #suffix><OIcon name="chevron-right" size="sm" /></template>
          </OButton>
          <OButton
            v-if="props.editId"
            variant="primary"
            size="sm"
            :loading="isSaving"
            data-test="synthetics-create-save-from-journey-btn"
            @click="saveCheck"
          >
            {{ t('synthetics.newCheck.updateCheck') }}
            <template #suffix><OIcon name="save" size="sm" /></template>
          </OButton>
        </template>

        <!-- Configure step: Cancel | Back + Save -->
        <template v-else-if="currentStep === 2">
          <span class="flex-1" aria-hidden="true" />
          <OButton variant="ghost" size="sm" data-test="synthetics-create-cancel-btn" @click="router.push({ name: 'synthetics' })">
            {{ t('common.cancel') }}
          </OButton>
          <OButton variant="outline" size="sm" data-test="synthetics-create-back-to-journey-btn" @click="currentStep = 1">
            <template #prefix><OIcon name="chevron-left" size="sm" /></template>
            {{ t('common.goBack') }}
          </OButton>
          <OButton variant="primary" size="sm" :loading="isSaving" data-test="synthetics-create-save-btn" @click="saveCheck">
            {{ props.editId ? t('synthetics.newCheck.updateCheck') : t('synthetics.newCheck.saveCheck') }}
            <template #suffix><OIcon name="save" size="sm" /></template>
          </OButton>
        </template>
      </div>

      <!-- Unsaved changes dialog (route leave) -->
      <ODialog
        v-model:open="showUnsavedDialog"
        size="sm"
        :title="t('synthetics.newCheck.unsavedTitle')"
        :primary-button-label="t('synthetics.newCheck.leave')"
        :secondary-button-label="t('synthetics.newCheck.stay')"
        data-test="synthetics-create-unsaved-dialog"
        @click:primary="onConfirmLeave"
        @click:secondary="showUnsavedDialog = false"
      >
        <p class="py-2">{{ t('synthetics.newCheck.unsavedBody') }}</p>
      </ODialog>

      <!-- Bulk delete confirmation dialog — moved from BrowserJourney -->
      <ODialog
        v-model:open="showBulkDeleteDialog"
        size="sm"
        :title="t('synthetics.journey.bulkDeleteStepsTitle')"
        :primary-button-label="t('synthetics.journey.delete')"
        :secondary-button-label="t('common.cancel')"
        primary-button-variant="destructive"
        data-test="synthetics-journey-bulk-delete-dialog"
        @click:primary="onDeleteSelected"
        @click:secondary="showBulkDeleteDialog = false"
      >
        <p class="py-2">
          {{ t('synthetics.journey.bulkDeleteStepsBody', { count: journeySelectionState.count }) }}
        </p>
      </ODialog>
    </div>
  </template>
  </OPageLayout>
</template>
