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
  <OPageLayout bleed :sidebar-width="230">
    <template #sidebar>
      <SectionRail
        :groups="sectionGroups"
        :active-key="activeSection"
        :title="t('settings.header')"
      />
    </template>

    <!-- Form-style sections (general, org params, license, domain): a section
         header above a centered reading column. -->
    <div v-if="isConstrainedSection" class="flex h-full min-h-0 flex-col">
      <OPageHeader
        :title="activeSectionItem?.label ?? raw('')"
        :title-data-test="`settings-${activeSectionItem?.key}-page-title`"
        :about="pageSubtitles[activeSection] ?? activeSectionItem?.description"
        content-size="lg"
      >
        <template v-if="HEADER_ACTION_SECTIONS.has(activeSection)" #actions>
          <div :id="PAGE_ACTIONS_SLOT_ID" class="flex items-center gap-2"></div>
        </template>
      </OPageHeader>
      <ConstrainedPage
        size="lg"
        align="left"
        :padded="false"
        class="px-page-edge min-h-0 flex-1 py-3"
      >
        <router-view title="" />
      </ConstrainedPage>
      <!-- Outside the scroller and its reading column, so a page's save bar spans the pane at its bottom. -->
      <div :id="SAVE_BAR_SLOT_ID" class="shrink-0"></div>
    </div>
    <!-- Table/list sections render their own header (OPageLayout) inside. Do NOT
         pass a `title` attr here: these children are OPageLayout-rooted, so a
         fallthrough `title` would clobber their own `:title` prop and blank the
         header (regression seen on Query Management / Nodes). -->
    <section v-else class="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
      <router-view />
    </section>
  </OPageLayout>
</template>

<script lang="ts">
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { providePageRailGroup } from "@/lib/core/PageHeader/pageContext";
import SectionRail from "@/components/common/SectionRail.vue";
import { defineComponent, ref, onBeforeMount, onActivated, onUpdated, computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import config from "@/aws-exports";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { menuState } from "@/utils/featureGate";
import { useSettingsSections } from "./useSettingsSections";
import { PAGE_ACTIONS_SLOT_ID } from "./pageActionsSlot";
import { SAVE_BAR_SLOT_ID } from "./saveBarSlot";

export default defineComponent({
  name: "AppSettings",
  components: {
    OPageHeader,
    ConstrainedPage,
    OPageLayout,
    SectionRail,
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router: any = useRouter();
    const route = useRoute();

    // Maps a route name → the section key used by the hub/switcher.
    const routeToSettingsTab: Record<string, string> = {
      general: "general",
      organizationSettings: "organization",
      nodes: "nodes",
      query_management: "queryManagement",
      domainManagement: "domain_management",
      orgDomainMapping: "org_domain_mapping",
      passwordPolicy: "password_policy",
      announcementBanners: "announcements",
      announcementBannerEditor: "announcements",
      pipelineDestinations: "pipeline_destinations",
      telephonySettings: "telephony",
      storageSettings: "storageSettings",
      cipherKeys: "cipher-keys",
      aiToolsets: "ai_toolsets",
      license: "license",
      orgnizationManagement: "organization_management",
      regexPatterns: "regex_patterns",
      syntheticsLocations: "synthetics_locations",
      correlationSettings: "correlation_settings",
      slack: "slack",
    };

    const settingsTab = ref(
      routeToSettingsTab[router.currentRoute.value.name as string] ?? "general",
    );
    const { isMetaOrg } = useIsMetaOrg();

    const activeSection = computed(() => routeToSettingsTab[route.name as string] ?? "");

    // Form-style sections render in a centered reading column (ConstrainedPage);
    // table/list sections (nodes, destinations, templates, …) stay full-width.
    const CONSTRAINED_SECTIONS = new Set([
      "general",
      "organization",
      "license",
      "domain_management",
      "password_policy",
      "slack",
    ]);
    const isConstrainedSection = computed(() => CONSTRAINED_SECTIONS.has(activeSection.value));
    // Pages without a header of their own that put buttons in the shell's header.
    const HEADER_ACTION_SECTIONS = new Set(["slack"]);

    const { slackVisible, settingsItems, sectionGroups } = useSettingsSections();

    const handleSettingsRouting = () => {
      const name = router.currentRoute.value.name;
      const toGeneral = () => {
        settingsTab.value = "general";
        router.push({
          path: "/settings/general",
          query: { org_identifier: store.state.selectedOrganization?.identifier },
        });
      };
      // License, Password policy, Query Management and Announcements are enterprise-only meta-org pages.
      const notMeta =
        store.state.zoConfig.meta_org && (!isMetaOrg.value || config.isEnterprise === "false");
      if (
        (name === "license" ||
          name === "passwordPolicy" ||
          name === "query_management" ||
          name === "announcementBanners" ||
          name === "announcementBannerEditor") &&
        notMeta
      ) {
        toGeneral();
        return;
      }
      // Nodes is meta-org-only but NOT enterprise-only: OSS clusters too, and the
      // node list API serves the _meta org in every edition.
      if (name === "nodes" && store.state.zoConfig.meta_org && !isMetaOrg.value) {
        toGeneral();
        return;
      }
      // Synthetics locations is meta-org-only but NOT enterprise-only: synthetics
      // ships in OSS, and the public location registry is the one venue an OSS
      // deployment has — there is no agent-served pool to fall back on. It follows
      // the same backend flag the rest of synthetics does.
      const syntheticsBlocked =
        (store.state.zoConfig.meta_org && !isMetaOrg.value) ||
        menuState(
          store.state.zoConfig?.features,
          "synthetics",
          store.state.zoConfig?.synthetics_enabled !== false,
        ) === "hidden";
      if (name === "syntheticsLocations" && syntheticsBlocked) {
        toGeneral();
        return;
      }
      if (name === "orgDomainMapping" && config.isCloud !== "true") {
        toGeneral();
        return;
      }
      // A cold load has no org config yet; redirecting then would bounce a valid deep link.
      const slackConfigLoaded = typeof store.state.zoConfig?.slack_enabled === "boolean";
      if (name === "slack" && slackConfigLoaded && !slackVisible.value) {
        toGeneral();
      }
    };

    onBeforeMount(handleSettingsRouting);
    onActivated(handleSettingsRouting);
    onUpdated(handleSettingsRouting);

    // The active section's metadata (label + description) — drives the shell-owned
    // full-width header for constrained form sections.
    const activeSectionItem = computed(() =>
      settingsItems.value.find((i) => i.key === activeSection.value),
    );

    // The header describes the page for this organization; the rail keeps its shorter description.
    const pageSubtitles = computed<Record<string, I18nText>>(() => {
      const org = store.state.selectedOrganization?.label ?? "";
      return {
        general: t("settings.generalSubtitle", { org }),
        organization: t("settings.orgSubtitle", { org }),
        password_policy: t("settings.passwordPolicySubtitle"),
      };
    });

    providePageRailGroup(
      computed(
        () =>
          sectionGroups.value.find((g) => g.items.some((i) => i.key === activeSection.value))
            ?.label,
      ),
    );

    return {
      raw,
      t,
      store,
      router,
      config,
      settingsTab,
      isMetaOrg,
      activeSection,
      isConstrainedSection,
      SAVE_BAR_SLOT_ID,
      PAGE_ACTIONS_SLOT_ID,
      HEADER_ACTION_SECTIONS,
      activeSectionItem,
      pageSubtitles,
      sectionGroups,
      handleSettingsRouting,
    };
  },
});
</script>
