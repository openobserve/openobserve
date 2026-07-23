<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Create/edit view for protocol checks (http/tcp/tls/ssh) — single configure
// page, no journey step. Mirrors CreateBrowserTest's data fetching and save
// flow; the per-type request card is slotted into CheckConfigure.
import { computed, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import type {
  AgentSetup,
  BrowserCheck,
  ProtocolCheck,
  ProtocolCheckType,
  SyntheticsFolder,
  SyntheticsLocation,
} from '@/types/synthetics'
import {
  buildCreateProtocolCheckPayload,
  defaultProtocolConfig,
  mapResponseToProtocolCheck,
} from '@/utils/synthetics/buildPayload'
import { getFoldersListByType } from '@/utils/commons'
import syntheticsService from '@/services/synthetics'
import destinationService from '@/services/alert_destination'
import { toast } from '@/lib/feedback/Toast/useToast'
import OPageLayout from '@/lib/core/PageLayout/OPageLayout.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import ODialog from '@/lib/overlay/Dialog/ODialog.vue'
import CheckConfigure from '@/components/synthetics/configure/CheckConfigure.vue'
import AgentSetupDrawer from '@/components/synthetic-monitoring/AgentSetupDrawer.vue'
import CreateBrowserTestSkeleton from '@/components/synthetics/CreateBrowserTestSkeleton.vue'
import CheckHttpConfig from '@/components/synthetics/configure/types/CheckHttpConfig.vue'
import CheckTcpConfig from '@/components/synthetics/configure/types/CheckTcpConfig.vue'
import CheckTlsConfig from '@/components/synthetics/configure/types/CheckTlsConfig.vue'
import CheckSshConfig from '@/components/synthetics/configure/types/CheckSshConfig.vue'

const props = defineProps<{
  checkType: ProtocolCheckType
  /** Present when editing an existing check. */
  editId?: string
}>()

const router = useRouter()
const route = useRoute()
const store = useStore()
const { t } = useI18n()

const typeConfigCards: Record<ProtocolCheckType, Component> = {
  http: CheckHttpConfig,
  tcp: CheckTcpConfig,
  tls: CheckTlsConfig,
  ssh: CheckSshConfig,
}

function makeDefaultCheck(type: ProtocolCheckType): ProtocolCheck {
  return {
    checkType: type,
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
    rum: { collect: false, sessionReplay: false },
    capture: { screenshot: 'off', trace: 'off' },
    variables: [],
    ...defaultProtocolConfig(type),
  }
}

const check = ref<ProtocolCheck>(makeDefaultCheck(props.checkType))
const isLoadingEdit = ref(false)
const isSaving = ref(false)

const headerTitle = computed(() => {
  if (isLoadingEdit.value) return t('synthetics.createBrowserTest.loading')
  if (props.editId) return check.value.name || t('synthetics.newCheck.pageTitle', { label: typeLabel.value })
  return t('synthetics.newCheck.pageTitle', { label: typeLabel.value })
})
const typeLabel = computed(() => t(`synthetics.newCheck.${props.checkType}`))

// Server-driven lists, threaded down to CheckConfigure (same as browser flow).
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
    // Protocol checks run from public locations and private agents alike;
    // disabled locations are hidden.
    locations.value = (((res.data ?? {}).locations ?? []) as SyntheticsLocation[]).filter(
      (l) => l.enabled !== false,
    )
  } catch {
    locations.value = []
  }
}

// ── Private agent setup (drawer opened from the locations card) ──────────
const showAgentSetup = ref(false)
const agentSetup = ref<AgentSetup | null>(null)

async function openAgentSetup() {
  showAgentSetup.value = true
  if (agentSetup.value) return
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.getAgentSetup(org)
    agentSetup.value = (res.data ?? null) as AgentSetup | null
  } catch {
    agentSetup.value = null
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
    const res = await syntheticsService.get(org, id, String(route.query.folder ?? ''))
    check.value = mapResponseToProtocolCheck(res.data as Record<string, unknown>)
  } catch (err) {
    // Surface it — a silent catch here leaves a blank form that saves a
    // fresh check over the existing one.
    console.error('[synthetics] failed to load check for edit', err)
    toast({ variant: 'error', message: t('synthetics.newCheck.loadEditFailed') })
  } finally {
    isLoadingEdit.value = false
  }
}

onMounted(() => {
  fetchFolders()
  fetchLocations()
  fetchDestinations()

  if (props.editId) {
    loadForEdit(props.editId).catch(console.error)
  } else {
    const folderQuery = route.query.folder
    if (typeof folderQuery === 'string' && folderQuery) {
      check.value = { ...check.value, folder: folderQuery }
    }
  }
})

// ── Unsaved changes guard (same pattern as CreateBrowserTest) ────────────────
const isDirty = ref(false)
const showUnsavedDialog = ref(false)
let pendingLeavePath: string | null = null
let forceLeave = false

function onConfigureUpdate(val: BrowserCheck) {
  check.value = val as ProtocolCheck
  isDirty.value = true
}

onBeforeRouteLeave((to, _from, next) => {
  if (forceLeave || !isDirty.value) {
    forceLeave = false
    next()
    return
  }
  next(false)
  pendingLeavePath = to.fullPath
  showUnsavedDialog.value = true
})

function onConfirmLeave() {
  showUnsavedDialog.value = false
  forceLeave = true
  if (pendingLeavePath) {
    router.push(pendingLeavePath)
    pendingLeavePath = null
  }
}

// When the user switches organizations while editing a check, silently redirect
// to the synthetics list of the new org — the check ID belongs to the previous
// org and shouldn't be resolved against the new one.
watch(
  () => store.state.selectedOrganization.identifier,
  (newOrg, oldOrg) => {
    if (oldOrg && newOrg !== oldOrg && props.editId) {
      forceLeave = true
      router.push({ name: 'synthetics' })
    }
  },
)

async function saveCheck() {
  isSaving.value = true
  const dismiss = toast({ variant: 'loading', message: t('synthetics.newCheck.saving'), timeout: 0 })
  try {
    const org = store.state.selectedOrganization.identifier
    const payload = buildCreateProtocolCheckPayload(check.value)
    if (props.editId) {
      await syntheticsService.update(org, props.editId, payload, check.value.folder)
      dismiss()
      toast({ variant: 'success', message: t('synthetics.newCheck.updated') })
    } else {
      await syntheticsService.create(org, payload, check.value.folder)
      dismiss()
      toast({ variant: 'success', message: t('synthetics.newCheck.saved') })
    }
    isDirty.value = false
    router.push({ name: 'synthetics', query: { folder: check.value.folder } })
  } catch (err: any) {
    dismiss()
    toast({
      variant: 'error',
      message: err?.response?.data?.message || err?.response?.data?.error || t('synthetics.newCheck.saveFailed'),
    })
    console.error('[synthetics] save failed', err)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <OPageLayout
    :title="headerTitle"
    :back="{ label: t('synthetics.newCheck.back'), to: { name: 'synthetics' }, dataTest: 'synthetics-create-back-btn' }"
    bleed
  >

    <CreateBrowserTestSkeleton v-if="isLoadingEdit" :rows="10" />
    <template v-else>
      <div class="flex-1 overflow-y-auto min-h-0">
        <CheckConfigure
          :check="check"
          :check-type="checkType"
          :locations="locations"
          :destinations="destinations"
          :folders="folders"
          allow-private-locations
          class="w-full!"
          @refresh:destinations="fetchDestinations"
          @update:check="onConfigureUpdate"
          @setup-agent="openAgentSetup"
        >
          <template #type-config>
            <component
              :is="typeConfigCards[checkType]"
              :check="check"
              @update:check="onConfigureUpdate"
            />
          </template>
        </CheckConfigure>
      </div>

      <!-- Sticky footer -->
      <div class="flex items-center px-3 py-2.5 gap-2 border-t border-border-default shrink-0 bg-surface-base">
        <span class="flex-1" aria-hidden="true" />
        <OButton variant="ghost" size="sm" data-test="synthetics-create-cancel-btn" @click="router.push({ name: 'synthetics' })">
          {{ t('common.cancel') }}
        </OButton>
        <OButton variant="primary" size="sm" :loading="isSaving" data-test="synthetics-create-save-btn" @click="saveCheck">
          {{ editId ? t('synthetics.newCheck.updateCheck') : t('synthetics.newCheck.saveCheck') }}
          <template #suffix><OIcon name="save" size="sm" /></template>
        </OButton>
      </div>

      <!-- Private agent setup drawer; locations reload on close so a freshly
           registered location becomes selectable without leaving the form. -->
      <AgentSetupDrawer
        v-model:open="showAgentSetup"
        :token="agentSetup?.token"
        :org="agentSetup?.org"
        :o2-url="agentSetup?.o2_url"
        :script-url="agentSetup?.script_url"
        :install="agentSetup?.install"
        @update:open="(open: boolean) => { if (!open) fetchLocations() }"
      />

      <!-- Unsaved changes dialog -->
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
    </template>
  </OPageLayout>
</template>
