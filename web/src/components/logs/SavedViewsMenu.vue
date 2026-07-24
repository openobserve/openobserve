<!-- Copyright 2026 OpenObserve Inc. -->
<!--
  SavedViewsMenu — the single Saved Views control for the Logs search bar.

  One toolbar button opens one popover that does everything inline: browse,
  apply, favorite, create, update-to-current, rename, and delete. It replaces
  the old scattered surfaces (separate save button, create/update dialog, the
  two-table "manage" dialog, and the stacked update/delete confirm modals).

  It is presentation-only: every mutation is emitted to the parent
  (SearchBar.vue), which owns the saved-views service calls and toasts.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";

import { sortSavedViews } from "@/plugins/logs/savedViewsSort";

interface SavedView {
  view_id: string;
  view_name: string;
  org_id?: string;
  payload?: unknown;
}

const props = withDefaults(
  defineProps<{
    /** All saved views for the current org. */
    views?: SavedView[];
    /** view_ids marked favorite (local, from localStorage). */
    favorites?: string[];
    /** True while the list is being fetched. */
    loading?: boolean;
    /** view_id of the currently-applied view, for highlighting. */
    activeViewId?: string;
    /** Whether a stream is selected — create/update need one. */
    streamSelected?: boolean;
  }>(),
  {
    views: () => [],
    favorites: () => [],
    loading: false,
    activeViewId: "",
    streamSelected: false,
  },
);

const emit = defineEmits<{
  /** Fired the first time the menu opens, so the parent can lazy-load. */
  (e: "load"): void;
  (e: "apply", view: SavedView): void;
  (e: "create", name: string): void;
  (e: "update", view: SavedView): void;
  (e: "rename", payload: { view: SavedView; name: string }): void;
  (e: "delete", view: SavedView): void;
  (e: "toggle-favorite", view: SavedView): void;
}>();

const { t } = useI18n();

// ── Menu open state (controlled so inline inputs don't dismiss it) ──────────
const open = ref(false);
let hasLoadedOnce = false;
const onOpenChange = (value: boolean) => {
  open.value = value;
  if (value && !hasLoadedOnce) {
    hasLoadedOnce = true;
    emit("load");
  }
  if (!value) resetInlineState();
};

// ── Inline edit state ───────────────────────────────────────────────────────
const filter = ref("");
const creating = ref(false);
const newName = ref("");
const renamingId = ref("");
const renameName = ref("");
const confirmingDeleteId = ref("");

const resetInlineState = () => {
  creating.value = false;
  newName.value = "";
  renamingId.value = "";
  renameName.value = "";
  confirmingDeleteId.value = "";
  filter.value = "";
};

// ── Derived lists ───────────────────────────────────────────────────────────
const isFavorite = (view: SavedView) => (props.favorites ?? []).includes(view.view_id);
const isActive = (view: SavedView) => !!props.activeViewId && props.activeViewId === view.view_id;

const showSearch = computed(() => (props.views?.length ?? 0) > 5);

const filteredOrdered = computed<SavedView[]>(() => {
  const needle = filter.value.trim().toLowerCase();
  const matched = needle
    ? (props.views ?? []).filter((v) => v.view_name.toLowerCase().includes(needle))
    : (props.views ?? []);
  return sortSavedViews(matched, props.favorites ?? []);
});

// filteredOrdered is favorites-first, so a group header is drawn just before
// the first favorite and just before the first non-favorite row.
const firstFavoriteId = computed(
  () => filteredOrdered.value.find((v) => isFavorite(v))?.view_id ?? "",
);
const firstOtherId = computed(
  () => filteredOrdered.value.find((v) => !isFavorite(v))?.view_id ?? "",
);
const hasFavorites = computed(() => !!firstFavoriteId.value);

const activeView = computed(() =>
  (props.views ?? []).find((v) => v.view_id === props.activeViewId),
);

// ── Actions ─────────────────────────────────────────────────────────────────
const applyView = (view: SavedView) => {
  emit("apply", view);
  open.value = false;
};

const toggleFavorite = (view: SavedView) => {
  // Stay open — favoriting is a quick, repeatable action.
  emit("toggle-favorite", view);
};

const updateToCurrent = (view: SavedView) => {
  emit("update", view);
  open.value = false;
};

// Create ---------------------------------------------------------------------
const startCreate = () => {
  if (!props.streamSelected) return;
  creating.value = true;
  newName.value = "";
};
// Opens the menu straight into create mode — used by the "save view" keyboard
// shortcut so it keeps working now that the old dialog is gone.
const openCreate = () => {
  onOpenChange(true);
  startCreate();
};
defineExpose({ openCreate });
const confirmCreate = () => {
  const name = newName.value.trim();
  if (!name) return;
  emit("create", name);
  creating.value = false;
  newName.value = "";
  open.value = false;
};
const cancelCreate = () => {
  creating.value = false;
  newName.value = "";
};

// Rename (name only — preserves the saved query) -----------------------------
const startRename = (view: SavedView) => {
  renamingId.value = view.view_id;
  renameName.value = view.view_name;
};
const confirmRename = (view: SavedView) => {
  const name = renameName.value.trim();
  if (!name || name === view.view_name) {
    renamingId.value = "";
    return;
  }
  emit("rename", { view, name });
  renamingId.value = "";
  renameName.value = "";
};
const cancelRename = () => {
  renamingId.value = "";
  renameName.value = "";
};

// Delete (inline confirm — no modal) -----------------------------------------
const askDelete = (view: SavedView) => {
  confirmingDeleteId.value = view.view_id;
};
const confirmDelete = (view: SavedView) => {
  emit("delete", view);
  confirmingDeleteId.value = "";
};
const cancelDelete = () => {
  confirmingDeleteId.value = "";
};

// Drop inline edit rows if the underlying view vanishes out from under us.
watch(
  () => props.views,
  () => {
    if (renamingId.value && !(props.views ?? []).some((v) => v.view_id === renamingId.value))
      cancelRename();
    if (
      confirmingDeleteId.value &&
      !(props.views ?? []).some((v) => v.view_id === confirmingDeleteId.value)
    )
      cancelDelete();
  },
);
</script>

<template>
  <ODropdown
    :open="open"
    side="bottom"
    align="start"
    content-class="w-80"
    data-test="logs-saved-views-menu"
    @update:open="onOpenChange"
  >
    <template #trigger>
      <!-- Icon-only to match the sibling pinned toolbar controls and stay
         compact on a crowded bar. A filled dot marks that a view is active. -->
      <OButton
        variant="outline"
        size="xs"
        class="relative gap-0.5 px-1.5!"
        data-test="logs-saved-views-menu-trigger"
      >
        <OIcon name="saved-search" size="sm" class="shrink-0" />
        <OIcon name="arrow-drop-down" size="sm" class="-ml-1 shrink-0" />
        <span
          v-if="activeView"
          class="bg-accent absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
        />
        <OTooltip
          :content="
            activeView
              ? `${t('search.activeViewLabel')}: ${activeView.view_name}`
              : t('search.savedViewsTitle')
          "
          :side-offset="4"
        />
      </OButton>
    </template>

    <!-- Save current search — expands into an inline name field in place -->
    <div v-if="creating" class="p-1" @keydown.stop @click.stop>
      <div class="flex items-center gap-1">
        <OInput
          v-model="newName"
          size="sm"
          autofocus
          :placeholder="t('search.saveViewNamePlaceholder')"
          data-test="logs-saved-views-menu-create-input"
          class="min-w-0 flex-1"
          @keydown="
            (ev) => {
              if (ev.key === 'Enter') confirmCreate();
              else if (ev.key === 'Escape') cancelCreate();
            }
          "
        />
        <OButton
          variant="ghost-success"
          size="icon-sm"
          :disabled="!newName.trim()"
          data-test="logs-saved-views-menu-create-confirm"
          @click="confirmCreate"
        >
          <OIcon name="check" size="sm" />
          <OTooltip :content="t('common.save')" :side-offset="4" />
        </OButton>
        <OButton
          variant="ghost-neutral"
          size="icon-sm"
          data-test="logs-saved-views-menu-create-cancel"
          @click="cancelCreate"
        >
          <OIcon name="close" size="sm" />
        </OButton>
      </div>
    </div>
    <button
      v-else
      type="button"
      :disabled="!streamSelected"
      class="text-dropdown-item-text hover:bg-interactive-hover-bg rounded-default flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
      data-test="logs-saved-views-menu-create-btn"
      @click.stop="startCreate"
    >
      <OIcon name="add" size="sm" class="text-text-secondary shrink-0" />
      <span>{{ t("search.saveCurrentSearch") }}</span>
    </button>

    <ODropdownSeparator />

    <!-- Search — only when the list is long enough to need it -->
    <div v-if="showSearch" class="px-1 pb-1" @keydown.stop @click.stop>
      <OSearchInput
        v-model="filter"
        size="sm"
        :debounce="200"
        :placeholder="t('search.searchSavedView')"
        data-test="logs-saved-views-menu-search"
      />
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="text-text-secondary flex items-center gap-2 px-3 py-2 text-sm"
      data-test="logs-saved-views-menu-loading"
    >
      <OSpinner size="xs" />
      {{ t("confirmDialog.loading") }}
    </div>

    <!-- Empty -->
    <div
      v-else-if="!filteredOrdered.length"
      class="text-text-secondary px-3 py-2 text-sm"
      data-test="logs-saved-views-menu-empty"
    >
      {{ t("search.savedViewsNotFound") }}
    </div>

    <!-- One loop: favorites first, then all views, with a header before each group -->
    <div
      v-else
      class="max-h-72 overflow-y-auto overscroll-contain"
      data-test="logs-saved-views-menu-list"
    >
      <template v-for="view in filteredOrdered" :key="view.view_id">
        <div
          v-if="view.view_id === firstFavoriteId"
          class="text-text-muted text-2xs px-2 pt-1.5 pb-1 font-bold tracking-wide uppercase"
        >
          {{ t("search.favoritesGroupLabel") }}
        </div>
        <div
          v-else-if="hasFavorites && view.view_id === firstOtherId"
          class="text-text-muted text-2xs px-2 pt-1.5 pb-1 font-bold tracking-wide uppercase"
        >
          {{ t("search.allViewsGroupLabel") }}
        </div>

        <!-- Rename row (name only — preserves the saved query) -->
        <div
          v-if="renamingId === view.view_id"
          class="flex items-center gap-1 p-1"
          @keydown.stop
          @click.stop
        >
          <OInput
            v-model="renameName"
            size="sm"
            autofocus
            :placeholder="t('search.renameViewPlaceholder')"
            :data-test="`logs-saved-views-menu-rename-input-${view.view_name}`"
            class="min-w-0 flex-1"
            @keydown="
              (ev) => {
                if (ev.key === 'Enter') confirmRename(view);
                else if (ev.key === 'Escape') cancelRename();
              }
            "
          />
          <OButton
            variant="ghost-success"
            size="icon-sm"
            :disabled="!renameName.trim()"
            :data-test="`logs-saved-views-menu-rename-confirm-${view.view_name}`"
            @click="confirmRename(view)"
          >
            <OIcon name="check" size="sm" />
          </OButton>
          <OButton
            variant="ghost-neutral"
            size="icon-sm"
            :data-test="`logs-saved-views-menu-rename-cancel-${view.view_name}`"
            @click="cancelRename"
          >
            <OIcon name="close" size="sm" />
          </OButton>
        </div>

        <!-- Delete confirm row (inline — no modal) -->
        <div
          v-else-if="confirmingDeleteId === view.view_id"
          class="flex items-center gap-1 px-2 py-1.5"
          @click.stop
        >
          <span class="text-text-body min-w-0 flex-1 truncate text-sm">{{
            t("search.deleteViewConfirmInline")
          }}</span>
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            :data-test="`logs-saved-views-menu-delete-confirm-${view.view_name}`"
            @click="confirmDelete(view)"
          >
            <OIcon name="check" size="sm" />
          </OButton>
          <OButton
            variant="ghost-neutral"
            size="icon-sm"
            :data-test="`logs-saved-views-menu-delete-cancel-${view.view_name}`"
            @click="cancelDelete"
          >
            <OIcon name="close" size="sm" />
          </OButton>
        </div>

        <!-- Normal row: click applies; hover reveals actions -->
        <ODropdownItem
          v-else
          :data-test="`logs-saved-views-menu-apply-${view.view_name}`"
          @select="applyView(view)"
        >
          <template #icon-left>
            <OButton
              variant="ghost-neutral"
              size="icon-xs-sq"
              :title="t('common.favourite')"
              :data-test="`logs-saved-views-menu-favorite-${view.view_name}`"
              @click.stop.prevent="toggleFavorite(view)"
            >
              <OIcon
                :name="isFavorite(view) ? 'star' : 'star-outline'"
                size="sm"
                :class="isFavorite(view) ? 'text-favorite' : 'text-text-secondary'"
              />
            </OButton>
          </template>
          <span
            class="max-w-40 truncate"
            :class="isActive(view) ? 'text-accent font-medium' : ''"
            >{{ view.view_name }}</span
          >
          <template #icon-right>
            <span class="ms-auto flex items-center gap-0.5">
              <OIcon v-if="isActive(view)" name="check" size="sm" class="text-accent" />
              <OButton
                variant="ghost-neutral"
                size="icon-xs-sq"
                :title="t('search.updateViewToCurrent')"
                :data-test="`logs-saved-views-menu-update-${view.view_name}`"
                @click.stop.prevent="updateToCurrent(view)"
              >
                <OIcon name="save" size="sm" />
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="icon-xs-sq"
                :title="t('search.renameView')"
                :data-test="`logs-saved-views-menu-rename-${view.view_name}`"
                @click.stop.prevent="startRename(view)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                variant="ghost-destructive"
                size="icon-xs-sq"
                :title="t('common.delete')"
                :data-test="`logs-saved-views-menu-delete-${view.view_name}`"
                @click.stop.prevent="askDelete(view)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
            </span>
          </template>
        </ODropdownItem>
      </template>
    </div>
  </ODropdown>
</template>
