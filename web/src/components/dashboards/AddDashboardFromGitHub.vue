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
    title="Dashboard Gallery"
    secondary-button-label="Cancel"
    :primary-button-label="selectedDashboards.length ? `Add ${selectedDashboards.length} dashboard${selectedDashboards.length > 1 ? 's' : ''}` : 'Select dashboards'"
    :primary-button-disabled="selectedDashboards.length === 0"
    @click:secondary="show = false"
    @click:primary="handleNext"
  >
    <!-- Loading -->
    <div v-if="loading" class="gallery-empty">
      <OSpinner size="lg" />
      <span class="gallery-empty-label">Loading gallery…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="gallery-empty">
      <OIcon name="error-outline" class="gallery-empty-icon" style="color: var(--o2-negative)" />
      <span class="gallery-empty-label">{{ error }}</span>
      <OButton variant="primary" size="sm" @click="loadDashboards">Retry</OButton>
    </div>

    <!-- Gallery -->
    <div v-else class="gallery-wrap">
      <!-- Toolbar -->
      <div class="gallery-toolbar">
        <OSearchInput
          v-model="searchQuery"
          placeholder="Search dashboards…"
          clearable
          data-test="add-dashboard-github-search"
          class="gallery-search"
        />
        <div class="gallery-meta">
          <span v-if="selectedDashboards.length" class="gallery-sel-badge">
            {{ selectedDashboards.length }} selected
          </span>
          <span class="gallery-count">{{ filteredDashboards.length }} available</span>
        </div>
      </div>

      <!-- Empty search -->
      <div v-if="!filteredDashboards.length" class="gallery-empty">
        <OIcon name="search" style="width:36px;height:36px;opacity:0.3" />
        <span style="font-size:13px;color:#878da3">No dashboards match "{{ searchQuery }}"</span>
      </div>

      <!-- Grouped sections -->
      <div v-else class="gallery-sections">
        <div
          v-for="([category, items]) in groupedDashboards"
          :key="category"
          class="gallery-group"
        >
          <!-- Group header -->
          <div class="gallery-group-head">
            <div
              class="gallery-group-ico"
              :style="{ background: getCategoryInfo(items[0]).bg }"
            >
              <OIcon
                :name="getCategoryInfo(items[0]).icon"
                :style="{ color: getCategoryInfo(items[0]).color }"
                style="width:15px;height:15px"
              />
            </div>
            <span class="gallery-group-title">{{ category }}</span>
            <span class="gallery-group-count">{{ items.length }}</span>
          </div>

          <!-- 2-column card grid for this group -->
          <div class="gallery-grid">
            <div
              v-for="dashboard in items"
              :key="dashboard.name"
              class="g-card"
              :class="{ 'g-card--on': isSelected(dashboard) }"
              data-test="add-dashboard-github-item"
              @click="toggleDashboard(dashboard)"
            >
              <div class="g-card-text">
                <div class="g-card-name">{{ dashboard.displayName }}</div>
              </div>
              <div class="g-card-chk" :class="{ 'g-card-chk--on': isSelected(dashboard) }">
                <OIcon v-if="isSelected(dashboard)" name="check" style="width:11px;height:11px;color:#fff" />
              </div>
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
  components: { AddFolder, OButton, ODialog, ODrawer, OSearchInput, OSelect, OCheckbox, OSpinner,
    OIcon,
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
    const showAddFolderDialog = ref(false);
    const addFolderRef = ref<InstanceType<typeof AddFolder> | null>(null);
    const isAddingFolder = ref(false);

    const handleAddFolder = async () => {
      if (!addFolderRef.value || isAddingFolder.value) return;
      isAddingFolder.value = true;
      try {
        await addFolderRef.value.submit();
      } finally {
        isAddingFolder.value = false;
      }
    };

    const filteredDashboards = computed(() => {
      if (!searchQuery.value) return dashboards.value;
      const query = searchQuery.value.toLowerCase();
      return dashboards.value.filter(
        (d) =>
          d.displayName.toLowerCase().includes(query) ||
          d.description?.toLowerCase().includes(query),
      );
    });

    // Group filtered dashboards by category for the gallery view
    const CATEGORY_ORDER = ["Cloud", "Kubernetes", "Database", "Networking", "Observability", "Security", "Storage", "Dashboard"];
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
      const index = selectedDashboards.value.findIndex(
        (d) => d.name === dashboard.name,
      );
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
      return prefixes.map((el) => {
        const full = el.textContent || "";
        return full.replace(S3_PREFIX, "").replace(/\/$/, "");
      }).filter(Boolean);
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
        const response = await fetch(
          `${S3_BASE}/?list-type=2&prefix=${S3_PREFIX}&delimiter=/`,
        );
        if (!response.ok)
          throw new Error(t("dashboard.addDashboardFromGitHub.fetchDashboardsError"));

        const xmlText = await response.text();
        const folderNames = parseS3Folders(xmlText).filter(
          (name) => !name.startsWith("."),
        );

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
        if (!selectedFolderObj.value || !folderOptions.value.some((o) => o.value === selectedFolderObj.value)) {
          selectedFolderObj.value = sorted.find((f: any) => f.folderId === 'default')?.folderId ?? sorted[0]?.folderId ?? null;
        }
      } catch (err) {
        console.error("Error loading folders:", err);
      }
    };

    const handleNext = async () => {
      if (selectedDashboards.value.length === 0) return;

      loading.value = true;
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
              console.error(
                `Failed to fetch JSON files for ${dashboard.name}:`,
                err,
              );
            }
          }
        }

        await loadFolders();
        showFolderSelection.value = true;
      } finally {
        loading.value = false;
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
      if (selectedDashboards.value.length === 0 || !selectedFolderObj.value)
        return;

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
              const jsonCache =
                store.state.githubDashboardGallery.dashboardJsonCache;
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

              const dashboardTitle =
                dashboardJson.title || jsonFile.replace(".json", "");

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

              const existingDashboard =
                dashboardsResponse.data?.dashboards?.find(
                  (d: any) => d.title === dashboardTitle,
                );

              if (existingDashboard) {
                // Delete existing dashboard before importing
                const existingDashboardId =
                  existingDashboard?.dashboardId ||
                  existingDashboard?.dashboard_id ||
                  existingDashboard?.id;
                if (existingDashboardId) {
                  await dashboardsService.delete(
                    orgId,
                    existingDashboardId,
                    folderId,
                  );
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
              error:
                errors[0] ||
                t("dashboard.addDashboardFromGitHub.unknownError"),
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
      showAddFolderDialog,
      addFolderRef,
      isAddingFolder,
      handleAddFolder,
      isSelected,
      toggleDashboard,
      loadDashboards,
      handleNext,
      confirmAdd,
      updateFolderList,
      getCategoryInfo,
      groupedDashboards,
    };
  },
});

function getCategoryInfo(dashboard: { name: string }) {
  const n = dashboard.name.toLowerCase();
  if (n.includes("aws") || n.includes("amazon") || n.includes("ec2") || n.includes("s3") || n.includes("rds") || n.includes("elb") || n.includes("lambda"))
    return { icon: "cloud",         color: "#e07b00", bg: "#fff4e6", category: "AWS" };
  if (n.includes("cloudwatch"))
    return { icon: "cloud",         color: "#e07b00", bg: "#fff4e6", category: "CloudWatch" };
  if (n.includes("gcp") || n.includes("google") || n.includes("bigquery") || n.includes("pubsub"))
    return { icon: "cloud",         color: "#1a73e8", bg: "#e8f0fe", category: "Google Cloud" };
  if (n.includes("azure") || n.includes("microsoft"))
    return { icon: "cloud",         color: "#0078d4", bg: "#e3f2fd", category: "Azure" };
  if (n.includes("kubernetes") || n.includes("k8s") || n.includes("kube") || n.includes("pod") || n.includes("helm") || n.includes("container") || n.includes("docker"))
    return { icon: "hub",           color: "#326ce5", bg: "#e8eefb", category: "Kubernetes" };
  if (n.includes("postgres") || n.includes("mysql") || n.includes("mongo") || n.includes("redis") || n.includes("elastic") || n.includes("cassandra") || n.includes("database") || n.includes("db"))
    return { icon: "database",      color: "#6b48ff", bg: "#f0eeff", category: "Database" };
  if (n.includes("nginx") || n.includes("apache") || n.includes("haproxy") || n.includes("istio") || n.includes("envoy") || n.includes("traefik"))
    return { icon: "dns",           color: "#009639", bg: "#e6f5ec", category: "Networking" };
  if (n.includes("security") || n.includes("audit") || n.includes("threat") || n.includes("waf") || n.includes("firewall"))
    return { icon: "shield",        color: "#e5484d", bg: "#fff0f0", category: "Security" };
  if (n.includes("monitor") || n.includes("alert") || n.includes("metric") || n.includes("prometheus") || n.includes("opentelemetry") || n.includes("otel"))
    return { icon: "monitor-heart", color: "#30a46c", bg: "#e6f7ef", category: "Observability" };
  if (n.includes("storage") || n.includes("disk") || n.includes("s3") || n.includes("blob"))
    return { icon: "storage",       color: "#6b48ff", bg: "#f0eeff", category: "Storage" };
  return   { icon: "dashboard",     color: "#6d5ce0", bg: "#f0eeff", category: "Dashboard" };
}
</script>

<style>
/* ── wrapper ── */
.gallery-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  height: 100%;
  overflow: hidden;
}

/* ── toolbar ── */
.gallery-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.gallery-search { flex: 1; }
.gallery-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}
.gallery-count { font-size: 12px; color: #878da3; }
.gallery-sel-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 20px;
  background: #6d5ce0;
  color: #fff;
}

/* ── empty ── */
.gallery-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 40px 20px;
}

/* ── scrollable sections container ── */
.gallery-sections {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-right: 2px;
  padding-bottom: 8px;
}

/* ── category group ── */
.gallery-group { display: flex; flex-direction: column; gap: 8px; }

.gallery-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e6e8ef;
}
.gallery-group-ico {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gallery-group-title {
  font-size: 12.5px;
  font-weight: 700;
  color: #1c2030;
  letter-spacing: -0.1px;
}
.gallery-group-count {
  font-size: 11px;
  font-weight: 600;
  color: #878da3;
  background: #eeeef5;
  border-radius: 20px;
  padding: 1px 7px;
}

/* ── 2-column card grid ── */
.gallery-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-content: start;
}

/* ── individual card ── */
.g-card {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border: 1.5px solid #e6e8ef;
  border-radius: 10px;
  cursor: pointer;
  background: #fff;
  transition: border-color 0.13s, box-shadow 0.13s;
  user-select: none;
  min-width: 0;
}
.g-card:hover {
  border-color: #6d5ce0;
  box-shadow: 0 2px 10px rgba(109, 92, 224, 0.1);
}
.g-card--on {
  border-color: #6d5ce0;
  box-shadow: 0 0 0 2.5px rgba(109, 92, 224, 0.2);
  background: #faf9ff;
}

/* ── text block ── */
.g-card-text { flex: 1; min-width: 0; }
.g-card-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #1c2030;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

/* ── checkmark circle ── */
.g-card-chk {
  width: 19px;
  height: 19px;
  border-radius: 50%;
  border: 1.5px solid #d0d4e0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s;
}
.g-card-chk--on { background: #6d5ce0; border-color: #6d5ce0; }

/* ── dark mode ── */
body.body--dark .gallery-group-head      { border-bottom-color: #232a37; }
body.body--dark .gallery-group-title     { color: #e7eaf3; }
body.body--dark .gallery-group-count     { color: #6f7891; background: #1e2430; }
body.body--dark .gallery-group-ico       { filter: brightness(0.45) saturate(1.4); }
body.body--dark .g-card                  { background: #151a23; border-color: #232a37; }
body.body--dark .g-card:hover            { border-color: #8b90e6; box-shadow: 0 2px 10px rgba(139,144,230,0.12); }
body.body--dark .g-card--on             { background: #1a1d2e; border-color: #8b90e6; box-shadow: 0 0 0 2.5px rgba(139,144,230,0.2); }
body.body--dark .g-card-name             { color: #e7eaf3; }
body.body--dark .g-card-chk              { border-color: #3a4255; }
body.body--dark .gallery-count           { color: #6f7891; }
</style>
