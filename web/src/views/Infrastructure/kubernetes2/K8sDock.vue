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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import K8sLogsPanel from "./K8sLogsPanel.vue";
import K8sYamlPanel from "./K8sYamlPanel.vue";
import type { DockState } from "./dockState";
import type { AnyRow } from "./kubernetesModel";
import type { DetailsRef } from "./kubernetesUrlState";

const props = defineProps<{
  dock: DockState;
  orgId: string;
  range: { start: number; end: number; relative?: boolean };
  rowOf: (ref: DetailsRef) => AnyRow | null;
  // The open drawer (40rem) covers the end edge, so the dock stops short of it.
  reserveDrawer?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  close: [id: string];
  minimize: [];
  maximize: [];
  dismiss: [];
}>();

const { t } = useI18nTyped();

const active = computed(() => props.dock.tabs.find((tab) => tab.id === props.dock.active) ?? null);
const heightClass = computed(() => (props.dock.maximized ? "h-2/3" : "h-80"));
</script>

<template>
  <section
    v-if="dock.tabs.length"
    class="bg-surface-panel border-border-default flex shrink-0 flex-col border-t"
    :class="[dock.open ? heightClass : '', reserveDrawer ? 'lg:me-[40rem]' : '']"
    data-test="k8s2-dock"
  >
    <div class="border-border-default flex shrink-0 items-center gap-1 border-b ps-2 pe-1">
      <OTabs
        :model-value="dock.active ?? ''"
        class="min-w-0 flex-1"
        :data-test="'k8s2-dock-tabs'"
        @change="(id: string | number) => emit('select', String(id))"
      >
        <OTab v-for="tab in dock.tabs" :key="tab.id" :name="tab.id">
          <span class="flex items-center gap-1.5">
            <OIcon
              :name="tab.kind === 'logs' ? 'list' : 'description'"
              size="xs"
              aria-hidden="true"
            />
            <span class="text-xs">{{
              tab.kind === "logs" ? t("infra.k8s2.dockLogs") : t("infra.k8s2.dockYaml")
            }}</span>
            <OTruncatedText class="text-text-secondary max-w-40 text-xs">{{
              raw(tab.ref.name)
            }}</OTruncatedText>
          </span>
          <template #trailing>
            <OButton
              variant="ghost"
              size="icon-xs"
              :aria-label="t('infra.k8s2.dockCloseTab')"
              :data-test="`k8s2-dock-close-${tab.kind}`"
              @click.stop="emit('close', tab.id)"
            >
              <OIcon name="close" size="xs" />
            </OButton>
          </template>
        </OTab>
      </OTabs>
      <OButton
        variant="ghost"
        size="icon-xs"
        :aria-label="dock.open ? t('infra.k8s2.dockMinimize') : t('infra.k8s2.dockRestore')"
        data-test="k8s2-dock-minimize"
        @click="emit('minimize')"
      >
        <OIcon :name="dock.open ? 'remove' : 'expand-less'" size="sm" />
        <OTooltip
          :content="dock.open ? t('infra.k8s2.dockMinimize') : t('infra.k8s2.dockRestore')"
        />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-xs"
        :aria-label="dock.maximized ? t('infra.k8s2.dockUnmaximize') : t('infra.k8s2.dockMaximize')"
        data-test="k8s2-dock-maximize"
        @click="emit('maximize')"
      >
        <OIcon :name="dock.maximized ? 'close-fullscreen' : 'open-in-full'" size="sm" />
        <OTooltip
          :content="dock.maximized ? t('infra.k8s2.dockUnmaximize') : t('infra.k8s2.dockMaximize')"
        />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-xs"
        :aria-label="t('infra.k8s2.dockClose')"
        data-test="k8s2-dock-dismiss"
        @click="emit('dismiss')"
      >
        <OIcon name="close" size="sm" />
        <OTooltip :content="t('infra.k8s2.dockClose')" />
      </OButton>
    </div>
    <div v-if="dock.open && active" class="min-h-0 flex-1">
      <K8sLogsPanel
        v-if="active.kind === 'logs'"
        :key="active.id"
        :target="active.ref"
        :org-id="orgId"
        :range="range"
      />
      <K8sYamlPanel v-else :key="active.id" :row="active.snapshot ?? rowOf(active.ref)" />
    </div>
  </section>
</template>
