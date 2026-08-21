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
  Somebody stands in for the rotation over a window.

  A cover does NOT reorder the roster: outside the window the rotation resolves
  exactly as it always would, which is what makes taking one safe at 2am. The
  quick ranges exist because the realistic ask is "tonight" or "the rest of
  today", and making somebody pick two datetimes for that is how a gap stays
  unfilled.
-->
<template>
  <ODialog
    :open="open"
    :title="mode === 'swap' ? t('oncall.swapTitle') : t('oncall.coverTitle')"
    :primary-button-label="t('oncall.save')"
    :secondary-button-label="t('oncall.cancel')"
    :form-id="mode === 'swap' ? undefined : FORM_ID"
    :primary-button-loading="saving"
    :primary-button-disabled="mode === 'swap' && !swapReady"
    data-test="oncall-cover-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="mode === 'swap' ? submitSwap() : undefined"
    @click:secondary="close"
  >
    <!-- Two shapes of the same errand — "somebody stands in" and "these two
         trade weeks" — because a swap expressed as two covers is two dialogs,
         two datetime ranges and a chance to get the second one wrong. -->
    <OToggleGroup v-if="shifts.length" v-model="mode" class="mb-4" data-test="oncall-cover-mode">
      <OToggleGroupItem value="cover" size="sm" data-test="oncall-cover-mode-cover">
        {{ t("oncall.coverModeCover") }}
      </OToggleGroupItem>
      <OToggleGroupItem value="swap" size="sm" data-test="oncall-cover-mode-swap">
        {{ t("oncall.coverModeSwap") }}
      </OToggleGroupItem>
    </OToggleGroup>

    <!-- A swap is picked from shifts that EXIST, not typed as two date ranges:
         the errand is "these two trade their weeks", and the weeks are already
         on the schedule. Two selects, one save. -->
    <div v-if="mode === 'swap'" class="flex flex-col gap-5" data-test="oncall-swap-form">
      <OSelect
        v-model="swapA"
        :label="t('oncall.swapFirstShift')"
        :options="shiftOptions"
        data-test="oncall-swap-a"
      />
      <OSelect
        v-model="swapB"
        :label="t('oncall.swapSecondShift')"
        :options="shiftOptions"
        data-test="oncall-swap-b"
      />

      <!-- Exactly what the two writes will do, named both ways round: a swap
           that says only "Ana and Bo swap" leaves the reader to work out which
           week each of them ends up holding. -->
      <OBanner v-if="swapSummary" variant="info" data-test="oncall-swap-summary">
        {{ swapSummary }}
      </OBanner>
      <p
        v-else-if="swapProblem"
        class="text-status-warning-text text-sm"
        data-test="oncall-swap-problem"
      >
        {{ swapProblem }}
      </p>
    </div>

    <OForm v-else :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormSelect
        name="user_email"
        :label="t('oncall.coverWho')"
        :options="memberOptions"
        :help-text="currentlyOnCall"
        required
        data-test="oncall-cover-who"
      />

      <!-- Only when there is a choice to make. A single-slot team has one
           rotation, and a select with one option is a question with one
           answer. -->
      <OFormSelect
        v-if="slotOptions.length > 1"
        name="slot"
        :label="t('oncall.coverSlot')"
        :options="slotOptions"
        :help-text="t('oncall.coverSlotHint')"
        data-test="oncall-cover-slot"
      />

      <!-- Presets first, because they are the answer almost every time. -->
      <div class="flex flex-col gap-2">
        <OText variant="label">{{ t("oncall.coverQuickRanges") }}</OText>
        <span class="flex flex-wrap gap-2">
          <OButton
            v-for="preset in PRESETS"
            :key="preset.key"
            variant="outline"
            size="xs"
            :data-test="`oncall-cover-preset-${preset.key}`"
            @click="applyPreset(preset.key)"
          >
            {{ t(preset.labelKey) }}
          </OButton>
        </span>
      </div>

      <OFormDateTimeRange
        name="window"
        :label="t('oncall.coverWhen')"
        required
        data-test="oncall-cover-window"
      />

      <!-- What this will actually do, in the team's own clock, before saving. -->
      <OBanner v-if="summary" variant="info" data-test="oncall-cover-summary">
        {{ summary }}
        <span class="text-text-secondary">{{ t("oncall.coverSummaryAfter") }}</span>
      </OBanner>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { DateTimeRangeValue } from "@/lib/forms/DateTime/OFormDateTimeRange.types";
import OFormDateTimeRange from "@/lib/forms/DateTime/OFormDateTimeRange.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OnCallTeamMember } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, MICROS_PER_DAY, MICROS_PER_HOUR, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Shift as UpcomingShift } from "@/utils/oncall";
import { formatInZone } from "@/utils/oncall";
import { makeOnCallCoverSchema } from "./OnCallCoverForm.schema";

/**
 * What the cover half of this dialog holds.
 *
 * Deliberately **not** `OnCallCoverValue` (the schema's output type): the form
 * holds the window while it is still half-picked and while it is still absent,
 * which is exactly the state the schema exists to reject.
 */
interface OnCallCoverFormValues extends Record<string, unknown> {
  user_email: string;
  slot: string;
  window?: DateTimeRangeValue;
}

const props = withDefaults(
  defineProps<{
    open?: boolean;
    members?: OnCallTeamMember[];
    timezone?: string;
    saving?: boolean;
    /** Who currently holds the shift, so the picker can say who is being relieved. */
    currentHolder?: string | null;
    /** Named in the confirmation, because a cover is always a cover OF a team. */
    teamName?: string;
    /** Pre-fills the window when the caller is covering a known gap. */
    gap?: { from: number; to: number } | null;
    /**
     * Pre-selects who takes the shift. Ignored when that person is not on this
     * team — see `prefilledUser`.
     */
    defaultUser?: string;
    /**
     * Upcoming shifts, resolved the way the engine resolves them — the two
     * things a swap trades. Empty hides the swap mode entirely: a team with no
     * rota has no weeks to exchange.
     */
    shifts?: UpcomingShift[];
    /**
     * The slots this team staffs, in display order. One slot needs no picker —
     * a cover means the only rotation there is. Two do: a cover written with
     * no slot lands on the default one and evicts whoever held it.
     */
    slots?: string[];
  }>(),
  {
    open: false,
    members: () => [],
    timezone: "UTC",
    saving: false,
    currentHolder: null,
    teamName: "",
    gap: null,
    defaultUser: "",
    shifts: () => [],
    slots: () => [],
  },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (
    e: "save",
    value: { user_email: string; start_at: number; end_at: number; slot?: string },
  ): void;
  /**
   * Two covers, one each way — the caller writes both and owns what happens if
   * the second write fails after the first succeeded.
   */
  (
    e: "swap",
    value: {
      first: { user_email: string; start_at: number; end_at: number; slot?: string; covering_for?: string };
      second: { user_email: string; start_at: number; end_at: number; slot?: string; covering_for?: string };
    },
  ): void;
}>();

const { t } = useI18nTyped();

const FORM_ID = "oncall-cover-form";

/// Which errand this dialog is doing. Declared here rather than beside the swap
/// helpers below, because the open watcher resets it.
const mode = ref<"cover" | "swap">("cover");
const swapA = ref<string>("");
const swapB = ref<string>("");

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    resetForm();
    // A gap is a hole to fill, never a week to trade — opening on Swap would
    // answer a question the caller did not ask.
    mode.value = "cover";
    swapA.value = "";
    swapB.value = "";
  },
);

const memberOptions = computed(() =>
  props.members.map((member) => ({ label: raw(member.user_email), value: member.user_email })),
);

const currentlyOnCall = computed<I18nText | undefined>(() =>
  props.currentHolder
    ? t("oncall.coverCurrentlyOnCall", { name: raw(props.currentHolder) })
    : undefined,
);

/// A pre-selected person is only honest if the picker can show them: the caller
/// passes whoever is reading the page, and a reader who is not on this team has
/// no option to select — pre-filling them would put a value in the select that
/// is not in its list, which reads as chosen and submits as nothing.
///
/// Matched case-insensitively but resolved back to the member's own spelling,
/// so what lands in the field IS one of the options rather than something that
/// merely looks equal to one.
const prefilledUser = computed(() => {
  const wanted = props.defaultUser?.trim().toLowerCase();
  if (!wanted) return "";
  return (
    props.members.find((member) => member.user_email.trim().toLowerCase() === wanted)?.user_email ??
    ""
  );
});

/// The form is created here rather than inside `<OForm>` because the summary
/// below has to read the window the reader actually picked. It used to read a
/// separate `windowValue` ref that only the presets and the gap prop ever
/// wrote, so choosing a range in the picker left the summary showing the old
/// one — or nothing at all. Two sources of truth for one field is also what
/// produced the save bug this component is named for, so there is now one.
const form = useOForm<OnCallCoverFormValues>({
  defaultValues: initialValues(),
  schema: makeOnCallCoverSchema(t),
  onSubmit: onSubmit,
});

function initialValues(): OnCallCoverFormValues {
  return {
    user_email: prefilledUser.value,
    slot: props.slots[0] ?? DEFAULT_SLOT,
    window: props.gap ? { from: props.gap.from, to: props.gap.to } : undefined,
  };
}

/// Re-seeds from the props the caller opened with, and clears the errors from
/// a previous attempt — reopening on a fresh gap must not inherit the last
/// one's complaints.
function resetForm() {
  form.reset(initialValues());
}

/// The live window and the live person, for the summary and nothing else.
/// `useStore` keeps them in step with the fields on every change, which a
/// mirrored ref could not.
const windowValue = form.useStore(
  (state: { values: OnCallCoverFormValues }) => state.values.window,
);
const userValue = form.useStore(
  (state: { values: OnCallCoverFormValues }) => state.values.user_email,
);

const PRESETS = [
  { key: "rest-of-day", labelKey: "oncall.coverRestOfDay" },
  { key: "tonight", labelKey: "oncall.coverTonight" },
  { key: "tomorrow", labelKey: "oncall.coverTomorrow" },
  { key: "next-7-days", labelKey: "oncall.coverNext7Days" },
] as const satisfies ReadonlyArray<{ key: string; labelKey: I18nKey }>;

/// Anchored to the team's day, not the browser's: "tonight" means the team's
/// night, and somebody arranging cover from another office means that too.
function applyPreset(key: (typeof PRESETS)[number]["key"]) {
  const now = Date.now() * 1000;
  const dayStart = Math.floor(now / MICROS_PER_DAY) * MICROS_PER_DAY;

  const ranges: Record<string, { from: number; to: number }> = {
    "rest-of-day": { from: now, to: dayStart + MICROS_PER_DAY },
    tonight: { from: dayStart + 18 * MICROS_PER_HOUR, to: dayStart + 30 * MICROS_PER_HOUR },
    tomorrow: { from: dayStart + MICROS_PER_DAY, to: dayStart + 2 * MICROS_PER_DAY },
    "next-7-days": { from: now, to: now + 7 * MICROS_PER_DAY },
  };
  form.setFieldValue("window", ranges[key]);
}

const summary = computed<I18nText | "">(() => {
  const window = windowValue.value;
  const who = String(userValue.value ?? "");
  // A half-picked range is not a sentence yet — the picker reports one end at
  // a time, and "Sat 18:00 – Invalid Date" is worse than nothing. Nor is a
  // range with nobody against it.
  if (typeof window?.from !== "number" || typeof window?.to !== "number") return "";
  if (!who) return "";
  const fmt = (micros: number) =>
    formatInZone(micros, props.timezone, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  // The person TAKING the shift. This read `currentHolder` — whoever is being
  // relieved — so the confirmation named the wrong side of the handover, and
  // the team was passed as an empty string.
  return t("oncall.coverSummary", {
    name: raw(who),
    team: raw(props.teamName ?? ""),
    range: raw(`${fmt(window.from)} – ${fmt(window.to)}`),
  });
});

/// ── Swap ──────────────────────────────────────────────────────────────────
///
/// A swap is two covers, one each way: over A's shift the roster resolves to B,
/// and over B's shift it resolves to A. Neither rotation is reordered, so the
/// week after the trade belongs to whoever it always did — which is what makes
/// a swap safe to agree to in a chat thread.

/// Keyed by instant, not by index: the list is recomputed from `now` every time
/// the dialog opens, and an index would silently point at a different week.
const shiftKey = (shift: UpcomingShift) => `${shift.slot ?? DEFAULT_SLOT}:${shift.startMicros}`;

/// Keyed by slot AND instant: two slots hand over at the same moment, so the
/// instant alone collapses a primary week and a secondary week onto one entry.
const shiftByKey = computed(() => {
  const map = new Map<string, UpcomingShift>();
  for (const shift of props.shifts) map.set(shiftKey(shift), shift);
  return map;
});

const slotOptions = computed(() =>
  props.slots.map((slot) => ({ label: raw(slot), value: slot })),
);

/// The slot rides the label whenever the team staffs more than one: two weeks
/// with the same dates and different pools are otherwise indistinguishable in
/// the picker, and picking the wrong one writes a cover on the wrong rotation.
const shiftLabel = (shift: UpcomingShift): I18nText =>
  t(props.slots.length > 1 ? "oncall.swapShiftOptionInSlot" : "oncall.swapShiftOption", {
    name: raw(shift.member),
    slot: raw(shift.slot ?? DEFAULT_SLOT),
    range: raw(
      `${formatInZone(shift.startMicros, props.timezone, {
        weekday: "short",
        day: "numeric",
        month: "short",
      })} – ${formatInZone(shift.endMicros, props.timezone, { day: "numeric", month: "short" })}`,
    ),
  });

const shiftOptions = computed(() =>
  props.shifts.map((shift) => ({
    label: shiftLabel(shift),
    value: shiftKey(shift),
  })),
);

const swapPair = computed(() => {
  const first = shiftByKey.value.get(swapA.value);
  const second = shiftByKey.value.get(swapB.value);
  return first && second ? { first, second } : null;
});

/// Why this pair cannot be traded, in the reader's terms. Said as prose rather
/// than a disabled button with no explanation.
const swapProblem = computed<I18nText | "">(() => {
  const pair = swapPair.value;
  if (!pair) return "";
  if (shiftKey(pair.first) === shiftKey(pair.second)) return t("oncall.swapSameShift");
  // Trading across slots is not a swap: it moves the pager between two pools
  // that are on call at the same time, leaving one of them staffed twice.
  if (!sameSlot(pair.first.slot, pair.second.slot)) return t("oncall.swapCrossSlot");
  // Trading a week with yourself writes two covers that change nothing.
  if (pair.first.member === pair.second.member) return t("oncall.swapSamePerson");
  return "";
});

const swapReady = computed(() => !!swapPair.value && !swapProblem.value);

/// Named both ways round on purpose: "Ana and Bo swap" leaves the reader to
/// work out which week each of them ends up holding, and getting that backwards
/// is the whole risk of the errand.
const swapSummary = computed<I18nText | "">(() => {
  const pair = swapPair.value;
  if (!pair || swapProblem.value) return "";
  const when = (shift: UpcomingShift) =>
    raw(
      formatInZone(shift.startMicros, props.timezone, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    );
  return t("oncall.swapSummary", {
    first: raw(pair.first.member),
    second: raw(pair.second.member),
    firstWhen: when(pair.first),
    secondWhen: when(pair.second),
  });
});

function submitSwap() {
  const pair = swapPair.value;
  if (!pair || swapProblem.value) return;
  emit("swap", {
    // Each cover names the person taking the OTHER one's shift, and lands in
    // the slot that shift belongs to — a cover with no slot goes to the
    // default one, which on a two-slot team evicts the primary holder.
    first: {
      user_email: pair.second.member,
      start_at: pair.first.startMicros,
      end_at: pair.first.endMicros,
      slot: pair.first.slot,
      covering_for: pair.first.member,
    },
    second: {
      user_email: pair.first.member,
      start_at: pair.second.startMicros,
      end_at: pair.second.endMicros,
      slot: pair.second.slot,
      covering_for: pair.second.member,
    },
  });
}

function close() {
  emit("update:open", false);
}

/// Where the form's shape becomes the request's shape. The range picker holds
/// one `window`; the API takes `start_at` and `end_at`. Mapping here — rather
/// than asking the schema to validate a pair no control renders — is what makes
/// Save fire at all.
///
/// Explicit keys, never a spread: the form value also carries the picker's own
/// `type`/`period` bookkeeping, and the API takes exactly four fields.
function onSubmit(value: OnCallCoverFormValues) {
  const window = value.window;
  if (typeof window?.from !== "number" || typeof window?.to !== "number") return;
  emit("save", {
    user_email: String(value.user_email ?? ""),
    start_at: window.from,
    end_at: window.to,
    slot: String(value.slot ?? "") || undefined,
  });
}
</script>
