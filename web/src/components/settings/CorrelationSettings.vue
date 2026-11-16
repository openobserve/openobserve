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
    icon="group-work"
    :subtitle="t('settings.correlationSettingsPage.subtitle')"
    data-test="correlation-settings-header"
    tabs-below
    bleed
  >
    <template #title>
      <span data-test="correlation-settings-page-title">{{
        t("settings.correlationSettings")
      }}</span>
    </template>

    <!-- Module tabs (Level-2 nav) -->
    <template #header-tabs>
      <OTabs
        :model-value="activeTab"
        dense
        align="left"
        data-test="correlation-settings-tabs"
        @update:model-value="onTabChange"
      >
        <OTab
          name="services"
          data-test="correlation-settings-services-tab"
          :label="t('settings.correlation.discoveredServicesTab')"
          :suffix-icon="correlationLocked ? 'lock' : undefined"
        />
        <OTab
          name="discovery"
          data-test="correlation-settings-discovery-tab"
          :label="t('settings.correlation.serviceDiscoveryTab')"
          :suffix-icon="correlationLocked ? 'lock' : undefined"
        />
        <OTab
          v-if="versionsEnabled"
          name="env-versions"
          data-test="svcver-correlation-settings-env-versions-tab"
          :label="t('serviceVersions.settings.tab')"
          :suffix-icon="correlationLocked ? 'lock' : undefined"
        />
        <OTab
          name="field-aliases"
          data-test="correlation-settings-field-aliases-tab"
          :label="t('settings.correlation.fieldAliasesTab')"
          :suffix-icon="alertsLocked ? 'lock' : undefined"
        />
      </OTabs>
    </template>

    <!-- Tab content -->
    <div class="min-h-0 flex-1 overflow-hidden">
      <div v-show="activeTab === 'services'" class="h-full">
        <LicenseDeniedState
          v-if="correlationLocked"
          :features="['correlation']"
          data-test="correlation-services-license-denied"
        />
        <DiscoveredServices
          v-else
          :view="servicesView"
          @update:view="onServicesViewChange"
          @navigate-to-configuration="onTabChange('discovery')"
          @navigate-to-env-versions="onTabChange('env-versions')"
        />
      </div>

      <div
        v-if="versionsEnabled && activeTab === 'env-versions'"
        class="px-page-edge h-full overflow-y-auto"
      >
        <LicenseDeniedState
          v-if="correlationLocked"
          :features="['correlation']"
          data-test="svcver-env-versions-license-denied"
        />
        <ServiceEnvVersionSettings v-else />
      </div>

      <div v-show="activeTab === 'discovery'" class="h-full overflow-y-auto px-4 py-4">
        <LicenseDeniedState
          v-if="correlationLocked"
          :features="['correlation']"
          data-test="correlation-discovery-license-denied"
        />
        <ServiceIdentitySetup
          v-else
          ref="identitySetup"
          :org-identifier="store.state.selectedOrganization.identifier"
          :semantic-groups="semanticGroups"
          @navigate-to-aliases="onNavigateToAliases"
          @navigate-to-services="onTabChange('services')"
        />
      </div>

      <div v-show="activeTab === 'field-aliases'" class="h-full overflow-y-auto px-4 py-4">
        <LicenseDeniedState
          v-if="alertsLocked"
          :features="['alerts']"
          data-test="correlation-field-aliases-license-denied"
        />
        <SemanticFieldGroupsConfig
          v-else
          class="mt-2 max-w-5xl"
          :key="`field-aliases-${fieldAliasesEditorKey}`"
          :semantic-field-groups="draftSemanticGroups"
          :scroll-to-group-id="aliasScrollToGroup"
          @update:semanticFieldGroups="onDraftSemanticGroupsChange"
        />
      </div>
    </div>

    <!-- One bar for the page: Detection Rules and Field Mappings keep their edits across tab switches. -->
    <OSaveBar
      v-if="showSaveBar"
      class="shrink-0 px-4"
      :change-count="changeCount"
      :saving="saving"
      data-test="correlation-settings-save-bar"
      :save-data-test="
        activeTab === 'discovery'
          ? 'service-identity-save-btn'
          : 'correlation-semanticfieldgroup-save-btn'
      "
      discard-data-test="correlation-settings-discard-btn"
      @save="savePage"
      @discard="discardPage"
    />
  </OPageLayout>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import { defineComponent, ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { useRouter, useRoute } from "vue-router";
import DiscoveredServices from "@/components/settings/DiscoveredServices.vue";
import ServiceIdentitySetup from "@/components/settings/ServiceIdentitySetup.vue";
import ServiceEnvVersionSettings from "@/components/settings/ServiceEnvVersionSettings.vue";
import config from "@/aws-exports";
import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSaveBar from "@/lib/forms/SaveBar/OSaveBar.vue";
import { useLeaveGuard } from "@/lib/forms/SaveBar/useLeaveGuard";
import serviceStreamsService from "@/services/service_streams";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useLicenseLock } from "@/composables/useFeatureLock";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";

const versionsEnabled = config.isEnterprise === "true" || config.isCloud === "true";

export default defineComponent({
  name: "CorrelationSettings",
  components: {
    DiscoveredServices,
    ServiceIdentitySetup,
    ServiceEnvVersionSettings,
    SemanticFieldGroupsConfig,
    LicenseDeniedState,
    OTabs,
    OTab,
    OPageLayout,
    OSaveBar,
  },
  setup() {
    const store = useStore();
    const { t } = useI18nTyped();
    const router = useRouter();
    const route = useRoute();
    const { locked: correlationLocked } = useLicenseLock("correlation");
    const { locked: alertsLocked } = useLicenseLock("alerts");

    // URL slug ↔ internal tab name
    const slugToTab: Record<string, string> = {
      "service-discovery": "discovery",
      services: "services",
      ...(versionsEnabled ? { "env-versions": "env-versions" } : {}),
      "field-aliases": "field-aliases",
    };
    const tabToSlug: Record<string, string> = {
      discovery: "service-discovery",
      services: "services",
      "env-versions": "env-versions",
      "field-aliases": "field-aliases",
    };

    // Name review is a view of Discovered Services, deep-linked as ?view=name-review.
    const servicesView = computed(() =>
      versionsEnabled && route.query.view === "name-review" ? "name-review" : "services",
    );
    const withoutView = () => {
      const { view: _view, ...rest } = route.query;
      return rest;
    };

    const initialSlug = route.params.tab as string;
    const activeTab = ref(slugToTab[initialSlug] ?? "services");
    const aliasScrollToGroup = ref<string | undefined>(route.query.group as string | undefined);

    const semanticGroups = ref<any[]>([]);
    const draftSemanticGroups = ref<any[]>([]);
    const savingFieldAliases = ref(false);

    // Compare only user-meaningful fields. `id` is auto-derived from display+group
    // by the child component on blur, so including it here would falsely flag dirty
    // just because the user focused/blurred a Name input. Empty draft entries
    // (no display + no fields) are ignored so just clicking "Add Custom Group"
    // without filling anything in doesn't enable Save.
    const normalizeGroups = (groups: any[]) => {
      const normalized = (groups ?? [])
        .filter((g) => (g.display ?? "").trim() !== "" || (g.fields ?? []).length > 0)
        .map((g) => ({
          display: (g.display ?? "").trim(),
          group: g.group ?? "",
          is_workload_type: !!g.is_workload_type,
          fields: [...(g.fields ?? [])].sort(),
        }));
      normalized.sort((a, b) => a.display.localeCompare(b.display));
      return normalized;
    };
    const normalizeGroupsForCompare = (groups: any[]): string =>
      JSON.stringify(normalizeGroups(groups));

    const isFieldAliasesDirty = computed(
      () =>
        normalizeGroupsForCompare(draftSemanticGroups.value) !==
        normalizeGroupsForCompare(semanticGroups.value),
    );
    // One change per group that was added, removed or edited since the last load or save.
    const fieldAliasChangeCount = computed(() => {
      if (!isFieldAliasesDirty.value) return 0;
      const byName = (groups: any[]) =>
        new Map(normalizeGroups(groups).map((g) => [g.display, JSON.stringify(g)]));
      const saved = byName(semanticGroups.value);
      const draft = byName(draftSemanticGroups.value);
      const names = new Set([...saved.keys(), ...draft.keys()]);
      return Math.max(1, [...names].filter((name) => saved.get(name) !== draft.get(name)).length);
    });

    // Detection Rules owns its draft; the page reads its state and runs its save through the bar.
    const identitySetup = ref<{
      isDirty: boolean;
      saving: boolean;
      saveConfig: () => Promise<boolean>;
      discardChanges: () => void;
    } | null>(null);
    const isIdentityDirty = computed(() => !!identitySetup.value?.isDirty);

    const changeCount = computed(
      () => (isIdentityDirty.value ? 1 : 0) + fieldAliasChangeCount.value,
    );
    const saving = computed(() => savingFieldAliases.value || !!identitySetup.value?.saving);
    const showSaveBar = computed(
      () =>
        changeCount.value > 0 ||
        (activeTab.value === "discovery" && !correlationLocked.value) ||
        (activeTab.value === "field-aliases" && !alertsLocked.value),
    );

    // Bumped to force-reset SemanticFieldGroupsConfig's internal state on discard
    const fieldAliasesEditorKey = ref(0);

    const cloneGroups = (groups: any[]): any[] =>
      groups.map((g) => ({ ...g, fields: [...(g.fields ?? [])] }));

    const loadSemanticGroups = async () => {
      // the semantic-groups endpoint is licensed under alerts
      if (alertsLocked.value) return;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const res = await serviceStreamsService.getSemanticGroups(orgId);
        semanticGroups.value = res.data ?? [];
      } catch (_) {
        semanticGroups.value = [];
      }
      draftSemanticGroups.value = cloneGroups(semanticGroups.value);
    };

    onMounted(loadSemanticGroups);

    // Keep URL in sync when route changes externally (e.g. browser back/forward)
    watch(
      () => route.params.tab,
      (slug) => {
        const tab = slugToTab[slug as string] ?? "discovery";
        if (tab !== activeTab.value) activeTab.value = tab;
        aliasScrollToGroup.value = route.query.group as string | undefined;
      },
    );

    // Clear the group deep-link after the scroll + blink animation completes,
    // so revisiting the tab doesn't re-trigger the highlight.
    watch(activeTab, (tab) => {
      if (tab === "field-aliases" && route.query.group) {
        setTimeout(() => {
          aliasScrollToGroup.value = undefined;
          const { group: _g, ...rest } = route.query;
          router.replace({
            name: "correlationSettings",
            params: { tab: "field-aliases" },
            query: rest,
          });
        }, 1800);
      }
    });

    const tabs = computed(() => [
      {
        label: t("settings.correlation.discoveredServicesTab"),
        value: "services",
        icon: "dns",
      },
      {
        label: t("settings.correlation.serviceDiscoveryTab"),
        value: "discovery",
        icon: "manage-search",
      },
      {
        label: t("settings.correlation.fieldAliasesTab"),
        value: "field-aliases",
        icon: "link",
      },
    ]);

    // A tab switch changes the route path but keeps both drafts, so the leave guard must not ask.
    let switchingTab = false;
    const pushTab = async (to: Parameters<typeof router.push>[0]) => {
      switchingTab = true;
      try {
        await router.push(to);
      } finally {
        switchingTab = false;
      }
    };

    const onTabChange = (value: string | number) => {
      const tab = String(value);
      activeTab.value = tab;
      return pushTab({
        name: "correlationSettings",
        params: { tab: tabToSlug[tab] ?? tab },
        query: tab === "services" ? route.query : withoutView(),
      });
    };

    const onServicesViewChange = (view: string) => {
      if (view === servicesView.value) return;
      router.push({
        name: "correlationSettings",
        params: { tab: "services" },
        query: view === "name-review" ? { ...route.query, view } : withoutView(),
      });
    };

    const onNavigateToAliases = (groupId: string) => {
      aliasScrollToGroup.value = groupId;
      activeTab.value = "field-aliases";
      return pushTab({
        name: "correlationSettings",
        params: { tab: "field-aliases" },
        query: { ...route.query, group: groupId },
      });
    };

    const onDraftSemanticGroupsChange = (groups: any[]) => {
      draftSemanticGroups.value = groups;
    };

    const saveSemanticGroups = async () => {
      if (savingFieldAliases.value) return;
      if (!isFieldAliasesDirty.value) return;
      savingFieldAliases.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        // A copy taken before the request: groups edited while it is pending stay unsaved.
        const groups = cloneGroups(draftSemanticGroups.value);
        const sent = normalizeGroupsForCompare(groups);
        await serviceStreamsService.updateSemanticGroups(orgId, groups);
        // The groups are cached, and dimension analytics is computed from them.
        void queryClient.invalidateQueries({ queryKey: serviceStreamKeys.all(orgId) });
        semanticGroups.value = groups;
        if (normalizeGroupsForCompare(draftSemanticGroups.value) === sent) {
          draftSemanticGroups.value = cloneGroups(groups);
        }
        toast({ variant: "success", message: t("settings.correlation.fieldAliasesSaved") });
      } catch (_) {
        toast({ variant: "error", message: t("settings.correlation.fieldAliasesSaveError") });
      } finally {
        savingFieldAliases.value = false;
      }
    };

    const discardSemanticGroups = () => {
      draftSemanticGroups.value = cloneGroups(semanticGroups.value);
      // Force-remount the editor so its internal localGroups resets cleanly
      fieldAliasesEditorKey.value += 1;
    };

    // Each dirty tab sends its own request and reports its own failure; a failed tab stays counted.
    // Both start together so each sends what Save was clicked on, not edits made while the other waits.
    const savePage = async () => {
      await Promise.all([
        isIdentityDirty.value && identitySetup.value?.saveConfig(),
        isFieldAliasesDirty.value && saveSemanticGroups(),
      ]);
    };

    const discardPage = () => {
      if (isIdentityDirty.value) identitySetup.value?.discardChanges();
      if (isFieldAliasesDirty.value) discardSemanticGroups();
    };

    useLeaveGuard(() => !switchingTab && changeCount.value > 0, {
      count: () => changeCount.value,
      onDiscard: discardPage,
    });

    return {
      store,
      versionsEnabled,
      activeTab,
      aliasScrollToGroup,
      tabs,
      onTabChange,
      servicesView,
      onServicesViewChange,
      onNavigateToAliases,
      onDraftSemanticGroupsChange,
      saveSemanticGroups,
      discardSemanticGroups,
      identitySetup,
      changeCount,
      saving,
      showSaveBar,
      savePage,
      discardPage,
      semanticGroups,
      draftSemanticGroups,
      isFieldAliasesDirty,
      savingFieldAliases,
      fieldAliasesEditorKey,
      correlationLocked,
      alertsLocked,
      t,
    };
  },
});
</script>
