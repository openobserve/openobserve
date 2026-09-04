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

<script setup lang="ts">
//
// Router view for `synthetics-add` and `synthetics-edit/:id`. Dispatches on
// `?type=` (create) or the route param `:id` (edit) — the browser flow keeps
// its dedicated journey/configure view; protocol checks share the
// configure-only page.
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import syntheticsService from "@/services/synthetics";
import CreateBrowserTest from "./CreateBrowserTest.vue";
import CreateProtocolCheck from "./CreateProtocolCheck.vue";
import CreateBrowserTestSkeleton from "@/components/synthetics/CreateBrowserTestSkeleton.vue";
import {
  SYNTHETIC_CHECK_TYPES,
  type ProtocolCheckType,
  type SyntheticCheckType,
} from "@/types/synthetics";

const route = useRoute();
const store = useStore();

const editId = computed(() =>
  typeof route.params.id === "string" && route.params.id ? route.params.id : undefined,
);

// Create: type comes from the query. Edit: type comes from the stored monitor,
// resolved before rendering (the two flows are different components).
const resolvedType = ref<SyntheticCheckType | null>(null);

onMounted(async () => {
  if (!editId.value) {
    const q = route.query.type;
    resolvedType.value = SYNTHETIC_CHECK_TYPES.includes(q as SyntheticCheckType)
      ? (q as SyntheticCheckType)
      : "browser";
    return;
  }
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.get(org, editId.value, String(route.query.folder ?? ""));
    const t = (res.data as any)?.type;
    resolvedType.value = SYNTHETIC_CHECK_TYPES.includes(t) ? (t as SyntheticCheckType) : "browser";
  } catch (err) {
    console.error("[synthetics] failed to resolve check type for edit", err);
    resolvedType.value = "browser";
  }
});
</script>

<template>
  <CreateBrowserTestSkeleton v-if="resolvedType === null" :rows="10" />
  <CreateBrowserTest v-else-if="resolvedType === 'browser'" :edit-id="editId" />
  <CreateProtocolCheck
    v-else
    :key="resolvedType"
    :check-type="resolvedType as ProtocolCheckType"
    :edit-id="editId"
  />
</template>
