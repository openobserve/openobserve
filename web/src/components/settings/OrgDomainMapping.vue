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
  <div data-test="settings-org-domain-mapping-page">
    <div v-if="settings.isPending.value" class="flex justify-center py-8">
      <OSpinner />
    </div>
    <OBanner
      v-else-if="settings.isError.value"
      variant="error"
      icon="warning"
      data-test="settings-org-domain-mapping-load-error"
    >
      {{ t("settings.orgDomainMapping.loadFailed") }}
    </OBanner>
    <!-- Keyed by org so each section's form re-seeds after an org switch. -->
    <div v-else :key="orgId" class="flex flex-col">
      <OrgDomainMappings :org-id="orgId" :mappings="settingsData.domain_org_mappings ?? []" />
      <OSeparator class="my-6" />
      <OrgSsoSettings :org-id="orgId" :settings="settingsData" />
      <OSeparator class="my-6" />
      <OrgDomainRestrictions :org-id="orgId" :config="settingsData.domain_management_config" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { useOrgId } from "@/composables/query";
import { orgSettingsQuery } from "@/services/organizations.queries";
import OrgDomainMappings from "./OrgDomainMappings.vue";
import OrgSsoSettings from "./OrgSsoSettings.vue";
import OrgDomainRestrictions from "./OrgDomainRestrictions.vue";

const { t } = useI18nTyped();
const orgId = useOrgId();

const settings = useQuery(() => orgSettingsQuery(orgId.value));
const settingsData = computed<Record<string, any>>(() => settings.data.value?.data ?? {});
</script>
