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
    data-test="search-bar-search-inspect-dialog"
    v-model:open="isOpen"
    size="sm"
    title="Search Inspect"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    :primary-button-disabled="!traceId.trim()"
    @click:secondary="isOpen = false"
    @click:primary="onSubmit"
  >
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
      data-test="search-inspect-trace-id-input"
    />
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

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
