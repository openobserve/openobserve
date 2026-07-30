<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * The Locator block for a version-2 step.
 *
 * Governing rule (spec P2.5.0): **candidates are evidence, `user_override` is
 * intent.** The candidate list is machine-derived from the recording session and
 * is read-only here. The only way for an author to say "use this one" is to pin
 * it — which is what makes hand-edits harmless, lets self-healing compare the
 * stored list byte-for-byte, and makes "never heal a pinned step" fall out for
 * free rather than needing a separate flag.
 *
 * Pinning is deliberately not reordering (P2.5.1). The two look similar and mean
 * different things: reordering says "prefer this, but keep falling back", while
 * pinning says "use exactly this and nothing else". Offering only one of them
 * keeps the stored intent unambiguous.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { LocatorCandidate, StepLocator } from "@/types/synthetics";
import { isFullyPositional } from "@/utils/synthetics/locatorStability";
import { deriveLocatorKind } from "@/utils/synthetics/deriveLocatorKind";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{ locator: StepLocator }>();
const emit = defineEmits<{ "update:locator": [value: StepLocator] }>();

const { t } = useI18n();

const pinned = computed(() => props.locator.user_override ?? null);
const candidates = computed(() => props.locator.candidates ?? []);

/** What the runner would actually use: the pin if there is one, else the primary. */
const effective = computed<LocatorCandidate | null>(
  () => pinned.value ?? candidates.value[0] ?? null,
);

/**
 * Everything after the primary — shown in full, never behind a disclosure.
 *
 * P2.5/T5 put these behind an `OCollapsible "N fallbacks"`. That was written when
 * the editor was a flat column of eight controls and hiding the list was one of the
 * few ways to keep the block short. Field grouping replaced that constraint, and a
 * bare count advertised nothing, so the click bought the author no information: the
 * list is what the runner will actually try if the primary stops matching, and the
 * ordering only carries meaning when it can be seen.
 */
const fallbacks = computed(() => candidates.value.slice(1));

/**
 * A bundle with no candidates and no pin — a step added by hand rather than
 * recorded. Every other block is `v-if`'d away, so the free-text input is the
 * primary way to name the element, not an override of something: labelling it
 * "use a different locator" would be wrong when there is nothing to differ from.
 *
 * It is also required in this state. The block only renders when the step needs a
 * target (`stepNeedsTarget`), so its presence means "a target is mandatory here",
 * and this input is the only way to supply one.
 */
const isEmpty = computed(() => !candidates.value.length && !pinned.value);

/**
 * Every candidate identifies the element by counting siblings.
 *
 * Playwright appends a positional token only when nothing identified the element
 * uniquely, so when all of them carry one the recorder is saying it could not
 * tell these elements apart. Re-ranking cannot help — there is nothing better to
 * promote — which is exactly why this has to be said rather than sorted away.
 * A pinned step is excluded: the author has already answered the question.
 */
const allPositional = computed(() => !pinned.value && isFullyPositional(candidates.value));

const overrideDraft = ref("");

function pin(candidate: LocatorCandidate) {
  emit("update:locator", { ...props.locator, user_override: { ...candidate } });
}

function unpin() {
  emit("update:locator", { ...props.locator, user_override: null });
}

/**
 * Free text sets `user_override` — it never edits a candidate.
 *
 * Editing a candidate in place would corrupt the recorded evidence: the stored
 * list is what a later healing pass compares against to decide whether the page
 * has changed, and an author's correction is not evidence of anything the
 * recorder saw.
 */
function applyOverride() {
  const value = overrideDraft.value.trim();
  if (!value) return;
  // The kind is READ from the value, never chosen (D3). `kind` labels a locator; it
  // does not parse it — both consumers hand `value` to page.locator() — so a picker
  // that only set `kind` would store role=… semantics on a bare CSS string.
  emit("update:locator", {
    ...props.locator,
    user_override: { kind: deriveLocatorKind(value), value },
  });
  overrideDraft.value = "";
}

/**
 * The kind the current draft would be stored as — feedback, not a control, so it
 * can never be set to something the value contradicts.
 *
 * Always derived from what is in the box. A candidate's stored kind is deliberately
 * not carried across by "start from this": the badge must describe the string the
 * author can see and may since have edited.
 */
const draftKind = computed(() =>
  overrideDraft.value.trim() ? deriveLocatorKind(overrideDraft.value.trim()) : null,
);

/** Prefill the override with a recorded candidate, as a starting point to edit. */
function startFrom(candidate: LocatorCandidate) {
  overrideDraft.value = candidate.value;
}

function isPinnedCandidate(candidate: LocatorCandidate): boolean {
  return pinned.value?.kind === candidate.kind && pinned.value?.value === candidate.value;
}
</script>

<template>
  <div class="flex w-full flex-col gap-2" data-test="synthetics-journey-step-locator">
    <!-- In the empty state the block IS a single input, and that input already
         carries this heading as its label — showing both would say it twice. -->
    <div v-if="!isEmpty" class="flex items-center gap-2">
      <span class="text-text-secondary text-xs">{{ t("synthetics.journey.locatorLabel") }}</span>
      <OTooltip :content="t('synthetics.journey.locatorHelp')">
        <OIcon name="info-outline" size="xs" class="text-text-secondary" aria-hidden="true" />
      </OTooltip>
    </div>

    <!-- The effective locator: what this step will actually use. Both badges sit on
         the left so the row's action group lines up with every fallback row below
         it, whatever combination of buttons a row happens to carry. -->
    <div
      v-if="effective"
      class="border-border-default rounded-default flex w-full items-center gap-2 border px-2 py-2"
      data-test="synthetics-journey-step-locator-primary"
    >
      <OBadge variant="default" size="sm">{{
        t(`synthetics.journey.locatorKind.${effective.kind}`)
      }}</OBadge>
      <OBadge v-if="pinned" variant="default" size="sm">{{
        t("synthetics.journey.locatorPinned")
      }}</OBadge>
      <OTooltip :content="effective.value" interactive>
        <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">
          {{ effective.value }}
        </span>
      </OTooltip>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <OButton
          variant="ghost"
          size="xs"
          data-test="synthetics-journey-step-locator-start-from-primary-btn"
          @click="startFrom(effective)"
        >
          {{ t("synthetics.journey.locatorStartFromThis") }}
        </OButton>
        <OButton
          v-if="pinned"
          variant="ghost"
          size="xs"
          data-test="synthetics-journey-step-locator-unpin-btn"
          @click="unpin"
        >
          {{ t("synthetics.journey.locatorUnpin") }}
        </OButton>
        <OButton
          v-else-if="candidates.length"
          variant="ghost"
          size="xs"
          data-test="synthetics-journey-step-locator-pin-primary-btn"
          @click="pin(candidates[0])"
        >
          {{ t("synthetics.journey.locatorPin") }}
        </OButton>
      </div>
    </div>

    <!--
      Phase 2a: the recorder could not identify this element at all. Ranking is
      a no-op here, so the author is the only thing that can resolve it.
    -->
    <p
      v-if="allPositional"
      class="text-status-warning-text m-0 flex items-start gap-1 text-xs"
      data-test="synthetics-journey-step-locator-positional-warning"
    >
      <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{{ t("synthetics.journey.locatorAllPositionalWarning") }}</span>
    </p>

    <!-- A pinned step never falls back, so the list is shown inert. -->
    <p
      v-if="pinned"
      class="text-text-secondary m-0 text-xs"
      data-test="synthetics-journey-step-locator-pinned-note"
    >
      {{ t("synthetics.journey.locatorPinnedNote") }}
    </p>

    <!-- Every remaining candidate, in full. Says what the list is FOR rather than
         how many entries it has: the ordering is the runner's own fallback order,
         and a count communicated none of that. A pinned step never falls back, so
         the note above stands in for the lead-in and the rows render inert. -->
    <template v-if="fallbacks.length">
      <p
        v-if="!pinned"
        class="text-text-secondary m-0 text-xs"
        data-test="synthetics-journey-step-locator-fallbacks-lead"
      >
        {{ t("synthetics.journey.locatorFallbacksLead") }}
      </p>
      <div
        class="flex w-full flex-col"
        :class="{ 'opacity-50': !!pinned }"
        data-test="synthetics-journey-step-locator-fallbacks"
      >
        <div
          v-for="candidate in fallbacks"
          :key="`${candidate.kind}:${candidate.value}`"
          class="flex w-full items-center gap-2 px-2 py-1"
        >
          <OBadge variant="default" size="sm">{{
            t(`synthetics.journey.locatorKind.${candidate.kind}`)
          }}</OBadge>
          <OTooltip :content="candidate.value" interactive>
            <span class="text-text-secondary min-w-0 flex-1 truncate font-mono text-xs">
              {{ candidate.value }}
            </span>
          </OTooltip>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <OButton
              variant="ghost"
              size="xs"
              data-test="synthetics-journey-step-locator-start-from-btn"
              @click="startFrom(candidate)"
            >
              {{ t("synthetics.journey.locatorStartFromThis") }}
            </OButton>
            <OButton
              variant="ghost"
              size="xs"
              :disabled="!!pinned && !isPinnedCandidate(candidate)"
              data-test="synthetics-journey-step-locator-pin-btn"
              @click="pin(candidate)"
            >
              {{ t("synthetics.journey.locatorPin") }}
            </OButton>
          </div>
        </div>
      </div>
    </template>

    <!-- Free text is intent, so it sets the pin rather than editing evidence. Last
         in the block: it is the author's own entry, after every recorded one. -->
    <div class="flex w-full items-end gap-2">
      <OInput
        v-model="overrideDraft"
        :label="
          isEmpty
            ? t('synthetics.journey.locatorEmptyLabel')
            : t('synthetics.journey.locatorOverrideLabel')
        "
        :placeholder="
          isEmpty
            ? t('synthetics.journey.locatorEmptyPlaceholder')
            : t('synthetics.journey.locatorOverridePlaceholder')
        "
        :required="isEmpty"
        class="flex-1"
        data-test="synthetics-journey-step-locator-override-input"
        @keyup.enter="applyOverride"
      />
      <!-- Read from the value, not chosen: `kind` labels a locator, it does not
           parse it, so a picker that only set `kind` would store a contradiction. -->
      <OTooltip v-if="draftKind" :content="t('synthetics.journey.locatorDerivedKindHelp')">
        <OBadge
          variant="default"
          size="sm"
          data-test="synthetics-journey-step-locator-derived-kind"
        >
          {{ t(`synthetics.journey.locatorKind.${draftKind}`) }}
        </OBadge>
      </OTooltip>
      <OButton
        variant="secondary"
        size="sm"
        :disabled="!overrideDraft.trim()"
        data-test="synthetics-journey-step-locator-override-btn"
        @click="applyOverride"
      >
        {{ t("synthetics.journey.locatorOverrideApply") }}
      </OButton>
    </div>
  </div>
</template>
