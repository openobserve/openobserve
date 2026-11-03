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
    data-test="oncall-members-away-dialog"
  >
    <div class="flex flex-col gap-3">
      <span v-if="email" class="flex min-w-0 items-center gap-2">
        <OAvatar :value="email" :name="nameOf(email)" size="sm" />
        <OnCallPersonName
          truncate
          :email="email"
          class="text-text-heading text-sm font-medium"
          data-test="oncall-members-away-person"
        />
      </span>
      <OText variant="meta">{{ t("oncall.awayHintShort") }}</OText>
      <!-- The times below are the team's clock, said the way the Schedule tab says it. -->
      <span class="text-text-secondary text-xs" data-test="oncall-members-away-zone">
        {{ zoneCaption(timezone, localZone, Date.now() * 1000, t) }}
      </span>
      <div class="flex flex-col gap-1">
        <span class="o-input-label text-sm leading-tight font-semibold">
          {{ t("oncall.awayFrom") }}
        </span>
        <div class="flex gap-2" data-test="oncall-members-away-from">
          <ODate
            v-model="fromDate"
            class="min-w-0 flex-1"
            data-test="oncall-members-away-from-date"
          />
          <OTime
            v-model="fromTime"
            class="min-w-0 flex-1"
            data-test="oncall-members-away-from-time"
          />
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <span class="o-input-label text-sm leading-tight font-semibold">
          {{ t("oncall.awayTo") }}
        </span>
        <div class="flex gap-2" data-test="oncall-members-away-to">
          <ODate v-model="toDate" class="min-w-0 flex-1" data-test="oncall-members-away-to-date" />
          <OTime v-model="toTime" class="min-w-0 flex-1" data-test="oncall-members-away-to-time" />
        </div>
      </div>
      <OInput
        v-model="reason"
        :label="t('oncall.awayReason')"
        :placeholder="t('oncall.awayReasonPlaceholder')"
        data-test="oncall-members-away-reason"
      />
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="open = false">
          {{ t("oncall.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="saving"
          :disabled="!fromDate || !fromTime || !toDate || !toTime"
          data-test="oncall-members-away-save"
          @click="save"
        >
          {{ t("oncall.awaySave") }}
        </OButton>
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import OButton from "@/lib/core/Button/OButton.vue";
import OAvatar from "@/lib/core/Avatar/OAvatar.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODate from "@/lib/forms/Date/ODate.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { createUnavailabilityMutation } from "@/services/oncall.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { fromZonedInputValue, toZonedInputValue, zoneCaption } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** Whose absence this records. */
    email: string;
    /** The team's zone: the fields are read and pre-filled on its clock. */
    timezone: string;
    /** Pre-filled start, in micros; empty fields when absent. */
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

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const fromDate = ref("");
const fromTime = ref("");
const toDate = ref("");
const toTime = ref("");
const reason = ref("");
const saving = ref(false);

function split(micros: number | null): [string, string] {
  if (micros === null) return ["", ""];
  const local = toZonedInputValue(micros, props.timezone);
  return [local.slice(0, 10), local.slice(11, 16)];
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    [fromDate.value, fromTime.value] = split(props.from);
    [toDate.value, toTime.value] = split(props.to);
    reason.value = "";
  },
  { immediate: true },
);

/// The form's date and time read on the team's clock; Save stays disabled until both are filled.
function zonedMicros(date: string, time: string): number {
  return fromZonedInputValue(`${date}T${time}`, props.timezone) ?? Number.NaN;
}

async function save() {
  saving.value = true;
  try {
    await createAbsenceWrite.mutateAsync({
      user_email: props.email,
      start_at: zonedMicros(fromDate.value, fromTime.value),
      end_at: zonedMicros(toDate.value, toTime.value),
      ...(reason.value.trim() ? { reason: reason.value.trim() } : {}),
    });
    open.value = false;
    toast({ variant: "success", message: t("oncall.awaySaved") });
    emit("saved");
  } catch (err: unknown) {
    // A 403 on your own absence is a responses denial, not a configuration one.
    if (props.email.toLowerCase() !== selfEmail.value) noteConfigurationDenied(err);
    const failure = err as { response?: { status?: number; data?: { message?: string } } };
    toast({
      variant: "error",
      message:
        failure?.response?.status === 403
          ? t("oncall.configDenied")
          : raw(failure?.response?.data?.message) || t("oncall.awaySaveFailed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
