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
    </OForm>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import type { OnCallTeam } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

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

const defaultValues = computed<OnCallTeamFormValues>(() => ({
  name: props.team?.name ?? "",
  timezone:
    props.team?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC",
  description: props.team?.description ?? "",
}));

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) formKey.value += 1;
  },
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
      await oncallService.createTeam({ org_identifier: orgId.value, data });
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
</script>
