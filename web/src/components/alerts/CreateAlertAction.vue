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

<!--
  The one entry point for "create an alert from here", in whichever shape the
  host surface needs: a dropdown item, a button, or a bare icon button.

  A surface supplies `source` and `build`; this owns the label, icon, disabled
  tooltip, confirm dialog, and the hand-off to the alert form. That is what
  keeps integration down to an adapter plus two i18n keys — see the design's
  §4, "Integrating a new surface".

  `build` is called on click, never on render, so merely displaying the item
  costs the host nothing.
-->

<template>
  <ODropdownItem
    v-if="variant === 'menu-item'"
    :disabled="!!disabledReason"
    :icon-left="source_.icon"
    :data-test="dataTest"
    @select="onActivate"
  >
    <span>{{ label }}</span>
    <OTooltip v-if="disabledReason" :content="disabledReason" side="left" />
  </ODropdownItem>

  <OButton
    v-else-if="variant === 'button'"
    :variant="buttonVariant"
    size="sm-action"
    :disabled="!!disabledReason"
    :icon-left="source_.icon"
    :data-test="dataTest"
    @click="onActivate"
  >
    {{ label }}
    <OTooltip v-if="disabledReason" :content="disabledReason" side="top" />
  </OButton>

  <OButton
    v-else
    variant="ghost"
    size="sm"
    :disabled="!!disabledReason"
    :icon-left="source_.icon"
    :aria-label="label"
    :data-test="dataTest"
    @click="onActivate"
  >
    <OTooltip :content="disabledReason || label" side="top" />
  </OButton>

  <CreateAlertFromSourceDialog
    v-model:open="dialogOpen"
    :prefill="pendingPrefill"
    @confirm="onConfirm"
    @cancel="pendingPrefill = null"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import CreateAlertFromSourceDialog from "@/components/alerts/CreateAlertFromSourceDialog.vue";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { normalizePrefill } from "@/utils/alerts/alertPrefill";
import { getAlertSource } from "@/utils/alerts/alertSourceRegistry";
import { useAlertCreation } from "@/composables/alerts/useAlertCreation";

const props = withDefaults(
  defineProps<{
    /** Registered source id — see utils/alerts/alertSourceRegistry.ts. */
    source: string;
    /** Builds the prefill from the host's current state. Called on click only. */
    build: () => AlertPrefill;
    variant?: "menu-item" | "button" | "icon";
    /** Non-null disables the control and is shown as the tooltip reason. */
    disabledReason?: string | null;
    /** Folder the alert lands in. */
    folder?: string;
    buttonVariant?: "primary" | "secondary" | "outline" | "ghost";
    dataTest?: string;
  }>(),
  {
    variant: "menu-item",
    disabledReason: null,
    buttonVariant: "primary",
    dataTest: "create-alert-action",
  },
);

const { t } = useI18n();
const { openAlertCreation } = useAlertCreation();

const dialogOpen = ref(false);
const pendingPrefill = ref<AlertPrefill | null>(null);

const source_ = computed(() => getAlertSource(props.source));
const label = computed(() => t(source_.value.labelKey));

const onActivate = () => {
  if (props.disabledReason) return;

  // Normalized up front so the dialog can show the blocking reason rather than
  // the user discovering it after landing in the form.
  pendingPrefill.value = normalizePrefill(props.build());
  dialogOpen.value = true;
};

const onConfirm = (prefill: AlertPrefill) => {
  openAlertCreation(prefill, { folder: props.folder });
  pendingPrefill.value = null;
};
</script>
