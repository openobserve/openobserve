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

    <OForm
      v-else
      :id="FORM_ID"
      :key="formKey"
      :schema="schema"
      :default-values="defaultValues"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormSelect
        name="user_email"
        :label="t('oncall.coverWho')"
        :options="memberOptions"
        :help-text="currentlyOnCall"
        required
        data-test="oncall-cover-who"
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
import OFormDateTimeRange from "@/lib/forms/DateTime/OFormDateTimeRange.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OnCallTeamMember } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Shift as UpcomingShift } from "@/utils/oncall";
import { formatInZone } from "@/utils/oncall";
import { makeOnCallCoverSchema } from "./OnCallCoverForm.schema";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    members?: OnCallTeamMember[];
    timezone?: string;
    saving?: boolean;
    /** Who currently holds the shift, so the picker can say who is being relieved. */
    currentHolder?: string | null;
    /** Pre-fills the window when the caller is covering a known gap. */
    gap?: { from: number; to: number } | null;
    /**
     * Upcoming shifts, resolved the way the engine resolves them — the two
     * things a swap trades. Empty hides the swap mode entirely: a team with no
     * rota has no weeks to exchange.
     */
    shifts?: UpcomingShift[];
  }>(),
  {
    open: false,
    members: () => [],
    timezone: "UTC",
    saving: false,
    currentHolder: null,
    gap: null,
    shifts: () => [],
  },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "save", value: { user_email: string; start_at: number; end_at: number }): void;
  /**
   * Two covers, one each way — the caller writes both and owns what happens if
   * the second write fails after the first succeeded.
   */
  (
    e: "swap",
    value: {
      first: { user_email: string; start_at: number; end_at: number };
      second: { user_email: string; start_at: number; end_at: number };
    },
  ): void;
}>();

const { t } = useI18nTyped();

const FORM_ID = "oncall-cover-form";

/// Remounts OForm on open so the defaults re-read the gap the caller passed.
const formKey = ref(0);
const windowValue = ref<{ from: number; to: number } | null>(null);

/// Which errand this dialog is doing. Declared here rather than beside the swap
/// helpers below, because the open watcher resets it.
const mode = ref<"cover" | "swap">("cover");
const swapA = ref<string>("");
const swapB = ref<string>("");

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    windowValue.value = props.gap ? { from: props.gap.from, to: props.gap.to } : null;
    formKey.value += 1;
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

const schema = computed(() => makeOnCallCoverSchema(t));

const defaultValues = computed(() => ({
  user_email: "",
  window: windowValue.value ? { from: windowValue.value.from, to: windowValue.value.to } : undefined,
}));

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
  windowValue.value = ranges[key];
  formKey.value += 1;
}

const summary = computed<I18nText | "">(() => {
  const window = windowValue.value;
  if (!window) return "";
  const fmt = (micros: number) =>
    formatInZone(micros, props.timezone, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return t("oncall.coverSummary", {
    name: raw(props.currentHolder ?? ""),
    team: raw(""),
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
const shiftByKey = computed(() => {
  const map = new Map<string, UpcomingShift>();
  for (const shift of props.shifts) map.set(String(shift.startMicros), shift);
  return map;
});

const shiftLabel = (shift: UpcomingShift): I18nText =>
  t("oncall.swapShiftOption", {
    name: raw(shift.member),
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
    value: String(shift.startMicros),
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
  if (pair.first.startMicros === pair.second.startMicros) return t("oncall.swapSameShift");
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
    // Each cover names the person taking the OTHER one's shift.
    first: {
      user_email: pair.second.member,
      start_at: pair.first.startMicros,
      end_at: pair.first.endMicros,
    },
    second: {
      user_email: pair.first.member,
      start_at: pair.second.startMicros,
      end_at: pair.second.endMicros,
    },
  });
}

function close() {
  emit("update:open", false);
}

function onSubmit(value: Record<string, unknown>) {
  const window = value.window as { from?: number; to?: number } | undefined;
  if (!window?.from || !window?.to) return;
  // Explicit keys, never a spread: the form value carries whatever the schema
  // and the controls put on it, and the API takes exactly three fields.
  emit("save", {
    user_email: String(value.user_email ?? ""),
    start_at: window.from,
    end_at: window.to,
  });
}
</script>
