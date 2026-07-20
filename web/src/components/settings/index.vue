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
  <!-- Grouped left rail (prototype admin model) — same shell as IAM. The rail is
       always present; the chosen section renders to the right. -->
  <PageLayout :sidebar-width="232">
    <template #sidebar>
      <SectionRail
        :groups="sectionGroups"
        :active-key="activeSection"
        :title="t('settings.header')"
      />
    </template>

    <!-- Form-style sections (general, org params, license, domain): a section
         header above a centered reading column. -->
    <div
      v-if="isConstrainedSection"
      class="h-full min-h-0 flex flex-col"
    >
      <AppPageHeader
        :title="activeSectionItem?.label || ''"
        :title-data-test="`settings-${activeSectionItem?.key}-page-title`"
        :subtitle="activeSectionItem?.description || ''"
        :icon="(activeSectionItem?.icon as any)"
        class="shrink-0 px-4 border-b border-border-subtle"
      />
      <ConstrainedPage
        size="lg"
        align="left"
        :padded="false"
        class="flex-1 min-h-0 px-4 py-3"
      >
        <router-view title="" />
      </ConstrainedPage>
    </div>
    <!-- Table/list sections render their own AppPageHeader inside. -->
    <section v-else class="h-full min-w-0 min-h-0 overflow-y-auto overflow-x-hidden">
      <router-view title="" />
    </section>
  </PageLayout>
</template>

<script lang="ts">
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";
import PageLayout from "@/components/common/PageLayout.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import {
  type SectionHubGroup,
  type SectionHubItem,
} from "@/components/common/SectionHub.vue";
import {
  defineComponent,
  ref,
  onBeforeMount,
  onActivated,
  onDeactivated,
  onUnmounted,
  onUpdated,
  computed,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import config from "@/aws-exports";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "AppSettings",
  components: {
    AppPageHeader,
    ConstrainedPage,
    PageLayout,
    SectionRail,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    const route = useRoute();

    // Maps a route name → the section key used by the hub/switcher.
    const routeToSettingsTab: Record<string, string> = {
      general:               "general",
      organization:          "organization",
      organizationSettings:  "organization",
      nodes:                 "nodes",
      queryManagement:       "queryManagement",
      query_management:      "queryManagement",
      domainManagement:      "domain_management",
      alertDestinations:     "alert_destinations",
      pipelineDestinations:  "pipeline_destinations",
      alertTemplates:        "templates",
      modelPricing:          "model_pricing",
      modelPricingEditor:    "model_pricing",
      llmProviders:          "llm_providers",
      storageSettings:       "storageSettings",
      cipherKeys:            "cipher-keys",
      license:               "license",
      orgnizationManagement: "organization_management",
      regexPatterns:         "regex_patterns",
      correlationSettings:   "correlation_settings",
      genAiAgentMapping:     "gen_ai_agent_mapping",
    };

    const settingsTab = ref(
      routeToSettingsTab[router.currentRoute.value.name as string] ?? "general",
    );
    const { isMetaOrg } = useIsMetaOrg();

    // /settings (name "settings") with no child → show the hub.
    const isHub = computed(() => route.name === "settings");
    const hubRoute = computed(() => ({
      name: "settings",
      query: { org_identifier: store.state.selectedOrganization?.identifier },
    }));
    const activeSection = computed(
      () => routeToSettingsTab[route.name as string] ?? "",
    );

    // Form-style sections render in a centered reading column (ConstrainedPage);
    // table/list sections (nodes, destinations, templates, …) stay full-width.
    const CONSTRAINED_SECTIONS = new Set([
      "general",
      "organization",
      "license",
      "domain_management",
    ]);
    const isConstrainedSection = computed(() =>
      CONSTRAINED_SECTIONS.has(activeSection.value),
    );

    // Full-width sections that still want the shell-owned header (their content
    // fills the whole width instead of a centered reading column).
    // The rail is always shown, so the Settings root has no standalone landing —
    // send it to the first section (General). Also guard meta-only sections.
    const handleSettingsRouting = () => {
      const name = router.currentRoute.value.name;
      if (name === "settings") {
        // .catch: a rejected navigation (e.g. unit-test router without child
        // routes) must not surface as an unhandled error.
        Promise.resolve(
          router.replace({
            path: "/settings/general",
            query: {
              org_identifier: store.state.selectedOrganization?.identifier,
            },
          }),
        ).catch(() => {});
        return;
      }
      const notMeta =
        store.state.zoConfig.meta_org &&
        (!isMetaOrg.value || config.isEnterprise === "false");
      if ((name === "nodes" || name === "license") && notMeta) {
        settingsTab.value = "general";
        router.push({
          path: "/settings/general",
          query: { org_identifier: store.state.selectedOrganization?.identifier },
        });
      }
    };

    onBeforeMount(handleSettingsRouting);
    onActivated(handleSettingsRouting);
    onUpdated(handleSettingsRouting);

    const regexIcon = computed(() =>
      getImageURL(
        store.state.theme === "dark"
          ? "images/regex_pattern/regex_icon_dark.svg"
          : "images/regex_pattern/regex_icon_light.svg",
      ),
    );

    // Order the section groups appear in (hub + switcher).
    const settingsGroupOrder = [
      "General",
      "Access & Security",
      "Destinations & Templates",
      "Data & AI",
      "Operations",
      "Account",
    ];

    // Every section, with its group + a one-line description for the hub cards.
    // Feature-flag visibility stays declarative here (one array, not per-tab v-ifs).
    const settingsItems = computed<SectionHubItem[]>(() => {
      const org = store.state.selectedOrganization?.identifier;
      const isEnt = config.isEnterprise == "true";
      const isCloud = config.isCloud == "true";
      const meta = isMetaOrg.value;
      const z = store.state.zoConfig;
      const items: (SectionHubItem & { group: string })[] = [
        {
          key: "general",
          label: t("settings.generalLabel"),
          description: t("settings.generalDesc"),
          icon: "settings",
          to: `/settings/general?org_identifier=${org}`,
          dataTest: "general-settings-tab",
          group: "General",
        },
        {
          key: "organization",
          label: t("settings.orgLabel"),
          description: t("settings.orgDesc"),
          icon: "business",
          to: `/settings/organization?org_identifier=${org}`,
          dataTest: "organization-settings-tab",
          group: "General",
        },
        {
          key: "cipher-keys",
          label: t("settings.cipherKeys"),
          description: t("settings.cipherKeysDesc"),
          icon: "key",
          to: { name: "cipherKeys", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "management-cipher-key-tab",
          group: "Access & Security",
        },
        {
          key: "regex_patterns",
          label: t("regex_patterns.title"),
          description: t("settings.regexPatternsDesc"),
          icon: `img:${regexIcon.value}`,
          to: { name: "regexPatterns", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "regex-patterns-tab",
          group: "Access & Security",
        },
        {
          key: "domain_management",
          label: t("settings.ssoDomainRestrictions"),
          description: t("settings.domainManagementDesc"),
          icon: "dns",
          to: { name: "domainManagement", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "domain-management-tab",
          group: "Access & Security",
        },
        {
          key: "alert_destinations",
          label: t("alert_destinations.header"),
          description: t("settings.alertDestinationsDesc"),
          icon: "location-on",
          to: { name: "alertDestinations", query: { org_identifier: org } },
          dataTest: "alert-destinations-tab",
          group: "Destinations & Templates",
        },
        {
          key: "pipeline_destinations",
          label: t("pipeline_destinations.header"),
          description: t("settings.pipelineDestinationsDesc"),
          icon: "person-pin-circle",
          to: { name: "pipelineDestinations", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "pipeline-destinations-tab",
          group: "Destinations & Templates",
        },
        {
          key: "templates",
          label: t("alert_templates.header"),
          description: t("settings.templatesDesc"),
          icon: "description",
          to: { name: "alertTemplates", query: { org_identifier: org } },
          dataTest: "alert-templates-tab",
          group: "Destinations & Templates",
        },
        {
          key: "storageSettings",
          label: t("storage_settings.tabLabel"),
          description: t("settings.storageSettingsDesc"),
          icon: "cloud",
          to: { name: "storageSettings", query: { org_identifier: org } },
          visible:
            isEnt &&
            (!isCloud ||
              store.state.organizationData.organizationSettings
                .org_storage_enabled === true),
          dataTest: "storage-settings-tab",
          group: "Data & AI",
        },
        {
          key: "model_pricing",
          label: t("settings.llmModelPricing"),
          description: t("settings.modelPricingDesc"),
          icon: "paid",
          to: { name: "modelPricing", query: { org_identifier: org } },
          visible: !!z.model_pricing_enabled,
          dataTest: "model-pricing-tab",
          group: "Data & AI",
        },
        {
          key: "correlation_settings",
          label: t("settings.correlationSettings"),
          description: t("settings.correlationSettingsDesc"),
          icon: "group-work",
          to: { name: "correlationSettings", query: { org_identifier: org } },
          visible: isEnt && z.service_streams_enabled !== false,
          dataTest: "correlation-settings-tab",
          group: "Data & AI",
        },
        {
          key: "llm_providers",
          label: t("llmProviders.tabLabel"),
          description: t("settings.llmProvidersDesc"),
          icon: "smart-toy",
          to: { name: "llmProviders", query: { org_identifier: org } },
          visible: (isEnt || isCloud) && !!z.online_evals_enabled,
          dataTest: "llm-providers-tab",
          group: "Data & AI",
        },
        {
          key: "gen_ai_agent_mapping",
          label: t("settings.genAiAgentMapping.tabLabel"),
          description: t("settings.index.genAiAgentMappingDesc"),
          icon: "smart-toy",
          to: { name: "genAiAgentMapping", query: { org_identifier: org } },
          visible: (isEnt || isCloud) && !!z.online_evals_enabled,
          dataTest: "gen-ai-agent-mapping-tab",
          group: "Data & AI",
        },
        {
          key: "queryManagement",
          label: t("settings.queryManagement"),
          description: t("settings.queryManagementDesc"),
          icon: "query-stats",
          to: `/settings/query_management?org_identifier=${org}`,
          visible: isEnt && meta,
          dataTest: "query-management-tab",
          group: "Operations",
        },
        {
          key: "nodes",
          label: t("settings.nodes"),
          description: t("settings.nodesDesc"),
          icon: "hub",
          to: { name: "nodes", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "nodes-tab",
          group: "Operations",
        },
        {
          key: "license",
          label: t("settings.license"),
          description: t("settings.licenseDesc"),
          icon: "card-membership",
          to: { name: "license", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "license-tab",
          group: "Account",
        },
        {
          key: "organization_management",
          label: t("settings.organizationManagement"),
          description: t("settings.organizationManagementDesc"),
          icon: "lan",
          to: { name: "orgnizationManagement", query: { org_identifier: org } },
          visible: isCloud && meta,
          dataTest: "organization-management-tab",
          group: "Account",
        },
      ];
      return items;
    });

    // The active section's metadata (label + description) — drives the shell-owned
    // full-width header for constrained form sections.
    const activeSectionItem = computed(() =>
      settingsItems.value.find((i) => i.key === activeSection.value),
    );

    // Bucket the sections into ordered groups for SectionHub / the breadcrumb switcher.
    const sectionGroups = computed<SectionHubGroup[]>(() => {
      const buckets = new Map<string, SectionHubItem[]>();
      for (const item of settingsItems.value) {
        const g = (item as any).group ?? "";
        if (!buckets.has(g)) buckets.set(g, []);
        buckets.get(g)!.push(item);
      }
      const rank = (label: string) => {
        const i = settingsGroupOrder.indexOf(label);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      // Internal group keys stay English (used for bucketing + rank); only the
      // displayed label is translated so sorting/ranking is unaffected.
      const groupLabels: Record<string, string> = {
        "General": t("settings.groupGeneral"),
        "Access & Security": t("settings.groupAccessSecurity"),
        "Destinations & Templates": t("settings.groupDestinationsTemplates"),
        "Data & AI": t("settings.groupDataAI"),
        "Operations": t("settings.groupOperations"),
        "Account": t("settings.groupAccount"),
      };
      return [...buckets.keys()]
        .sort((a, b) => rank(a) - rank(b))
        .map((label) => ({ label: groupLabels[label] ?? label, items: buckets.get(label)! }));
    });

    return {
      t,
      store,
      router,
      config,
      settingsTab,
      isMetaOrg,
      isHub,
      hubRoute,
      activeSection,
      isConstrainedSection,
      activeSectionItem,
      sectionGroups,
      handleSettingsRouting,
    };
  },
});
</script>
