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
  <!-- Grouped left rail (prototype admin model): the rail is always present;
       the chosen section renders its own page (header + table) to the right. -->
  <OPageLayout bleed :sidebar-width="230" data-test="iam-page">
    <template #sidebar>
      <SectionRail :groups="sectionGroups" :active-key="activeSection" :title="t('menu.iam')" />
    </template>
    <section class="h-full min-h-0 min-w-0 overflow-y-auto">
      <RouterView v-slot="{ Component }">
        <OAccessBoundary>
          <component :is="Component" />
        </OAccessBoundary>
      </RouterView>
    </section>
  </OPageLayout>
</template>

<script setup lang="ts">
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { providePageRailGroup } from "@/lib/core/PageHeader/pageContext";
import SectionRail from "@/components/common/SectionRail.vue";
import OAccessBoundary from "@/components/access/OAccessBoundary.vue";
import { computed, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter, useRoute, RouterView } from "vue-router";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { useIamSections } from "@/composables/iam/useIamSections";

const store = useStore();
const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const { isMetaOrg } = useIsMetaOrg();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// Route name → section key (drill-down editors map back to their section).
const routeToIamTab: Record<string, string> = {
  users: "users",
  serviceAccounts: "serviceAccounts",
  ingestionTokens: "ingestionTokens",
  syntheticsTokens: "syntheticsTokens",
  mcpServer: "mcpServer",
  groups: "groups",
  editGroup: "groups",
  roles: "roles",
  editRole: "roles",
  quota: "quota",
  organizations: "organizations",
  invitations: "invitations",
};
const activeSection = computed(() => routeToIamTab[route.name as string] ?? "");

const { sectionGroups } = useIamSections();
providePageRailGroup(
  computed(
    () =>
      sectionGroups.value.find((g) => g.items.some((i) => i.key === activeSection.value))?.label,
  ),
);

// The rail is always shown, so the IAM root has no standalone landing — send it
// to the first section (Users, always available). Also: non-meta users can't use
// the quota section — bounce them to Users too.
watch(
  () => route.name,
  (name) => {
    if (name === "iam") {
      // .catch: in unit tests the mounted router may not register child routes;
      // a rejected navigation must not surface as an unhandled error.
      Promise.resolve(router.replace({ name: "users", query: orgQuery.value })).catch(() => {});
    } else if (name === "quota" && !isMetaOrg.value) {
      Promise.resolve(router.push({ name: "users", query: orgQuery.value })).catch(() => {});
    }
  },
  { immediate: true },
);
</script>
