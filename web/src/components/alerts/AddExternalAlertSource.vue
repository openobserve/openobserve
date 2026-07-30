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
  <div class="flex max-w-md flex-col gap-3">
    <div class="text-base font-semibold">{{ t("alert_sources.addTitle") }}</div>
    <OInput
      v-model="form.name"
      :label="t('alert_sources.name')"
      data-test="add-alert-source-name-input"
    />
    <OSelect
      v-model="form.source_type"
      :options="sourceTypeOptions"
      :label="t('alert_sources.sourceType')"
      data-test="add-alert-source-type-select"
    />
    <div class="flex justify-end gap-2">
      <OButton variant="outline" size="sm" data-test="add-alert-source-cancel-btn" @click="cancel">
        {{ t("alert_sources.cancel") }}
      </OButton>
      <OButton variant="primary" size="sm" data-test="add-alert-source-save-btn" @click="submit">
        {{ t("alert_sources.save") }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import alertSources from "@/services/alert_sources";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "AddExternalAlertSource",
  components: { OButton, OInput, OSelect },
  emits: ["created", "cancel:hideform"],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    return { store, t };
  },
  data() {
    return {
      form: { name: "", source_type: "grafana" },
      sourceTypeOptions: [
        { label: "Grafana", value: "grafana" },
        { label: "Alertmanager", value: "alertmanager" },
        { label: "Generic", value: "generic" },
        { label: "Auto", value: "auto" },
      ],
    };
  },
  methods: {
    async submit() {
      if (!this.form.name.trim()) return;
      try {
        await alertSources.create(this.store.state.selectedOrganization.identifier, {
          name: this.form.name,
          source_type: this.form.source_type,
        });
        toast({ variant: "success", message: this.t("alert_sources.createdSuccess") });
        this.$emit("created");
        this.$emit("cancel:hideform");
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    cancel() {
      this.$emit("cancel:hideform");
    },
  },
});
</script>
