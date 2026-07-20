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
  <ODialog data-test="add-group-dialog"
    :open="open"
    size="sm"
    :title="t('iam.addGroup')"
    :primaryButtonLabel="t('alerts.save')"
    :secondaryButtonLabel="t('alerts.cancel')"
    form-id="add-group-form"
    @click:secondary="emits('update:open', false)"
    @update:open="emits('update:open', $event)"
  >
    <div data-test="add-group-section">
      <OForm
        id="add-group-form"
        :schema="addGroupSchema"
        :default-values="addGroupDefaults"
        @submit="saveGroup"
      >
        <OFormInput
          name="name"
          :label="t('common.name')"
          required
          class="showLabelOnTop mt-2"
          maxlength="100"
          data-test="add-group-groupname-input-btn"
          :help-text="t('iam.nameHelpText')"
        />
      </OForm>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { createGroup } from "@/services/iam";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeAddGroupSchema, type AddGroupForm } from "./AddGroup.schema";

const { t } = useI18n();
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  group: {
    type: Object,
    default: () => null,
  },
  org_identifier: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["update:open", "added:group"]);

const { track } = useReo();

const store = useStore();

const addGroupSchema = makeAddGroupSchema(t);

// The OForm owns `name`. The ODialog unmounts its body on close + remounts fresh
// on open, so this typed computed re-seeds `:default-values` each open (the
// optional `group` prop prefills it, otherwise blank). No local model / watch.
const addGroupDefaults = computed((): AddGroupForm => ({
  name: props.group?.name ?? "",
}));

// Plain async @submit handler — the validated `value` is the source of truth.
// The schema validates the trimmed name (so surrounding whitespace doesn't trip
// the regex, mirroring the old `v-model.trim`); trim again here so the saved
// value matches. OForm awaits this, so the Save spinner spans the request.
const saveGroup = async (value: AddGroupForm) => {
  const name = value.name.trim();
  try {
    const res = await createGroup(
      name,
      store.state.selectedOrganization.identifier,
    );
    emits("added:group", { group_name: name, data: res.data });
    emits("update:open", false);

    toast({
      message: t('iam.addGroupPage.createdSuccessfully', { name }),
      variant: "success",
    });
  } catch (err: any) {
    if (err.response?.status != 403) {
      toast({
        message: t('iam.addGroupPage.errorCreating'),
        variant: "error",
      });
    }
    console.log(err);
  }

  track("Button Click", {
    button: "Save Group",
    page: "Add Group",
  });
};
</script>
