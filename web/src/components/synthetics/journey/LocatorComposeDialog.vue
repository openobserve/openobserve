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
/**
 * The Combine builder.
 *
 * Combining is the sharp tool in the Locator block, and its intuition runs
 * backwards: **it makes a step stricter, not more resilient.** `A ∧ B` breaks
 * if either A or B breaks, so as a resilience measure it is worse than either
 * locator alone. What it buys is precision — finding an element that no single
 * recorded locator can identify — and, if the index is kept, drift detection.
 *
 * Resilience stays with the ordered list: that is the OR. This is the AND.
 *
 *   the ordered list  → "keep the step running"             → availability
 *   a combined locator → "act on the right element, or fail" → correctness
 *
 * No `OForm`, no Zod. There is nothing to validate: the parts are pre-selected,
 * the relation is a radio and the position is a checkbox. `OForm` + Zod is the
 * rule for validated forms with free-text input; this is a builder, and the
 * free-text path lives in the Locator block itself.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { CompositeRelation, LocatorCandidate } from "@/types/synthetics";
import {
  canDefaultToAnd,
  composeLocator,
  isBareFilterEngine,
  type CompositePart,
} from "@/utils/synthetics/composeLocator";
import { isPositionalSelector } from "@/utils/synthetics/locatorStability";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";

const props = defineProps<{
  open: boolean;
  /** The selected rows, in list order. The first is the base. */
  parts: LocatorCandidate[];
  /** Values of every `recorded` candidate in the bundle — the safety proof. */
  recorded: string[];
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  combine: [value: { value: string; from: CompositePart[] }];
}>();

const { t } = useI18n();

/**
 * `and` is provably safe when every selected row came from the recording.
 *
 * Playwright verifies each candidate against the target before storing it —
 * `chooseFirstSelector` returns only on `result[0] === targetElement &&
 * result.length === 1` — so recorded candidates all resolve to the same element
 * and intersecting them gives that element. Asking the author in that case adds
 * a click and teaches nothing.
 *
 * The guarantee ends the moment a locator they typed joins in, and the editor
 * has no live DOM with which to notice a wrong choice: picking `and` when the
 * parts sit on different elements yields nothing at all, silently. So the
 * picker appears, with nothing pre-selected.
 */
const provable = computed(() =>
  canDefaultToAnd(
    props.parts.map((p) => ({ value: p.value })),
    props.recorded,
  ),
);

const relation = ref<CompositeRelation | null>(null);
const requirePosition = ref(false);

watch(
  () => [props.open, props.parts] as const,
  () => {
    relation.value = null;
    requirePosition.value = false;
  },
);

/** The relation actually applied: `and` when it is provable, else the choice. */
const effectiveRelation = computed<CompositeRelation | null>(() =>
  provable.value ? "and" : relation.value,
);

/**
 * The index the base part carries, if any — the only one that can be kept.
 *
 * A later part's index rides inside its quoted body and is not ours to move.
 */
const basePosition = computed(() => {
  const match = props.parts[0]?.value.match(/>>\s*nth=(\d+)\s*$/);
  return match ? Number(match[1]) : null;
});

const composedParts = computed<CompositePart[]>(() => {
  const rel = effectiveRelation.value;
  if (!rel) return [];
  const [base, ...rest] = props.parts;
  if (!base) return [];
  return [{ value: base.value }, ...rest.map((p) => ({ relation: rel, value: p.value }))];
});

const result = computed(() =>
  composedParts.value.length
    ? composeLocator({
        parts: composedParts.value,
        requirePosition: requirePosition.value,
      })
    : "",
);

/**
 * A part that only NARROWS something else down cannot be intersected with.
 *
 * `and` intersects result sets and runs the inner selector against the document
 * root, so a filter engine — has-text, has, has-not — filters the document,
 * matches nothing, and the whole combination resolves to nothing. Silently: the
 * step simply never finds its element. `has` expresses the same intent.
 *
 * A recorded candidate is never a bare filter engine, so this only fires on a
 * locator the author typed.
 */
const filterEngineUnderAnd = computed(
  () =>
    effectiveRelation.value === "and" &&
    props.parts.slice(1).some((p) => isBareFilterEngine(p.value)),
);

const canApply = computed(() => !!result.value && !filterEngineUnderAnd.value);

/**
 * "matched 1 when recorded" — the only honest count available.
 *
 * Derived from whether the part carries a positional token: Playwright appends
 * one only when nothing identified the element uniquely, so its absence proves
 * the selector resolved to exactly one element at record time. There is no live
 * page here, so a real count cannot be shown and is not invented.
 */
function matchedLabel(candidate: LocatorCandidate): string {
  return isPositionalSelector(candidate.value)
    ? t("synthetics.journey.locatorCombineMatchedMany")
    : t("synthetics.journey.locatorCombineMatchedOne");
}

function apply() {
  if (!canApply.value) return;
  emit("combine", { value: result.value, from: composedParts.value });
  emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    :title="t('synthetics.journey.locatorCombineTitle')"
    :primary-button-label="t('synthetics.journey.locatorCombineApply')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!canApply"
    data-test="synthetics-journey-step-locator-combine-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="apply"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-5">
      <!-- Plain language throughout. "AND", "intersect" and "composite" never
           appear in body copy; `Combined` shows up only as the origin badge. -->
      <section class="flex flex-col gap-2">
        <p class="text-text-secondary m-0 text-xs">
          {{ t("synthetics.journey.locatorCombineLead") }}
        </p>
        <div
          v-for="part in parts"
          :key="part.value"
          class="flex items-center gap-2"
          data-test="synthetics-journey-step-locator-combine-part"
        >
          <OBadge variant="default" size="sm">
            {{ t(`synthetics.journey.locatorKind.${part.kind}`) }}
          </OBadge>
          <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">
            {{ part.value }}
          </span>
          <span class="text-text-muted shrink-0 text-2xs">{{ matchedLabel(part) }}</span>
        </div>
      </section>

      <!-- Shown only where the proof does not hold, with nothing pre-selected:
           a wrong default here produces an empty match the editor cannot
           detect, so the choice has to be deliberate. -->
      <section
        v-if="!provable"
        class="flex flex-col gap-2"
        data-test="synthetics-journey-step-locator-combine-relation"
      >
        <p class="text-text-body m-0 text-sm">
          {{ t("synthetics.journey.locatorCombineRelationQuestion") }}
        </p>
        <ORadioGroup :model-value="relation ?? undefined" @update:model-value="relation = $event as CompositeRelation">
          <ORadio
            value="and"
            :label="t('synthetics.journey.locatorCombineRelationAnd')"
            data-test="synthetics-journey-step-locator-combine-relation-and"
          />
          <ORadio
            value="has"
            :label="t('synthetics.journey.locatorCombineRelationHas')"
            data-test="synthetics-journey-step-locator-combine-relation-has"
          />
        </ORadioGroup>
        <p class="text-text-muted m-0 pl-6 text-xs">
          {{ t("synthetics.journey.locatorCombineRelationHasHelp") }}
        </p>
      </section>

      <!-- The one control that picks between the two shapes: precision, or an
           assertion that fails loudly when the list is reordered. Off by
           default, captioned with the consequence rather than the mechanism. -->
      <section v-if="basePosition !== null" class="flex flex-col gap-1">
        <OCheckbox
          v-model="requirePosition"
          :label="t('synthetics.journey.locatorCombinePosition', { position: basePosition + 1 })"
          data-test="synthetics-journey-step-locator-combine-position"
        />
        <p class="text-text-muted m-0 pl-6 text-xs">
          {{ t("synthetics.journey.locatorCombinePositionHelp") }}
        </p>
      </section>

      <!-- Names the failure mode and the mitigation, in the dialog rather than
           after the fact. Authors read "add another locator" as more robust. -->
      <p
        class="text-status-warning-text m-0 flex items-start gap-1 text-xs"
        data-test="synthetics-journey-step-locator-combine-warning"
      >
        <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{{ t("synthetics.journey.locatorCombineWarning") }}</span>
      </p>

      <p
        v-if="filterEngineUnderAnd"
        class="text-status-error-text m-0 flex items-start gap-1 text-xs"
        data-test="synthetics-journey-step-locator-combine-filter-error"
      >
        <OIcon name="error-outline" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{{ t("synthetics.journey.locatorCombineFilterEngine") }}</span>
      </p>

      <!-- Shown, not editable: it is reassurance and a copy target. Editing it
           would mean hand-writing JSON-escaped selector syntax. -->
      <section v-if="result" class="flex flex-col gap-1">
        <span class="text-text-secondary text-xs">
          {{ t("synthetics.journey.locatorCombineResult") }}
        </span>
        <code
          class="bg-surface-subtle text-text-body rounded-default overflow-x-auto p-2 font-mono text-xs"
          data-test="synthetics-journey-step-locator-combine-result"
        >
          {{ result }}
        </code>
      </section>
    </div>
  </ODialog>
</template>
