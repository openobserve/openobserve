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
  CredentialCodeBlock + doc link so un-migrated data sources keep working unchanged.
-->
<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { b64EncodeStandard } from "@/utils/zincutils";
import { isPrimaryCloudWebUrl } from "@/utils/otelCollectorConfig";
import useIngestion from "@/composables/useIngestion";
import { importHostMetricsDashboard } from "@/composables/useHostMetricsDashboard";
import analytics from "@/services/product_analytics";
import {
  SETUP_DASHBOARD_BY_SLUG,
  importSetupDashboard,
} from "@/composables/useSetupDashboardImport";
import { toast } from "@/lib/feedback/Toast/useToast";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import SetupCardRenderer from "./SetupCardRenderer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { CardSubstitutions } from "./types";
import { getDataSourceCard } from "./registry";
import { HOST_AGENT_SLUGS } from "./content/osAgent";
import {
  READY_MADE_SOURCE_BY_SETUP_SLUG,
  getReadyMadeSource,
  type ReadyMadeSourceId,
} from "@/composables/readyMade/catalog";
import {
  installReadyMade,
  type ReadyMadeInstallResult,
} from "@/composables/readyMade/installReadyMade";
import {
  createdReadyMadeDashboards,
  describeReadyMadeInstall,
  isReadyMadeGapFill,
  joinReadyMadeNames,
} from "@/composables/readyMade/readyMadeMessages";
import {
  recallReadyMadeNotice,
  storeReadyMadeNotice,
  type ReadyMadeAutoAddNotice,
} from "@/composables/readyMade/readyMadeNotice";
import { readReadyMadeSettings } from "@/composables/readyMade/readyMadeSettings";
import { useReadyMadeDetection } from "@/composables/readyMade/useReadyMadeDetection";

const props = defineProps<{
  /**
   * Data-source route slug, e.g. "sqlServer". Resolves card content from
   * setupCard/registry.ts; if the slug isn't registered, the legacy
   * fallbackContent/fallbackDocUrl is shown instead.
   */
  slug: string;
  /** Legacy snippet body, shown when the slug has no registered card. */
  fallbackContent?: string;
  /** Legacy doc link, shown alongside the fallback content. */
  fallbackDocUrl?: string;
}>();

const store = useStore();
const router = useRouter();
const { t, locale } = useI18nTyped();
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
    isPrimaryCloud: isPrimaryCloudWebUrl(store.state.zoConfig?.web_url),
  };
});

const content = computed(() => getDataSourceCard(props.slug, subs.value, t));

const passcodeForbidden = computed(
  () => !!store.state.organizationData?.organizationPasscodeForbidden,
);

// Detection is forwarded so an embedding page (Hosts empty state) can react to it.
const emit = defineEmits<{
  (e: "detected", count: number): void;
}>();

// Host Metrics auto-import (design 4.2) — host-agent slugs only, so the AWS EC2 embed comes free.
const isHostAgentSlug = computed(() => HOST_AGENT_SLUGS.has(props.slug));
const importedDashboard = ref<{ org: string; id: string; folderId: string } | null>(null);

// Companion dashboard (e.g. NVIDIA GPU) — same auto-import-on-detect, never-overwrite contract.
const setupDashboard = computed(() => SETUP_DASHBOARD_BY_SLUG[props.slug]);
// Keyed by org so a cached id is never opened under a different org.
const importedSetupDashboard = ref<{ org: string; id: string; folderId: string } | null>(null);

const openDashboard = (org: string, target: { id: string; folderId: string }) =>
  router.push({
    path: "/dashboards/view",
    query: { org_identifier: org, dashboard: target.id, folder: target.folderId },
  });

const onSetupDashboardDetected = async () => {
  const dash = setupDashboard.value;
  if (!dash) return;
  const org = store.state.selectedOrganization?.identifier ?? "";
  const result = await importSetupDashboard(org, dash);
  // The user didn't invoke the import, so a failure here stays silent.
  if (result.status === "error") return;
  const target = { org, id: result.dashboardId, folderId: result.folderId };
  importedSetupDashboard.value = target;
  toast({
    variant: "success",
    message: t(
      result.status === "created"
        ? "ingestion.setupCard.setupDashboardImported"
        : "ingestion.setupCard.setupDashboardExists",
      { name: dash.title },
    ),
    timeout: 5000,
    action: {
      label: t("ingestion.setupCard.openDashboard"),
      handler: () => openDashboard(org, target),
    },
  });
};

const onOpenSetupDashboard = async () => {
  const dash = setupDashboard.value;
  if (!dash) return;
  const org = store.state.selectedOrganization?.identifier ?? "";
  let target = importedSetupDashboard.value?.org === org ? importedSetupDashboard.value : null;
  if (!target) {
    const result = await importSetupDashboard(org, dash);
    if (result.status === "error") {
      // User-invoked path: the failure must be visible and name its cause.
      toast({
        variant: "error",
        message: t(
          result.kind === "forbidden"
            ? "ingestion.setupCard.setupDashboardImportForbidden"
            : "ingestion.setupCard.setupDashboardImportFailed",
          { name: dash.title },
        ),
      });
      return;
    }
    target = { org, id: result.dashboardId, folderId: result.folderId };
    importedSetupDashboard.value = target;
  }
  openDashboard(org, target);
};

const readyMadeSourceId = computed(() => READY_MADE_SOURCE_BY_SETUP_SLUG[props.slug]);
// Only Kubernetes re-checks its metrics; the slug is fixed for the card's lifetime.
const readyMadeDetection =
  readyMadeSourceId.value === "kubernetes" ? useReadyMadeDetection() : null;
const readyMadeTarget = ref<{ org: string; id: string; folderId: string } | null>(null);
// The shared start location (nothing matched) is no visit, and embeds mounted without a router get one of their own.
const currentRoute = router?.currentRoute?.value;
const readyMadeVisit: object = currentRoute?.matched?.length ? currentRoute : {};
// Set only when the automatic add created something; it outlives the toast for a user who was looking elsewhere.
const readyMadeNotice = ref<ReadyMadeAutoAddNotice | null>(
  recallReadyMadeNotice(readyMadeVisit, props.slug),
);
const setReadyMadeNotice = (notice: ReadyMadeAutoAddNotice | null) => {
  readyMadeNotice.value = notice;
  storeReadyMadeNotice(readyMadeVisit, props.slug, notice);
};
const visibleReadyMadeNotice = computed(() =>
  readyMadeNotice.value?.org === store.state.selectedOrganization?.identifier
    ? readyMadeNotice.value
    : null,
);

const rememberReadyMade = (org: string, result: ReadyMadeInstallResult) => {
  if (result.status === "error") return null;
  const first = result.dashboards[0];
  readyMadeTarget.value = { org, id: first.dashboardId, folderId: first.folderId };
  return readyMadeTarget.value;
};

// Forced: this read gates a write, and an answer given in another tab is not in this tab's cache.
const isReadyMadeUnanswered = async (org: string, userId: string, sourceId: ReadyMadeSourceId) => {
  if (!org || !userId) return false;
  const memory = await readReadyMadeSettings(org, userId, { force: true }).catch(() => null);
  return !!memory && !memory.sources[sourceId];
};

const onReadyMadeDetected = async () => {
  const sourceId = readyMadeSourceId.value;
  if (!sourceId) return;
  const org = store.state.selectedOrganization?.identifier ?? "";
  const userId = store.state.userInfo?.email ?? "";
  // Detection fires on page open with no click, so an earlier answer or an unreadable memory keeps this silent.
  if (!(await isReadyMadeUnanswered(org, userId, sourceId))) return;
  // Kubernetes Test passes on logs alone; without the metrics its Cluster dashboard would open empty.
  if (sourceId === "kubernetes") {
    const detected = await readyMadeDetection?.detect({ force: true }).catch(() => null);
    if (!detected?.includes("kubernetes")) return;
  }
  const result = await installReadyMade(org, sourceId, { userId });
  // The user didn't invoke the install, so a failure here stays silent.
  const target = rememberReadyMade(org, result);
  if (!target || result.status === "error") return;
  toast({
    variant: "success",
    message: describeReadyMadeInstall(result, t, locale.value),
    timeout: 10000,
    action: {
      label: t("dashboard.readyMade.open"),
      handler: () => openDashboard(org, target),
    },
  });
  const created = createdReadyMadeDashboards(result);
  if (created.length === 0) return;
  setReadyMadeNotice({
    org,
    id: created[0].dashboardId,
    folderId: created[0].folderId,
    message: t("ingestion.setupCard.readyMadeAutoAdded", {
      name: getReadyMadeSource(sourceId).name,
      list: joinReadyMadeNames(
        created.map((dashboard) => dashboard.title),
        locale.value,
      ),
      folder: created[0].folderName,
    }),
  });
};

const openReadyMadeNotice = () => {
  const notice = visibleReadyMadeNotice.value;
  if (notice) openDashboard(notice.org, notice);
};

const dismissReadyMadeNotice = () => setReadyMadeNotice(null);

const onOpenReadyMade = async () => {
  const sourceId = readyMadeSourceId.value;
  if (!sourceId) return;
  const org = store.state.selectedOrganization?.identifier ?? "";
  let target = readyMadeTarget.value?.org === org ? readyMadeTarget.value : null;
  if (!target) {
    const result = await installReadyMade(org, sourceId, {
      userId: store.state.userInfo?.email,
    });
    if (result.status === "error") {
      // User-invoked path: the failure must be visible and name its cause.
      const count = getReadyMadeSource(sourceId).dashboards.length;
      toast({
        variant: "error",
        message:
          result.kind === "forbidden"
            ? t("dashboard.readyMade.forbidden")
            : t(
                "ingestion.setupCard.readyMadeFailed",
                { name: getReadyMadeSource(sourceId).name },
                count,
              ),
      });
      return;
    }
    if (result.status === "created") analytics.track("dashboard_created");
    // The button reads "Open", so a dashboard it had to add back into an existing set is named out loud.
    if (result.status !== "exists" && isReadyMadeGapFill(result)) {
      toast({ variant: "success", message: describeReadyMadeInstall(result, t, locale.value) });
    }
    target = rememberReadyMade(org, result);
  }
  if (target) openDashboard(org, target);
};

const onDetected = async (count: number) => {
  emit("detected", count);
  if (readyMadeSourceId.value) return onReadyMadeDetected();
  if (setupDashboard.value) return onSetupDashboardDetected();
  if (!isHostAgentSlug.value) return;
  // Captured at detect time — an org switch before the toast click must not retarget.
  const org = store.state.selectedOrganization?.identifier ?? "";
  const result = await importHostMetricsDashboard(org);
  // The user didn't invoke the import, so a failure here stays silent.
  if (result.status === "error") return;
  importedDashboard.value = { org, id: result.dashboardId, folderId: result.folderId };
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
  if (actionId === "open-setup-dashboard") return onOpenSetupDashboard();
  if (actionId === "open-ready-made-dashboard") return onOpenReadyMade();
  if (actionId !== "view-host-dashboard" || !isHostAgentSlug.value) return;
  const org = store.state.selectedOrganization?.identifier ?? "";
  let target = importedDashboard.value?.org === org ? importedDashboard.value : null;
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
    // Only this user-invoked path counts; the import in onDetected runs on its own.
    if (result.status === "created") analytics.track("dashboard_created");
    target = { org, id: result.dashboardId, folderId: result.folderId };
    importedDashboard.value = target;
  }
  openDashboard(org, target);
};
</script>

<template>
  <!-- Mirrors AIIntegrationDetail's wrapper padding so data-source cards and AI
       integration cards sit identically in their panels. -->
  <div class="p-2">
    <OBanner
      v-if="visibleReadyMadeNotice"
      variant="success"
      dense
      inline-actions
      icon="check-circle"
      class="mb-2"
      data-test="data-source-setup-card-ready-made-added"
      :content="visibleReadyMadeNotice.message"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          data-test="data-source-setup-card-ready-made-added-open"
          @click="openReadyMadeNotice"
        >
          {{ t("dashboard.readyMade.open") }}
        </OButton>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="close"
          :title="t('common.close')"
          data-test="data-source-setup-card-ready-made-added-close"
          @click="dismissReadyMadeNotice"
        />
      </template>
    </OBanner>
    <OBanner
      v-if="passcodeForbidden && content"
      variant="warning"
      data-test="data-source-setup-card-passcode-forbidden"
      :content="t('ingestion.passcodeForbiddenMessage')"
    />
    <SetupCardRenderer
      v-else-if="content"
      :content="content"
      :subs="subs"
      data-test="data-source-setup-card"
      @detected="onDetected"
      @step-action="onStepAction"
    >
      <template v-if="$slots['hero-under-title']" #hero-under-title>
        <slot name="hero-under-title" />
      </template>
    </SetupCardRenderer>
    <template v-else>
      <CredentialCodeBlock v-if="fallbackContent" :slug="slug" :content="fallbackContent" />
      <IngestionDocLink v-if="fallbackDocUrl" :href="fallbackDocUrl" />
    </template>
  </div>
</template>
