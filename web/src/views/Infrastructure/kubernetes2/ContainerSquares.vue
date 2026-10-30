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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ContainerRow, ContainerState } from "./kubernetesModel";

defineProps<{ containers: ContainerRow[] }>();

const { t } = useI18nTyped();

const SQUARE_CLASS: Record<ContainerState, string> = {
  terminated: "border border-border-strong",
  restarted: "bg-status-positive ring-1 ring-offset-1 ring-status-warning-text",
  ready: "bg-status-positive",
  waiting: "bg-status-warning-bg border border-status-warning-text",
  unknown: "bg-surface-subtle",
};

const stateText = (c: ContainerRow): I18nText => {
  switch (c.state) {
    case "terminated":
      return t("infra.k8s2.containerTerminated", { reason: raw(c.terminatedReason ?? "") });
    case "restarted":
    case "ready":
      return t("infra.k8s2.containerRunningReady");
    case "waiting":
      return c.waitingReason
        ? t("infra.k8s2.containerWaitingReason", { reason: raw(c.waitingReason) })
        : t("infra.k8s2.containerWaiting");
    default:
      return t("infra.k8s2.containerUnknown");
  }
};

const tip = (c: ContainerRow): I18nText =>
  t("infra.k8s2.containerTip", {
    name: raw(c.name),
    state: stateText(c),
    restarts: c.restarts ?? "—",
    image: raw(c.image ?? "—"),
  });
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-2" data-test="k8s2-container-squares">
    <span
      v-for="c in containers"
      :key="c.name"
      class="inline-block size-2 shrink-0"
      :class="SQUARE_CLASS[c.state]"
      :data-test="`k8s2-container-square-${c.name}`"
      :data-state="c.state"
    >
      <OTooltip :content="tip(c)" />
    </span>
  </span>
</template>
