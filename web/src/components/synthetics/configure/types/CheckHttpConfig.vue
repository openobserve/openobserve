<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// HTTP request + assertions card. Edits `check.http` and re-emits the whole
// check — same update:check contract as the other configure sections.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HttpCheckConfig, ProtocolCheck } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'

const props = defineProps<{ check: ProtocolCheck }>()
const emit = defineEmits<{ 'update:check': [value: ProtocolCheck] }>()

const { t } = useI18n()

const cfg = computed<HttpCheckConfig>(() => props.check.http!)

function update(patch: Partial<HttpCheckConfig>) {
  emit('update:check', { ...props.check, http: { ...cfg.value, ...patch } })
}

// Server-side whitelist (validate_config)
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
const methodOptions = METHODS.map((m) => ({ label: m, value: m }))

const ASSERTION_FIELDS = ['status_code', 'body', 'response_time_ms'] as const
const fieldOptions = computed(() =>
  ASSERTION_FIELDS.map((f) => ({ label: t(`synthetics.protocolConfig.http.fields.${f}`), value: f })),
)
const OPERATORS = ['eq', 'ne', 'lt', 'gt', 'contains', 'not_contains'] as const
const operatorOptions = computed(() =>
  OPERATORS.map((o) => ({ label: t(`synthetics.protocolConfig.http.operators.${o}`), value: o })),
)

const method = computed({
  get: () => cfg.value.method,
  set: (v: string | number | boolean | null | undefined) => update({ method: String(v ?? 'GET') }),
})
const timeoutMs = computed({
  get: () => cfg.value.timeout_ms,
  set: (v: number) => update({ timeout_ms: Number(v) || 0 }),
})
const followRedirects = computed({
  get: () => cfg.value.follow_redirects,
  set: (v: boolean) => update({ follow_redirects: v }),
})
const body = computed({
  get: () => cfg.value.body,
  set: (v: string) => update({ body: v }),
})
const showBody = computed(() => !['GET', 'HEAD'].includes(cfg.value.method))

function patchHeader(index: number, patch: Partial<{ name: string; value: string }>) {
  const headers = cfg.value.headers.map((h, i) => (i === index ? { ...h, ...patch } : h))
  update({ headers })
}
function addHeader() {
  update({ headers: [...cfg.value.headers, { name: '', value: '' }] })
}
function removeHeader(index: number) {
  update({ headers: cfg.value.headers.filter((_, i) => i !== index) })
}

function patchAssertion(index: number, patch: Partial<HttpCheckConfig['assertions'][number]>) {
  const assertions = cfg.value.assertions.map((a, i) => (i === index ? { ...a, ...patch } : a))
  update({ assertions })
}
function addAssertion() {
  update({ assertions: [...cfg.value.assertions, { field: 'status_code', operator: 'eq', value: '' }] })
}
function removeAssertion(index: number) {
  update({ assertions: cfg.value.assertions.filter((_, i) => i !== index) })
}
</script>

<template>
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
      <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolConfig.http.title') }}</h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">
      <div class="flex items-end gap-2">
        <OSelect
          v-model="method"
          :label="t('synthetics.protocolConfig.http.method')"
          :options="methodOptions"
          width="xs"
          data-test="synthetics-check-http-method-select"
        />
        <OInput
          v-model.number="timeoutMs"
          type="number"
          :label="t('synthetics.protocolConfig.timeoutMs')"
          width="sm"
          data-test="synthetics-check-http-timeout-input"
        />
      </div>

      <OSwitch
        v-model="followRedirects"
        :label="t('synthetics.protocolConfig.http.followRedirects')"
        data-test="synthetics-check-http-follow-redirects-switch"
      />

      <!-- Headers -->
      <div>
        <label class="text-sm font-medium text-text-body mb-1 block">{{ t('synthetics.protocolConfig.http.headers') }}</label>
        <div v-for="(h, i) in cfg.headers" :key="i" class="flex items-center gap-2 mb-2">
          <div class="flex-1 min-w-0">
            <OInput
              :model-value="h.name"
              :placeholder="t('synthetics.protocolConfig.http.headerName')"
              :data-test="`synthetics-check-http-header-name-${i}`"
              @update:model-value="(v: string | number) => patchHeader(i, { name: typeof v === 'string' ? v : String(v) })"
            />
          </div>
          <div class="flex-1 min-w-0">
            <OInput
              :model-value="h.value"
              :placeholder="t('synthetics.protocolConfig.http.headerValue')"
              :data-test="`synthetics-check-http-header-value-${i}`"
              @update:model-value="(v: string | number) => patchHeader(i, { value: typeof v === 'string' ? v : String(v) })"
            />
          </div>
          <OButton
            variant="ghost"
            size="icon-sm"
            :aria-label="t('common.delete')"
            :data-test="`synthetics-check-http-header-remove-${i}`"
            @click="removeHeader(i)"
          >
            <template #icon-left><OIcon name="close" size="xs" /></template>
          </OButton>
        </div>
        <OButton variant="outline" size="sm" data-test="synthetics-check-http-add-header-btn" @click="addHeader">
          <template #icon-left><OIcon name="add" size="xs" /></template>
          {{ t('synthetics.protocolConfig.http.addHeader') }}
        </OButton>
      </div>

      <!-- Body -->
      <OInput
        v-if="showBody"
        v-model="body"
        type="textarea"
        :rows="4"
        :label="t('synthetics.protocolConfig.http.body')"
        :placeholder="t('synthetics.protocolConfig.http.bodyPlaceholder')"
        data-test="synthetics-check-http-body-textarea"
      />

      <!-- Assertions -->
      <div>
        <label class="text-sm font-medium text-text-body mb-1 block">{{ t('synthetics.protocolConfig.http.assertions') }}</label>
        <div v-for="(a, i) in cfg.assertions" :key="i" class="flex items-center gap-2 mb-2">
          <OSelect
            :model-value="a.field"
            :options="fieldOptions"
            width="sm"
            :data-test="`synthetics-check-http-assertion-field-${i}`"
            @update:model-value="(v) => patchAssertion(i, { field: String(v ?? '') })"
          />
          <OSelect
            :model-value="a.operator"
            :options="operatorOptions"
            width="xs"
            :data-test="`synthetics-check-http-assertion-operator-${i}`"
            @update:model-value="(v) => patchAssertion(i, { operator: String(v ?? 'eq') })"
          />
          <div class="flex-1 min-w-0">
            <OInput
              :model-value="a.value"
              :placeholder="t('synthetics.protocolConfig.http.assertionValue')"
              :data-test="`synthetics-check-http-assertion-value-${i}`"
              @update:model-value="(v: string | number) => patchAssertion(i, { value: typeof v === 'string' ? v : String(v) })"
            />
          </div>
          <OButton
            variant="ghost"
            size="icon-sm"
            :aria-label="t('common.delete')"
            :data-test="`synthetics-check-http-assertion-remove-${i}`"
            @click="removeAssertion(i)"
          >
            <template #icon-left><OIcon name="close" size="xs" /></template>
          </OButton>
        </div>
        <OButton variant="outline" size="sm" data-test="synthetics-check-http-add-assertion-btn" @click="addAssertion">
          <template #icon-left><OIcon name="add" size="xs" /></template>
          {{ t('synthetics.protocolConfig.http.addAssertion') }}
        </OButton>
      </div>
    </div>
  </div>
</template>
