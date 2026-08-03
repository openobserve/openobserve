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
import type { BrowserCheck } from "@/types/synthetics";
import OSelect from "@/lib/forms/Select/OSelect.vue";

const props = defineProps<{ check: BrowserCheck }>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();

const captureOptions = computed(() => [
  { label: t("synthetics.capture.options.always"), value: "always" },
  { label: t("synthetics.capture.options.onFail"), value: "on-fail" },
  { label: t("synthetics.capture.options.off"), value: "off" },
]);

const screenshot = computed({
  get: () => props.check.capture.screenshot,
  set: (v: BrowserCheck["capture"]["screenshot"]) =>
    emit("update:check", {
      ...props.check,
      capture: { ...props.check.capture, screenshot: v },
    }),
});

const screenshotDescription = computed(() => {
  switch (screenshot.value) {
    case "always":
      return t("synthetics.capture.screenshotDescriptionAlways");
    case "on-fail":
      return t("synthetics.capture.screenshotDescriptionOnFail");
    case "off":
      return t("synthetics.capture.screenshotDescriptionOff");
    default:
      return "";
  }
});
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">{{ t("synthetics.capture.title") }}</h3>
    </div>
    <div class="flex flex-col gap-4 px-3 py-2">
      <div class="flex items-center gap-4">
        <label class="text-text-body w-24 shrink-0 text-sm font-medium">{{
          t("synthetics.capture.screenshot")
        }}</label>
        <OSelect
          v-model="screenshot"
          :options="captureOptions"
          class="w-40!"
          data-test="synthetics-check-capture-screenshot"
        />
        <p class="text-text-secondary text-sm">
          {{ screenshotDescription }}
        </p>
      </div>
    </div>
  </div>
</template>
