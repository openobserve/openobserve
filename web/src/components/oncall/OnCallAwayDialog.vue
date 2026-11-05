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

<template>
  <ODialog
    v-model:open="open"
    :title="t('oncall.awayTitle')"
    :primary-button-label="t('oncall.awaySave')"
    :secondary-button-label="t('oncall.cancel')"
    :form-id="FORM_ID"
    :primary-button-loading="saving"
    primary-button-data-test="oncall-members-away-save"
    data-test="oncall-members-away-dialog"
    @click:secondary="open = false"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <span v-if="email" class="flex min-w-0 items-center gap-2">
        <OAvatar :value="email" :name="nameOf(email)" size="sm" />
        <OnCallPersonName
          truncate
          :email="email"
          class="text-text-heading text-sm font-medium"
          data-test="oncall-members-away-person"
        />
      </span>

      <i18n-t
        v-if="email"
        keypath="oncall.awayConsequence"
        tag="p"
        scope="global"
        class="text-text-secondary text-sm"
        data-test="oncall-members-away-consequence"
      >
        <template #name><OnCallPersonName :email="email" /></template>
      </i18n-t>

      <!-- Absolute only, as Cover a shift: an absence is forward-looking. -->
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
          :min-date="calendarDay()"
          data-test="oncall-members-away-window"
          @on:timezone-change="(zone: string) => (pickedZone = zone)"
        >
          <template #label-append>
            <OnCallZoneInfo
              :timezone="timezone"
              :viewer-timezone="localZone"
              :picked-timezone="pickedZone"
              :range="windowValue"
              data-test="oncall-members-away-zone"
            />
          </template>
          <template #above>
            <span class="flex flex-wrap gap-2" data-test="oncall-members-away-presets">
              <OButton
                v-for="preset in PRESETS"
                :key="preset.key"
                :variant="activePreset === preset.key ? 'outline-primary' : 'outline'"
                size="xs"
                :aria-pressed="activePreset === preset.key"
                :data-test="`oncall-members-away-preset-${preset.key}`"
                @click="applyPreset(preset.key)"
              >
                {{ t(preset.labelKey) }}
              </OButton>
            </span>
          </template>
        </OFormDateTimeRange>
      </div>

      <OFormInput
        name="reason"
        :label="t('oncall.awayReason')"
        :placeholder="t('oncall.awayReasonPlaceholder')"
        data-test="oncall-members-away-reason"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import OButton from "@/lib/core/Button/OButton.vue";
import OAvatar from "@/lib/core/Avatar/OAvatar.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallZoneInfo from "@/components/oncall/OnCallZoneInfo.vue";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { DateTimeRangeValue } from "@/lib/forms/DateTime/OFormDateTimeRange.types";
import OFormDateTimeRange from "@/lib/forms/DateTime/OFormDateTimeRange.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { createUnavailabilityMutation } from "@/services/oncall.queries";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nKey } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  apiErrorMessage,
  apiErrorStatus,
  formatZonedRange,
  nextWeekRange,
  toZonedInputValue,
  zonedMidnight,
} from "@/utils/oncall";
import { makeOnCallAwaySchema } from "./OnCallAwayDialog.schema";

/** What the form holds: the window may be half-picked, which the schema exists to reject. */
interface OnCallAwayFormValues extends Record<string, unknown> {
  window?: DateTimeRangeValue;
  reason: string;
}

const props = withDefaults(
  defineProps<{
    /** Whose absence this records. */
    email: string;
    /** The team's zone: the picker opens on its clock and the field states the window on it. */
    timezone: string;
    /** Pre-filled start, in micros; the next day from now when absent. */
    from?: number | null;
    /** Pre-filled end, in micros. */
    to?: number | null;
  }>(),
  { from: null, to: null },
);
const emit = defineEmits<{ saved: [] }>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();
const { nameOf } = useOrgUserNames();
const { noteConfigurationDenied } = useOnCallPermissions();
const store = useStore();
const orgId = computed(() => store.state.selectedOrganization.identifier);
const selfEmail = computed(() => String(store.state.userInfo?.email ?? "").toLowerCase());

const createAbsenceWrite = useMutation(() => createUnavailabilityMutation(orgId.value));

const FORM_ID = "oncall-away-form";
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const saving = ref(false);

const PRESETS = [
  { key: "rest-of-day", labelKey: "oncall.coverRestOfDay" },
  { key: "tomorrow", labelKey: "oncall.coverTomorrow" },
  { key: "next-7-days", labelKey: "oncall.coverNext7Days" },
  { key: "next-week", labelKey: "oncall.awayNextWeek" },
] as const satisfies ReadonlyArray<{ key: string; labelKey: I18nKey }>;
type PresetKey = (typeof PRESETS)[number]["key"];

const form = useOForm<OnCallAwayFormValues>({
  defaultValues: initialValues(),
  schema: makeOnCallAwaySchema(t),
  onSubmit: save,
});

/// `type: "absolute"` is load-bearing: a range without it is re-read as a relative period and resolved against now.
function initialValues(): OnCallAwayFormValues {
  const now = Date.now() * 1000;
  const prefilled = props.from !== null && props.to !== null;
  return {
    window: {
      type: "absolute",
      ...(prefilled
        ? { from: props.from!, to: props.to! }
        : { from: now, to: now + MICROS_PER_DAY }),
    },
    reason: "",
  };
}

const windowValue = form.useStore((state: { values: OnCallAwayFormValues }) => state.values.window);

/// The zone the picker reads its fields in: the team's when it opens, and the reader may pick another.
const pickedZone = ref(props.timezone);

watch(open, (isOpen) => {
  if (!isOpen) return;
  pickedZone.value = props.timezone;
  activePreset.value = null;
  presetApplied = null;
  form.reset(initialValues());
});

/// Today on the picker's clock, so no past day can be picked.
function calendarDay(): string {
  return toZonedInputValue(Date.now() * 1000, pickedZone.value)
    .slice(0, 10)
    .replace(/-/g, "/");
}

/// Anchored to the team's day, as Cover a shift's presets are.
function applyPreset(key: PresetKey) {
  const now = Date.now() * 1000;
  const zone = props.timezone;
  const ranges: Record<PresetKey, { from: number; to: number }> = {
    "rest-of-day": { from: now, to: zonedMidnight(now, zone, 1) },
    tomorrow: { from: zonedMidnight(now, zone, 1), to: zonedMidnight(now, zone, 2) },
    "next-7-days": { from: now, to: now + 7 * MICROS_PER_DAY },
    "next-week": nextWeekRange(now, zone),
  };
  form.setFieldValue("window", { type: "absolute", ...ranges[key] });
  presetApplied = { key, ...ranges[key] };
  activePreset.value = key;
}

/// The preset whose range the field still holds; any other edit to the window unlights it.
const activePreset = ref<PresetKey | null>(null);
let presetApplied: { key: PresetKey; from: number; to: number } | null = null;

watch(windowValue, (value) => {
  const applied = presetApplied;
  activePreset.value =
    applied && value?.from === applied.from && value?.to === applied.to ? applied.key : null;
});

/// The field states the window on the team's clock, naming the zone when another clock is in play.
const windowLabel = computed<string>(() => {
  const window = windowValue.value;
  if (typeof window?.from !== "number" || typeof window?.to !== "number") return "";
  return formatZonedRange(
    window.from,
    window.to,
    props.timezone,
    props.timezone !== localZone || pickedZone.value !== props.timezone,
  );
});

async function save(value: OnCallAwayFormValues) {
  const window = value.window;
  if (typeof window?.from !== "number" || typeof window?.to !== "number") return;
  const reason = String(value.reason ?? "").trim();
  saving.value = true;
  try {
    await createAbsenceWrite.mutateAsync({
      user_email: props.email,
      start_at: window.from,
      end_at: window.to,
      ...(reason ? { reason } : {}),
    });
    open.value = false;
    toast({ variant: "success", message: t("oncall.awaySaved") });
    emit("saved");
  } catch (err: unknown) {
    // A 403 on your own absence is a responses denial, not a configuration one.
    if (props.email.toLowerCase() !== selfEmail.value) noteConfigurationDenied(err);
    toast({
      variant: "error",
      message:
        apiErrorStatus(err) === 403
          ? t("oncall.configDenied")
          : raw(apiErrorMessage(err)) || t("oncall.awaySaveFailed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
