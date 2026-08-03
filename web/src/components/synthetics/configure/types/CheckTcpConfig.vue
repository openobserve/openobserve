<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ProtocolCheck, TcpCheckConfig } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";

const props = defineProps<{ check: ProtocolCheck }>();
const emit = defineEmits<{ "update:check": [value: ProtocolCheck] }>();

const { t } = useI18n();

const cfg = computed<TcpCheckConfig>(() => props.check.tcp!);

function update(patch: Partial<TcpCheckConfig>) {
  emit("update:check", { ...props.check, tcp: { ...cfg.value, ...patch } });
}

const port = computed({
  get: () => cfg.value.port ?? undefined,
  set: (v: number | undefined) =>
    update({ port: v != null && !Number.isNaN(Number(v)) ? Number(v) : null }),
});
const timeoutMs = computed({
  get: () => cfg.value.timeout_ms,
  set: (v: number) => update({ timeout_ms: Number(v) || 0 }),
});
const responseContains = computed({
  get: () => cfg.value.response_contains,
  set: (v: string) => update({ response_contains: v }),
});
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.protocolConfig.tcp.title") }}
      </h3>
    </div>
    <div class="flex flex-col gap-4 px-3 py-2">
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
