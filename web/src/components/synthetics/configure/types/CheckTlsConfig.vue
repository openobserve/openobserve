<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ProtocolCheck, TlsCheckConfig } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

const props = defineProps<{ check: ProtocolCheck }>();
const emit = defineEmits<{ "update:check": [value: ProtocolCheck] }>();

const { t } = useI18n();

const cfg = computed<TlsCheckConfig>(() => props.check.tls!);

function update(patch: Partial<TlsCheckConfig>) {
  emit("update:check", { ...props.check, tls: { ...cfg.value, ...patch } });
}

const port = computed({
  get: () => cfg.value.port,
  set: (v: number) => update({ port: Number(v) || 443 }),
});
const timeoutMs = computed({
  get: () => cfg.value.timeout_ms,
  set: (v: number) => update({ timeout_ms: Number(v) || 0 }),
});
const minDays = computed({
  get: () => cfg.value.min_days_until_expiry,
  set: (v: number) => update({ min_days_until_expiry: Number(v) || 0 }),
});
const verifyChain = computed({
  get: () => cfg.value.verify_chain,
  set: (v: boolean) => update({ verify_chain: v }),
});
const verifyHostname = computed({
  get: () => cfg.value.verify_hostname,
  set: (v: boolean) => update({ verify_hostname: v }),
});
</script>

<template>
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-primary-600" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t("synthetics.protocolConfig.tls.title") }}
      </h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">
      <div class="flex items-end gap-2">
        <OInput
          v-model.number="port"
          type="number"
          :label="t('synthetics.protocolConfig.port')"
          width="xs"
          data-test="synthetics-check-tls-port-input"
        />
        <OInput
          v-model.number="timeoutMs"
          type="number"
          :label="t('synthetics.protocolConfig.timeoutMs')"
          width="sm"
          data-test="synthetics-check-tls-timeout-input"
        />
      </div>
      <OInput
        v-model.number="minDays"
        type="number"
        :label="t('synthetics.protocolConfig.tls.minDays')"
        width="md"
        data-test="synthetics-check-tls-min-days-input"
      />
      <OSwitch
        v-model="verifyChain"
        :label="t('synthetics.protocolConfig.tls.verifyChain')"
        data-test="synthetics-check-tls-verify-chain-switch"
      />
      <OSwitch
        v-model="verifyHostname"
        :label="t('synthetics.protocolConfig.tls.verifyHostname')"
        data-test="synthetics-check-tls-verify-hostname-switch"
      />
    </div>
  </div>
</template>
