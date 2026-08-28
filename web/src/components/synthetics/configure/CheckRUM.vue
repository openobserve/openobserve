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
import { useI18nTyped } from "@/types/i18n";
import type { BrowserCheck, SyntheticCheckType } from "@/types/synthetics";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

const { t } = useI18nTyped();

const props = defineProps<{
  check: BrowserCheck;
  checkType?: SyntheticCheckType;
}>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const collectRUM = computed({
  get: () => props.check.rum.collect,
  set: (v: boolean) =>
    emit("update:check", {
      ...props.check,
      rum: { ...props.check.rum, collect: v },
    }),
});

const sessionReplay = computed({
  get: () => props.check.rum.sessionReplay,
  set: (v: boolean) =>
    emit("update:check", {
      ...props.check,
      rum: { ...props.check.rum, sessionReplay: v },
    }),
});
</script>

<template>
  <div class="rounded-default border-border-default bg-surface-base mb-4 border p-6">
    <h3 class="text-text-heading pb-4 text-base font-semibold">{{ t("synthetics.rum.title") }}</h3>
    <div class="flex flex-col gap-4">
      <div>
        <OSwitch
          v-model="collectRUM"
          :label="t('synthetics.rum.collectRUM')"
          data-test="synthetics-check-rum-collect-switch"
        />
        <p class="text-text-secondary mt-1 pl-9 text-xs!">
          {{ t("synthetics.rum.collectRUMDesc") }}
        </p>
      </div>

      <div :class="!check.rum.collect ? 'opacity-50' : ''">
        <OSwitch
          v-model="sessionReplay"
          :label="t('synthetics.rum.sessionReplay')"
          :disabled="!check.rum.collect"
          data-test="synthetics-check-rum-session-replay-switch"
        />
      </div>
    </div>
  </div>
</template>
