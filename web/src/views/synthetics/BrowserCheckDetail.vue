<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, onBeforeUnmount, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useStore } from 'vuex'
import type { BrowserCheck, SyntheticsLocation, SyntheticsDevice, SyntheticsFolder } from '@/types/synthetics'
import { buildCreateBrowserTestPayload, mapResponseToBrowserCheck } from '@/utils/synthetics/buildPayload'
import { getFoldersListByType } from '@/utils/commons'
import syntheticsService from '@/services/synthetics'
import destinationService from '@/services/alert_destination'
import { toast } from '@/lib/feedback/Toast/useToast'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import BrowserJourney from '@/components/synthetics/journey/BrowserJourney.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'
import BrowserCheckResults from '@/components/synthetics/results/BrowserCheckResults.vue'

const route = useRoute()
const router = useRouter()
const store = useStore()

const checkId = computed(() => String(route.params.id ?? ''))

const activeTab = ref<'journey' | 'configure' | 'results'>('journey')
const showSavedBanner = ref(route.query.saved === '1')
const isSaving = ref(false)
const isLoading = ref(true)

let bannerTimer: ReturnType<typeof setTimeout> | null = null

const dismissBanner = () => {
  showSavedBanner.value = false
  if (bannerTimer) clearTimeout(bannerTimer)
}

const scheduleBannerDismiss = () => {
  if (bannerTimer) clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => { showSavedBanner.value = false }, 4000)
}

onMounted(async () => {
  const tabParam = route.query.tab
  if (tabParam === 'journey' || tabParam === 'configure' || tabParam === 'results') {
    activeTab.value = tabParam
  }
  if (showSavedBanner.value) scheduleBannerDismiss()

  await Promise.all([fetchCheck(), fetchDestinations(), fetchLocations(), fetchFolders()])
})

onUnmounted(() => {
  if (bannerTimer) clearTimeout(bannerTimer)
})

// ── Remote data ───────────────────────────────────────────────────────────────

const journeyRef = ref<InstanceType<typeof BrowserJourney>>()

const check = ref<BrowserCheck>({
  id: checkId.value,
  name: '',
  url: '',
  enabled: true,
  tags: [],
  journey: [],
  schedule: { type: 'interval', intervalValue: 5, intervalUnit: 'minutes' },
  locations: [],
  notifications: { destinations: [] },
  rum: { collect: true, sessionReplay: false },
  capture: { screenshot: 'on-fail' as const, trace: 'on-fail' as const },
})

const locations = ref<SyntheticsLocation[]>([])
const browsers = ref<string[]>([])
const devices = ref<SyntheticsDevice[]>([])
const destinations = ref<string[]>([])
const folders = ref<SyntheticsFolder[]>([])

async function fetchCheck() {
  isLoading.value = true
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.get(org, checkId.value)
    check.value = mapResponseToBrowserCheck(res.data as Record<string, unknown>)
    initialCheckSnapshot = JSON.stringify(check.value)
  } catch (err) {
    console.error('[synthetics] failed to load check', err)
    toast({ variant: 'error', message: 'Failed to load monitor.' })
  } finally {
    isLoading.value = false
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

async function fetchLocations() {
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.getLocations(org)
    const data = res.data ?? {}
    locations.value = (data.locations ?? []) as SyntheticsLocation[]
    browsers.value = (data.browsers ?? []) as string[]
    devices.value = (data.devices ?? []) as SyntheticsDevice[]
  } catch {
    locations.value = []
    browsers.value = []
    devices.value = []
  }
}

async function fetchFolders() {
  try {
    const res = await getFoldersListByType(store, 'synthetics')
    folders.value = (res ?? []) as SyntheticsFolder[]
  } catch {
    folders.value = []
  }
}

// ── Unsaved changes guard ───────────────────────────────────────────────────
const isDirty = ref(false)
const showUnsavedDialog = ref(false)
let pendingLeavePath: string | null = null
let forceLeave = false
/** Snapshot used to compare for dirty detection — set after initial load. */
let initialCheckSnapshot: string | null = null

watch(check, () => {
  if (initialCheckSnapshot !== null && JSON.stringify(check.value) !== initialCheckSnapshot) {
    isDirty.value = true
  }
}, { deep: true })

function onConfigureUpdate(val: BrowserCheck) {
  check.value = val
  isDirty.value = true
}

function stopActiveExtension() {
  const journey = journeyRef.value
  if (journey?.stopActiveRecording()) {
    /* recording was stopped */
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
  next(false)
  pendingLeavePath = to.fullPath
  showUnsavedDialog.value = true
})

function beforeUnloadHandler(e: BeforeUnloadEvent) {
  if (!isDirty.value) return
  stopActiveExtension()
  e.preventDefault()
}

// ── State ─────────────────────────────────────────────────────────────────────

const enabled = computed({
  get: () => check.value.enabled,
  set: (val: boolean) => { check.value = { ...check.value, enabled: val } },
})

async function saveCheck() {
  isSaving.value = true
  const dismiss = toast({ variant: 'loading', message: 'Saving check…', timeout: 0 })
  try {
    const org = store.state.selectedOrganization.identifier
    const payload = buildCreateBrowserTestPayload(check.value)
    await syntheticsService.update(org, checkId.value, payload, check.value.folder)
    dismiss()
    toast({ variant: 'success', message: 'Check updated successfully.' })
    isDirty.value = false
    initialCheckSnapshot = JSON.stringify(check.value)
    showSavedBanner.value = true
    scheduleBannerDismiss()
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
</script>

<template>
  <div class="flex flex-col h-full bg-[var(--o2-body-primary-bg)]">
    <!-- Saved banner -->
    <div
      v-if="showSavedBanner"
      class="bg-[var(--o2-status-success-subtle)] border-b border-[var(--o2-border-color)] px-6 py-2 flex items-center gap-2"
      data-test="synthetics-detail-saved-banner"
    >
      <OIcon name="check-circle" size="sm" />
      <span class="text-sm text-[var(--o2-text-body)]">Browser check saved successfully!</span>
      <button
        type="button"
        class="ml-auto text-[var(--o2-text-secondary)] hover:text-[var(--o2-text-body)] bg-transparent border-0 cursor-pointer text-lg leading-none"
        aria-label="Dismiss"
        @click="dismissBanner"
      >
        ×
      </button>
    </div>

    <!-- Header row -->
    <header class="flex items-center gap-3 px-6 py-3 border-b border-[var(--o2-border-color)]">
      <RouterLink :to="{ name: 'synthetic' }" class="text-sm text-[var(--o2-text-link)] hover:text-[var(--o2-text-link-hover)] flex items-center gap-1">
        ← Back to checks
      </RouterLink>
      <h2 class="text-base font-semibold">{{ check.name || '…' }}</h2>
      <OSwitch
        v-model="enabled"
        size="sm"
        data-test="synthetics-detail-enabled-switch"
      />
    </header>

    <!-- Tab bar -->
    <OTabs v-model="activeTab" bordered class="px-6 bg-[var(--o2-card-bg)]">
      <OTab name="journey" label="Journey">
        <template #icon>
          <OIcon name="stacked-line-chart" size="sm" />
        </template>
      </OTab>
      <OTab name="configure" label="Configure">
        <template #icon>
          <OIcon name="tune" size="sm" />
        </template>
      </OTab>
      <OTab name="results" label="Results">
        <template #icon>
          <OIcon name="bar-chart" size="sm" />
        </template>
      </OTab>
    </OTabs>

    <!-- Tab panels -->
    <OTabPanels :model-value="activeTab" class="flex-1 overflow-y-auto min-h-0">
      <OTabPanel name="journey" class="h-full">
        <BrowserJourney
          ref="journeyRef"
          v-model="check.journey"
          :start-url="check.url"
          :extension-ready="true"
        />
      </OTabPanel>
      <OTabPanel name="configure" class="h-full">
        <CheckConfigure
          :check="check"
          check-type="browser"
          :locations="locations"
          :browsers="browsers"
          :devices="devices"
          :destinations="destinations"
          :folders="folders"
          @refresh:destinations="fetchDestinations"
          @update:check="onConfigureUpdate"
        />
      </OTabPanel>
      <OTabPanel name="results" class="h-full">
        <BrowserCheckResults :check-id="check.id" />
      </OTabPanel>
    </OTabPanels>

    <!-- Sticky footer -->
    <div class="flex items-center justify-end px-3 py-2.5 gap-2 border-t border-[var(--o2-border-color)] shrink-0 bg-[var(--o2-body-primary-bg)]">
      <template v-if="activeTab === 'journey'">
        <OButton variant="outline" size="sm" data-test="synthetics-detail-replay-btn">
          <template #prefix><OIcon name="replay" size="sm" /></template>
          Replay
        </OButton>
        <OButton variant="primary" size="sm" data-test="synthetics-detail-continue-btn" @click="activeTab = 'configure'">
          Continue
          <template #suffix><OIcon name="chevron-right" size="sm" /></template>
        </OButton>
      </template>

      <template v-else-if="activeTab === 'configure'">
        <OButton variant="primary" size="sm" :loading="isSaving" data-test="synthetics-detail-save-btn" @click="saveCheck">
          Update check
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
      data-test="synthetics-detail-unsaved-dialog"
      @click:primary="onConfirmLeave"
      @click:secondary="showUnsavedDialog = false"
    >
      <p class="py-2">You have unsaved changes. Are you sure you want to leave?</p>
    </ODialog>
  </div>
</template>
