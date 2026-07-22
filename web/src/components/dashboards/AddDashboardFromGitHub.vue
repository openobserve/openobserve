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
  <ODrawer
    data-test="add-dashboard-from-github-drawer"
    v-model:open="show"
    side="right"
    size="xl"
    :title="t('dashboard.addDashboardFromGitHub.title')"
    :secondary-button-label="t('dashboard.addDashboardFromGitHub.cancel')"
    :primary-button-label="primaryButtonLabel"
    :primary-button-disabled="selectedDashboards.length === 0"
    :primary-button-loading="preparing"
    bleed
    @click:secondary="show = false"
    @click:primary="handleNext"
  >
    <!-- Loading -->
    <div
      v-if="loading"
      class="flex flex-col items-center justify-center gap-3 min-h-80 px-page-edge"
    >
      <OSpinner size="lg" />
      <OText variant="meta">{{ t("dashboard.addDashboardFromGitHub.loading") }}</OText>
    </div>

    <!-- Error -->
    <OEmptyState
      v-else-if="error"
      preset="load-error"
      size="hero"
      :description="error"
      :action-label="t('dashboard.addDashboardFromGitHub.retry')"
      @action="loadDashboards"
    />

    <!-- Gallery. The drawer body is `bleed` (no padding) so the sticky toolbar
         can pin flush at the very top of the drawer's own scroll — with the
         default body inset it pinned below the padding and cards peeked into
         that strip. We re-add the horizontal inset (px-page-edge) ourselves. -->
    <div v-else class="flex flex-col">
      <!-- Toolbar — sticks flush to the top; its opaque bg covers cards that
           scroll underneath. Keeps the drawer's own scroll shadow. -->
      <div class="sticky top-0 z-20 flex flex-col gap-2 bg-dialog-bg px-page-edge pt-3 pb-2">
        <OSearchInput
          v-model="searchQuery"
          :placeholder="t('dashboard.addDashboardFromGitHub.searchPlaceholder')"
          clearable
          data-test="add-dashboard-github-search"
          class="w-full"
        />
        <!-- Fixed-height meta row: 'available' pinned right, 'selected' badge
             appears to its left so neither the search nor the count ever shifts. -->
        <div class="flex items-center justify-end gap-2 min-h-6 whitespace-nowrap">
          <OTag v-if="selectedDashboards.length" variant="primary-soft" size="xs">
            {{
              t("dashboard.addDashboardFromGitHub.selectedCount", {
                count: selectedDashboards.length,
              })
            }}
          </OTag>
          <OText variant="meta">{{
            t("dashboard.addDashboardFromGitHub.dashboardsAvailable", {
              count: filteredDashboards.length,
            })
          }}</OText>
        </div>
      </div>

      <!-- Empty search -->
      <OEmptyState
        v-if="!filteredDashboards.length"
        preset="no-search-results"
        size="hero"
        filtered
        class="px-page-edge"
        @action="searchQuery = ''"
      />

      <!-- Grouped sections -->
      <div v-else class="flex flex-col gap-6 px-page-edge pb-3">
        <div
          v-for="[category, items] in groupedDashboards"
          :key="category"
          class="flex flex-col gap-2"
        >
          <!-- Group header — sticks just below the toolbar while its category
               scrolls (top ≈ toolbar height 5.375rem, tucked slightly under). -->
          <div
            class="sticky top-21 z-10 flex items-center gap-2 pt-0.5 pb-1.5 bg-dialog-bg border-b border-border-default"
          >
            <OTag
              :variant="getCategoryInfo(items[0]).variant"
              :icon="getCategoryInfo(items[0]).icon"
              size="sm"
            />
            <OText variant="label" class="font-semibold">{{ categoryLabel(category) }}</OText>
            <OTag variant="default-soft" size="xs">{{ items.length }}</OTag>
          </div>

          <!-- 2-column card grid for this group -->
          <div class="grid grid-cols-2 gap-1.5 content-start">
            <div
              v-for="dashboard in items"
              :key="dashboard.name"
              role="button"
              tabindex="0"
              :aria-pressed="isSelected(dashboard)"
              class="flex items-center gap-3 px-3 py-2.5 rounded-default border select-none min-w-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :class="
                isSelected(dashboard)
                  ? 'border-accent bg-surface-accent-hover'
                  : 'border-border-default bg-surface-base hover:border-accent'
              "
              data-test="add-dashboard-github-item"
              @click="toggleDashboard(dashboard)"
              @keydown.enter.prevent="toggleDashboard(dashboard)"
              @keydown.space.prevent="toggleDashboard(dashboard)"
            >
              <span class="flex-1 min-w-0 truncate text-sm font-medium text-text-heading">{{
                dashboard.displayName
              }}</span>
              <OCheckbox
                :model-value="isSelected(dashboard)"
                size="sm"
                class="shrink-0 pointer-events-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Folder Selection Dialog -->
    <ODialog
      data-test="add-dashboard-from-github-folder-selection-dialog"
      v-model:open="showFolderSelection"
      persistent
      size="sm"
      :title="t('dashboard.addDashboardFromGitHub.selectFolderTitle')"
      :secondary-button-label="t('dashboard.addDashboardFromGitHub.back')"
      :primary-button-label="t('dashboard.addDashboardFromGitHub.addDashboard')"
      :primary-button-disabled="!selectedFolderObj"
      :primary-button-loading="importing"
      @click:secondary="showFolderSelection = false"
      @click:primary="confirmAdd"
    >
      <div class="flex items-end gap-2">
        <OSelect
          v-model="selectedFolderObj"
          :options="folderOptions"
          :label="t('dashboard.addDashboardFromGitHub.folder')"
          class="grow"
          data-test="add-dashboard-github-folder-select"
        />
        <div class="w-10 mb-0.5">
          <OButton
            variant="outline"
            size="icon-xs"
            icon-left="add"
            @click="showAddFolderDialog = true"
            data-test="add-dashboard-github-add-folder"
            :title="t('dashboard.addDashboardFromGitHub.addNewFolder')"
          />
        </div>
      </div>
    </ODialog>

    <!-- Add Folder Dialog -->
    <ODialog
      v-model:open="showAddFolderDialog"
      size="sm"
      :title="t('dashboard.addDashboardFromGitHub.addNewFolder')"
      :primary-button-label="t('dashboard.addDashboardFromGitHub.save')"
      :secondary-button-label="t('dashboard.addDashboardFromGitHub.cancel')"
      form-id="add-folder-dashboards-form"
      @click:secondary="showAddFolderDialog = false"
      data-test="add-dashboard-github-add-folder-dialog"
    >
      <AddFolder
        ref="addFolderRef"
        @update:modelValue="updateFolderList"
        @close="showAddFolderDialog = false"
        :edit-mode="false"
      />
    </ODialog>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import dashboardsService from "@/services/dashboards";
import AddFolder from "@/components/dashboards/AddFolder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

interface GitHubDashboard {
  name: string;
  displayName: string;
  description?: string;
  folderPath: string;
  jsonFiles: string[];
}

export default defineComponent({
  name: "AddDashboardFromGitHub",
  components: {
    AddFolder,
    OButton,
    OText,
    OTag,
    OEmptyState,
    ODialog,
    ODrawer,
    OSearchInput,
    OSelect,
    OCheckbox,
    OSpinner,
  },
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
  },
  emits: ["update:modelValue", "added"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();

    const show = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    const loading = ref(false);
    const error = ref("");
    const dashboards = ref<GitHubDashboard[]>([]);
    const searchQuery = ref("");
    const selectedDashboards = ref<GitHubDashboard[]>([]);
    const showFolderSelection = ref(false);
    const selectedFolderObj = ref<string | null>(null);
    const folderOptions = ref<{ label: string; value: string }[]>([]);
    const importing = ref(false);
    const preparing = ref(false);
    const showAddFolderDialog = ref(false);
    // The Add Folder dialog submits natively via form-id="add-folder-dashboards-form";
    // this ref only anchors the child instance.
    const addFolderRef = ref<InstanceType<typeof AddFolder> | null>(null);

    const filteredDashboards = computed(() => {
      if (!searchQuery.value) return dashboards.value;
      const query = searchQuery.value.toLowerCase();
      return dashboards.value.filter(
        (d) =>
          d.displayName.toLowerCase().includes(query) ||
          d.description?.toLowerCase().includes(query),
      );
    });

    // Primary button reflects the current selection count.
    const primaryButtonLabel = computed(() =>
      selectedDashboards.value.length
        ? t("dashboard.addDashboardFromGitHub.addCount", {
            count: selectedDashboards.value.length,
          })
        : t("dashboard.addDashboardFromGitHub.selectPrompt"),
    );

    // Translated display label for a category key.
    const categoryLabel = (category: string) =>
      t(`dashboard.addDashboardFromGitHub.category.${category}`);

    // Group filtered dashboards by category for the gallery view
    const CATEGORY_ORDER = [
      "aws",
      "cloudwatch",
      "googleCloud",
      "azure",
      "kubernetes",
      "database",
      "networking",
      "observability",
      "security",
      "storage",
      "dashboard",
    ];
    const groupedDashboards = computed(() => {
      const groups: Record<string, GitHubDashboard[]> = {};
      for (const d of filteredDashboards.value) {
        const cat = getCategoryInfo(d).category;
        (groups[cat] = groups[cat] || []).push(d);
      }
      // Sort groups by preferred order, then alphabetically
      return Object.entries(groups).sort(([a], [b]) => {
        const ai = CATEGORY_ORDER.indexOf(a);
        const bi = CATEGORY_ORDER.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      });
    });

    const isSelected = (dashboard: GitHubDashboard) => {
      return selectedDashboards.value.some((d) => d.name === dashboard.name);
    };

    const toggleDashboard = (dashboard: GitHubDashboard) => {
      const index = selectedDashboards.value.findIndex((d) => d.name === dashboard.name);
      if (index > -1) {
        selectedDashboards.value.splice(index, 1);
      } else {
        selectedDashboards.value.push(dashboard);
      }
    };

    const S3_BASE = "https://openobserve-datasources-bucket.s3.amazonaws.com";
    const S3_PREFIX = "dashboards/";

    const parseS3Folders = (xmlText: string): string[] => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, "application/xml");
      const prefixes = Array.from(doc.querySelectorAll("CommonPrefixes Prefix"));
      return prefixes
        .map((el) => {
          const full = el.textContent || "";
          return full.replace(S3_PREFIX, "").replace(/\/$/, "");
        })
        .filter(Boolean);
    };

    const parseS3Files = (xmlText: string, folderPath: string): string[] => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, "application/xml");
      const keys = Array.from(doc.querySelectorAll("Contents Key"));
      const prefix = `${S3_PREFIX}${folderPath}/`;
      return keys
        .map((el) => (el.textContent || "").replace(prefix, ""))
        .filter((name) => name.endsWith(".json") && !name.includes("/"));
    };

    const loadDashboards = async () => {
      loading.value = true;
      error.value = "";
      try {
        // Check if we have cached data that's still valid
        const cache = store.state.githubDashboardGallery;
        const now = Date.now();
        const cacheAge = cache.lastFetched ? now - cache.lastFetched : Infinity;

        if (cache.dashboards.length > 0 && cacheAge < cache.cacheExpiry) {
          dashboards.value = cache.dashboards;
          loading.value = false;
          return;
        }

        // Fetch folder list from S3 using List Objects v2 API (requires s3:ListBucket)
        const response = await fetch(`${S3_BASE}/?list-type=2&prefix=${S3_PREFIX}&delimiter=/`);
        if (!response.ok)
          throw new Error(t("dashboard.addDashboardFromGitHub.fetchDashboardsError"));

        const xmlText = await response.text();
        const folderNames = parseS3Folders(xmlText).filter((name) => !name.startsWith("."));

        const dashboardList = folderNames
          .map((name) => ({
            name,
            displayName: name.replace(/_/g, " "),
            folderPath: name,
            jsonFiles: [],
          }))
          .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

        store.commit("setGithubDashboardGallery", dashboardList);
        dashboards.value = dashboardList;
      } catch (err) {
        error.value =
          err instanceof Error
            ? err.message
            : t("dashboard.addDashboardFromGitHub.loadGalleryError");
      } finally {
        loading.value = false;
      }
    };

    const loadFolders = async () => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const response = await dashboardsService.list_Folders(orgId);
        let folders: any[] = response.data?.list || [];

        // Ensure default folder is always present and pinned at top (same as getFoldersList in commons.ts)
        let defaultFolder = folders.find((f: any) => f.folderId === "default");
        folders = folders.filter((f: any) => f.folderId !== "default");

        if (!defaultFolder) {
          defaultFolder = {
            name: "default",
            folderId: "default",
            description: "default",
          };
        }

        const sorted = [
          defaultFolder,
          ...folders.sort((a: any, b: any) => a.name.localeCompare(b.name)),
        ];

        folderOptions.value = sorted.map((f: any) => ({
          label: f.name,
          value: f.folderId,
        }));

        // Auto-select the default folder; preserve existing selection if still valid
        if (
          !selectedFolderObj.value ||
          !folderOptions.value.some((o) => o.value === selectedFolderObj.value)
        ) {
          selectedFolderObj.value =
            sorted.find((f: any) => f.folderId === "default")?.folderId ??
            sorted[0]?.folderId ??
            null;
        }
      } catch (err) {
        console.error("Error loading folders:", err);
      }
    };

    const handleNext = async () => {
      if (selectedDashboards.value.length === 0) return;

      // Keep the gallery visible and show the spinner on the primary button
      // while we fetch each selection's JSON files, then open the folder dialog.
      preparing.value = true;
      try {
        // Fetch JSON files for selected dashboards if not already loaded
        for (const dashboard of selectedDashboards.value) {
          if (dashboard.jsonFiles.length === 0) {
            try {
              const folderContents = await fetch(
                `${S3_BASE}/?list-type=2&prefix=${S3_PREFIX}${dashboard.folderPath}/&delimiter=/`,
              );
              if (folderContents.ok) {
                const xmlText = await folderContents.text();
                dashboard.jsonFiles = parseS3Files(xmlText, dashboard.folderPath);

                // Update the cache with the fetched JSON files
                const cache = store.state.githubDashboardGallery;
                const cachedDashboard = cache.dashboards.find(
                  (d: any) => d.name === dashboard.name,
                );
                if (cachedDashboard) {
                  cachedDashboard.jsonFiles = dashboard.jsonFiles;
                  store.commit("setGithubDashboardGallery", cache.dashboards);
                }
              }
            } catch (err) {
              console.error(`Failed to fetch JSON files for ${dashboard.name}:`, err);
            }
          }
        }

        await loadFolders();
        showFolderSelection.value = true;
      } finally {
        preparing.value = false;
      }
    };

    const updateFolderList = async (newFolder: any) => {
      showAddFolderDialog.value = false;
      if (newFolder && newFolder.data) {
        // Refresh folder list
        await loadFolders();
        // Auto-select the newly created folder
        selectedFolderObj.value = newFolder.data.folderId;
      }
    };

    const confirmAdd = async () => {
      if (selectedDashboards.value.length === 0 || !selectedFolderObj.value) return;

      importing.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const folderId = selectedFolderObj.value;
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        // Import each selected dashboard and all its JSON files
        for (const dashboard of selectedDashboards.value) {
          for (const jsonFile of dashboard.jsonFiles) {
            try {
              // Check cache first
              const cacheKey = `${dashboard.folderPath}/${jsonFile}`;
              const jsonCache = store.state.githubDashboardGallery.dashboardJsonCache;
              let dashboardJson;

              if (jsonCache[cacheKey]) {
                // Use cached JSON
                dashboardJson = jsonCache[cacheKey];
              } else {
                // Download dashboard JSON from S3
                const rawUrl = `${S3_BASE}/${S3_PREFIX}${dashboard.folderPath}/${jsonFile}`;
                const response = await fetch(rawUrl);
                if (!response.ok) {
                  throw new Error(
                    t("dashboard.addDashboardFromGitHub.fetchFileError", {
                      file: jsonFile,
                      status: response.statusText,
                    }),
                  );
                }
                dashboardJson = await response.json();

                // Cache the JSON for future use
                store.commit("setDashboardJsonCache", {
                  key: cacheKey,
                  json: dashboardJson,
                });
              }

              const dashboardTitle = dashboardJson.title || jsonFile.replace(".json", "");

              // Check if dashboard already exists in the selected folder
              const dashboardsResponse = await dashboardsService.list(
                0,
                1000,
                "name",
                false,
                "",
                orgId,
                folderId,
                "",
              );

              const existingDashboard = dashboardsResponse.data?.dashboards?.find(
                (d: any) => d.title === dashboardTitle,
              );

              if (existingDashboard) {
                // Delete existing dashboard before importing
                const existingDashboardId =
                  existingDashboard?.dashboardId ||
                  existingDashboard?.dashboard_id ||
                  existingDashboard?.id;
                if (existingDashboardId) {
                  await dashboardsService.delete(orgId, existingDashboardId, folderId);
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
              }

              // Import dashboard
              await dashboardsService.create(orgId, dashboardJson, folderId);
              successCount++;
            } catch (err) {
              failCount++;
              errors.push(
                t("dashboard.addDashboardFromGitHub.fileError", {
                  file: jsonFile,
                  error:
                    err instanceof Error
                      ? err.message
                      : t("dashboard.addDashboardFromGitHub.unknownError"),
                }),
              );
              console.error(`Failed to import ${jsonFile}:`, err);
            }
          }
        }

        // Show summary notification
        if (successCount > 0 && failCount === 0) {
          toast({
            variant: "success",
            message: t("dashboard.addDashboardFromGitHub.importSuccess", {
              count: successCount,
            }),
          });
        } else if (successCount > 0 && failCount > 0) {
          toast({
            variant: "warning",
            message: t("dashboard.addDashboardFromGitHub.importPartial", {
              count: successCount,
              failCount,
            }),
            timeout: 5000,
          });
        } else {
          toast({
            variant: "error",
            message: t("dashboard.addDashboardFromGitHub.importFailed", {
              error: errors[0] || t("dashboard.addDashboardFromGitHub.unknownError"),
            }),
            timeout: 5000,
          });
        }

        show.value = false;
        showFolderSelection.value = false;
        emit("added");
      } catch (err) {
        toast({
          variant: "error",
          message: t("dashboard.addDashboardFromGitHub.addFailed", {
            error:
              err instanceof Error
                ? err.message
                : t("dashboard.addDashboardFromGitHub.unknownError"),
          }),
          timeout: 5000,
        });
      } finally {
        importing.value = false;
      }
    };

    // Load dashboards when dialog opens
    watch(show, (newVal) => {
      if (newVal) {
        loadDashboards();
      } else {
        // Reset state when closing
        selectedDashboards.value = [];
        searchQuery.value = "";
        showFolderSelection.value = false;
      }
    });

    return {
      t,
      show,
      loading,
      store,
      error,
      dashboards,
      searchQuery,
      filteredDashboards,
      selectedDashboards,
      showFolderSelection,
      selectedFolderObj,
      folderOptions,
      importing,
      preparing,
      showAddFolderDialog,
      addFolderRef,
      isSelected,
      toggleDashboard,
      loadDashboards,
      handleNext,
      confirmAdd,
      updateFolderList,
      getCategoryInfo,
      groupedDashboards,
      primaryButtonLabel,
      categoryLabel,
    };
  },
});

// Classify a dashboard into a category key, its icon, and a token-backed
// badge variant. Category keys resolve to translated labels via categoryLabel().
function getCategoryInfo(dashboard: { name: string }): {
  icon: string;
  variant: BadgeVariant;
  category: string;
} {
  const n = dashboard.name.toLowerCase();
  if (
    n.includes("aws") ||
    n.includes("amazon") ||
    n.includes("ec2") ||
    n.includes("s3") ||
    n.includes("rds") ||
    n.includes("elb") ||
    n.includes("lambda")
  )
    return { icon: "cloud", variant: "orange-soft", category: "aws" };
  if (n.includes("cloudwatch"))
    return { icon: "cloud", variant: "orange-soft", category: "cloudwatch" };
  if (n.includes("gcp") || n.includes("google") || n.includes("bigquery") || n.includes("pubsub"))
    return { icon: "cloud", variant: "blue-soft", category: "googleCloud" };
  if (n.includes("azure") || n.includes("microsoft"))
    return { icon: "cloud", variant: "cyan-soft", category: "azure" };
  if (
    n.includes("kubernetes") ||
    n.includes("k8s") ||
    n.includes("kube") ||
    n.includes("pod") ||
    n.includes("helm") ||
    n.includes("container") ||
    n.includes("docker")
  )
    return { icon: "hub", variant: "indigo-soft", category: "kubernetes" };
  if (
    n.includes("postgres") ||
    n.includes("mysql") ||
    n.includes("mongo") ||
    n.includes("redis") ||
    n.includes("elastic") ||
    n.includes("cassandra") ||
    n.includes("database") ||
    n.includes("db")
  )
    return { icon: "database", variant: "purple-soft", category: "database" };
  if (
    n.includes("nginx") ||
    n.includes("apache") ||
    n.includes("haproxy") ||
    n.includes("istio") ||
    n.includes("envoy") ||
    n.includes("traefik")
  )
    return { icon: "dns", variant: "teal-soft", category: "networking" };
  if (
    n.includes("security") ||
    n.includes("audit") ||
    n.includes("threat") ||
    n.includes("waf") ||
    n.includes("firewall")
  )
    return { icon: "shield", variant: "error-soft", category: "security" };
  if (
    n.includes("monitor") ||
    n.includes("alert") ||
    n.includes("metric") ||
    n.includes("prometheus") ||
    n.includes("opentelemetry") ||
    n.includes("otel")
  )
    return { icon: "monitor-heart", variant: "success-soft", category: "observability" };
  if (n.includes("storage") || n.includes("disk") || n.includes("blob"))
    return { icon: "storage", variant: "amber-soft", category: "storage" };
  return { icon: "dashboard", variant: "primary-soft", category: "dashboard" };
}
</script>
