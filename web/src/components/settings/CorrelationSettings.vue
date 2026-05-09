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
  <div class="tw:w-full tw:h-full tw:flex tw:flex-col tw:overflow-hidden">
    <!-- Sticky header: title + tabs -->
    <div class="tw:shrink-0 tw:bg-[var(--o2-card-bg)]">
      <div class="q-px-md q-py-md">
        <div class="general-page-title">
          {{ t("settings.correlation.title") }}
        </div>
        <div class="general-page-subtitle">
          {{ t("settings.correlation.subtitle") }}
        </div>
      </div>
      <div class="tw:px-4 tw:flex tw:justify-start">
        <OTabs :model-value="activeTab" dense @update:model-value="onTabChange">
          <OTab
            name="services"
            :label="t('settings.correlation.discoveredServicesTab')"
          />
          <OTab
            name="discovery"
            :label="t('settings.correlation.serviceDiscoveryTab')"
          />
          <OTab
            name="alert-correlation"
            :label="t('settings.correlation.alertCorrelationTab')"
          />
          <OTab
            name="field-aliases"
            :label="t('settings.correlation.fieldAliasesTab')"
          />
        </OTabs>
      </div>
    </div>

    <!-- Scrollable content -->
    <div class="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:py-2">
      <div v-show="activeTab === 'discovery'">
        <ServiceIdentitySetup
          :org-identifier="store.state.selectedOrganization.identifier"
          :semantic-groups="semanticGroups"
          @navigate-to-aliases="onNavigateToAliases"
          @navigate-to-services="onTabChange('services')"
          @update-service-fields="onUpdateServiceFields"
        />
      </div>

      <div v-show="activeTab === 'services'">
        <DiscoveredServices @navigate-to-configuration="onTabChange('discovery')" />
      </div>

      <OrganizationDeduplicationSettings
        v-show="activeTab === 'alert-correlation'"
        :org-id="store.state.selectedOrganization.identifier"
        :config="store.state.organizationSettings?.deduplication_config"
        @saved="onCorrelationSettingsSaved"
      />

      <SemanticFieldGroupsConfig
        v-show="activeTab === 'field-aliases'"
        :key="`field-aliases-${fieldAliasesEditorKey}`"
        :semantic-field-groups="draftSemanticGroups"
        :scroll-to-group-id="aliasScrollToGroup"
        @update:semantic-field-groups="onDraftSemanticGroupsChange"
      >
        <template #header-actions>
          <OButton
            data-test="correlation-semanticfieldgroup-save-btn"
            variant="primary"
            size="sm"
            :disabled="!isFieldAliasesDirty"
            :loading="savingFieldAliases"
            @click="saveSemanticGroups"
          >
            {{ t("common.save") }}
          </OButton>
        </template>
      </SemanticFieldGroupsConfig>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import { defineComponent, ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute, onBeforeRouteLeave } from "vue-router";
import OrganizationDeduplicationSettings from "@/components/alerts/OrganizationDeduplicationSettings.vue";
import DiscoveredServices from "@/components/settings/DiscoveredServices.vue";
import ServiceIdentitySetup from "@/components/settings/ServiceIdentitySetup.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import { Server, ScanSearch, Bell, Link2 } from "lucide-vue-next";
import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import serviceStreamsService from "@/services/service_streams";

export default defineComponent({
  name: "CorrelationSettings",
  components: {
    OrganizationDeduplicationSettings,
    DiscoveredServices,
    ServiceIdentitySetup,
    AppTabs,
    SemanticFieldGroupsConfig,
    OTabs,
    OTab,
  },
  setup() {
    const store = useStore();
    const q = useQuasar();
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();

    // URL slug ↔ internal tab name
    const slugToTab: Record<string, string> = {
      "service-discovery": "discovery",
      "services": "services",
      "alert-correlation": "alert-correlation",
      "field-aliases": "field-aliases",
    };
    const tabToSlug: Record<string, string> = {
      "discovery": "service-discovery",
      "services": "services",
      "alert-correlation": "alert-correlation",
      "field-aliases": "field-aliases",
    };

    const initialSlug = route.params.tab as string;
    const activeTab = ref(slugToTab[initialSlug] ?? "services");
    const aliasScrollToGroup = ref<string | undefined>(
      route.query.group as string | undefined
    );

    const semanticGroups = ref<any[]>([]);
    const draftSemanticGroups = ref<any[]>([]);
    const savingFieldAliases = ref(false);

    // Compare only user-meaningful fields. `id` is auto-derived from display+group
    // by the child component on blur, so including it here would falsely flag dirty
    // just because the user focused/blurred a Name input. Empty draft entries
    // (no display + no fields) are ignored so just clicking "Add Custom Group"
    // without filling anything in doesn't enable Save.
    const normalizeGroupsForCompare = (groups: any[]): string => {
      const normalized = (groups ?? [])
        .filter((g) => (g.display ?? "").trim() !== "" || (g.fields ?? []).length > 0)
        .map((g) => ({
          display: (g.display ?? "").trim(),
          group: g.group ?? "",
          is_workload_type: !!g.is_workload_type,
          fields: [...(g.fields ?? [])].sort(),
        }));
      normalized.sort((a, b) => a.display.localeCompare(b.display));
      return JSON.stringify(normalized);
    };

    const isFieldAliasesDirty = computed(
      () =>
        normalizeGroupsForCompare(draftSemanticGroups.value) !==
        normalizeGroupsForCompare(semanticGroups.value),
    );
    // Bumped to force-reset SemanticFieldGroupsConfig's internal state on discard
    const fieldAliasesEditorKey = ref(0);

    const cloneGroups = (groups: any[]): any[] =>
      groups.map((g) => ({ ...g, fields: [...(g.fields ?? [])] }));

    const loadSemanticGroups = async () => {
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
      }
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
        icon: Server,
      },
      {
        label: t("settings.correlation.serviceDiscoveryTab"),
        value: "discovery",
        icon: ScanSearch,
      },
      {
        label: t("settings.correlation.alertCorrelationTab"),
        value: "alert-correlation",
        icon: Bell,
      },
      {
        label: t("settings.correlation.fieldAliasesTab"),
        value: "field-aliases",
        icon: Link2,
      },
    ]);

    const confirmDiscardUnsaved = (): Promise<boolean> => {
      if (!isFieldAliasesDirty.value) return Promise.resolve(true);
      return new Promise((resolve) => {
        q.dialog({
          title: t("common.unsavedChanges"),
          message: t("settings.correlation.fieldAliasesUnsavedConfirm"),
          ok: { label: t("common.discardChanges"), color: "negative", flat: true },
          cancel: { label: t("common.cancel"), flat: true },
          persistent: true,
        })
          .onOk(() => resolve(true))
          .onCancel(() => resolve(false));
      });
    };

    const onTabChange = async (tab: string) => {
      if (activeTab.value === "field-aliases" && tab !== "field-aliases") {
        const proceed = await confirmDiscardUnsaved();
        if (!proceed) return;
        if (isFieldAliasesDirty.value) discardSemanticGroups();
      }
      activeTab.value = tab;
      router.push({
        name: "correlationSettings",
        params: { tab: tabToSlug[tab] ?? tab },
        query: route.query,
      });
    };

    const onNavigateToAliases = (groupId: string) => {
      aliasScrollToGroup.value = groupId;
      activeTab.value = "field-aliases";
      router.push({
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
      savingFieldAliases.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const groups = draftSemanticGroups.value;
        await serviceStreamsService.updateSemanticGroups(orgId, groups);
        semanticGroups.value = groups;
        draftSemanticGroups.value = cloneGroups(groups);
        q.notify({ type: "positive", message: t("settings.correlation.fieldAliasesSaved") });
      } catch (_) {
        q.notify({ type: "negative", message: t("settings.correlation.fieldAliasesSaveError") });
      } finally {
        savingFieldAliases.value = false;
      }
    };

    const discardSemanticGroups = () => {
      draftSemanticGroups.value = cloneGroups(semanticGroups.value);
      // Force-remount the editor so its internal localGroups resets cleanly
      fieldAliasesEditorKey.value += 1;
    };

    const onUpdateServiceFields = async (fields: string[]) => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const updated = semanticGroups.value.map((g: any) =>
          g.id === "service" ? { ...g, fields } : g
        );
        await serviceStreamsService.updateSemanticGroups(orgId, updated);
        semanticGroups.value = updated;
        q.notify({ type: "positive", message: t("settings.correlation.fieldAliasesSaved") });
      } catch (_) {
        q.notify({ type: "negative", message: t("settings.correlation.fieldAliasesSaveError") });
      }
    };

    const onCorrelationSettingsSaved = () => {
      // Child components handle their own notifications and data refresh
      // No global store update needed as settings are managed via settings v2 API
    };

    onBeforeRouteLeave(async () => {
      if (!isFieldAliasesDirty.value) return true;
      return await confirmDiscardUnsaved();
    });

    return {
      store,
      activeTab,
      aliasScrollToGroup,
      tabs,
      onTabChange,
      onCorrelationSettingsSaved,
      onNavigateToAliases,
      onUpdateServiceFields,
      onDraftSemanticGroupsChange,
      saveSemanticGroups,
      discardSemanticGroups,
      semanticGroups,
      draftSemanticGroups,
      isFieldAliasesDirty,
      savingFieldAliases,
      fieldAliasesEditorKey,
      t,
    };
  },
});
</script>

<style scoped lang="scss">
.general-page-title {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.5rem;
}
.general-page-subtitle {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
}
</style>
