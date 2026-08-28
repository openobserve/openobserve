<!--
Copyright 2026 OpenObserve Inc.

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

Global variables only - those with no environment. Scoped ones live with their
scope, under Environments, which is what every comparable product does and what
keeps the daily action (add a production credential while standing in
Production) from becoming a four-step navigation.
-->

<template>
  <OPageLayout
    :title="t('synthetics.variables.title')"
    icon="data-object"
    :subtitle="t('synthetics.variables.globalSubtitle')"
    bleed
  >
    <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
      <SyntheticsVariablesList
        :variables="variables"
        :loading="loading"
        :environment="null"
        @refresh="fetchVariables"
      />
    </div>
  </OPageLayout>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsVariable } from "@/types/synthetics";
import SyntheticsVariablesList from "./SyntheticsVariablesList.vue";

export default defineComponent({
  name: "SyntheticsVariablesTab",
  components: { OPageLayout, SyntheticsVariablesList },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const variables = ref<SyntheticsVariable[]>([]);
    const loading = ref(false);

    async function fetchVariables() {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const res = await syntheticsService.listGlobalVariables(org);
        variables.value = res.data ?? [];
      } catch (error: any) {
        toast.error(error?.response?.data?.message ?? t("synthetics.variables.loadFailed"));
      } finally {
        loading.value = false;
      }
    }

    onMounted(fetchVariables);

    return { t, variables, loading, fetchVariables };
  },
});
</script>
