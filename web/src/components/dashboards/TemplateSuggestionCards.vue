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
  TemplateSuggestionCards — the Dashboards empty-state template row
  (design 4.3). Renders the BUNDLED Host Metrics card with zero network; the
  S3 gallery row loads lazily on the explicit "Browse all templates" gesture.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import dashboardsService from "@/services/dashboards";
import dashboardJson from "@/assets/dashboards/host_metrics.dashboard.json";
import { importHostMetricsDashboard } from "@/composables/useHostMetricsDashboard";
import { useWorkloadDetection } from "@/composables/useWorkloadDetection";
import {
  useDashboardGallery,
  getCategoryInfo,
  CATEGORY_ORDER,
  type GalleryDashboard,
} from "@/composables/useDashboardGallery";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

const props = defineProps<{
  activeFolderId: string;
  filterQuery: string;
}>();

const emit = defineEmits<{
  (e: "open-drawer"): void;
  (e: "imported"): void;
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();

const detection = useWorkloadDetection();
const gallery = useDashboardGallery();

// Only the true "new org" moment — folder-scoped/filtered empty states keep
// their existing presets untouched.
const visible = computed(() => props.activeFolderId === "default" && !props.filterQuery);

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const hostsDetected = computed(() => detection.states.value.hosts === "detected");

const GALLERY_CARD_LIMIT = 6;
const galleryOpened = ref(false);

const cardBadged = (dashboard: GalleryDashboard) =>
  getCategoryInfo(dashboard).category === "kubernetes" &&
  detection.states.value.kubernetes === "detected";

// Badged first, then by category rank, then alphabetically; top N only.
const galleryCards = computed(() => {
  if (!galleryOpened.value) return [];
  const rank = (d: GalleryDashboard) => {
    const idx = CATEGORY_ORDER.indexOf(getCategoryInfo(d).category);
    return idx === -1 ? CATEGORY_ORDER.length : idx;
  };
  return [...gallery.dashboards.value]
    .sort((a, b) => {
      const badge = Number(cardBadged(b)) - Number(cardBadged(a));
      if (badge !== 0) return badge;
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return a.displayName.localeCompare(b.displayName);
    })
    .slice(0, GALLERY_CARD_LIMIT);
});

// S3 is never hit on render — only this explicit gesture loads the gallery.
const browseAll = async () => {
  galleryOpened.value = true;
  await gallery.loadDashboards();
  emit("open-drawer");
};

// ── Host Metrics card — bundled JSON, works offline ─────────────────────────
const importing = ref(false);
const replaceTarget = ref<{ dashboardId: string } | null>(null);

const goToDashboard = (dashboardId: string) => {
  router.push({
    path: "/dashboards/view",
    query: { org_identifier: orgId.value, dashboard: dashboardId, folder: "default" },
  });
};

const onHostMetricsClick = async () => {
  if (importing.value) return;
  importing.value = true;
  try {
    const result = await importHostMetricsDashboard(orgId.value);
    if (result.status === "error") {
      toast({
        variant: "error",
        message: t(
          result.kind === "forbidden"
            ? "ingestion.setupCard.hostDashboardImportForbidden"
            : "ingestion.setupCard.hostDashboardImportFailed",
        ),
      });
    } else if (result.status === "created") {
      emit("imported");
      goToDashboard(result.dashboardId);
    } else {
      // The in-product upgrade path off the old buggy 13-panel import —
      // replace only ever happens behind this explicit confirm.
      replaceTarget.value = { dashboardId: result.dashboardId };
    }
  } finally {
    importing.value = false;
  }
};

const confirmReplace = async () => {
  const target = replaceTarget.value;
  if (!target) return;
  replaceTarget.value = null;
  try {
    await dashboardsService.delete(orgId.value, target.dashboardId, "default");
    // The AWS-tile mechanics: let the delete settle before re-creating.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const created = await dashboardsService.create(orgId.value, dashboardJson, "default");
    const dashboardId = created.data?.[`v${created.data?.version}`]?.dashboardId ?? "";
    emit("imported");
    goToDashboard(dashboardId);
  } catch {
    toast({
      variant: "error",
      message: t("ingestion.setupCard.hostDashboardImportFailed"),
    });
  }
};

const declineReplace = () => {
  const target = replaceTarget.value;
  replaceTarget.value = null;
  if (target) goToDashboard(target.dashboardId);
};

onMounted(() => {
  detection.refresh();
});
</script>

<template>
  <div v-if="visible" class="flex flex-col gap-2 pt-4" data-test="template-suggestion-cards">
    <div class="flex items-center justify-between gap-2">
      <OText variant="label" class="font-semibold">{{ t("dashboard.templates.heading") }}</OText>
      <OButton variant="ghost-primary" size="xs" data-test="template-browse-all" @click="browseAll">
        {{ t("dashboard.templates.browseAll") }}
      </OButton>
    </div>

    <div class="grid grid-cols-2 content-start gap-1.5">
      <!-- Bundled card — always renderable, zero network, works pre-ingest. -->
      <div
        role="button"
        tabindex="0"
        class="border-border-default bg-surface-base hover:border-accent rounded-default flex min-w-0 cursor-pointer items-center gap-3 border px-3 py-2.5 transition-colors select-none"
        data-test="template-card-hostmetrics"
        @click="onHostMetricsClick"
        @keydown.enter.prevent="onHostMetricsClick"
      >
        <OTag variant="success-soft" icon="monitor-heart" size="sm" />
        <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">
          {{ raw("Host Metrics") }}
        </span>
        <OTag
          v-if="hostsDetected"
          variant="primary-soft"
          size="xs"
          data-test="template-card-badge-hostmetrics"
          >{{ t("dashboard.templates.detectedBadge") }}</OTag
        >
      </div>

      <div
        v-for="dashboard in galleryCards"
        :key="dashboard.name"
        role="button"
        tabindex="0"
        class="border-border-default bg-surface-base hover:border-accent rounded-default flex min-w-0 cursor-pointer items-center gap-3 border px-3 py-2.5 transition-colors select-none"
        :data-test="`template-card-${dashboard.name}`"
        @click="emit('open-drawer')"
        @keydown.enter.prevent="emit('open-drawer')"
      >
        <OTag
          :variant="getCategoryInfo(dashboard).variant"
          :icon="getCategoryInfo(dashboard).icon"
          size="sm"
        />
        <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">
          {{ raw(dashboard.displayName) }}
        </span>
        <OTag
          v-if="cardBadged(dashboard)"
          variant="primary-soft"
          size="xs"
          :data-test="`template-card-badge-${dashboard.name}`"
          >{{ t("dashboard.templates.detectedBadge") }}</OTag
        >
      </div>
    </div>

    <ODialog
      v-if="replaceTarget"
      :open="true"
      persistent
      size="sm"
      :title="t('dashboard.templates.replaceTitle')"
      data-test="template-replace-confirm"
      @update:open="(open: boolean) => !open && declineReplace()"
    >
      <OText>{{ t("dashboard.templates.replaceMessage") }}</OText>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="template-replace-confirm-cancel"
            @click="declineReplace"
          >
            {{ t("dashboard.templates.replaceCancel") }}
          </OButton>
          <OButton
            variant="destructive"
            size="sm-action"
            data-test="template-replace-confirm-ok"
            @click="confirmReplace"
          >
            {{ t("dashboard.templates.replaceConfirm") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </div>
</template>
