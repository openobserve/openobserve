<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserCheck } from "@/types/synthetics";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

const { t } = useI18n();

const props = defineProps<{
  check: BrowserCheck;
  checkType?: "browser" | "api";
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
