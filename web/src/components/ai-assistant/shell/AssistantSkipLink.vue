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

<template>
  <!-- A wrapper holds sr-only, since the button's own layout classes would override it -->
  <div
    v-if="visible"
    class="sr-only focus-within:not-sr-only focus-within:fixed focus-within:start-2 focus-within:top-2 focus-within:z-6000"
  >
    <OButton variant="primary" size="sm" data-test="assistant-skip-link" @click="skip">
      {{ t("assistant.shell.skipLink", { product }) }}
    </OButton>
  </div>
</template>

<script lang="ts">
const SIDEBAR_ROOT = '[data-assistant-root][data-placement="sidebar"]';

/** The composer, else the gate's primary action, else the sidebar root itself (`95` §1). */
export function skipTarget(doc: Document = document): HTMLElement | null {
  const root = doc.querySelector<HTMLElement>(SIDEBAR_ROOT);
  return (
    root?.querySelector<HTMLElement>("[data-assistant-composer]") ??
    root?.querySelector<HTMLElement>('[data-test="assistant-gate-state"] button') ??
    root ??
    null
  );
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

import {
  useAssistantName,
  useAssistantPlacement,
  useAssistantStore,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

import { useLockedPanel } from "./lockedPanel";

const { t } = useI18nTyped();
const { product } = useAssistantName();
const placement = useAssistantPlacement(useAssistantStore());
const lockedPanel = useLockedPanel();
const route = useRoute();

const visible = computed(
  () =>
    route.name !== "assistant" &&
    (placement.placement.value.kind === "sidebar" || !!lockedPanel.value),
);

function skip(): void {
  skipTarget()?.focus();
}
</script>
