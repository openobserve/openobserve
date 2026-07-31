<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * The Locator block for a step.
 *
 * **The author owns the order.** It arrives as Playwright's — a unique
 * candidate first, because `chooseFirstSelector` only reaches for an index when
 * nothing matched uniquely — and from there the author drags rows, adds
 * locators of their own, deletes ones they do not want, and combines recorded
 * ones into something stricter.
 *
 * That replaced pinning (P2.5.0/P2.5.1), which was exclusive: the only way to
 * say "prefer this one" was to turn fallback off entirely. An ordered list says
 * the same thing by deleting the other rows, and can also say "prefer mine,
 * fall back to the recording" — which a pin could not express at all.
 *
 * Two things the list must never do:
 *
 *  - **Rewrite recorded evidence.** An author reorders, appends and deletes.
 *    Editing a recorded value in place would destroy what a later healing pass
 *    compares against, so "Start from this" copies it into the input instead.
 *  - **Hide a positional or generated-id locator.** Both used to be handled by
 *    sorting, invisibly. They are per-row warnings now, because the author is
 *    the only one who can actually resolve either.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { LocatorCandidate, StepLocator } from "@/types/synthetics";
import { isFrameworkGeneratedId, isPositionalSelector } from "@/utils/synthetics/locatorStability";
import { deriveLocatorKind } from "@/utils/synthetics/deriveLocatorKind";
import type { CompositePart } from "@/utils/synthetics/composeLocator";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import LocatorComposeDialog from "./LocatorComposeDialog.vue";

const props = defineProps<{ locator: StepLocator }>();
const emit = defineEmits<{ "update:locator": [value: StepLocator] }>();

const { t } = useI18n();

const candidates = computed(() => props.locator.candidates ?? []);

/**
 * A bundle with no candidates — a step added by hand rather than recorded.
 * The table is `v-if`'d away, so the free-text input is the primary way to name
 * the element rather than an override of something.
 */
const isEmpty = computed(() => !candidates.value.length);

/**
 * `row-key="value"` rather than a synthesised id.
 *
 * Candidates carry no id, and an index-based one changes on every reorder,
 * which breaks selection mid-drag. Values are unique within a bundle because
 * `buildLocatorBundle` dedupes by exact string — and that is exactly why adding
 * a duplicate has to be refused below. Nothing could add a candidate before, so
 * nothing checked.
 */
const columns = computed<OTableColumnDef<LocatorCandidate>[]>(() => [
  { id: "locator", header: "", size: 200, meta: { autoWidth: true } },
  { id: "origin", header: "", size: 96 },
  { id: "actions", header: "", size: 10 },
]);

const selectedIds = ref<string[]>([]);
const combineOpen = ref(false);

/** Selected rows in LIST order — the first is the combination's base part. */
const selectedParts = computed(() =>
  candidates.value.filter((c) => selectedIds.value.includes(c.value)),
);

const recordedValues = computed(() =>
  candidates.value.filter((c) => (c.origin ?? "recorded") === "recorded").map((c) => c.value),
);

function originOf(candidate: LocatorCandidate): string {
  return candidate.origin ?? "recorded";
}

/**
 * Every emit goes through here, and every one sets `author_ordered`.
 *
 * Reaching this function at all means a human reordered, added, deleted or
 * combined. Healing must never reorder such a list (H1), so the flag has to be
 * set by the act rather than by a separate control nobody would think to touch.
 */
function commit(next: LocatorCandidate[]) {
  emit("update:locator", { ...props.locator, candidates: next, author_ordered: true });
}

function onReorder(next: LocatorCandidate[]) {
  commit(next);
}

const error = ref("");

function remove(candidate: LocatorCandidate) {
  // The step must still name an element, and this block only renders when a
  // target is mandatory. Deleting the last row would make the journey
  // unsaveable with no way back inside this block.
  if (candidates.value.length <= 1) {
    error.value = t("synthetics.journey.locatorDeleteLast");
    return;
  }
  error.value = "";
  selectedIds.value = selectedIds.value.filter((v) => v !== candidate.value);
  commit(candidates.value.filter((c) => c.value !== candidate.value));
}

const draft = ref("");

/**
 * The kind the current draft would be stored as — feedback, not a control.
 *
 * Always READ from the value, never chosen (D3). `kind` labels a locator; it
 * does not parse it — every consumer hands `value` to `page.locator()` — so a
 * picker that only set `kind` would store `role=` semantics on a bare CSS
 * string.
 */
const draftKind = computed(() =>
  draft.value.trim() ? deriveLocatorKind(draft.value.trim()) : "css",
);

function append(candidate: LocatorCandidate): boolean {
  if (candidates.value.some((c) => c.value === candidate.value)) {
    error.value = t("synthetics.journey.locatorDuplicate");
    return false;
  }
  error.value = "";
  commit([...candidates.value, candidate]);
  return true;
}

function addOwn() {
  const value = draft.value.trim();
  if (!value) return;
  if (append({ kind: deriveLocatorKind(value), value, origin: "authored" })) draft.value = "";
}

/** Copy a row into the input to edit — never edit the recorded value in place. */
function startFrom(candidate: LocatorCandidate) {
  draft.value = candidate.value;
}

function onCombine(built: { value: string; from: CompositePart[] }) {
  // Appended, then dragged into place. Combining never destroys the evidence it
  // was built from, and `kind` comes from the first part — `composite` is not a
  // kind, it is where the locator came from.
  const added = append({
    kind: selectedParts.value[0]?.kind ?? deriveLocatorKind(built.value),
    value: built.value,
    origin: "composite",
    from: built.from,
  });
  if (added) selectedIds.value = [];
}
</script>

<template>
  <div class="flex w-full flex-col gap-2" data-test="synthetics-journey-step-locator">
    <!-- In the empty state the block IS a single input, and that input already
         carries this heading as its label — showing both would say it twice. -->
    <div v-if="!isEmpty" class="flex items-center gap-2">
      <span class="text-text-primary text-sm">{{ t("synthetics.journey.locatorLabel") }}</span>
      <OTooltip :content="t('synthetics.journey.locatorHelp')">
        <OIcon name="info-outline" size="xs" class="text-text-secondary" aria-hidden="true" />
      </OTooltip>
    </div>

    <!-- Permanent helper text, not a tooltip. Ordering IS the feature; it must
         not need discovering. -->
    <p v-if="!isEmpty" class="text-text-secondary m-0 text-xs">
      {{ t("synthetics.journey.locatorOrderHelp") }}
    </p>

    <OTable
      v-if="!isEmpty"
      :data="candidates"
      :columns="columns"
      row-key="value"
      :show-header="false"
      :pagination="'none'"
      :sorting="'none'"
      :show-global-filter="false"
      :dense="true"
      :bordered="true"
      :default-columns="false"
      :fill-height="false"
      :enable-row-reorder="true"
      selection="multiple"
      :selected-ids="selectedIds"
      data-test="synthetics-journey-step-locator-table"
      @row-reorder="onReorder"
      @update:selected-ids="selectedIds = $event"
    >
      <template #cell-locator="{ row }">
        <div
          class="flex min-w-0 items-center gap-2"
          data-test="synthetics-journey-step-locator-row"
        >
          <OBadge variant="default" size="sm">
            {{ t(`synthetics.journey.locatorKind.${row.kind}`) }}
          </OBadge>
          <OTooltip :content="row.value" interactive>
            <span class="text-text-body min-w-0 flex-1 truncate font-mono text-xs">
              {{ row.value }}
            </span>
          </OTooltip>
          <!-- Per row, not per block. The old whole-block notice fired only when
               EVERY candidate was positional — that is, only when nothing could
               be done about it — and stayed silent when something could. -->
          <OTooltip
            v-if="isPositionalSelector(row.value)"
            :content="t('synthetics.journey.locatorPositionalWarningHelp')"
          >
            <span
              class="text-status-warning-text text-2xs flex shrink-0 items-center gap-1"
              data-test="synthetics-journey-step-locator-row-positional"
            >
              <OIcon name="warning" size="xs" aria-hidden="true" />
              {{ t("synthetics.journey.locatorPositionalWarning") }}
            </span>
          </OTooltip>
          <OTooltip
            v-if="isFrameworkGeneratedId(row.value)"
            :content="t('synthetics.journey.locatorGeneratedIdWarningHelp')"
          >
            <span
              class="text-status-warning-text text-2xs flex shrink-0 items-center gap-1"
              data-test="synthetics-journey-step-locator-row-generated-id"
            >
              <OIcon name="warning" size="xs" aria-hidden="true" />
              {{ t("synthetics.journey.locatorGeneratedIdWarning") }}
            </span>
          </OTooltip>
        </div>
      </template>

      <template #cell-origin="{ row }">
        <OBadge variant="default" size="sm">
          {{ t(`synthetics.journey.locatorOrigin.${originOf(row)}`) }}
        </OBadge>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="xs"
          data-test="synthetics-journey-step-locator-delete-btn"
          icon-left="delete"
          @click="remove(row)"
        />
      </template>
    </OTable>

    <!-- Never a primary action: combining is the sharp tool, and it only makes
         sense for two or more rows. -->
    <div v-if="selectedParts.length >= 2" class="flex items-center gap-2">
      <span class="text-text-secondary text-xs">
        {{ t("synthetics.journey.locatorSelectedCount", { count: selectedParts.length }) }}
      </span>
      <OButton
        variant="outline"
        size="xs"
        data-test="synthetics-journey-step-locator-combine"
        @click="combineOpen = true"
      >
        {{ t("synthetics.journey.locatorCombine") }}
      </OButton>
    </div>

    <p
      v-if="error"
      class="text-status-error-text m-0 text-xs"
      data-test="synthetics-journey-step-locator-error"
    >
      {{ error }}
    </p>

    <!-- The author's own entry, after every recorded one. It APPENDS rather
         than overriding: the row can then be dragged wherever they want it. -->
    <div class="flex w-full items-end gap-2">
      <!-- Read from the value, not chosen: `kind` labels a locator, it does not
           parse it, so a picker that only set `kind` would store a contradiction. -->
      <OTooltip :content="t('synthetics.journey.locatorDerivedKindHelp')">
        <OBadge
          variant="default"
          size="sm"
          data-test="synthetics-journey-step-locator-derived-kind"
          class="mb-2"
        >
          {{ t(`synthetics.journey.locatorKind.${draftKind}`) }}
        </OBadge>
      </OTooltip>

      <OInput
        v-model="draft"
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
        @keyup.enter="addOwn"
      />

      <div class="w-23! text-center">
        <OButton
          variant="ghost"
          size="sm"
          :disabled="!draft.trim()"
          icon-left="add"
          data-test="synthetics-journey-step-locator-add"
          @click="addOwn"
        />
      </div>
    </div>

    <LocatorComposeDialog
      v-model:open="combineOpen"
      :parts="selectedParts"
      :recorded="recordedValues"
      @combine="onCombine"
    />
  </div>
</template>
