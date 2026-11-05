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
    :primary-button-disabled="mode === 'swap' ? !swapReady : false"
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
        :options="swapWithOptions"
        data-test="oncall-swap-b"
      />

      <!-- Exactly what the two writes will do, named both ways round: a swap
           that says only "Ana and Bo swap" leaves the reader to work out which
           week each of them ends up holding. -->
      <OBanner v-if="swapSummary" variant="info" data-test="oncall-swap-summary">
        <i18n-t keypath="oncall.swapSummary" tag="span" scope="global">
          <template #first><OnCallPersonName :email="swapSummary.first" /></template>
          <template #second><OnCallPersonName :email="swapSummary.second" /></template>
          <template #firstWhen>{{ swapSummary.firstWhen }}</template>
          <template #secondWhen>{{ swapSummary.secondWhen }}</template>
        </i18n-t>
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
        searchable
        required
        data-test="oncall-cover-who"
      />

      <!-- Only when there is a choice to make. A one-rotation team has one
           rotation, and a select with one option is a question with one
           answer. -->
      <OFormSelect
        v-if="rotationOptions.length > 1"
        name="rotation_id"
        :label="t('oncall.coverRotation')"
        :options="rotationOptions"
        data-test="oncall-cover-rotation"
      />

      <i18n-t
        v-if="holders.length"
        keypath="oncall.coverHolderLine"
        tag="p"
        scope="global"
        class="text-text-secondary text-sm"
        data-test="oncall-cover-holder"
      >
        <template #name>
          <template v-for="(email, index) in holders" :key="email">
            <template v-if="index > 0">{{ raw(", ") }}</template>
            <OnCallPersonName :email="email" />
          </template>
        </template>
      </i18n-t>

      <!-- Absolute only: a relative period resolves against the moment it is read, and a cover is forward-looking. -->
      <!-- A plain block: straight in the form's flex column, the picker's border stretches past its buttons. -->
      <div>
        <OFormDateTimeRange
          name="window"
          :label="t('oncall.coverWhen')"
          required
          disable-relative
          auto-apply
          :trigger-text="windowLabel"
          :picker-timezone="pickedZone"
          hide-clipboard
          show-error
          :min-date="calendarDay(0)"
          :max-date="calendarDay(MAX_AHEAD_MICROS)"
          data-test="oncall-cover-window"
          @on:timezone-change="(zone: string) => (pickedZone = zone)"
        >
          <template #label-append>
            <OnCallZoneInfo
              :timezone="timezone"
              :viewer-timezone="viewerTimezone"
              :picked-timezone="pickedZone"
              :range="windowValue"
            />
          </template>
          <template #above>
            <span class="flex flex-wrap gap-2" data-test="oncall-cover-presets">
              <OButton
                v-for="preset in PRESETS"
                :key="preset.key"
                :variant="activePreset === preset.key ? 'outline-primary' : 'outline'"
                size="xs"
                :aria-pressed="activePreset === preset.key"
                :data-test="`oncall-cover-preset-${preset.key}`"
                @click="applyPreset(preset.key)"
              >
                {{ t(preset.labelKey) }}
              </OButton>
            </span>
          </template>
        </OFormDateTimeRange>
      </div>

      <!-- What this will actually do, in the team's own clock, before saving. -->
      <OBanner v-if="summary" variant="info" data-test="oncall-cover-summary">
        <i18n-t
          :keypath="summary.holder ? 'oncall.coverSummaryFor' : 'oncall.coverSummaryOn'"
          tag="span"
          scope="global"
        >
          <template #name><OnCallPersonName :email="summary.who" /></template>
          <template v-if="summary.holder" #holder>
            <OnCallPersonName :email="summary.holder" />
          </template>
          <template #rotation>{{ summary.rotation }}</template>
          <template #when>{{ summary.when }}</template>
        </i18n-t>
        {{ raw(" ") }}
        <span class="text-text-secondary">{{ t("oncall.coverSummaryAfter") }}</span>
      </OBanner>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
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
import type { OnCallPosition, OnCallTeamMember, ResolvedSegment } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Rotation } from "@/ts/interfaces/oncall";
import type { Shift } from "@/utils/oncall";

/**
 * One swappable week, and which rotation's week it is.
 *
 * A `Shift` alone cannot say: the roster and the cadence live on a shift RULE,
 * and a swap is written against the position the rule staffs. Two rotations
 * hand over at the same instant, so without the id a primary week and a
 * secondary week collapse onto one entry in the picker.
 */
export interface UpcomingShift extends Shift {
  rotationId: string;
  rotationName: string;
}
import {
  formatDayRange,
  formatInZone,
  formatShiftRange,
  formatZonedRange,
  fromZonedInputValue,
  toZonedInputValue,
} from "@/utils/oncall";
import { MAX_AHEAD_MICROS, makeOnCallCoverSchema } from "./OnCallCoverForm.schema";
import OnCallPersonName from "./OnCallPersonName.vue";
import OnCallZoneInfo from "./OnCallZoneInfo.vue";
import { SHIFT_LOOKUP_MICROS, holdersOver } from "./resolvedShifts";
import { useOrgUserNames } from "@/composables/useOrgUserNames";

/**
 * What the cover half of this dialog holds.
 *
 * Deliberately **not** `OnCallCoverValue` (the schema's output type): the form
 * holds the window while it is still half-picked and while it is still absent,
 * which is exactly the state the schema exists to reject.
 */
interface OnCallCoverFormValues extends Record<string, unknown> {
  user_email: string;
  rotation_id: string;
  window?: DateTimeRangeValue;
}

const props = withDefaults(
  defineProps<{
    open?: boolean;
    members?: OnCallTeamMember[];
    timezone?: string;
    saving?: boolean;
    /** Whose shift a cover opened from a clicked shift relieves; sent as `covering_for`. */
    currentHolder?: string | null;
    /** Who each rotation puts on call now, for the holder line when no shift was clicked. */
    positions?: OnCallPosition[];
    /** The reader's own clock; the zone is named in the field, and the window restated in the tooltip, when it is not the team's. */
    viewerTimezone?: string;
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
     * The rotations this team staffs, in schedule order. One needs no picker —
     * a cover means the only position there is. Two do: a cover written with no
     * rotation lands on the primary and evicts whoever held it.
     *
     * A rotation the team does not have is refused by the server rather than
     * stored, because a cover over a position nothing staffs pages nobody.
     */
    rotations?: Rotation[];
    /** Pre-selects the rotation being covered, e.g. from a clicked shift. */
    defaultRotation?: string;
    /** Which errand the dialog opens on. */
    defaultMode?: "cover" | "swap";
    /** Pre-selects the swap's first shift: the one of this rotation running at `at`. */
    swapFrom?: { rotationId: string; at: number } | null;
    /** Reads the resolved schedule of one rotation, so the holder line and `covering_for` follow the picked window. */
    resolveRuns?:
      ((rotationId: string, from: number, to: number) => Promise<ResolvedSegment[]>) | null;
  }>(),
  {
    open: false,
    members: () => [],
    timezone: "UTC",
    viewerTimezone: "UTC",
    saving: false,
    currentHolder: null,
    positions: () => [],
    teamName: "",
    gap: null,
    defaultUser: "",
    shifts: () => [],
    rotations: () => [],
    defaultRotation: "",
    defaultMode: "cover",
    swapFrom: null,
    resolveRuns: null,
  },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (
    e: "save",
    value: {
      user_email: string;
      start_at: number;
      end_at: number;
      rotation_id?: string;
      covering_for?: string;
    },
  ): void;
  /**
   * Two covers, one each way — the caller writes both and owns what happens if
   * the second write fails after the first succeeded.
   */
  (
    e: "swap",
    value: {
      first: {
        user_email: string;
        start_at: number;
        end_at: number;
        rotation_id?: string;
        covering_for?: string;
      };
      second: {
        user_email: string;
        start_at: number;
        end_at: number;
        rotation_id?: string;
        covering_for?: string;
      };
    },
  ): void;
}>();

const { t } = useI18nTyped();

const FORM_ID = "oncall-cover-form";

/// How long a cover runs when nobody says otherwise: long enough to be worth
/// arranging, short enough that accepting it unread cannot hand somebody a week.
const DEFAULT_COVER_MICROS = 4 * MICROS_PER_HOUR;

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
    // Swap only when asked for: a gap is a hole to fill, never a week to trade.
    mode.value = props.defaultMode === "swap" && props.shifts.length ? "swap" : "cover";
    swapA.value = mode.value === "swap" ? swapFromKey() : "";
    swapB.value = "";
  },
);

// Opened from a shift, switching to Swap keeps that shift as the one being traded.
watch(mode, (next) => {
  if (next === "swap" && !swapA.value) swapA.value = swapFromKey();
});

const { nameOf, optionOf } = useOrgUserNames();

const memberOptions = computed(() => props.members.map((member) => optionOf(member.user_email)));

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
  const now = Date.now() * 1000;
  return {
    user_email: prefilledUser.value,
    rotation_id:
      props.rotations.find((rotation) => rotation.id === props.defaultRotation)?.id ??
      props.rotations[0]?.id ??
      "",
    // A cover is arranged for hours that have not happened yet, so the window
    // opens on some. Left undefined, the picker fell back to its log-search
    // default — the past half hour — and emitted it on mount, so a dialog
    // nobody touched held a window that had already elapsed by the time Save
    // was pressed. It saved, and a cover over hours that are gone pages nobody.
    //
    // `type` is load-bearing: the picker re-reads a relative type as a period
    // and re-resolves it against `now`, discarding the instants beside it —
    // which is why a pre-filled `gap` never survived being opened either.
    window: {
      type: "absolute",
      ...(props.gap
        ? { from: props.gap.from, to: props.gap.to }
        : { from: now, to: now + DEFAULT_COVER_MICROS }),
    },
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
const rotationValue = form.useStore(
  (state: { values: OnCallCoverFormValues }) => state.values.rotation_id,
);

/// Fallback without a resolved read: the clicked shift's person while its rotation is still picked, else whoever it has on now.
const fallbackHolder = computed<string>(() => {
  const rotation = String(rotationValue.value ?? "");
  if (props.currentHolder && (!props.defaultRotation || rotation === props.defaultRotation)) {
    return props.currentHolder;
  }
  const position =
    props.positions.find((one) => one.rotation_id === rotation) ??
    (props.rotations.length <= 1 ? props.positions[0] : undefined);
  return position?.user_email ?? "";
});

/// Who the resolved schedule puts on the picked rotation over the picked window, tagged with the read it answers.
const windowHolders = ref<{ key: string; people: string[]; sole: string | null } | null>(null);

const holderQuery = computed<{ key: string; rotation: string; from: number; to: number } | null>(
  () => {
    const window = windowValue.value;
    const rotation = String(rotationValue.value ?? "");
    if (!props.open || !props.resolveRuns || !rotation) return null;
    if (typeof window?.from !== "number" || typeof window?.to !== "number") return null;
    if (window.to <= window.from) return null;
    return {
      key: `${rotation}:${window.from}:${window.to}`,
      rotation,
      from: window.from,
      to: window.to,
    };
  },
);

const windowKey = computed<string>(() => holderQuery.value?.key ?? "");

watch(
  windowKey,
  async (key) => {
    const query = holderQuery.value;
    if (!query || !props.resolveRuns) {
      windowHolders.value = null;
      return;
    }
    // The server caps one read, so a longer window is read in part and can never prove a sole holder.
    const readTo = Math.min(query.to, query.from + SHIFT_LOOKUP_MICROS);
    try {
      const runs = await props.resolveRuns(query.rotation, query.from, readTo);
      if (key !== windowKey.value) return;
      const found = holdersOver(runs, { from: query.from, to: readTo });
      windowHolders.value = {
        key,
        people: found.people,
        sole: readTo === query.to ? found.sole : null,
      };
    } catch {
      if (key === windowKey.value) windowHolders.value = null;
    }
  },
  { immediate: true },
);

/// The current read's answer only: a stale one names whoever held the window before it changed.
const currentHolders = computed(() =>
  windowHolders.value && windowHolders.value.key === windowKey.value ? windowHolders.value : null,
);

const holders = computed<string[]>(() => {
  if (holderQuery.value) return currentHolders.value?.people ?? [];
  return fallbackHolder.value ? [fallbackHolder.value] : [];
});

const PRESETS = [
  { key: "rest-of-day", labelKey: "oncall.coverRestOfDay" },
  { key: "tonight", labelKey: "oncall.coverTonight" },
  { key: "tomorrow", labelKey: "oncall.coverTomorrow" },
  { key: "next-7-days", labelKey: "oncall.coverNext7Days" },
] as const satisfies ReadonlyArray<{ key: string; labelKey: I18nKey }>;

/// A wall time on the TEAM's clock: `addDays` from the day `micros` falls in,
/// at `time`.
///
/// The day is added to the calendar DATE rather than to the instant because not
/// every day is 24 hours long — across a DST boundary "tomorrow at midnight" is
/// 23 or 25 hours away, and a shift that starts an hour out is a shift somebody
/// is paged for.
function zonedInstant(micros: number, zone: string, addDays: number, time = "00:00"): number {
  const [year, month, day] = toZonedInputValue(micros, zone).slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + addDays)).toISOString().slice(0, 10);
  return fromZonedInputValue(`${shifted}T${time}`, zone) ?? micros + addDays * MICROS_PER_DAY;
}

/// Anchored to the team's day, not the browser's and not UTC's: "tonight" means
/// the team's night, and somebody arranging cover from another office means that
/// too.
///
/// This used to say so while flooring the instant to a multiple of a day, which
/// is midnight UTC — so an IST team's "tonight" began at 23:30 and its "rest of
/// today" ran to half past five the following morning.
type PresetKey = (typeof PRESETS)[number]["key"];

function presetRanges(now: number): Record<PresetKey, { from: number; to: number }> {
  const at = (addDays: number, time?: string) => zonedInstant(now, props.timezone, addDays, time);
  return {
    "rest-of-day": { from: now, to: at(1) },
    tonight: { from: at(0, "18:00"), to: at(1, "06:00") },
    tomorrow: { from: at(1), to: at(2) },
    "next-7-days": { from: now, to: now + 7 * MICROS_PER_DAY },
  };
}

function applyPreset(key: PresetKey) {
  const ranges = presetRanges(Date.now() * 1000);
  // `type` travels with every write into this field, not just the seed: the
  // control is re-read whenever the value changes from outside it, and a range
  // with no type is re-read as a relative period and resolved against `now` —
  // which threw the preset away and put the past half hour back.
  form.setFieldValue("window", { type: "absolute", ...ranges[key] });
  presetApplied = { key, ...ranges[key] };
}

/// The picker stores whole minutes, so a preset starting "now" comes back up to a minute off what was written.
const PRESET_MATCH_MICROS = 60 * 1_000_000;

let presetApplied: { key: PresetKey; from: number; to: number } | null = null;

const near = (a: number, b: number) => Math.abs(a - b) <= PRESET_MATCH_MICROS;

/// Derived from the range the field holds, against the last preset written and each preset as of now.
const activePreset = computed<PresetKey | null>(() => {
  const value = windowValue.value;
  if (typeof value?.from !== "number" || typeof value?.to !== "number") return null;
  const matches = (range: { from: number; to: number }) =>
    near(value.from as number, range.from) && near(value.to as number, range.to);
  if (presetApplied && matches(presetApplied)) return presetApplied.key;
  const fresh = presetRanges(Date.now() * 1000);
  return PRESETS.find((preset) => matches(fresh[preset.key]))?.key ?? null;
});

/// The zone the picker reads its fields in: the team's when it opens, and the reader may pick another.
const pickedZone = ref(props.timezone);
watch(
  () => [props.open, props.timezone] as const,
  ([isOpen]) => {
    if (isOpen) pickedZone.value = props.timezone;
  },
);

/// The picker's calendar day `aheadMicros` from now, on the clock the picker shows.
function calendarDay(aheadMicros: number): string {
  const at = Date.now() * 1000 + aheadMicros;
  return toZonedInputValue(at, pickedZone.value).slice(0, 10).replace(/-/g, "/");
}

/// The field states the window on the team's clock, naming the zone once, at the end, when the picker is on another one.
const windowLabel = computed<string>(() => {
  const window = windowValue.value;
  if (typeof window?.from !== "number" || typeof window?.to !== "number") return "";
  return formatZonedRange(
    window.from,
    window.to,
    props.timezone,
    props.timezone !== props.viewerTimezone || pickedZone.value !== props.timezone,
  );
});

/// Who takes whose shift, on which rotation, over which days; the times are said once, by the field.
const summary = computed<{
  who: string;
  holder?: string;
  rotation: I18nText;
  when: I18nText;
} | null>(() => {
  const window = windowValue.value;
  const who = String(userValue.value ?? "");
  // A half-picked range is not a cover yet, nor is a range with nobody against it.
  if (typeof window?.from !== "number" || typeof window?.to !== "number") return null;
  if (!who) return null;
  const rotationId = String(rotationValue.value ?? "");
  const rotation = props.rotations.find((one) => one.id === rotationId)?.name ?? props.teamName;
  return {
    // The person TAKING the shift; `holder` is whoever is being relieved.
    who,
    holder: coveredPerson(who),
    rotation: raw(rotation ?? ""),
    when: raw(formatDayRange(window.from, window.to, props.timezone)),
  };
});

/// ── Swap ──────────────────────────────────────────────────────────────────
///
/// A swap is two covers, one each way: over A's shift the roster resolves to B,
/// and over B's shift it resolves to A. Neither rotation is reordered, so the
/// week after the trade belongs to whoever it always did — which is what makes
/// a swap safe to agree to in a chat thread.

/// Keyed by instant, not by index: the list is recomputed from `now` every time
/// the dialog opens, and an index would silently point at a different week.
const shiftKey = (shift: UpcomingShift) => `${shift.rotationId}:${shift.startMicros}`;

/// Keyed by ROTATION and instant: two rotations hand over at the same moment,
/// so the instant alone collapses a primary week and a secondary week onto one
/// entry.
const shiftByKey = computed(() => {
  const map = new Map<string, UpcomingShift>();
  for (const shift of props.shifts) map.set(shiftKey(shift), shift);
  return map;
});

const rotationOptions = computed(() =>
  props.rotations.map((rotation) => ({ label: raw(rotation.name), value: rotation.id })),
);

/// The rotation rides the label whenever the team staffs more than one: two
/// weeks with the same dates and different positions are otherwise
/// indistinguishable in the picker, and picking the wrong one writes a cover on
/// the wrong rotation.
const SHIFT_STAMP: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

const shiftLabel = (shift: UpcomingShift): I18nText =>
  t(props.rotations.length > 1 ? "oncall.swapShiftOptionInRotation" : "oncall.swapShiftOption", {
    name: raw(nameOf(shift.member)),
    rotation: raw(shift.rotationName),
    range: raw(
      `${formatInZone(shift.startMicros, props.timezone, SHIFT_STAMP)} – ${formatInZone(
        shift.endMicros,
        props.timezone,
        SHIFT_STAMP,
      )}`,
    ),
  });

const shiftOptions = computed(() =>
  props.shifts.map((shift) => ({
    label: shiftLabel(shift),
    value: shiftKey(shift),
  })),
);

/// A shift cannot trade with itself, so the picked one is not offered as its partner.
const swapWithOptions = computed(() =>
  shiftOptions.value.filter((option) => option.value !== swapA.value),
);
watch(swapA, (picked) => {
  if (swapB.value === picked) swapB.value = "";
});

function swapFromKey(): string {
  const from = props.swapFrom;
  if (!from) return "";
  const shift = props.shifts.find(
    (s) => s.rotationId === from.rotationId && s.startMicros <= from.at && s.endMicros > from.at,
  );
  return shift ? shiftKey(shift) : "";
}

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
  // Trading across rotations is not a swap: it moves the pager between two
  // positions that are on call at the same time, leaving one of them staffed
  // twice and the other with a gap.
  if (pair.first.rotationId !== pair.second.rotationId) return t("oncall.swapCrossRotation");
  // Trading a week with yourself writes two covers that change nothing.
  if (pair.first.member === pair.second.member) return t("oncall.swapSamePerson");
  return "";
});

const swapReady = computed(() => !!swapPair.value && !swapProblem.value);

/// Named both ways round on purpose: "Ana and Bo swap" leaves the reader to
/// work out which week each of them ends up holding, and getting that backwards
/// is the whole risk of the errand.
const swapSummary = computed<{
  first: string;
  second: string;
  firstWhen: I18nText;
  secondWhen: I18nText;
} | null>(() => {
  const pair = swapPair.value;
  if (!pair || swapProblem.value) return null;
  const when = (shift: UpcomingShift) =>
    raw(formatShiftRange(shift.startMicros, shift.endMicros, props.timezone));
  return {
    first: pair.first.member,
    second: pair.second.member,
    firstWhen: when(pair.first),
    secondWhen: when(pair.second),
  };
});

function submitSwap() {
  const pair = swapPair.value;
  if (!pair || swapProblem.value) return;
  emit("swap", {
    // Each cover names the person taking the OTHER one's shift, and lands on
    // the rotation that shift belongs to — a cover with no rotation goes to the
    // primary, which on a two-rotation team evicts whoever held it.
    first: {
      user_email: pair.second.member,
      start_at: pair.first.startMicros,
      end_at: pair.first.endMicros,
      rotation_id: pair.first.rotationId,
      covering_for: pair.first.member,
    },
    second: {
      user_email: pair.first.member,
      start_at: pair.second.startMicros,
      end_at: pair.second.endMicros,
      rotation_id: pair.second.rotationId,
      covering_for: pair.second.member,
    },
  });
}

function close() {
  emit("update:open", false);
}

/// Whose hours the cover takes: only one person holding the whole window, and never the person covering.
function coveredPerson(user: string): string | undefined {
  let sole: string | null | undefined = currentHolders.value?.sole;
  // Without a read, only a clicked shift says whose shift this is; the holder now may not hold the picked hours.
  if (!holderQuery.value) {
    sole =
      props.currentHolder && fallbackHolder.value === props.currentHolder
        ? props.currentHolder
        : null;
  }
  return sole && sole !== user ? sole : undefined;
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
  const user = String(value.user_email ?? "");
  const coveringFor = coveredPerson(user);
  emit("save", {
    user_email: user,
    start_at: window.from,
    end_at: window.to,
    rotation_id: String(value.rotation_id ?? "") || undefined,
    ...(coveringFor ? { covering_for: coveringFor } : {}),
  });
}
</script>
