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
  <q-dialog v-model="isOpen">
    <q-card style="width: 500px; max-width: 90vw">
      <q-card-section>
        <div class="text-h6">{{ t("search.searchInspect") }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div class="text-left q-mb-xs">{{ t("search.traceId") }}:</div>
        <q-input
          v-model="traceId"
          :placeholder="t('search.enterTraceId')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          autofocus
          data-test="logs-search-inspect-trace-id-input"
        />
      </q-card-section>
      <q-card-actions align="right" class="tw:gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          v-close-popup
          data-test="logs-search-inspect-cancel-btn"
          >{{ t("confirmDialog.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!traceId.trim()"
          @click="onSubmit"
          v-close-popup
          data-test="logs-search-inspect-submit-btn"
          >{{ t("confirmDialog.ok") }}</OButton
        >
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const traceId = ref("");

const onSubmit = () => {
  const id = traceId.value.trim();
  if (!id) return;
  router.push({
    name: "searchJobInspector",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      trace_id: id,
    },
  });
};
</script>
