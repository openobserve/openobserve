// Copyright 2026 OpenObserve Inc.

import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import type { SearchObject } from "@/composables/useLogs/searchState";
import type { FieldPanelCapabilities, FooterToggle } from "../fieldPanel.types";

/** The full logs set; quick mode and the stream's defined schema decide which parts are offered at a time. */
export const LOGS_FIELD_PANEL_CAPABILITIES: FieldPanelCapabilities = {
  streamPicker: "multi",
  values: true,
  drag: false,
  actions: ["add-filter", "toggle-column", "interesting"],
  footerToggles: ["schema", "interesting"],
  highlightColumns: true,
};

const SCHEMA_TAB = "user_defined_schema";

const INTERESTING_TAB = "interesting_fields";

export interface LogsFooterDeps {
  searchObj: SearchObject;
  userDefinedSchemasEnabled: () => boolean;
  /** `uds` opens the schema tab in quick mode; anything else opens the interesting tab. */
  defaultFieldList: () => string;
  streamSchemaFieldsIndexMapping: Ref<Record<string, number>>;
  extractFields: () => Promise<void>;
}

export interface LogsFooterTabs {
  capabilities: ComputedRef<FieldPanelCapabilities>;
  footerSchemaTab: ComputedRef<string>;
  showOnlyInterestingFields: Ref<boolean>;
  footerToggle: (kind: FooterToggle, value: string | boolean) => void;
}

export function useLogsFooterTabs(deps: LogsFooterDeps): LogsFooterTabs {
  const { searchObj } = deps;

  const showOnlyInterestingFields = ref(false);
  const quickMode = computed<boolean>(() => searchObj.meta.quickMode === true);
  const showSchemaToggle = computed<boolean>(
    () => deps.userDefinedSchemasEnabled() && searchObj.meta.hasUserDefinedSchemas === true,
  );
  const footerSchemaTab = computed<string>(() => searchObj.meta.useUserDefinedSchemas);

  const capabilities = computed<FieldPanelCapabilities>(() => ({
    ...LOGS_FIELD_PANEL_CAPABILITIES,
    actions: LOGS_FIELD_PANEL_CAPABILITIES.actions.filter(
      (action) => action !== "interesting" || quickMode.value,
    ),
    footerToggles: LOGS_FIELD_PANEL_CAPABILITIES.footerToggles.filter((toggle) =>
      toggle === "schema" ? showSchemaToggle.value : quickMode.value,
    ),
  }));

  const setDefaultFieldTab = () => {
    const interestingByDefault = deps.defaultFieldList() !== "uds";
    searchObj.meta.useUserDefinedSchemas = interestingByDefault ? INTERESTING_TAB : SCHEMA_TAB;
    showOnlyInterestingFields.value = interestingByDefault;
  };

  watch(
    quickMode,
    (active) => {
      if (active) {
        setDefaultFieldTab();
        return;
      }
      if (searchObj.meta.useUserDefinedSchemas === INTERESTING_TAB) {
        searchObj.meta.useUserDefinedSchemas = SCHEMA_TAB;
      }
      showOnlyInterestingFields.value = false;
    },
    { immediate: true },
  );

  watch(
    () => [showSchemaToggle.value, searchObj.meta.useUserDefinedSchemas],
    () => {
      showOnlyInterestingFields.value = searchObj.meta.useUserDefinedSchemas === INTERESTING_TAB;
    },
    { immediate: true },
  );

  // A stream's defined schema is only known once its settings load, so the default tab follows the toggle.
  watch(showSchemaToggle, () => setDefaultFieldTab());

  const resetFields = async () => {
    searchObj.loadingStream = true;
    await nextTick();
    deps.streamSchemaFieldsIndexMapping.value = {};
    await deps.extractFields();
    await nextTick();
    searchObj.loadingStream = false;
  };

  const footerToggle = (kind: FooterToggle, value: string | boolean) => {
    if (kind === "schema") {
      searchObj.meta.useUserDefinedSchemas = String(value);
      showOnlyInterestingFields.value = value === INTERESTING_TAB;
    } else {
      showOnlyInterestingFields.value = value === true;
    }
    void resetFields();
  };

  return { capabilities, footerSchemaTab, showOnlyInterestingFields, footerToggle };
}
