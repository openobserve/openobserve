// Copyright 2026 OpenObserve Inc.
<template>
  <ODrawer
    v-model:open="drawerOpen"
    :title="editTarget ? 'Edit Monitor' : 'New Monitor'"
    :sub-title="editTarget ? editTarget.url : 'Configure a new synthetic check'"
    size="lg"
  >
    <template #footer>
      <div class="drw-footer">
        <OButton variant="ghost" :disabled="stepIdx === 0" data-test="monitor-form-back-btn" @click="prevStep">Back</OButton>
        <div style="display:flex;gap:8px">
          <OButton variant="ghost" data-test="monitor-form-cancel-btn" @click="drawerOpen = false">Cancel</OButton>
          <OButton v-if="stepIdx < steps.length - 1" variant="primary" data-test="monitor-form-continue-btn" @click="nextStep">Continue →</OButton>
          <OButton v-else variant="primary" data-test="monitor-form-save-btn" @click="saveMonitor">{{ editTarget ? 'Save changes' : 'Create monitor' }}</OButton>
        </div>
      </div>
    </template>

    <OStepper v-model="currentStep" :navigable="true">
      <OStep :name="0" title="Type" :done="stepIdx > 0">
        <div class="drw-slabel">Choose monitor type</div>
        <div class="type-grid">
          <div v-for="t in monitorTypes" :key="t.value"
            class="type-card" :class="{ 'type-card--on': form.type === t.value }"
            :data-test="'monitor-form-type-' + t.value.toLowerCase()"
            @click="form.type = t.value">
            <div class="type-top"><OIcon :name="t.icon" size="md" :class="form.type===t.value?'type-icon--on':'type-icon--off'" /><OIcon v-if="form.type===t.value" name="check-circle" size="xs" class="type-check" /></div>
            <div class="type-name">{{ t.label }}</div>
            <div class="type-desc">{{ t.desc }}</div>
          </div>
        </div>
      </OStep>

      <OStep :name="1" title="Configure" :done="stepIdx > 1">
        <div class="drw-slabel">Basic configuration</div>
        <div class="fstack">
          <OInput v-model="form.name" label="Monitor name *" data-test="monitor-form-name-input" />
          <div style="display:flex;gap:8px">
            <OSelect v-if="['HTTP','API'].includes(form.type)" v-model="form.method" label="Method" :options="['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m => ({label: m, value: m}))" class="tw:w-[110px] tw:shrink-0" data-test="monitor-form-method-select" />
            <OInput v-model="form.url" label="URL *" placeholder="https://example.com/api/health" class="tw:flex-1" data-test="monitor-form-url-input" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <OSelect v-model="form.interval" label="Check interval" :options="intervalOpts" data-test="monitor-form-interval-select" />
            <OInput v-model.number="form.timeout" label="Timeout (ms)" type="number" data-test="monitor-form-timeout-input" />
          </div>
          <OCollapsible title="Request Headers">
            <div class="tw:p-2.5 tw:flex tw:flex-col tw:gap-2">
              <div v-for="(h, i) in form.headers" :key="i" style="display:flex;gap:8px;align-items:center">
                <OInput v-model="h.key" placeholder="Name" class="tw:flex-1" :data-test="'monitor-form-header-key-' + i" />
                <OInput v-model="h.value" placeholder="Value" class="tw:flex-1" :data-test="'monitor-form-header-value-' + i" />
                <OButton variant="ghost" size="sm" :data-test="'monitor-form-header-remove-' + i" @click="form.headers.splice(i,1)"><OIcon name="close" size="xs" /></OButton>
              </div>
              <OButton variant="outline" size="sm" data-test="monitor-form-add-header-btn" @click="form.headers.push({key:'',value:''})">
                <template #icon-left><OIcon name="add" size="xs" /></template>
                Add header
              </OButton>
            </div>
          </OCollapsible>
        </div>
      </OStep>

      <OStep :name="2" title="Locations" :done="stepIdx > 2">
        <div class="drw-slabel">Select check locations</div>
        <div style="font-size:12px;color:var(--o2-tab-text-color);margin-bottom:14px">Checks run simultaneously from all selected locations. Select at least one.</div>
        <div class="loc-section-label">Global locations</div>
        <div class="loc-list">
          <div v-for="loc in globalLocations" :key="loc.value"
            class="loc-item" :class="{ 'loc-item--on': form.locations.includes(loc.value) }"
            :data-test="'monitor-form-loc-' + loc.value"
            @click="toggleLoc(loc.value)">
            <div class="loc-flag">{{ loc.flag }}</div>
            <div style="flex:1"><div style="font-size:13px;font-weight:500">{{ loc.label }}</div><div style="font-size:11px;color:var(--o2-tab-text-color)">{{ loc.city }}</div></div>
            <OIcon v-if="form.locations.includes(loc.value)" name="check-circle" size="sm" class="type-check" /><div v-else style="width:16px" />
          </div>
        </div>
        <div v-if="onlinePrivateLocations.length">
          <div class="loc-section-label" style="margin-top:16px">Private locations</div>
          <div class="loc-list">
            <div v-for="loc in onlinePrivateLocations" :key="'pl-'+loc.id"
              class="loc-item" :class="{ 'loc-item--on': form.locations.includes('priv-'+loc.id) }"
              :data-test="'monitor-form-priv-loc-' + loc.id"
              @click="toggleLoc('priv-'+loc.id)">
              <OIcon name="business" size="sm" :class="form.locations.includes('priv-'+loc.id)?'type-icon--on':'type-icon--off'" />
              <div style="flex:1"><div style="font-size:13px;font-weight:500">{{ loc.name }}</div><div style="font-size:11px;color:var(--o2-tab-text-color)">{{ loc.region }}</div></div>
              <OIcon v-if="form.locations.includes('priv-'+loc.id)" name="check-circle" size="sm" class="type-check" /><div v-else style="width:16px" />
            </div>
          </div>
        </div>
      </OStep>

      <OStep :name="3" title="Assertions & Alerts" :done="stepIdx > 3">
        <div class="drw-slabel">Assertions</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          <div v-for="(a, i) in form.assertions" :key="i" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--o2-border-color);border-radius:8px">
            <OSelect v-model="a.type" :options="assertionTypes" class="tw:flex-1" :data-test="'monitor-form-assertion-type-' + i" />
            <OSelect v-model="a.operator" :options="['=','!=','<','>','contains','matches'].map(o => ({label: o, value: o}))" class="tw:w-[100px]" :data-test="'monitor-form-assertion-op-' + i" />
            <OInput v-model="a.value" placeholder="200" class="tw:flex-1" :data-test="'monitor-form-assertion-value-' + i" />
            <OButton variant="ghost" size="sm" :data-test="'monitor-form-assertion-remove-' + i" @click="form.assertions.splice(i,1)"><OIcon name="close" size="xs" /></OButton>
          </div>
          <OButton variant="outline" size="sm" data-test="monitor-form-add-assertion-btn" @click="form.assertions.push({type:'statusCode',operator:'=',value:'200'})">
            <template #icon-left><OIcon name="add" size="xs" /></template>
            Add assertion
          </OButton>
        </div>
        <div class="drw-slabel" style="margin-top:20px">Alert conditions</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap">
            <span>Alert when failing from</span>
            <OInput v-model.number="form.alertThreshold" type="number" class="tw:w-15" data-test="monitor-form-alert-threshold-input" />
            <span>or more location(s)</span>
          </div>
          <OSwitch v-model="form.notifyOnRecovery" label="Notify on recovery" size="sm" data-test="monitor-form-notify-recovery-switch" />
          <OSwitch v-model="form.renotify" label="Re-notify every 30 min while failing" size="sm" data-test="monitor-form-renotify-switch" />
        </div>
      </OStep>
    </OStepper>
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OCollapsible from '@/lib/core/Collapsible/OCollapsible.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OStepper from '@/lib/navigation/Stepper/OStepper.vue'
import OStep from '@/lib/navigation/Stepper/OStep.vue'

const props = defineProps<{
  open: boolean
  editTarget: any | null
  onlinePrivateLocations: { id: number; name: string; region: string }[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: []
}>()

const router = useRouter()

const drawerOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

const monitorTypes = [
  { value: 'HTTP',    label: 'HTTP Check',     icon: 'network-check', desc: 'Verify any HTTP/HTTPS endpoint response.' },
  { value: 'Browser', label: 'Browser Test',   icon: 'web',           desc: 'Simulate user journeys in a real browser.' },
  { value: 'API',     label: 'Multi-step API', icon: 'webhook',       desc: 'Chain multiple API calls end-to-end.' },
  { value: 'TCP',     label: 'TCP Monitor',    icon: 'lan',           desc: 'Check raw TCP port connectivity.' },
  { value: 'Ping',    label: 'ICMP Ping',      icon: 'radar',         desc: 'Verify host reachability via ICMP.' },
  { value: 'DNS',     label: 'DNS Check',      icon: 'dns',           desc: 'Validate DNS records and resolution.' },
]

const intervalOpts = [
  { label: '30 seconds', value: '30s' }, { label: '1 minute', value: '1m' }, { label: '5 minutes', value: '5m' },
  { label: '10 minutes', value: '10m' }, { label: '30 minutes', value: '30m' }, { label: '1 hour', value: '1h' },
]

const globalLocations = [
  { value: 'us-east',    label: 'US East',      city: 'Virginia, USA',      flag: '🇺🇸' },
  { value: 'us-west',    label: 'US West',      city: 'Oregon, USA',        flag: '🇺🇸' },
  { value: 'eu-west',    label: 'EU West',      city: 'Dublin, Ireland',    flag: '🇮🇪' },
  { value: 'eu-central', label: 'EU Central',   city: 'Frankfurt, Germany', flag: '🇩🇪' },
  { value: 'ap-se',      label: 'AP Southeast', city: 'Singapore',          flag: '🇸🇬' },
  { value: 'ap-ne',      label: 'AP Northeast', city: 'Tokyo, Japan',       flag: '🇯🇵' },
]

const assertionTypes = [
  { label: 'Status code',        value: 'statusCode'   },
  { label: 'Response time (ms)', value: 'responseTime' },
  { label: 'Body contains',      value: 'bodyContains' },
  { label: 'Header value',       value: 'header'       },
  { label: 'JSON path',          value: 'jsonPath'     },
  { label: 'Certificate TTL',    value: 'certTTL'      },
]

const steps = [
  { key: 0, label: 'Type' },
  { key: 1, label: 'Configure' },
  { key: 2, label: 'Locations' },
  { key: 3, label: 'Assertions & Alerts' },
]

const defaultForm = () => ({
  type: 'HTTP', name: '', url: '', method: 'GET',
  interval: '1m', timeout: 5000,
  locations: ['us-east', 'eu-west'],
  headers: [] as { key: string; value: string }[],
  assertions: [{ type: 'statusCode', operator: '=', value: '200' }],
  alertThreshold: 1, notifyOnRecovery: true, renotify: false,
})

const form        = ref(defaultForm())
const currentStep = ref(0)
const stepIdx     = computed(() => currentStep.value)

const nextStep = () => {
  if (currentStep.value === 0 && form.value.type === 'Browser') {
    router.push({ name: 'synthetic-new' })
    return
  }
  if (currentStep.value < steps.length - 1) currentStep.value++
}
const prevStep    = () => { if (currentStep.value > 0) currentStep.value-- }
const toggleLoc   = (v: string) => { const i = form.value.locations.indexOf(v); if (i === -1) form.value.locations.push(v); else form.value.locations.splice(i, 1) }
const saveMonitor = () => { emit('save'); drawerOpen.value = false }

watch(() => props.open, (open) => {
  if (!open) return
  if (props.editTarget) {
    form.value = { ...defaultForm(), name: props.editTarget.name, url: props.editTarget.url, type: props.editTarget.type, interval: props.editTarget.interval }
    currentStep.value = 1
  } else {
    form.value = defaultForm()
    currentStep.value = 0
  }
})
</script>

<style scoped>
.drw-slabel { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:12px; }
.drw-footer { display:flex; align-items:center; justify-content:space-between; padding:12px 22px; border-top:1px solid var(--o2-border-color); flex-shrink:0; }
.type-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.type-card { border:1.5px solid var(--o2-border-color); border-radius:10px; padding:14px; cursor:pointer; transition:border-color .12s,background .12s; }
.type-card:hover  { border-color:var(--o2-primary-color); }
.type-card--on    { border-color:var(--o2-primary-color); background:color-mix(in srgb,var(--o2-primary-color) 8%,transparent); }
.type-top  { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.type-name { font-size:13px; font-weight:700; margin-bottom:3px; }
.type-desc { font-size:11px; color:var(--o2-tab-text-color); line-height:1.4; }
.type-icon--on  { color:var(--o2-primary-color); }
.type-icon--off { color:rgba(128,128,128,.7); }
.type-check     { color:var(--o2-primary-color); flex-shrink:0; }
.fstack { display:flex; flex-direction:column; gap:12px; }
.loc-section-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--o2-tab-text-color); margin-bottom:8px; }
.loc-list   { display:flex; flex-direction:column; gap:6px; }
.loc-item   { display:flex; align-items:center; gap:12px; padding:10px 14px; border:1.5px solid var(--o2-border-color); border-radius:8px; cursor:pointer; transition:border-color .12s,background .12s; }
.loc-item:hover { border-color:var(--o2-primary-color); }
.loc-item--on   { border-color:var(--o2-primary-color); background:color-mix(in srgb,var(--o2-primary-color) 6%,transparent); }
.loc-flag { font-size:18px; line-height:1; }
</style>
