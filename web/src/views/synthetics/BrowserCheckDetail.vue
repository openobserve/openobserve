<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useStore } from 'vuex'
import type { BrowserCheck, SyntheticsLocation, SyntheticsFolder } from '@/types/synthetics'
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
const destinations = ref<string[]>([])
const folders = ref<SyntheticsFolder[]>([])

async function fetchCheck() {
  isLoading.value = true
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.get(org, checkId.value)
    check.value = mapResponseToBrowserCheck(res.data as Record<string, unknown>)
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
    locations.value = (res.data ?? []) as SyntheticsLocation[]
  } catch {
    locations.value = []
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
  <div class="tw:flex tw:flex-col tw:h-full tw:bg-[var(--o2-body-primary-bg)]">
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
        @click="dismissBanner"
      >
        ×
      </button>
    </div>

    <!-- Header row -->
    <header class="tw:flex tw:items-center tw:gap-3 tw:px-6 tw:py-3 tw:border-b tw:border-[var(--o2-border-color)]">
      <RouterLink :to="{ name: 'synthetic' }" class="tw:text-sm tw:text-[var(--o2-text-link)] tw:hover:text-[var(--o2-text-link-hover)] tw:flex tw:items-center tw:gap-1">
        ← Back to checks
      </RouterLink>
      <h2 class="tw:text-base tw:font-semibold">{{ check.name || '…' }}</h2>
      <OSwitch
        v-model="enabled"
        size="sm"
        data-test="synthetics-detail-enabled-switch"
      />
    </header>

    <!-- Tab bar -->
    <OTabs v-model="activeTab" bordered class="tw:px-6 tw:bg-[var(--o2-card-bg)]">
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
    <OTabPanels :model-value="activeTab" class="tw:flex-1 tw:overflow-y-auto tw:min-h-0">
      <OTabPanel name="journey" class="tw:h-full">
        <BrowserJourney
          v-model="check.journey"
          :start-url="check.url"
          :extension-ready="true"
        />
      </OTabPanel>
      <OTabPanel name="configure" class="tw:h-full">
        <CheckConfigure
          v-model:check="check"
          check-type="browser"
          :locations="locations"
          :destinations="destinations"
          :folders="folders"
          @refresh:destinations="fetchDestinations"
        />
      </OTabPanel>
      <OTabPanel name="results" class="tw:h-full">
        <BrowserCheckResults :check-id="check.id" />
      </OTabPanel>
    </OTabPanels>

    <!-- Sticky footer -->
    <div class="tw:flex tw:items-center tw:justify-end tw:px-3 tw:py-2.5 tw:gap-2 tw:border-t tw:border-[var(--o2-border-color)] tw:shrink-0 tw:bg-[var(--o2-body-primary-bg)]">
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
  </div>
</template>
