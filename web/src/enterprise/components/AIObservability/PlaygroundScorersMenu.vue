<!-- Copyright 2026 OpenObserve Inc.

  Which scorers judge the bench, and the one button that runs them.

  Scorers resolve at their LATEST version here. Pinning a version is what makes
  an Experiment reproducible months later; a draft is read the same afternoon it
  is written, so pinning would only mean judging today's prompt with a rule you
  have since improved.

  A scorer that cannot judge this bench says so before it is picked, not after a
  round trip: the requirement is readable straight off its template, and the
  server applies exactly the same rule.
-->
<template>
  <ODropdown v-model:open="menuOpen" align="end" side="bottom">
    <template #trigger>
      <OButton
        variant="outline"
        size="sm-action"
        icon-right="expand-more"
        data-test="ai-playground-scorers-btn"
      >
        {{
          selectedIds.length
            ? t("aiObservability.playground.scoreCount", { count: selectedIds.length })
            : t("aiObservability.playground.score")
        }}
      </OButton>
    </template>

    <div class="flex w-100 flex-col gap-2 p-2" data-test="ai-playground-scorers-menu">
      <span class="text-text-secondary text-2xs font-semibold uppercase">
        {{ t("aiObservability.playground.scorersLatest") }}
      </span>

      <p
        v-if="!scorers.length"
        class="text-text-secondary m-0 text-xs leading-relaxed"
        data-test="ai-playground-scorers-empty"
      >
        {{ t("aiObservability.playground.scorersEmpty") }}
      </p>

      <div v-for="entry in entries" :key="entry.id" class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <OCheckbox
            :model-value="selectedIds.includes(entry.id)"
            size="sm"
            :disabled="entry.blocked"
            :data-test="`ai-playground-scorer-${entry.id}`"
            @update:model-value="(checked: unknown) => toggle(entry.id, checked === true)"
          />
          <span
            class="min-w-0 truncate font-mono text-xs font-semibold"
            :class="entry.blocked ? 'text-text-muted' : 'text-text-heading'"
          >
            {{ raw(entry.name) }}
          </span>
          <OTag
            v-if="entry.referenceBased"
            variant="warning-soft"
            size="sm"
            :label="t('aiObservability.playground.scorerReferenceBased')"
          />
        </div>
        <!-- The reason sits under the row it belongs to, not in a tooltip: it
             is the difference between a verdict and a blank, and it changes as
             soon as an expected output is added. -->
        <span v-if="entry.note" class="text-text-secondary text-2xs pl-6 italic">
          {{ entry.note }}
        </span>
      </div>

      <!-- The requirement and its field used to be at opposite ends of the page.
           This states it where the scorer is picked, and its button focuses the
           one field that fixes it. -->
      <template v-if="selectedNeedingReference.length">
        <OSeparator />

        <div class="flex items-start gap-2">
          <span class="text-status-warning-text text-2xs min-w-0 flex-1">
            {{
              t("aiObservability.playground.expectedMissing", {
                scorers: selectedNeedingReference.join(", "),
              })
            }}
          </span>
          <OButton
            variant="outline"
            size="xs"
            class="shrink-0"
            data-test="ai-playground-focus-expected"
            @click="goToExpected"
          >
            {{ t("aiObservability.playground.expectedMissingAction") }}
          </OButton>
        </div>
      </template>

      <template v-if="scorers.length">
        <OSeparator />

        <div class="flex items-center gap-2">
          <OCheckbox
            :model-value="autoScore"
            size="sm"
            :label="t('aiObservability.playground.autoScore')"
            data-test="ai-playground-auto-score"
            @update:model-value="(checked: unknown) => emit('update:auto-score', checked === true)"
          />
          <div class="grow" />
          <span class="text-text-secondary text-2xs">
            {{ t("aiObservability.playground.autoScoreSaved") }}
          </span>
        </div>

        <OSeparator />

        <div class="flex items-end gap-2">
          <!-- Why the button is dead, in text. A disabled button fires no
               pointer events, so a `title` on it is never shown. -->
          <span class="text-text-secondary text-2xs min-w-0 flex-1 italic">
            {{
              !selectedIds.length
                ? t("aiObservability.playground.scoreNoScorers")
                : !canScore
                  ? t("aiObservability.playground.scoreNothingToScore")
                  : t("aiObservability.playground.scoreCaveat")
            }}
          </span>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="scoring"
            :disabled="!selectedIds.length || !canScore"
            :title="t('aiObservability.playground.scoreNowTooltip')"
            data-test="ai-playground-score-now"
            @click="emit('score')"
          >
            {{ t("aiObservability.playground.scoreNow") }}
          </OButton>
        </div>
      </template>
    </div>
  </ODropdown>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { entityId } from "@/enterprise/components/onlineEvals/utils/evalEntity";
import { scorerEvidence } from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Scorer } from "@/services/online-evals.service";

const props = defineProps<{
  scorers: Scorer[];
  selectedIds: string[];
  autoScore: boolean;
  /** The bench carries an expected output, which is what a reference-based
   *  scorer compares against. */
  hasReference: boolean;
  /** At least one output exists to judge. */
  canScore: boolean;
  scoring: boolean;
}>();

const emit = defineEmits<{
  "update:selected-ids": [ids: string[]];
  "update:auto-score": [value: boolean];
  score: [];
  "focus-expected": [];
}>();

const { t } = useI18nTyped();

const menuOpen = ref(false);

/** Closes the panel first: the field it points at is at the other end of the
 *  page, and a menu left open over the page keeps the eye where it was. */
function goToExpected() {
  menuOpen.value = false;
  emit("focus-expected");
}

interface ScorerEntry {
  id: string;
  name: string;
  referenceBased: boolean;
  /** Nothing on this bench can ever satisfy it, so it cannot be picked. */
  blocked: boolean;
  note: I18nText | "";
}

const entries = computed<ScorerEntry[]>(() =>
  props.scorers.map((scorer) => {
    const evidence = scorerEvidence(scorer.template ?? "");
    const referenceBased =
      evidence.expectedOutput || Boolean(scorer.referenceBased ?? scorer.reference_based);
    const missingReference = referenceBased && !props.hasReference;
    return {
      id: entityId(scorer),
      name: scorer.name,
      referenceBased,
      blocked: evidence.trace,
      note: evidence.trace
        ? t("aiObservability.playground.scorerNeedsTrace")
        : missingReference
          ? t("aiObservability.playground.scorerNeedsReference")
          : "",
    };
  }),
);

/**
 * Names only the SELECTED reference-based scorers. Warning about one nobody
 * picked is noise, and each row already carries its own note. A trace-reading
 * scorer is excluded: no expected output fixes it.
 */
const selectedNeedingReference = computed<string[]>(() =>
  entries.value
    .filter(
      (entry) =>
        props.selectedIds.includes(entry.id) &&
        entry.referenceBased &&
        !entry.blocked &&
        !props.hasReference,
    )
    .map((entry) => entry.name),
);

function toggle(id: string, checked: boolean) {
  const next = checked
    ? [...props.selectedIds, id]
    : props.selectedIds.filter((candidate) => candidate !== id);
  emit("update:selected-ids", next);
}
</script>
