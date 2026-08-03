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
  <div
    class="flex items-center"
    data-test="dashboard-tab-list-container"
    @mouseover="isHovered = true"
    @mouseleave="isHovered = false"
  >
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
        <div class="group flex w-full flex-nowrap items-center gap-1">
          <!-- Rename in place: double-click the name (or the hover pencil) to edit
               it. The input reads as the tab label itself — transparent, inherits
               the tab's text, auto-sizes — and carries NO underline of its own: the
               tab is active while editing, so OTabs' own active indicator provides
               the single line beneath it. Enter/blur saves, Escape reverts. Pointer
               and key events are stopped so they don't reach the tab trigger
               (select) or Reka's arrow-key roving. -->
          <input
            v-if="editingTabId === tab.tabId"
            ref="renameInputRef"
            v-model="editingName"
            type="text"
            :size="Math.max(editingName.length, 3)"
            :maxlength="60"
            class="text-tabs-active-text w-auto min-w-0 bg-transparent px-0.5 text-sm outline-none"
            :data-test="`dashboard-tab-${tab.tabId}-rename-input`"
            @click.stop
            @mousedown.stop
            @dblclick.stop
            @keydown.stop
            @keydown.enter.prevent="commitRename(tab)"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename(tab)"
          />
          <template v-else>
            <span
              class="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              :title="tab?.name"
              :data-test="`dashboard-tab-${tab.tabId}-name`"
              :data-test-tab-name="tab?.name"
              @dblclick="canManage ? startRename(tab) : undefined"
              >{{ tab?.name }}</span
            >
            <!-- Editable affordance: always present as a faint pencil (so the
                 slot never reads as empty space) that brightens on tab hover;
                 clicking it renames. Same pattern as OInlineEdit's pencil. -->
            <OIcon
              v-if="canManage"
              name="edit"
              size="sm"
              class="text-text-secondary shrink-0 cursor-pointer opacity-40 transition-opacity duration-150 group-hover:opacity-100"
              :data-test="`dashboard-tab-${tab.tabId}-rename-btn`"
              @click.stop="startRename(tab)"
              @mousedown.stop
              @dblclick.stop
            />
          </template>
        </div>
      </OTab>
    </OTabs>
    <OButton
      v-if="!viewOnly"
      v-show="isHovered"
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
      <OTooltip content="Add Tab" />
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { computed, inject, nextTick, ref } from "vue";
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import { useRoute } from "vue-router";
import { editTab, updateDashboard } from "@/utils/commons";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
  name: "TabList",
  components: {
    AddTab,
    OTabs,
    OTab,
    OButton,
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
    const route = useRoute();
    const store = useStore();
    const { t } = useI18n();
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();

    const showAddTabDialog = ref(false);
    const isHovered = ref(false);

    // inject selected tab, default will be default tab
    const selectedTabId: any = inject("selectedTabId", ref("default"));

    const tabs: any = computed(() => {
      return props.dashboardData?.tabs ?? [];
    });

    // Reorder and rename affordances are edit-only — a view-only dashboard shows
    // no grip and its names aren't editable.
    const canManage = computed(() => !props.viewOnly);

    const folderId = computed(() => (route.query.folder as string) ?? "default");

    const refreshDashboard = () => {
      emit("refresh");
      showAddTabDialog.value = false;
    };

    // Shared failure handling for both tab operations: surface a 409 with the
    // refresh CTA, everything else as a plain error, then reload canonical data.
    const notifyTabFailure = (error: any, failKey: string) => {
      if (error?.response?.status === 409) {
        showConfictErrorNotificationWithRefreshBtn(
          error?.response?.data?.message ?? error?.message ?? t(failKey),
        );
      } else {
        showErrorNotification(error?.message ?? t(failKey));
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
      isHovered,
      selectedTabId,
      canManage,
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
