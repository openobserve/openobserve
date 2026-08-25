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
  <div class="flex items-center" data-test="dashboard-tab-list-container">
    <OTabs
      class="max-w-[calc(100%_-_2.5rem)]"
      v-model="selectedTabId"
      :align="'left'"
      :reorderable="canManage"
      dense
      mobile-arrows
      @click.stop
      @reorder="onReorder"
      data-test="dashboard-tab-list"
    >
      <OTab
        v-for="tab in tabs"
        :key="tab.tabId"
        :name="tab.tabId"
        :disable-drag="editingTabId === tab.tabId"
        @click.stop
        :data-test="`dashboard-tab-${tab.tabId}`"
      >
        <!-- Display and edit share ONE row. Affordances are Gmail-style quiet:
             the drag grip (OTab) and the rename pencil live in reserved gutters
             that read as padding and only fade in on tab hover — at rest every
             tab is clean text. The name and the input carry the same box
             (px-0.5), the pencil is absolutely positioned (out of flow) in the
             pr-2.5 reserve, and both gutters exist in display AND edit mode, so
             entering/leaving edit never changes the tab's width. -->
        <div class="flex w-full flex-nowrap items-center" :class="canManage ? 'pr-2.5' : ''">
          <!-- Auto-size the input to its text via an invisible sizer sharing the
               input's grid cell, so the field is exactly as wide as the name.
               `size="1"` neutralises the input's default ~20ch intrinsic width so
               the sizer alone drives the max-content column. Keep that track a bare
               `max-content`: a 0 min (`minmax(0,…)`) collapses it to 0px once the
               tab strip overflows. -->
          <span v-if="editingTabId === tab.tabId" class="grid grid-cols-[max-content] items-center">
            <span
              aria-hidden="true"
              class="invisible col-start-1 row-start-1 px-0.5 text-sm whitespace-pre"
              >{{ editingName || " " }}</span
            >
            <input
              ref="renameInputRef"
              v-model="editingName"
              type="text"
              size="1"
              :maxlength="60"
              class="text-tabs-active-text col-start-1 row-start-1 w-full min-w-0 bg-transparent px-0.5 text-sm outline-none"
              :data-test="`dashboard-tab-${tab.tabId}-rename-input`"
              @click.stop
              @mousedown.stop
              @dblclick.stop
              @keydown.stop
              @keydown.enter.prevent="commitRename(tab)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(tab)"
            />
          </span>
          <span
            v-else
            class="min-w-0 flex-1 overflow-hidden px-0.5 text-ellipsis whitespace-nowrap"
            :title="tab?.name"
            :data-test="`dashboard-tab-${tab.tabId}-name`"
            :data-test-tab-name="tab?.name"
            @dblclick="canManage ? startRename(tab) : undefined"
            >{{ tab?.name }}</span
          >
          <!-- Panel-count badge: conveys how dense each tab is without opening it.
               Section headers are layout labels, not panels, so they're excluded. -->
          <OBadge
            variant="default"
            size="xs"
            shape="rounded"
            class="ms-1 shrink-0"
            :aria-label="t('dashboard.tabPanelCount', { count: panelCount(tab) }, panelCount(tab))"
            :data-test="`dashboard-tab-${tab.tabId}-panel-count`"
            >{{ panelCount(tab) }}</OBadge
          >
          <!-- Editable affordance: a pencil in the tab's right gutter that
               fades in when the tab is hovered (group/otab comes from OTab) and
               renames on click. While editing, the same slot shows a tick that
               commits the rename. Both are absolutely positioned in the pr-2.5
               reserve, so swapping them never affects the tab's width. -->
          <OIcon
            v-if="canManage && editingTabId !== tab.tabId"
            name="edit"
            size="sm"
            :aria-label="t('common.edit')"
            class="text-text-secondary absolute top-1/2 right-0.5 -translate-y-1/2 cursor-pointer opacity-0 transition-opacity duration-150 group-hover/otab:opacity-60 hover:!opacity-100"
            :data-test="`dashboard-tab-${tab.tabId}-rename-btn`"
            @click.stop="startRename(tab)"
            @mousedown.stop
            @dblclick.stop
          />
          <!-- mousedown.prevent keeps the input focused (no blur-commit race);
               the click then commits explicitly. -->
          <OIcon
            v-else-if="canManage"
            name="check"
            size="sm"
            :aria-label="t('common.save')"
            class="text-text-secondary absolute top-1/2 right-0.5 -translate-y-1/2 cursor-pointer opacity-70 transition-opacity duration-150 hover:opacity-100"
            :data-test="`dashboard-tab-${tab.tabId}-rename-confirm-btn`"
            @click.stop="commitRename(tab)"
            @mousedown.prevent.stop
            @dblclick.stop
          />
        </div>
      </OTab>
    </OTabs>
    <!-- Always-visible + (spreadsheet-style tab bars keep the add affordance
         persistent, not hover-revealed). -->
    <OButton
      v-if="!viewOnly"
      variant="ghost"
      size="icon"
      class="ml-1"
      @click="
        () => {
          showAddTabDialog = true;
        }
      "
      data-test="dashboard-tab-add-btn"
      icon-left="add"
    >
      <OTooltip :content="t('dashboard.newTab')" />
    </OButton>
    <AddTab
      v-model:open="showAddTabDialog"
      :dashboard-id="dashboardData?.dashboardId"
      @refresh="refreshDashboard"
    />
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { computed, inject, nextTick, ref } from "vue";
import { defineComponent } from "vue";
import { useStore } from "vuex";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import { useRoute } from "vue-router";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { editTab, updateDashboard } from "@/utils/commons";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "TabList",
  components: {
    AddTab,
    OTabs,
    OTab,
    OButton,
    OBadge,
    OIcon,
    OTooltip,
  },
  props: {
    dashboardData: {
      required: true,
      type: Object,
    },
    viewOnly: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["refresh"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const route = useRoute();
    const store = useStore();
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();

    const showAddTabDialog = ref(false);

    // inject selected tab, default will be default tab
    const selectedTabId: any = inject("selectedTabId", ref("default"));

    const tabs: any = computed(() => {
      return props.dashboardData?.tabs ?? [];
    });

    // Reorder and rename affordances are edit-only — a view-only dashboard shows
    // no grip and its names aren't editable.
    const canManage = computed(() => !props.viewOnly);

    // Real panels only — section headers (o2SectionHeader) are layout labels.
    const panelCount = (tab: any): number =>
      (tab?.panels ?? []).filter((panel: any) => panel?.o2SectionHeader !== true).length;

    const folderId = computed(() => (route.query.folder as string) ?? "default");

    const refreshDashboard = () => {
      emit("refresh");
      showAddTabDialog.value = false;
    };

    // Shared failure handling for both tab operations: surface a 409 with the
    // refresh CTA, everything else as a plain error, then reload canonical data.
    const notifyTabFailure = (error: any, failKey: I18nKey) => {
      if (error?.response?.status === 409) {
        // Server/network text arrives already-resolved; the fallback is a key.
        showConfictErrorNotificationWithRefreshBtn(
          raw(error?.response?.data?.message ?? error?.message) || t(failKey),
          t,
        );
      } else {
        showErrorNotification(raw(error?.message) || t(failKey));
      }
      emit("refresh");
    };

    // ── Reorder ────────────────────────────────────────────────────────────
    // OTabs reports the move by tab id (from/to/before); apply it optimistically
    // to the live tab list so the strip re-renders (and OTabs' FLIP animates the
    // slide), then persist via the same updateDashboard path the settings screen
    // uses (TabsSettings.handleDragEnd) — reorder is just a new tab array order.
    const onReorder = async ({
      from,
      to,
      before,
    }: {
      from: string | number;
      to: string | number;
      before: boolean;
    }) => {
      const list = [...tabs.value];
      const fromIdx = list.findIndex((tab: any) => tab.tabId === from);
      const toIdx = list.findIndex((tab: any) => tab.tabId === to);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = list.splice(fromIdx, 1);
      // toIdx was computed on the pre-splice array; recompute against the target.
      const insertAt = list.findIndex((tab: any) => tab.tabId === to) + (before ? 0 : 1);
      list.splice(insertAt, 0, moved);

      // Optimistic: mutate the shared tab array in place so the keyed v-for moves
      // the existing DOM nodes (what the FLIP animation slides).
      props.dashboardData!.tabs = list;

      try {
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          props.dashboardData?.dashboardId,
          props.dashboardData,
          folderId.value,
        );
        showPositiveNotification(t("dashboard.tabsSettings.dashboardUpdated"));
      } catch (error: any) {
        notifyTabFailure(error, "dashboard.tabsSettings.tabReorderFailed");
      }
    };

    // ── Inline rename ──────────────────────────────────────────────────────
    const editingTabId = ref<string | null>(null);
    const editingName = ref("");
    const renameInputRef = ref<HTMLInputElement | HTMLInputElement[] | null>(null);

    const startRename = async (tab: any) => {
      // Activate the tab being renamed so OTabs' active indicator sits under the
      // input (double-click already selects it; the hover pencil path needs this).
      selectedTabId.value = tab.tabId;
      editingTabId.value = tab.tabId;
      editingName.value = tab?.name ?? "";
      // Focus (and select) the freshly-mounted input so typing replaces the name.
      await nextTick();
      const el = Array.isArray(renameInputRef.value)
        ? renameInputRef.value[0]
        : renameInputRef.value;
      el?.focus();
      el?.select();
    };

    const cancelRename = () => {
      editingTabId.value = null;
      editingName.value = "";
    };

    const commitRename = async (tab: any) => {
      // Enter closes the field, so the follow-up blur re-enters here with the tab
      // no longer active — that early-returns, keeping the save single.
      if (editingTabId.value !== tab.tabId) return;
      const name = editingName.value.trim();
      editingTabId.value = null;
      // Nothing to save: empty or unchanged → keep the old name.
      if (!name || name === tab?.name) {
        editingName.value = "";
        return;
      }

      try {
        await editTab(store, props.dashboardData?.dashboardId, folderId.value, tab.tabId, { name });
        emit("refresh");
        showPositiveNotification(t("dashboard.tabsSettings.tabUpdated"));
      } catch (error: any) {
        notifyTabFailure(error, "dashboard.tabsSettings.tabUpdationFailed");
      } finally {
        editingName.value = "";
      }
    };

    return {
      t,
      showAddTabDialog,
      refreshDashboard,
      tabs,
      route,
      selectedTabId,
      canManage,
      panelCount,
      onReorder,
      editingTabId,
      editingName,
      renameInputRef,
      startRename,
      commitRename,
      cancelRename,
    };
  },
});
</script>
