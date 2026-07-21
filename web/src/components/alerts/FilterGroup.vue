<template>
    <!-- Preview Section (only for root level) -->
    <div v-if="depth === 0 && showSqlPreview && previewString"
         class="mb-2 p-2 rounded-default border w-full max-h-[3.2em] overflow-y-auto bg-surface-panel border-border-default">
      <div class="flex items-start gap-1 min-w-0">
        <span class="font-medium text-xs flex-shrink-0 leading-[1.3] text-text-body">
          {{ t('alerts.filters.previewLabel') }}
        </span>
        <span class="text-3xs font-mono leading-[1.3] min-w-0 break-words text-text-secondary">
          {{ previewString }}
        </span>
      </div>
    </div>

    <div :class="[`  px-2 mb-2 filter-group-box border border-card-glass-border rounded-default `,
        'mt-4',
        store.state.isAiChatEnabled ? 'w-full' : 'xl:w-fit'
    ]"
    :style="{
        opacity: computedOpacity,
        backgroundColor: computedStyleMap,
        marginLeft: depth * (props.indentRem ?? (store.state.isAiChatEnabled ? 0.625 : 1.25)) + 'rem'
    }"
    >
      <!-- V2: Group-level toggle only for nested groups (depth > 0) -->
      <!-- Root group (depth 0) doesn't need toggle - its logicalOperator is dummy -->
      <div v-if="depth > 0" class="w-fit relative bottom-3.5">
        <OToggleGroup
          :model-value="label"
          @update:model-value="toggleLabel($event as string)"
        >
          <OToggleGroupItem
            v-for="tab in tabOptions"
            :key="tab.value"
            :value="tab.value"
            size="sm"
          >
            <template #icon-left>
              <OIcon v-if="tab.value === 'or'" name="git-branch" size="xs" />
              <OIcon v-else name="merge" size="xs" />
            </template>
            {{ tab.label }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
      <!-- Spacer for root group to maintain consistent spacing -->
      <div v-else class="h-3.5"></div>

      <!-- Group content -->

      <div v-if="isOpen" class="overflow-x-auto group-container">
        <!-- Items in group (V2 uses 'conditions' array) -->
        <div class="ml-2 whitespace-nowrap " v-for="(item, index) in props.group.conditions" :key="index">
          <FilterGroup
            v-if="isGroup(item)"
            :group="item"
            :depth="depth + 1"
            :is-first-group="index === 0 && depth === 0"
            @add-condition="emit('add-condition', $event)"
            @add-group="emit('add-group', $event)"
            @remove-group="emit('remove-group', $event)"
            :stream-fields="props.streamFields"
            :condition-input-width="props.conditionInputWidth"
            :allow-custom-columns="props.allowCustomColumns"
            :module="props.module"
            :indent-rem="props.indentRem"
            :name-prefix="childNamePrefix(index)"
            @input:update="(name, field) => inputUpdate(name, field)"
          />
          <div
            v-else
            class="flex items-center gap-2  mb-2 "
            :class="store.state.isAiChatEnabled ? 'pl-0' : 'pl-4'"
            >
            <FilterCondition
                :condition="item"
                :stream-fields="props.streamFields"
                @input:update="(name, field) => inputUpdate(name, field)"
                :index="Number(index)"
                :label="group.logicalOperator?.toLowerCase() || 'and'"
                :depth="depth"
                :input-width="props.conditionInputWidth"
                :is-first-in-group="index === 0"
                :allow-custom-columns="props.allowCustomColumns"
                :module="props.module"
                :name-prefix="childNamePrefix(index)"
            />
                <OButton data-test="alert-conditions-delete-condition-btn" size="icon-xs-circle" variant="ghost" @click="removeCondition(item.id)">
                  <OIcon name="close" size="sm" />
                </OButton>
                </div>
        </div>
        <!-- Action buttons -->

        <div class="flex justify-start items-center ml-4"
        >
        <OButton
            data-test="alert-conditions-add-condition-btn"
            class="ml-3"
            size="sm"
            variant="ghost-primary"
            @click="addCondition(props.group.groupId)"
            >
            <OIcon class="mr-1 font-bold rounded-full border" size="xs" name="add" />
            <span class="text-xs font-bold">{{ t('alerts.conditions.condition') }}</span>
            <OTooltip :delay="300" :content="t('alerts.conditions.addConditionTooltip')" />
        </OButton>
        <OButton
            data-test="alert-conditions-add-condition-group-btn"
            class="ml-1"
            size="sm"
            variant="ghost-primary"
            @click="addGroup(props.group.groupId)"
            :disabled="depth >= 2"
            >
            <OIcon class="mr-1 font-bold rounded-full border" size="xs" name="add" />
            <span class="text-xs font-bold">{{ t('alerts.conditions.conditionGroup') }}</span>
            <OTooltip v-if="depth < 2" :delay="300" :content="t('alerts.conditions.addConditionGroupTooltip')" />
            <OTooltip v-else :delay="300" :content="t('alerts.conditions.maxDepthReachedTooltip')" />
        </OButton>
        <OButton
            data-test="alert-conditions-reorder-btn"
            class="ml-1"
            size="sm"
            variant="ghost-primary"
            @click="reorderItems()"
            >
            <OIcon class="mr-1 font-bold" size="xs" name="swap-vert" />
            <span class="text-xs font-bold">{{ t('alerts.filters.reorder') }}</span>
            <OTooltip :delay="300" :content="t('alerts.filters.reorderTooltip')" />
        </OButton>
     </div>
        </div>
    </div>
    <confirm-dialog
      v-model="confirmDialog.show"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :warning-message="confirmDialog.warningMessage"
      @update:ok="confirmDialog.okCallback"
      @update:cancel="confirmDialog.show = false"
    />
  </template>

  <script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import { cloneDeep } from 'lodash-es';
    import FilterCondition from './FilterCondition.vue';
    import { useStore } from 'vuex';
    import useTheme from '@/composables/useTheme';
    import OButton from '@/lib/core/Button/OButton.vue';
    import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
    import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';
    import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
    import OIcon from '@/lib/core/Icon/OIcon.vue';
    import { useI18n } from 'vue-i18n';
    import { getUUID } from '@/utils/zincutils';
    import ConfirmDialog from '@/components/ConfirmDialog.vue';
    import { buildConditionsString } from '@/utils/alerts/conditionsFormatter';
    const props = defineProps({
    group: {
        type: Object,
        default: () => {

        },
        required: true,
    },
    streamFields: {
        type: Array,
        default: () => [],
        required: true,
    },
    depth: {
        type: Number,
        default: 0,
        required: true,
    },
    /**
     * Per-nesting-level indent, in rem. Optional: when unset the existing
     * behaviour applies (1.25rem, or 0.625rem with the AI chat open).
     *
     * Exists so a narrow host can ASK for a smaller indent instead of reaching
     * in from outside — the flow drawer previously did
     * `[style*="margin-left"] { margin-left: 10px !important }`, an attribute
     * selector patching this component's inline style, which broke the moment
     * any other inline margin-left appeared.
     */
    indentRem: {
        type: Number,
        default: null,
    },
    conditionInputWidth: {
        type: String,
        default: '',
        required: false,
    },
    isFirstGroup: {
        type: Boolean,
        default: false,
        required: false,
    },
    allowCustomColumns: {
        type: Boolean,
        default: false,
        required: false,
    },
    showSqlPreview: {
        type: Boolean,
        default: false,
        required: false,
    },
    streamFieldsMap: {
        type: Object,
        default: () => ({}),
        required: false,
    },
    sqlQuery: {
        type: String,
        default: '',
        required: false,
    },
    module: {
        type: String,
        default: 'alerts',
        required: false,
        validator: (value: string) => ['alerts', 'pipelines'].includes(value),
    },
    /**
     * Dual-mode switch. When set, this group passes the prefix down
     * recursively — the child at index i (leaf condition OR nested group) gets
     * `${namePrefix}.conditions[${i}]` — so every FilterCondition binds its
     * OForm* fields into the injected TanStack form at the exact nested path.
     * When empty (default): bare behavior (pipeline's NodeForm/Condition.vue
     * consumes it bare).
     *
     * GOTCHA: the v-for `:key` MUST stay the array INDEX — the OForm* fields
     * bind by index-based name and do NOT re-bind when the name changes; a
     * stable-id key would leave rendered inputs shifted/blank after a mid-list
     * delete.
     */
    namePrefix: {
        type: String,
        default: '',
        required: false,
    },
    });

  const emit = defineEmits<{
    (e: 'add-condition', groupId: any): void;
    (e: 'add-group', groupId: any): void;
    (e: 'remove-group', groupId: any): void;
    (e: 'update-group', groupId: any): void;
    (e: 'input:update', name: string, field: any): void;
  }>();
  
  const isOpen = ref(true);
  // Mutable deep clone — props.group is the readonly form read-view in alerts
  // mode; the handlers mutate this clone and emit it, and the ancestor writes it
  // back through the form (which re-syncs via the watch below).
  const groups = ref(cloneDeep(props.group));
  const showPreview = ref(true);

  const store = useStore();
  const { isDark } = useTheme();
  const { t } = useI18n();

  const label = ref(props.group.logicalOperator?.toLowerCase() || 'and');

  const confirmDialog = ref({
    show: false,
    title: '',
    message: '',
    warningMessage: '',
    okCallback: () => {},
  });

  // Keep the local working copy in sync with the parent. The clone is required:
  // props.group is the form's READONLY read-view and this component mutates
  // `groups` in place (performRemoveCondition et al) — assigning it raw makes
  // those writes silently fail ("target is readonly").
  //
  // Intentionally NOT deep: the form store replaces values immutably on every
  // change, so props.group arrives as a new reference and a reference watch
  // sees every edit. A deep watch would cloneDeep the whole subtree on every
  // nested mutation, once per nested FilterGroup.
  watch(() => props.group, (newGroup) => {
    groups.value = cloneDeep(newGroup);
    label.value = newGroup.logicalOperator?.toLowerCase() || 'and';
  });

  // Bare-mode consumers (e.g. pipeline's NodeForm/Condition.vue) edit props.group's
  // leaf conditions IN PLACE via v-model, which never changes props.group's
  // reference, so the non-deep watch above doesn't fire and `groups` goes STALE.
  // The structural handlers below run only on explicit button clicks, so refresh
  // the clone from the live prop there — otherwise emitting the stale clone makes
  // the ancestor wipe the user's typed values on every structural change.
  const syncWorkingCopyFromProp = () => {
    groups.value = cloneDeep(props.group);
  };

  const tabOptions = computed(() => [
    {
      label: "OR",
      value: "or",
    },
    {
      label: "AND",
      value: "and",
    },
  ]);

  // Dual-mode: the child at index i — a leaf FilterCondition OR a nested
  // FilterGroup — binds under `${namePrefix}.conditions[${i}]`. Empty prefix
  // (bare mode) propagates as empty so every descendant stays bare.
  // (index is `number | string` because the template's v-for iterates an
  // Object-typed prop — same pre-existing looseness as `:index="index"`.)
  const childNamePrefix = (index: number | string) =>
    props.namePrefix ? `${props.namePrefix}.conditions[${index}]` : '';

  function isGroup(item: any) {
    // V2: Check for filterType === "group" with conditions array
    if (item && item.filterType === "group" && item.conditions && Array.isArray(item.conditions)) {
      return true;
    }
    // V1 compatibility: Check for items array (legacy)
    if (item && item.items && Array.isArray(item.items) && item.groupId) {
      return true;
    }
    return false;
  }
  
  // Handlers mutate the clone `groups` (never the readonly `props.group`) and emit
  // it; the ancestor writes it back through the form, re-syncing via the watch above.
  const addCondition = (groupId: string) => {
    // Capture any in-place bare-mode leaf edits before mutating + emitting.
    syncWorkingCopyFromProp();
    // V2: Create condition with filterType and logicalOperator
    const newCondition = {
      filterType: 'condition',
      column: '',
      operator: '=',
      value: '',
      values: [],
      logicalOperator: groups.value.logicalOperator || 'AND',
      id: getUUID(),
    };
    groups.value.conditions.push(newCondition);
    emit('add-condition', groups.value);
  };

  const addGroup = (groupId: string) => {
    // Capture any in-place bare-mode leaf edits before mutating + emitting.
    syncWorkingCopyFromProp();
    // V2: Create group with filterType, logicalOperator, and conditions array
    const newGroup = {
      filterType: 'group',
      logicalOperator: 'OR',
      groupId: getUUID(),
      conditions: [
        {
          filterType: 'condition',
          column: '',
          operator: '=',
          value: '',
          values: [],
          logicalOperator: 'OR',
          id: getUUID(),
        }
      ]
    };
    groups.value.conditions.push(newGroup);
    emit('add-group', groups.value);
  };

  // Toggle AND/OR
  const toggleLabel = (newLabel?: string) => {
    // Capture any in-place bare-mode leaf edits before mutating + emitting.
    syncWorkingCopyFromProp();
    // If newLabel is provided, use it; otherwise toggle
    if (newLabel) {
      groups.value.logicalOperator = newLabel.toUpperCase();
    } else {
      groups.value.logicalOperator = groups.value.logicalOperator === 'AND' ? 'OR' : 'AND';
    }
    emit('add-group', groups.value); // optional, sync with parent
    emit('input:update', 'conditions', groups.value);
  };

  const removeCondition = (id: string) => {
    // Capture any in-place bare-mode leaf edits before reading/mutating + emitting.
    syncWorkingCopyFromProp();
    // First, check what will happen after removing this condition
    const itemsAfterRemoval = groups.value.conditions.filter((item: any) => item.id !== id);
    const hasConditionsAfterRemoval = itemsAfterRemoval.some((item: any) => !isGroup(item));

    // Count sub-groups that will be deleted
    const subGroupCount = itemsAfterRemoval.filter((item: any) => isGroup(item)).length;

    // If removing this condition will cause the group to be deleted (no conditions left)
    // and there are sub-groups, show confirmation dialog
    if (!hasConditionsAfterRemoval && subGroupCount > 0) {
      confirmDialog.value = {
        show: true,
        title: t('alerts.filters.deleteConditionTitle'),
        message: t('alerts.filters.deleteConditionMessage'),
        // Pluralized by vue-i18n (`one | other`). This branch is guarded by
        // `subGroupCount > 0`, so n is always >= 1 and vue-i18n's default rule
        // (1 -> one, >=2 -> other) applies.
        warningMessage: t(
          'alerts.filters.deleteConditionSubGroupWarning',
          { count: subGroupCount },
          subGroupCount,
        ),
        okCallback: () => {
          // User confirmed, proceed with deletion
          performRemoveCondition(id);
          confirmDialog.value.show = false;
        },
      };
    } else {
      // Safe to delete without confirmation
      performRemoveCondition(id);
    }
  };

  const performRemoveCondition = (id: string) => {
    // Capture any in-place bare-mode leaf edits before mutating + emitting (this
    // may run deferred from the confirm-dialog okCallback).
    syncWorkingCopyFromProp();
    groups.value.conditions = groups.value.conditions.filter((item: any) => item.id !== id);

    // Check if there are any conditions left (not sub-groups)
    const hasConditions = groups.value.conditions.some((item: any) => !isGroup(item));

    if (!hasConditions) {
      // No conditions left, clear all items (including sub-groups) and remove this entire group
      groups.value.conditions = [];
      emit('remove-group', props.group.groupId);
    } else {
      emit('add-group', groups.value); // update as usual
    }
  };

  const inputUpdate = (name: string, field: any) => {
    emit('input:update', name, field);
  };

  const reorderItems = () => {
    // Capture any in-place bare-mode leaf edits before mutating + emitting.
    syncWorkingCopyFromProp();
    // Separate conditions and groups
    const conditions = groups.value.conditions.filter((item: any) => !isGroup(item));
    const subGroups = groups.value.conditions.filter((item: any) => isGroup(item));

    // Reorder: conditions first, then groups
    groups.value.conditions = [...conditions, ...subGroups];

    // Emit update
    emit('add-group', groups.value);
    emit('input:update', 'conditions', groups.value);
  };


function hexToHSL(hex: string) {
  let r = 0, g = 0, b = 0;

  // Convert hex to RGB
  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }

  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: h = ((b - r) / d) + 2; break;
      case b: h = ((r - g) / d) + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToCSS(h: number, s: number, l: number) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}
const computedStyleMap = computed(() => {
  if (isDark.value) {
    const baseColor = '#212121';
    const { h, s, l } = hexToHSL(baseColor);
    const newLightness = Math.min(l + props.depth * 1, 90); // 1% per depth step
    return hslToCSS(h, s, newLightness);
  } else {
    const baseColor = '#ffffff'; // white
    const { h, s, l } = hexToHSL(baseColor);
    const newLightness = Math.max(l - props.depth * 2, 80); // 2% darker per depth, min 80%
    return hslToCSS(h, s, newLightness);
  }
});


const computedOpacity = computed(() => {
  return props.depth + 10;
});

// Computed preview string
// Supports three modes:
// 1. Display mode (default): lowercase operators, simple formatting, wrapped in parentheses - for pipelines
// 2. SQL Query mode (when sqlQuery prop provided): shows full SQL query - for alerts
// 3. WHERE clause mode (when showSqlPreview=true but no sqlQuery): shows just WHERE clause
const previewString = computed(() => {
  // Mode 1: Full SQL Query (for alerts with aggregation, etc.)
  if (props.sqlQuery && props.sqlQuery.trim().length > 0) {
    return props.sqlQuery;
  }

  // Mode 2: SQL WHERE clause only (fallback for alerts)
  if (props.showSqlPreview) {
    return buildConditionsString(groups.value, {
      sqlMode: true,              // SQL format (uppercase AND/OR, LIKE operators)
      addWherePrefix: true,        // Add "WHERE" prefix
      formatValues: true,          // Type-aware formatting (Int64 no quotes, String with quotes)
      streamFieldsMap: props.streamFieldsMap,
    });
  }

  // Mode 3: Display format (for pipelines)
  const preview = buildConditionsString(groups.value, {
    sqlMode: false,            // Display format (lowercase operators)
    addWherePrefix: false,
    formatValues: false,       // Simple display format without type-aware formatting
  });
  // Wrap the entire root expression in parentheses
  return preview ? `(${preview})` : '';
});

// Expose functions for testing
defineExpose({
  isGroup,
  addCondition,
  addGroup,
  toggleLabel,
  removeCondition,
  performRemoveCondition,
  inputUpdate,
  reorderItems,
  hexToHSL,
  hslToCSS,
  computedStyleMap,
  computedOpacity,
  groups,
  label,
  isOpen,
  confirmDialog
});

  </script>

  <style scoped>
    /* keep(scrollbar): ::-webkit-scrollbar pseudo-elements and scrollbar-color have no utility equivalent. */

    .group-container {
      scrollbar-color: var(--color-border-strong) var(--color-surface-base); /* thumb color, track color */
    }

    /* For more control using WebKit scrollbar styling */
    .group-container::-webkit-scrollbar {
      width: 0.5rem;
      height: 0.25rem !important;
    }

    .group-container::-webkit-scrollbar-track {
      background: var(--color-surface-base);
    }

    .group-container::-webkit-scrollbar-thumb {
      background-color: var(--color-border-strong);
      border-radius: var(--radius-default);
    }

  </style>
  