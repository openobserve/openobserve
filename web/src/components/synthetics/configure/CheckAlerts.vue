<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import type { BrowserCheck } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";

const props = defineProps<{
  check: BrowserCheck;
  destinations: string[];
  validationErrors?: Record<string, string>;
}>();

const emit = defineEmits<{
  "update:check": [value: BrowserCheck];
  "refresh:destinations": [];
}>();

const { t } = useI18n();
const store = useStore();
const router = useRouter();

// ─── destinations ─────────────────────────────────────────────────────────────

const localDestinations = computed({
  get: () => props.check.notifications.destinations,
  set: (v: string[]) =>
    emit("update:check", { ...props.check, notifications: { destinations: v } }),
});

// ─── failure threshold ────────────────────────────────────────────────────────

const failureThreshold = computed({
  get: () => props.check.alertIfFails ?? 1,
  set: (v: string | number) => emit("update:check", { ...props.check, alertIfFails: Number(v) }),
});

function routeToCreateDestination() {
  const url = router.resolve({
    name: "alertDestinations",
    query: {
      action: "add",
      org_identifier: store.state.selectedOrganization.identifier,
    },
  }).href;
  window.open(url, "_blank");
}

// ─── cooldown ─────────────────────────────────────────────────────────────────

const silenceMinutes = computed({
  get: () => props.check.cooldownMins ?? 5,
  set: (v: string | number) => emit("update:check", { ...props.check, cooldownMins: Number(v) }),
});
</script>

<template>
  <div
    class="rounded-default border-border-default mb-4 border"
    data-test="synthetics-check-alerts"
  >
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.scheduleAlert.alerts") }}
      </h3>
    </div>
    <div class="flex flex-col gap-4 px-3 py-2">
      <!-- ── Destinations (optional) ────────────────────────────────────── -->
      <div>
        <div class="flex items-center gap-2">
          <label class="text-text-body mb-1 block w-32 text-sm font-medium">
            {{ t("synthetics.scheduleAlert.destinations") }}
          </label>
          <OSelect
            v-model="localDestinations"
            :options="destinations"
            multiple
            class="max-w-75 min-w-45"
            data-test="synthetics-check-alerts-destinations-select"
          >
            <template #empty>{{ t("synthetics.scheduleAlert.noDestinations") }}</template>
          </OSelect>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            :title="t('synthetics.scheduleAlert.refreshDestinations')"
            data-test="synthetics-check-alerts-refresh-destinations-btn"
            @click="emit('refresh:destinations')"
          >
            <OIcon name="refresh" size="sm" />
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-check-alerts-add-destination-btn"
            @click="routeToCreateDestination"
          >
            {{ t("synthetics.scheduleAlert.addNewDestination") }}
          </OButton>
        </div>
      </div>

      <!-- ── Alert threshold ──────────────────────────────────────────── -->
      <div class="flex flex-nowrap items-center gap-2">
        <label class="text-text-body w-32 text-sm font-medium whitespace-nowrap">{{
          t("synthetics.scheduleAlert.alertedIfFails")
        }}</label>
        <OInput
          v-model="failureThreshold"
          type="number"
          class="w-25!"
          :placeholder="'1'"
          data-test="synthetics-check-alerts-threshold-input"
        />
        <span class="text-text-body text-sm whitespace-nowrap">{{
          t("synthetics.scheduleAlert.alertedIfFailsSuffix")
        }}</span>
      </div>

      <!-- ── Cooldown Period ────────────────────────────────────────────── -->
      <div class="flex items-center gap-2">
        <label class="text-text-body flex w-32 items-center text-sm font-medium">
          {{ t("synthetics.scheduleAlert.cooldownPeriod") }}
        </label>
        <div class="flex items-center">
          <div class="w-21.75">
            <OInput
              v-model="silenceMinutes"
              type="number"
              min="0"
              data-test="synthetics-check-alerts-cooldown-input"
            />
          </div>
          <div class="text-text-body flex h-7 items-center justify-center pl-2 text-sm">
            {{ t("synthetics.scheduleAlert.minutes") }}
          </div>
        </div>
      </div>

      <!-- Validation error -->
      <p
        v-if="props.validationErrors?.alerts"
        class="text-status-error-text text-xs"
        data-test="synthetics-check-alerts-error"
      >
        {{ props.validationErrors.alerts }}
      </p>
    </div>
  </div>
</template>
