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
    class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
    role="status"
    :data-test="`overview-status-${status.kind}`"
  >
    <OIcon :name="look.icon" size="sm" :class="['shrink-0', look.tone]" />
    <span class="font-medium" :class="look.tone" data-test="overview-status-text">{{
      headline
    }}</span>
    <template v-for="pack in quietPacks" :key="pack.pack.id">
      <span class="text-text-secondary" aria-hidden="true">{{ raw("·") }}</span>
      <span class="text-text-heading" :data-test="pack.testId('overview-status-pack-silent')">{{
        t(
          "starterPacks.home.silentTitle",
          { count: pack.flow.alertsOff.value, title: pack.title },
          pack.flow.alertsOff.value,
        )
      }}</span>
      <span class="text-text-secondary" aria-hidden="true">{{ raw("·") }}</span>
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="pack.testId('overview-status-pack-turn-on-btn')"
        @click="pack.openTurnOn"
      >
        {{ t("starterPacks.home.turnOn") }}
      </OButton>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { HomePack } from "@/composables/starterPacks/useHomePacks";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { OverviewStatus, OverviewStatusKind } from "./overviewFormat";

const props = defineProps<{ status: OverviewStatus; silent?: HomePack[] }>();

const { t } = useI18nTyped();

const LOOKS: Record<OverviewStatusKind, { icon: IconName; tone: string }> = {
  danger: { icon: "error", tone: "text-status-negative" },
  warning: { icon: "warning", tone: "text-status-warning-text" },
  checking: { icon: "schedule", tone: "text-text-secondary" },
  partial: { icon: "warning-amber", tone: "text-status-warning-text" },
  unmonitored: { icon: "info-outline", tone: "text-text-secondary" },
  clear: { icon: "check-circle", tone: "text-status-positive" },
};

const HEADLINES: Record<OverviewStatusKind, I18nKey> = {
  danger: "overview.status.attention",
  warning: "overview.status.attention",
  checking: "overview.status.checking",
  partial: "overview.status.partial",
  unmonitored: "overview.status.unmonitored",
  clear: "overview.status.clear",
};

// Silent pack alerts only reword a calm line; a real problem keeps its own headline.
const quietPacks = computed(() =>
  props.status.kind === "clear" || props.status.kind === "unmonitored" ? (props.silent ?? []) : [],
);

const look = computed(() =>
  quietPacks.value.length
    ? { icon: "notifications-off" as IconName, tone: "text-status-warning-text" }
    : LOOKS[props.status.kind],
);

const headline = computed<I18nText>(() =>
  quietPacks.value.length ? t("overview.status.noAlertsFiring") : t(HEADLINES[props.status.kind]),
);
</script>
