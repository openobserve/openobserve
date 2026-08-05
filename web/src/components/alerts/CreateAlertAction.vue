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
    :data-test="dataTest"
    @select="onActivate"
  >
    <!-- Host menus present icons differently — the logs More menu badges them,
         the dashboards panel menu does not — so the presentation is the host's
         call while the icon NAME stays the registry's. -->
    <template #icon-left>
      <slot name="icon-left" :icon="source_.icon">
        <OIcon :name="source_.icon" size="sm" />
      </slot>
    </template>
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
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { AlertBuildOptions, AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { getAlertSource } from "@/utils/alerts/alertSourceRegistry";
import { needsConfirmation, normalizePrefill } from "@/utils/alerts/alertPrefill";
import { requestAlertCreation, useAlertCreation } from "@/composables/alerts/useAlertCreation";

const props = withDefaults(
  defineProps<{
    /** Registered source id — see utils/alerts/alertSourceRegistry.ts. */
    source: string;
    /**
     * Builds the prefill from the host's current state. Called on click only,
     * and again if the dialog re-parameterises it (see rebuildAlertPrefill).
     */
    build: (options?: AlertBuildOptions) => AlertPrefill;
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

const source_ = computed(() => getAlertSource(props.source));
const label = computed(() => t(source_.value.labelKey));

const onActivate = () => {
  if (props.disabledReason) return;

  const prefill = normalizePrefill(props.build());

  // Straight to the form unless there is genuinely something to decide. The
  // confirm dialog is an extra click every surface would otherwise pay on every
  // alert; lossy transforms are still reported, as a banner on the form itself.
  if (!needsConfirmation(prefill)) {
    openAlertCreation(prefill, { folder: props.folder });
    return;
  }

  // Hand the prefill to the app-level dialog rather than rendering one here:
  // this control is usually a dropdown item, and reka-ui unmounts the dropdown's
  // content on select, which would tear down a locally-owned dialog in the same
  // tick it opened.
  requestAlertCreation(prefill, { folder: props.folder }, props.build);
};
</script>
