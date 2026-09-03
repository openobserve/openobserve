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
  What a team owns, drawn as the thing it actually is: a path.

  The model has always been one. Rules are stored and displayed as
  `k8s-cluster=production/k8s-namespace=payments`, and precedence is
  longest-prefix — a longer path beats a shorter one. Every earlier attempt at
  this screen took that path apart into separate controls (pick a level, then a
  value, then optionally a narrowing) and the shape was lost: three questions in
  a row, none of which shows that the answers nest.

  So the control IS the path. Segments left to right, coarse to fine, each one a
  value or `Any`:

      production  ›  Any  ›  payment-gateway

  reads as "payment-gateway, in production, in any namespace" — and it is
  literally the row that gets saved. Breadth stops being something to reason
  about: an `Any` in the middle is visibly a gap the rule does not care about,
  and the count under each segment says how much of the estate it takes.

  Segments come from the org's own `distinguish_by` order, which is where the
  hierarchy is already written down. They are grouped by identity set, because a
  record is either an ECS task or a Kubernetes pod and a path that mixed the two
  would describe nothing that exists.

  Anything a path cannot say — a wildcard, a dimension outside the sets — is
  Advanced, unchanged and one click away.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-scope-picker">
    <div
      class="border-border-subtle bg-surface-panel rounded-default flex flex-col gap-3 border px-3 py-3"
    >
      <span class="flex flex-wrap items-center gap-x-2">
        <OText variant="label">{{ t("oncall.scopeOwns") }}</OText>

        <!-- Only when the estate genuinely has more than one shape. A single
             -platform org should never be asked which platform. -->
        <OSelect
          v-if="platforms.length > 1"
          :model-value="platform"
          :options="platformOptions"
          size="sm"
          width="xs"
          data-test="oncall-scope-platform"
          @update:model-value="(v: unknown) => selectPlatform(String(v))"
        />

        <OButton
          variant="ghost"
          size="xs"
          icon-left="tune"
          class="ms-auto"
          data-test="oncall-scope-mode-advanced"
          @click="emit('advanced')"
        >
          {{ t("oncall.scopeAdvanced") }}
        </OButton>
      </span>

      <!-- The path. Each segment carries its dimension's own colour, the same
           one its chip has in the incident list, so a cluster is recognisable
           here without reading the label. -->
      <div class="flex flex-wrap items-start gap-x-1 gap-y-2" data-test="oncall-scope-path">
        <template v-for="(segment, index) in segments" :key="segment.dimension">
          <OIcon
            v-if="index"
            name="chevron-right"
            size="sm"
            class="text-text-secondary mt-7 shrink-0"
            aria-hidden="true"
          />
          <div class="flex min-w-0 flex-col gap-1">
            <span class="flex items-center gap-1.5">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="dotClassOf(segment.dimension)"
                aria-hidden="true"
              />
              <OText variant="meta">{{ raw(segment.label) }}</OText>
            </span>
            <OSelect
              :model-value="segment.value"
              :options="segment.options"
              size="sm"
              width="sm"
              searchable
              :data-test="`oncall-scope-segment-${segment.dimension}`"
              @update:model-value="(v: unknown) => setSegment(segment.dimension, String(v ?? ''))"
            />
            <!-- How much of the estate this segment takes. The one number
                 somebody weighing a broad rule wants, and the reason `Any` does
                 not read as harmless. -->
            <OText
              variant="meta"
              class="ps-0.5"
              :data-test="`oncall-scope-breadth-${segment.dimension}`"
            >
              {{ segment.breadth }}
            </OText>
          </div>
        </template>
      </div>
    </div>

    <!-- The claim as a sentence, and what it leaves to everybody else.
         Inheritance is the half of this model people get wrong, and beside the
         claim is the only place saying so lands. -->
    <div
      v-if="pinned.length"
      class="flex items-start gap-1.5"
      data-test="oncall-scope-picker-claim"
    >
      <OIcon name="check-circle-outline" size="sm" class="text-success mt-0.5 shrink-0" />
      <OText variant="meta" data-test="oncall-scope-picker-consequence">
        {{ consequence }}
      </OText>
    </div>
    <div v-else class="flex items-start gap-1.5" data-test="oncall-scope-picker-empty">
      <OIcon name="info-outline" size="sm" class="text-text-secondary mt-0.5 shrink-0" />
      <OText variant="meta">{{ t("oncall.scopePathEmpty") }}</OText>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { dimensionVariant } from "@/lib/core/Badge/badgeGroups";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { IdentitySet } from "@/services/service_streams";
import type { DimensionCatalogue, DiscoveredService } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { SERVICE_DIMENSION } from "@/utils/oncall";

/** `Any` is the absence of a condition, and the empty string is how a select says so. */
const ANY = "";

const props = withDefaults(
  defineProps<{
    /** The rule being drafted, in `{dimension: value}` form. The single source
     *  of truth for every segment — this component keeps no shadow copy, which
     *  is what stopped an earlier version fighting its own emits. */
    modelValue?: Record<string, string>;
    /** The org's identity sets — the ordered hierarchy, straight from config. */
    sets?: IdentitySet[];
    /** What this org emits, and how many services carry each value. */
    catalogue?: DimensionCatalogue;
    /** Discovered services, for the finest segment. */
    services?: DiscoveredService[];
    /** Display names, so a segment reads as it does everywhere else. */
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

function displayOf(name: string): string {
  return props.aliases.find((alias) => alias.id === name)?.display || name;
}

/// Values seen for a dimension, commonest first, with how many services carry
/// each. `service` comes from the registry's own names rather than the
/// catalogue: a row filed under a stream name has no `service` dimension, so it
/// never reaches the catalogue under that key.
function valuesOf(dimension: string): { value: string; services: number }[] {
  if (dimension === SERVICE_DIMENSION) {
    return [...new Set(props.services.map((s) => s.name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, services: 0 }));
  }
  return Object.entries(props.catalogue.values[dimension] ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, services]) => ({ value, services }));
}

/// The platforms this estate actually has, each with its ordered dimensions.
///
/// A set whose dimensions have never carried a value is dropped: it describes a
/// platform this deployment does not run, and offering it produces a path that
/// can only match nothing.
const platforms = computed(() =>
  props.sets
    .map((set) => ({
      id: set.id,
      label: set.label || set.id,
      dimensions: set.distinguish_by.filter(
        (dimension) => dimension !== SERVICE_DIMENSION && valuesOf(dimension).length > 0,
      ),
    }))
    .filter((set) => set.dimensions.length > 0),
);

const platformOptions = computed(() =>
  platforms.value.map((set) => ({ label: raw(set.label), value: set.id })),
);

const chosenPlatform = ref("");

/// Which platform's path is on screen. Follows the draft when the draft names
/// dimensions belonging to one, so opening an existing rule lands on its own
/// platform rather than the first.
const platform = computed(() => {
  const names = Object.keys(props.modelValue ?? {});
  const owning = platforms.value.find((set) =>
    set.dimensions.some((dimension) => names.includes(dimension)),
  );
  if (owning) return owning.id;
  const chosen = platforms.value.find((set) => set.id === chosenPlatform.value);
  return chosen?.id ?? platforms.value[0]?.id ?? "";
});

/// The path: the chosen platform's dimensions coarsest first, then `service`,
/// which is finest by definition and belongs to every platform.
const pathDimensions = computed(() => {
  const set = platforms.value.find((candidate) => candidate.id === platform.value);
  const dimensions = set ? [...set.dimensions] : [];
  if (valuesOf(SERVICE_DIMENSION).length) dimensions.push(SERVICE_DIMENSION);
  return dimensions;
});

const segments = computed(() =>
  pathDimensions.value.map((dimension) => {
    const values = valuesOf(dimension);
    const value = String(props.modelValue?.[dimension] ?? ANY);
    const chosen = values.find((candidate) => candidate.value === value);
    return {
      dimension,
      label: displayOf(dimension),
      value,
      options: [
        { label: raw(t("oncall.scopeAny")), value: ANY },
        ...values.map((candidate) => ({ label: raw(candidate.value), value: candidate.value })),
      ],
      // Under an `Any`, how much it is letting through; under a value, how much
      // that value covers. Both answer "how broad is this", which is the
      // question a path makes askable and a list of dropdowns did not.
      breadth: value
        ? chosen?.services
          ? t("oncall.ruleEditorValueServices", { count: chosen.services }, chosen.services)
          : t("oncall.scopeBreadthOne")
        : t("oncall.scopeBreadthAny", { count: values.length }, values.length),
    };
  }),
);

/// The segments that are actually conditions — `Any` writes nothing.
const pinned = computed(() =>
  segments.value.filter((segment) => segment.value !== ANY),
);

/// The claim in a sentence, including what it does not take.
const consequence = computed<I18nText>(() => {
  const finest = pinned.value[pinned.value.length - 1];
  if (!finest) return raw("");
  const gaps = segments.value.filter(
    (segment) => segment.value === ANY && segment.dimension !== finest.dimension,
  );
  const where = pinned.value
    .slice(0, -1)
    .map((segment) => segment.value)
    .join(" / ");

  if (finest.dimension === SERVICE_DIMENSION) {
    return where
      ? t("oncall.scopeClaimServiceHere", { service: raw(finest.value), scope: raw(where) })
      : t("oncall.scopeClaimServiceEverywhere", { service: raw(finest.value) });
  }
  return gaps.length
    ? t("oncall.scopeClaimContainerAny", {
        level: raw(finest.label.toLowerCase()),
        value: raw(finest.value),
      })
    : t("oncall.scopeClaimContainer", {
        level: raw(finest.label.toLowerCase()),
        value: raw(finest.value),
      });
});

/// The colour the dimension carries everywhere else.
///
/// Spelled out rather than interpolated: Tailwind scans source text for class
/// names, so a computed `bg-${tone}` exists at runtime and not in the
/// stylesheet — the dot renders, invisibly, in every colour.
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

function setSegment(dimension: string, next: string) {
  const dimensions: Record<string, string> = { ...(props.modelValue ?? {}) };
  if (next === ANY) delete dimensions[dimension];
  else dimensions[dimension] = next;
  // Only this platform's path may contribute. Switching platform leaves the old
  // platform's values behind on the draft otherwise, and they would be saved
  // invisibly — a condition nobody can see is a rule that matches nothing.
  const allowed = new Set(pathDimensions.value);
  for (const key of Object.keys(dimensions)) if (!allowed.has(key)) delete dimensions[key];
  emit("update:modelValue", dimensions);
}

function selectPlatform(next: string) {
  chosenPlatform.value = next;
  // A cluster name is not a resource-group name. Carrying values across
  // platforms would claim something nobody picked.
  if (Object.keys(props.modelValue ?? {}).length) emit("update:modelValue", {});
}

/// Keep the platform selection honest when the estate changes underneath —
/// a set that disappears must not leave the path pointing at nothing.
watch(
  () => platforms.value.map((set) => set.id).join(),
  (ids) => {
    if (chosenPlatform.value && !ids.split(",").includes(chosenPlatform.value)) {
      chosenPlatform.value = "";
    }
  },
);
</script>
