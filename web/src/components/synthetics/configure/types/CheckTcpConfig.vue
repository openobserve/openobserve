<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProtocolCheck, TcpCheckConfig } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'

const props = defineProps<{ check: ProtocolCheck }>()
const emit = defineEmits<{ 'update:check': [value: ProtocolCheck] }>()

const { t } = useI18n()

const cfg = computed<TcpCheckConfig>(() => props.check.tcp!)

function update(patch: Partial<TcpCheckConfig>) {
  emit('update:check', { ...props.check, tcp: { ...cfg.value, ...patch } })
}

const port = computed({
  get: () => cfg.value.port ?? undefined,
  set: (v: number | undefined) => update({ port: v != null && !Number.isNaN(Number(v)) ? Number(v) : null }),
})
const timeoutMs = computed({
  get: () => cfg.value.timeout_ms,
  set: (v: number) => update({ timeout_ms: Number(v) || 0 }),
})
const responseContains = computed({
  get: () => cfg.value.response_contains,
  set: (v: string) => update({ response_contains: v }),
})
</script>

<template>
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
      <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolConfig.tcp.title') }}</h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">
      <div class="flex items-end gap-2">
        <OInput
          v-model.number="port"
          type="number"
          required
          :label="t('synthetics.protocolConfig.port')"
          width="xs"
          data-test="synthetics-check-tcp-port-input"
        />
        <OInput
          v-model.number="timeoutMs"
          type="number"
          :label="t('synthetics.protocolConfig.timeoutMs')"
          width="sm"
          data-test="synthetics-check-tcp-timeout-input"
        />
      </div>
      <OInput
        v-model="responseContains"
        :label="t('synthetics.protocolConfig.tcp.responseContains')"
        :placeholder="t('synthetics.protocolConfig.tcp.responseContainsPlaceholder')"
        data-test="synthetics-check-tcp-response-contains-input"
      />
    </div>
  </div>
</template>
