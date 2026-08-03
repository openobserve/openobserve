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
import type { ProtocolCheck, SshCheckConfig } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";

const props = defineProps<{ check: ProtocolCheck }>();
const emit = defineEmits<{ "update:check": [value: ProtocolCheck] }>();

const { t } = useI18n();

const cfg = computed<SshCheckConfig>(() => props.check.ssh!);

function update(patch: Partial<SshCheckConfig>) {
  emit("update:check", { ...props.check, ssh: { ...cfg.value, ...patch } });
}

const port = computed({
  get: () => cfg.value.port,
  set: (v: number) => update({ port: Number(v) || 22 }),
});
const username = computed({
  get: () => cfg.value.username,
  set: (v: string) => update({ username: v }),
});
const authType = computed({
  get: () => cfg.value.authType,
  set: (v: string | number | boolean | undefined) =>
    update({ authType: v === "private_key" ? "private_key" : "password" }),
});
const secret = computed({
  get: () => cfg.value.secret,
  set: (v: string) => update({ secret: v }),
});
const timeoutMs = computed({
  get: () => cfg.value.timeout_ms,
  set: (v: number) => update({ timeout_ms: Number(v) || 0 }),
});
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.protocolConfig.ssh.title") }}
      </h3>
    </div>
    <div class="flex flex-col gap-4 px-3 py-2">
      <div class="flex items-end gap-2">
        <OInput
          v-model.number="port"
          type="number"
          :label="t('synthetics.protocolConfig.port')"
          width="xs"
          data-test="synthetics-check-ssh-port-input"
        />
        <OInput
          v-model.number="timeoutMs"
          type="number"
          :label="t('synthetics.protocolConfig.timeoutMs')"
          width="sm"
          data-test="synthetics-check-ssh-timeout-input"
        />
      </div>
      <OInput
        v-model="username"
        required
        :label="t('synthetics.protocolConfig.ssh.username')"
        width="md"
        data-test="synthetics-check-ssh-username-input"
      />
      <div>
        <label class="text-text-body mb-1 block text-sm font-medium">{{
          t("synthetics.protocolConfig.ssh.authType")
        }}</label>
        <ORadioGroup
          v-model="authType"
          :label="t('synthetics.protocolConfig.ssh.authType')"
          orientation="horizontal"
          data-test="synthetics-check-ssh-auth-type-radio"
        >
          <ORadio value="password" :label="t('synthetics.protocolConfig.ssh.password')" />
          <ORadio value="private_key" :label="t('synthetics.protocolConfig.ssh.privateKey')" />
        </ORadioGroup>
      </div>
      <OInput
        v-if="authType === 'password'"
        v-model="secret"
        type="password"
        required
        :label="t('synthetics.protocolConfig.ssh.password')"
        data-test="synthetics-check-ssh-secret-input"
      />
      <OInput
        v-else
        v-model="secret"
        type="textarea"
        :rows="5"
        required
        :label="t('synthetics.protocolConfig.ssh.privateKey')"
        :placeholder="t('synthetics.protocolConfig.ssh.privateKeyPlaceholder')"
        data-test="synthetics-check-ssh-secret-input"
      />
    </div>
  </div>
</template>
