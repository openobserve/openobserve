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
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";

const props = defineProps<{
  check: BrowserCheck;
  destinations: string[];
  validationErrors?: Record<string, string>;
}>();

const emit = defineEmits<{
  "update:check": [value: BrowserCheck];
  "refresh:destinations": [];
}>();

const { t } = useI18nTyped();

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
      <!-- The shared alert-form field. Not required (a check may alert nowhere),
           no tooltip, and no Workflows group — a synthetics check has no
           workflow routing, so offering the group could not save. -->
      <AlertDestinationsField
        :destinations="localDestinations"
        :workflows="[]"
        :destination-options="destinations"
        :label="t('synthetics.scheduleAlert.destinations')"
        :required="false"
        tooltip=""
        :supports-workflows="false"
        data-test="synthetics-check-alerts-destinations"
        @update:destinations="localDestinations = $event"
        @refresh="emit('refresh:destinations')"
      />

      <!-- ── Alert threshold ──────────────────────────────────────────── -->
      <div class="flex flex-nowrap items-center gap-2">
        <label
          class="text-text-heading flex h-7 w-47.5 items-center font-semibold whitespace-nowrap"
          >{{ t("synthetics.scheduleAlert.alertedIfFails") }}</label
        >
        <OInput
          v-model="failureThreshold"
          type="number"
          class="w-25!"
          :placeholder="raw('1')"
          data-test="synthetics-check-alerts-threshold-input"
        />
        <span class="text-text-body text-sm whitespace-nowrap">{{
          t("synthetics.scheduleAlert.alertedIfFailsSuffix")
        }}</span>
      </div>

      <!-- ── Cooldown Period ────────────────────────────────────────────── -->
      <div class="flex items-center gap-2">
        <label class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
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
