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
  <div class="tw:h-full tw:min-h-0 tw:flex tw:flex-col">
    <!-- Breadcrumb now lives in the top chrome bar (published from this shell).
         Hub shows the cards; each section renders its own header in its content. -->
    <template v-if="isHub">
      <AppPageHeader
        :title="t('settings.header')"
        icon="settings"
        subtitle="Manage organization preferences, security, destinations, and operational settings."
        class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
      />
      <SectionHub :groups="sectionGroups" class="tw:flex-1 tw:min-h-0" />
    </template>
    <section
      v-else
      class="tw:flex-1 tw:min-w-0 tw:min-h-0 tw:overflow-y-auto"
    >
      <router-view title="" />
    </section>
  </div>
</template>

<script lang="ts">
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import SectionHub, {
  type SectionHubGroup,
  type SectionHubItem,
} from "@/components/common/SectionHub.vue";
import {
  useAppBreadcrumb,
  type Crumb,
} from "@/composables/useAppBreadcrumb";
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
    SectionHub,
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
      cipherKeys:            "cipher-keys",
      license:               "license",
      orgnizationManagement: "organization_management",
      regexPatterns:         "regex_patterns",
      correlationSettings:   "correlation_settings",
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

    // Guard meta-only sections for non-meta users; the hub itself never redirects.
    const handleSettingsRouting = () => {
      const name = router.currentRoute.value.name;
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
      "GENERAL",
      "ACCESS & SECURITY",
      "DESTINATIONS & TEMPLATES",
      "DATA & AI",
      "OPERATIONS",
      "ACCOUNT",
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
          description: "Theme, query defaults, and core preferences",
          icon: "settings",
          to: `/settings/general?org_identifier=${org}`,
          dataTest: "general-settings-tab",
          group: "GENERAL",
        },
        {
          key: "organization",
          label: t("settings.orgLabel"),
          description: "Organization parameters and identifiers",
          icon: "business",
          to: `/settings/organization?org_identifier=${org}`,
          dataTest: "organization-settings-tab",
          group: "GENERAL",
        },
        {
          key: "cipher-keys",
          label: t("settings.cipherKeys"),
          description: "Encryption keys for sensitive fields",
          icon: "key",
          to: { name: "cipherKeys", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "management-cipher-key-tab",
          group: "ACCESS & SECURITY",
        },
        {
          key: "regex_patterns",
          label: t("regex_patterns.title"),
          description: "Reusable regex patterns for redaction",
          icon: `img:${regexIcon.value}`,
          to: { name: "regexPatterns", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "regex-patterns-tab",
          group: "ACCESS & SECURITY",
        },
        {
          key: "domain_management",
          label: t("settings.ssoDomainRestrictions"),
          description: "Restrict sign-in to allowed SSO domains",
          icon: "dns",
          to: { name: "domainManagement", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "domain-management-tab",
          group: "ACCESS & SECURITY",
        },
        {
          key: "alert_destinations",
          label: t("alert_destinations.header"),
          description: "Where triggered alerts are delivered",
          icon: "location-on",
          to: { name: "alertDestinations", query: { org_identifier: org } },
          dataTest: "alert-destinations-tab",
          group: "DESTINATIONS & TEMPLATES",
        },
        {
          key: "pipeline_destinations",
          label: t("pipeline_destinations.header"),
          description: "External targets for pipeline output",
          icon: "person-pin-circle",
          to: { name: "pipelineDestinations", query: { org_identifier: org } },
          visible: isEnt,
          dataTest: "pipeline-destinations-tab",
          group: "DESTINATIONS & TEMPLATES",
        },
        {
          key: "templates",
          label: t("alert_templates.header"),
          description: "Reusable alert message templates",
          icon: "description",
          to: { name: "alertTemplates", query: { org_identifier: org } },
          dataTest: "alert-templates-tab",
          group: "DESTINATIONS & TEMPLATES",
        },
        {
          key: "storageSettings",
          label: t("storage_settings.tabLabel"),
          description: "Per-organization storage configuration",
          icon: "cloud",
          to: { name: "storageSettings", query: { org_identifier: org } },
          visible:
            isEnt &&
            (!isCloud ||
              store.state.organizationData.organizationSettings
                .org_storage_enabled === true),
          dataTest: "storage-settings-tab",
          group: "DATA & AI",
        },
        {
          key: "model_pricing",
          label: t("settings.llmModelPricing"),
          description: "LLM model cost configuration",
          icon: "paid",
          to: { name: "modelPricing", query: { org_identifier: org } },
          visible: !!z.model_pricing_enabled,
          dataTest: "model-pricing-tab",
          group: "DATA & AI",
        },
        {
          key: "correlation_settings",
          label: t("settings.correlationSettings"),
          description: "Telemetry correlation configuration",
          icon: "group-work",
          to: { name: "correlationSettings", query: { org_identifier: org } },
          visible: isEnt && z.service_streams_enabled !== false,
          dataTest: "correlation-settings-tab",
          group: "DATA & AI",
        },
        {
          key: "queryManagement",
          label: t("settings.queryManagement"),
          description: "Inspect and cancel running queries",
          icon: "query-stats",
          to: `/settings/query_management?org_identifier=${org}`,
          visible: isEnt && meta,
          dataTest: "query-management-tab",
          group: "OPERATIONS",
        },
        {
          key: "nodes",
          label: t("settings.nodes"),
          description: "Cluster nodes and their health",
          icon: "hub",
          to: { name: "nodes", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "nodes-tab",
          group: "OPERATIONS",
        },
        {
          key: "license",
          label: t("settings.license"),
          description: "Enterprise license details",
          icon: "card-membership",
          to: { name: "license", query: { org_identifier: org } },
          visible: isEnt && meta,
          dataTest: "license-tab",
          group: "ACCOUNT",
        },
        {
          key: "organization_management",
          label: t("settings.organizationManagement"),
          description: "Create and manage organizations",
          icon: "lan",
          to: { name: "orgnizationManagement", query: { org_identifier: org } },
          visible: isCloud && meta,
          dataTest: "organization-management-tab",
          group: "ACCOUNT",
        },
      ];
      return items;
    });

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
      return [...buckets.keys()]
        .sort((a, b) => rank(a) - rank(b))
        .map((label) => ({ label, items: buckets.get(label)! }));
    });

    // Breadcrumb (row 1). Hub: just the module name. Section: Settings(link →
    // hub) › <Section ▾>  (› Edit on the one editor).
    const crumbs = computed<Crumb[]>(() => {
      if (isHub.value)
        return [
          {
            label: t("settings.header"),
            icon: "settings",
            current: true,
            dataTest: "breadcrumb-settings-root",
          },
        ];
      const list: Crumb[] = [
        {
          label: t("settings.header"),
          icon: "settings",
          to: hubRoute.value,
          dataTest: "breadcrumb-settings-root",
        },
        {
          dropdown: sectionGroups.value,
          activeKey: activeSection.value,
          dataTest: "breadcrumb-settings-section",
        },
      ];
      if (route.name === "modelPricingEditor")
        list.push({ label: "Edit", current: true });
      return list;
    });

    // Publish the breadcrumb to the top chrome bar. Republish on change + on
    // keep-alive re-entry; clear on leave (the chrome's route-key gate is the
    // real safety net against stale crumbs).
    const { publish, clear } = useAppBreadcrumb();
    watch(crumbs, (c) => publish(c), { immediate: true });
    onActivated(() => publish(crumbs.value));
    onDeactivated(clear);
    onUnmounted(clear);

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
      sectionGroups,
      crumbs,
      handleSettingsRouting,
    };
  },
});
</script>
