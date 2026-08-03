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
import { raw, useI18nTyped } from "@/types/i18n";
import type { BrowserCheck } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";

const props = defineProps<{
  check: BrowserCheck;
  validationErrors?: Record<string, string>;
}>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();

const retries = computed({
  get: () => props.check.retries ?? 0,
  set: (v: string | number) => emit("update:check", { ...props.check, retries: Number(v) }),
});

const retryDelayMs = computed({
  get: () => props.check.waitBeforeRetrySecs ?? 0,
  set: (v: string | number) =>
    emit("update:check", { ...props.check, waitBeforeRetrySecs: Number(v) }),
});
</script>

<template>
  <div
    class="rounded-default border-border-default mb-4 border"
    data-test="synthetics-check-retries"
  >
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-0.75 shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.scheduleAlert.retries") }}
      </h3>
    </div>
    <div class="flex flex-col gap-3 px-3 py-2">
      <div class="flex flex-nowrap items-center gap-2">
        <label class="text-text-body w-32 text-sm font-medium whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retriesOnFailure")
        }}</label>
        <OInput
          v-model="retries"
          type="number"
          class="w-25!"
          :placeholder="raw('0')"
          data-test="synthetics-check-retries-count-input"
        />
        <span class="text-text-body text-sm whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retriesOnFailureSuffix")
        }}</span>
      </div>
      <div class="flex flex-nowrap items-center gap-2">
        <label class="text-text-body w-32 text-sm font-medium whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retryDelay")
        }}</label>
        <OInput
          v-model="retryDelayMs"
          type="number"
          class="w-25!"
          :placeholder="raw('0')"
          data-test="synthetics-check-retries-delay-input"
        />
        <span class="text-text-body text-sm whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retryDelaySuffix")
        }}</span>
      </div>
      <!-- Validation error -->
      <p
        v-if="props.validationErrors?.retries"
        class="text-status-error-text text-xs"
        data-test="synthetics-check-retries-error"
      >
        {{ props.validationErrors.retries }}
      </p>
    </div>
  </div>
</template>
