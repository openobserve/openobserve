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
  The list "Used by" cell: per-kind count badges for one row, sourced from the
  shared dependency graph (so it can't disagree with the impact dialog it opens).
  An orphan/missing entity collapses to a single Unused/Missing chip; clicking the
  cell opens the impact dialog.
-->
<template>
  <OButton
    variant="ghost"
    size="sm"
    class="h-auto! gap-1! px-1.5! py-1! font-normal!"
    :data-test="`used-by-${key}`"
    @click.stop="open = true"
  >
    <OIcon v-if="!loaded" name="graph-1" size="sm" class="text-text-muted" />

    <OTag v-else-if="isMissing" type="countChip" value="error">
      {{ t("alert_dependencies.missingTag") }}
    </OTag>

    <OTag
      v-else-if="isUnused"
      type="countChip"
      value="neutral"
      :data-test="`used-by-${key}-unused`"
    >
      {{ t("alert_dependencies.orphanTag") }}
    </OTag>

    <template v-else>
      <OTag
        v-for="b in badges"
        :key="b.kind"
        type="countChip"
        value="neutral"
        :data-test="`used-by-${key}-${b.kind}`"
      >
        <OIcon :name="depKindIcon(b.kind)" size="xs" class="mr-0.5" :class="kindColor(b.kind)" />
        {{ b.count }}
        <OTooltip side="top" :content="b.label" />
      </OTag>
    </template>
  </OButton>

  <DependencyImpactDialog v-model:open="open" :focus="focus" @deleted="emit('deleted', $event)" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DependencyImpactDialog from "./DependencyImpactDialog.vue";
import { focusSummary, depKindIcon, depKindColor } from "@/composables/alerts/useDependencyGraph";
import type { DepGraph, DepFocus, DepNodeKind } from "@/composables/alerts/useDependencyGraph";

const props = defineProps<{ graph: DepGraph; focus: DepFocus }>();
const emit = defineEmits<{ (e: "deleted", kind: DepNodeKind): void }>();

const { t } = useI18nTyped();

const open = ref(false);

// The graph is fetched by the host page; until it lands, show the neutral graph
// icon (the dialog loads its own copy on open) instead of flashing a false "Unused".
const loaded = computed(() => props.graph.nodes.length > 0);
const summary = computed(() => focusSummary(props.graph, props.focus));
const key = computed(() => props.focus.name ?? props.focus.alertId ?? "");

const isMissing = computed(() => !!summary.value.node?.missing);

// Downstream only, in delivery order: a template shows its destinations then
// alerts; a destination shows just its alerts. Nothing "upstream" (a template a
// destination uses) — that isn't what this entity is used by.
const badges = computed(() => {
  const c = summary.value.counts;
  const out: { kind: DepNodeKind; count: number; label: I18nText }[] = [];
  if (props.focus.kind === "template" && c.destinations)
    out.push({
      kind: "destination",
      count: c.destinations,
      label: t("alert_dependencies.countDestinations", { count: c.destinations }, c.destinations),
    });
  if (c.alerts)
    out.push({
      kind: "alert",
      count: c.alerts,
      label: t("alert_dependencies.usedBy", { count: c.alerts }, c.alerts),
    });
  return out;
});

// Orphan (nothing uses it) wins over any downstream badge — a destination with a
// template but zero alerts still reads "Unused". An entity with no neighbours at
// all falls here too.
const isUnused = computed(
  () =>
    loaded.value && !isMissing.value && (!!summary.value.node?.orphan || badges.value.length === 0),
);

const kindColor = (kind: DepNodeKind) => depKindColor({ kind, orphan: false, missing: false });
</script>
