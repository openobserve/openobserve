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
    :title="t('oncall.coverTitle')"
    :primary-label="t('oncall.save')"
    :secondary-label="t('oncall.cancel')"
    :form-id="FORM_ID"
    :primary-loading="saving"
    data-test="oncall-cover-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:secondary="close"
  >
    <OForm
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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OnCallTeamMember } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
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
  }>(),
  { open: false, members: () => [], timezone: "UTC", saving: false, currentHolder: null, gap: null },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "save", value: { user_email: string; start_at: number; end_at: number }): void;
}>();

const { t } = useI18nTyped();

const FORM_ID = "oncall-cover-form";

/// Remounts OForm on open so the defaults re-read the gap the caller passed.
const formKey = ref(0);
const windowValue = ref<{ from: number; to: number } | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    windowValue.value = props.gap ? { from: props.gap.from, to: props.gap.to } : null;
    formKey.value += 1;
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
