<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
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
    class="rounded-default border border-border-default mb-4"
    data-test="synthetics-check-retries"
  >
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-0.75 h-4 rounded-default mr-2 shrink-0 bg-accent" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t("synthetics.scheduleAlert.retries") }}
      </h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-3">
      <div class="flex items-center gap-2 flex-nowrap">
        <label class="text-sm font-medium text-text-body whitespace-nowrap w-32">{{
          t("synthetics.scheduleAlert.retriesOnFailure")
        }}</label>
        <OInput
          v-model="retries"
          type="number"
          class="w-25!"
          placeholder="0"
          data-test="synthetics-check-retries-count-input"
        />
        <span class="text-sm text-text-body whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retriesOnFailureSuffix")
        }}</span>
      </div>
      <div class="flex items-center gap-2 flex-nowrap">
        <label class="text-sm font-medium text-text-body whitespace-nowrap w-32">{{
          t("synthetics.scheduleAlert.retryDelay")
        }}</label>
        <OInput
          v-model="retryDelayMs"
          type="number"
          class="w-25!"
          placeholder="0"
          data-test="synthetics-check-retries-delay-input"
        />
        <span class="text-sm text-text-body whitespace-nowrap">{{
          t("synthetics.scheduleAlert.retryDelaySuffix")
        }}</span>
      </div>
      <!-- Validation error -->
      <p
        v-if="props.validationErrors?.retries"
        class="text-xs text-status-error-text"
        data-test="synthetics-check-retries-error"
      >
        {{ props.validationErrors.retries }}
      </p>
    </div>
  </div>
</template>
