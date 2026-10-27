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

<!-- A screenshot of the OpenObserve page an option fills, in a browser window that cuts it off at
     the bottom. The picture is hidden from screen readers; they get the caption. -->
<template>
  <figure
    class="flex flex-col"
    data-test="onboarding-example"
    :data-kind="kind"
    :data-row="rowShot ? row : undefined"
  >
    <div
      aria-hidden="true"
      class="bg-surface-base rounded-ss-surface flex min-h-0 flex-1 flex-col overflow-hidden shadow-lg"
      data-test="onboarding-example-frame"
    >
      <div
        class="bg-surface-subtle border-border-subtle flex h-7.5 shrink-0 items-center gap-1.5 border-b px-3"
      >
        <span v-for="dot in 3" :key="dot" class="bg-border-strong size-2.5 rounded-full" />
        <span
          class="bg-surface-base text-text-secondary rounded-default text-2xs ms-2.5 px-3 py-0.5"
          >{{ HOST }}</span
        >
      </div>
      <img
        :src="src"
        alt=""
        class="min-h-0 w-full flex-1 object-cover object-left-top"
        data-test="onboarding-example-image"
      />
    </div>
    <figcaption class="sr-only" data-test="onboarding-example-caption">
      {{
        rowShot && rowName
          ? t("onboarding.example.caption.row", { name: rowName, product: PRODUCT })
          : t(`onboarding.example.caption.${kind}`, NAMES)
      }}
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useTheme } from "@/composables/useTheme";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

import { ROW_SHOTS, type OnboardingExampleKind } from "./onboardingExamples";

const props = defineProps<{
  kind: OnboardingExampleKind;
  /** The step 2 row the user points at; its own screenshot wins over the choice's when it has one. */
  row?: string;
  rowName?: I18nText;
}>();

const { t } = useI18nTyped();
const { isDark } = useTheme();

const HOST = raw("cloud.openobserve.ai");
const PRODUCT = raw("OpenObserve");
// Product names in the captions; each caption uses the ones it names.
const NAMES = {
  k8s: raw("Kubernetes"),
  rum: raw("RUM"),
  insights: raw("AI Observability Insights"),
  mcp: raw("MCP"),
  http: raw("HTTP"),
};

const rowShot = computed(() => !!props.row && ROW_SHOTS.has(`${props.kind}-${props.row}`));
const src = computed(() => {
  const theme = isDark.value ? "dark" : "light";
  return getImageURL(
    rowShot.value
      ? `images/onboarding/rows/${props.kind}-${props.row}-${theme}.webp`
      : `images/onboarding/${props.kind}-${theme}.webp`,
  );
});
</script>
