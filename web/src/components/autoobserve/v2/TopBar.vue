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
  <div
    class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    data-test="autoobserve2-topbar"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <h1 class="text-text-heading flex items-center gap-2 font-semibold">
        <span
          class="bg-accent text-text-inverse rounded-default flex size-7 items-center justify-center"
        >
          <OIcon name="auto-awesome" size="sm" />
        </span>
        {{ t("autoobserve2.topbar.brand") }}
      </h1>
      <span class="text-text-muted max-sm:hidden" aria-hidden="true">·</span>
      <span class="text-text-body">{{ today }}</span>
      <span class="text-text-muted max-sm:hidden" aria-hidden="true">·</span>
      <span class="text-text-body">{{
        t("autoobserve2.topbar.checked", { count: LAST_CHECKED }, LAST_CHECKED)
      }}</span>
    </div>
    <nav class="flex flex-wrap items-center gap-1" data-test="autoobserve2-nav">
      <ViewSwitch class="me-1" />
      <OButton
        variant="ghost-muted"
        size="sm"
        icon-left="history"
        data-test="autoobserve2-nav-history"
        @click="emit('open', 'history')"
      >
        {{ t("autoobserve2.nav.history") }}
      </OButton>
      <OButton
        variant="ghost-muted"
        size="icon-sm"
        :aria-label="t('autoobserve2.nav.settings')"
        data-test="autoobserve2-nav-settings"
        @click="emit('open', 'settings')"
      >
        <OIcon name="settings" size="sm" />
        <OTooltip :content="t('autoobserve2.nav.settings')" />
      </OButton>
      <OButton
        variant="ghost-muted"
        size="icon-sm"
        :aria-label="t('autoobserve2.nav.howItWorks')"
        data-test="autoobserve2-nav-how-it-works"
        @click="emit('open', 'howItWorks')"
      >
        <OIcon name="help-outline" size="sm" />
        <OTooltip :content="t('autoobserve2.nav.howItWorks')" />
      </OButton>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ViewSwitch from "./ViewSwitch.vue";
import { DEMO_DATE } from "../data/facts";
import { LAST_CHECKED } from "./fixtures";

const emit = defineEmits<{
  open: [drawer: "history" | "settings" | "howItWorks"];
}>();

const { t, locale } = useI18nTyped();

// The date follows the demo dataset so "Today" in every entry matches it; the greeting follows the viewer.
const today = computed(() =>
  new Date(Date.UTC(...DEMO_DATE, 12)).toLocaleDateString(locale.value, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }),
);
</script>
