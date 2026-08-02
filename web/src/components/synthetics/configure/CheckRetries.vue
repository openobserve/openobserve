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
import type { BrowserCheck } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";

const props = defineProps<{
  check: BrowserCheck;
  validationErrors?: Record<string, string>;
}>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18n();

/**
 * Retry ceiling for this check's type, mirroring the server's
 * `SyntheticType::max_retries()`.
 *
 * Browser is capped lower, and the cap is load-bearing rather than a
 * preference: a browser run costs devices x attempts x journey_budget, so at 3
 * retries a ~100s journey already reaches the browser Lambda's function
 * timeout. The config would validate here and then be killed mid-journey,
 * reporting a failure the target never had.
 *
 * Protocol checks are one request per attempt, so their worst case stays well
 * inside the budget.
 */
const MAX_BROWSER_RETRIES = 2;
const MAX_NET_RETRIES = 3;

/** `checkType` is present on ProtocolCheck only; BrowserCheck has no discriminator. */
const isBrowser = computed(() => !("checkType" in props.check));
const maxRetries = computed(() => (isBrowser.value ? MAX_BROWSER_RETRIES : MAX_NET_RETRIES));

const retries = computed({
  get: () => props.check.retries ?? 0,
  // Clamped rather than only bounded by the input's `max`: a typed value
  // bypasses the spinner, and the server would reject it on save with an error
  // the user has to read to understand. Correcting it here is quieter.
  set: (v: string | number) => {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), maxRetries.value) : 0;
    emit("update:check", { ...props.check, retries: clamped });
  },
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
          min="0"
          :max="maxRetries"
          class="w-25!"
          placeholder="0"
          data-test="synthetics-check-retries-count-input"
        />
        <span class="text-text-body text-sm whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retriesOnFailureSuffix")
        }}</span>
      </div>
      <!-- Why the ceiling exists, not just what it is: a browser run multiplies
           by devices and attempts, and a config that outruns the probe's
           function timeout is killed mid-journey. -->
      <p class="text-text-secondary text-xs" data-test="synthetics-check-retries-max-hint">
        {{
          isBrowser
            ? t("synthetics.scheduleAlert.retriesMaxBrowserHint", { max: maxRetries })
            : t("synthetics.scheduleAlert.retriesMaxHint", { max: maxRetries })
        }}
      </p>
      <div class="flex flex-nowrap items-center gap-2">
        <label class="text-text-body w-32 text-sm font-medium whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retryDelay")
        }}</label>
        <OInput
          v-model="retryDelayMs"
          type="number"
          class="w-25!"
          placeholder="0"
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
