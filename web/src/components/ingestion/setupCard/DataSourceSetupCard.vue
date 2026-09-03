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

<!--
  DataSourceSetupCard — the generic, slug-driven setup card for (non-AI) data
  sources whose content lives in this repo (see ./registry.ts, ./content/*).

  Drop it on any data-source detail page with a `slug`. If that slug has a
  registered card it renders the shared rich card (the same presentational
  component the AI integrations use); otherwise it falls back to the legacy
  CopyContent + doc link so un-migrated data sources keep working unchanged.
-->
<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { b64EncodeStandard } from "@/utils/zincutils";
import useIngestion from "@/composables/useIngestion";
import { importHostMetricsDashboard } from "@/composables/useHostMetricsDashboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import CopyContent from "@/components/CopyContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import SetupCardRenderer from "./SetupCardRenderer.vue";
import type { CardSubstitutions } from "./types";
import { getDataSourceCard } from "./registry";
import { HOST_AGENT_SLUGS } from "./content/osAgent";

const props = defineProps<{
  /**
   * Data-source route slug, e.g. "sqlServer". Resolves card content from
   * setupCard/registry.ts; if the slug isn't registered, the legacy
   * fallbackContent/fallbackDocUrl is shown instead.
   */
  slug: string;
  /** Legacy CopyContent body, shown when the slug has no registered card. */
  fallbackContent?: string;
  /** Legacy doc link, shown alongside the fallback content. */
  fallbackDocUrl?: string;
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();
const { endpoint } = useIngestion();

// Per-org url/org/token — the same Basic-auth token every Data Sources card
// uses: base64(email:<org ingestion passcode>) WITHOUT the "Basic " prefix.
const subs = computed<CardSubstitutions>(() => {
  const email = store.state.userInfo?.email ?? "";
  const passcode = store.state.organizationData?.organizationPasscode ?? "";
  return {
    url: endpoint.value?.url ?? "",
    org: store.state.selectedOrganization?.identifier ?? "",
    token: b64EncodeStandard(`${email}:${passcode}`) ?? "",
  };
});

const content = computed(() => getDataSourceCard(props.slug, subs.value, t));

// Detection is forwarded so an embedding page (Hosts empty state) can react to it.
const emit = defineEmits<{
  (e: "detected", count: number): void;
}>();

// Host Metrics auto-import (design 4.2) — host-agent slugs only, so the AWS EC2 embed comes free.
const isHostAgentSlug = computed(() => HOST_AGENT_SLUGS.has(props.slug));
const importedDashboard = ref<{ id: string; folderId: string } | null>(null);

const onDetected = async (count: number) => {
  emit("detected", count);
  if (!isHostAgentSlug.value) return;
  // Captured at detect time — an org switch before the toast click must not retarget.
  const org = store.state.selectedOrganization?.identifier ?? "";
  const result = await importHostMetricsDashboard(org);
  // The user didn't invoke the import, so a failure here stays silent.
  if (result.status === "error") return;
  importedDashboard.value = { id: result.dashboardId, folderId: result.folderId };
  toast({
    variant: "success",
    message: t(
      result.status === "created"
        ? "ingestion.setupCard.hostDashboardImported"
        : "ingestion.setupCard.hostDashboardExists",
    ),
    timeout: 5000,
    action: {
      label: t("ingestion.setupCard.viewHosts"),
      handler: () => router.push({ path: "/infra/hosts", query: { org_identifier: org } }),
    },
  });
};

const onStepAction = async (actionId: string) => {
  if (actionId !== "view-host-dashboard" || !isHostAgentSlug.value) return;
  const org = store.state.selectedOrganization?.identifier ?? "";
  let target = importedDashboard.value;
  if (!target) {
    const result = await importHostMetricsDashboard(org);
    if (result.status === "error") {
      // User-invoked path: the failure must be visible and name its cause.
      toast({
        variant: "error",
        message: t(
          result.kind === "forbidden"
            ? "ingestion.setupCard.hostDashboardImportForbidden"
            : "ingestion.setupCard.hostDashboardImportFailed",
        ),
      });
      return;
    }
    target = { id: result.dashboardId, folderId: result.folderId };
    importedDashboard.value = target;
  }
  router.push({
    path: "/dashboards/view",
    query: { org_identifier: org, dashboard: target.id, folder: target.folderId },
  });
};
</script>

<template>
  <!-- Mirrors AIIntegrationDetail's wrapper padding so data-source cards and AI
       integration cards sit identically in their panels. -->
  <div class="p-2">
    <SetupCardRenderer
      v-if="content"
      :content="content"
      :subs="subs"
      data-test="data-source-setup-card"
      @detected="onDetected"
      @step-action="onStepAction"
    />
    <template v-else>
      <CopyContent v-if="fallbackContent" :content="raw(fallbackContent)" />
      <IngestionDocLink v-if="fallbackDocUrl" :href="fallbackDocUrl" />
    </template>
  </div>
</template>
