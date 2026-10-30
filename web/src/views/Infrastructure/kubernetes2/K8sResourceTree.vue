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
import { computed, reactive, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { filterTree, type NodeSummary, type TreeGroup } from "./k8sTree";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import type { SegmentedBarSegment } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import type { View } from "./kubernetesQueries";

const props = defineProps<{
  groups: TreeGroup[];
  active: View;
  nodes: NodeSummary | null;
}>();
const emit = defineEmits<{ select: [view: View] }>();

const { t } = useI18nTyped();

const nodeSegments = computed<SegmentedBarSegment[]>(() => {
  const { ready = 0, total = 0 } = props.nodes ?? {};
  const pct = (count: number) => (total ? (count / total) * 100 : 0);
  return [
    { id: "ready", pct: pct(ready), variant: "success" },
    { id: "not-ready", pct: pct(total - ready), variant: "danger" },
  ];
});

const query = ref("");
const COLLAPSED_KEY = "k8s2.tree.collapsed";

const readCollapsed = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const collapsed = reactive<Record<string, boolean>>(readCollapsed());

watch(collapsed, (value) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the groups just open again next time.
  }
});

const context = computed(() =>
  [props.nodes?.provider, props.nodes?.region, props.nodes?.version].filter(Boolean).join(" · "),
);

const visible = computed(() => filterTree(props.groups, query.value, (key) => String(t(key))));

// A filter has to show its matches, so groups the user collapsed open up while one is typed.
const isOpen = (id: string) => !collapsed[id] || query.value.trim() !== "";

const setOpen = (id: string, open: boolean) => {
  collapsed[id] = !open;
};
</script>

<template>
  <aside
    class="bg-surface-panel border-border-default flex h-full min-h-0 w-60 shrink-0 flex-col border-e max-lg:w-48"
    data-test="k8s2-tree"
  >
    <div class="flex shrink-0 flex-col gap-2 p-3">
      <OText v-if="context" class="text-text-secondary text-xs" data-test="k8s2-tree-context">{{
        raw(context)
      }}</OText>
      <div v-if="nodes" class="flex flex-col gap-1.5" data-test="k8s2-tree-nodes">
        <div class="flex min-w-0 items-center gap-1.5 text-xs">
          <OIcon name="dns" size="xs" class="text-text-secondary shrink-0" aria-hidden="true" />
          <span
            class="min-w-0 flex-1 font-medium"
            :class="nodes.ready < nodes.total ? 'text-status-warning-text' : 'text-text-body'"
            data-test="k8s2-tree-subtitle"
            >{{
              t(
                "infra.k8s2.treeNodesReady",
                { ready: nodes.ready, total: nodes.total },
                nodes.total,
              )
            }}</span
          >
        </div>
        <OSegmentedBar :segments="nodeSegments" />
      </div>
      <OSearchInput
        v-model="query"
        size="sm"
        :placeholder="t('infra.k8s2.treeFilter')"
        data-test="k8s2-tree-filter"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      <OTabs
        :model-value="active"
        orientation="vertical"
        class="w-full"
        @change="(view: string | number) => emit('select', view as View)"
      >
        <template v-for="group in visible" :key="group.id">
          <OCollapsible
            variant="sidebar"
            trigger-class="ps-0.5! gap-1!"
            :model-value="isOpen(group.id)"
            :data-test="`k8s2-tree-group-${group.id}`"
            @update:model-value="(open: boolean) => setOpen(group.id, open)"
          >
            <template #trigger>
              <OText class="text-text-secondary text-xs font-semibold">{{ t(group.label) }}</OText>
            </template>
            <div class="flex flex-col ps-3">
              <OTab
                v-for="item in group.items"
                :key="item.view"
                :name="item.view"
                class="w-full border-transparent!"
                :data-test="`k8s2-rail-${item.view}`"
              >
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <OIcon :name="item.icon" size="sm" aria-hidden="true" />
                  <OTruncatedText class="min-w-0 flex-1 text-left">{{
                    t(item.label)
                  }}</OTruncatedText>
                  <OBadge
                    v-if="item.bad > 0"
                    variant="error-soft"
                    size="xs"
                    class="tabular-nums"
                    :data-test="`k8s2-tree-bad-${item.view}`"
                    >{{ item.bad }}</OBadge
                  >
                  <span
                    v-if="item.count != null"
                    class="text-text-secondary text-xs tabular-nums"
                    :data-test="`k8s2-tree-count-${item.view}`"
                    >{{ item.count }}</span
                  >
                </span>
              </OTab>
            </div>
          </OCollapsible>
        </template>
      </OTabs>
    </div>

    <div
      class="border-border-default text-text-secondary flex shrink-0 items-center gap-1.5 border-t px-3 py-2 text-xs"
      data-test="k8s2-tree-readonly"
    >
      <OIcon name="lock" size="xs" aria-hidden="true" />
      {{ t("infra.k8s2.treeReadOnly") }}
    </div>
  </aside>
</template>
