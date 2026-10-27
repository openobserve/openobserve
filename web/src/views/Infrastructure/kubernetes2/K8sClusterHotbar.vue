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
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { clusterHue, type ClusterTone } from "./k8sTree";

export interface HotbarCluster {
  name: string;
  code: string;
  tone: ClusterTone;
  nodes: { ready: number; total: number } | null;
}

defineProps<{ clusters: HotbarCluster[]; active: string | null }>();
const emit = defineEmits<{ select: [name: string]; all: [] }>();

const { t } = useI18nTyped();

const DOT_CLASS: Record<ClusterTone, string> = {
  success: "bg-status-success-text",
  warning: "bg-status-warning-text",
  error: "bg-status-error-text",
  neutral: "bg-status-neutral-text",
};

const HEALTH_KEY: Record<ClusterTone, I18nKey> = {
  success: "infra.k8s2.healthHealthy",
  warning: "infra.k8s2.healthWarning",
  error: "infra.k8s2.healthCritical",
  neutral: "infra.k8s2.healthSilent",
};

const HUE_VARIANT = ["tint-teal", "tint-purple", "tint-blue", "tint-orange"] as const;
</script>

<template>
  <nav
    class="bg-surface-base border-border-default flex w-14 shrink-0 flex-col items-center gap-2 border-e py-2 max-md:hidden"
    :aria-label="t('infra.k8s2.hotbarLabel')"
    data-test="k8s2-hotbar"
  >
    <OText class="text-text-secondary text-2xs shrink-0 font-semibold">{{
      t("infra.k8s2.hotbarTitle")
    }}</OText>
    <div
      class="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1"
      data-test="k8s2-hotbar-list"
    >
      <OButton
        v-for="cluster in clusters"
        :key="cluster.name"
        :variant="HUE_VARIANT[clusterHue(cluster.name)]"
        size="icon-lg"
        class="rounded-surface relative size-10 shrink-0 transition-shadow"
        :class="cluster.name === active ? 'ring-accent shadow-md ring-2' : ''"
        :aria-label="
          t('infra.k8s2.hotbarTileLabel', {
            name: raw(cluster.name),
            health: t(HEALTH_KEY[cluster.tone]),
          })
        "
        :aria-current="cluster.name === active ? 'true' : undefined"
        :data-test="`k8s2-hotbar-${cluster.name}`"
        @click="emit('select', cluster.name)"
      >
        <span class="text-sm font-bold tracking-tight">{{ raw(cluster.code) }}</span>
        <span
          class="border-surface-base absolute -end-0.5 -bottom-0.5 size-3 rounded-full border-2"
          :class="DOT_CLASS[cluster.tone]"
          :data-test="`k8s2-hotbar-dot-${cluster.name}`"
          aria-hidden="true"
        />
        <OTooltip side="right">
          <template #content>
            <div class="flex flex-col gap-0.5 text-xs">
              <span class="font-semibold">{{ raw(cluster.name) }}</span>
              <span>{{ t(HEALTH_KEY[cluster.tone]) }}</span>
              <span v-if="cluster.nodes">{{
                t(
                  "infra.k8s2.treeNodesReady",
                  { ready: cluster.nodes.ready, total: cluster.nodes.total },
                  cluster.nodes.total,
                )
              }}</span>
            </div>
          </template>
        </OTooltip>
      </OButton>
    </div>
    <OButton
      v-if="clusters.length > 1"
      variant="outline"
      size="icon-lg"
      class="size-10 shrink-0"
      :aria-label="t('infra.k8s2.hotbarAll')"
      data-test="k8s2-hotbar-all"
      @click="emit('all')"
    >
      <OIcon name="list" size="sm" />
      <OTooltip :content="t('infra.k8s2.hotbarAll')" side="right" />
    </OButton>
  </nav>
</template>
