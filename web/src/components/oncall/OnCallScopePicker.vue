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
  What a team owns, chosen as a level of the estate rather than as a row of the
  service registry.

  The registry is not a list of services. Anything arriving without a `service`
  dimension is filed under its infrastructure identity or, failing that, its
  stream name — so `node_filesystem_used_percent`, `us-east-1c` and
  `aws_alb_httpcode_target_2xx_count` sit in it beside `payment-gateway`, and a
  real estate has ten thousand rows. Asking somebody to find the thing they own
  in that list is asking them to do the registry's filing by hand, and it is why
  the most powerful part of routing read as the least usable.

  Almost every real claim is one of three sentences:

      we own this cluster
      we own this namespace
      we own this service, wherever it runs

  So those are the choices, and the values behind each come from the identity
  the org has already described — not from the registry's raw row list. A level
  is offered only when telemetry has actually carried it, so the picker is short
  because the estate is, not because it was truncated.

  Anything else is Advanced, which is the old field-and-value builder, unchanged
  and one click away. This narrows the front door; it closes nothing.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-scope-picker">
    <!-- The levels, coarsest first, so the row itself reads as the hierarchy.
         Colour is `dimensionVariant`, the same function that colours these
         dimensions in the incident list and the correlation chips — a cluster
         is the same colour here as everywhere else it is named. -->
    <OToggleGroup
      :model-value="mode"
      data-test="oncall-scope-picker-modes"
      @update:model-value="(v: unknown) => v && selectMode(String(v))"
    >
      <OToggleGroupItem
        v-for="level in levels"
        :key="level.dimension"
        :value="level.dimension"
        size="sm"
        :data-test="`oncall-scope-mode-${level.dimension}`"
      >
        <template #icon-left>
          <!-- A filled dot rather than an icon per level: the levels are not a
               fixed set the product can ship icons for, and the dot carries the
               dimension's own colour, which is the thing worth recognising. -->
          <span
            class="size-2 shrink-0 rounded-full"
            :class="dotClassOf(level.dimension)"
            aria-hidden="true"
          />
        </template>
        {{ raw(level.label) }}
      </OToggleGroupItem>

      <OToggleGroupItem value="advanced" size="sm" data-test="oncall-scope-mode-advanced">
        <template #icon-left><OIcon name="tune" size="sm" /></template>
        {{ t("oncall.scopeAdvanced") }}
      </OToggleGroupItem>
    </OToggleGroup>

    <!-- One level selected: one value to pick, and for the finest level an
         optional narrowing to a single enclosing scope. -->
    <div v-if="active" class="flex flex-wrap items-end gap-2" data-test="oncall-scope-picker-value">
      <OSelect
        :model-value="value"
        :label="raw(active.label)"
        :options="valueOptions"
        :placeholder="t('oncall.scopeValuePlaceholder')"
        size="sm"
        width="md"
        searchable
        data-test="oncall-scope-value"
        @update:model-value="(v: unknown) => setValue(String(v ?? ''))"
      >
        <template #tooltip>
          <OTooltip side="right" :content="scopeHelp" />
        </template>
      </OSelect>

      <!-- Only for the finest level, and only when there is a coarser one to
           narrow to. "This service, everywhere" is the claim people mean far
           more often than "this service in this one cluster", so it is the
           default and the narrowing is the deliberate act. -->
      <OSelect
        v-if="narrowable"
        :model-value="narrowValue"
        :label="raw(narrowable.label)"
        :options="narrowOptions"
        size="sm"
        width="md"
        searchable
        data-test="oncall-scope-narrow"
        @update:model-value="(v: unknown) => setNarrow(String(v ?? ''))"
      >
        <template #tooltip>
          <OTooltip side="right" :content="t('oncall.scopeNarrowHelp')" />
        </template>
      </OSelect>
    </div>

    <!-- What the choice above actually claims, in a sentence. Inheritance is
         the part of this model people get wrong, and the only honest place to
         say it is beside the claim being made. -->
    <div
      v-if="claimed.length"
      class="border-border-subtle bg-surface-panel rounded-default flex flex-col gap-2 border px-3 py-2.5"
      data-test="oncall-scope-picker-claim"
    >
      <span class="flex flex-wrap items-center gap-1.5">
        <template v-for="(pair, index) in claimed" :key="pair.name">
          <OText v-if="index" variant="meta">{{ t("oncall.ruleEditorAnd") }}</OText>
          <ODimensionChip
            :dim-key="pair.name"
            :key-label="displayOf(pair.name)"
            :value="pair.value"
          />
        </template>
      </span>
      <OText variant="meta" data-test="oncall-scope-picker-consequence">
        {{ consequence }}
      </OText>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import { dimensionVariant } from "@/lib/core/Badge/badgeGroups";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IdentitySet } from "@/services/service_streams";
import type { DimensionCatalogue, DiscoveredService } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { SERVICE_DIMENSION } from "@/utils/oncall";

/** A level of the estate somebody can claim, coarsest first. */
export interface ScopeLevel {
  dimension: string;
  label: string;
  /** Position in the hierarchy — 0 is coarsest. `service` is always last. */
  depth: number;
}

const props = withDefaults(
  defineProps<{
    /** Conditions currently on the draft, in `{dimension: value}` form. */
    modelValue?: Record<string, string>;
    /** The org's identity sets — the ordered hierarchy, straight from config. */
    sets?: IdentitySet[];
    /** What this org emits, and how many services carry each value. */
    catalogue?: DimensionCatalogue;
    /** Discovered services, for the finest level's own value list. */
    services?: DiscoveredService[];
    /** Display names for dimensions, so a level reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
  }>(),
  {
    modelValue: () => ({}),
    sets: () => [],
    catalogue: () => ({ present: [], values: {} }),
    services: () => [],
    aliases: () => [],
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", dimensions: Record<string, string>): void;
  /** The reader asked for the field-and-value builder instead. */
  (e: "advanced"): void;
}>();

const { t } = useI18nTyped();

/// The levels, from the ordering the org already wrote.
///
/// `distinguish_by` is an ordered list per identity set, so an org that wrote
/// `[k8s-cluster, k8s-namespace]` has said a cluster contains namespaces. That
/// is the hierarchy — read here rather than asked for again on a routing
/// screen, where the two answers could disagree about the shape of one estate.
///
/// Deduped across sets by dimension, keeping the coarsest position, because a
/// dimension that is second in one set and first in another is at best
/// ambiguous and should not outrank one that is unambiguously finer. The
/// backend's `DimensionDepth::from_sets` resolves collisions the same way, so
/// this row and the decision it previews cannot disagree.
const levels = computed<ScopeLevel[]>(() => {
  const depths = new Map<string, number>();
  for (const set of props.sets) {
    set.distinguish_by.forEach((dimension, position) => {
      if (dimension === SERVICE_DIMENSION) return;
      const seen = depths.get(dimension);
      depths.set(dimension, seen === undefined ? position : Math.min(seen, position));
    });
  }

  const ordered = [...depths.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    // A level nothing has ever carried is a level nobody can pick a value for.
    // Offering it produces a rule that matches nothing, which is the failure
    // this picker exists to make impossible.
    .filter(([dimension]) => Object.keys(props.catalogue.values[dimension] ?? {}).length > 0)
    .map(([dimension], index) => ({
      dimension,
      label: displayOf(dimension),
      depth: index,
    }));

  // Service is finest by definition, and is offered whenever discovery has
  // named anything — it needs no identity set to be a real level.
  if (serviceNames.value.length) {
    ordered.push({
      dimension: SERVICE_DIMENSION,
      label: displayOf(SERVICE_DIMENSION),
      depth: ordered.length,
    });
  }
  return ordered;
});

/// Services that carry a real service name.
///
/// Deliberately the registry's `services` list rather than
/// `catalogue.values.service`: a row filed under a stream name has no `service`
/// dimension, so it never reaches the catalogue under that key, and the two
/// disagree by exactly the noise this picker is trying not to show.
const serviceNames = computed(() =>
  [...new Set(props.services.map((service) => service.name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  ),
);

const mode = ref("");
const value = ref("");
const narrowValue = ref("");

const active = computed(() => levels.value.find((level) => level.dimension === mode.value) ?? null);

/// The coarsest level, offered as an optional narrowing on the finest one.
///
/// Only on the finest level: at any other, narrowing is what picking a deeper
/// level already does, and offering both ways to say one thing is how a form
/// starts needing explaining.
const narrowable = computed(() => {
  if (!active.value || active.value.dimension !== SERVICE_DIMENSION) return null;
  return levels.value.find((level) => level.dimension !== SERVICE_DIMENSION) ?? null;
});

/// Read the draft back into the control whenever it changes underneath — the
/// host owns the dimensions, and an edit opened on an existing rule has to land
/// on the level that rule actually claims.
watch(
  () => props.modelValue,
  (dimensions) => {
    const names = Object.keys(dimensions ?? {});
    if (!names.length) {
      if (mode.value !== "advanced") mode.value = levels.value[0]?.dimension ?? "";
      value.value = "";
      narrowValue.value = "";
      return;
    }
    // The finest dimension present is the level being claimed; anything coarser
    // alongside it is the narrowing. A rule the picker cannot express in those
    // terms belongs to the field builder, and says so by landing there.
    const ranked = levels.value.filter((level) => names.includes(level.dimension));
    const finest = ranked[ranked.length - 1];
    if (!finest || names.length > 2 || (names.length === 2 && ranked.length < 2)) {
      // Say so rather than sitting on a level with nothing selected. The host
      // decides which builder is on screen, and it can only decide correctly if
      // the one that knows the claim is inexpressible is the one that tells it.
      mode.value = "advanced";
      emit("advanced");
      return;
    }
    mode.value = finest.dimension;
    value.value = String(dimensions[finest.dimension] ?? "");
    const narrow = ranked.length > 1 ? ranked[0] : null;
    narrowValue.value = narrow ? String(dimensions[narrow.dimension] ?? "") : "";
  },
  { immediate: true, deep: true },
);

function displayOf(name: string): string {
  return props.aliases.find((alias) => alias.id === name)?.display || name;
}

/// The colour the dimension carries everywhere else, as a filled dot.
///
/// Spelled out rather than interpolated: Tailwind scans source text for class
/// names, so a computed `bg-${tone}` is a class that exists at runtime and not
/// in the stylesheet — the dot renders, invisibly, in every colour.
const DOT_CLASSES: Record<string, string> = {
  "default-soft": "bg-badge-default-soft-text",
  "primary-soft": "bg-badge-primary-soft-text",
  "success-soft": "bg-badge-success-soft-text",
  "warning-soft": "bg-badge-warning-soft-text",
  "error-soft": "bg-badge-error-soft-text",
  "amber-soft": "bg-badge-amber-soft-text",
  "blue-soft": "bg-badge-blue-soft-text",
  "cyan-soft": "bg-badge-cyan-soft-text",
  "indigo-soft": "bg-badge-indigo-soft-text",
  "lime-soft": "bg-badge-lime-soft-text",
  "orange-soft": "bg-badge-orange-soft-text",
  "purple-soft": "bg-badge-purple-soft-text",
  "teal-soft": "bg-badge-teal-soft-text",
};

function dotClassOf(dimension: string): string {
  return DOT_CLASSES[String(dimensionVariant(dimension))] ?? DOT_CLASSES["default-soft"];
}

const valueOptions = computed(() => {
  if (!active.value) return [];
  if (active.value.dimension === SERVICE_DIMENSION) {
    return serviceNames.value.map((name) => ({ label: raw(name), value: name }));
  }
  const counts = props.catalogue.values[active.value.dimension] ?? {};
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, services]) => ({
      label: raw(name),
      value: name,
      // How much of the estate this claim covers, which is the one number
      // somebody weighing a broad rule actually wants and could not get before.
      description: services
        ? String(t("oncall.ruleEditorValueServices", { count: services }, services))
        : undefined,
    }));
});

/// "Everywhere" first and selected by default: a service is owned by one team
/// wherever it runs far more often than it changes hands per cluster.
const narrowOptions = computed(() => {
  if (!narrowable.value) return [];
  const counts = props.catalogue.values[narrowable.value.dimension] ?? {};
  return [
    { label: String(t("oncall.scopeEverywhere")), value: "" },
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => ({ label: raw(name), value: name })),
  ];
});

/// The dimensions this choice would write, coarsest first so the chips read in
/// the same order as the levels above them.
const claimed = computed(() => {
  if (!active.value || !value.value) return [];
  const pairs: { name: string; value: string }[] = [];
  if (narrowable.value && narrowValue.value) {
    pairs.push({ name: narrowable.value.dimension, value: narrowValue.value });
  }
  pairs.push({ name: active.value.dimension, value: value.value });
  return pairs;
});

const scopeHelp = computed<I18nText>(() =>
  active.value?.dimension === SERVICE_DIMENSION
    ? t("oncall.scopeServiceHelp")
    : t("oncall.scopeLevelHelp", { level: raw(active.value?.label ?? "") }),
);

/// What the claim means once other rules exist. Stated in terms of inheritance,
/// because "we own the cluster" and "and therefore everything in it that nobody
/// else claimed" are the same sentence to the person writing it and two
/// different rules to the engine.
const consequence = computed<I18nText>(() => {
  if (!active.value) return raw("");
  if (active.value.dimension === SERVICE_DIMENSION) {
    return narrowValue.value
      ? t("oncall.scopeClaimServiceHere", {
          service: raw(value.value),
          scope: raw(narrowValue.value),
        })
      : t("oncall.scopeClaimServiceEverywhere", { service: raw(value.value) });
  }
  return t("oncall.scopeClaimContainer", {
    level: raw(active.value.label.toLowerCase()),
    value: raw(value.value),
  });
});

function publish() {
  emit(
    "update:modelValue",
    Object.fromEntries(claimed.value.map((pair) => [pair.name, pair.value])),
  );
}

function selectMode(next: string) {
  if (next === "advanced") {
    mode.value = "advanced";
    emit("advanced");
    return;
  }
  mode.value = next;
  // Switching level abandons the old value rather than carrying it across: a
  // cluster name is not a namespace name, and a silently retained value is a
  // rule that claims something nobody chose.
  value.value = "";
  narrowValue.value = "";
  publish();
}

function setValue(next: string) {
  value.value = next;
  publish();
}

function setNarrow(next: string) {
  narrowValue.value = next;
  publish();
}
</script>
