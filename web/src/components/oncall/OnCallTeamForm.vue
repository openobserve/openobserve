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
  <ODrawer
    :open="open"
    size="md"
    :title="isEdit ? t('oncall.editTeam') : t('oncall.addTeam')"
    :form-id="FORM_ID"
    :primary-button-label="t('oncall.save')"
    :secondary-button-label="t('oncall.cancel')"
    data-test="oncall-team-form-drawer"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:secondary="close"
  >
    <!-- `formKey` remounts OForm on open so defaults re-read the edit target. -->
    <OForm
      :id="FORM_ID"
      ref="formRef"
      :key="formKey"
      :schema="schema"
      :default-values="defaultValues"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormInput
        name="name"
        :label="t('oncall.teamName')"
        :help-text="t('oncall.teamNameHint')"
        required
        data-test="oncall-team-form-name"
      />
      <OFormSelect
        name="timezone"
        :label="t('oncall.timezone')"
        :options="timezoneOptions"
        :help-text="t('oncall.timezoneHint')"
        required
        data-test="oncall-team-form-timezone"
      />
      <OFormInput
        name="description"
        :label="t('oncall.description')"
        data-test="oncall-team-form-description"
      />

      <!-- Creation only. Once the team exists, membership and the schedule
           have screens of their own and duplicating them here would give two
           places to edit one thing. -->
      <template v-if="!isEdit">
        <div class="flex flex-col gap-2">
          <OFormSelect
            name="members"
            multiple
            searchable
            :label="t('oncall.members')"
            :help-text="t('oncall.rotationOrderHint')"
            :options="userOptions"
            :loading="loadingUsers"
            data-test="oncall-team-form-members"
          />
          <div v-if="userOptions.length" class="flex">
            <OButton
              variant="outline"
              size="sm-action"
              data-test="oncall-team-form-add-everyone"
              @click="addEveryone"
            >
              {{ t("oncall.addEveryoneCta", { count: userOptions.length }) }}
            </OButton>
          </div>
        </div>

        <OFormSelect
          name="shift_micros"
          :label="t('oncall.shiftLength')"
          :options="shiftOptions"
          data-test="oncall-team-form-shift"
        />

        <!-- Without an explicit first handover the anchor is "now", so a team
             created at 14:32 hands over at 14:32 for ever. -->
        <OFormInput
          name="first_handover"
          type="datetime-local"
          :label="t('oncall.firstHandover')"
          data-test="oncall-team-form-handover"
        />

        <OnCallRotationPreview :timezone="previewZone" />
      </template>
    </OForm>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import usersService from "@/services/users";
import type { OnCallTeam, Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { SHIFT_PRESETS } from "@/utils/oncall";
import OnCallRotationPreview from "./OnCallRotationPreview.vue";

import {
  makeOnCallTeamSchema,
  type OnCallTeamFormValues,
} from "./OnCallTeamForm.schema";

const FORM_ID = "oncall-team-form";

const props = defineProps<{ open: boolean; team: OnCallTeam | null }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [];
}>();

const { t } = useI18nTyped();
const store = useStore();

const formKey = ref(0);
const formRef = ref<{ form: any } | null>(null);
const orgUsers = ref<{ email: string; first_name?: string; last_name?: string }[]>([]);
const loadingUsers = ref(false);
const isEdit = computed(() => !!props.team);
const orgId = computed(() => store.state.selectedOrganization.identifier);
const schema = computed(() => makeOnCallTeamSchema(t));

/**
 * Offered timezones come from the browser rather than a bundled list, so the
 * set always matches what this runtime can actually resolve — the server
 * rejects anything it cannot parse, and a stale bundled list would surface
 * that as a save error instead of an absent option.
 */
const timezoneOptions = computed(() => {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];
  return supported.map((tz) => ({ label: raw(tz), value: tz }));
});

const shiftOptions = computed(() =>
  SHIFT_PRESETS.map((preset) => ({ label: t(preset.labelKey), value: preset.micros })),
);

const userOptions = computed(() =>
  orgUsers.value.map((user) => {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return { label: raw(name ? `${name} (${user.email})` : user.email), value: user.email };
  }),
);

/// The zone the preview reads its instants in. The form's own timezone field
/// is the answer once the user has touched it, which is why it is not read
/// from the team.
const previewZone = computed(() => defaultValues.value.timezone);

/// Weekly, next Monday at 10:00, per the shipped defaults in architecture/02
/// §4 — a new team is pageable without the user deciding anything.
function nextMondayAt10(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(10, 0, 0, 0);
  // 1 = Monday. Always forward, so the first handover is never in the past.
  const daysAhead = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const defaultValues = computed<OnCallTeamFormValues>(() => ({
  name: props.team?.name ?? "",
  timezone:
    props.team?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC",
  description: props.team?.description ?? "",
  members: [],
  shift_micros: MICROS_PER_WEEK,
  first_handover: nextMondayAt10(),
}));

function addEveryone() {
  formRef.value?.form?.setFieldValue(
    "members",
    userOptions.value.map((option) => option.value),
  );
}

/// Only for the create drawer; the edit drawer shows no member picker.
async function fetchOrgUsers() {
  loadingUsers.value = true;
  try {
    const res = await usersService.orgUsers(orgId.value);
    orgUsers.value = res.data?.data ?? [];
  } catch {
    // The picker degrades to empty and the team is still creatable; people can
    // be added on the Members tab straight afterwards.
    orgUsers.value = [];
  } finally {
    loadingUsers.value = false;
  }
}

// `immediate` because a parent may mount this already open — without it the
// member picker would render empty and never fetch.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    formKey.value += 1;
    if (!isEdit.value) void fetchOrgUsers();
  },
  { immediate: true },
);

function close() {
  emit("update:open", false);
}

async function onSubmit(values: OnCallTeamFormValues) {
  // Explicit keys, never a spread: the form value carries whatever the schema
  // shaped, and the API contract should not drift with it.
  const data = {
    name: values.name.trim(),
    timezone: values.timezone,
    description: values.description?.trim() ? values.description.trim() : null,
  };
  try {
    if (props.team) {
      await oncallService.updateTeam({
        org_identifier: orgId.value,
        team_id: props.team.id,
        data,
      });
    } else {
      const created = await oncallService.createTeam({ org_identifier: orgId.value, data });
      await staffNewTeam(created.data.id, values);
    }
    toast({
      variant: "success",
      message: props.team ? t("oncall.teamUpdated") : t("oncall.teamCreated"),
    });
    emit("saved");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.saveTeamFailed"),
    });
  }
}

/// Members and the rotation are separate endpoints, so one Create is three
/// calls. They are reported separately on purpose: the team itself already
/// exists by the time either can fail, and saying "could not create the team"
/// would send somebody to create a second one.
async function staffNewTeam(teamId: string, values: OnCallTeamFormValues) {
  const emails = values.members ?? [];
  if (!emails.length) return;

  try {
    await oncallService.addMembers({
      org_identifier: orgId.value,
      team_id: teamId,
      data: { user_emails: emails },
    });
  } catch (err: any) {
    toast({
      variant: "warning",
      message: raw(err?.response?.data?.message) || t("oncall.teamCreatedWithoutMembers"),
    });
    return;
  }

  const anchor = Date.parse(values.first_handover ?? "");
  const shift = values.shift_micros ?? MICROS_PER_WEEK;
  if (!Number.isFinite(anchor) || shift <= 0) return;

  try {
    await oncallService.setSchedule({
      org_identifier: orgId.value,
      team_id: teamId,
      data: {
        timezone: values.timezone,
        rotations: await amendStaffedRotations(teamId, emails, shift, anchor * 1000),
      },
    });
  } catch (err: any) {
    toast({
      variant: "warning",
      message: raw(err?.response?.data?.message) || t("oncall.teamCreatedWithoutRotation"),
    });
  }
}

/// Adding members auto-staffs the team, and this PUT is a **full replace** —
/// so sending one hand-built primary rotation deleted whatever the server had
/// just derived, most visibly the secondary slot. A team created by curl ended
/// up with two slots and the same team created here with one.
///
/// So: read back what was staffed, carry every rotation through, and change
/// only the two things this form actually asked for — shift length and first
/// handover. Nothing staffed (or the read failed) falls back to the single
/// rotation, which is what a team with no derived slots would have got anyway.
async function amendStaffedRotations(
  teamId: string,
  emails: string[],
  shift: number,
  anchorMicros: number,
): Promise<Rotation[]> {
  const fallback: Rotation[] = [
    {
      name: t("oncall.defaultRotationName"),
      members: emails,
      shift_micros: shift,
      anchor_micros: anchorMicros,
    },
  ];
  try {
    const res = await oncallService.getSchedule({
      org_identifier: orgId.value,
      team_id: teamId,
    });
    const staffed = res.data?.rotations ?? [];
    if (!staffed.length) return fallback;
    return staffed.map((rotation) => ({
      ...rotation,
      shift_micros: shift,
      anchor_micros: anchorMicros,
    }));
  } catch {
    return fallback;
  }
}
</script>
