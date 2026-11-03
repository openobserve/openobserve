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
    icon="domain"
    :title="t('settings.orgDomainMapping.tabLabel')"
    :subtitle="t('settings.orgDomainMapping.pageSubtitle')"
    data-test="settings-org-domain-management"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <OTabs
        :model-value="activeTab"
        dense
        align="left"
        data-test="settings-org-domain-management-tabs"
        @update:model-value="setTab"
      >
        <OTab
          name="linked"
          :label="t('settings.orgDomainMapping.linkedTab')"
          data-test="settings-org-domain-management-linked-tab"
        />
        <OTab
          name="mappings"
          :label="t('settings.orgDomainMapping.mappingsTab')"
          data-test="settings-org-domain-management-mappings-tab"
        />
        <OTab
          name="access"
          :label="t('settings.orgDomainMapping.accessTab')"
          data-test="settings-org-domain-management-access-tab"
        />
        <OTab
          v-if="isMetaOrg"
          name="requests"
          :label="t('settings.orgDomainMapping.requestsTab')"
          data-test="settings-org-domain-management-requests-tab"
        />
      </OTabs>
    </template>

    <template #actions>
      <OButton
        v-if="activeTab === 'linked'"
        variant="primary"
        size="sm"
        data-test="settings-org-domain-management-link-btn"
        @click="linkedDomains?.openLink()"
      >
        {{ t("settings.orgDomainMapping.linkDomain") }}
      </OButton>
      <OButton
        v-else-if="activeTab === 'mappings'"
        variant="primary"
        size="sm"
        :disabled="settings.isPending.value || settings.isError.value"
        data-test="settings-org-domain-management-add-mapping-btn"
        @click="mappings?.openAdd()"
      >
        {{ t("settings.orgDomainMapping.addMapping") }}
      </OButton>
    </template>

    <div class="min-h-0 flex-1 overflow-hidden">
      <OrgLinkedDomains
        v-if="activeTab === 'linked'"
        ref="linkedDomains"
        :key="`linked-${orgId}`"
        :org-id="orgId"
        :mappings="settingsData.domain_org_mappings ?? []"
        :settings-ready="settings.isSuccess.value"
      />
      <template v-else-if="activeTab === 'requests' && isMetaOrg">
        <OrgDomainRequests :key="`requests-${orgId}`" :org-id="orgId" />
      </template>
      <div v-else-if="settings.isPending.value" class="flex justify-center py-8">
        <OSpinner />
      </div>
      <OEmptyState
        v-else-if="settings.isError.value"
        preset="load-error"
        data-test="settings-org-domain-management-load-error"
        @action="settings.refetch()"
      />
      <OrgDomainMappings
        v-else-if="activeTab === 'mappings'"
        ref="mappings"
        :key="`mappings-${orgId}`"
        :org-id="orgId"
        :mappings="settingsData.domain_org_mappings ?? []"
        :enforce-allowed-orgs-only="!!settingsData.enforce_allowed_orgs_only"
        @go-to-linked="setTab('linked')"
      />
      <div v-else class="px-page-edge h-full overflow-y-auto py-4">
        <OrgDomainRestrictions
          :key="`access-${orgId}`"
          :org-id="orgId"
          :config="settingsData.domain_management_config"
        />
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { useOrgId } from "@/composables/query";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { orgSettingsQuery } from "@/services/organizations.queries";
import OrgDomainMappings from "./OrgDomainMappings.vue";
import OrgDomainRequests from "./OrgDomainRequests.vue";
import OrgDomainRestrictions from "./OrgDomainRestrictions.vue";
import OrgLinkedDomains from "./OrgLinkedDomains.vue";

type DomainTab = "linked" | "mappings" | "access" | "requests";
const TABS: readonly DomainTab[] = ["linked", "mappings", "access", "requests"];

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { isMetaOrg } = useIsMetaOrg();

const linkedDomains = ref<InstanceType<typeof OrgLinkedDomains> | null>(null);
const mappings = ref<InstanceType<typeof OrgDomainMappings> | null>(null);

const settings = useQuery(() => orgSettingsQuery(orgId.value));
const settingsData = computed<Record<string, any>>(() => settings.data.value?.data ?? {});

const activeTab = computed<DomainTab>(() => {
  const tab = route.query.tab as DomainTab;
  if (!TABS.includes(tab)) return "linked";
  return tab === "requests" && !isMetaOrg.value ? "linked" : tab;
});

function setTab(tab: string | number) {
  router.replace({ query: { ...route.query, tab: String(tab) } });
}
</script>
