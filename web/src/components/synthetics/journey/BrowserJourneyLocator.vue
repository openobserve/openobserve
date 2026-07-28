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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
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

const fallbacks = computed(() => candidates.value.slice(1));

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
  emit("update:locator", { ...props.locator, user_override: { kind: "css", value } });
  overrideDraft.value = "";
}

function isPinnedCandidate(candidate: LocatorCandidate): boolean {
  return pinned.value?.kind === candidate.kind && pinned.value?.value === candidate.value;
}
</script>

<template>
  <div class="flex flex-col gap-2" data-test="synthetics-journey-step-locator">
    <div class="flex items-center gap-2">
      <span class="text-text-secondary text-xs">{{ t("synthetics.journey.locatorLabel") }}</span>
      <OTooltip :content="t('synthetics.journey.locatorHelp')">
        <OIcon name="info-outline" size="xs" class="text-text-secondary" aria-hidden="true" />
      </OTooltip>
    </div>

    <!-- The effective locator: what this step will actually use. -->
    <div
      v-if="effective"
      class="border-border-default rounded-default flex items-center gap-2 border p-2"
      data-test="synthetics-journey-step-locator-primary"
    >
      <OBadge variant="default" size="sm">{{
        t(`synthetics.journey.locatorKind.${effective.kind}`)
      }}</OBadge>
      <OTooltip :content="effective.value" interactive>
        <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">
          {{ effective.value }}
        </span>
      </OTooltip>
      <OBadge v-if="pinned" variant="default" size="sm">{{
        t("synthetics.journey.locatorPinned")
      }}</OBadge>
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

    <!-- A pinned step never falls back, so the list is shown inert. -->
    <p
      v-if="pinned"
      class="text-text-secondary m-0 text-xs"
      data-test="synthetics-journey-step-locator-pinned-note"
    >
      {{ t("synthetics.journey.locatorPinnedNote") }}
    </p>

    <OCollapsible
      v-if="fallbacks.length"
      :label="t('synthetics.journey.locatorFallbacks', { count: fallbacks.length })"
      data-test="synthetics-journey-step-locator-fallbacks"
    >
      <div class="flex flex-col gap-1 pt-1" :class="{ 'opacity-50': !!pinned }">
        <div
          v-for="candidate in fallbacks"
          :key="`${candidate.kind}:${candidate.value}`"
          class="flex items-center gap-2 py-1"
        >
          <OBadge variant="default" size="sm">{{
            t(`synthetics.journey.locatorKind.${candidate.kind}`)
          }}</OBadge>
          <OTooltip :content="candidate.value" interactive>
            <span class="text-text-secondary min-w-0 flex-1 truncate font-mono text-xs">
              {{ candidate.value }}
            </span>
          </OTooltip>
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
    </OCollapsible>

    <!-- Free text is intent, so it sets the pin rather than editing evidence. -->
    <div class="flex items-end gap-2">
      <OInput
        v-model="overrideDraft"
        :label="t('synthetics.journey.locatorOverrideLabel')"
        :placeholder="t('synthetics.journey.locatorOverridePlaceholder')"
        class="flex-1"
        data-test="synthetics-journey-step-locator-override-input"
        @keyup.enter="applyOverride"
      />
      <OButton
        variant="secondary"
        size="sm"
        :disabled="!overrideDraft.trim()"
        data-test="synthetics-journey-step-locator-override-btn"
        @click="applyOverride"
      >
        {{ t("synthetics.journey.locatorPin") }}
      </OButton>
    </div>
  </div>
</template>
