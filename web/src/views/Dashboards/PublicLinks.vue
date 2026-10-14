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
  <OPageLayout
    :title="t('dashboard.publicLinks.pageTitle')"
    :subtitle="t('dashboard.publicLinks.pageSubtitle')"
    icon="public"
    :back="{
      label: t('common.back'),
      to: dashboardsRoute,
      dataTest: 'dashboards-public-links-page-back',
    }"
    bleed
  >
    <PublicLinksTable class="min-h-0 w-full flex-1" />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import PublicLinksTable from "@/components/dashboards/PublicLinksTable.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const store = useStore();

const dashboardsRoute = computed(() => ({
  name: "dashboards",
  query: { org_identifier: store.state.selectedOrganization?.identifier },
}));
</script>
