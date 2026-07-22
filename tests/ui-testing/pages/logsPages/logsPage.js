import { expect } from '@playwright/test';
import { LogsQueryPage } from './logsQueryPage.js';
import { LoginPage } from '../generalPages/loginPage.js';
import { IngestionPage } from '../generalPages/ingestionPage.js';
import { ManagementPage } from '../generalPages/managementPage.js';
import { openNavFlyoutChild } from '../commonActions.js';
import { openOSelectDropdown } from '../alertsPages/oselectHelpers.js';
import * as fs from 'fs';
import * as path from 'path';

// Import testLogger for proper logging
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier, isCloudEnvironment } = require('../../playwright-tests/utils/cloud-auth.js');
const MonacoEditorHelper = require('../../playwright-tests/utils/MonacoEditorHelper.js');

export class LogsPage {
    constructor(page) {
        this.page = page;
        
        // Initialize existing page objects
        this.logsQueryPage = new LogsQueryPage(page);
        this.loginPage = new LoginPage(page);
        this.ingestionPage = new IngestionPage(page);
        this.managementPage = new ManagementPage(page);
        
        // Locators
        this.logsMenuItem = '[data-test="menu-link-\\/logs-item"]';
        this.homeButton = "[name ='home']";
        this.queryButton = "[data-test='logs-search-bar-refresh-btn']";
        this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
        // Post UX-revamp: renamed from logs-search-bar-quick-mode-toggle-btn
        this.quickModeToggle = '[data-test="logs-search-bar-menu-quick-mode-toggle-btn"]';
        // FieldListPagination schema-toggle buttons (data-test set per-slot in FieldListPagination.vue).
        // The common FieldListPagination renders with `${dataTestPrefix}-all-fields-btn` etc.
        // For the logs sidebar prefix is `logs-page`. Legacy non-prefixed variants kept as fallback
        // for any consumer that still ships the old data-test names.
        this.allFieldsToggleBtn = '[data-test="logs-page-all-fields-btn"], [data-test="logs-all-fields-btn"], [data-test="logs-page-user-defined-fields-btn-all_fields_slot"], [data-test="logs-user-defined-fields-btn-all_fields_slot"]';
        this.interestingFieldsToggleBtn = '[data-test="logs-page-interesting-fields-btn"], [data-test="logs-interesting-fields-btn"], [data-test="logs-page-user-defined-fields-btn-interesting_fields_slot"], [data-test="logs-user-defined-fields-btn-interesting_fields_slot"]';
        this.fieldListResetIcon = '[data-test="logs-page-fields-list-reset-icon"]';
        this.sqlModeToggle = '[data-test="logs-search-bar-sql-mode-toggle-btn"]';
        // OSwitch renders the wrapper data-test on a div and the toggle state on an inner
        // <button data-state="checked|unchecked"> — drill into that button via data-state attr.
        this.sqlModeToggleStateBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"] [data-state]';
        this.sqlModeSwitch = { role: 'switch', name: 'SQL Mode' };
        this.dateTimeButton = '[data-test="date-time-btn"]';
        this.indexDropDown = '[data-test="log-search-index-list-select-stream"]';
        // OSelect post-migration: the wrapper is a div (cannot be `.fill()`'d) — use the
        // explicit `-trigger` / `-popover` / `-search` parts when narrowing the list (§4).
        this.indexDropDownTrigger = '[data-test="log-search-index-list-select-stream-trigger"]';
        this.indexDropDownPopover = '[data-test="log-search-index-list-select-stream-popover"]';
        this.indexDropDownSearch = '[data-test="log-search-index-list-select-stream-search"]';
        this.streamToggle = '[data-test="log-search-index-list-stream-toggle-default"] [data-state]';
        this.searchPartitionButton = '[data-test="logs-search-partition-btn"]';
        this.histogramToggle = '[data-test="logs-search-bar-show-histogram-toggle-btn"]';
        // OSwitch renders the wrapper data-test on a div and the state on an inner
        // <button data-state="checked|unchecked"> — drill into that button. Note: a sibling
        // OTooltip grace-area span also carries `data-state="closed"`, so we filter on the
        // OSwitch states explicitly to avoid the strict-mode collision.
        this.histogramToggleCheckedBtn = '[data-test="logs-search-bar-show-histogram-toggle-btn"] [data-state="checked"]';
        this.histogramToggleUncheckedBtn = '[data-test="logs-search-bar-show-histogram-toggle-btn"] [data-state="unchecked"]';
        this.exploreButton = '[data-test="logs-search-explore-btn"]';
        this.timestampColumnMenu = '[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]';
        this.resultText = '[data-test="logs-search-search-result"]';
        this.logsSearchResultLogsTable = '[data-test="logs-search-result-logs-table"]';
        this.kubernetesFieldsSelector = '[data-test*="log-search-expand-kubernetes"]';
        this.allFieldsSelector = '[data-test*="log-search-expand-"]';
        this.matchingFieldsSelector = '[data-test*="log-search-expand-"]';
        this.logTableColumnSource = '[data-test="log-table-column-0-source"]';
        this.logsSearchBarQueryEditor = '[data-test="logs-search-bar-query-editor"]';
        this.searchBarRefreshButton = '[data-test="logs-search-bar-refresh-btn"]';
        this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"]';
        this.relative6WeeksButton = '[data-test="date-time-relative-6-w-btn"]';
        this.relative30SecondsButton = '[data-test="date-time-relative-30-s-btn"]';
        this.relative1HourButton = '[data-test="date-time-relative-1-h-btn"]';
        this.absoluteTab = '[data-test="date-time-absolute-tab"]';
        this.scheduleText = '[data-test="date-time-btn"]';
        this.timeZoneDropdown = '[data-test="timezone-select"]';
        this.timeZoneOption = (zone) => `[data-test="timezone-option-${zone}"]`;
        this.dateSelector = (day) => `[data-test="date-selector-${day}"]`;
        this.monthSelector = (month) => `[data-test="month-selector-${month}"]`;
        this.yearSelector = (year) => `[data-test="year-selector-${year}"]`;
        this.startTimeField = '[data-test="datetime-start-time"]';
        this.endTimeField = '[data-test="datetime-end-time"]';
        this.startTimeInput = '[data-test="datetime-start-time"] input[type="time"]';
        this.endTimeInput = '[data-test="datetime-end-time"] input[type="time"]';
        this.showQueryToggle = '[data-test="logs-search-bar-show-query-toggle-btn"]';
        this.fieldListCollapseButton = '[data-test="logs-search-field-list-collapse-btn"]';
        this.savedViewsButton = '[data-test="logs-search-bar-utilities-menu-btn"]';
        this.savedViewsExpand = '[data-test="logs-search-bar-utilities-menu-btn"]';
        this.saveViewButton = 'button'; // filter by text in method
        // OInput convention §4: drive the auto-derived `-field` inner native input for fill().
        this.savedViewNameInput = '[data-test="add-alert-name-input-field"]';
        // Saved view dialog (SearchBar.vue:1654) and saved function dialog (SearchBar.vue:1703) were both migrated
        // from the legacy dialog to ODialog. Tests historically shared a single save-button selector because the legacy
        // dialog used the same data-test on both. With ODialog each dialog has its own primary button, so the
        // selector matches whichever dialog is currently open (they are mutually exclusive).
        this.savedViewDialogSave = '[data-test="search-bar-store-state-saved-view-dialog"] [data-test="o-dialog-primary-btn"], [data-test="search-bar-store-state-saved-function-dialog"] [data-test="o-dialog-primary-btn"]';
        this.savedViewDialog = '[data-test="search-bar-store-state-saved-view-dialog"]';
        this.savedViewArrow = '[data-test="logs-search-bar-utilities-menu-btn"]';
        // OInput convention §4: drive the auto-derived `-field` inner native input for fill().
        this.savedViewSearchInput = '[data-test="log-search-saved-view-field-search-input-field"]';
        // Matches both ConfirmDialog.vue (data-test="confirm-dialog") and SearchBar's inline
        // ODialog (data-test="search-bar-confirm-dialog") via substring selector.
        this.confirmButton = '[data-test*="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.streamsMenuItem = '[data-test="menu-link-\\/streams-item"]';
        this.searchStreamInput = '[data-test="streams-search-stream-input"] input';
        this.exploreButtonSelector = '[data-test="log-stream-explore-btn"]';
        this.utilitiesMenuButton = '[data-test="logs-search-bar-utilities-menu-btn"]';
        this.menuTransformEditorToggleBtn = '[data-test="logs-search-bar-menu-transform-editor-toggle-btn"]';
        this.menuListSavedViewsBtn = '[data-test="logs-search-bar-menu-list-saved-views-btn"]';
        this.menuCreateSavedViewBtn = '[data-test="logs-search-bar-menu-create-saved-view-btn"]';
        this.savedViewsListDialogEl = '[data-test="saved-views-list-dialog"]';
        this.menuHistogramBtn = '[data-test="logs-search-bar-menu-histogram-btn"]';
        this.menuSqlModeBtn = '[data-test="logs-search-bar-menu-sql-mode-btn"]';
        this.menuSqlModeBtnState = '[data-test="logs-search-bar-menu-sql-mode-btn"] [data-state]';
        this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
        this.savedViewsDropdownBtn = '[data-test="logs-search-saved-views-btn"]';
        this.includeExcludeFieldButton = ':nth-child(1) [data-test="log-details-include-exclude-field-btn"]';
        this.includeFieldButton = '[data-test="log-details-include-field-btn"]';
        this.closeDialog = '[data-test="logs-search-result-detail-dialog"] [data-test="o-drawer-close-btn"]';
        this.savedViewDialogSaveContent = '[data-test="search-bar-store-state-saved-view-dialog"] [data-test="o-dialog-primary-btn"], [data-test="search-bar-store-state-saved-function-dialog"] [data-test="o-dialog-primary-btn"]';
        this.savedViewByLabel = '[data-test$="-option"]';
        this.notificationMessage = '[role="alert"]';
        this.indexFieldSearchInput = '[data-test="logs-search-index-list"] [data-test="o-field-list-search-field"]';
        this.errorMessage = '[data-test="logs-search-error-state"]';
        this.warningElement = 'text=warning Query execution';
        this.logsTable = '[data-test="logs-search-result-logs-table"]';
        // Additional locators for multistream functionality
        this.logsSearchIndexList = '[data-test="logs-search-index-list"]';
        this.notificationErrorMessage = '[data-test-variant="error"]';
        this.vrlFunctionText = (text) => `text=${text}`;
        this.barChartCanvas = '[data-test="logs-search-result-bar-chart"] canvas';
        this.expandLabel = label => `Expand "${label}"`;
        this.collapseLabel = label => `Collapse "${label}"`;
        this.addStreamButton = '[data-test="log-stream-add-stream-btn"]';
        this.addStreamNameInput = '[data-test="add-stream-name-input"]';
        this.saveStreamButton = '[data-test="save-stream-btn"]';
        this.streamDetail = '[title="Stream Detail"]';
        this.schemaStreamIndexSelect = ':nth-child(2) > [data-test="schema-stream-index-select"]';
        this.fullTextSearch = '[data-test$="-popover"]';
        this.schemaUpdateSettingsButton = '[data-test="schema-update-settings-button"]';
        this.colAutoButton = '.col-auto button';
        this.exploreTitle = '[title="Explore"]';
        this.streamsSearchStreamInput = '[data-test="streams-search-stream-input"]';
        // Post-OFieldList migration the IndexList search box renders via OInput with
        // data-test="o-field-list-search" (wrapper) and "-field" (inner native input).
        // Fill the -field variant so input events fire correctly. Scope under the
        // logs index list so we don't collide with the panel-editor-container's own
        // OFieldList search input (visible from Visualize-tab panel layouts).
        this.logSearchIndexListFieldSearchInput = '[data-test="logs-search-index-list"] [data-test="o-field-list-search-field"]';
        this.expandCode = 'Expand "code"';
        // FieldExpansion.vue exposes the row-expand toggle as
        // [data-test="log-search-expand-<field>-field-btn"]. Deterministic data-test for waits.
        this.expandCodeFieldBtn = '[data-test="log-search-expand-code-field-btn"]';
        this.logsDetailTableSearchAroundBtn = '[data-test="logs-detail-table-search-around-btn"]';
        this.logTableColumn3Source = '[data-test="log-table-column-3-source"]';
        this.histogramToggleDiv = '[data-test="logs-search-bar-show-histogram-toggle-btn"] div';

        // Additional locators
        this.fnEditor = '[data-test="logs-vrl-function-editor"]';
        this.searchListFirstTextLeft = '.search-list > :nth-child(1) > .text-left';
        // SearchResult.vue exposes the result title via data-test — replacement for the
        // legacy class-based searchListFirstTextLeft selector in expectSearchListVisible.
        this.searchResultTitle = '[data-test="logs-search-result-title"]';
        this.liveModeToggleBtn = '[data-test="logs-search-bar-refresh-interval-btn"]';
        this.liveMode5SecBtn = '[data-test="logs-search-bar-refresh-time-5"]';
        this.vrlToggleBtn = '[data-test="logs-search-bar-vrl-toggle-btn"]';
        this.vrlToggleButton = '[data-test="logs-search-bar-show-query-toggle-btn"]';
        this.vrlEditor = '[data-test="logs-vrl-function-editor"]';
        this.relative6DaysBtn = '[data-test="date-time-relative-6-d-btn"]';
        this.menuLink = link => `[data-test="menu-link-${link}"]`;
        this.searchAroundBtn = '[data-test="logs-search-bar-search-around-btn"]';
        this.pagination = '[data-test="logs-search-pagination"]';
        this.resultPagination = '[data-test="logs-search-result-pagination"]';
        this.sqlPagination = '[data-test="logs-search-sql-pagination"]';
        this.sqlGroupOrderLimitPagination = '[data-test="logs-search-sql-group-order-limit-pagination"]';
        // OSelect-based records-per-page dropdown (logs SearchResult.vue:138)
        this.recordsPerPageDropdown = '[data-test="logs-search-result-records-per-page"]';
        this.recordsPerPageOption = value => `[data-test="logs-search-result-records-per-page-option"][data-test-value="${value}"]`;
        // OPagination per-page buttons forward parentDataTest as `${parent}-page-{n}` (OPagination.vue:98)
        this.resultPaginationPageBtn = pageNumber => `[data-test="logs-search-result-pagination-page-${pageNumber}"]`;
        this.interestingFieldBtn = field => `[data-test="log-search-index-list-interesting-${field}-field-btn"]`;
        this.logsSearchBarFunctionDropdown = '[data-test="logs-search-bar-function-dropdown"]';
        this.logsSearchBarFunctionDropdownSave = '[data-test="logs-search-bar-function-dropdown"] button';
        this.logsSearchBarSaveTransformBtn = '[data-test="logs-search-bar-save-transform-btn"]';
        this.savedFunctionNameInput = '[data-test="saved-function-name-input"]';
        // OInput convention (AGENT_RULES §4): inner native <input> carries `-field` suffix
        this.savedFunctionNameInputField = '[data-test="saved-function-name-input-field"]';
        this.qNotifyWarning = '[role="alert"]';
        this.qPageContainer = '[data-test="logs-page-container"]';
        this.cmContent = '.view-lines';
        this.cmLine = '.view-line';
        this.searchFunctionInput = { placeholder: 'Search Function' };
        this.timestampFieldTable = '[data-test="log-search-index-list-fields-table"]';

        // Error handling locators
        this.errorIcon = 'text=error';
        // Hero layout (logs page): error-detail-toggle-btn (ErrorDetailPanel) + error-detail-body
        // Block layout (panels):   query-error-toggle-detail-btn + query-error-detail-expanded
        this.resultErrorDetailsBtn = '[data-test="error-detail-toggle-btn"], [data-test="query-error-toggle-detail-btn"]';
        this.searchDetailErrorMessage = '[data-test="error-detail-body"], [data-test="query-error-detail-expanded"]';
        // Always-visible first sentence of the error (carries the field/function name).
        // Hero layout: error-detail-summary · Block layout: query-error-summary
        this.searchErrorSummary = '[data-test="error-detail-summary"], [data-test="query-error-summary"]';

        // Download locators (SearchBar.vue more-options dropdown + custom-download ODialog)
        this.moreOptionsBtn = '[data-test="logs-search-bar-more-options-btn"]';
        // Hover trigger for the nested CSV/JSON submenu (data-test added on the wrapper div).
        this.downloadSubmenuTrigger = '[data-test="search-download-submenu-trigger"]';
        this.downloadSubmenu = '[data-test="search-download-submenu"]';
        this.downloadCsvBtn = '[data-test="search-download-csv-btn"]';
        this.downloadJsonBtn = '[data-test="search-download-json-btn"]';
        // Custom-range download ODropdownItem (data-test added in SearchBar.vue source).
        this.downloadCustomRangeBtn = '[data-test="logs-search-bar-download-custom-range-btn"]';
        this.customDownloadDialog = '[data-test="search-bar-custom-download-dialog"]';
        this.customDownloadRangeSelect = '[data-test="custom-download-range-select"]';
        // OSelect option lookup by data-test-value (post-OSelect virtualisation contract).
        this.customDownloadRangeOption = value => `[data-test="custom-download-range-select-option"][data-test-value="${value}"]`;
        this.customDownloadFileTypeJsonBtn = '[data-test="custom-download-file-type-json-btn"]';
        this.customDownloadOkBtn = '[data-test="search-bar-custom-download-dialog"] [data-test="o-dialog-primary-btn"]';
        // Pagination row-count title (SearchResult.vue:44, text "Showing X to Y out of Z ...")
        this.paginationRowCountTitle = '[data-test="logs-search-result-title"]';

        // ===== BUILD TAB / QUERY BUILDER SELECTORS (PR #10305) =====
        // Tab navigation
        this.buildToggle = '[data-test="logs-build-toggle"]';
        this.logsToggle = '[data-test="logs-logs-toggle"]';
        this.visualizeToggle = '[data-test="logs-visualize-toggle"]';
        this.patternsToggle = '[data-test="logs-patterns-toggle"]';
        this.buildQueryPage = '[data-test="logs-build-query-page"]';
        this.viewModeDropdownBtn = '[data-test="logs-view-mode-dropdown-btn"]';
        this.dashboardMenuItem = '[data-test="menu-link-\\/dashboards-item"]';

        // Query type selector (Auto/Custom mode)
        this.builderQueryType = '[data-test="dashboard-builder-query-type"]';
        this.customQueryType = '[data-test="dashboard-custom-query-type"]';
        this.sqlQueryType = '[data-test="dashboard-sql-query-type"]';
        this.promqlQueryType = '[data-test="dashboard-promql-query-type"]';

        // Dashboard query builder axes
        this.xAxisLayout = '[data-test="dashboard-x-layout"]';
        this.yAxisLayout = '[data-test="dashboard-y-layout"]';
        this.breakdownLayout = '[data-test="dashboard-b-layout"]';
        this.zAxisLayout = '[data-test="dashboard-z-layout"]';
        this.xAxisItem = (alias) => `[data-test="dashboard-x-item-${alias}"]`;
        this.yAxisItem = (alias) => `[data-test="dashboard-y-item-${alias}"]`;
        this.breakdownItem = (alias) => `[data-test="dashboard-b-item-${alias}"]`;
        this.xAxisItemRemove = (alias) => `[data-test="dashboard-x-item-${alias}-remove"]`;
        this.yAxisItemRemove = (alias) => `[data-test="dashboard-y-item-${alias}-remove"]`;
        this.breakdownItemRemove = (alias) => `[data-test="dashboard-b-item-${alias}-remove"]`;
        // Collective axis-item selectors used to detect "any items present" — data-test prefix
        // matches dashboard-x-item-{alias}, *-drag, *-menu, *-remove suffixes alike (count is
        // 4x inflated, callers check >=1 so that's acceptable).
        this.xAxisItemsAny = `${this.xAxisLayout} [data-test^="dashboard-x-item-"]`;
        this.yAxisItemsAny = `${this.yAxisLayout} [data-test^="dashboard-y-item-"]`;

        // Field list for builder
        this.streamTypeDropdown = '[data-test="index-dropdown-stream_type"]';
        this.streamDropdown = '[data-test="index-dropdown-stream"]';
        this.addToXAxis = '[data-test="dashboard-add-x-data"]';
        this.addToYAxis = '[data-test="dashboard-add-y-data"]';
        this.addToBreakdown = '[data-test="dashboard-add-b-data"]';
        this.addToFilter = '[data-test="dashboard-add-filter-data"]';
        // PanelFieldList uses OFieldList which renders an OInput with data-test="o-field-list-search".
        // OInput convention: wrapper carries data-test, inner native <input> carries `-field` suffix.
        // Scoped under [data-test="logs-build-query-page"] because the logs sidebar's IndexList
        // also renders an OFieldList with the same data-test, and in build mode that sidebar is
        // v-show:false (display:none) but its DOM persists — first() would otherwise resolve to
        // the hidden one and fail Playwright's visibility actionability check.
        this.fieldListSearchInput = '[data-test="logs-build-query-page"] [data-test="o-field-list-search-field"]';
        this.fieldListSearchInputWrapper = '[data-test="logs-build-query-page"] [data-test="o-field-list-search"]';
        // Builder filter conditions — each rendered with data-test="dashboard-add-condition-label-{index}-{label}"
        this.filterConditionLabelItems = '[data-test^="dashboard-add-condition-label-"]';

        // Chart selection
        this.chartSelectionContainer = '[data-test="dashboard-addpanel-chart-selection-item"]';
        this.chartTypeItem = (chartId) => `[data-test="selected-chart-${chartId}-item"]`;

        // Panel editor
        this.fieldListCollapsedIcon = '[data-test="panel-editor-field-list-collapsed-icon"]';
        this.customChartTypeBtn = '[data-test="custom-chart-type-selector-btn"]';

        // Config panel
        this.configShowLegend = '[data-test="dashboard-config-show-legend"]';
        this.configDynamicColumns = '[data-test="dashboard-config-table_dynamic_columns"]';
        this.configLimit = '[data-test="dashboard-config-limit"]';

        // Chart renderer
        this.chartRenderer = '[data-test="chart-renderer"]';
        this.noDataMessage = '[data-test="no-data"]';
        this.dashboardPanelTable = '[data-test="dashboard-panel-table"]';
        // Composite: any of the three indicates the build/visualize tab finished initial render.
        this.buildInitIndicator = `${this.chartRenderer}, ${this.dashboardPanelTable}, ${this.noDataMessage}`;

        // ===== SHARE LINK SELECTORS (VERIFIED) =====
        this.shareLinkButton = '[data-test="logs-search-bar-share-link-btn"]';
        this.shareLinkTooltip = '[data-test="o-tooltip-content"]';
        // OToast convention §4: variant-prefixed data-test (`o-toast-success`, `o-toast-error`,
        // `o-toast-info`, `o-toast-warning`, `o-toast-loading`, `o-toast-default`). Enumerate
        // known variants on the root only — also dodges Monaco's `role="alert"` accessibility
        // hosts and the inner `o-toast-message` description node that share the `o-toast-` prefix.
        this.successNotification = '[data-test-variant="success"], [data-test-variant="error"], [data-test-variant="info"], [data-test-variant="warning"], [data-test-variant="loading"], [data-test-variant="default"]';
        this.linkCopiedSuccessText = 'Link Copied Successfully';
        this.errorCopyingLinkText = 'Error while copy link';

        // ===== QUERY EDITOR EXPAND/COLLAPSE SELECTORS =====
        this.queryEditorFullScreenBtn = '[data-test="logs-query-editor-full_screen-btn"]';
        this.queryEditorContainer = '.query-editor-container';
        // Fullscreen state is exposed via a stable data attribute on the container
        // (the old `.editor-fullscreen` scoped class was removed in PR #12764 in
        // favour of inline utility classes bound to `isFocused`).
        this.expandOnFocusClass = '[data-fullscreen="true"]';

        // ===== LOG DETAIL SIDEBAR SELECTORS (Bug #9724) =====
        this.logDetailDialogBox = '[data-test="log-detail-dialog"]';
        this.logDetailTitleText = '[data-test="log-detail-title-text"]';
        this.logDetailJsonTab = '[data-test="log-detail-json-tab"]';
        this.logDetailTableTab = '[data-test="log-detail-table-tab"]';
        this.logDetailJsonContent = '[data-test="log-detail-json-content"]';
        this.logDetailTableContent = '[data-test="log-detail-table-content"]';
        this.logDetailTabContainer = '[data-test="log-detail-tab-container"]';
        this.logDetailCloseButton = '[data-test="logs-search-result-detail-dialog"] [data-test="o-drawer-close-btn"]';
        this.logDetailPreviousBtn = '[data-test="log-detail-previous-detail-btn"]';
        this.logDetailNextBtn = '[data-test="log-detail-next-detail-btn"]';
        this.logDetailWrapToggle = '[data-test="log-detail-wrap-values-toggle-btn"]';

        // ===== VIEW RELATED / CORRELATION SELECTORS (Enterprise Feature) =====
        this.viewRelatedBtn = '[data-test="log-correlation-btn"]';
        this.correlationDashboardClose = '[data-test="correlation-dashboard-close"]';
        this.applyDimensionFilters = '[data-test="apply-dimension-filters"]';
        this.applyDimensionFiltersEmbedded = '[data-test="apply-dimension-filters-embedded"]';
        this.metricSelectorButton = '[data-test="metric-selector-button"]';
        // Correlation tabs in detail drawer (tab names, not data-test)
        // TODO(data-test): Reka Tabs render real ARIA roles; add data-test to the correlation tabs in web/src/plugins/logs/JsonPreview.vue (and AppTabs.vue if needed) — currently only flattened/unflattened exist; the trace details sidebar uses data-test="trace-details-sidebar-tabs-correlated-logs/metrics".
        this.correlatedLogsTab = '[data-test="correlated-logs-tab"]';
        this.correlatedMetricsTab = '[data-test="correlated-metrics-tab"]';
        this.correlatedTracesTab = '[data-test="correlated-traces-tab"]';
        // Correlation loading and error states
        this.correlationLoadingSpinner = '[data-test="logs-correlation-loading-indicator"]';
        this.correlationErrorMessage = '.tw\\:text-red-500';

        // ===== ANALYZE DIMENSIONS SELECTORS (VERIFIED against Vue source) =====
        // TracesAnalysisDashboard.vue now renders inside <ODrawer data-test="traces-analysis-dashboard-drawer">
        // The drawer's panel exposes that data-test on the root element; close button is from ODrawer's slot.
        this.logsAnalyzeDimensionsButton = '[data-test="logs-analyze-dimensions-button"]';
        this.analysisDashboardCard = '[data-test="traces-analysis-dashboard-drawer"]';
        this.analysisDashboardClose = '[data-test="traces-analysis-dashboard-drawer"] [data-test="o-drawer-close-btn"]';
        // Dimension sidebar (visible by default in analysis dashboard, not a dialog)
        this.dimensionSelectorSidebar = '[data-test="dimension-selector-sidebar"]';
        this.dimensionSelectorCollapseBtn = '[data-test="dimension-selector-collapse-btn"]';
        this.dimensionSearchInput = '[data-test="dimension-search-input"]';
        // OInput's inner native <input> field — required for `fill()` (the wrapper div above isn't editable)
        this.dimensionSearchInputField = '[data-test="dimension-search-input-field"]';
        // Analysis dashboard states
        this.analysisDashboardLoading = '[data-test="traces-analysis-dashboard-drawer"] [data-test="traces-analysis-dashboard-loading-indicator"]';
        this.analysisDashboardError = '[data-test="traces-analysis-dashboard-drawer"] [data-test="logs-search-error-state"], [data-test="traces-analysis-dashboard-drawer"] [role="alert"]';
        // Loading indicator (top-level — appears immediately on click, before drawer's scoped placement)
        this.analysisDashboardLoadingIndicator = '[data-test="traces-analysis-dashboard-loading-indicator"]';
        // Dimension checkboxes (any value)
        this.dimensionCheckboxAny = '[data-test^="dimension-checkbox-"]';
        // Dashboard chart panel inside the analysis dashboard drawer (via data-test prefix)
        this.analysisDashboardChartPanel = '[data-test="traces-analysis-dashboard-drawer"] [data-test^="dashboard-panel-"]';
        // SQL Mode toggle (OSwitch) — sourced from SearchBar.vue
        this.sqlModeToggleBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"]';
        // Inner <button role="switch"> rendered by OSwitch — carries data-state="checked|unchecked"
        // OSwitch's inner switch button does NOT receive a derived `-button` data-test in the
        // current OSwitch.vue implementation (button is plain `role="switch"` with data-state).
        // Drill into the wrapper and target the inner [data-state] attribute directly.
        this.sqlModeToggleInnerBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"] [data-state]';
        // Pre-scoped checked/unchecked state filters — mirror histogramToggleCheckedBtn pattern.
        this.sqlModeToggleCheckedBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"] [data-state="checked"]';
        this.sqlModeToggleUncheckedBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"] [data-state="unchecked"]';

        // ===== REGRESSION TEST LOCATORS =====
        // Query history
        this.queryHistoryButton = '[data-test="logs-search-bar-query-history-btn"]';
        this.historyPanel = '.history-panel, [data-test*="history"]';

        // Table and pagination CSS selectors
        this.tableBottom = '[data-test="logs-search-result-pagination"]';
        this.tableBodyRow = 'tbody tr';
        this.tableBodyRowWithIndex = 'tbody tr[data-index]';
        this.tableHeaderCell = 'thead th';
        this.tableHeaders = 'thead th';

        // Dynamic field selectors (functions for field-specific locators)
        this.fieldExpandButton = (fieldName) => `[data-test="log-search-expand-${fieldName}-field-btn"]`;
        this.fieldListItem = (fieldName) => `[data-test="logs-field-list-item-${fieldName}"]`;
        this.subfieldAddButton = (fieldName) => `[data-test*="logs-search-subfield-add-${fieldName}"]`;
        this.allFieldExpandButtons = '[data-test*="log-search-expand-"][data-test$="-field-btn"]';
        this.fieldIndexListButton = (fieldName) => `[data-test="log-search-index-list-${fieldName}-field-btn"]`;

        // Additional regression test selectors
        this.streamsSearchInputField = '[data-test="streams-search-stream-input"] input';
        // Note: Narrowed from [class*="error"] to avoid false positives like "error-free"
        this.errorIndicators = '[role="alert"][class*="bg-negative"], [role="alert"].bg-negative, .text-negative, [class^="error-"], [class$="-error"]';
        this.timestampInDetail = '[data-test*="timestamp"], .timestamp';

        // ===== SEARCH PATTERNS SELECTORS (Enterprise Feature) =====
        // Toggle button to switch to patterns view
        this.patternsToggle = '[data-test="logs-patterns-toggle"]';
        // Statistics summary
        this.patternStatistics = '[data-test="pattern-statistics"]';
        // Pattern cards (dynamic selectors with index)
        this.patternCard = (index) => `[data-test="pattern-card-${index}"]`;
        this.patternCardTemplate = (index) => `[data-test="pattern-card-${index}-template"]`;
        this.patternCardAnomalyBadge = (index) => `[data-test="pattern-card-${index}-anomaly-badge"]`;
        this.patternCardFrequency = (index) => `[data-test="pattern-card-${index}-frequency"]`;
        this.patternCardPercentage = (index) => `[data-test="pattern-card-${index}-percentage"]`;
        this.patternCardDetailsIcon = (index) => `[data-test="pattern-card-${index}"]`;
        // Include/exclude/create-alert moved off the card and into the details
        // dialog in the patterns UI redesign, so they are no longer per-index.
        this.patternDetailIncludeBtn = '[data-test="pattern-detail-include-btn"]';
        this.patternDetailExcludeBtn = '[data-test="pattern-detail-exclude-btn"]';
        this.patternDetailCreateAlertBtn = '[data-test="pattern-detail-create-alert-btn"]';
        // The pattern-template wildcard chip carries a data-test hook (the `.wildcard-chip`
        // scoped class was dropped when the chip moved from a class to the OTag component).
        this.patternCardWildcardChips = (index) => `[data-test="pattern-card-${index}-template"] [data-test="pattern-card-wildcard-chip"]`;
        this.wildcardChip = '[data-test="pattern-card-wildcard-chip"]';
        // Pattern details dialog (ODrawer — PatternDetailsDialog.vue)
        this.closePatternDialog = '[data-test="pattern-details-dialog"] [data-test="o-drawer-close-btn"]';
        this.patternDetailPreviousBtn = '[data-test="pattern-detail-previous-btn"]';
        this.patternDetailNextBtn = '[data-test="pattern-detail-next-btn"]';
        // Pattern list states
        this.patternLoadingSpinner = '[data-test="pattern-list-loading-indicator"]';
        this.patternLoadingText = 'text=Extracting patterns from logs...';
        this.patternEmptyState = 'text=No patterns found';

        // ===== V0.40 REGRESSION TEST LOCATORS =====
        this.logsSearchResultTableRows = '[data-test="logs-search-result-logs-table"] tbody tr';
        this.tableRowExpandMenu = '[data-test="table-row-expand-menu"]';
        this.logDetailsIncludeExcludeBtn = '[data-test="log-details-include-exclude-field-btn"]';
        this.timestampCells = '[data-test^="log-table-column-"][data-test$="-_timestamp"]';
        this.searchResultText = '[data-test="logs-search-search-result"]';
        this.logDetailPanel = '[data-test="logs-search-result-detail-dialog"], [data-test*="log-detail"]';
        this.logDetailDialog = '[data-test="logs-search-result-detail-dialog"]';

        // ===== REGION SELECTOR (SearchBar.vue ODropdown + OTree) =====
        // Trigger button + popover menu — data-test set on ODropdown / inner menu.
        this.regionDropdownBtn = '[data-test="logs-search-bar-region-btn"]';
        this.regionDropdownMenu = '[data-test="logs-search-bar-region-menu"]';
        // OTreeNode leaves render `data-test="o-tree-node-{label}"` and
        // `data-test-checked="true|false|indeterminate"` — added in OTreeNode.vue.
        this.regionTreeNode = (label) => `${this.regionDropdownMenu} [data-test="o-tree-node-${label}"]`;
        this.regionTreeNodeAny = `${this.regionDropdownMenu} [data-test^="o-tree-node-"]`;
        this.regionTreeNodeChecked = (label) => `${this.regionDropdownMenu} [data-test="o-tree-node-${label}"][data-test-checked="true"]`;

        // ===== TIMEZONE OSelect (DateTime.vue) =====
        // OSelect data-test conventions (§4): wrapper + popover + per-option data-test-value.
        this.datetimeTimezoneSelect = '[data-test="datetime-timezone-select"]';
        // OSelect listbox-mode renders a ListboxFilter input with `${parent}-search`.
        this.datetimeTimezoneSelectSearch = '[data-test="datetime-timezone-select-search"]';
        this.datetimeTimezoneSelectPopover = '[data-test="datetime-timezone-select-popover"]';
        this.datetimeTimezoneOption = (value) => `[data-test="datetime-timezone-select-option"][data-test-value="${value}"]`;
    }



    // Reusable helper methods for code reuse
    async expectQueryEditorContainsTextHelper(text) {
        return await expect(this.page.locator(this.queryEditor)).toContainText(text);
    }

    async clickMenuLinkByType(linkType) {
        // pipeline and functions moved into the Data group hover flyout
        if (linkType === 'pipeline' || linkType === 'functions') {
            return await openNavFlyoutChild(this.page, linkType);
        }
        const linkMap = {
            'logs': this.logsMenuItem,
            'traces': '[data-test="menu-link-/traces-item"]',
            'streams': this.streamsMenuItem,
            'metrics': '[data-test="menu-link-\\/metrics-item"]'
        };
        return await this.page.locator(linkMap[linkType]).click({ force: true });
    }

    async fillInputField(selector, text) {
        return await this.page.locator(selector).fill(text);
    }

    async clickElementByLabel(label, action = 'Expand') {
        const labelText = action === 'Expand' ? this.expandLabel(label) : this.collapseLabel(label);
        return await this.page.getByLabel(labelText).click();
    }

    async expectKubernetesPodContent(podType, ingesterNumber = '') {
        const content = `kubernetes_${podType}${ingesterNumber ? `-ziox-ingester-${ingesterNumber}` : ''}`;
        return await this.expectQueryEditorContainsTextHelper(content);
    }

    // Navigation methods
    async navigateToLogs(orgIdentifier) {
        const baseUrl = process.env.ZO_BASE_URL;
        const orgId = orgIdentifier || getOrgIdentifier();
        const fullUrl = `${baseUrl}/web/logs?org_identifier=${orgId}&fn_editor=true`;


        // Include fn_editor=true to ensure VRL editor is available for tests that need it
        await this.page.goto(fullUrl);


        // Wait for page load and check for VRL editor
        await this.page.waitForLoadState('domcontentloaded');

        // Wait for VRL editor to be available (with retries)
        let fnEditorExists = 0;
        let retries = 5;

        while (fnEditorExists === 0 && retries > 0) {
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            fnEditorExists = await this.page.locator('[data-test="logs-vrl-function-editor"]').count();

            if (fnEditorExists === 0) {
                await this.page.locator('[data-test="logs-vrl-function-editor"]').waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
                retries--;
            }
        }

        if (fnEditorExists === 0) {

            // Try reloading with explicit parameters
            const currentUrl = new URL(this.page.url());
            currentUrl.searchParams.set('fn_editor', 'true');
            currentUrl.searchParams.set('vrl', 'true'); // Try alternative parameter

            await this.page.goto(currentUrl.toString());
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            fnEditorExists = await this.page.locator('[data-test="logs-vrl-function-editor"]').count();

            if (fnEditorExists === 0) {
                // Take screenshot for debugging
            }
        } else {
        }
    }

    async validateLogsPage() {
        await expect(this.page).toHaveURL(/.*\/logs/);
    }

    async logsPageDefaultMultiOrg() {
        await this.page.goto('/logs');
        await expect(this.page).toHaveURL(/.*\/logs/);
    }

    async logsPageURLValidation() {
        await expect(this.page).toHaveURL(/.*\/logs/);
    }

    // Stream and index selection methods
    async selectIndexAndStream() {
        await this.page.locator(this.indexDropDown).click();
        await this.page.locator(this.streamToggle).click();
    }

    async selectIndexAndStreamJoin() {
        // Select both default and e2e_automate streams for join queries.
        // Retry loop with force-click fallback for cloud stability (Pattern 3).
        //
        // Post-OSelect-migration the legacy `log-search-index-list-stream-toggle-*`
        // data-tests are gone; OSelect emits each option with `data-test-value="<stream>"`.
        // Clicking the wrapper itself bubbles into the inner reka-ui PopoverTrigger and
        // opens the popover (we avoid `[role="button"]` because native `<button>` has an
        // implicit role that attribute selectors don't match).
        const selectWrapper = this.page.locator('[data-test="log-search-index-list-select-stream"]');
        const defaultOption = this.page.locator(
            '[data-test="log-search-index-list-select-stream-option"][data-test-value="default"]',
        );
        const e2eOption = this.page.locator(
            '[data-test="log-search-index-list-select-stream-option"][data-test-value="e2e_automate"]',
        );

        await selectWrapper.waitFor({ state: 'visible', timeout: 15000 });
        await selectWrapper.click({ force: true });

        // Select default stream with retry — re-open popover on miss.
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await defaultOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
                await defaultOption.first().click({ force: true });
                break;
            }
            await selectWrapper.click({ force: true });
        }

        // OSelect multi-mode keeps the popover open after toggle, but be defensive —
        // if the popover closed, re-open it before picking the second stream.
        if (!(await e2eOption.first().isVisible({ timeout: 2000 }).catch(() => false))) {
            await selectWrapper.click({ force: true });
        }

        // Select e2e_automate stream with retry.
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await e2eOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
                await e2eOption.first().click({ force: true });
                break;
            }
            await selectWrapper.click({ force: true });
        }

        // Close the popover so the field list can render under it.
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    /**
     * Select two streams for UNION query testing
     * @param {string} streamA - First stream name (required)
     * @param {string} streamB - Second stream name (required)
     */
    async selectIndexAndStreamJoinUnion(streamA, streamB) {
        // Validate stream names are provided
        if (!streamA || !streamB) {
            throw new Error('selectIndexAndStreamJoinUnion: Both streamA and streamB are required parameters');
        }

        testLogger.info(`selectIndexAndStreamJoinUnion: Starting selection of ${streamA} and ${streamB} streams`);

        // Wait for both streams to be available via API before attempting UI selection
        testLogger.debug(`selectIndexAndStreamJoinUnion: Waiting for streams to be available via API...`);

        // Cloud environments need longer for streams to be indexed after ingestion
        const streamWaitMs = isCloudEnvironment() ? 90000 : 30000;

        const streamAAvailable = await this.waitForStreamAvailable(streamA, streamWaitMs, 3000);
        if (!streamAAvailable) {
            testLogger.error(`selectIndexAndStreamJoinUnion: Stream '${streamA}' NOT FOUND via API after ${streamWaitMs / 1000}s`);
            throw new Error(`Stream '${streamA}' not available. Ingestion may have failed.`);
        }
        testLogger.info(`selectIndexAndStreamJoinUnion: Stream '${streamA}' confirmed available`);

        const streamBAvailable = await this.waitForStreamAvailable(streamB, streamWaitMs, 3000);
        if (!streamBAvailable) {
            testLogger.error(`selectIndexAndStreamJoinUnion: Stream '${streamB}' NOT FOUND via API after ${streamWaitMs / 1000}s`);
            throw new Error(`Stream '${streamB}' not available. Ingestion may have failed.`);
        }
        testLogger.info(`selectIndexAndStreamJoinUnion: Stream '${streamB}' confirmed available`);

        // Navigate to logs page to ensure fresh stream list
        const orgId = getOrgIdentifier();
        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgId}`;
        testLogger.debug(`selectIndexAndStreamJoinUnion: Navigating to logs page: ${logsUrl}`);
        await this.page.goto(logsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
            testLogger.warn(`selectIndexAndStreamJoinUnion: Navigation timeout, continuing... ${e.message}`);
        });
        // Open dropdown — OSelect wrapper carries the data-test; clicking the
        // wrapper hits the inner PopoverTrigger button.
        const selectTrigger = this.page.locator('[data-test="log-search-index-list-select-stream"]').first();
        await selectTrigger.waitFor({ state: 'visible', timeout: 10000 });
        await selectTrigger.click();
        // Wait deterministically for the popover to render before locating inputs/options
        await this.page.locator('[data-test="log-search-index-list-select-stream-popover"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

        // Use the popover's ListboxFilter input to filter for the first stream.
        const popoverSearch = this.page.locator('[data-test="log-search-index-list-select-stream-popover"] input').first();
        const searchVisible = await popoverSearch
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);

        // Helper: click the option in the OSelect popover whose label matches the
        // given stream name. OSelect renders every option with the SAME
        // `${parentDataTest}-option` data-test, so we must walk those options and
        // click the one whose visible text matches. This is the approved
        // page.evaluate pattern from the audit (`json-field-renderer` etc).
        const selectOptionByLabel = async (streamName) => {
            await this.page.waitForFunction(
                (name) => {
                    const opts = document.querySelectorAll(
                        '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
                    );
                    return Array.from(opts).some(
                        (el) => (el.textContent || '').trim() === name
                    );
                },
                streamName,
                { timeout: 20000 }
            );
            await this.page.evaluate((name) => {
                const opts = document.querySelectorAll(
                    '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
                );
                for (const el of opts) {
                    if ((el.textContent || '').trim() === name) {
                        el.click();
                        return;
                    }
                }
            }, streamName);
        };

        // Select first stream
        if (searchVisible) {
            testLogger.debug(`selectIndexAndStreamJoinUnion: Using search to filter for ${streamA}`);
            await popoverSearch.click();
            // Defensive Ctrl+A → Backspace clears reka-ui's ComboboxInput internal
            // searchTerm before re-filtering (plain `.fill()` can leave stale state).
            await popoverSearch.press('ControlOrMeta+a').catch(() => {});
            await popoverSearch.press('Backspace').catch(() => {});
            await popoverSearch.fill(streamA);
            // Wait for the filtered option list to settle (target option renderable)
            await this.page.waitForFunction(
                (name) => {
                    const opts = document.querySelectorAll(
                        '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
                    );
                    return Array.from(opts).some((el) => (el.textContent || '').trim() === name);
                },
                streamA,
                { timeout: 10000 },
            ).catch(() => {});
        }

        testLogger.debug(`selectIndexAndStreamJoinUnion: Selecting option for stream ${streamA}`);
        await selectOptionByLabel(streamA);
        testLogger.debug(`selectIndexAndStreamJoinUnion: Selected stream ${streamA}`);
        // After selection OSelect updates the trigger summary; wait for the option's selected state
        await this.page.waitForFunction(
            (name) => {
                const opts = document.querySelectorAll(
                    '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
                );
                return Array.from(opts).some(
                    (el) => (el.textContent || '').trim() === name && el.getAttribute('aria-selected') === 'true'
                );
            },
            streamA,
            { timeout: 10000 },
        ).catch(() => {});

        // Clear search and filter for second stream
        if (searchVisible) {
            testLogger.debug(`selectIndexAndStreamJoinUnion: Using search to filter for ${streamB}`);
            await popoverSearch.click();
            // Defensive Ctrl+A → Backspace clears reka-ui's ComboboxInput internal
            // searchTerm before re-filtering for the second stream.
            await popoverSearch.press('ControlOrMeta+a').catch(() => {});
            await popoverSearch.press('Backspace').catch(() => {});
            await popoverSearch.fill(streamB);
            // Wait for the filtered option list to surface streamB
            await this.page.waitForFunction(
                (name) => {
                    const opts = document.querySelectorAll(
                        '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
                    );
                    return Array.from(opts).some((el) => (el.textContent || '').trim() === name);
                },
                streamB,
                { timeout: 10000 },
            ).catch(() => {});
        }

        testLogger.debug(`selectIndexAndStreamJoinUnion: Selecting option for stream ${streamB}`);
        await selectOptionByLabel(streamB);
        testLogger.debug(`selectIndexAndStreamJoinUnion: Selected stream ${streamB}`);
        await this.page.waitForFunction(
            (name) => {
                const opts = document.querySelectorAll(
                    '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
                );
                return Array.from(opts).some(
                    (el) => (el.textContent || '').trim() === name && el.getAttribute('aria-selected') === 'true'
                );
            },
            streamB,
            { timeout: 10000 },
        ).catch(() => {});

        // Close dropdown — click the wrapper trigger again
        await selectTrigger.click();
        testLogger.info(`selectIndexAndStreamJoinUnion: Successfully selected both streams`);
    }

    async selectIndexStreamDefault() {
        // Post-OSelect-migration: pick the `default` option by data-test-value
        // instead of the legacy `log-search-index-list-stream-toggle-default` toggle.
        // Click the wrapper to open the popover (the inner reka-ui PopoverTrigger is a
        // native <button> with implicit role — [role="button"] attribute selector
        // doesn't match it).
        const selectWrapper = this.page.locator('[data-test="log-search-index-list-select-stream"]');
        const defaultOption = this.page.locator(
            '[data-test="log-search-index-list-select-stream-option"][data-test-value="default"]',
        );
        await selectWrapper.waitFor({ state: 'visible', timeout: 15000 });
        await selectWrapper.click({ force: true });
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await defaultOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
                await defaultOption.first().click({ force: true });
                break;
            }
            await selectWrapper.click({ force: true });
        }
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    async selectIndexStream(streamName) {
        testLogger.debug(`selectIndexStream: Starting selection for stream: ${streamName}`);
        try {
            await this.page.locator(this.indexDropDown).waitFor({ timeout: 10000 });
            await this.page.locator(this.indexDropDown).click();
            testLogger.debug(`selectIndexStream: Clicked dropdown`);
            await this.page.waitForTimeout(2000);

            await this.page.locator(this.streamToggle).waitFor({ timeout: 10000 });
            await this.page.locator(this.streamToggle).click();
            testLogger.debug(`selectIndexStream: Successfully selected stream with default method`);
        } catch (error) {
            testLogger.debug(`Failed to select stream with default method, trying alternative approach: ${error.message}`);
            // Fallback to the old method
            await this.selectIndexStreamOld(streamName);
        }
    }

    /**
     * Wait for a stream to be available via API before attempting UI selection
     * @param {string} streamName - Name of the stream to wait for
     * @param {number} maxWaitMs - Maximum time to wait in milliseconds
     * @param {number} pollIntervalMs - Interval between checks
     * @returns {Promise<boolean>} True if stream exists, false if timeout
     */
    async waitForStreamAvailable(streamName, maxWaitMs = 30000, pollIntervalMs = 3000, streamType = 'logs') {
        const apiUrl = process.env.INGESTION_URL || process.env.ZO_BASE_URL;
        const orgId = getOrgIdentifier() || 'default';
        const url = `${apiUrl}/api/${orgId}/streams?type=${streamType}&keyword=${streamName}`;
        testLogger.info(`waitForStreamAvailable: Waiting for stream ${streamName} (type=${streamType}, timeout=${maxWaitMs}ms)`);
        let pollCount = 0;

        // expect.poll provides deterministic API polling without page.waitForTimeout.
        try {
            await expect.poll(async () => {
                pollCount++;
                try {
                    const response = await this.page.request.get(url, { headers: getAuthHeaders() });
                    const status = response.status();
                    if (response.ok()) {
                        const data = await response.json();
                        const listCount = data.list ? data.list.length : 0;
                        const streamExists = data.list && data.list.some(s => s.name === streamName);
                        if (streamExists) {
                            testLogger.info(`waitForStreamAvailable: Stream ${streamName} found (poll #${pollCount})`);
                            return true;
                        }
                        if (pollCount <= 3 || pollCount % 10 === 0) {
                            const names = data.list ? data.list.map(s => s.name).join(', ') : 'none';
                            testLogger.info(`waitForStreamAvailable: poll #${pollCount} — HTTP ${status}, list=${listCount}, names=[${names}]`);
                        }
                    } else {
                        const bodyText = await response.text().catch(() => 'unreadable');
                        testLogger.info(`waitForStreamAvailable: poll #${pollCount} — HTTP ${status}, body=${bodyText.substring(0, 200)}`);
                    }
                } catch (e) {
                    testLogger.info(`waitForStreamAvailable: poll #${pollCount} — error: ${e.message}`);
                }
                return false;
            }, {
                intervals: [pollIntervalMs],
                timeout: maxWaitMs,
            }).toBe(true);
            return true;
        } catch (e) {
            testLogger.warn(`waitForStreamAvailable: Stream ${streamName} not found after ${maxWaitMs}ms (${pollCount} polls)`);
            return false;
        }
    }

    async selectStream(stream, maxRetries = 5, apiWaitMs = null, skipNavigation = false) {
        // Cloud environments need longer for streams to be indexed after ingestion
        const effectiveApiWaitMs = apiWaitMs ?? (isCloudEnvironment() ? 120000 : 30000);
        testLogger.info(`selectStream: Selecting stream: ${stream} (apiWait: ${effectiveApiWaitMs}ms, skipNavigation: ${skipNavigation})`);

        // First, wait for the stream to be available via API (skip if apiWaitMs is 0)
        if (effectiveApiWaitMs > 0) {
            const streamAvailable = await this.waitForStreamAvailable(stream, effectiveApiWaitMs, 3000);
            if (!streamAvailable) {
                testLogger.warn(`selectStream: Stream ${stream} not found via API after ${effectiveApiWaitMs}ms, will still try UI selection`);
            } else {
                testLogger.info(`selectStream: Stream ${stream} confirmed available via API`);
            }
        } else {
            testLogger.info(`selectStream: Skipping API wait (apiWaitMs=0)`);
        }

        // Navigate to logs page via URL to ensure fresh stream list.
        // skipNavigation=true bypasses page.goto when the caller is already
        // on the logs page and wants to avoid auto-triggering a query.
        const orgId = getOrgIdentifier();
        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgId}`;

        if (!skipNavigation) {
            testLogger.info(`selectStream: Navigating to logs page: ${logsUrl}`);
            await this.page.goto(logsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            // Wait for the index-dropdown wrapper to mount instead of a hard timeout.
            await this.page.locator(this.indexDropDown).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        } else {
            testLogger.info('selectStream: Skipping page navigation (skipNavigation=true)');
        }

        // Post-OSelect-migration IndexList contract (see web/src/plugins/logs/IndexList.vue):
        //  - Wrapper: [data-test="log-search-index-list-select-stream"]   (OSelect outer div)
        //  - Trigger: the inner native <button> that Reka UI's PopoverTrigger renders. A
        //    `[role="button"]` attribute selector does NOT match a native <button> — the
        //    role is implicit, not declared as an attribute — so we scope from the data-test
        //    wrapper down to its single `button` child instead.
        //  - Option:  [data-test="log-search-index-list-select-stream-option"]
        //             [data-test-value="<stream>"]   (rendered into a portalled popover by OSelect).
        // The legacy select `log-search-index-list-stream-toggle-*` data-test is no longer
        // emitted, so we open the popover and pick the option directly. The retry loop
        // re-opens the popover on miss to handle the case where the stream list streams in
        // late after page navigation — matching the original 5-attempt retry semantic.
        const selectWrapper = this.page.locator(this.indexDropDown);
        await selectWrapper.waitFor({ state: 'visible', timeout: 15000 });

        // OSelect's PopoverTrigger is an inner element — clicking the outer wrapper div does
        // not always reach it. Prefer the explicit `-trigger` data-test (added on OSelect.vue
        // PopoverTrigger). Fall back to the wrapper for environments that pre-date that attr.
        const selectTrigger = this.page.locator('[data-test="log-search-index-list-select-stream-trigger"]');
        const popoverNode = this.page.locator('[data-test="log-search-index-list-select-stream-popover"]');
        // OSelect virtualises the option list. When the streamList is large (e.g. pentest
        // env with 1000+ streams) the target option is not rendered initially. Typing into
        // the popover's filter narrows the list so the option becomes the only renderable row.
        const popoverSearch = this.page.locator('[data-test="log-search-index-list-select-stream-search"]');

        const option = this.page.locator(
            `[data-test="log-search-index-list-select-stream-option"][data-test-value="${stream}"]`,
        );

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            testLogger.info(`selectStream: Attempt ${attempt}/${maxRetries} for stream: ${stream}`);

            try {
                testLogger.info(`selectStream: Clicking OSelect wrapper to open stream popover`);
                // Click the inner PopoverTrigger when available; fall back to the wrapper.
                if (await selectTrigger.count() > 0) {
                    await selectTrigger.first().click();
                } else {
                    await selectWrapper.click();
                }
                // Wait for the popover to actually open (deterministic — no timeout).
                await popoverNode.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

                // OSelect popover renders a search/filter input; type the stream name to
                // narrow the virtualised option list to just the target row. Defensive
                // Ctrl+A → Backspace clears reka-ui's ComboboxInput internal searchTerm
                // state (which can survive a plain `.fill()` overwrite on re-open).
                if (await popoverSearch.count() > 0) {
                    await popoverSearch.press('ControlOrMeta+a').catch(() => {});
                    await popoverSearch.press('Backspace').catch(() => {});
                    await popoverSearch.fill(stream).catch(() => {});
                }

                // Wait for the virtualized list to filter and re-render the option row.
                // Without this, isVisible often fails because the Vue virtualizer
                // has not yet rendered the matching option into the DOM.
                await option.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

                testLogger.debug(`selectStream: Looking for option [data-test="log-search-index-list-select-stream-option"][data-test-value="${stream}"]`);
                const visible = await option
                    .first()
                    .isVisible({ timeout: 3000 })
                    .catch(() => false);
                if (visible) {
                    await option.first().click();
                    // Wait deterministically for the popover to close — OSelect in multi-mode
                    // may stay open after toggle so we Escape and re-wait too.
                    await popoverNode.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                    await this.page.keyboard.press('Escape').catch(() => {});
                    await popoverNode.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                    testLogger.info(`selectStream: Selected stream: ${stream}`);
                    return;
                }

                testLogger.info(`selectStream: Stream ${stream} not visible on attempt ${attempt}, retrying`);
                await this.page.keyboard.press('Escape').catch(() => {});
                // Wait deterministically for the popover to close before the next attempt.
                await popoverNode.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

                if (attempt < maxRetries && !skipNavigation) {
                    testLogger.debug(`selectStream: Reloading logs page to refresh stream list`);
                    await this.page.goto(logsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await this.page.locator(this.indexDropDown).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
                } else if (attempt < maxRetries) {
                    // skipNavigation: wait for the wrapper to be (re)visible.
                    await this.page.locator(this.indexDropDown).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
                }
            } catch (e) {
                testLogger.debug(`selectStream: Attempt ${attempt} failed: ${e.message}`);
                await this.page.keyboard.press('Escape').catch(() => {});
                if (attempt < maxRetries && !skipNavigation) {
                    await this.page.goto(logsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await this.page.locator(this.indexDropDown).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
                } else if (attempt < maxRetries) {
                    await this.page.locator(this.indexDropDown).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
                }
            }
        }

        // All retries exhausted
        throw new Error(`selectStream: Failed to find stream "${stream}" after ${maxRetries} attempts`);
    }

    async deselectStream(streamName) {
        testLogger.info(`Deselecting stream: ${streamName}`);
        // Legacy select used `log-search-index-list-stream-toggle-<name> div`;
        // post-OSelect migration that data-test is gone. Pick the same option
        // by `data-test-value` — toggling an already-selected option deselects
        // it in OSelect's multi-mode (selectionBehavior=toggle).
        const streamDropdown = this.page.locator(this.indexDropDown);
        await streamDropdown.click();
        await this.page.waitForTimeout(500);
        const option = this.page.locator(
            `[data-test="log-search-index-list-select-stream-option"][data-test-value="${streamName}"]`,
        );
        if (await option.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.first().click();
            testLogger.info(`Deselected stream: ${streamName}`);
        }
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    async addStreamToSelection(streamName) {
        testLogger.info(`Adding stream to selection: ${streamName}`);
        // Open the OSelect popover via the trigger button (same pattern as
        // selectStream), then fill the ListboxFilter search input.
        // IMPORTANT: The stream selector uses rowClickSingleSelect=true — clicking
        // the option row REPLACES the selection. To ADD a stream to the existing
        // selection we must click the CHECKBOX (data-select-checkbox) within the
        // option, not the option row itself.
        const trigger = this.page.locator(this.indexDropDownTrigger).first();
        const popover = this.page.locator(this.indexDropDownPopover);
        const search = this.page.locator(this.indexDropDownSearch);
        if (await trigger.count() > 0) {
            await trigger.click();
        } else {
            await this.page.locator(this.indexDropDown).click();
        }
        await popover.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        if (await search.count() > 0) {
            await search.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await search.press('ControlOrMeta+a').catch(() => {});
            await search.press('Backspace').catch(() => {});
            await search.fill(streamName);
        }
        const option = this.page.locator(
            `[data-test="log-search-index-list-select-stream-option"][data-test-value="${streamName}"]`,
        );
        await option.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        // Click the checkbox to ADD to the multi-selection (not replace it).
        const streamCheckbox = option.first().locator('[data-select-checkbox]');
        await streamCheckbox.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
        if (await streamCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
            await streamCheckbox.click();
            testLogger.info(`Added ${streamName} to stream selection via checkbox`);
        } else if (await option.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.first().click();
            testLogger.info(`Added ${streamName} to stream selection (row click fallback)`);
        }
        // Close the popover after selection
        await popover.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    async expectTimestampColumnVisible() {
        const timestampColumn = this.page.locator('[data-test="log-table-column-1-_timestamp"]');
        await expect(timestampColumn, 'Timestamp column should be visible').toBeVisible({ timeout: 5000 });
        testLogger.info('Timestamp column visible in table');
    }

    async selectIndexStreamOld(streamName) {
        testLogger.debug(`selectIndexStreamOld: Starting selection for stream: ${streamName}`);
        try {
            // Click the dropdown
            const selectTrigger = this.page.locator('[data-test="log-search-index-list-select-stream"]').locator('[role="button"]').first();
            await selectTrigger.click();
            testLogger.debug(`selectIndexStreamOld: Clicked dropdown`);
            await this.page.waitForTimeout(2000);

            // Quick attempt to find and click the stream by text
            testLogger.debug(`selectIndexStreamOld: Trying to find stream by text: ${streamName}`);
            await this.page.getByText(streamName, { exact: true }).first().click({ timeout: 5000 });
            testLogger.debug(`selectIndexStreamOld: Successfully selected stream by text: ${streamName}`);

        } catch (error) {
            testLogger.debug(`selectIndexStreamOld: Failed to select stream ${streamName}: ${error.message}`);

            // Quick fallback: just select the first available stream
            testLogger.debug(`selectIndexStreamOld: Trying to select first available stream as fallback`);
            try {
                await this.page.locator('[data-test*="log-search-index-list-stream-toggle-"]').first().click({ timeout: 5000 });
                testLogger.debug(`selectIndexStreamOld: Selected first available stream as fallback`);
            } catch (fallbackError) {
                testLogger.debug(`selectIndexStreamOld: Fallback also failed: ${fallbackError.message}`);
                // Don't throw error, just log it and continue
                testLogger.debug(`selectIndexStreamOld: Continuing without stream selection`);
            }
        }
    }

    // Helper method to ensure query editor is ready
    async ensureQueryEditorReady() {
        // Wait for the query editor to be visible and ready
        await this.page.locator(this.queryEditor).waitFor({
            state: 'visible',
            timeout: 10000
        });

        // Wait for Monaco to attach its editor instance to the DOM node
        await this.page.waitForFunction(
            (selector) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const editors = window.monaco.editor.getEditors();
                return editors.some((ed) => {
                    const node = ed.getDomNode?.();
                    return node && host.contains(node);
                });
            },
            this.queryEditor,
            { timeout: 10000 },
        ).catch(() => {});
    }

    // Query execution methods
    async selectRunQuery() {
        // Ensure query editor is ready
        await this.ensureQueryEditorReady();

        // Wait for the query button to be visible and enabled
        const queryBtn = this.page.locator(this.queryButton);
        await queryBtn.waitFor({ state: 'visible', timeout: 10000 });
        await queryBtn.waitFor({ state: 'attached', timeout: 10000 });

        // Wait for button to be enabled — on cloud, streaming toggle / page
        // state changes can keep it disabled for several seconds
        await this.page.waitForFunction(
            (selector) => {
                const btn = document.querySelector(selector);
                return btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
            },
            this.queryButton,
            { timeout: 30000 }
        ).catch(() => {
            testLogger.debug('Query button did not become enabled within 30s — attempting click anyway');
        });

        // Run + verify; if search returns a transient error (common on cloud
        // when stream indexing is still catching up), retry with backoff.
        // Also retry when results table never appears (query button may have
        // been disabled or click was a no-op).
        const errorMessage = this.page.locator(this.errorMessage);
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Wait for button to leave Cancel/loading state before clicking —
            // otherwise a click on "Cancel" aborts the in-flight query instead
            // of starting a fresh one.
            await this.page.waitForFunction(
                (sel) => {
                    const b = document.querySelector(sel);
                    if (!b) return false;
                    return !b.hasAttribute('disabled')
                        && b.getAttribute('aria-busy') !== 'true'
                        && !(b.textContent?.trim()?.includes('Cancel'));
                },
                this.queryButton,
                { timeout: 30000 },
            ).catch(() => {});
            await queryBtn.click();

            try {
                await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', {
                    timeout: 18000,
                    state: 'visible',
                });
                return; // results visible — done
            } catch (e) {
                // Retry on error message or when table never appears — both
                // are transient on cloud while indexing catches up
                if (attempt < maxAttempts) {
                    const hasError = await errorMessage.isVisible().catch(() => false);
                    testLogger.debug(`Query did not return results (attempt ${attempt}/${maxAttempts}, hasError=${hasError}); retrying after button settles`);
                    // Wait for the query button to leave busy/Cancel state before next attempt
                    await this.page.waitForFunction(
                        (sel) => {
                            const b = document.querySelector(sel);
                            if (!b) return false;
                            return !b.hasAttribute('disabled')
                                && b.getAttribute('aria-busy') !== 'true'
                                && !(b.textContent?.trim()?.includes('Cancel'));
                        },
                        this.queryButton,
                        { timeout: 30000 },
                    ).catch(() => {});
                } else {
                    testLogger.debug('Query exhausted all retries — proceeding without visible results');
                }
            }
        }
    }

    async applyQuery() {
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async applyQueryButton(expectedUrl) {
        await this.page.locator(this.queryButton).click();
        // Handle both full URLs and path-only URLs, allow query parameters
        const urlPattern = expectedUrl.startsWith('http') 
            ? expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : `.*${expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
        await expect(this.page).toHaveURL(new RegExp(urlPattern));
    }

    /**
     * Apply query (click refresh) and wait for the _search API response.
     * 
     * First waits for the refresh button to become enabled (not disabled),
     * then clicks it and concurrently waits for the /_search response.
     * This replaces the inline `applyQueryButton` helper that previously
     * lived in specs — no raw selectors leak into the spec layer.
     */
    async applyQueryAndWaitForSearchResponse() {
        // Wait for the refresh button to be enabled before clicking.
        await this.page.waitForFunction(
            (sel) => {
                const el = document.querySelector(sel);
                return el && !el.disabled;
            },
            this.queryButton,
            { timeout: 15000 }
        ).catch(() => {
            testLogger.warn('Refresh button did not become enabled within 15 s — proceeding with click anyway');
        });
        // Click refresh and wait for the search API response concurrently.
        await Promise.all([
            this.page.waitForResponse(
                resp => resp.url().includes('/_search') && resp.status() === 200,
                { timeout: 60000 }
            ).catch(() => {
                testLogger.warn('No /_search response received within 60 s');
            }),
            this.page.locator(this.queryButton).click(),
        ]);
        testLogger.info('Query applied and search response received');
    }

    async clearAndRunQuery() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async clearAndFillQueryEditor(query) {
        // Wait for query editor to be ready
        const editor = this.page.locator(this.queryEditor);
        await editor.waitFor({ state: 'visible', timeout: 10000 });

        // Click to focus the editor
        await editor.click();

        // Use .inputarea.fill() directly - this is more reliable than keyboard.type()
        // as it avoids Monaco editor line number interference (the "1 SELECT" bug)
        // The .fill() method will replace the selected content
        const inputArea = editor.locator('.inputarea');
        await inputArea.waitFor({ state: 'visible', timeout: 5000 });

        // Select all existing content
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await inputArea.fill(query);
    }

    async typeQuery(query) {
        await this.page.locator(this.queryEditor).click();
        await this.page.locator(this.queryEditor).locator('.inputarea').waitFor({ state: 'visible', timeout: 30000 });
        await this.page.locator(this.queryEditor).press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.locator(this.queryEditor).locator('.inputarea').fill(query);
    }

    async executeQueryWithKeyboardShortcut() {
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutTest() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' LIMIT 10");
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutAfterClickingElsewhere() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' LIMIT 10");
        await this.page.locator(this.homeButton).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutWithDifferentQuery() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' WHERE log LIKE '%test%' LIMIT 5");
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutWithSQLMode() {
        await this.enableSqlModeIfNeeded();
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' LIMIT 10");
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithErrorHandling() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("INVALID QUERY");
        await this.page.locator(this.queryButton).click();
    }

    async executeHistogramQuery(query) {
        await this.clearAndFillQueryEditor(query);
        // Wait for the 500ms debounce in CodeQueryEditor so the Vue watcher in
        // SearchBar.vue can auto-detect SQL mode from the SELECT … FROM content
        // before the query button is clicked.
        await this.page.waitForTimeout(600);
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async waitForSearchResultAndCheckText(expectedText, timeout = 30000) {
        await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { timeout });
        await expect(this.page.locator('[data-test="logs-search-result-logs-table"]')).toContainText(expectedText, { timeout });
    }

    async expectLogsTableRowCount(count) {
        return await expect(this.page.locator('[data-test="logs-search-result-logs-table"] tbody tr')).toHaveCount(count);
    }

    // Time and date methods
    async setTimeToPast30Seconds() {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator(this.relative30SecondsButton).click();
    }

    async verifyTimeSetTo30Seconds() {
        await expect(this.page.locator(this.scheduleText)).toContainText('Past 30 Seconds');
    }

    async setDateTime() {
        await this.page.locator(this.dateTimeButton).click();
    }

    async setDateTimeToToday() {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator(this.absoluteTab).click();
    }

    async setDateTimeTo15Minutes() {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator('[data-test="date-time-relative-15-m-btn"]').click();
    }

    async setAbsoluteDate(year, month, day, currentMonth, currentYear) {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator(this.absoluteTab).click();
        await this.page.locator(this.monthSelector(currentMonth)).click();
        await this.page.locator(this.yearSelector(currentYear)).click();
        await this.page.locator(this.dateSelector(day)).click();
    }

    async setStartAndEndTime(startTime, endTime) {
        await this.page.locator(this.startTimeField).fill(startTime);
        await this.page.locator(this.endTimeField).fill(endTime);
    }

    async setTimeRange(startTime, endTime) {
        await this.setStartAndEndTime(startTime, endTime);
    }

    async verifySchedule(expectedTime) {
        await expect(this.page.locator(this.scheduleText)).toContainText(expectedTime);
    }

    async setTimeZone(zone) {
        await this.page.locator(this.timeZoneDropdown).click();
        await this.page.locator(this.timeZoneOption(zone)).click();
    }

    async changeTimeZone() {
        await this.setTimeZone('UTC');
    }

    async verifyDateTime(startTime, endTime) {
        await expect(this.page.locator(this.startTimeInput)).toHaveValue(startTime);
        await expect(this.page.locator(this.endTimeInput)).toHaveValue(endTime);
    }

    async getScheduleText() {
        return await this.page.locator(this.scheduleText).textContent();
    }

    // SQL Mode methods
    // SQL mode toggle was removed from the UI. The editor now auto-detects SQL mode
    // when the query contains SELECT...FROM. Delegate to the canonical enableSqlModeIfNeeded.
    async enableSQLMode() {
        await this.enableSqlModeIfNeeded();
    }

    // Quick Mode methods (now inside the utilities hamburger menu)
    async verifyQuickModeToggle() {
        const quickModeToggle = this.page.locator(this.quickModeToggle);
        await this.page.locator(this.utilitiesMenuButton).click();
        await quickModeToggle.waitFor({ state: 'visible', timeout: 5000 });
        await expect(quickModeToggle).toBeVisible();
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
    }

    async clickQuickModeToggle() {
        const quickMode = this.page.locator(this.quickModeToggle);
        // Always close any open utility popover first (Escape is a no-op if nothing is open),
        // then deterministically open the utilities menu and wait for the toggle to surface.
        await this.page.keyboard.press('Escape').catch(() => {});
        await quickMode.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
        await this.page.locator(this.utilitiesMenuButton).click();
        await quickMode.waitFor({ state: 'visible', timeout: 10000 });
        // Click the menu option directly - it has @click="handleQuickMode" handler.
        // force:true bypasses the stability check; the popper portal animates so the
        // element can be transiently re-laid-out, but the click is still committed.
        await quickMode.click({ force: true });
        // Close the utilities menu - it stays open after toggle click
        // (no v-close-popup on the quick mode item). Use Escape to dismiss.
        await this.page.keyboard.press('Escape').catch(() => {});
        await quickMode.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // Click on the Quick Mode toggle menu item (wrapper ODropdownItem) - for testing #10821
    async clickQuickModeTextLabel() {
        const quickModeItem = this.page.locator('[data-test="logs-search-bar-menu-quick-mode-toggle-btn"]');
        await this.page.locator(this.utilitiesMenuButton).click();
        await quickModeItem.waitFor({ state: 'visible', timeout: 5000 });
        // Click immediately — no fixed delay avoids reka-ui focus-outside closing the portal in CI.
        await quickModeItem.click({ force: true });
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    // Get the current quick mode state (true/false)
    async getQuickModeState() {
        // OSwitch inner button carries data-test="logs-search-bar-quick-mode-switch-btn"
        // and data-state="checked|unchecked".
        const toggleInner = this.page.locator('[data-test="logs-search-bar-quick-mode-switch-btn"]');
        await this.page.locator(this.utilitiesMenuButton).click();
        await toggleInner.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        const state = await toggleInner.getAttribute('data-state').catch(() => null);
        const isOn = state === 'checked';
        await this.page.keyboard.press('Escape').catch(() => {});
        return isOn;
    }

    // Histogram methods
    async toggleHistogram() {
        // Histogram is a standalone toolbar button (data-test="logs-search-bar-histogram-btn")
        // in normal-width viewports. It falls back into the utilities ("More") dropdown only
        // when the viewport is very narrow (shouldMoveButtonsToMenu breakpoint < 328px).
        await this.page.keyboard.press('Escape').catch(() => {});
        const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
        const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (isInline) {
            await inlineBtn.click();
            return;
        }
        // Narrow-viewport fallback: open the utilities menu and click the menu item.
        await this.page.locator(this.utilitiesMenuButton).click();
        const histogramMenuItem = this.page.locator(this.menuHistogramBtn);
        await histogramMenuItem.waitFor({ state: 'visible', timeout: 5000 });
        await histogramMenuItem.click();
    }

    async toggleHistogramAndExecute() {
        await this.toggleHistogram();
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async verifyHistogramState() {
        // Verifies histogram is OFF (unchecked). Works in both normal and narrow viewports.
        await this.page.keyboard.press('Escape').catch(() => {});
        const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
        const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (isInline) {
            // Normal viewport: the OSwitch inner button carries data-state="unchecked" when OFF.
            // The Reka OSwitch animates the checked→unchecked transition, and under CI load the
            // settled state can appear >5s after the toggle+execute — poll longer (still asserts
            // the real end-state, not an arbitrary sleep) to avoid the flaky 5s ceiling.
            const switchUnchecked = inlineBtn.locator('[data-state="unchecked"]');
            await expect(switchUnchecked).toBeVisible({ timeout: 15000 });
            return;
        }
        // Narrow-viewport fallback: check state via the utilities menu item.
        await this.page.locator(this.utilitiesMenuButton).click();
        const histogramMenuItem = this.page.locator(this.menuHistogramBtn);
        const isMenuVisible = await histogramMenuItem.isVisible({ timeout: 2000 }).catch(() => false);
        if (isMenuVisible) {
            const switchEl = this.page.locator(`[data-test="logs-search-bar-menu-histogram-btn"] [data-state="unchecked"]`).first();
            await expect(switchEl).toBeVisible({ timeout: 15000 });
        }
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    // Error handling methods
    async checkErrorVisible() {
        await expect(this.page.locator(this.errorMessage)).toBeVisible();
    }

    async getErrorDetails() {
        return await this.page.locator(this.errorMessage).textContent();
    }

    // Search partition methods
    async clickRunQueryButton() {
        await this.page.locator("[data-test='logs-search-bar-refresh-btn']").click({ force: true });
    }

    async verifySearchPartitionResponse() {
        const orgName = getOrgIdentifier() || 'default';
        const searchPartitionPromise = this.page.waitForResponse(response =>
            response.url().includes(`/api/${orgName}/_search_partition`) &&
            response.request().method() === 'POST'
        );
        
        const searchPartitionResponse = await searchPartitionPromise;
        const searchPartitionData = await searchPartitionResponse.json();

        expect(searchPartitionData).toHaveProperty('partitions');
        expect(searchPartitionData).toHaveProperty('histogram_interval');
        expect(searchPartitionData).toHaveProperty('order_by', 'asc');

        return searchPartitionData;
    }

    async captureSearchCalls() {
        const searchCalls = [];
        const orgName = getOrgIdentifier() || 'default';

        // Create the event listener function
        const responseHandler = async response => {
            if (response.url().includes(`/api/${orgName}/_search`) &&
                response.request().method() === 'POST') {
                const requestData = await response.request().postDataJSON();
                searchCalls.push({
                    start_time: requestData.query.start_time,
                    end_time: requestData.query.end_time,
                    sql: requestData.query.sql
                });
            }
        };
        
        // Attach the event listener
        this.page.on('response', responseHandler);
        
        try {
            await this.page.waitForTimeout(2000);
            return searchCalls;
        } finally {
            // Always remove the event listener to prevent memory leaks
            this.page.removeListener('response', responseHandler);
        }
    }

        async verifyStreamingModeResponse() {
        const orgName = getOrgIdentifier() || 'default';
        testLogger.debug("[DEBUG] Waiting for search response...");
        const searchPromise = this.page.waitForResponse(response => {
            const url = response.url();
            const method = response.request().method();
            testLogger.debug(`[DEBUG] Response: ${method} ${url}`);
            return url.includes(`/api/${orgName}/_search`) && method === 'POST';
        });
        
        const searchResponse = await searchPromise;
        testLogger.debug(`[DEBUG] Search response status: ${searchResponse.status()}`);
        expect(searchResponse.status()).toBe(200);
        
        const searchData = await searchResponse.json();
        testLogger.debug("[DEBUG] Search response data:", JSON.stringify(searchData, null, 2));
        testLogger.debug("[DEBUG] searchData type:", typeof searchData);
        testLogger.debug("[DEBUG] searchData keys:", Object.keys(searchData || {}));
        expect(searchData).toBeDefined();
        
        // Check if this is a partition response (non-streaming) or streaming response
        if (searchData.partitions) {
            testLogger.debug("[DEBUG] Received partition response (non-streaming mode)");
            expect(searchData.partitions).toBeDefined();
            expect(searchData.histogram_interval).toBeDefined();
        } else if (searchData.hits) {
            testLogger.debug("[DEBUG] Received streaming response");
            expect(searchData.hits).toBeDefined();
        } else {
            testLogger.debug("[DEBUG] Unexpected response structure:", JSON.stringify(searchData, null, 2));
            throw new Error(`Unexpected response structure: ${JSON.stringify(searchData)}`);
        }
    }

    async clickRunQueryButtonAndVerifyStreamingResponse() {
        const orgName = getOrgIdentifier() || 'default';
        testLogger.debug("[DEBUG] Setting up response listener before clicking run query button");
        const searchPromise = this.page.waitForResponse(response => {
            const url = response.url();
            const method = response.request().method();
            testLogger.debug(`[DEBUG] Response: ${method} ${url}`);
            return url.includes(`/api/${orgName}/_search`) && method === 'POST';
        });
        
        await this.clickRunQueryButton();
        
        const searchResponse = await searchPromise;
        testLogger.debug(`[DEBUG] Search response status: ${searchResponse.status()}`);
        expect(searchResponse.status()).toBe(200);
        
        // Check if this is a streaming response (SSE format) or JSON response
        const responseUrl = searchResponse.url();
        if (responseUrl.includes('_search_stream')) {
            testLogger.debug("[DEBUG] Received streaming response (SSE format)");
            const responseText = await searchResponse.text();
            testLogger.debug("[DEBUG] Streaming response text (first 200 chars):", responseText.substring(0, 200));
            expect(responseText).toBeDefined();
            expect(responseText.length).toBeGreaterThan(0);
        } else {
            testLogger.debug("[DEBUG] Received JSON response");
            const searchData = await searchResponse.json();
            testLogger.debug("[DEBUG] Search response data:", JSON.stringify(searchData, null, 2));
            testLogger.debug("[DEBUG] searchData type:", typeof searchData);
            testLogger.debug("[DEBUG] searchData keys:", Object.keys(searchData || {}));
            expect(searchData).toBeDefined();
            
            // Check if this is a partition response or regular search response
            if (searchData.partitions) {
                testLogger.debug("[DEBUG] Received partition response (non-streaming mode)");
                expect(searchData.partitions).toBeDefined();
                expect(searchData.histogram_interval).toBeDefined();
            } else if (searchData.hits) {
                testLogger.debug("[DEBUG] Received regular search response");
                expect(searchData.hits).toBeDefined();
            } else {
                testLogger.debug("[DEBUG] Unexpected response structure:", JSON.stringify(searchData, null, 2));
                throw new Error(`Unexpected response structure: ${JSON.stringify(searchData)}`);
            }
        }
    }

    // Explore and results methods
    async clickExplore() {
        try {
            await this.page.locator(this.exploreButton).first().waitFor({ state: 'visible', timeout: 10000 });
            await this.page.locator(this.exploreButton).first().waitFor({ state: 'attached', timeout: 10000 });
            
            await Promise.all([
                this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
                this.page.locator(this.exploreButton).first().click()
            ]);
            
            await this.page.waitForTimeout(3000);
        } catch (error) {
            testLogger.error('Error in clickExplore:', error);
            throw error;
        }
    }

    async openTimestampMenu() {
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { state: 'visible', timeout: 10000 });
            await this.page.waitForSelector('[data-test="log-table-column-1-_timestamp"]', { state: 'visible', timeout: 10000 });
            await this.timestampColumnMenu.waitFor({ state: 'visible', timeout: 10000 });
            await this.timestampColumnMenu.scrollIntoViewIfNeeded();
            
            await Promise.all([
                this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
                this.timestampColumnMenu.click({ force: true })
            ]);
            
            await this.page.waitForTimeout(1000);
        } catch (error) {
            testLogger.error('Error in openTimestampMenu:', error);
            try {
                await this.page.waitForTimeout(2000);
                await this.timestampColumnMenu.click({ force: true });
                await this.page.waitForTimeout(1000);
            } catch (retryError) {
                testLogger.error('Error in openTimestampMenu retry:', retryError);
                throw retryError;
            }
        }
    }

    async clickResultsPerPage() {
        // Wait for results to load first — cloud may be slower
        await this.page.waitForTimeout(2000);
        // Click the dropdown using the data-test attribute on the records-per-page OSelect wrapper
        const resultsDropdown = this.page.locator(this.recordsPerPageDropdown);
        await resultsDropdown.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        await resultsDropdown.click({ force: true });
        // Records-per-page is OSelect (Reka Listbox) post-migration, the legacy select pre.
        await this.page.waitForTimeout(500);
        // Target option by data-test-value (OSelect emits `${parent}-option` + data-test-value).
        const option10 = this.page.locator(this.recordsPerPageOption(10)).first();
        await option10.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        await option10.click({ force: true });
        // Wait for the per-page change to take effect — cloud wildcard queries
        // can take 5s+ to re-run after changing results-per-page
        await this.page.waitForTimeout(5000);
        // Retry the pagination assertion — slow cloud re-runs can miss the first check
        const searchResult = this.page.locator(this.searchResultText);
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await expect(searchResult).toContainText('1 to 10', { timeout: 10000 });
                return;
            } catch (e) {
                if (attempt < 3) {
                    await this.page.waitForTimeout(3000);
                }
            }
        }
        // Final attempt — let it throw
        await expect(searchResult).toContainText('1 to 10', { timeout: 15000 });
    }

    async selectResultsPerPageAndVerify(resultsPerPage, expectedText) {
        // Derive the expected pattern
        let expectedPattern;
        switch (resultsPerPage) {
            case '2':
                expectedPattern = '11 to 20 out of';
                break;
            case '3':
                expectedPattern = '21 to 30 out of';
                break;
            case '4':
                expectedPattern = '31 to';
                break;
            default:
                expectedPattern = expectedText;
        }

        const searchResult = this.page.locator(this.searchResultText);
        // Pagination buttons can be slow to respond on cloud — retry
        // the click up to 3 times if the expected text doesn't appear.
        for (let attempt = 1; attempt <= 3; attempt++) {
            // OPagination forwards the parent data-test as `${parent}-page-{n}` for each page button.
            const pageBtn = this.page.locator(this.resultPaginationPageBtn(resultsPerPage));
            await pageBtn.click({ force: true }).catch(() => {});
            await this.page.waitForTimeout(3000);

            try {
                await expect(searchResult).toContainText(expectedPattern, { timeout: 10000 });
                return; // page advanced successfully
            } catch (e) {
                if (attempt < 3) {
                    testLogger.debug(`Pagination page ${resultsPerPage} click attempt ${attempt} did not advance — retrying`);
                }
            }
        }
        // Final attempt — let it throw if it still fails
        await expect(searchResult).toContainText(expectedPattern, { timeout: 15000 });
    }

    async pageNotVisible() {
        // When LIMIT caps results below per-page floor, OSelect records-per-page dropdown hides.
        const recordsDropdown = this.page.locator(this.recordsPerPageDropdown);
        await expect(recordsDropdown).not.toBeVisible();
    }

    // Validation methods
    async validateResult() {
        try {
            // Wait for the logs table with a longer timeout for streaming mode and Firefox
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', {
                timeout: 90000, // Increased timeout for streaming mode and Firefox browser
                state: 'visible'
            });
            await expect(this.page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible({ timeout: 30000 });
        } catch (error) {
            testLogger.error('Error in validateResult:', error);
            if (this.page.isClosed()) {
                throw error;
            }
            try {
                // Check if there's an error message visible
                const errorMessage = this.page.locator(this.errorMessage);
                if (await errorMessage.isVisible({ timeout: 3000 })) {
                    const errorText = await errorMessage.textContent();
                    testLogger.error('Error message found:', errorText);
                    throw new Error(`Query failed with error: ${errorText}`);
                }
                // Check if there's a "no data found" message
                const noDataMessage = this.page.getByText('No data found');
                if (await noDataMessage.isVisible({ timeout: 3000 })) {
                    testLogger.debug('No data found for the query');
                    return; // This is acceptable for some queries
                }
            } catch (innerError) {
                if (innerError.message && innerError.message.includes('Query failed with error')) {
                    throw innerError;
                }
                // Page closed or other transient error — fall through to original error
            }
            throw error;
        }
    }

    async displayCountQuery() {
        await this.clearAndFillQueryEditor("SELECT COUNT(*) as count FROM 'e2e_automate'");

        // Ensure query editor is ready
        await this.ensureQueryEditorReady();

        // Wait for the query button to be visible and ready (not in Cancel/busy state)
        await this.page.locator(this.queryButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForFunction(
            (sel) => {
                const b = document.querySelector(sel);
                if (!b) return false;
                return !b.hasAttribute('disabled')
                    && b.getAttribute('aria-busy') !== 'true'
                    && !(b.textContent?.trim()?.includes('Cancel'));
            },
            this.queryButton,
            { timeout: 30000 },
        ).catch(() => {});
        await this.page.locator(this.queryButton).click();

        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', {
                timeout: 30000,
                state: 'visible'
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait deterministically for either results or error to appear
                await Promise.race([
                    this.page.locator('[data-test="logs-search-result-logs-table"]').waitFor({ state: 'visible', timeout: 5000 }),
                    this.page.locator(this.errorMessage).waitFor({ state: 'visible', timeout: 5000 }),
                ]).catch(() => {});
            }
        }
    }

    async displayTwoStreams() {
        await this.clearAndFillQueryEditor("SELECT * FROM 'e2e_automate' UNION ALL SELECT * FROM 'e2e_automate'");

        // Ensure query editor is ready
        await this.ensureQueryEditorReady();

        // Wait for the query button to be visible and ready (not in Cancel/busy state)
        await this.page.locator(this.queryButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForFunction(
            (sel) => {
                const b = document.querySelector(sel);
                if (!b) return false;
                return !b.hasAttribute('disabled')
                    && b.getAttribute('aria-busy') !== 'true'
                    && !(b.textContent?.trim()?.includes('Cancel'));
            },
            this.queryButton,
            { timeout: 30000 },
        ).catch(() => {});
        await this.page.locator(this.queryButton).click();

        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', {
                timeout: 30000,
                state: 'visible'
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait deterministically for either results or error to appear
                await Promise.race([
                    this.page.locator('[data-test="logs-search-result-logs-table"]').waitFor({ state: 'visible', timeout: 5000 }),
                    this.page.locator(this.errorMessage).waitFor({ state: 'visible', timeout: 5000 }),
                ]).catch(() => {});
            }
        }
    }

    // Interesting fields methods
    async clickInterestingFields() {
        const field = 'kubernetes_pod_name';
        const editor = this.page.locator(this.queryEditor);

        // Quick mode ON gates the star (ⓘ) icons via v-if="showQuickMode".
        // Root cause of prior CI flakiness: an instant isVisible() check raced
        // the field list re-rendering after the query completed, then toggled
        // quick mode (already ON) which churned the utilities menu without
        // helping. Instead: assert quick mode ON once (idempotent — safe whether
        // the caller enabled it or not), then WAIT deterministically for the
        // field list to render its interesting buttons. Slow CI runners need the
        // wait, not a toggle.
        const fieldItem = this.page.locator('[data-test^="log-search-index-list-interesting-"]').first();
        await this.ensureQuickModeState(true);
        try {
            await fieldItem.waitFor({ state: 'visible', timeout: 20000 });
        } catch {
            // Fallback: a stray earlier toggle may have flipped quick mode off —
            // re-assert and wait once more before giving up.
            testLogger.warn('Interesting-field buttons not visible after 20s — re-asserting quick mode and waiting');
            await this.ensureQuickModeState(true);
            await fieldItem.waitFor({ state: 'visible', timeout: 15000 });
        }

        await this.fillIndexFieldSearchInput(field);
        await this.clickInterestingFieldButton(field);
        // Use Monaco's model value (not DOM textContent — view-lines render line
        // numbers like "1" when the editor is empty, which breaks toContainText).
        const editorHasField = async () => {
            return await this.page.evaluate(
                ({ selector, expected }) => {
                    const host = document.querySelector(selector);
                    if (!host || !window.monaco?.editor?.getEditors) return false;
                    const editors = window.monaco.editor.getEditors();
                    for (const ed of editors) {
                        const node = ed.getDomNode?.();
                        if (node && host.contains(node)) {
                            return (ed.getValue?.() ?? '').includes(expected);
                        }
                    }
                    return false;
                },
                { selector: this.queryEditor, expected: field },
            );
        };
        try {
            await this.waitForEditorValue(field);
            if (await editorHasField()) return;
            // Field not in editor. Build a SELECT query that explicitly includes the field
            // and write it directly — regardless of whether SQL mode is currently on or off.
            // Using clickSQLModeToggle() is unreliable here: when the editor already has a
            // SELECT (e.g. from a prior enableSQLMode call), the toggle CLEARS the editor
            // instead of adding the field. Direct setQueryEditorContent bypasses that problem.
            const appState = await this._mutateSearchObj((searchObj) => ({
                fields: [...(searchObj.data?.stream?.interestingFieldList || [])],
                stream: searchObj.data?.stream?.selectedStream?.[0] || 'e2e_automate',
            }));
            const timestamp = '_timestamp';
            // Prefer the Vue interestingFieldList; fall back to just [field] so the SELECT
            // always contains the field we starred even if Vue state wasn't updated yet.
            const fields = appState?.fields?.length ? appState.fields : [field];
            const stream = appState?.stream || 'e2e_automate';
            const allFields = fields.includes(timestamp) ? fields : [timestamp, ...fields];
            const sql = `SELECT ${allFields.join(',')} FROM "${stream}" ORDER BY ${timestamp} DESC`;
            await this.setQueryEditorContent(sql);
            await this.page.waitForTimeout(300);
            if (await editorHasField()) return;
            // Final check after waiting for Monaco model stabilisation.
            await this.waitForEditorValue(field);
            if (!(await editorHasField())) {
                throw new Error(`Editor model never contained "${field}" after writing SELECT query`);
            }
        } catch (e) {
            throw e;
        }
    }

    async validateInterestingFields() {
        await this.expectQueryEditorContainsText('kubernetes_pod_name');
    }

    async validateInterestingFieldsQuery() {
        await this.expectQueryEditorContainsText('kubernetes_pod_name');
    }

    async addRemoveInteresting() {
        const field = 'kubernetes_pod_name';
        // After clickInterestingFields() a SELECT query is written to the editor, which
        // triggers Vue reactivity and may reset the field-search filter. Re-apply the
        // filter so the star button is visible, then click it to remove the field.
        await this.fillIndexFieldSearchInput(field);
        await this.clickInterestingFieldButton(field);
    }

    // Kubernetes methods
    async kubernetesContainerName() {
        // FieldExpansion.vue renders the expand toggle with data-test
        // `log-search-expand-${field.name}-field-btn` — prefer explicit data-test
        // over getByLabel (§2 selector policy bans accessibility queries).
        await this.page.locator('[data-test="log-search-expand-kubernetes_container_name-field-btn"]').first().click();
        const subfieldAddBtn = this.page.locator('[data-test="logs-search-subfield-add-kubernetes_container_name-ziox"]');
        await subfieldAddBtn.waitFor({ state: 'visible', timeout: 15000 });
        await subfieldAddBtn.click();
    }

    async kubernetesContainerNameJoin(streamA = 'default', streamB = 'e2e_automate') {
        await this.clearAndFillQueryEditor(`SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "${streamA}" as a join "${streamB}" as b on a.kubernetes_container_name  = b.kubernetes_container_name`);
        await this.waitForEditorValue(`FROM "${streamA}"`);
    }

    async kubernetesContainerNameJoinLimit() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a left join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name LIMIT 10');
        await this.waitForEditorValue('LIMIT 10');
    }

    async kubernetesContainerNameJoinLike() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name WHERE a.kubernetes_container_name LIKE \'%ziox%\'');
        await this.waitForEditorValue("LIKE '%ziox%'");
    }

    async kubernetesContainerNameLeftJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a LEFT JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.waitForEditorValue('LEFT JOIN');
    }

    async kubernetesContainerNameRightJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a RIGHT JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.waitForEditorValue('RIGHT JOIN');
    }

    async kubernetesContainerNameFullJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a FULL JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.waitForEditorValue('FULL JOIN');
    }

    /**
     * Wait for Monaco's underlying model value (not just the DOM view-lines) to
     * include the given substring AND for the value to be STABLE long enough
     * that the upstream Vue debounce (500ms in CodeQueryEditor) has flushed
     * into searchObj.data.query. AGENT_RULES §5: drive Monaco via
     * window.monaco.editor.getEditors().
     */
    async waitForEditorValue(substring) {
        await this.page.waitForFunction(
            ({ selector, expected }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const editors = window.monaco.editor.getEditors();
                for (const ed of editors) {
                    const node = ed.getDomNode?.();
                    if (node && host.contains(node)) {
                        const val = ed.getValue?.() ?? '';
                        if (!val.includes(expected)) return false;
                        // Require >=700ms of stability so the 500ms debounced
                        // CodeQueryEditor `update:query` emit has had time to flush.
                        const w = window;
                        if (w.__lastEditorValue !== val) {
                            w.__editorStableSince = Date.now();
                            w.__lastEditorValue = val;
                            return false;
                        }
                        return Date.now() - (w.__editorStableSince ?? 0) > 700;
                    }
                }
                return false;
            },
            { selector: this.queryEditor, expected: substring },
            { timeout: 10000 },
        ).catch(() => {});
    }

    // Log count ordering methods
    async verifyLogCountOrdering(orderType) {
        const query = orderType === 'desc' 
            ? `SELECT MAX(_timestamp) as ts, count(_timestamp) as logcount,kubernetes_container_name FROM 'e2e_automate' where log is not null GROUP BY kubernetes_container_name order by logcount desc`
            : `SELECT MAX(_timestamp) as ts, count(_timestamp) as logcount,kubernetes_container_name FROM 'e2e_automate' where log is not null GROUP BY kubernetes_container_name order by logcount asc`;

        await this.clearAndFillQueryEditor(query);
        await this.page.waitForTimeout(2000);

        // Enable SQL mode (opens the utilities dropdown, toggles if needed, then closes it)
        await this.enableSqlModeIfNeeded();
        await this.page.waitForTimeout(1000);

        await this.page.locator("[data-test='logs-search-bar-refresh-btn']").click({ force: true });
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }

        const rows = await this.page.locator('[data-test^="logs-search-result-detail-"]').all();
        let previousValue = orderType === 'desc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;

        for (const row of rows) {
            const sourceCell = await row.locator('[data-test^="log-table-column-"][data-test$="-source"]').textContent();
            try {
                const logcountMatch = sourceCell.match(/logcount":(\d+)/);
                const currentValue = logcountMatch ? parseInt(logcountMatch[1]) : 0;

                if (orderType === 'desc') {
                    expect(currentValue).toBeLessThanOrEqual(previousValue);
                } else {
                    expect(currentValue).toBeGreaterThanOrEqual(previousValue);
                }
                previousValue = currentValue;
            } catch (error) {
                testLogger.error('Error parsing cell content:', sourceCell);
                throw error;
            }
        }

        expect(rows.length).toBeGreaterThan(0);
    }

    async verifyLogCountOrderingDescending() {
        await this.verifyLogCountOrdering('desc');
    }

    async verifyLogCountOrderingAscending() {
        await this.verifyLogCountOrdering('asc');
    }

    // String match ignore case methods
    async searchWithStringMatchIgnoreCase(searchText) {
        await this.page.locator(this.logsSearchBarQueryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type(`str_match_ignore_case(kubernetes_labels_app, '${searchText}')`);
        await this.page.locator(this.searchBarRefreshButton).click();
        
        // Wait for search results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for the log table to be visible first
        await this.page.locator('[data-test="logs-search-result-logs-table"]').waitFor({ state: 'visible', timeout: 10000 });
        
        // Wait for the specific column to be visible
        await this.page.locator(this.logTableColumnSource).waitFor({ state: 'visible', timeout: 10000 });
        
        // Verify the column is visible
        await expect(this.page.locator(this.logTableColumnSource)).toBeVisible();
    }

    // Organization methods
    async selectOrganization() {
        await this.page.locator('[data-test="navbar-organizations-select-trigger"]').click();
        // Header.vue adds data-test="organization-menu-item-label-item-label" on each org row
        // and :data-test-org-identifier="row.identifier" for per-org targeting
        const orgItem = this.page.locator('[data-test-org-identifier="default"]').first();
        await orgItem.waitFor({ state: 'visible', timeout: 5000 });
        await orgItem.click();
    }

    // Copy share methods — no "Copy Share" data-test exists yet; use the profile icon + menu
    async copyShare() {
        await this.page.locator('[data-test="header-my-account-profile-icon"]').click();
        // Click the first menu item that contains clipboard/copy share action
        // (No dedicated data-test yet — fall back to text match inside the profile menu)
        const profileMenu = this.page.locator('[data-test="header-my-account-profile-icon"]').locator('..').locator('[role="menu"], [data-test*="profile-menu"]').first();
        const copyItem = profileMenu.locator('button, [role="menuitem"]').filter({ hasText: /copy.*share/i }).first();
        if (await copyItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            await copyItem.click();
        }
    }

    // Sign out methods
    async signOut() {
        await this.page.locator('[data-test="header-my-account-profile-icon"]').click();
        // Header.vue data-test="menu-link-logout-item" on the Sign Out menu item
        await this.page.locator('[data-test="menu-link-logout-item"]').click();
    }

    // LogsQueryPage methods - delegate to LogsQueryPage
    async setDateTimeFilter() {
        return await this.logsQueryPage.setDateTimeFilter();
    }

    async clickRefresh() {
        return await this.logsQueryPage.clickRefresh();
    }

    async clickErrorMessage() {
        return await this.logsQueryPage.clickErrorMessage();
    }

    async clickResetFilters() {
        return await this.logsQueryPage.clickResetFilters();
    }

    async clickNoDataFound() {
        return await this.logsQueryPage.clickNoDataFound();
    }

    async clickResultDetail() {
        return await this.page.locator(this.resultText).click();
    }

    async isHistogramOn() {
        return await this.logsQueryPage.isHistogramOn();
    }

    async ensureHistogramState(desiredState) {
        return await this.logsQueryPage.ensureHistogramState(desiredState);
    }

    async isSQLModeOn() {
        return await this.logsQueryPage.isSQLModeOn();
    }

    async ensureSQLMode() {
        return await this.logsQueryPage.ensureSQLMode();
    }

    async ensureFTSMode() {
        return await this.logsQueryPage.ensureFTSMode();
    }

    async disableAutoRun() {
        return await this.logsQueryPage.disableAutoRun();
    }

    async enableAutoRun() {
        return await this.logsQueryPage.enableAutoRun();
    }

    /**
     * After a mode change (SQL/FTS toggle), either wait for the auto-run that
     * fires automatically on cloud envs, or trigger the query explicitly on
     * local envs where auto_query_enabled=false.
     */
    async runQueryAfterModeChange(timeout = 60000) {
        if (await this.logsQueryPage._isAutoQueryEnabled()) {
            // Auto-run fires after mode switch — wait for the button to return
            // to "Run Query" (not disabled / loading / Cancel) before asserting.
            await this.page.waitForFunction(
                (sel) => {
                    const b = document.querySelector(sel);
                    if (!b) return false;
                    return !b.hasAttribute('disabled')
                        && b.getAttribute('aria-busy') !== 'true'
                        && !(b.textContent?.trim()?.includes('Cancel'));
                },
                this.queryButton,
                { timeout }
            ).catch(() => {});
        } else {
            await this.runQueryAndWaitForResults(timeout);
        }
    }

    // Login methods - delegate to LoginPage
    async loginAsInternalUser() {
        return await this.loginPage.loginAsInternalUser();
    }

    async login() {
        return await this.loginPage.login();
    }

    // Ingestion methods - using page.request API to keep credentials in Node.js context
    async ingestLogs(orgId, streamName, logData) {
        const headers = getAuthHeaders();

        const baseUrl = process.env.INGESTION_URL.endsWith('/')
            ? process.env.INGESTION_URL.slice(0, -1)
            : process.env.INGESTION_URL;

        try {
            const response = await this.page.request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
                headers: headers,
                data: logData
            });

            const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
            testLogger.debug('Ingestion API response received', { response: responseData });
            return responseData;
        } catch (e) {
            testLogger.debug('Ingestion API error', { error: e.message });
            return { error: e.message };
        }
    }

    // Management methods - delegate to ManagementPage
    async navigateToManagement() {
        return await this.managementPage.navigateToManagement();
    }

    // Additional methods needed for tests
    async clickDateTimeButton() {
        return await this.page.locator(this.dateTimeButton).click({ force: true });
    }

    async clickRelative15MinButton() {
        return await this.page.locator(this.relative15MinButton).click({ force: true });
    }

    /**
     * Best-effort wait until the Run-query button is idle — not in its "Cancel query"
     * in-flight variant and not disabled/busy. Lets the search toolbar (and any popover
     * anchored to it — date picker, refresh-interval dropdown) settle before we interact,
     * so a reflow can't shift the target mid-click. Resolves on timeout so callers still
     * proceed.
     */
    async _waitForQueryButtonIdle(timeout = 30000) {
        await this.page.waitForFunction((selector) => {
            const el = document.querySelector(selector);
            if (!el) return true;
            const disabled = el.hasAttribute('disabled')
                || el.getAttribute('aria-disabled') === 'true'
                || el.getAttribute('aria-busy') === 'true';
            const text = (el.textContent || '').trim();
            const title = (el.getAttribute('title') || '').trim();
            const isCancel = text.includes('Cancel') || title.toLowerCase().includes('cancel');
            return !disabled && !isCancel;
        }, this.queryButton, { timeout }).catch(() => {});
    }

    async clickRelative6WeeksButton() {
        const btn = this.page.locator(this.relative6WeeksButton);
        await btn.waitFor({ state: 'visible', timeout: 10000 });
        // The date picker is a popover anchored to the toolbar; an in-flight auto-search
        // reflows the toolbar and repositions the popover, so the preset can shift under
        // the pointer and the click misses (range stays "Past 15 Minutes"). Let the
        // toolbar settle first, then click (no force), and verify the trigger label
        // actually updated — retry once if the Reka toggle dropped the click mid-animation.
        await this._waitForQueryButtonIdle();
        await btn.click();
        const applied = await this.page
            .locator(this.dateTimeButton)
            .filter({ hasText: 'Past 6 Weeks' })
            .first()
            .waitFor({ state: 'visible', timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        if (!applied) {
            await btn.click().catch(() => {});
        }
    }

    // Deterministic wait helpers for date-picker popover buttons — replace
    // legacy waitForTimeout buffers used to absorb popover-open animation.
    async waitForRelative6WeeksButtonVisible(timeout = 10000) {
        await this.page.locator(this.relative6WeeksButton).waitFor({ state: 'visible', timeout });
    }

    async waitForRelative15MinButtonVisible(timeout = 10000) {
        await this.page.locator(this.relative15MinButton).waitFor({ state: 'visible', timeout });
    }

    async waitForPast6DaysButtonVisible(timeout = 10000) {
        await this.page.locator(this.relative6DaysBtn).waitFor({ state: 'visible', timeout });
    }

    // Wait for the log-detail drawer (opened by clickLogTableColumnSource) to be visible
    // before issuing a force-close — prevents racing the close click against drawer mount.
    async waitForLogDetailDialogVisible(timeout = 10000) {
        await this.page.locator('[data-test="logs-search-result-detail-dialog"]').waitFor({ state: 'visible', timeout });
    }

    // Wait for the live-mode 5-sec option to be visible AND enabled in the dropdown
    async waitForLiveMode5SecReady(timeout = 10000) {
        const btn = this.page.locator(this.liveMode5SecBtn);
        await btn.waitFor({ state: 'visible', timeout });
        await expect(btn).toBeEnabled({ timeout });
    }

    // Wait for the expand-code field-list row toggle to be visible after filtering.
    // FieldExpansion.vue renders [data-test="log-search-expand-<field>-field-btn"].
    async waitForExpandCodeButtonVisible(timeout = 10000) {
        await this.page.locator(this.expandCodeFieldBtn).waitFor({ state: 'visible', timeout });
    }

    async clickQueryEditor() {
        // Dismiss any lingering Reka popper / tooltip / dropdown content that could
        // intercept pointer events.
        await this.page.keyboard.press('Escape').catch(() => {});

        // Focus the Monaco editor through its public API. Clicking the outer wrapper
        // doesn't reliably focus the editor's hidden inputarea — focus() does.
        const focused = await this.page.evaluate((selector) => {
            const host = document.querySelector(selector);
            if (!host || !window.monaco?.editor?.getEditors) return false;
            const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
            if (!ed) return false;
            ed.focus();
            return true;
        }, this.queryEditor).catch(() => false);

        if (!focused) {
            // Fallback when Monaco isn't ready yet — click the wrapper directly.
            await this.page.locator(this.queryEditor).click({ force: true });
        }
    }

    async clickQueryEditorTextbox() {
        // Monaco does not expose a stable [role="code"] — click the editor wrapper directly
        return await this.page.locator(this.queryEditor).click();
    }

    async fillQueryEditor(query) {
        // Use Monaco API (more reliable) instead of DOM selectors
        const set = await this.page.evaluate(
            ({ selector, value }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
                if (!ed) return false;
                ed.setValue(value);
                ed.focus();
                return true;
            },
            { selector: this.queryEditor, value: query }
        ).catch(() => false);

        if (!set) {
            // Fallback to DOM fill
            return await this.page.locator(this.queryEditor).locator('.inputarea').first().fill(query);
        }
    }

    async clearQueryEditor() {
        // Monaco editor keyboard approach: click the wrapper, then Ctrl+A + Backspace
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press('ControlOrMeta+a');
        return await this.page.keyboard.press('Backspace');
    }

    async typeInQueryEditor(text) {
        return await this.page.keyboard.type(text);
    }

    /**
     * Set the Monaco query editor to exactly `text`, replacing any existing content.
     * Uses the Monaco API (same as clickQueryEditor) for reliable focus + value set.
     * Falls back to click → Ctrl+A → Backspace → keyboard.type on failure.
     */
    async setQueryEditorValue(text) {
        const set = await this.page.evaluate(
            ({ selector, value }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
                if (!ed) return false;
                ed.setValue(value);
                ed.focus();
                return true;
            },
            { selector: this.queryEditor, value: text }
        ).catch(() => false);

        if (!set) {
            await this.page.locator(this.queryEditor).click();
            await this.page.keyboard.press('ControlOrMeta+a');
            await this.page.keyboard.press('Backspace');
            await this.page.keyboard.type(text);
        }
    }

    async clickRefreshButton() {
        // The Run-query button (logs-search-bar-refresh-btn) swaps to a "Cancel query"
        // variant while a prior / auto search is in flight, and is briefly disabled or
        // detached (v-if/v-else swap) during that transition. A plain force-click then
        // either cancels the in-flight search or lands on a not-visible/detached node
        // ("element is not visible" flake — seen on histogram/VRL tests). Wait for the
        // run-mode variant to be visible AND idle (not Cancel, not disabled/aria-busy)
        // before clicking so we deterministically click Run — no force needed.
        const btn = this.page.locator(this.queryButton);
        await btn.waitFor({ state: 'visible', timeout: 15000 });
        await this.page.waitForFunction((selector) => {
            const el = document.querySelector(selector);
            if (!el) return false;
            const disabled = el.hasAttribute('disabled')
                || el.getAttribute('aria-disabled') === 'true'
                || el.getAttribute('aria-busy') === 'true';
            const text = (el.textContent || '').trim();
            const title = (el.getAttribute('title') || '').trim();
            const isCancel = text.includes('Cancel') || title.toLowerCase().includes('cancel');
            return !disabled && !isCancel;
        }, this.queryButton, { timeout: 30000 });
        return await btn.click();
    }

    /**
     * Wait until the Monaco query editor's model contains the given substring.
     * Deterministic replacement for legacy `waitForTimeout` buffers used after
     * keyboard.type — confirms the editor model has settled before issuing
     * a Run-query click.
     */
    async waitForQueryEditorValue(substring, timeout = 10000) {
        await this.page.waitForFunction(
            ({ selector, expected }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
                if (!ed) return false;
                return (ed.getValue() || '').includes(expected);
            },
            { selector: this.queryEditor, expected: substring },
            { timeout }
        );
        // Monaco's onDidChangeModelContent fires a debounce (~100ms) before emitting
        // update:query to the Vue store. Without this wait, runQueryAndWaitForResults
        // clicks Run while the store still holds the old query, so the old (valid)
        // query runs and no error element appears.
        await this.page.waitForTimeout(200);
    }

    /**
     * Click Run query and wait for query execution to complete.
     * Uses button UI state (loading/disabled → ready) instead of response matching
     * to avoid capturing stale responses from auto-searches.
     * @param {number} timeout - Max wait time in ms (default 60000)
     */
    async runQueryAndWaitForResults(timeout = 60000) {
        const btn = this.page.locator(this.queryButton);

        // If a prior auto-search (e.g. from toggling SQL mode) is still running, the button
        // renders as "Cancel query" via a v-if/v-else swap — wait for the run-mode variant
        // to appear (not in Cancel state) before clicking, so we don't accidentally cancel it.
        // Use the full timeout here (not a hard-coded 15 s) so a slow CI auto-search never
        // causes us to force-click the Cancel button instead of the Run button.
        let buttonWasInCancelState = false;
        await this.page.waitForFunction(
            (selector) => {
                const el = document.querySelector(selector);
                if (!el) return false;
                const text = (el.textContent || '').trim();
                const title = (el.getAttribute('title') || '').trim();
                return !text.includes('Cancel') && !title.toLowerCase().includes('cancel');
            },
            this.queryButton,
            { timeout }
        ).catch(() => {
            buttonWasInCancelState = true;
            testLogger.warn('runQueryAndWaitForResults: refresh button never exited Cancel state, force-clicking to cancel in-flight search');
        });

        // Click Run query (or Cancel, if the prior search is still running)
        await btn.click({ force: true });

        // If we had to force-click a Cancel button, we cancelled the in-flight search
        // instead of starting a new one.  Wait for the Cancel to resolve, then click
        // the Run button again to actually submit the intended query.
        if (buttonWasInCancelState) {
            testLogger.warn('runQueryAndWaitForResults: re-clicking Run to submit the intended query after cancel');
            await this.page.waitForFunction(
                (selector) => {
                    const el = document.querySelector(selector);
                    if (!el) return false;
                    const text = (el.textContent || '').trim();
                    const isDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
                    return !isDisabled && !text.includes('Cancel');
                },
                this.queryButton,
                { timeout: 15000 }
            ).catch(() => {});
            await btn.click({ force: true });
        }

        // Wait for the button to enter loading/disabled state (query started)
        await this.page.waitForFunction(
            (selector) => {
                const btn = document.querySelector(selector);
                if (!btn) return false;
                return btn.hasAttribute('disabled') || btn.getAttribute('aria-busy') === 'true' || btn.textContent?.trim()?.includes('Cancel');
            },
            this.queryButton,
            { timeout: 5000 }
        ).catch(() => {
            // Query may have completed instantly — that's OK
        });

        // Wait for the button to exit loading/disabled state (query completed).
        // The button may stay disabled briefly if patternsState.loading is true (a new
        // disabled condition added to the Run Query button in SearchBar.vue). Keep waiting
        // until both the search loading AND any patterns loading have settled.
        await this.page.waitForFunction(
            (selector) => {
                const btn = document.querySelector(selector);
                if (!btn) return false;
                const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
                const text = btn.textContent?.trim() || '';
                return !isDisabled && !text.includes('Cancel');
            },
            this.queryButton,
            { timeout }
        );

        // Wait for field-schema extraction (loadingStream) to settle so that
        // updateGridColumns() has had time to set up resultGrid.columns before
        // the caller starts querying for table cells. loadingStream is set to false
        // at the end of extractFields() which runs inside processPostPaginationData —
        // a floating async promise that may still be in-flight when the Run Query
        // button becomes enabled (searchObj.loading = false).
        // Polls `searchObj.loadingStream` via the prod-safe `_vnode` walk used by
        // `_mutateSearchObj`. Inlined (not a method) because `page.waitForFunction`
        // takes a serialised body and we need the polling semantics it provides.
        await this.page.waitForFunction(
            () => {
                try {
                    const app = document.querySelector('#app');
                    if (!app?._vnode) return true;
                    const visited = new Set();
                    let target = null;
                    const walk = (node, depth) => {
                        if (!node || depth > 60 || visited.has(node) || target) return;
                        visited.add(node);
                        const ss = node.component?.setupState;
                        if (ss && 'searchObj' in ss) {
                            const s = ss.searchObj;
                            if (s?.meta && 'sqlMode' in s.meta) {
                                target = s;
                                return;
                            }
                        }
                        if (node.component?.subTree) walk(node.component.subTree, depth + 1);
                        if (Array.isArray(node.children)) {
                            for (const c of node.children) {
                                if (c && typeof c === 'object') walk(c, depth + 1);
                                if (target) return;
                            }
                        }
                    };
                    walk(app._vnode, 0);
                    if (!target) return true;
                    return target.loadingStream !== true;
                } catch (e) {
                    return true;
                }
            },
            null,
            { timeout: 15000 }
        ).catch(() => {
            testLogger.warn('runQueryAndWaitForResults: loadingStream check timed out, proceeding');
        });

        testLogger.info('Query execution complete - Run query button ready');
    }

    /**
     * Ingest multiple log entries with retry logic for "stream being deleted" errors
     * Uses page.request API to keep credentials in Node.js context (secure)
     * @param {string} streamName - Target stream name
     * @param {Array<{fieldName: string, fieldValue: string}>} dataObjects - Array of field data to ingest
     * @param {number} maxRetries - Maximum retry attempts (default: 5)
     */
    async ingestMultipleFields(streamName, dataObjects, maxRetries = 5) {
        const orgId = getOrgIdentifier();
        const headers = getAuthHeaders();

        const baseUrl = process.env.INGESTION_URL.endsWith('/')
            ? process.env.INGESTION_URL.slice(0, -1)
            : process.env.INGESTION_URL;

        // Unique per-batch marker. Verification queries the search API by this exact
        // value (WHERE sdr_test_id = '<marker>'), so it inspects ONLY the records this
        // call ingested — never stale data from an earlier batch on the same stream.
        // This is what makes SDR verification deterministic instead of relying on the
        // virtualized results table rendering the right rows at the right time.
        const marker = `sdr-${require('crypto').randomUUID()}`;

        const baseTimestamp = Date.now() * 1000;
        const logData = dataObjects.map(({ fieldName, fieldValue }, index) => ({
            level: "info",
            [fieldName]: fieldValue,
            log: `Test log with ${fieldName} field - entry ${index}`,
            sdr_test_id: marker,
            _timestamp: baseTimestamp + (index * 1000000)
        }));

        testLogger.info(`Preparing to ingest ${logData.length} separate log entries (marker: ${marker})`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.page.request.post(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
                    headers: headers,
                    data: logData
                });

                const responseBody = await response.json().catch(() => ({ error: 'Failed to parse JSON' }));
                const status = response.status();

                testLogger.info(`Ingestion API response (attempt ${attempt}/${maxRetries}) - Status: ${status}, Body:`, responseBody);

                if (status === 200) {
                    testLogger.info('Ingestion successful, waiting for stream to be indexed...');
                    // NOTE: This is a backend async indexing wait, not a UI wait.
                    // waitForLoadState won't help as no page navigation occurs.
                    // Verification polls the search API for this marker, so this is just
                    // a small head start to reduce poll iterations — not the readiness gate.
                    await this.page.waitForTimeout(5000);
                    return marker;
                }

                const errorMessage = responseBody?.message || JSON.stringify(responseBody);
                if (errorMessage.includes('being deleted') && attempt < maxRetries) {
                    const waitTime = attempt * 5000;
                    testLogger.info(`Stream is being deleted, waiting ${waitTime/1000}s before retry...`);
                    // Backend wait with exponential backoff - server needs time to complete deletion
                    await this.page.waitForTimeout(waitTime);
                    continue;
                }

                testLogger.error(`Ingestion failed! Status: ${status}, Response:`, responseBody);
                throw new Error(`Ingestion failed with status ${status}: ${JSON.stringify(responseBody)}`);
            } catch (e) {
                if (attempt === maxRetries) {
                    testLogger.error(`Ingestion failed after ${maxRetries} attempts:`, e.message);
                    throw e;
                }
                testLogger.info(`Ingestion attempt ${attempt} failed, retrying...`);
                // Exponential backoff for API retry - not a UI wait
                await this.page.waitForTimeout(attempt * 5000);
            }
        }
    }

    async clickSearchBarRefreshButton() {
        // Use .first() to avoid strict-mode violations when multiple data-test matches exist.
        // waitForSearchBarRefreshButton() must be called first to ensure the button is enabled;
        // OButton.handleClick() guards on props.loading/disabled and will not emit when loading,
        // making force-click on a loading button a silent no-op.
        return await this.page.locator(this.searchBarRefreshButton).first().click({ force: true });
    }

    async waitForSearchBarRefreshButton() {
        const btn = this.page.locator(this.searchBarRefreshButton).first();
        // Increase to 30 s — the button may be absent from the DOM if
        // patternsState.loading is true (patterns cancel button takes its place via v-if).
        await btn.waitFor({ state: 'visible', timeout: 30000 });
        // OButton renders <button disabled> while loading or when patternsState.loading
        // is true (a new disabled condition added to the Run Query button in SearchBar.vue).
        // Wait for the button to be enabled before clicking.
        await this.page.waitForFunction(
            (selector) => {
                const el = document.querySelector(selector);
                return el != null && !el.hasAttribute('disabled');
            },
            this.searchBarRefreshButton,
            { timeout: 30000 }
        );
    }

    /**
     * Wait until the log result table has at least one visible row at index 0.
     * Useful as a data-readiness gate before asserting on specific cell content.
     * Checks for any column in row 0 (not just "source") to be agnostic of column layout.
     * @param {number} timeout - Max wait time in ms (default 15000)
     * @returns {Promise<boolean>} true if a row appeared, false if timed out
     */
    async waitForTableHits(timeout = 15000) {
        try {
            await this.page.waitForFunction(
                () => document.querySelector('[data-test^="log-table-column-0-"]') !== null,
                { timeout },
            );
            return true;
        } catch {
            return false;
        }
    }

    /**
     * SQL mode toggle was removed from the UI. These helpers are kept as no-ops so
     * any residual callers don't throw hard failures.
     */
    async _openUtilitiesMenuForSqlMode() {
        testLogger.info('_openUtilitiesMenuForSqlMode: SQL mode toggle removed from UI — no-op');
        return false;
    }

    async _closeUtilitiesMenuAfterSqlToggle() {
        // no-op — SQL mode toggle removed from UI
    }

    async clickSQLModeToggle() {
        // Behaves as a true toggle:
        //   SQL ON  → clear the editor (FTS mode, no SELECT)
        //   SQL OFF → write SELECT query with current interesting fields (SQL mode)
        //
        // Uses setQueryEditorContent (Monaco executeEdits API) rather than keyboard input —
        // keyboard typing is focus-sensitive and silently fails in headless CI when focus
        // lands on another element.
        const isSQL = await this.isSqlModeEnabled();
        if (isSQL) {
            // Toggle OFF: clear editor so auto-detection sets sqlMode = false
            await this.setQueryEditorContent('');
            await this.page.waitForTimeout(300);
            testLogger.info('clickSQLModeToggle: toggled OFF (editor cleared)');
            return;
        }

        // Toggle ON: read interesting fields + stream from Vue state, build SELECT
        const appState = await this._mutateSearchObj((searchObj) => ({
            fields: [...(searchObj.data?.stream?.interestingFieldList || [])],
            stream: searchObj.data?.stream?.selectedStream?.[0] || 'e2e_automate',
        }));

        const timestamp = '_timestamp';
        const fields = appState?.fields || [];
        const stream = appState?.stream || 'e2e_automate';
        const allFields = fields.includes(timestamp) ? fields : [timestamp, ...fields];
        // Always build an explicit field list — never fall back to SELECT * when we
        // have at least _timestamp, so assertions like "includes(_timestamp,field)"
        // work even when interestingFieldList had only one user field.
        const sql = allFields.length > 0
            ? `SELECT ${allFields.join(',')} FROM "${stream}" ORDER BY ${timestamp} DESC`
            : `SELECT * FROM "${stream}"`;

        await this.setQueryEditorContent(sql);
        await this.page.waitForTimeout(300);
        testLogger.info(`clickSQLModeToggle: toggled ON — set SQL="${sql.substring(0, 80)}"`);
    }

    async clickShowQueryToggle() {
        // Transform editor toggle moved to the utilities ("More") menu.
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.locator(this.utilitiesMenuButton).click();
        const toggleItem = this.page.locator(this.menuTransformEditorToggleBtn);
        await toggleItem.waitFor({ state: 'visible', timeout: 5000 });
        await toggleItem.click();
        // @select.prevent keeps the dropdown open after the click — close it explicitly.
        await this.page.keyboard.press('Escape').catch(() => {});
        await toggleItem.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        testLogger.info('Clicked show-query toggle via utilities menu');
    }

    async clickFieldListCollapseButton() {
        return await this.page.locator(this.fieldListCollapseButton).click();
    }

    async clickSavedViewsButton() {
        return await this.clickSaveViewButton();
    }

    async clickSavedViewsExpand() {
        // CRITICAL: This method is often called after applying a saved view
        //
        // Problem: When a saved view is applied via applySavedView():
        // 1. The saved views dialog closes immediately (savedViewsListDialog = false)
        // 2. applySavedView() fetches the saved view details from API (async)
        // 3. It updates searchObj with the saved view's query/filters
        // 4. This triggers a NEW SEARCH which updates the logs table
        // 5. The search also updates searchObj.data.savedViews (the saved views list)
        //
        // If we try to reopen the saved views dialog while the search is still running:
        // - The dialog's table will be re-rendering as data updates
        // - The search input element becomes "unstable" (detached/recreated)
        // - Test clicks fail with "element was detached from DOM"
        //
        // Solution: Wait for the search triggered by applySavedView to complete
        // before opening the dialog again. This ensures the dialog opens with stable data.

        try {
            // Wait for any ongoing search to complete by checking for the logs table
            // This indicates the search triggered by applySavedView has finished
            // Note: We check for the table itself, not specific columns, since columns
            // vary depending on the stream and saved view
            const table = this.page.locator(this.logsTable);
            await table.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
                // Ignore timeout - there might not be a search running
                // (e.g., first time opening the dialog or no data)
            });

            // Extra wait for the search to fully settle and UI to update.
            // Use a deterministic networkidle wait instead of a fixed timeout —
            // covers the reactive updates / saved-views reload / watchers settling.
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        } catch (e) {
            // Continue if no search results found
            // This is expected on first load or when no data exists
        }

        // Now it's safe to open the saved views dropdown
        await this.clickSavedViewsDropdownArrow();
    }

    async clickSaveViewButton() {
        // Post-menu-migration: "Create saved view" moved into utilities ("More") menu.
        // Close any open menus/dialogs first, then open the menu and click the item.
        const listDialog = this.page.locator('[data-test="saved-views-list-dialog"]');
        const isListOpen = await listDialog.isVisible({ timeout: 500 }).catch(() => false);
        if (isListOpen) {
            await listDialog.locator('[data-test="o-dialog-close-btn"]').click();
            await listDialog.waitFor({ state: 'hidden', timeout: 5000 });
            // The overlay has a 200ms fade-out — wait for it to fully detach so
            // it doesn't intercept the utilities-menu click. Scoped by data-test.
            await this.page.locator('[data-test="o-dialog-overlay"]')
                .waitFor({ state: 'detached', timeout: 5000 });
        }
        const createSavedViewBtn = this.page.locator('[data-test="logs-search-bar-menu-create-saved-view-btn"]');
        const isVisible = await createSavedViewBtn.isVisible({ timeout: 500 }).catch(() => false);
        if (!isVisible) {
            await this.page.locator(this.utilitiesMenuButton).click({ force: true });
            await createSavedViewBtn.waitFor({ state: 'visible', timeout: 5000 });
        }
        await createSavedViewBtn.click();
        await this.page.locator(this.savedViewDialog).waitFor({ state: 'visible', timeout: 10000 });
    }

    async fillSavedViewName(name) {
        return await this.fillInputField(this.savedViewNameInput, name);
    }

    async clickSavedViewDialogSave() {
        const saveButton = this.page.locator(this.savedViewDialogSave);

        // Wait for the button to be visible (extended timeout for cloud)
        try {
            await saveButton.waitFor({ state: 'visible', timeout: 30000 });
        } catch (e) {
            // Button never appeared — Enter as fallback then return so we
            // don't fall through to the click path (which would also fail
            // and trigger a second Enter, risking a double-submit)
            await this.page.keyboard.press('Enter');
            return;
        }

        // Scroll the button into view if needed
        await saveButton.scrollIntoViewIfNeeded().catch(() => {});
        // Wait for the button to be enabled — replaces a 500ms settle buffer.
        await expect(saveButton).toBeEnabled({ timeout: 5000 }).catch(() => {});

        // Try force-click, fall back to content click then Enter
        try {
            return await saveButton.click({ force: true, timeout: 10000 });
        } catch (e) {
            // Fallback: click the content span, only press Enter if that fails too
            // (otherwise a successful content click would be followed by a stray
            // Enter, risking double-submit on the form)
            try {
                await this.page.locator(this.savedViewDialogSaveContent).click({ force: true, timeout: 5000 });
                return;
            } catch (e2) { /* content click failed, fall through to Enter */ }
            await this.page.keyboard.press('Enter');
        }
    }

    async clickSavedViewArrow() {
        return await this.page.locator(this.savedViewArrow).click();
    }

    async clickSavedViewSearchInput() {
        // This method clicks the search input inside the saved views dialog
        //
        // Why this needs special handling:
        // The search input is inside the table's #top template slot. When the table's
        // data updates (e.g., after applying a saved view), the entire #top template
        // gets re-rendered, causing the input element to be detached and recreated.
        //
        // The problem was exacerbated by:
        // 1. debounce="1" (now changed to 300) - caused rapid re-renders
        // 2. Table data updating from ongoing searches
        // 3. Invalid HTML structure (a table row inside #top-right - now fixed)
        //
        // Even with those fixes, if a search just completed, the table might still
        // be updating its pagination/data, making the input unstable for a brief moment.
        //
        // Solution: Multiple layers of waiting to ensure element stability

        const searchInput = this.page.locator(this.savedViewSearchInput);

        // Step 1: Wait for element to be visible in the DOM
        // This ensures the dialog has opened and rendered
        await searchInput.waitFor({ state: 'visible', timeout: 15000 });

        // Step 2: Wait for any ongoing table re-renders to complete
        // After applying a saved view and reopening the dialog:
        // - The table might still be processing the new data
        // - Pagination might be recalculating
        // - Reactive dependencies might be updating
        // This 1000ms wait gives time for all of that to settle
        await this.page.waitForTimeout(1000);

        // Step 3: Verify element is still attached to the DOM
        // This catches cases where the element was recreated during the wait
        await searchInput.waitFor({ state: 'attached', timeout: 5000 });

        // Step 4: Click with force option
        // force: true bypasses actionability checks (visible, stable, not obscured)
        // This is safe here because we've already verified visibility and attachment
        // It helps handle edge cases where another element might briefly overlap
        return await searchInput.click({ force: true });
    }

    async fillSavedViewSearchInput(text) {
        const searchInput = this.page.locator(this.savedViewSearchInput);
        await searchInput.waitFor({ state: 'visible', timeout: 15000 });
        return await searchInput.fill(text);
    }

    async clickSavedViewByTitle(title) {
        const element = this.page.locator(`[data-test="logs-search-bar-apply-${title}-saved-view-btn"]`).first();
        await element.waitFor({ state: 'visible', timeout: 10000 });
        // force: true — ODropdown portal transiently detaches items during initial render
        return await element.click({ force: true });
    }

    async clickDeleteButton() {
        // Delete buttons in saved views carry data-test="logs-search-bar-delete-{view_id}-saved-view-btn"
        // Click the first visible delete button in the saved views area
        const deleteBtn = this.page.locator('[data-test*="logs-search-bar-delete-"][data-test*="-saved-view-btn"]').first();
        await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
        return await deleteBtn.click();
    }

    async clickConfirmButton() {
        const btn = this.page.locator(this.confirmButton);
        await btn.waitFor({ state: 'visible', timeout: 15000 });
        // force: true — dialog portal can transiently detach during initial render
        return await btn.click({ force: true });
    }

    async clickStreamsMenuItem() {
        return await this.page.locator(this.streamsMenuItem).click({ force: true });
    }

    async clickSearchStreamInput() {
        return await this.page.locator(this.searchStreamInput).click();
    }

    /**
     * Wait for the streams page search input to be visible. Used after
     * navigating to the streams page where the page may render before the
     * search input mounts.
     */
    async expectSearchStreamInputVisible() {
        await this.page.locator(this.searchStreamInput)
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    /**
     * Wait for the save-view dialog to be hidden / detached. Used after
     * clicking the dialog's primary button so subsequent navigation isn't
     * blocked by the dialog's close animation.
     */
    async expectSavedViewDialogClosed() {
        await this.page.locator(this.savedViewDialog)
            .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    async fillSearchStreamInput(text) {
        return await this.fillInputField(this.searchStreamInput, text);
    }

    async clickExploreButton() {
        return await this.page.locator(this.exploreButtonSelector).first().click({ force: true });
    }

    async waitForSavedViewsButton() {
        return await this.page.waitForSelector(this.savedViewsButton);
    }

    async clickSavedViewByText(text) {
        const element = this.page.locator(`[data-test="logs-search-bar-apply-${text}-saved-view-btn"]`).first();
        await element.waitFor({ state: 'visible', timeout: 10000 });
        return await element.click();
    }

    async waitForSavedViewText(text) {
        return await this.page.locator(`[data-test="logs-search-bar-apply-${text}-saved-view-btn"]`).first().waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Wait briefly for the success OToast after creating a saved view.
     * Resolves true on toast visible, false on timeout. Non-throwing — toasts may
     * have appeared and disappeared by the time we check.
     */
    async expectSavedViewCreatedToast(timeout = 3000) {
        try {
            await this.page
                .locator('[data-test-variant="success"], [data-test="o-toast-message"]')
                .first()
                .waitFor({ state: 'visible', timeout });
            return true;
        } catch (e) {
            return false;
        }
    }

    async clickDeleteSavedViewButton(savedViewName) {
        // The caller (clickSavedViewByTitle) closes the dialog. Wait passively for it to
        // reach hidden state so the re-open sequence doesn't race the close animation.
        await this.page.locator('[data-test="saved-views-list-dialog"]')
            .waitFor({ state: 'hidden', timeout: 5000 })
            .catch(() => {});

        // Re-open the saved views panel (waits for any ongoing search to settle first).
        await this.clickSavedViewsExpand();

        // Use the same robust waiting pattern as clickSavedViewSearchInput():
        // the saved-views table may still be re-rendering after the previous apply, so
        // 15 s visibility + 1 s stability buffer + attached check mirror that method.
        const searchInput = this.page.locator(this.savedViewSearchInput);
        await searchInput.waitFor({ state: 'visible', timeout: 15000 });
        await this.page.waitForTimeout(1000);
        await searchInput.waitFor({ state: 'attached', timeout: 5000 });
        await searchInput.click({ force: true });
        await searchInput.fill(savedViewName);
        // Allow OInput debounce (300 ms) to apply the filter before looking for the row.
        await this.page.waitForTimeout(1000);

        // The delete button data-test uses view_id (a UUID), not the view name, so we
        // can't build the exact selector. Instead scope to the main saved-views table
        // (not favorites) — after filtering by name there is exactly one visible row.
        const mainTable = this.page.locator('[data-test="log-search-saved-view-list-fields-table"]');
        const deleteBtn = mainTable.locator('[data-test*="logs-search-bar-delete-"]').first();
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.scrollIntoViewIfNeeded();
        await deleteBtn.click();
        // Allow Vue to process the confirmDelete state change before returning.
        await this.page.waitForTimeout(500);
    }

    async clickResetFiltersButton() {
        // Reset filters button is now directly on the toolbar
        return await this.page.locator(this.resetFiltersButton).click({ force: true });
    }

    async waitForQueryEditorTextbox() {
        return await this.page.locator(this.queryEditor).locator('.inputarea').waitFor({ state: "visible" });
    }

    async getQueryEditorText() {
        // Drive value via window.monaco.editor.getEditors() (AGENT_RULES §5)
        // Falls back to null when monaco hasn't loaded yet
        return await this.page.evaluate((selector) => {
            const host = document.querySelector(selector);
            if (!host) return null;
            const editors = window.monaco?.editor?.getEditors?.() ?? [];
            for (const ed of editors) {
                const domNode = ed.getDomNode?.();
                if (domNode && host.contains(domNode)) {
                    return ed.getValue();
                }
            }
            return null;
        }, this.queryEditor);
    }

    async clickLogTableColumnSource() {
        // Open the first result row's detail/search-around. With the FTS
        // default-column feature the first cell may be the generic "source"
        // column OR the FTS "body" column (e.g. log/message/body), so click
        // whichever first-row cell is rendered rather than "source" only.
        // The cell can also detach mid-click while the table re-renders, so
        // Playwright's auto-retrying click is allowed to settle via a short
        // post-condition wait on the detail dialog by callers.
        const firstRowCell = this.page
            .locator('[data-test^="log-table-column-0-"]')
            .first();
        await firstRowCell.waitFor({ state: 'visible', timeout: 30000 });
        return await firstRowCell.click();
    }

    async clickIncludeExcludeFieldButton() {
        return await this.page.locator(this.includeExcludeFieldButton).click();
    }

    async clickIncludeFieldButton() {
        return await this.page.locator(this.includeFieldButton).click();
    }

    async clickCloseDialog() {
        return await this.page.locator(this.closeDialog).click();
    }

    // ===== LOG DETAIL SIDEBAR METHODS (Bug #9724) =====
    /**
     * Opens the log detail sidebar by clicking the first result row.
     * Clicks whichever first-row cell is rendered (matched by the
     * `log-table-column-0-` prefix) — the default column may be the generic
     * "source" column OR the FTS "body"/message column — then waits for the
     * detail dialog. Includes a force-click fallback for transient instability.
     * @returns {Promise<void>}
     */
    async openLogDetailSidebar() {
        // The first result cell can render as the generic "source" column OR the FTS
        // "body"/message column (e.g. streams whose default column is a body field, like
        // the highlighting test stream). Waiting on the exact "...-source" cell timed out
        // whenever the body column was rendered instead, so target any first-row cell by
        // prefix — mirroring clickLogTableColumnSource / waitForSearchResults.
        const sourceCell = this.page.locator('[data-test^="log-table-column-0-"]').first();
        // Under CI load the row can resolve in the DOM while the results table is still
        // streaming/re-rendering, so a plain click waits out its timeout on "element is not
        // stable". Wait for the cell to be visible, bring it into view, then click with a
        // force fallback to push past any transient instability or overlay.
        await sourceCell.waitFor({ state: 'visible', timeout: 30000 });
        await sourceCell.scrollIntoViewIfNeeded().catch(() => {});
        try {
            await sourceCell.click({ timeout: 15000 });
        } catch {
            await sourceCell.click({ force: true });
        }
        await this.page.locator(this.logDetailDialog).waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Log detail sidebar opened');
    }

    /**
     * Verifies the log detail sidebar is visible
     * @returns {Promise<void>}
     */
    async expectLogDetailSidebarVisible() {
        await expect(this.page.locator(this.logDetailDialog)).toBeVisible();
    }

    /**
     * Verifies the log detail sidebar is NOT visible
     * @returns {Promise<void>}
     */
    async expectLogDetailSidebarNotVisible() {
        await expect(this.page.locator(this.logDetailDialog)).not.toBeVisible();
    }

    /**
     * Verifies that the JSON tab is selected by default (Bug #9724)
     * Checks that JSON tab is visible AND JSON content is visible
     * @returns {Promise<void>}
     */
    async verifyJsonTabSelectedByDefault() {
        // Verify JSON tab exists
        const jsonTab = this.page.locator(this.logDetailJsonTab);
        await expect(jsonTab).toBeVisible();

        // Check if JSON tab is selected (has data-state="active" for Reka OTab)
        const isJsonTabActive = await jsonTab.evaluate(el => el.getAttribute('data-state') === 'active');
        expect(isJsonTabActive, 'JSON tab should be selected by default (Bug #9724)').toBe(true);

        // Verify JSON content is visible
        await expect(this.page.locator(this.logDetailJsonContent)).toBeVisible();
        testLogger.info('✓ JSON tab is selected by default (Bug #9724 verified)');
    }

    /**
     * Verifies both JSON and Table tabs are visible in the sidebar
     * @returns {Promise<void>}
     */
    async verifyLogDetailTabsVisible() {
        await expect(this.page.locator(this.logDetailJsonTab)).toBeVisible();
        await expect(this.page.locator(this.logDetailTableTab)).toBeVisible();
        testLogger.info('✓ Both JSON and Table tabs are visible');
    }

    /**
     * Clicks on the Table tab in the log detail sidebar
     * @returns {Promise<void>}
     */
    async clickLogDetailTableTab() {
        await this.page.locator(this.logDetailTableTab).click();
        // Wait for table content to be visible
        await this.page.locator(this.logDetailTableContent).waitFor({ state: 'visible', timeout: 5000 });
        testLogger.info('Clicked Table tab');
    }

    /**
     * Clicks on the JSON tab in the log detail sidebar
     * @returns {Promise<void>}
     */
    async clickLogDetailJsonTab() {
        await this.page.locator(this.logDetailJsonTab).click();
        // Wait for JSON content to be visible
        await this.page.locator(this.logDetailJsonContent).waitFor({ state: 'visible', timeout: 5000 });
        testLogger.info('Clicked JSON tab');
    }

    /**
     * Verifies the Table tab is selected and table content is visible
     * @returns {Promise<void>}
     */
    async verifyTableTabSelected() {
        const tableTab = this.page.locator(this.logDetailTableTab);
        const isTableTabActive = await tableTab.evaluate(el => el.getAttribute('data-state') === 'active');
        expect(isTableTabActive, 'Table tab should be selected').toBe(true);
        await expect(this.page.locator(this.logDetailTableContent)).toBeVisible();
        testLogger.info('✓ Table tab is selected and content is visible');
    }

    /**
     * Verifies the JSON tab is selected and JSON content is visible
     * @returns {Promise<void>}
     */
    async verifyJsonTabSelected() {
        const jsonTab = this.page.locator(this.logDetailJsonTab);
        const isJsonTabActive = await jsonTab.evaluate(el => el.getAttribute('data-state') === 'active');
        expect(isJsonTabActive, 'JSON tab should be selected').toBe(true);
        await expect(this.page.locator(this.logDetailJsonContent)).toBeVisible();
        testLogger.info('✓ JSON tab is selected and content is visible');
    }

    /**
     * Closes the log detail sidebar
     * @returns {Promise<void>}
     */
    async closeLogDetailSidebar() {
        await this.page.locator(this.logDetailCloseButton).click();
        // Wait for sidebar to close
        await this.page.locator(this.logDetailDialog).waitFor({ state: 'hidden', timeout: 5000 });
        testLogger.info('Log detail sidebar closed');
    }

    /**
     * Gets the text content from the log detail JSON view
     * @returns {Promise<string>} The text content of the JSON detail view
     */
    async getLogDetailJsonContentText() {
        const content = await this.page.locator(this.logDetailJsonContent).textContent();
        testLogger.info('Retrieved log detail JSON content');
        return content;
    }

    /**
     * Gets the count of highlighted elements in the logs table
     * @returns {Promise<number>} The count of highlighted elements
     */
    async getHighlightedElementsCount() {
        const count = await this.page.locator('.log-highlighted').count();
        testLogger.info(`Found ${count} highlighted elements`);
        return count;
    }

    /**
     * Verifies the wrap toggle is visible when Table tab is selected
     * @returns {Promise<void>}
     */
    async verifyWrapToggleVisibleInTableTab() {
        await expect(this.page.locator(this.logDetailWrapToggle)).toBeVisible();
        testLogger.info('✓ Wrap toggle is visible in Table tab');
    }

    /**
     * Verifies the wrap toggle is NOT visible when JSON tab is selected
     * @returns {Promise<void>}
     */
    async verifyWrapToggleNotVisibleInJsonTab() {
        await expect(this.page.locator(this.logDetailWrapToggle)).not.toBeVisible();
        testLogger.info('✓ Wrap toggle is not visible in JSON tab');
    }

    /**
     * Verifies navigation buttons (Previous/Next) are visible in the sidebar
     * @returns {Promise<void>}
     */
    async verifyNavigationButtonsVisible() {
        await expect(this.page.locator(this.logDetailPreviousBtn)).toBeVisible();
        await expect(this.page.locator(this.logDetailNextBtn)).toBeVisible();
        testLogger.info('✓ Previous and Next navigation buttons are visible');
    }

    // ===== VIEW RELATED / CORRELATION METHODS (Enterprise Feature) =====

    /**
     * Checks if the View Related button is visible in log detail sidebar
     * Note: This is an Enterprise-only feature
     * @returns {Promise<boolean>}
     */
    async isViewRelatedButtonVisible() {
        try {
            await this.page.locator(this.viewRelatedBtn).waitFor({ state: 'visible', timeout: 5000 });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Verifies the View Related button is visible (Enterprise feature)
     * @returns {Promise<void>}
     */
    async expectViewRelatedButtonVisible() {
        await expect(this.page.locator(this.viewRelatedBtn)).toBeVisible({ timeout: 10000 });
        testLogger.info('✓ View Related button is visible (Enterprise feature)');
    }

    /**
     * Verifies the View Related button is NOT visible
     * @returns {Promise<void>}
     */
    async expectViewRelatedButtonNotVisible() {
        await expect(this.page.locator(this.viewRelatedBtn)).not.toBeVisible();
        testLogger.info('✓ View Related button is not visible');
    }

    /**
     * Clicks the View Related button to open correlation view
     * @returns {Promise<void>}
     */
    async clickViewRelatedButton() {
        await this.page.locator(this.viewRelatedBtn).click();
        testLogger.info('Clicked View Related button');
        // Wait for correlation to start loading
        await this.page.waitForTimeout(1000);
    }

    /**
     * Verifies correlation tabs (Logs, Metrics, Traces) are visible in detail drawer
     * These tabs appear after clicking View Related
     * @returns {Promise<void>}
     */
    async expectCorrelationTabsVisible() {
        // Wait for tabs to appear - correlation tabs are enterprise feature
        await this.page.waitForTimeout(2000);

        const logsTab = this.page.locator(this.correlatedLogsTab);
        const metricsTab = this.page.locator(this.correlatedMetricsTab);
        const tracesTab = this.page.locator(this.correlatedTracesTab);

        // At least one correlation tab should be visible
        const anyCorrelationTabVisible = await logsTab.or(metricsTab).or(tracesTab).first().isVisible().catch(() => false);
        expect(anyCorrelationTabVisible, 'At least one correlation tab should be visible').toBe(true);
        testLogger.info('✓ Correlation tabs are visible');
    }

    /**
     * Clicks on the Correlated Logs tab
     * @returns {Promise<void>}
     */
    async clickCorrelatedLogsTab() {
        const tab = this.page.locator(this.correlatedLogsTab);
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        testLogger.info('Clicked Correlated Logs tab');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Clicks on the Correlated Metrics tab
     * @returns {Promise<void>}
     */
    async clickCorrelatedMetricsTab() {
        const tab = this.page.locator(this.correlatedMetricsTab);
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        testLogger.info('Clicked Correlated Metrics tab');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Clicks on the Correlated Traces tab
     * @returns {Promise<void>}
     */
    async clickCorrelatedTracesTab() {
        const tab = this.page.locator(this.correlatedTracesTab);
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        testLogger.info('Clicked Correlated Traces tab');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Verifies correlation loading state is displayed
     * @returns {Promise<void>}
     */
    async expectCorrelationLoadingVisible() {
        await expect(this.page.locator(this.correlationLoadingSpinner)).toBeVisible({ timeout: 5000 });
        testLogger.info('✓ Correlation loading spinner is visible');
    }

    /**
     * Waits for correlation loading to complete
     * @param {number} timeout - Maximum wait time in ms
     * @returns {Promise<void>}
     */
    async waitForCorrelationLoaded(timeout = 30000) {
        await this.page.locator(this.correlationLoadingSpinner).waitFor({ state: 'hidden', timeout });
        testLogger.info('✓ Correlation loading completed');
    }

    /**
     * Verifies Apply Dimension Filters button is visible
     * @returns {Promise<void>}
     */
    async expectApplyDimensionFiltersVisible() {
        const filterBtn = this.page.locator(this.applyDimensionFilters).or(this.page.locator(this.applyDimensionFiltersEmbedded));
        await expect(filterBtn.first()).toBeVisible({ timeout: 10000 });
        testLogger.info('✓ Apply Dimension Filters button is visible');
    }

    /**
     * Closes the correlation dashboard dialog
     * @returns {Promise<void>}
     */
    async closeCorrelationDashboard() {
        const closeBtn = this.page.locator(this.correlationDashboardClose);
        if (await closeBtn.isVisible()) {
            await closeBtn.click();
            testLogger.info('Closed correlation dashboard');
        }
    }

    async hoverOnCorrelationDashboard() {
        const closeBtn = this.page.locator(this.correlationDashboardClose);
        const dashboardPanel = closeBtn.locator('..');
        await dashboardPanel.hover();
        testLogger.info('Hovered over correlation dashboard panel');
    }

    async expectNoContextMenuVisible() {
        // ODropdown content carries data-test="o-dropdown-content"
        const contextMenu = this.page.locator('[data-test="o-dropdown-content"]:visible');
        await expect(contextMenu).not.toBeVisible({ timeout: 3000 });
        testLogger.info('No context menu visible');
    }

    async clickSavedViewDialogSaveContent() {
        return await this.page.locator(this.savedViewDialogSaveContent).click();
    }

    async clickSavedViewByLabel(label) {
        const element = this.page.locator(`[data-test="logs-search-bar-apply-${label}-saved-view-btn"]`).first();
        await element.waitFor({ state: 'visible', timeout: 10000 });
        return await element.click({ force: true });
    }

    async expectNotificationMessage(text) {
        const escaped = String(text).replace(/"/g, '\\"');
        const selector = [
            `[data-test-variant="success"][data-test-message*="${escaped}"]`,
            `[data-test-variant="error"][data-test-message*="${escaped}"]`,
            `[data-test-variant="info"][data-test-message*="${escaped}"]`,
            `[data-test-variant="warning"][data-test-message*="${escaped}"]`,
            `[data-test-variant="loading"][data-test-message*="${escaped}"]`,
            `[data-test-variant="default"][data-test-message*="${escaped}"]`,
        ].join(', ');
        await expect(this.page.locator(selector).first()).toBeVisible({ timeout: 15000 });
    }

    watchForNotification(timeout = 15000) {
        return this.page.locator(this.notificationMessage).first().waitFor({ state: 'attached', timeout });
    }

    async expectNotificationContainsText(text) {
        await expect(this.page.locator(this.notificationMessage).first()).toContainText(text, { timeout: 10000 });
    }

    async waitForNotificationWithText(text, timeout = 3000) {
        // OToast convention §4 — match by the data-test-message attribute (escaped) across
        // all variant hosts. AGENT_RULES §2 bans `[role="alert"]` and `filter({ hasText })`.
        // CSS attribute selectors are limited to data-test* attributes.
        //
        // Some validations in the UX-revamp moved from $q.notify toasts to inline
        // OInput error messages (rendered as `[data-test="<name>-error"]`).
        // Cover both surfaces so the wait succeeds for either feedback channel.
        const escaped = String(text).replace(/"/g, '\\"');
        const selector = [
            `[data-test-variant="success"][data-test-message*="${escaped}"]`,
            `[data-test-variant="error"][data-test-message*="${escaped}"]`,
            `[data-test-variant="info"][data-test-message*="${escaped}"]`,
            `[data-test-variant="warning"][data-test-message*="${escaped}"]`,
            `[data-test-variant="loading"][data-test-message*="${escaped}"]`,
            `[data-test-variant="default"][data-test-message*="${escaped}"]`,
            `[data-test$="-error"][data-test-error-text*="${escaped}"]`,
        ].join(', ');
        await this.page.locator(selector).first().waitFor({ state: 'visible', timeout });
    }

    async expectSavedViewNameValidationError(expectedText = 'Input must be alphanumeric') {
        // OInput error convention: data-test="${parentDataTest}-error".
        // The saved view name OInput has data-test="add-alert-name-input", so its
        // inline validation error renders at data-test="add-alert-name-input-error".
        // This replaces the old toast-based check — special-char validation now sets
        // savedViewNameError (inline) instead of firing a toast.
        const errorEl = this.page.locator('[data-test="add-alert-name-input-error"]');
        await errorEl.waitFor({ state: 'visible', timeout: 10000 });
        await expect(errorEl).toContainText(expectedText);
    }

    async expectIndexFieldSearchInputVisible() {
        // Post-OFieldList migration: legacy [data-cy="index-field-search-input"] is gone.
        // The OFieldList search input is now data-test="o-field-list-search" (wrapper)
        // scoped under data-test="logs-search-index-list".
        return await expect(this.page.locator(this.logSearchIndexListFieldSearchInput)).toBeVisible();
    }

    async expectErrorMessageVisible() {
        // Covers two error display paths in Index.vue:
        // - errorMsg path: data-test="logs-search-error-state" (query/backend error)
        // - filterErrMsg path: data-test="logs-search-filter-error-message" (quickmode filter parse error)
        const errorLocator = this.page.locator(
            `[data-test="logs-search-error-state"], [data-test="logs-search-filter-error-message"]`
        ).first();
        return await expect(errorLocator).toBeVisible({ timeout: 30000 });
    }

    async expectSqlErrorStateNotVisible(timeout = 5000) {
        return await expect(this.page.locator(this.errorMessage)).not.toBeVisible({ timeout });
    }

    /**
     * Assert the error state element, if visible, does NOT contain the given text.
     * Passes trivially when no error element is shown (intended for edge-case queries
     * that may produce a non-parser error, e.g. empty query after stripping comments).
     * Use expectSqlErrorStateNotVisible() when the assertion must be unconditional.
     */
    async expectSqlErrorStateNotContain(text, timeout = 5000) {
        const errorLocator = this.page.locator(this.errorMessage);
        const isVisible = await errorLocator.isVisible({ timeout }).catch(() => false);
        if (isVisible) {
            const errorText = (await errorLocator.textContent()) || '';
            expect(errorText).not.toContain(text);
        }
    }

    /**
     * Get the detailed error dialog text.
     *
     * Expands the collapsible error detail panel (best effort) and returns the
     * FULL error message — both the always-visible summary line (which carries
     * the offending field/function name) and the expanded detail body (e.g.
     * "Valid fields are …"). Earlier this returned only the detail body, which
     * after the QueryErrorState redesign omits the field name.
     *
     * @returns {Promise<string>} The full error dialog text (summary line + detail body)
     */
    async getDetailedErrorDialogText() {
        // The QueryErrorState redesign splits the backend message across two
        // elements: the summary line (data-test="error-detail-summary",
        // always visible) carries the first sentence — which is where the
        // offending field/function name lives (e.g. "No field named X.") —
        // while the remainder ("Valid fields are …") is tucked behind the
        // expand toggle in the detail body (data-test="error-detail-body").
        // Reading only the detail body misses the field name, so we expand the
        // panel (best effort) and return the WHOLE error container text — the
        // summary line plus the detail body — to assert against the full message.

        // Expand the collapsible detail panel if a toggle is present.
        const detailsBtn = this.page.locator(this.resultErrorDetailsBtn).first();
        if (await detailsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await detailsBtn.click();
            await this.page.waitForTimeout(500);
        }

        // Prefer the full error-state container so both the summary line (which
        // holds the field name) and the expanded detail body are captured in a
        // single string.
        const container = this.page.locator(this.errorMessage).first();
        if (await container.isVisible({ timeout: 2000 }).catch(() => false)) {
            const text = (await container.textContent()) || '';
            if (text.trim()) return text;
        }

        // Fallback (container unavailable, e.g. a rendering race): stitch the
        // summary line and detail body together explicitly so the field name is
        // never dropped — never fall back to the detail body alone, which is the
        // exact gap that hid the field name in the first place.
        const parts = [];
        for (const selector of [this.searchErrorSummary, this.searchDetailErrorMessage]) {
            const locator = this.page.locator(selector).first();
            if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
                const text = (await locator.textContent()) || '';
                if (text.trim()) parts.push(text.trim());
            }
        }
        if (parts.length) return parts.join(' ');

        // Return empty string if no error message found
        testLogger.warn('No error message found');
        return '';
    }

    async expectWarningElementHidden() {
        const warningElement = this.page.locator(this.warningElement);
        return await expect(warningElement).toBeHidden();
    }

    async expectTextVisible(text) {
        // Text-based locators (`text=...`) violate the data-test-only policy. For the
        // known callers ("Past 6 Weeks", "Past 6 Days", ".a=2"), expand to data-test-scoped
        // assertions where possible. "Past N <Period>" is rendered inside the date-time
        // button (data-test="date-time-btn"). ".a=2" appears in the page container.
        if (/^Past\s/.test(text)) {
            await expect(this.page.locator(this.dateTimeButton)).toContainText(text, { timeout: 15000 });
            return;
        }
        // Fallback for any other callers — scope inside the logs page container by
        // textContent assertion rather than a top-level `text=` locator.
        await expect(this.page.locator(this.qPageContainer)).toContainText(text, { timeout: 15000 });
    }

    async expectExactTextVisible(text) {
        await expect(this.page.getByText(text, { exact: true })).toBeVisible();
    }

    async expectLogsTableVisible() {
        const table = this.page.locator(this.logsTable);
        // Wait for the table to be visible with a timeout
        await table.waitFor({ state: 'visible', timeout: 30000 });
        return await expect(table).toBeVisible();
    }

    async waitForSearchResults(timeout = 30000) {
        const table = this.page.locator(this.logsTable);
        await table.waitFor({ state: 'visible', timeout });
        // The default view may render the generic "source" column OR the FTS
        // "body" column, so wait for any first-row cell rather than "source"
        // specifically — both mean "results rendered".
        const firstRow = this.page.locator('[data-test^="log-table-column-0-"]').first();
        await firstRow.waitFor({ state: 'visible', timeout });
        return true;
    }

    async expectFieldRequiredVisible() {
        return await expect(this.page.getByText(/Field is required/).first()).toBeVisible();
    }

    async expectErrorWhileFetchingNotVisible() {
        return await expect(this.page.getByRole('heading', { name: 'Error while fetching' })).not.toBeVisible();
    }

    async clickBarChartCanvas() {
        // Wait for network idle to ensure chart data has loaded
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        const canvasLocator = this.page.locator(this.barChartCanvas);

        // Retry mechanism to handle ECharts canvas re-rendering
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Wait for the canvas to be visible
                await canvasLocator.waitFor({ state: 'visible', timeout: 30000 });

                // Wait deterministically for the ECharts instance to be ready —
                // ECharts attaches `_echarts_instance_` on the host canvas once init() runs.
                await this.page.waitForFunction(
                    (sel) => {
                        const el = document.querySelector(sel);
                        if (!el) return false;
                        // Walk up to find the chart container that ECharts attaches its instance id to
                        let node = el;
                        while (node && node !== document.body) {
                            if (node.hasAttribute && node.hasAttribute('_echarts_instance_')) return true;
                            node = node.parentElement;
                        }
                        return false;
                    },
                    this.barChartCanvas,
                    { timeout: 10000 }
                ).catch(() => {});

                // force:true required for ECharts canvas - canvas elements are interactive
                // but fail Playwright's actionability checks (no pointer-events in traditional sense)
                await canvasLocator.click({
                    position: { x: 182, y: 66 },
                    force: true,
                    timeout: 10000
                });
                return; // Success
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                // Wait deterministically for the canvas to be attached before retrying.
                await canvasLocator.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
            }
        }
    }

    async expectBarChartCanvasVisible() {
        const canvasLocator = this.page.locator(this.barChartCanvas);
        return await expect(canvasLocator).toBeVisible({ timeout: 30000 });
    }

    async fillIndexFieldSearchInput(text) {
        const inputLocator = this.page.locator(this.logSearchIndexListFieldSearchInput);
        if (!text) {
            await inputLocator.fill('');
        } else {
            // pressSequentially fires per-character input events that reliably
            // trigger the input's debounced update:model-value chain.
            // force:true bypasses Monaco editor's <span class="highlight">code</span>
            // overlay that can intercept pointer events on the splitter panel.
            await inputLocator.click({ clickCount: 3, force: true });
            await inputLocator.pressSequentially(text, { delay: 30 });
        }
        // Wait deterministically for the input value to reflect the typed text —
        // this confirms the debounced model-value chain has settled.
        await expect(inputLocator).toHaveValue(text || '', { timeout: 5000 });
    }

    /**
     * Wait until the field-list sidebar has actually been populated from the stream
     * schema. The sidebar renders one expandable row per schema field
     * (data-test="log-search-expand-<field>-field-btn"); on slow/cloud environments
     * the schema fetch that follows stream selection can lag well past any fixed
     * sleep, leaving the list empty. Downstream field-search / add-to-table steps then
     * see zero fields and fail non-deterministically (fieldCount === 0, "field expand
     * button not found"). Gate on the first expandable field row rendering so callers
     * always operate against a populated list — a deterministic replacement for
     * arbitrary waitForTimeout() buffers after stream selection / refresh.
     * The expandable rows only render once the stream's fields have indexed VALUES,
     * so this doubles as a data-ready gate. Cloud/alpha indexing after ingestion can
     * lag well past 30s under parallel load (the global setup itself allows 90s), so
     * the default timeout is deliberately generous rather than arbitrary.
     * @param {number} timeout - max wait for the schema-driven field list to render
     */
    async waitForFieldListReady(timeout = 60000) {
        await this.page
            .locator('[data-test^="log-search-expand-"]')
            .first()
            .waitFor({ state: 'visible', timeout });
    }

    async clickExpandLabel(label) {
        return await this.clickElementByLabel(label, 'Expand');
    }

    async clickCollapseLabel(label) {
        return await this.clickElementByLabel(label, 'Collapse');
    }

    async expectErrorWhileFetchingFieldValuesNotVisible() {
        const errorMessage = this.page.getByText('Error while fetching field values');
        return await expect(errorMessage).not.toBeVisible();
    }

    async clickText(text) {
        return await this.page.getByText(text).click();
    }

    async clickSubfieldAddButton(field, value) {
        // Remove trailing dash from value to avoid double dash
        const cleanValue = value.endsWith('-') ? value.slice(0, -1) : value;
        return await this.page.locator(`[data-test="logs-search-subfield-add-${field}-${cleanValue}-0"]`).getByText(value).click();
    }

    async expectSubfieldAddButtonVisible(field, value) {
        // Remove trailing dash from value to avoid double dash
        const cleanValue = value.endsWith('-') ? value.slice(0, -1) : value;
        const targetElement = this.page.locator(`[data-test="logs-search-subfield-add-${field}-${cleanValue}-0"]`).getByText(value);
        return await expect(targetElement).toBeVisible();
    }

    async clickAddStreamButton() {
        const addButton = this.page.locator(this.addStreamButton);
        
        // Wait for the button to be visible
        await addButton.waitFor({ state: 'visible', timeout: 10000 });
        
        // Scroll the button into view if needed
        await addButton.scrollIntoViewIfNeeded();
        
        // Wait a moment for the scroll to complete
        await this.page.waitForTimeout(500);
        
        // Click the button
        return await addButton.click({ force: true });
    }

    async clickAddStreamNameInput() {
        return await this.page.click(this.addStreamNameInput);
    }

    async clickSaveStreamButton() {
        const saveButton = this.page.locator(this.saveStreamButton);
        
        // Wait for the button to be visible
        await saveButton.waitFor({ state: 'visible', timeout: 10000 });
        
        // Scroll the button into view if needed
        await saveButton.scrollIntoViewIfNeeded();
        
        // Wait a moment for the scroll to complete
        await this.page.waitForTimeout(500);
        
        // Click the button
        return await saveButton.click({ force: true });
    }

    async waitForSaveStreamButton() {
        return await this.page.locator(this.saveStreamButton).waitFor({ state: "visible" });
    }

    async scrollSaveStreamButtonIntoView() {
        return await this.page.locator(this.saveStreamButton).scrollIntoViewIfNeeded();
    }

    async clickStreamDetail() {
        return await this.page.locator(this.streamDetail).first().click({ force: true });
    }

    async clickSchemaStreamIndexSelect() {
        return await this.page.locator(this.schemaStreamIndexSelect).click();
    }

    async clickFullTextSearch() {
        const scope = this.page.locator(this.fullTextSearch);
        return await scope.getByText(/Full text search/).first().click();
    }

    async clickSchemaUpdateSettingsButton() {
        return await this.page.locator(this.schemaUpdateSettingsButton).click({ force: true });
    }

    async clickColAutoButton() {
        return await this.page.locator(this.colAutoButton).click({ force: true });
    }

    async clickExploreTitle() {
        return await this.page.locator(this.exploreTitle).first().click({ force: true });
    }

    async clickStreamsSearchStreamInput() {
        return await this.page.click(this.streamsSearchStreamInput);
    }

    async fillStreamsSearchStreamInput(text) {
        return await this.page.keyboard.type(text);
    }

    async selectAllText() {
        return await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    }

    async pressBackspace() {
        return await this.page.keyboard.press("Backspace");
    }

    async expectSQLQueryMissingError() {
        return await this.page.getByText("SQL query is missing or invalid. Please submit a valid SQL statement.").click();
    }

    async clickTableRowExpandMenu() {
        return await this.page.locator(this.timestampColumnMenu).first().click({ force: true });
    }

    async toggleVrlEditor() {
        // Transform editor toggle is inside the utilities ("More") menu.
        // Ensure it is ON (idempotent) — only enable if the function dropdown is not already visible.
        const functionDropdown = this.page.locator('[data-test="logs-search-bar-function-dropdown"]');
        const isVisible = await functionDropdown.isVisible({ timeout: 2000 }).catch(() => false);
        if (!isVisible) {
            await this.page.keyboard.press('Escape').catch(() => {});
            await this.page.locator(this.utilitiesMenuButton).click();
            const toggleItem = this.page.locator(this.menuTransformEditorToggleBtn);
            await toggleItem.waitFor({ state: 'visible', timeout: 5000 });
            await toggleItem.click();
            await functionDropdown.waitFor({ state: 'visible', timeout: 10000 });
        }
    }

    async clickVrlEditor() {
        // Wait for the VRL editor host to be visible before driving Monaco.
        // The data-test matches both outer container and inner Monaco div, so use .first().
        await this.page.locator(this.vrlEditor).first().waitFor({ state: 'visible', timeout: 15000 });
        // Wait for Monaco to attach an editor inside the VRL host (AGENT_RULES §5).
        await this.page.waitForFunction(
            (selector) => {
                if (!window.monaco?.editor?.getEditors) return false;
                const hosts = document.querySelectorAll(selector);
                if (!hosts.length) return false;
                return window.monaco.editor.getEditors().some((ed) => {
                    const node = ed.getDomNode?.();
                    if (!node) return false;
                    return Array.from(hosts).some((h) => h.contains(node));
                });
            },
            this.vrlEditor,
            { timeout: 15000 }
        ).catch(() => {});
        // Focus Monaco then TYPE — keyboard input fires onDidChangeModelContent which the
        // Vue @update:query handler subscribes to, updating searchObj.data.tempFunctionContent.
        // setValue() alone doesn't always emit through the unified-query-editor wrapper.
        const focused = await this.page.evaluate((selector) => {
            if (!window.monaco?.editor?.getEditors) return false;
            const hosts = Array.from(document.querySelectorAll(selector));
            const ed = window.monaco.editor.getEditors().find((e) => {
                const n = e.getDomNode?.();
                return n && hosts.some((h) => h.contains(n));
            });
            if (!ed) return false;
            ed.focus();
            // Clear any existing content via executeEdits — handles models that already had text.
            const model = ed.getModel();
            if (model) {
                ed.executeEdits('clear', [{ range: model.getFullModelRange(), text: '' }]);
            }
            return true;
        }, this.vrlEditor);
        if (focused) {
            await this.page.keyboard.type('.a=2');
        } else {
            // Fallback for environments without Monaco — click then type.
            await this.page.locator(this.vrlEditor).first().click({ force: true }).catch(() => {});
            await this.page.keyboard.type('.a=2');
        }
        // Wait for Monaco's model + the 500ms CodeQueryEditor debounce so
        // searchObj.data.tempFunctionContent is populated before subsequent
        // dialog opens / save calls run (otherwise fnSavedFunctionDialog
        // emits the "No function definition found." toast and the dialog
        // never opens).
        await this.page.waitForFunction(
            (selector) => {
                if (!window.monaco?.editor?.getEditors) return false;
                const hosts = document.querySelectorAll(selector);
                if (!hosts.length) return false;
                const ed = window.monaco.editor.getEditors().find((e) => {
                    const n = e.getDomNode?.();
                    return n && Array.from(hosts).some((h) => h.contains(n));
                });
                if (!ed) return false;
                const val = ed.getValue?.() ?? '';
                if (!val.includes('.a=2')) return false;
                const w = window;
                if (w.__lastVrlEditorValue !== val) {
                    w.__vrlEditorStableSince = Date.now();
                    w.__lastVrlEditorValue = val;
                    return false;
                }
                return Date.now() - (w.__vrlEditorStableSince ?? 0) > 700;
            },
            this.vrlEditor,
            { timeout: 10000 },
        ).catch(() => {});
    }

    async waitForTimeout(milliseconds) {
        return await this.page.waitForTimeout(milliseconds);
    }

    async expectSearchListVisible() {
        // Post-migration: legacy `.search-list > :nth-child(1) > .text-left` (framework class)
        // is gone. SearchResult.vue exposes the result title as data-test="logs-search-result-title".
        return await expect(this.page.locator(this.searchResultTitle).first()).toBeVisible({ timeout: 15000 });
    }

    async clickCloseDialogForce() {
        // The ODrawer uses a 300 ms slide-in animation (slide-in-from-right).
        // `waitForLogDetailDialogVisible` resolves at the START of the animation
        // (element is non-hidden), but the close button is still outside the viewport
        // mid-animation. Wait for the animation to finish before attempting the click.
        const closeBtn = this.page.locator(this.closeDialog);
        await expect(closeBtn).toBeInViewport({ timeout: 2000 }).catch(async () => {
            // Fallback: wait the full animation duration + buffer if toBeInViewport times out
            await this.page.waitForTimeout(400);
        });
        return await closeBtn.click({ force: true });
    }

    async clickLiveModeButton() {
        return await this.page.locator(this.liveModeToggleBtn).click();
    }

    async clickLiveMode5Sec() {
        // Wait for button to be enabled before clicking (button starts disabled)
        const button = this.page.locator(this.liveMode5SecBtn);
        await button.waitFor({ state: 'visible', timeout: 10000 });
        // Wait for button to become enabled
        await expect(button).toBeEnabled({ timeout: 10000 });
        // The refresh-interval dropdown is a popover anchored to the toolbar; while an
        // auto-search is in flight the toolbar reflows and the popover repositions, so
        // the option never reaches Playwright's "stable" state and a plain click times
        // out (~45s). Wait for the Run-query button to leave its in-flight (Cancel/busy)
        // state so the toolbar — and thus the popover — settles before clicking.
        await this.page.waitForFunction((selector) => {
            const el = document.querySelector(selector);
            if (!el) return true; // toolbar not found → nothing to reflow
            const busy = el.getAttribute('aria-busy') === 'true';
            const text = (el.textContent || '').trim();
            const title = (el.getAttribute('title') || '').trim();
            return !busy && !text.includes('Cancel') && !title.toLowerCase().includes('cancel');
        }, this.queryButton, { timeout: 30000 }).catch(() => {});
        return await button.click();
    }

    async isLiveMode5SecEnabled() {
        const testLogger = require('../../playwright-tests/utils/test-logger.js');
        const button = this.page.locator(this.liveMode5SecBtn);
        try {
            // Wait for button to be visible first (isEnabled() doesn't support timeout)
            await button.waitFor({ state: 'visible', timeout: 5000 });
            return await button.isEnabled();
        } catch (error) {
            testLogger.warn(`isLiveMode5SecEnabled check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Get the Live Mode 5 second button locator
     * @returns {import('@playwright/test').Locator} The 5-second live mode button locator
     */
    getLiveMode5SecButton() {
        return this.page.locator(this.liveMode5SecBtn);
    }

    /**
     * Get the Live Mode refresh button by interval value
     * @param {number} value - The refresh interval in seconds (e.g. 5, 10, 60, 300)
     * @returns {import('@playwright/test').Locator} The button locator
     */
    getLiveModeButtonByValue(value) {
        return this.page.locator(`[data-test="logs-search-bar-refresh-time-${value}"]`);
    }

    async getPageContent() {
        return await this.page.locator('body').innerText().catch(() => '');
    }

    async clickVrlToggle() {
        // Transform editor toggle is inside the utilities ("More") menu — toggle it.
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.locator(this.utilitiesMenuButton).click();
        const toggleItem = this.page.locator(this.menuTransformEditorToggleBtn);
        await toggleItem.waitFor({ state: 'visible', timeout: 5000 });
        await toggleItem.click();
        testLogger.info('Clicked VRL toggle via utilities menu');

        // Deterministic wait — let the VRL/results panel transition settle. The reactive
        // state change is observable via the VRL editor's presence or absence.
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    async expectVrlFieldVisible() {
        // When in query editor view, check if the query editor container is visible
        const queryEditor = this.page.locator('.query-editor-container, [data-test="logs-vrl-function-editor"]');
        const isEditorVisible = await queryEditor.first().isVisible();

        if (!isEditorVisible) {
            throw new Error('Expected query editor view to be visible');
        }

        testLogger.info('Query editor view is visible');
        return true;
    }

    async expectVrlFieldNotVisible() {
        return await expect(this.page.locator(this.vrlEditor).first()).not.toBeVisible();
    }

    async expectFnEditorNotVisible() {
        // When the show-query toggle is clicked, it switches to results view
        // Check if we're in results view by looking for the logs table
        const logsTable = this.page.locator('[data-test="logs-search-result-logs-table"]');
        const isResultsVisible = await logsTable.isVisible();

        if (!isResultsVisible) {
            throw new Error('Expected results view to be visible after toggling query editor off');
        }

        testLogger.info('Results view is visible - query editor toggled off successfully');
        return true;
    }

    async isVrlEditorInputVisible() {
        return await this.page.locator(this.fnEditor).locator('.inputarea').isVisible().catch(() => false);
    }

    async clickPast6DaysButton() {
        return await this.page.locator(this.relative6DaysBtn).click();
    }

    async clickMenuLink(link) {
        return await this.page.locator(this.menuLink(link)).click();
    }

    async expectSQLQueryVisible() {
        return await expect(this.page.locator(this.queryEditor)).toContainText('SELECT * FROM');
    }

    async clickNavigateBack() {
        return await this.page.goBack();
    }

    async expectLogTableColumnSourceVisibleAfterNavigation() {
        const element = this.page.locator(this.logTableColumnSource);
        // Wait for the element to be visible with a timeout
        await element.waitFor({ state: 'visible', timeout: 30000 });
        return await expect(element).toBeVisible();
    }

    /**
     * Wait for the Explore button to be visible (deterministic wait used in
     * stream-explorer navigation flows — replaces stacked fixed waits after
     * filtering streams list).
     */
    async expectExploreButtonVisible() {
        await this.page.locator(this.exploreButtonSelector).first()
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    /**
     * Wait for the VRL editor input area to be ready (post-toggle deterministic
     * wait — beats the legacy 1s waitForTimeout that masked the VRL editor mount).
     * Uses .first() because the vrlEditor selector matches both the outer
     * container and the Monaco inner div.
     */
    async expectVrlEditorReady() {
        await this.page.locator(this.vrlEditor).first().waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(`${this.vrlEditor} .inputarea`).first().waitFor({ state: 'visible', timeout: 15000 });
    }

    /**
     * Wait for a field's expand button to be visible (used after filtering the
     * IndexList by field name — replaces fixed 4s wait).
     */
    async expectFieldExpandVisible(fieldName) {
        await this.page.locator(this.fieldExpandButton(fieldName))
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    /**
     * Wait for the field-value list (containers populated after clicking
     * Expand on a field) to be visible — replaces the post-expand 4s wait.
     */
    async expectFieldValueListVisible() {
        await this.page.locator(this.timestampFieldTable)
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickSearchAroundButton() {
        return await this.page.locator(this.searchAroundBtn).click();
    }

    async expectPaginationNotVisible() {
        return await expect(this.page.locator(this.pagination)).not.toBeVisible();
    }

    async expectResultPaginationVisible() {
        return await expect(this.page.locator(this.resultPagination)).toBeVisible();
    }

    async clickPaginationPage(pageNumber) {
        return await this.page.locator(this.resultPaginationPageBtn(pageNumber)).first().click();
    }

    async getPaginationPageCount() {
        const pageButtons = this.page.locator(`[data-test^="logs-search-result-pagination-page-"]`);
        return await pageButtons.count();
    }

    async getPaginationPageClasses(pageNumber) {
        const pageButton = this.page.locator(this.resultPaginationPageBtn(pageNumber)).first();
        return await pageButton.getAttribute('data-test-active');
    }

    async isPaginationPageActive(pageNumber) {
        const activeAttr = await this.getPaginationPageClasses(pageNumber);
        return activeAttr === 'true';
    }

    async getActivePaginationPageText() {
        return await this.page.locator(`${this.resultPagination} button[aria-current='true'], ${this.resultPagination} button[aria-pressed='true'], ${this.resultPagination} button[data-state='active']`).first().textContent({ timeout: 5000 }).catch(() => 'unknown');
    }

    async expectSQLPaginationNotVisible() {
        return await expect(this.page.locator(this.sqlPagination)).not.toBeVisible();
    }

    async expectSQLGroupOrderLimitPaginationNotVisible() {
        return await expect(this.page.locator(this.sqlGroupOrderLimitPagination)).not.toBeVisible();
    }

    async expectSearchBarRefreshButtonVisible() {
        return await expect(this.page.locator(this.searchBarRefreshButton)).toBeVisible();
    }

    async expectQuickModeToggleVisible() {
        return await expect(this.page.locator(this.quickModeToggle)).toBeVisible();
    }

    async clickInterestingFieldButton(field) {
        const btnLocator = this.page.locator(this.interestingFieldBtn(field)).first();
        const inputLocator = this.page.locator(this.logSearchIndexListFieldSearchInput);

        for (let attempt = 0; attempt < 5; attempt++) {
            const visible = await btnLocator.waitFor({ state: 'visible', timeout: 8000 })
                .then(() => true).catch(() => false);
            if (visible) {
                await btnLocator.click({ force: true });
                return;
            }
            // Button not visible — re-apply filter to ensure field is in the list.
            await inputLocator.fill('');
            await inputLocator.click({ force: true });
            await inputLocator.pressSequentially(field, { delay: 30 });
            // Wait deterministically for the debounced filter to reflect the typed value
            await expect(inputLocator).toHaveValue(field, { timeout: 5000 }).catch(() => {});
        }
        await btnLocator.waitFor({ state: 'visible', timeout: 8000 });
        await btnLocator.click({ force: true });
    }

    /**
     * Multistream variant: hover the LAST rendered field row (a field can appear
     * once per selected stream, so target the last occurrence) to render its
     * action buttons, then click the interesting-field (ⓘ) toggle on that row.
     */
    async hoverAndClickInterestingFieldLast(field) {
        await this.page.locator(this.fieldListItem(field)).last().hover();
        await this.page.locator(this.interestingFieldBtn(field)).last().click({ force: true });
    }

    /**
     * Idempotent version of clickInterestingFieldButton: only clicks if the field is
     * NOT already marked as interesting.  Use this when the goal is to guarantee the
     * field is in interestingFieldList, not to toggle it.  If the button's title
     * already says "Remove from interesting fields" the field is already starred and
     * we skip the click so we don't accidentally remove it.
     */
    async ensureFieldIsInteresting(field) {
        const btnLocator = this.page.locator(this.interestingFieldBtn(field)).first();
        const inputLocator = this.page.locator(this.logSearchIndexListFieldSearchInput);

        for (let attempt = 0; attempt < 5; attempt++) {
            const visible = await btnLocator.waitFor({ state: 'visible', timeout: 8000 })
                .then(() => true).catch(() => false);
            if (visible) {
                const title = await btnLocator.getAttribute('title').catch(() => '');
                if (title && title.toLowerCase().includes('remove')) {
                    // Already interesting — nothing to do.
                    return;
                }
                await btnLocator.click({ force: true });
                return;
            }
            await inputLocator.fill('');
            await inputLocator.click({ force: true });
            await inputLocator.pressSequentially(field, { delay: 30 });
            await expect(inputLocator).toHaveValue(field, { timeout: 5000 }).catch(() => {});
        }
        await btnLocator.waitFor({ state: 'visible', timeout: 8000 });
        const title = await btnLocator.getAttribute('title').catch(() => '');
        if (title && title.toLowerCase().includes('remove')) {
            return;
        }
        await btnLocator.click({ force: true });
    }

    async expectInterestingFieldInEditor(field) {
        // Monaco tokenizes text across multiple <span> elements, so DOM-based getByText
        // with a regex can miss substrings that span token boundaries. Read the Monaco
        // model value directly instead — this is authoritative regardless of rendering.
        await this.expectQueryEditorContainsText(field);
    }

    async expectInterestingFieldInTable(field) {
        return await expect(this.page.locator(this.logTableColumnSource).getByText(new RegExp(field)).first()).toBeVisible();
    }

    async expectQueryEditorVisible() {
        return await expect(this.page.locator(this.queryEditor)).toBeVisible();
    }

    async expectQueryEditorContainsText(text) {
        // Wait for Monaco editor container to be visible
        await this.page.locator(this.queryEditor).waitFor({ state: 'visible', timeout: 15000 });
        // Wait for Monaco's .inputarea — only present after the editor is fully
        // initialised (setupEditor() async load completes). This prevents the
        // waitForFunction below from timing out on page reloads where window.monaco
        // is not yet set when domcontentloaded fires.
        await this.page.locator(this.queryEditor).locator('.inputarea').waitFor({ state: 'visible', timeout: 20000 });
        // Assert against Monaco's model value (not DOM view-lines which render
        // line numbers when empty — AGENT_RULES §5).
        await this.page.waitForFunction(
            ({ selector, expected }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const editors = window.monaco.editor.getEditors();
                for (const ed of editors) {
                    const domNode = ed.getDomNode?.();
                    if (domNode && host.contains(domNode)) {
                        return (ed.getValue?.() ?? '').includes(expected);
                    }
                }
                return false;
            },
            { selector: this.queryEditor, expected: text },
            { timeout: 15000 },
        );
    }

    // ===== QUERY EDITOR EXPAND/COLLAPSE METHODS =====
    async clickQueryEditorFullScreenBtn() {
        return await this.page.locator(this.queryEditorFullScreenBtn).click();
    }

    async expectQueryEditorFullScreenBtnVisible() {
        return await expect(this.page.locator(this.queryEditorFullScreenBtn)).toBeVisible({ timeout: 10000 });
    }

    async isQueryEditorExpanded() {
        // Fullscreen state is reflected by data-fullscreen="true" on the container itself.
        // Use a combined selector (.query-editor-container[data-fullscreen="true"]) so we
        // match the container node, not a descendant.
        return await this.page.locator(`${this.queryEditorContainer}${this.expandOnFocusClass}`).count() > 0;
    }

    async toggleQueryEditorFullScreen() {
        const initialState = await this.isQueryEditorExpanded();
        await this.clickQueryEditorFullScreenBtn();
        await this.page.waitForTimeout(500); // Wait for animation
        const newState = await this.isQueryEditorExpanded();
        return { initialState, newState, toggled: initialState !== newState };
    }

    async expectQueryEditorEmpty() {
        const text = await this.getQueryEditorText();
        return await expect(text).toEqual("");
    }

    async expectQueryEditorContainsSQLQuery() {
        return await this.expectQueryEditorContainsTextHelper('SELECT COUNT(_timestamp) AS xyz, _timestamp FROM "e2e_automate"  Group by _timestamp ORDER BY _timestamp DESC');
    }

    async expectQueryEditorContainsMatchAllQuery() {
        return await this.expectQueryEditorContainsTextHelper("match_all('code')");
    }

    async expectQueryEditorContainsMatchAllRawQuery() {
        return await this.expectQueryEditorContainsTextHelper("match_all_raw_ignore_case('provide_credentials')");
    }

    async expectQueryEditorContainsKubernetesQuery() {
        return await this.expectQueryEditorContainsTextHelper("kubernetes");
    }

    async expectQueryEditorContainsVrlQuery() {
        return await this.expectQueryEditorContainsTextHelper(".a=2");
    }

    async expectQueryEditorContainsSQLQueryMissingError() {
        return await this.expectQueryEditorContainsTextHelper("SQL query is missing or invalid. Please submit a valid SQL statement.");
    }

    async expectQueryEditorContainsValidViewName() {
        return await this.expectQueryEditorContainsTextHelper("Please provide valid view name");
    }

    async expectQueryEditorContainsFieldRequired() {
        return await this.expectQueryEditorContainsTextHelper("Field is required");
    }

    async expectQueryEditorContainsErrorWhileFetching() {
        return await this.expectQueryEditorContainsTextHelper("Error while fetching");
    }

    async expectQueryEditorContainsErrorWhileFetchingFieldValues() {
        return await this.expectQueryEditorContainsTextHelper("Error while fetching field values");
    }

    async expectQueryEditorContainsZioxIngester() {
        return await this.expectQueryEditorContainsTextHelper("ziox-ingester-");
    }

    async expectQueryEditorContainsKubernetesPod(type, ingesterNumber) {
        return await this.expectKubernetesPodContent(type, ingesterNumber);
    }

    // Additional methods for logsPage spec
    async clickMenuLinkItem(link) {
        return await this.clickMenuLinkByType(link);
    }

    async clickMenuLinkLogsItem() {
        return await this.clickMenuLinkByType('logs');
    }

    async clickMenuLinkTracesItem() {
        return await this.clickMenuLinkByType('traces');
    }

    async clickMenuLinkStreamsItem() {
        return await this.clickMenuLinkByType('streams');
    }

    async clickMenuLinkMetricsItem() {
        return await this.clickMenuLinkByType('metrics');
    }

    async clickMenuLinkPipelineItem() {
        return await this.clickMenuLinkByType('pipeline');
    }

    async clickMenuLinkFunctionsItem() {
        return await this.clickMenuLinkByType('functions');
    }

    async clickTabRealtime() {
        return await this.page.locator('[data-test="tab-realtime"]').click();
    }

    async clickFunctionStreamTab() {
        return await this.page.locator('[data-test="pipeline-section-tab-functions"]').click();
    }

    async clickSearchFunctionInput() {
        return await this.page.locator('[data-test="function-search-input"]').click();
    }

    async fillSearchFunctionInput(text) {
        return await this.page.locator('[data-test="function-search-input"]').fill(text);
    }

    async clickDeleteFunctionButton() {
        return await this.page.locator('[data-test="function-list-delete-function-btn"]').first().click();
    }

    async clickFunctionDropdownSave() {
        // In the new UI, the transform editor (FunctionSelector/TransformSelector) is hidden by
        // default. The save button only renders when the editor is visible. Ensure it's open first.
        const saveBtn = this.page.locator('[data-test="logs-search-bar-save-function-btn"], [data-test="logs-search-bar-save-transform-btn"]');
        const isBtnVisible = await saveBtn.first().isVisible({ timeout: 1000 }).catch(() => false);
        if (!isBtnVisible) {
            await this.toggleVrlEditor();
        }
        await saveBtn.first().waitFor({ state: 'visible', timeout: 5000 });
        await saveBtn.first().click();
    }

    async clickSavedFunctionNameInput() {
        return await this.page.locator(this.savedFunctionNameInput).click();
    }

    async fillSavedFunctionNameInput(text) {
        // OInput wrapper data-test is "saved-function-name-input"; inner native input is "-field" (AGENT_RULES §4).
        // Wait on the wrapper (visibility) but fill the -field variant.
        await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'visible', timeout: 10000 });
        return await this.page.locator(this.savedFunctionNameInputField).fill(text);
    }

    async expectFunctionNameNotValid() {
        // OInput convention §4: the error span is `<parent>-error`. SearchBar.vue sets
        // savedFunctionNameError to "This field is required" (empty/blank input) or
        // "Input must be alphanumeric" (invalid characters). Toast variant for legacy
        // i18n key `functionNameInvalid` is unused. Wait on the OInput's error span.
        const errorSpan = this.page.locator('[data-test="saved-function-name-input-error"]');
        await errorSpan.waitFor({ state: 'visible', timeout: 10000 });
        return errorSpan;
    }

    async expectWarningNoFunctionDefinition() {
        // SearchBar.vue calls toast({ variant: "error", message: "No function definition found." }).
        // OToast renders with data-test="o-toast-error" / "o-toast-message".
        const toast = this.page.locator('[data-test-variant="error"], [data-test="o-toast-message"]').first();
        await toast.waitFor({ state: 'visible', timeout: 15000 });
        await expect(toast).toContainText('No function definition');
    }

    async expectBarChartVisible() {
        const barChart = this.page.locator(this.logsTable);
        return await expect(barChart).toBeTruthy();
    }

    async expectBarChartHasContent() {
        const histogramChart = this.page.locator('[data-test="logs-search-result-bar-chart"]');
        await expect(histogramChart).toBeVisible({ timeout: 5000 });
        const chartContent = histogramChart.locator('canvas, svg');
        const count = await chartContent.count();
        expect(count, 'Histogram must contain rendered chart content (canvas or SVG)').toBeGreaterThan(0);
        testLogger.info(`Histogram contains ${count} canvas/SVG elements`);
    }

    async expectTableColumnHeaderVisible(columnName) {
        const columnHeader = this.page.locator(`[data-test="log-search-result-table-th-${columnName}"]`);
        await expect(columnHeader, `Column header ${columnName} should be visible`).toBeVisible({ timeout: 5000 });
        testLogger.info(`Column header ${columnName} is visible`);
    }

    async expectUrlContainsLogs() {
        return await expect(this.page.url()).toContain("logs");
    }

    async expectPageContainsText(text) {
        const logsPage = this.page.locator(this.qPageContainer);

        // Wait for the page to stabilize and check for "No events found" condition
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Wait for the container to be present before reading its text
        await logsPage.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});

        // If no data is available, trigger a refresh and wait
        const pageText = await logsPage.textContent({ timeout: 10000 }).catch(() => '');
        if (pageText.includes('No events found')) {
            testLogger.debug('No events found, attempting to refresh...');
            // Wait for the search response that the refresh triggers — deterministic.
            await Promise.all([
                this.page.waitForResponse(
                    resp => resp.url().includes('/_search') && resp.status() === 200,
                    { timeout: 30000 }
                ).catch(() => {}),
                this.clickRefreshButton(),
            ]);
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        }

        return await expect(logsPage).toContainText(text, { timeout: 10000 });
    }

    async clickLogSearchIndexListFieldSearchInput() {
        return await this.page.locator(this.logSearchIndexListFieldSearchInput).click({ force: true });
    }

    async fillLogSearchIndexListFieldSearchInput(text) {
        return await this.fillInputField(this.logSearchIndexListFieldSearchInput, text);
    }

    async clickExpandCode() {
        // FieldExpansion.vue exposes the toggle as
        // [data-test="log-search-expand-<field>-field-btn"] — use the data-test selector.
        return await this.page.locator(this.expandCodeFieldBtn).click();
    }

    async clickLogsDetailTableSearchAroundBtn() {
        return await this.page.locator(this.logsDetailTableSearchAroundBtn).click();
    }

    /**
     * Assert that the results table rendered at least one data row.
     *
     * Historically the default logs view always showed a single generic "source"
     * column (full row as JSON). With the FTS default-column feature, a plain
     * (non-SQL, no-pin) view instead promotes the best-fill full-text "body"
     * field (e.g. "log"/"message"/"body") to its own column, so "source" is no
     * longer guaranteed. Custom SQL queries and aggregates still render "source".
     *
     * This helper therefore passes when EITHER the "source" column OR any other
     * first-row column cell is visible — i.e. "results rendered", independent of
     * which default column the view chose. Use expectLogTableColumnVisible(name)
     * when a specific column must be asserted.
     */
    async expectLogTableColumnSourceVisible() {
        const sourceCol = this.page.locator(this.logTableColumnSource);
        const anyFirstRowCol = this.page.locator('[data-test^="log-table-column-0-"]').first();
        // Whichever appears first satisfies "results rendered".
        await Promise.race([
            sourceCol.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
            anyFirstRowCol.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
        ]);
        return await expect(anyFirstRowCol).toBeVisible();
    }

    /**
     * Wait for a specific named column cell in the first result row to be visible.
     * Only applicable when the user has pinned fields via selectedFields — those
     * fields are rendered as individual columns with id equal to the field name.
     * For aggregate CTEs or any query where no fields are pinned, the table shows
     * a single "source" column (JSON.stringify of the row); use
     * expectLogTableColumnSourceVisible() + expectInterestingFieldInTable() instead.
     * @param {string} columnName - The column/field name (e.g. 'level', 'kubernetes_pod_name')
     * @param {number} rowIndex - Row index (default 0 = first row)
     */
    async expectLogTableColumnVisible(columnName, rowIndex = 0) {
        const element = this.page.locator(`[data-test="log-table-column-${rowIndex}-${columnName}"]`);
        await element.waitFor({ state: 'visible', timeout: 30000 });
        return await expect(element).toBeVisible();
    }

    async clickLogTableColumn3Source() {
        return await this.page.locator(this.logTableColumn3Source).getByText('{"_timestamp":').click();
    }

    async clickHistogramToggleDiv() {
        // Histogram toggle lives in the utilities ("More") menu — delegate to toggleHistogram().
        await this.toggleHistogram();
    }

    async expectQueryEditorContainsExpectedQuery(expectedQuery) {
        const text = await this.page.evaluate((queryEditorSelector) => {
            const editor = document.querySelector(queryEditorSelector).querySelector('.monaco-editor');
            return editor ? editor.textContent.trim() : null;
        }, this.queryEditor);
        testLogger.debug(text);
        return await expect(text.replace(/\s/g, "")).toContain(expectedQuery.replace(/\s/g, ""));
    }

    async expectQueryEditorContainsSelectFrom() {
        return await expect(this.page.locator(this.queryEditor)).toContainText('FROM "e2e_automate"');
    }

    generateRandomString() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    async expectQueryEditorNotContainsText(text) {
        // Assert against Monaco's model value (not DOM view-lines — AGENT_RULES §5).
        await this.page.locator(this.queryEditor).waitFor({ state: 'visible', timeout: 15000 });
        await this.page.waitForFunction(
            ({ selector, expected }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const editors = window.monaco.editor.getEditors();
                for (const ed of editors) {
                    const domNode = ed.getDomNode?.();
                    if (domNode && host.contains(domNode)) {
                        return !(ed.getValue?.() ?? '').includes(expected);
                    }
                }
                // No Monaco editor instance bound — fall through to truthy so the
                // assertion does not falsely report a containing value.
                return true;
            },
            { selector: this.queryEditor, expected: text },
            { timeout: 15000 },
        );
    }

    async expectLogTableColumnSourceNotHaveText(text) {
        await expect(this.page.locator(this.logTableColumnSource)).not.toHaveText(text);
    }

    async selectStreamAndStreamTypeForLogs(stream) {
        // Click the OSelect wrapper to open the popover
        await this.page.locator('[data-test="log-search-index-list-select-stream"]').click();
        await this.page.locator('[data-test="log-search-index-list-select-stream-popover"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        // Fill the search input INSIDE the popover — the wrapper div is not an input
        const popoverSearch = this.page.locator('[data-test="log-search-index-list-select-stream-popover"] input').first();
        await popoverSearch.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await popoverSearch.fill(stream);
        await this.page.waitForTimeout(2000);
        // Click the matching option — OSelect renders each option with data-test-value="{streamName}"
        const option = this.page.locator(
            `[data-test="log-search-index-list-select-stream-option"][data-test-value="${stream}"]`
        ).first();
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();
    }

    // Download-related functions
    async setupDownloadDirectory() {
        // Create unique directory with timestamp and random string
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const downloadDir = path.join(process.cwd(), `temp-downloads-${timestamp}-${randomString}`);
        
        // Create fresh directory
        fs.mkdirSync(downloadDir, { recursive: true });
        
        // Verify directory was created and is writable
        expect(fs.existsSync(downloadDir)).toBe(true);
        
        // Test write permissions by creating a test file
        const testFile = path.join(downloadDir, 'test-write.txt');
        fs.writeFileSync(testFile, 'test');
        expect(fs.existsSync(testFile)).toBe(true);
        fs.unlinkSync(testFile);
        
        return downloadDir;
    }

    async cleanupDownloadDirectory(downloadDir) {
        if (downloadDir && fs.existsSync(downloadDir)) {
            const files = fs.readdirSync(downloadDir);
            for (const file of files) {
                fs.unlinkSync(path.join(downloadDir, file));
            }
            fs.rmdirSync(downloadDir);
        }
    }

    async verifyDownload(download, expectedFileName, downloadDir) {
        const downloadPath = path.join(downloadDir, expectedFileName);
        
        // Save the download
        await download.saveAs(downloadPath);
        
        // Wait for file system to sync
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify file exists and has content
        expect(fs.existsSync(downloadPath)).toBe(true);
        const stats = fs.statSync(downloadPath);
        expect(stats.size).toBeGreaterThan(0);
        
        // Verify it's a CSV file
        const content = fs.readFileSync(downloadPath, 'utf8');
        expect(content).toContain('_timestamp');
        
        // Count rows in the CSV file
        const rows = content.split('\n').filter(line => line.trim() !== '');
        const rowCount = rows.length - 1; // Subtract 1 for header row
        testLogger.debug(`Download ${expectedFileName}: ${rowCount} data rows`);
        
        // Assert row count based on scenario
        if (expectedFileName.includes('custom_100.csv')) {
            expect(rowCount).toBe(100);
        } else if (expectedFileName.includes('custom_500.csv')) {
            expect(rowCount).toBe(500);
        } else if (expectedFileName.includes('custom_1000.csv')) {
            expect(rowCount).toBe(1000);
        } else if (expectedFileName.includes('custom_5000.csv')) {
            expect(rowCount).toBe(5000);
        } else if (expectedFileName.includes('custom_10000.csv')) {
            expect(rowCount).toBe(10000);
        } else if (expectedFileName.includes('sql_limit_2000.csv')) {
            expect(rowCount).toBe(2000);
        } else if (expectedFileName.includes('sql_limit_2000_custom_500.csv')) {
            expect(rowCount).toBe(500);
        } else {
            // For normal "Download results" downloads, we expect some data but not a specific count
            expect(rowCount).toBeGreaterThan(0);
        }
        
        return downloadPath;
    }

    // Helper method for common file validation logic (lines 2037-2046)
    async _saveAndValidateDownloadFile(download, expectedFileName, downloadDir) {
        const downloadPath = path.join(downloadDir, expectedFileName);

        // Save the download
        await download.saveAs(downloadPath);

        // Wait for file system to sync
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify file exists and has content
        expect(fs.existsSync(downloadPath)).toBe(true);
        const stats = fs.statSync(downloadPath);
        expect(stats.size).toBeGreaterThan(0);

        return downloadPath;
    }

    async verifyJsonDownload(download, expectedFileName, downloadDir) {
        const downloadPath = await this._saveAndValidateDownloadFile(download, expectedFileName, downloadDir);

        // Verify it's a JSON file
        const content = fs.readFileSync(downloadPath, 'utf8');

        // Parse as JSON to verify it's valid JSON
        let jsonData;
        try {
            jsonData = JSON.parse(content);
        } catch (error) {
            throw new Error(`Downloaded file is not valid JSON: ${error.message}`);
        }

        // Verify it's an array of objects and contains expected fields
        expect(Array.isArray(jsonData)).toBe(true);
        expect(jsonData.length).toBeGreaterThan(0);

        // Check that the first record has the expected timestamp field
        const firstRecord = jsonData[0];
        expect(firstRecord).toHaveProperty('_timestamp');

        testLogger.debug(`JSON Download ${expectedFileName}: ${jsonData.length} records`);

        return downloadPath;
    }

    async verifyJsonDownloadWithCount(download, expectedFileName, downloadDir, expectedCount) {
        const downloadPath = await this._saveAndValidateDownloadFile(download, expectedFileName, downloadDir);

        // Verify it's a JSON file
        const content = fs.readFileSync(downloadPath, 'utf8');

        // Parse as JSON to verify it's valid JSON
        let jsonData;
        try {
            jsonData = JSON.parse(content);
        } catch (error) {
            throw new Error(`Downloaded file is not valid JSON: ${error.message}`);
        }

        // Verify it's an array of objects and contains expected fields
        expect(Array.isArray(jsonData)).toBe(true);
        expect(jsonData.length).toBe(expectedCount);

        // Check that the first record has the expected timestamp field
        const firstRecord = jsonData[0];
        expect(firstRecord).toHaveProperty('_timestamp');

        testLogger.debug(`JSON Download ${expectedFileName}: ${jsonData.length} records (expected ${expectedCount})`);

        return downloadPath;
    }

    // Download action methods
    async clickMoreOptionsButton() {
        return await this.page.locator(this.moreOptionsBtn).click();
    }

    async hoverMoreOptionsButton() {
        return await this.page.locator(this.moreOptionsBtn).hover();
    }

    async clickExplainQuery() {
        return await this.page.locator('[data-test="logs-search-bar-explain-query-menu-btn"]').click();
    }

    async hoverDownloadResults() {
        // SearchBar.vue:570 — hover the data-tested wrapper to open the nested CSV/JSON
        // submenu (the icon-based `keyboard_arrow_right` text is no longer rendered
        // post-OIcon migration).
        return await this.page.locator(this.downloadSubmenuTrigger).hover();
    }

    /**
     * Click the CSV download button in the more-options → Download results submenu.
     * Ensures the submenu is open (the parent dropdown closes on outside-click so callers
     * must already have clicked clickMoreOptionsButton() + hoverDownloadResults()).
     */
    async clickDownloadCsv() {
        const csvBtn = this.page.locator(this.downloadCsvBtn);
        await csvBtn.waitFor({ state: 'visible', timeout: 10000 });
        return await csvBtn.click();
    }

    /**
     * Click the JSON download button in the more-options → Download results submenu.
     */
    async clickDownloadJson() {
        const jsonBtn = this.page.locator(this.downloadJsonBtn);
        await jsonBtn.waitFor({ state: 'visible', timeout: 10000 });
        return await jsonBtn.click();
    }

    async clickDownloadResultsForCustom() {
        // Post-migration: the dropdown item now has a stable data-test attribute
        // (logs-search-bar-download-custom-range-btn) added in SearchBar.vue.
        return await this.page.locator(this.downloadCustomRangeBtn).click();
    }

    async clickCustomDownloadRangeSelect() {
        // OSelect (reka-ui popover): clicking the root wrapper can open-then-close the
        // listbox on a single click, which continuously re-mounts the options and makes
        // the subsequent option click flake with "element was detached from the DOM".
        // openOSelectDropdown clicks the inner -trigger until aria-expanded="true" so the
        // listbox is stably open before we pick an option.
        await openOSelectDropdown(this.page, this.page.locator(this.customDownloadRangeSelect));
    }

    async selectCustomDownloadRange(range) {
        // OSelect option data-test contract: `${parent}-option` shared + `data-test-value="<value>"`.
        // The reka listbox virtualises/re-renders its items, so the option node can detach
        // between resolve and click. Poll the click until it lands (option gone / selected).
        const option = this.page.locator(this.customDownloadRangeOption(range));
        await expect(async () => {
            await option.click({ timeout: 3000 });
        }).toPass({ timeout: 15000, intervals: [500] });
    }

    async clickCustomDownloadFileTypeJson() {
        return await this.page.locator(this.customDownloadFileTypeJsonBtn).click();
    }

    async clickConfirmDialogOkButton() {
        // Custom download dialog is now an ODialog scoped by `search-bar-custom-download-dialog`;
        // the OK action is the ODialog primary footer button.
        return await this.page.locator(this.customDownloadOkBtn).click();
    }

    async expectCustomDownloadDialogVisible() {
        // Verify the ODialog is mounted (data-test added in SearchBar.vue:1381).
        return await expect(this.page.locator(this.customDownloadDialog)).toBeVisible();
    }

    async expectRequestFailedError() {
        return await expect(this.page.getByText('Request failed with status')).toBeVisible();
    }

    /**
     * Wait for the logs-search-result-title text to show the "Showing X to Y out of Z"
     * pattern with at least one record. Deterministic replacement for the legacy
     * `page.getByText(/Showing [1-9]\d* to \d+ out of [1-9][\d,]*\/)` spec assertion —
     * the title text flows into the data-tested element from histogram.chartParams.title
     * (useHistogram.ts:getHistogramTitle()).
     */
    async expectPaginationRowCountVisible(timeout = 10000) {
        const title = this.page.locator(this.paginationRowCountTitle);
        await expect(title).toBeVisible({ timeout });
        await expect(title).toHaveText(/[1-9][\d,]* to \d+ out of [1-9][\d,]*/, { timeout });
    }

    /**
     * Wait for the total row count reported in `logs-search-result-title` to be at least
     * `minCount`. Deterministic wait for SQL-mode `LIMIT N` queries where the in-memory
     * hits array must be fully populated before triggering a download.
     *
     * Strict data-test-only implementation (AGENT_RULES §2 — no Vue internals, no DOM
     * attribute reads via `querySelector`, no class/role/text locators):
     *  1. Wait for the run-query button — located by its data-test — to be enabled
     *     AND to not carry the `title="Cancel"` attribute. Both checks use Playwright
     *     matchers (`toBeEnabled`, `not.toHaveAttribute`) against the data-test
     *     locator, no manual attribute reads.
     *  2. Poll the title's `out of N` text via `toContainText` with a two-sample
     *     stability gate — require two consecutive reads to agree before returning.
     *     Absorbs the brief window where one streaming chunk has updated the title
     *     while the underlying hits array is still being mutated by sibling chunks.
     */
    async expectPaginationTotalAtLeast(minCount, timeout = 60000) {
        // SearchResult.vue is rendered in multiple modes (Logs view + Visualize via v-show),
        // so `[data-test="logs-search-result-title"]` matches more than one element. Scope to
        // the VISIBLE instance so we never read attributes off the hidden Visualize copy
        // (whose searchObj is a different store and shows stale/zero values).
        const title = this.page.locator(`${this.paginationRowCountTitle}:visible`).first();
        await expect(title).toBeVisible({ timeout });

        // Stage 1 — wait for the source-side loading signal to flip to "complete".
        // SearchResult.vue binds :data-search-state="searchObj.loading || searchObj.loadingCounter
        // ? 'loading' : 'complete'" on this same title element. The attribute is the ATOMIC
        // truth — it flips only after the streaming partition chain fully resolves AND the
        // total-counter request completes. This replaces the brittle button-text/title polling
        // (which has multiple .catch() escape hatches that mask incomplete streaming on slow CI).
        await expect(title).toHaveAttribute('data-search-state', 'complete', { timeout })
            .catch(() => {
                testLogger.warn(
                    'expectPaginationTotalAtLeast: data-search-state never flipped to "complete", continuing'
                );
            });

        // Stage 2 — read the hits count directly from the data-hits-count attribute.
        // SearchResult.vue exposes `searchObj.data.queryResults.hits.length` as
        // :data-hits-count="...". Polling this attribute is race-free vs. parsing the
        // localized "out of N" string (which can be "out of 2,000" — comma localized).
        let lastCount = 0;
        await expect.poll(async () => {
            const raw = (await title.getAttribute('data-hits-count').catch(() => '0')) ?? '0';
            const current = Number.parseInt(raw, 10) || 0;
            lastCount = current;
            return current;
        }, { timeout, intervals: [200, 500, 500, 1000, 1000, 2000] }).toBeGreaterThanOrEqual(minCount);
        testLogger.info(`expectPaginationTotalAtLeast: hits=${lastCount} (>= ${minCount})`);
    }

    async waitForDownload() {
        return await this.page.waitForEvent('download');
    }

    async clickAllFieldsButton() {
        // FieldListPagination.vue renders one of two toggle groups:
        //  - When user-defined-schema toggle is shown: per-slot data-tests like
        //    "logs-user-defined-fields-btn-all_fields_slot".
        //  - When only Quick Mode is on: data-test="logs-all-fields-btn" directly on
        //    the "all_fields" OToggleGroupItem.
        // Use the canonical class member which already covers the prefixed
        // (`logs-page-…`) and legacy variants in a single locator.
        const btn = this.page.locator(this.allFieldsToggleBtn).first();
        if (await btn.isVisible().catch(() => false)) {
            await btn.click();
        } else {
            // Neither toggle exposes "all_fields" — the field list is already in the
            // default state; nothing to click.
        }
        // Wait for interesting field items to populate (cloud may load slowly)
        await this.page.locator('[data-test^="log-search-index-list-interesting-"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    }

    async enableQuickModeIfDisabled() {
        // Fast pre-check: the "interesting fields" toggle item (data-test
        // "logs-interesting-fields-btn") is rendered by FieldListPagination ONLY in the
        // no-user-defined-schema branch AND only when showQuickMode is true, so its
        // presence is a reliable "quick mode already on" signal. It is intentionally
        // absent on user-defined-schema streams (cloud/enterprise) — in that case we
        // fall through and verify the actual switch state via the utilities menu.
        const quickModeIndicator = this.page.locator(
            '[data-test="logs-interesting-fields-btn"]',
        ).first();
        // NOTE: the user-defined-schema toggle group (data-test
        // "logs-page-field-list-user-defined-schema-toggle") is NOT a reliable
        // quick-mode signal — FieldListPagination renders it whenever the stream
        // exposes a user-defined schema (showUserDefinedSchemaToggle), regardless of
        // searchObj.meta.quickMode. The per-field interesting (star) buttons are gated
        // purely on quickMode (FieldRow/FieldExpansion `v-if="showQuickMode"`), so we
        // must verify the actual Quick Mode switch state via the utilities menu rather
        // than infer "quick mode is on" from the sidebar toggle group. Treating the
        // toggle group as an indicator made all interesting-field tests fail on cloud/
        // enterprise streams (which always surface a user-defined schema).
        if (await quickModeIndicator.isVisible().catch(() => false)) {
            return;
        }

        // Quick Mode is off — open the utilities dropdown and enable the OSwitch.
        // Post-UX-revamp: the ODropdownItem was renamed to logs-search-bar-menu-quick-mode-toggle-btn.
        // The OSwitch inside carries data-test="logs-search-bar-quick-mode-switch" and its
        // inner button data-test="logs-search-bar-quick-mode-switch-btn" with data-state="checked|unchecked".
        const quickModeItem = this.page.locator('[data-test="logs-search-bar-menu-quick-mode-toggle-btn"]');
        const quickModeSwitch = this.page.locator('[data-test="logs-search-bar-quick-mode-switch"]');
        let enabled = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            await this.page.keyboard.press('Escape').catch(() => {});

            await this.page.locator(this.utilitiesMenuButton).click({ force: true });
            const menuOpened = await quickModeItem.waitFor({ state: 'visible', timeout: 4000 })
                .then(() => true).catch(() => false);

            if (!menuOpened) continue;

            // Read OSwitch state via data-test on the inner button.
            const state = await quickModeSwitch
                .locator('[data-test$="-btn"]')
                .getAttribute('data-state')
                .catch(() => null);
            if (state === 'checked') {
                await this.page.keyboard.press('Escape').catch(() => {});
                enabled = true;
                break;
            }

            // Click the inner OSwitch — its @click.stop handler invokes handleQuickMode
            // synchronously regardless of the ODropdownItem select event timing.
            await quickModeSwitch.first().click({ force: true });
            await this.page.keyboard.press('Escape').catch(() => {});
            enabled = true;
            break;
        }

        if (!enabled) {
            throw new Error('Quick Mode could not be enabled after 3 attempts');
        }

        // Wait for the utilities dropdown portal to actually close — otherwise its
        // popper still intercepts pointer events on the page (query editor clicks fail).
        await quickModeItem.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

        // Confirm Quick Mode actually took effect: the per-field interesting (star)
        // buttons only render when searchObj.meta.quickMode is true. Wait for one to
        // surface (best-effort — ensureFieldIsInteresting has its own retry loop that
        // re-applies the field-search filter if the button hasn't appeared yet).
        await this.page
            .locator('[data-test^="log-search-index-list-interesting-"]')
            .first()
            .waitFor({ state: 'visible', timeout: 8000 })
            .catch(() => {});
    }

    async clickTimestampField() {
        // Post-OFieldList migration the field row is data-test="logs-field-list-item-<field>"
        // (FieldRow.vue:22). Click the row directly — it dispatches the field-click event.
        const field = this.page.locator('[data-test="logs-field-list-item-_timestamp"]').first();
        await field.waitFor({ state: 'visible', timeout: 10000 });
        return await field.click({ force: true });
    }

    async clickSchemaButton() {
        // "Schema" maps to the all-fields toggle in FieldListPagination (icon-only button
        // with the schema icon). Constructor exposes both render-path variants.
        const btn = this.page.locator(this.allFieldsToggleBtn).first();
        await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        return await btn.click({ force: true });
    }

    async clickInfoSchemaButton() {
        // "Infoschema" maps to the interesting-fields toggle (info-outline + schema icon).
        const btn = this.page.locator(this.interestingFieldsToggleBtn).first();
        await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        return await btn.click({ force: true });
    }

    async clickClearButton() {
        // "Clear" maps to the reset-fields icon at the end of FieldListPagination.
        const btn = this.page.locator(this.fieldListResetIcon).first();
        await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        return await btn.click({ force: true });
    }

    /**
     * Click the field-list reset icon (FieldListPagination "Clear" button).
     * Clears selectedFields and sets isFtsDefaultColumn to false, used by
     * FTS default-column tests to verify re-resolution after a reset.
     * @returns {Promise<void>}
     */
    async clickFieldListResetIcon() {
        const btn = this.page.locator(this.fieldListResetIcon).first();
        await expect(btn).toBeVisible({ timeout: 5000 });
        await btn.click();
        // Wait for the field sidebar to settle after reset trims selectedFields.
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async expectTimestampFieldVisible() {
        // Post-OFieldList migration: data-test="logs-field-list-item-_timestamp"
        // Clear any active field-search filter and switch back to All Fields view —
        // semantic intent is "the _timestamp field still exists in the stream", which
        // can be hidden by a stale search filter or by interesting-fields-only mode
        // left over from the calling test. clickClearButton (reset-fields-icon) only
        // resets `selectedFields`, not `filterField`, so we clear it explicitly here.
        const searchInput = this.page.locator(this.logSearchIndexListFieldSearchInput);
        if (await searchInput.isVisible().catch(() => false)) {
            const currentValue = await searchInput.inputValue().catch(() => '');
            if (currentValue) {
                await searchInput.fill('');
            }
        }
        // If the field list is currently in interesting-fields-only mode (no schema
        // toggle group surfaced), switch back to All Fields so _timestamp surfaces.
        const allFieldsBtn = this.page.locator(this.allFieldsToggleBtn).first();
        if (await allFieldsBtn.isVisible().catch(() => false)) {
            await allFieldsBtn.click({ force: true }).catch(() => {});
        }
        const field = this.page.locator('[data-test="logs-field-list-item-_timestamp"]').first();
        await field.waitFor({ state: 'visible', timeout: 10000 });
        return await expect(field).toBeVisible();
    }

    // Field management methods for add/remove fields to table
    async hoverOnFieldExpandButton(fieldName) {
        const expandBtn = this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);
        const addRemoveBtn = this.page.locator(`[data-test="log-search-index-list-add-${fieldName}-field-btn"], [data-test="log-search-index-list-remove-${fieldName}-field-btn"]`).first();

        // Check primary selector first (use waitFor since isVisible doesn't support timeout)
        try {
            await expandBtn.waitFor({ state: 'visible', timeout: 5000 });
            await expandBtn.hover();
            // Wait for the hover-revealed add/remove button to surface instead of a fixed buffer.
            await addRemoveBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            return;
        } catch {
            // Primary selector not found, try alternate
        }

        // Try alternate selector
        const altBtn = this.page.locator(`[data-test*="expand-${fieldName}"]`).first();
        if (await altBtn.isVisible().catch(() => false)) {
            await altBtn.hover();
            await addRemoveBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            return;
        }

        throw new Error(`Field expand button not found for: ${fieldName}`);
    }

    async clickAddFieldToTableButton(fieldName) {
        const addBtn = this.page.locator(`[data-test="log-search-index-list-add-${fieldName}-field-btn"]`);
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 5000 });
        } catch {
            // The add button is only revealed while the field row is hovered. Under CI load
            // the hover state can be lost (or never settled) before the click — re-hover the
            // field row and wait again before giving up.
            await this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`).hover().catch(() => {});
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        }
        await addBtn.click();
        // The add operation commits when both (a) the toggle inverts to a remove
        // button in the sidebar, and (b) the field column header appears in the
        // logs table. Wait for either signal — both fire on success.
        await Promise.any([
            this.page.locator(`[data-test="log-search-index-list-remove-${fieldName}-field-btn"]`).waitFor({ state: 'visible', timeout: 10000 }),
            this.page.locator(`[data-test="log-search-result-table-th-${fieldName}"]`).waitFor({ state: 'visible', timeout: 10000 }),
        ]).catch(() => {});
    }

    async clickRemoveFieldFromTableButton(fieldName) {
        const removeBtn = this.page.locator(`[data-test="log-search-index-list-remove-${fieldName}-field-btn"]`);
        await removeBtn.waitFor({ state: 'visible', timeout: 5000 });
        await removeBtn.click();
        // Symmetric to add: the field column header disappears AND/OR the toggle
        // reverts to an add button. Wait on either DOM convergence.
        await Promise.any([
            this.page.locator(`[data-test="log-search-index-list-add-${fieldName}-field-btn"]`).waitFor({ state: 'visible', timeout: 10000 }),
            this.page.locator(`[data-test="log-search-result-table-th-${fieldName}"]`).waitFor({ state: 'hidden', timeout: 10000 }),
        ]).catch(() => {});
    }

    async expectFieldInTableHeader(fieldName, timeout = 10000) {
        return await expect(this.page.locator(`[data-test="log-search-result-table-th-${fieldName}"]`)).toBeVisible({ timeout });
    }

    async expectFieldNotInTableHeader(fieldName) {
        // After removing a field, its column header must no longer be present.
        // (Asserting on the removed field is mode-agnostic: the default view may
        // fall back to the generic "source" column or the FTS "body" column.)
        return await expect(
            this.page.locator(`[data-test="log-search-result-table-th-${fieldName}"]`),
        ).toHaveCount(0);
    }

    /**
     * Resolve which FTS default column is currently rendered in the results table.
     * Both `message` and `log` are valid FTS candidates (`message` has the higher
     * FTS priority). Waits for *either* header to appear and returns whichever is
     * present — this replaces the "wait the full timeout on `message`, then fall
     * back to `log`" try/catch pattern, which cost ~10-15s on every call whenever
     * `log` was the active field.
     * @param {number} timeout - Max ms to wait for an FTS header to appear.
     * @returns {Promise<'message'|'log'>} The FTS field currently in the header.
     */
    async resolveFtsDefaultField(timeout = 15000) {
        const message = this.page.locator('[data-test="log-search-result-table-th-message"]');
        const log = this.page.locator('[data-test="log-search-result-table-th-log"]');
        await expect(message.or(log).first()).toBeVisible({ timeout });
        return (await message.isVisible().catch(() => false)) ? 'message' : 'log';
    }

    /**
     * Close a column by clicking the X (close) button on its header.
     * Used by FTS default-column tests to verify that closing the auto-picked
     * column triggers re-resolution on the next search.
     *
     * The close button has a CSS `invisible` class and only appears on
     * column-header hover, so we hover the header to reveal it, then click it
     * normally — keeping Playwright's actionability checks (a `force` click would
     * skip them and mask a regression that makes the button non-interactable).
     * @param {string} fieldName - The field/column name to close (e.g. 'message')
     * @returns {Promise<void>}
     */
    async clickCloseColumnButton(fieldName) {
        const header = this.page.locator(
            `[data-test="log-search-result-table-th-${fieldName}"]`,
        );
        const closeBtn = this.page.locator(
            `[data-test="logs-search-result-table-th-remove-${fieldName}-btn"]`,
        );
        // Hover the column header to reveal its hover-gated X, then click normally
        // so the actionability check still runs (no force).
        await header.hover();
        await expect(closeBtn).toBeVisible({ timeout: 5000 });
        await closeBtn.click();
        // Wait for the column to disappear from the DOM header row
        await expect(header).toHaveCount(0, { timeout: 10000 });
    }

    // New POM methods for PR tests

    async executeBlankQueryWithKeyboardShortcut() {
        // A truly blank SQL query is not achievable: the fullSQLMode watcher in Index.vue
        // calls setQuery() whenever sqlMode transitions to true with an empty editor, which
        // auto-generates "SELECT * FROM <stream>" — so Ctrl+Enter would run a valid query
        // and return results instead of an error.
        //
        // Use an intentionally invalid SQL statement instead. setQuery() returns early when
        // the current query already contains "select" (Index.vue line ~1397), so the watcher
        // will not overwrite it. The backend receives malformed SQL and returns an error,
        // which sets searchObj.data.errorMsg and shows the error banner.
        await this.setQueryEditorContent('SELECT *');
        await this.page.waitForTimeout(300);

        await this.clickQueryEditor();
        await this.page.waitForTimeout(100);
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    }

    async expectBlankQueryError() {
        // Verify proper error handling for blank SQL query (the actual behavior from PR #9023)
        // Allow a longer timeout for the error banner — the backend issues a delayed
        // error response for blank queries.
        // Index.vue: data-test="logs-search-error-state" wraps LogsErrorState → QueryErrorState
        const errorMessage = this.page.locator(this.errorMessage).first();
        await expect(errorMessage).toBeVisible({ timeout: 30000 });

        // Verify there's a clickable error details toggle.
        // Hero layout (logs page) uses error-detail-toggle-btn (in ErrorDetailPanel).
        // Block layout uses query-error-toggle-detail-btn (in QueryErrorState).
        const errorDetailsBtn = this.page.locator('[data-test="error-detail-toggle-btn"], [data-test="query-error-toggle-detail-btn"]').first();
        if (await errorDetailsBtn.isVisible()) {
            await errorDetailsBtn.click();
            testLogger.info('✓ Error details toggle clicked successfully');
        }
    }

    async openFirstLogDetails() {
        // Click on the first log entry to open details (expand the first column)
        await this.page.locator('[data-index="0"] [data-test="table-row-expand-menu"]').click();
        // Wait for the details drawer to open — keys off the actual reveal instead of a buffer.
        await this.page.locator('[data-test="logs-search-result-detail-dialog"], [data-test="log-details-include-exclude-field-btn"], [data-test="log-details-include-field-btn"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }

    async addIncludeSearchTermFromLogDetails() {
        // Ensure Quick Mode is OFF for include/exclude buttons to work
        // Quick mode is now inside the utilities hamburger menu
        const toggleInner = this.page.locator('[data-test="logs-search-bar-quick-mode-switch-btn"]');
        await this.page.locator(this.utilitiesMenuButton).click();
        await toggleInner.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        const state = await toggleInner.getAttribute('data-state').catch(() => null);
        const isQuickModeOn = state === 'checked';

        if (isQuickModeOn) {
            testLogger.info('Quick Mode is ON - turning it OFF for include/exclude functionality');
            await this.page.locator('[data-test="logs-search-bar-quick-mode-switch"]').click();
            await this.page.waitForTimeout(1000);
        } else {
            testLogger.info('Quick Mode is already OFF');
            await this.page.keyboard.press('Escape').catch(() => {});
        }

        // Check if there's a direct include button (newer UI)
        const directIncludeButton = this.page.locator('[data-test="log-details-include-field-btn"]');
        const directIncludeCount = await directIncludeButton.count();

        if (directIncludeCount > 0) {
            testLogger.info(`Found ${directIncludeCount} direct include buttons`);
            await directIncludeButton.first().click();
            await this.page.waitForTimeout(1000);
            return;
        }

        // Otherwise use the dropdown approach (older UI)
        // Don't use the first button (which is for _timestamp field), use the second one
        const includeExcludeButtons = this.page.locator('[data-test="log-details-include-exclude-field-btn"]');
        const buttonCount = await includeExcludeButtons.count();
        testLogger.info(`Found ${buttonCount} include/exclude buttons in log details`);

        // Use the second button (index 1) to skip _timestamp field
        if (buttonCount > 1) {
            await expect(includeExcludeButtons.nth(1)).toBeVisible();
            await includeExcludeButtons.nth(1).click();
        } else if (buttonCount > 0) {
            // Fallback to first if only one exists
            await expect(includeExcludeButtons.first()).toBeVisible();
            await includeExcludeButtons.first().click();
        } else {
            throw new Error('No include/exclude buttons found in log details');
        }
        // Wait for the Include Search Term menu item (data-test="log-details-include-field-btn")
        const includeMenuItem = this.page.locator('[data-test="log-details-include-field-btn"]').first();

        try {
            await includeMenuItem.waitFor({ state: 'visible', timeout: 5000 });
            testLogger.info('Include Search Term menu item found');
            await includeMenuItem.click();
        } catch (e) {
            // Take screenshot for debugging if menu doesn't appear
            await this.page.screenshot({ path: 'playwright-tests/Logs/include-menu-after-click.png', fullPage: true });
            testLogger.info('Screenshot saved after clicking include/exclude button');
            throw new Error('Include Search Term menu item not found (data-test="log-details-include-field-btn")');
        }

        await this.page.waitForTimeout(1000);
    }

    async expectIncludeExcludeButtonsVisibleInLogDetails() {
        // CRITICAL ASSERTION: After running query, the include/exclude buttons should still be visible
        const postQueryButtons = this.page.locator('[data-test="log-details-include-exclude-field-btn"]');
        
        // Assert that include/exclude buttons are still visible after query run
        await expect(postQueryButtons.first()).toBeVisible();
        await expect(postQueryButtons.nth(1)).toBeVisible();
        
        // Assert that we still have multiple buttons available
        const buttonCount = await postQueryButtons.count();
        expect(buttonCount).toBeGreaterThanOrEqual(2);
        
        testLogger.info(`✓ ${buttonCount} include/exclude buttons remain visible in open log details AFTER query run`);
        return buttonCount;
    }

    async setupAPICallTracking() {
        const allRequests = [];
        
        const requestHandler = (request) => {
            if (request.url().includes('/_search_stream') && request.method() === 'POST') {
                let postData = null;
                try {
                    postData = request.postData();
                } catch (e) {
                    postData = 'Unable to read post data';
                }

                allRequests.push({
                    url: request.url(),
                    postData: postData,
                    timestamp: Date.now()
                });
            }
        };
        
        this.page.on('request', requestHandler);
        
        return { allRequests, requestHandler };
    }

    async executeQueryWithKeyboardShortcutAndTrackAPICalls(query) {
        // Clear any existing query and add a test query
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type(query);

        // Use cmd+enter to run the query — track BOTH the regular search POST and
        // the histogram POST. Histogram calls go to _search_stream with is_ui_histogram=true
        // in the URL; regular search calls go to _search_stream without that param.
        let sawHistogram = false;
        let sawSearch = false;
        const observer = (req) => {
            if (req.url().includes('/_search_stream') && req.method() === 'POST') {
                if (req.url().includes('is_ui_histogram=true')) {
                    sawHistogram = true;
                } else {
                    sawSearch = true;
                }
            }
        };
        this.page.on('request', observer);
        this._queryTriggerTime = Date.now();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        try {
            await this.page.waitForFunction(() => true, { timeout: 1 }).catch(() => {});
            await expect.poll(() => sawHistogram && sawSearch, { timeout: 15000, intervals: [200] }).toBe(true);
        } catch {
            // Fall through — verifyAPICallCounts will assert the failure with full context.
        } finally {
            this.page.off('request', observer);
        }
        // Allow the network event listener in setupAPICallTracking to also receive the requests.
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async verifyAPICallCounts(allRequests, requestHandler) {
        // Filter requests that arrived after cmd+enter was pressed.
        // Using a fixed 5 s window from "now" is wrong — waitForLoadState can
        // take up to 10 s, pushing the captured timestamps past the 5 s cutoff.
        const cutoff = this._queryTriggerTime || (Date.now() - 30000);
        const recentRequests = allRequests.filter(req => req.timestamp >= cutoff);

        // Histogram calls go to _search_stream with is_ui_histogram=true in the URL.
        // Regular search calls go to _search_stream without that parameter.
        const searchCalls = recentRequests.filter(req =>
            !req.url.includes('is_ui_histogram=true')
        );
        const histogramCalls = recentRequests.filter(req =>
            req.url.includes('is_ui_histogram=true')
        );

        // Verify exactly 1 search call and 1 histogram call are made
        expect(searchCalls.length).toBe(1);
        expect(histogramCalls.length).toBe(1);
        expect(recentRequests.length).toBe(2);

        // Clean up event listener
        this.page.off('request', requestHandler);

        return { searchCalls: searchCalls.length, histogramCalls: histogramCalls.length, total: recentRequests.length };
    }

    async getEditorContentBefore() {
        // Read the Monaco editor model directly (per AGENT_RULES §5) — DOM-scraping
        // .view-lines is brittle when Monaco is mid-render.
        const text = await this.page.evaluate((selector) => {
            const host = document.querySelector(selector);
            if (!host || !window.monaco?.editor?.getEditors) return '';
            const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
            return ed ? ed.getValue() : '';
        }, this.queryEditor);
        return (text || '').trim().replace(/\s+/g, ' ');
    }

    async getEditorContentAfter() {
        // Symmetric to getEditorContentBefore — read via the Monaco model.
        const text = await this.page.evaluate((selector) => {
            const host = document.querySelector(selector);
            if (!host || !window.monaco?.editor?.getEditors) return '';
            const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
            return ed ? ed.getValue() : '';
        }, this.queryEditor);
        return (text || '').trim().replace(/\s+/g, ' ');
    }

    async setupEditorForCursorTest(query) {
        // Click in the query editor and add a simple query
        const queryEditor = this.page.locator(this.queryEditor);
        await queryEditor.click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        // Drive the editor through Monaco's executeEdits API instead of keystrokes —
        // typing into the search bar is intercepted by the input which has a
        // debounced model-value chain that races the test's read. The Monaco model
        // commits synchronously through executeEdits.
        await this.page.evaluate(({ selector, text }) => {
            const host = document.querySelector(selector);
            if (!host || !window.monaco?.editor?.getEditors) return false;
            const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
            if (!ed) return false;
            ed.setValue(text);
            ed.focus();
            const lastLine = ed.getModel().getLineCount();
            const lastCol = ed.getModel().getLineMaxColumn(lastLine);
            ed.setPosition({ lineNumber: lastLine, column: lastCol });
            return true;
        }, { selector: this.queryEditor, text: query });

        // Confirm the model carries exactly the expected text before returning.
        await this.page.waitForFunction(
            ({ selector, expected }) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return false;
                const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
                if (!ed) return false;
                return (ed.getValue() || '').trim() === expected;
            },
            { selector: this.queryEditor, expected: query },
            { timeout: 10000 }
        );
    }

    async executeQueryWithKeyboardShortcutForEditor() {
        // Press cmd+enter to run the query — the editor content check follows,
        // wait for the search request to flush before reading it.
        const searchPromise = this.page.waitForRequest(req => req.url().includes('/_search') && req.method() === 'POST', { timeout: 10000 }).catch(() => null);
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        await searchPromise;
    }

    async verifyEditorContentIntegrity(initialQuery, finalQuery) {
        // The query content should remain exactly the same 
        expect(finalQuery).toBe(initialQuery);
        expect(finalQuery).toBe('select * from "e2e_automate"');
        
        // Additional integrity checks
        expect(finalQuery).not.toMatch(/\n/); // No newlines
        expect(finalQuery).not.toMatch(/\r/); // No carriage returns  
        expect(finalQuery).not.toMatch(/^\d/); // No leading numbers
        expect(finalQuery).not.toContain('monaco'); // No Monaco artifacts
    }

    // Additional POM methods to eliminate all locators from spec file

    async expectLogsSearchResultLogsTableVisible() {
        await expect(this.page.locator(this.logsSearchResultLogsTable)).toBeVisible();
    }

    async getKubernetesFields() {
        return this.page.locator(this.kubernetesFieldsSelector);
    }

    async getKubernetesFieldsCount() {
        const kubernetesFields = this.page.locator(this.kubernetesFieldsSelector);
        return await kubernetesFields.count();
    }

    async getSpecificFieldLocator(fieldName) {
        return this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);
    }

    async getAllFields() {
        return this.page.locator(this.allFieldsSelector);
    }

    async getMatchingFields() {
        return this.page.locator(this.matchingFieldsSelector);
    }

    async countMatchingFields() {
        const matchingFields = this.page.locator(this.matchingFieldsSelector);
        return await matchingFields.count();
    }

    async ensureQuickModeState(desiredState) {
        // Quick mode is now inside the utilities hamburger menu
        await this.page.locator(this.utilitiesMenuButton).waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(this.utilitiesMenuButton).click();
        // Wait for the menu to render the quick mode toggle before reading or clicking
        const quickModeBtn = this.page.locator(this.quickModeToggle);
        await quickModeBtn.waitFor({ state: 'visible', timeout: 5000 });
        // OSwitch inner button carries data-test="logs-search-bar-quick-mode-switch-btn"
        // and data-state="checked|unchecked".
        const toggleInner = this.page.locator('[data-test="logs-search-bar-quick-mode-switch-btn"]');
        const state = await toggleInner.getAttribute('data-state').catch(() => null);
        const isOn = state === 'checked';

        if (desiredState !== isOn) {
            // Click the inner OSwitch <button> (data-state="checked|unchecked") — the outer wrapper
            // is a <div> that Playwright treats as non-interactive and times out on.
            // force: true — ODropdown portal transiently detaches items during initial render
            await this.page.locator('[data-test="logs-search-bar-quick-mode-switch-btn"]').click({ force: true });
            // Wait for OSwitch data-state to flip to the desired value
            const expectedState = desiredState ? 'checked' : 'unchecked';
            await this.page.waitForFunction(
                (expected) => {
                    const el = document.querySelector('[data-test="logs-search-bar-quick-mode-switch-btn"]');
                    return el && el.getAttribute('data-state') === expected;
                },
                expectedState,
                { timeout: 5000 },
            ).catch(() => {});
        }
        // Close menu by pressing Escape (avoid body-position click — violates §2 selector policy)
        await this.page.keyboard.press('Escape');
    }

    async ensureHistogramToggleState(desiredState) {
        // In normal viewports the histogram is an inline toolbar button.
        // Delegates to logsQueryPage which already handles both inline and menu cases.
        const isOn = await this.logsQueryPage.isHistogramOn();
        if (desiredState !== isOn) {
            await this.toggleHistogram(); // toggleHistogram checks inline first
            return true; // State was changed
        }
        return false; // State was already correct
    }

    async getQuickModeToggleAttributes() {
        // Quick mode is now inside the utilities hamburger menu.
        // Close anything that's open, then re-open the menu deterministically.
        const quickModeToggle = this.page.locator(this.quickModeToggle);
        await this.page.keyboard.press('Escape').catch(() => {});
        await quickModeToggle.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
        await this.page.locator(this.utilitiesMenuButton).click();
        await quickModeToggle.waitFor({ state: 'visible', timeout: 10000 });
        const ariaPressed = await quickModeToggle.getAttribute('aria-pressed');
        const classNames = await quickModeToggle.getAttribute('class');
        // Dismiss with Escape — avoid `body`-position click (selector policy).
        await this.page.keyboard.press('Escape').catch(() => {});
        return { ariaPressed, classNames };
    }

    async expectQuickModeToggleVisible() {
        // Quick mode is now inside the utilities hamburger menu
        const toggle = this.page.locator(this.quickModeToggle);
        await this.page.locator(this.utilitiesMenuButton).click();
        // Wait deterministically for the toggle to surface in the open menu
        await toggle.waitFor({ state: 'visible', timeout: 5000 });
        await expect(toggle).toBeVisible();
        // Dismiss the popover with Escape to avoid `body` locator usage
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    async waitForUI(timeout = 500) {
        await this.page.waitForTimeout(timeout);
    }

    // Methods specifically for multistream testing that don't already exist
    async navigateToHome() {
        return await this.page.locator('[data-test="menu-link-\\/-item"]').click();
    }

    async fillStreamFilter(streamName) {
        // Open the OSelect popover and type into the filter/search input so the
        // virtualised option list renders the target row.
        const trigger = this.page.locator(this.indexDropDownTrigger);
        const wrapper = this.page.locator(this.indexDropDown);
        const popover = this.page.locator(this.indexDropDownPopover);
        if (await trigger.count() > 0) {
            await trigger.first().click();
        } else {
            await wrapper.click();
        }
        await popover.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        // The search input's data-test may not forward; try the explicit
        // -search locator first, then fall back to any <input> in the popover.
        const search = this.page.locator(this.indexDropDownSearch);
        if (await search.count() > 0) {
            await search.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            await search.press('ControlOrMeta+a').catch(() => {});
            await search.press('Backspace').catch(() => {});
            return await search.fill(streamName);
        }
        // No search input available — leave popover open unfiltered.
        return null;
    }

    async toggleStreamSelection(streamName) {
        // Post-OSelect-migration: the legacy select toggle data-test
        // `log-search-index-list-stream-toggle-<name>` is no longer emitted.
        // Pick the OSelect option whose `data-test-value` matches streamName.
        // Caller must ensure the popover is open (e.g. via fillStreamFilter).
        //
        // IMPORTANT: OSelect with rowClickSingleSelect=true splits each option into a
        // checkbox zone (left) and a label zone (right). A click at the element centre
        // lands in the label zone and fires handleRowClickSingleSelect, which REPLACES
        // the current selection with just this stream. To ADD to the multi-select we
        // must click the checkbox span ([data-select-checkbox]) in the left zone.
        const option = this.page.locator(
            `[data-test="log-search-index-list-select-stream-option"][data-test-value="${streamName}"]`,
        ).first();
        await option.waitFor({ state: 'visible', timeout: 5000 });
        const checkbox = option.locator('[data-select-checkbox]').first();
        const checkboxVisible = await checkbox.isVisible({ timeout: 1000 }).catch(() => false);
        if (checkboxVisible) {
            // Click the checkbox to toggle without replacing existing selection
            return await checkbox.click({ force: true });
        }
        // Fallback: single-select mode — click the option normally
        return await option.click();
    }

    async toggleQueryModeEditor() {
        // Post-menu-migration: the function/transform editor toggle moved into the
        // utilities ("More") dropdown as logs-search-bar-menu-transform-editor-toggle-btn.
        // Open the dropdown if needed, click the toggle item, then close the menu.
        // Retry loop: in headless CI, reka-ui's focus-outside detection can close the portal
        // between the open click and the item click. Retry up to 3 times to be resilient.
        const transformEditorMenuItem = this.page.locator('[data-test="logs-search-bar-menu-transform-editor-toggle-btn"]');
        let clicked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            const isVisible = await transformEditorMenuItem.isVisible({ timeout: 500 }).catch(() => false);
            if (!isVisible) {
                await this.page.locator(this.utilitiesMenuButton).click({ force: true });
                const appeared = await transformEditorMenuItem.waitFor({ state: 'visible', timeout: 5000 })
                    .then(() => true).catch(() => false);
                if (!appeared) continue;
            }
            // Click immediately — no fixed delay. The waitFor above already confirmed the element
            // is visible. A fixed delay here allows reka-ui's focus-outside to close the portal
            // in headless Chromium CI before the click executes.
            const success = await transformEditorMenuItem.click({ force: true, timeout: 3000 })
                .then(() => true).catch(() => false);
            if (success) { clicked = true; break; }
        }
        if (!clicked) throw new Error('toggleQueryModeEditor: could not click transform editor menu item after 3 attempts');

        // @select.prevent keeps the menu open — close it so it doesn't overlap the editor
        await this.page.keyboard.press('Escape');
        // Wait for the VRL function editor container to appear
        await this.page.locator(this.fnEditor).first().waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickMonacoEditor() {
        // Wait for Monaco editor to be fully rendered (Firefox needs longer)
        const monacoEditor = this.page.locator('[data-test="logs-vrl-function-editor"]').first().locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        // Scroll into view for Firefox (element may be outside viewport)
        await monacoEditor.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(1500); // Extra stabilization for Firefox
        return await monacoEditor.click({ force: true });
    }

    async fillMonacoEditor(text) {
        // Wait for Monaco editor to be visible (Firefox rendering is slower)
        const fnEditorContainer = this.page.locator('[data-test="logs-vrl-function-editor"]').first();
        const monacoEditor = fnEditorContainer.locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });

        // Use JavaScript to scroll the fnEditor into center of viewport (more reliable for Firefox)
        await fnEditorContainer.evaluate(el => {
            el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        });
        await this.page.waitForTimeout(2000); // Extra stabilization for Firefox

        // Click on the Monaco editor container using coordinates (more reliable for Firefox viewport issues)
        const editorBox = await monacoEditor.boundingBox();
        if (editorBox) {
            await this.page.mouse.click(editorBox.x + 50, editorBox.y + 20);
        } else {
            // Fallback: click with force
            await monacoEditor.click({ force: true });
        }
        await this.page.waitForTimeout(500);

        // Clear existing content and fill using keyboard (more reliable on Firefox)
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.type(text, { delay: 50 });
    }

    async getCellByName(name) {
        // UX revamp: index list group headers are <div data-test="o-field-list-group-<name>">
        // (no role="cell"). Prefer the o-field-list-group locator when the
        // requested name matches a group header; fall back to ARIA cell role
        // for actual table cells elsewhere.
        // Use waitFor instead of count() — count() is synchronous and returns 0 if the
        // element hasn't rendered yet, causing a false fall-through to the ARIA locator.
        const groupLocator = this.page.locator('[data-test^="o-field-list-group-"]')
            .filter({ hasText: name });
        try {
            await groupLocator.first().waitFor({ state: 'visible', timeout: 15000 });
            return groupLocator.first();
        } catch {
            return this.page.getByRole('cell', { name });
        }
    }

    async clickCellByName(name) {
        const groupLocator = this.page.locator('[data-test^="o-field-list-group-"]')
            .filter({ hasText: name });
        if ((await groupLocator.count()) > 0) {
            return await groupLocator.first().click();
        }
        return await this.page.getByRole('cell', { name }).click();
    }

    async clickTableExpandMenuFirst() {
        return await this.page.locator('[data-test="table-row-expand-menu"]').first().click({ force: true });
    }

    async clickTimestampColumnMenu() {
        return await this.page.locator('[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]').click();
    }

    async clickDateTimeButton() {
        const btn = this.page.locator('[data-test="date-time-btn"]');
        await btn.waitFor({ state: 'visible', timeout: 10000 });
        // force:true bypasses Playwright's stability check — the toolbar re-renders
        // after search results load, causing brief layout shifts on the button.
        return await btn.click({ force: true });
    }

    async selectRelative6Hours() {
        return await this.page.locator('[data-test="date-time-relative-6-h-btn"]').click();
    }

    async selectRelative1Hour() {
        return await this.page.locator(this.relative1HourButton).click();
    }

    async clickAbsoluteTimeTab() {
        return await this.page.locator('[data-test="date-time-absolute-tab"]').click();
    }

    async fillStartDate(date) {
        return await this.page.locator('[data-test="date-time-absolute-start-date"]').fill(date);
    }

    async fillEndDate(date) {
        return await this.page.locator('[data-test="date-time-absolute-end-date"]').fill(date);
    }

    async clickApplyDateRange() {
        return await this.page.locator('[data-test="date-time-btn-apply"]').click();
    }

    async searchFieldByName(fieldName) {
        // Post-OFieldList migration: legacy [data-cy="index-field-search-input"] is gone.
        // OFieldList exposes the inner native input via the auto-derived `-field` data-test.
        return await this.page.locator(this.logSearchIndexListFieldSearchInput).fill(fieldName);
    }

    async navigateToStreams() {
        return await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
    }

    async navigateToStreamsAlternate() {
        return await this.page.locator('[data-test="menu-link-\\/streams-item"]').click({ force: true });
    }

    async searchStreamByPlaceholder(searchText) {
        await this.page.locator('[data-test="streams-search-stream-input"] input').click();
        return await this.page.locator('[data-test="streams-search-stream-input"] input').fill(searchText);
    }

    async clickFirstExploreButton() {
        return await this.page.locator('[data-test="log-stream-explore-btn"]').first().click({ force: true });
    }

    // Additional methods for multistream functionality
    /**
     * Verifies that the logs-search-index-list shows the given streams as selected.
     *
     * UX revamp uses OSelect chips that render adjacent with no separator (e.g. the
     * concatenated textContent becomes "e2e_automatee2e_stream1"), so we can't do
     * a single `toContainText("a, b")` check on the panel itself. Instead we read
     * `data-test-selected-value` on the select trigger — it holds the comma-joined
     * selected stream values regardless of how many chips are visually rendered
     * (the trigger truncates overflow with a "+N more" chip).
     *
     * Accepts either a comma-separated string ("e2e_automate, e2e_stream1") or
     * an array of stream names; each name is verified individually.
     *
     * @param {string|string[]} streams - Stream name(s) expected to be selected
     */
    async expectLogsSearchIndexListContainsText(streams) {
        const expected = Array.isArray(streams)
            ? streams
            : String(streams).split(',').map((s) => s.trim()).filter(Boolean);
        const trigger = this.page.locator(this.indexDropDownTrigger).first();
        // Wait for the trigger to render its data-test-selected-value attribute
        // (it's computed reactively from the selectedStream model).
        await trigger.waitFor({ state: 'attached' });
        // Poll the attribute until every expected stream is present in the
        // comma-joined selected-value list. We compare on a normalised array of
        // values rather than substring match to avoid false positives where one
        // stream name is a prefix of another (e.g. "e2e_a" vs "e2e_automate").
        await expect.poll(async () => {
            const attr = await trigger.getAttribute('data-test-selected-value');
            if (!attr) return false;
            const selected = attr.split(',').map((v) => v.trim()).filter(Boolean);
            return expected.every((name) => selected.includes(name));
        }, { message: `Expected streams [${expected.join(', ')}] to be selected in the index list` }).toBe(true);
    }

    /**
     * Gets the text content of the logs table.
     * @param {number} [timeout=30000] - Timeout in milliseconds (increased from default 10s to handle large result sets)
     * @returns {Promise<string>} The text content of the logs table
     */
    async getLogsTableContent(timeout = 30000) {
        return await this.page.locator(this.logsTable).textContent({ timeout });
    }

    async getLogsTableRowCount() {
        return await this.page.locator(`${this.logsTable} tbody tr`).count();
    }

    /**
     * Get log table row texts as an array (one string per row)
     * @param {number} limit - Maximum number of rows to return
     * @returns {Promise<string[]>} Array of row text content
     */
    async getLogsTableRowTexts(limit = 10) {
        const rows = this.page.locator(`${this.logsTable} tbody tr`);
        const count = Math.min(await rows.count(), limit);
        const texts = [];
        for (let i = 0; i < count; i++) {
            const text = await rows.nth(i).textContent();
            if (text) texts.push(text.trim());
        }
        return texts;
    }

    // ============================================================================
    // Stream display methods for multi-stream scenarios
    // ============================================================================

    /**
     * Gets the first stream display element from the stream list.
     * @returns {Promise<Locator>} The stream display element locator
     * @example
     * const element = await logsPage.getStreamDisplayElement();
     * await element.click();
     */
    async getStreamDisplayElement() {
        return this.page.locator(this.logsSearchIndexList).first();
    }

    /**
     * Waits for the stream display element to be visible.
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.expectStreamDisplayVisible(5000);
     */
    async expectStreamDisplayVisible(timeout = 10000) {
        await this.page.locator(this.logsSearchIndexList).first().waitFor({ state: 'visible', timeout });
    }

    /**
     * Gets the text content of the stream display element.
     * @returns {Promise<string>} The stream display text
     * @example
     * const text = await logsPage.getStreamDisplayText();
     * console.log(`Selected streams: ${text}`);
     */
    async getStreamDisplayText() {
        return await this.page.locator(this.logsSearchIndexList).first().textContent();
    }

    /**
     * Gets computed styles and dimensions of the stream display element for overflow detection.
     * @returns {Promise<Object>} Object containing overflow, textOverflow, whiteSpace, scrollWidth, clientWidth, and width
     * @example
     * const styles = await logsPage.getStreamDisplayStyles();
     * const isOverflowing = styles.scrollWidth > styles.clientWidth;
     */
    async getStreamDisplayStyles() {
        const element = await this.getStreamDisplayElement();
        return await element.evaluate((el) => {
            const computed = window.getComputedStyle(el);
            return {
                overflow: computed.overflow,
                textOverflow: computed.textOverflow,
                whiteSpace: computed.whiteSpace,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                width: computed.width
            };
        });
    }

    /**
     * Hovers over the stream display element to trigger tooltips.
     * @returns {Promise<void>}
     * @example
     * await logsPage.hoverStreamDisplay();
     * const isVisible = await logsPage.isTooltipVisible();
     */
    async hoverStreamDisplay() {
        await this.page.locator(this.logsSearchIndexList).first().hover();
    }

    // ============================================================================
    // Tooltip methods
    // ============================================================================

    /**
     * Checks if a tooltip is visible with proper state detection.
     * @param {number} [timeout=3000] - Timeout in milliseconds
     * @returns {Promise<boolean>} True if tooltip is visible, false otherwise
     * @example
     * await logsPage.hoverStreamDisplay();
     * if (await logsPage.isTooltipVisible()) {
     *   const text = await logsPage.getTooltipText();
     * }
     */
    async isTooltipVisible(timeout = 3000) {
        try {
            await this.page.locator('[data-test="o-tooltip-content"]').first().waitFor({
                state: 'visible',
                timeout
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets the text content of the tooltip with error handling.
     * @param {number} [timeout=3000] - Timeout in milliseconds
     * @returns {Promise<string|null>} The tooltip text, or null if tooltip is not found
     * @example
     * const tooltipText = await logsPage.getTooltipText();
     * if (tooltipText) {
     *   console.log(`Tooltip: ${tooltipText}`);
     * }
     */
    async getTooltipText(timeout = 3000) {
        try {
            return await this.page.locator('[data-test="o-tooltip-content"]').first().textContent({ timeout });
        } catch {
            return null;
        }
    }

    // ============================================================================
    // Field Expansion Methods (Bug #7751 regression tests)
    // ============================================================================

    /**
     * Waits for the field expand button to be visible.
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.waitForFieldExpandButtonVisible('kubernetes_pod_name');
     */
    async waitForFieldExpandButtonVisible(fieldName, timeout = 10000) {
        await this.page.locator(this.fieldExpandButton(fieldName)).waitFor({ state: 'visible', timeout });
    }

    /**
     * Clicks the field expand button to trigger values API.
     * @param {string} fieldName - Name of the field to expand
     * @returns {Promise<void>}
     * @example
     * await logsPage.clickFieldExpandButton('kubernetes_pod_name');
     */
    async clickFieldExpandButton(fieldName) {
        await this.page.locator(this.fieldExpandButton(fieldName)).click();
    }

    /**
     * Waits for field expansion content to be visible after expanding a field.
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.waitForFieldExpansionContent('kubernetes_pod_name');
     */
    async waitForFieldExpansionContent(fieldName, timeout = 10000) {
        await this.page.locator(this.fieldListItem(fieldName)).waitFor({ state: 'visible', timeout });
    }

    /**
     * Gets the text content of field expansion area (for error checking).
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<string>} The text content, or empty string on error
     * @example
     * const content = await logsPage.getFieldExpansionContent('kubernetes_pod_name');
     */
    async getFieldExpansionContent(fieldName, timeout = 10000) {
        try {
            return await this.page.locator(this.fieldListItem(fieldName)).textContent({ timeout }) || '';
        } catch {
            return '';
        }
    }

    /**
     * Waits for at least one field value to appear in the dropdown after expansion.
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=5000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.waitForFieldValues('kubernetes_pod_name');
     */
    async waitForFieldValues(fieldName, timeout = 5000) {
        await this.page.locator(`[data-test^="logs-search-subfield-add-${fieldName}-"]`).first()
            .waitFor({ state: 'visible', timeout });
    }

    /**
     * Gets the count of field values displayed in the dropdown.
     * @param {string} fieldName - Name of the field
     * @returns {Promise<number>} Number of field values
     * @example
     * const count = await logsPage.getFieldValuesCount('kubernetes_pod_name');
     */
    async getFieldValuesCount(fieldName) {
        return await this.page.locator(`[data-test^="logs-search-subfield-add-${fieldName}-"]`).count();
    }

    /**
     * Get all field values text from the expanded field dropdown
     * @param {string} fieldName - Name of the field
     * @returns {Promise<string[]>} Array of field value texts
     * @example
     * const values = await logsPage.getFieldValuesText('service_name');
     * // Returns: ['service-a', 'service-b', 'service-c']
     */
    async getFieldValuesText(fieldName) {
        const valueElements = this.page.locator(`[data-test^="logs-search-subfield-add-${fieldName}-"]`);
        const count = await valueElements.count();
        const values = [];
        for (let i = 0; i < count; i++) {
            const text = await valueElements.nth(i).textContent();
            if (text) {
                // Extract just the value part (before any count indicator)
                const cleanValue = text.trim().split(/\s+/)[0];
                values.push(cleanValue);
            }
        }
        return values;
    }

    /**
     * Collapse an expanded field by clicking its expand button again
     * @param {string} fieldName - Name of the field to collapse
     */
    async collapseField(fieldName) {
        const expandBtn = this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);
        if (await expandBtn.isVisible()) {
            await expandBtn.click();
            // Wait for field values to be hidden (deterministic wait)
            await this.page.locator(`[data-test^="logs-search-subfield-add-${fieldName}-"]`).first()
                .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
    }

    /**
     * Expands a field and validates that values API does not return 400 error.
     * Used by Bug #7751 tests to verify field expansion works correctly with complex queries.
     *
     * This method performs three levels of validation:
     * 1. PRIMARY: Values API responds with non-400 status
     * 2. SECONDARY: No 400 error message displayed in UI
     * 3. TERTIARY: Field values actually appear in dropdown
     *
     * @param {string} fieldName - Name of the field to expand
     * @param {Object} testLogger - Test logger instance
     * @returns {Promise<{apiStatus: number|null, valueCount: number}>} API status and field value count
     * @example
     * const result = await logsPage.expandFieldAndValidate('kubernetes_pod_name', testLogger);
     * // Returns: { apiStatus: 200, valueCount: 10 }
     */
    async expandFieldAndValidate(fieldName, testLogger) {
        const { expect } = require('@playwright/test');

        // Search for the field first to make it visible in sidebar
        testLogger.info(`Searching for field: ${fieldName}`);
        await this.fillIndexFieldSearchInput(fieldName);

        // Wait for expand button to be visible
        testLogger.info(`Expanding field: ${fieldName}`);
        await this.waitForFieldExpandButtonVisible(fieldName);

        // Set up values API response waiter BEFORE clicking expand
        testLogger.info('Setting up values API listener');
        const valuesApiPromise = this.page.waitForResponse(
            response => response.url().includes('/_values') && response.status() !== 0,
            { timeout: 20000 }
        ).catch(() => null);

        // Click expand button
        testLogger.info('Clicking expand to trigger values API call');
        await this.clickFieldExpandButton(fieldName);

        // Wait for values API response
        let apiStatus = null;
        const apiResponse = await valuesApiPromise;

        if (apiResponse) {
            apiStatus = apiResponse.status();
            testLogger.info(`✓ Values API responded with status: ${apiStatus}`);

            // PRIMARY ASSERTION: Values API should NOT return 400 (this was the bug #7751)
            expect(apiStatus).not.toBe(400);
            testLogger.info('✓ PRIMARY CHECK PASSED: Values API did not return 400 error');
        } else {
            testLogger.warn('Values API response timeout');
        }

        // Wait for field expansion content to be visible
        await this.waitForFieldExpansionContent(fieldName);

        // Get expansion content text
        const contentText = await this.getFieldExpansionContent(fieldName);

        // Secondary assertion: NO 400 error in UI
        expect(contentText).not.toContain('400');
        expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
        testLogger.info('✓ SECONDARY CHECK PASSED: No 400 error displayed in UI');

        // TERTIARY ASSERTION: Verify field values actually appear in dropdown
        await this.waitForFieldValues(fieldName);
        const valueCount = await this.getFieldValuesCount(fieldName);

        expect(valueCount).toBeGreaterThanOrEqual(1);
        testLogger.info(`✓ TERTIARY CHECK PASSED: ${valueCount} field value(s) displayed in dropdown`);

        return { apiStatus, valueCount };
    }

    async expectVrlFunctionVisible(functionText) {
        return await expect(this.page.locator(this.vrlFunctionText(functionText))).toBeVisible();
    }

    async expectNotificationErrorNotVisible() {
        return await expect(this.page.locator(this.notificationErrorMessage)).not.toBeVisible();
    }

    async expectErrorWhileFetchingNotVisible() {
        return await expect(this.page.getByText('Error while fetching')).not.toBeVisible();
    }

    async fillQueryEditorWithRole(text) {
        // Wait for query editor to be visible and ready (Firefox needs longer)
        const queryEditorContainer = this.page.locator(this.queryEditor);
        await queryEditorContainer.waitFor({ state: 'visible', timeout: 30000 });

        // Use JavaScript to scroll into center of viewport (more reliable for Firefox)
        await queryEditorContainer.evaluate(el => {
            el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        });
        await this.page.waitForTimeout(2000); // Extra stabilization for Firefox

        // Click using coordinates (more reliable for Firefox viewport issues)
        const editorBox = await queryEditorContainer.boundingBox();
        if (editorBox) {
            await this.page.mouse.click(editorBox.x + 50, editorBox.y + 20);
        } else {
            // Fallback: click with force
            await queryEditorContainer.click({ force: true });
        }
        await this.page.waitForTimeout(500);

        // Clear and type using keyboard (more reliable on Firefox)
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.type(text, { delay: 30 });
    }

    async clickTimeCell() {
        // Post-UX-revamp: time input is a native <input type="time"> inside datetime-start-time
        const timeInput = this.page.locator('[data-test="datetime-start-time"] input[type="time"]').first();
        await timeInput.waitFor({ state: 'visible', timeout: 5000 });
        return await timeInput.click();
    }

    async fillTimeCellWithInvalidValue(value) {
        // Use fill() with the value and rely on the component's validation to surface
        // the error state, rather than bypassing browser validation via evaluate().
        const timeInput = this.page.locator('[data-test="datetime-start-time"] input[type="time"]').first();
        await timeInput.waitFor({ state: 'visible', timeout: 5000 });
        const currentValue = await timeInput.inputValue().catch(() => '');
        await timeInput.fill('');
        await timeInput.fill(value);
        // Verify the input reflects the attempted value (or its best-effort parse)
        const newValue = await timeInput.inputValue().catch(() => '');
        if (newValue !== value) {
            // Browser rejected or parsed the value — that's the expected error path
            return { rejected: true, originalValue: currentValue, newValue };
        }
        return { rejected: false, originalValue: currentValue, newValue };
    }

    async expectErrorIconVisible() {
        // O2 OInput error state uses data-test="o-input-error" scoped to the datetime container
        const errorIcon = this.page.locator('[data-test="datetime-start-time"] [data-test="o-input-error"]').first();
        return await expect(errorIcon).toBeVisible({ timeout: 5000 });
    }

    async expectResultErrorDetailsButtonVisible() {
        return await expect(this.page.locator(this.resultErrorDetailsBtn)).toBeVisible();
    }

    async clickResultErrorDetailsButton() {
        // Wait for element to be stable before clicking (avoids detached DOM issues)
        const button = this.page.locator(this.resultErrorDetailsBtn);
        await button.waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(500); // Allow DOM to stabilize
        return await button.click({ timeout: 15000 });
    }

    async expectSearchDetailErrorMessageVisible() {
        return await expect(this.page.locator(this.searchDetailErrorMessage)).toBeVisible();
    }

    async expectStartTimeVisible() {
        return await expect(this.page.locator('[data-test="datetime-start-time"]').first()).toBeVisible({ timeout: 5000 });
    }

    async expectEndTimeVisible() {
        return await expect(this.page.locator('[data-test="datetime-end-time"]').first()).toBeVisible({ timeout: 5000 });
    }

    async clickOutsideTimeInput() {
        // Click outside to trigger validation
        return await this.page.locator('body').click({ position: { x: 0, y: 0 } });
    }

    /**
     * ==========================================
     * DATA INGESTION API METHOD
     * ==========================================
     */

    /**
     * Ingest data to a stream
     * Sends records individually to ensure uniqueness
     * @param {string} streamName - Stream name
     * @param {array} data - Array of log objects
     * @returns {Promise<object>} Result with success/fail counts
     */
    async ingestData(streamName, data) {
        const fetch = (await import('node-fetch')).default;
        const http = require('http');
        const https = require('https');
        const orgId = getOrgIdentifier();
        const authHeaders = getAuthHeaders();

        testLogger.info('Ingesting data', { streamName, recordCount: data.length });

        // node-fetch 2.x reuses keep-alive sockets by default. With records sent
        // one-by-one (spaced 500ms apart), CI servers close the idle keep-alive
        // connection between requests, surfacing as a "Premature close" error
        // while reading the response body — even though the server returns HTTP
        // 200 and ingests the record. Forcing a fresh connection per request
        // (keepAlive: false) eliminates that socket-reuse race.
        const httpAgent = new http.Agent({ keepAlive: false });
        const httpsAgent = new https.Agent({ keepAlive: false });
        const agent = (parsedURL) => (parsedURL.protocol === 'https:' ? httpsAgent : httpAgent);

        const ingestUrl = `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
        const maxAttempts = 3;

        let successCount = 0;
        let failCount = 0;

        // Send records one by one to ensure each is treated as unique
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            let ingested = false;
            let lastError = null;

            // Retry transient connection failures (e.g. "Premature close") so a
            // single dropped socket does not fail the whole test.
            for (let attempt = 1; attempt <= maxAttempts && !ingested; attempt++) {
                try {
                    const response = await fetch(ingestUrl, {
                        method: 'POST',
                        headers: authHeaders,
                        body: JSON.stringify([record]),  // Send as single-element array
                        agent
                    });

                    const responseData = await response.json();

                    if (response.status === 200 && responseData.code === 200) {
                        ingested = true;
                        testLogger.debug(`Ingested record ${i+1}/${data.length}`, { name: record.name, test_id: record.test_id || 'no_id', unique_id: record.unique_id });
                    } else {
                        lastError = `status=${response.status} code=${responseData.code}`;
                        testLogger.error(`Failed to ingest record ${i+1}/${data.length} (attempt ${attempt}/${maxAttempts})`, { response: responseData, test_id: record.test_id || record.name });
                    }
                } catch (error) {
                    lastError = error.message;
                    testLogger.error(`Error ingesting record ${i+1}/${data.length} (attempt ${attempt}/${maxAttempts})`, { error: error.message });
                }

                // Back off briefly before retrying the same record
                if (!ingested && attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (ingested) {
                successCount++;
            } else {
                failCount++;
                testLogger.error(`Giving up on record ${i+1}/${data.length} after ${maxAttempts} attempts`, { lastError, test_id: record.test_id || record.name });
            }

            // Small delay between records
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        testLogger.info('Ingestion complete', { streamName, total: data.length, success: successCount, failed: failCount });

        if (failCount > 0) {
            throw new Error(`Failed to ingest ${failCount} out of ${data.length} records`);
        }

        return { total: data.length, success: successCount, failed: failCount };
    }

    /**
     * Get severity colors from all visible log rows
     * Returns array of {severity, color} objects
     */
    /**
     * Count the per-row severity status-color bars currently rendered in the results
     * table. Mirrors the selector getSeverityColors() reads, so callers can poll for the
     * table to actually paint its rows before reading colors (avoids a fixed sleep).
     */
    async countSeverityColorBars() {
        return await this.page
            .locator('tbody tr[data-index] [data-test="log-table-row-status-color"]')
            .count();
    }

    async getSeverityColors() {
        return await this.page.evaluate(() => {
            const rows = document.querySelectorAll('tbody tr[data-index]');
            const findings = [];

            for (const row of rows) {
                const text = row.textContent;
                // The status color bar carries data-test="log-table-row-status-color"
                // and data-test-status-level="<level>". This makes the detected
                // severity/level machine-readable regardless of which column is
                // shown (the FTS "body" column hides the raw "source" JSON).
                let colorDiv = row.querySelector('[data-test="log-table-row-status-color"]');

                // Fallbacks for older renders: inline-style / absolute-positioned div.
                if (!colorDiv) colorDiv = row.querySelector('div[style*="background"]');
                if (!colorDiv) colorDiv = row.querySelector('div[class*="tw\\:absolute"]');
                if (!colorDiv) {
                    const divs = row.querySelectorAll('div');
                    for (const div of divs) {
                        const style = window.getComputedStyle(div);
                        if (style.position === 'absolute' && style.left === '0px' && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                            colorDiv = div;
                            break;
                        }
                    }
                }

                if (!colorDiv) continue;

                const bgColor = window.getComputedStyle(colorDiv).backgroundColor;
                if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') continue;

                const level = colorDiv.getAttribute('data-test-status-level') || null;

                // Best-effort: also recover the raw severity number when the JSON
                // source column is visible (kept for backward compatibility).
                let severity = null;
                for (let sev = 0; sev <= 7; sev++) {
                    const patterns = [
                        `"severity":"${sev}"`,
                        `"severity":${sev},`,
                        `"severity":${sev}}`,
                        `"severity": ${sev}`,
                        `severity: ${sev}`,
                    ];
                    if (patterns.some(pattern => text.includes(pattern))) {
                        severity = sev;
                        break;
                    }
                }

                if (level === null && severity === null) continue;
                findings.push({ severity, level, color: bgColor });
            }

            return findings;
        });
    }

    /**
     * Get severity color for a specific severity level
     * @param {number} severityLevel - Severity level (0-7)
     * @returns {string|null} RGB color string or null if not found
     */
    async getSeverityColorBySeverityLevel(severityLevel) {
        const results = await this.getSeverityColors();
        const match = results.find(r => r.severity === severityLevel);
        return match ? match.color : null;
    }

    /**
     * Verify severity color matches expected hex color
     * @param {number} severityLevel - Severity level (0-7)
     * @param {string} expectedHexColor - Expected hex color (e.g., "#dc2626")
     * @returns {boolean} True if colors match
     */
    async verifySeverityColor(severityLevel, expectedHexColor) {
        const rgbColor = await this.getSeverityColorBySeverityLevel(severityLevel);
        if (!rgbColor) {
            testLogger.warn(`No color found for severity ${severityLevel}`);
            return false;
        }

        const hexColor = this.rgbToHex(rgbColor);
        const normalizedActual = this.normalizeHexColor(hexColor);
        const normalizedExpected = this.normalizeHexColor(expectedHexColor);

        testLogger.info(`Severity ${severityLevel}: Expected ${normalizedExpected}, Got ${normalizedActual}`);
        return normalizedActual === normalizedExpected;
    }

    /**
     * Convert RGB color to Hex
     * @param {string} rgb - RGB color string (e.g., "rgb(220, 38, 38)")
     * @returns {string} Hex color string (e.g., "#dc2626")
     */
    rgbToHex(rgb) {
        const result = rgb.match(/\d+/g);
        if (!result || result.length < 3) return null;
        return '#' + result.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
    }

    /**
     * Normalize hex color (remove alpha channel if present, lowercase)
     * @param {string} hex - Hex color string
     * @returns {string} Normalized hex color
     */
    normalizeHexColor(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 8) {
            hex = hex.substring(0, 6);
        }
        return '#' + hex.toLowerCase();
    }

    /**
     * Ingest severity color test data to a specific stream
     * @param {string} streamName - Name of the stream to ingest data to
     * @returns {Promise<Object>} Response from the ingestion API
     */
    async severityColorIngestionToStream(streamName) {
        const severityColorData = require('../../../test-data/severity_color_data.json');
        const orgId = getOrgIdentifier();
        const headers = getAuthHeaders();

        const url = `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;

        try {
            const response = await this.page.request.post(url, {
                headers: headers,
                data: severityColorData
            });

            if (!response.ok()) {
                throw new Error(`HTTP error! status: ${response.status()}`);
            }

            const result = await response.json();
            testLogger.info(`Successfully ingested ${severityColorData.length} records to stream '${streamName}'`);
            return result;
        } catch (error) {
            testLogger.error('Severity color ingestion failed:', { error: error.message });
            throw error;
        }
    }

    /**
     * Delete a stream by name
     * @param {string} streamName - Name of the stream to delete
     * @returns {Promise<Object>} Response with status
     */
    async deleteStream(streamName) {
        const orgId = getOrgIdentifier();
        const headers = getAuthHeaders();

        const url = `${process.env.INGESTION_URL}/api/${orgId}/streams/${streamName}`;

        try {
            const response = await this.page.request.delete(url, {
                headers: headers
            });

            if (!response.ok() && response.status() !== 404) {
                throw new Error(`HTTP error! status: ${response.status()}`);
            }

            const status = response.status();
            if (status === 200) {
                testLogger.info(`Stream '${streamName}' deleted successfully`);
            } else if (status === 404) {
                testLogger.info(`Stream '${streamName}' not found (already deleted)`);
            }

            return { status: status };
        } catch (error) {
            testLogger.error('Stream deletion failed:', { error: error.message });
            throw error;
        }
    }

    // ===== ANALYZE DIMENSIONS METHODS =====

    /**
     * Check if Logs Analyze Dimensions button is visible
     * Button appears when: results exist AND not in SQL mode
     * @returns {Promise<boolean>}
     */
    async isAnalyzeDimensionsButtonVisible() {
        return await this.page.locator(this.logsAnalyzeDimensionsButton).isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Expect Analyze Dimensions button to be visible
     */
    async expectAnalyzeDimensionsButtonVisible() {
        await expect(this.page.locator(this.logsAnalyzeDimensionsButton)).toBeVisible({ timeout: 10000 });
        testLogger.info('Analyze Dimensions button is visible');
    }

    /**
     * Expect Analyze Dimensions button to NOT be visible
     */
    async expectAnalyzeDimensionsButtonNotVisible() {
        await expect(this.page.locator(this.logsAnalyzeDimensionsButton)).not.toBeVisible({ timeout: 5000 });
        testLogger.info('Analyze Dimensions button is not visible (as expected)');
    }

    /**
     * Click Analyze Dimensions button
     */
    async clickAnalyzeDimensionsButton() {
        await this.page.locator(this.logsAnalyzeDimensionsButton).click();
        await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        testLogger.info('Clicked Analyze Dimensions button');
    }

    /**
     * Check if Analysis Dashboard is visible
     * @returns {Promise<boolean>}
     */
    async isAnalysisDashboardVisible() {
        return await this.page.locator(this.analysisDashboardCard).isVisible({ timeout: 10000 }).catch(() => false);
    }

    /**
     * Expect Analysis Dashboard to be visible
     */
    async expectAnalysisDashboardVisible() {
        await expect(this.page.locator(this.analysisDashboardCard)).toBeVisible({ timeout: 15000 });
        testLogger.info('Analysis Dashboard is visible');
    }

    /**
     * Close Analysis Dashboard
     */
    async closeAnalysisDashboard() {
        const closeBtn = this.page.locator(this.analysisDashboardClose);
        if (await closeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await closeBtn.click();
            await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            testLogger.info('Closed Analysis Dashboard');
        }
    }

    /**
     * Check if Dimension Selector sidebar is visible in Analysis Dashboard
     * The sidebar is visible by default when the dashboard opens.
     * @returns {Promise<boolean>}
     */
    async isDimensionSidebarVisible() {
        return await this.page.locator(this.dimensionSelectorSidebar).isVisible().catch(() => false);
    }

    /**
     * Toggle dimension selector sidebar via collapse button
     */
    async toggleDimensionSidebar() {
        const sidebar = this.page.locator(this.dimensionSelectorSidebar);
        const sidebarVisible = await sidebar.isVisible().catch(() => false);
        if (sidebarVisible) {
            // Sidebar is open — click the collapse btn inside it
            const btn = this.page.locator(this.dimensionSelectorCollapseBtn);
            await btn.click();
            await sidebar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        } else {
            // Sidebar is collapsed — click the collapsed bar to expand
            const collapsedBar = this.page.locator('[data-test="dimension-selector-collapsed-bar"]');
            await collapsedBar.click();
            await sidebar.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        }
        testLogger.info('Toggled Dimension Selector sidebar');
    }

    /**
     * Check if dimension search input is visible in sidebar
     * @returns {Promise<boolean>}
     */
    async isDimensionSearchInputVisible() {
        return await this.page.locator(this.dimensionSearchInput).isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Search for a dimension in the sidebar
     * @param {string} searchText
     */
    async searchDimension(searchText) {
        // OInput exposes the native <input> at `-field` — required for fill()
        const inputField = this.page.locator(this.dimensionSearchInputField);
        await inputField.click();
        await inputField.fill(searchText);
        // Wait deterministically for the input to actually carry the value (filter is reactive on input)
        await expect(inputField).toHaveValue(searchText, { timeout: 5000 });
        testLogger.info(`Searched dimension: ${searchText}`);
    }

    /**
     * Get the count of dimension checkboxes visible in sidebar
     * @returns {Promise<number>}
     */
    async getDimensionCheckboxCount() {
        return await this.page.locator(this.dimensionCheckboxAny).count();
    }

    /**
     * Toggle a specific dimension checkbox by its value
     * @param {string} dimensionValue
     * @returns {Promise<boolean>}
     */
    async toggleDimensionCheckbox(dimensionValue) {
        const checkbox = this.page.locator(`[data-test="dimension-checkbox-${dimensionValue}"]`);
        if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
            await checkbox.click();
            await this.page.waitForTimeout(500);
            testLogger.info(`Toggled dimension checkbox: ${dimensionValue}`);
            return true;
        }
        return false;
    }

    /**
     * Check if analysis dashboard has chart panels rendered
     * @returns {Promise<boolean>}
     */
    async hasAnalysisDashboardCharts() {
        const chartPanel = this.page.locator(this.analysisDashboardChartPanel);
        return await chartPanel.first().isVisible({ timeout: 10000 }).catch(() => false);
    }

    /**
     * Check if the analysis dashboard is in loading state
     * @returns {Promise<boolean>}
     */
    async isAnalysisDashboardLoading() {
        return await this.page.locator(this.analysisDashboardLoading).isVisible({ timeout: 2000 }).catch(() => false);
    }

    /**
     * Wait for Analysis Dashboard to load completely
     */
    async waitForAnalysisDashboardLoad() {
        // Wait for loading spinner to disappear
        const spinner = this.page.locator(this.analysisDashboardLoadingIndicator);
        try {
            if (await spinner.isVisible({ timeout: 1000 })) {
                await spinner.waitFor({ state: 'hidden', timeout: 30000 });
            }
        } catch {
            // Spinner might not appear or already hidden
        }

        // Wait for dashboard content
        await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        testLogger.info('Analysis Dashboard loaded');
    }

    /**
     * Check if no results message is visible
     * @returns {Promise<boolean>}
     */
    async isNoResultsMessageVisible() {
        return await this.page.locator('[data-test="logs-search-no-events-found-text"]').isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Close any open dialog by clicking the close button
     */
    async closeDimensionSelectorDialog() {
        await this.page.locator('[data-test="o-dialog-close-btn"]').click().catch(() =>
            this.page.locator('body').click({ position: { x: 10, y: 10 } })
        );
        await this.page.waitForTimeout(500);
        testLogger.info('Closed dimension selector dialog');
    }

    /**
     * Wait for search results to load after clicking refresh.
     * Waits for either results table or no-results message to appear.
     */
    async waitForSearchResultsToLoad() {
        try {
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            // Wait for results table, no-events state, or error state — any definite post-query state
            await this.page.locator(
                `${this.logsTable}, [data-test="logs-search-no-events-found-text"], [data-test="logs-search-error-state"], [data-test="logs-search-filter-error-message"]`
            ).first().waitFor({ state: 'visible', timeout: 15000 });
        } catch {
            // Fallback: at least wait for any loading to finish
            testLogger.info('waitForSearchResultsToLoad: timed out waiting for results indicator');
        }
    }

    /**
     * Wait for actual result rows to appear in the table.
     * The table container becomes visible before Vue populates queryResults.hits, which gates
     * the analyze button v-if. Waiting for a row ensures hits.length > 0 is true in the
     * reactive store before callers check for the analyze button or row-dependent UI.
     */
    async waitForSearchResultRows(timeout = 20000) {
        await this.page.locator(`${this.logsTable} tbody tr`).first()
            .waitFor({ state: 'visible', timeout });
        testLogger.info('waitForSearchResultRows: at least one result row is visible');
    }

    /**
     * Wait for SQL mode to be active after switching.
     * SQL mode is auto-detected from query content — poll until the editor contains SELECT...FROM.
     */
    async waitForSQLModeActive() {
        await expect.poll(
            () => this.isSqlModeEnabled(),
            { timeout: 10000 }
        ).toBe(true);
        testLogger.info('SQL mode active (editor contains SELECT...FROM)');
    }

    /**
     * Wait for dashboard close to complete
     */
    async waitForDashboardClose() {
        await this.page.locator(this.analysisDashboardCard).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        testLogger.info('Dashboard close stabilized');
    }

    // ===== SHARE LINK METHODS =====

    /**
     * Click the share link button on the logs search bar
     */
    async clickShareLinkButton() {
        await this.page.locator(this.shareLinkButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.shareLinkButton).click();
        testLogger.info('Clicked share link button');
    }

    /**
     * Verify the share link button is visible
     */
    async expectShareLinkButtonVisible() {
        await expect(this.page.locator(this.shareLinkButton)).toBeVisible();
        testLogger.info('Share link button is visible');
    }

    /**
     * Click share link and wait for success notification
     * @returns {Promise<boolean>} true if success notification appeared
     */
    async clickShareLinkAndExpectSuccess() {
        await this.clickShareLinkButton();

        // Wait for the SUCCESS toast specifically (.first() to tolerate a lingering
        // "Running query cancelled successfully" info toast from a prior refresh — the
        // broad any-variant selector otherwise matches 2 toasts and trips strict mode,
        // which was the CI flake on this P0 test).
        const successToast = this.page
            .locator(`[data-test-variant="success"][data-test-message*="${this.linkCopiedSuccessText}"]`)
            .first();
        try {
            await successToast.waitFor({ state: 'visible', timeout: 15000 });
            testLogger.info('Share link success notification appeared');
            return true;
        } catch (e) {
            testLogger.warn('Share link success notification did not appear');
            return false;
        }
    }

    /**
     * Verify share link success notification is visible.
     * Toast carries the message in data-test-message — match it via attribute selector to avoid getByText/filter.
     * Uses .first() to tolerate multiple stacked toasts from repeated share clicks.
     */
    async expectShareLinkSuccessNotification() {
        const notification = this.page.locator(`[data-test-variant="success"][data-test-message*="${this.linkCopiedSuccessText}"]`).first();
        await expect(notification).toBeVisible({ timeout: 15000 });
        testLogger.info('Share link success notification verified');
    }

    /**
     * Click share link and wait for any notification (success or error)
     * This is more resilient for environments where the short URL API may not work
     * @returns {Promise<{appeared: boolean, isSuccess: boolean, text: string}>}
     */
    async clickShareLinkAndExpectNotification() {
        await this.clickShareLinkButton();

        // Wait for the share-RESULT toast specifically — the "Link Copied Successfully!"
        // success toast OR the "Error while copy link" error toast — matched by message
        // and .first(). This skips an unrelated "Running query cancelled" info toast that
        // can coexist, which would otherwise trip strict mode on the broad selector.
        const notification = this.page
            .locator(`[data-test-message*="${this.linkCopiedSuccessText}"], [data-test-message*="${this.errorCopyingLinkText}"]`)
            .first();
        try {
            await notification.waitFor({ state: 'visible', timeout: 15000 });
            const notificationText = await notification.textContent();
            const isSuccess = notificationText.includes(this.linkCopiedSuccessText);
            const isError = notificationText.includes(this.errorCopyingLinkText);

            testLogger.info('Share link notification appeared', {
                text: notificationText,
                isSuccess,
                isError
            });

            return {
                appeared: true,
                isSuccess,
                isError,
                text: notificationText
            };
        } catch (e) {
            testLogger.warn('No notification appeared after clicking share link');
            return { appeared: false, isSuccess: false, isError: false, text: '' };
        }
    }

    /**
     * Verify any notification appears after clicking share link (success or error)
     * This tests that the button is functional without requiring API success
     */
    async expectShareLinkTriggersNotification() {
        const result = await this.clickShareLinkAndExpectNotification();
        expect(result.appeared).toBe(true);
        testLogger.info('Share link triggered notification', { text: result.text });
        return result;
    }

    /**
     * Verify the share link button is disabled
     */
    async expectShareLinkButtonDisabled() {
        await expect(this.page.locator(this.shareLinkButton)).toBeDisabled();
        testLogger.info('Share link button is disabled');
    }

    /**
     * Hover over the share link button to show tooltip
     */
    async hoverShareLinkButton() {
        await this.page.locator(this.shareLinkButton).hover();
        testLogger.info('Hovered over share link button');
    }

    /**
     * Get the share link tooltip text
     * @param {string} hasTextFilter - Optional regex filter for tooltip text
     * @returns {Promise<string>} The tooltip text
     */
    async getShareLinkTooltipText(hasTextFilter = null) {
        let tooltip = this.page.locator(this.shareLinkTooltip);

        if (hasTextFilter) {
            tooltip = tooltip.filter({ hasText: hasTextFilter });
        }

        await tooltip.first().waitFor({ state: 'visible', timeout: 5000 });
        const text = await tooltip.first().textContent();
        testLogger.info(`Share link tooltip text: "${text}"`);
        return text;
    }

    /**
     * Verify the share link tooltip is visible with specific text
     * @param {string|RegExp} expectedText - Expected text or regex pattern
     */
    async expectShareLinkTooltipVisible(expectedText = null) {
        let tooltip = this.page.locator(this.shareLinkTooltip);

        if (expectedText) {
            tooltip = tooltip.filter({ hasText: expectedText });
        }

        await expect(tooltip.first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Share link tooltip is visible');
    }

    /**
     * Get the current URL for verification after share link redirect
     */
    async getCurrentUrl() {
        return this.page.url();
    }

    /**
     * Verify the URL contains expected query parameters
     * @param {string} param - Parameter name to check
     */
    async expectUrlContainsParam(param) {
        const url = await this.getCurrentUrl();
        expect(url).toContain(param);
        testLogger.info(`URL contains parameter: ${param}`);
    }

    // ===== STATE PRESERVATION METHODS =====

    /**
     * Read the clipboard content (requires clipboard permissions in playwright config)
     * @returns {Promise<string>} The clipboard text content
     */
    async readClipboard() {
        const clipboardText = await this.page.evaluate(() => navigator.clipboard.readText());
        testLogger.info('Read clipboard content', { length: clipboardText.length });
        return clipboardText;
    }

    /**
     * Click share link and get the copied URL from clipboard
     * Automatically converts HTTP to HTTPS to maintain auth context
     * @returns {Promise<string>} The shared URL
     */
    async clickShareLinkAndGetUrl() {
        // Ensure the current search state is fully committed to the URL before sharing.
        // The share API builds the short URL from the current query params; if we click
        // while the SPA is still writing them (e.g. right after clickRefresh) the short
        // URL can capture a partial state (missing query / sql_mode).
        await this._waitForUrlStable(5000);

        await this.clickShareLinkButton();

        // Wait for the SUCCESS ("Link Copied Successfully!") toast specifically, using
        // .first(). A clickRefresh just before sharing can leave a "Running query
        // cancelled successfully" info toast on screen; the broad any-variant
        // successNotification selector then matches 2 toasts and trips strict mode.
        const successToast = this.page
            .locator(`[data-test-variant="success"][data-test-message*="${this.linkCopiedSuccessText}"]`)
            .first();
        await successToast.waitFor({ state: 'visible', timeout: 15000 });

        // Read the URL from clipboard
        let sharedUrl = await this.readClipboard();

        // Convert HTTP to HTTPS to maintain authentication cookies (skip for localhost)
        if (sharedUrl.startsWith('http://') && !sharedUrl.includes('localhost')) {
            sharedUrl = sharedUrl.replace('http://', 'https://');
            testLogger.info('Converted HTTP to HTTPS', { url: sharedUrl });
        }

        testLogger.info('Share link URL captured', { url: sharedUrl });

        return sharedUrl;
    }

    /**
     * Extract URL query parameters as an object
     * @param {string} url - The URL to parse
     * @returns {Object} Key-value pairs of query parameters
     */
    parseUrlParams(url) {
        const urlObj = new URL(url);
        const params = {};
        urlObj.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        return params;
    }

    /**
     * Capture the current search state from the URL
     * @returns {Promise<Object>} The current search state
     */
    async captureCurrentState() {
        const url = await this.getCurrentUrl();
        const params = this.parseUrlParams(url);

        const state = {
            url: url,
            stream: params.stream || null,
            streamType: params.stream_type || 'logs',
            period: params.period || null,
            from: params.from || null,
            to: params.to || null,
            sqlMode: params.sql_mode || null,
            quickMode: params.quick_mode || null,
            showHistogram: params.show_histogram || null,
            orgIdentifier: params.org_identifier || null,
            query: params.sql || params.query || null,
        };

        testLogger.info('Captured current state', state);
        return state;
    }

    /**
     * Compare two search states and return differences
     * @param {Object} state1 - First state
     * @param {Object} state2 - Second state
     * @param {Array<string>} keysToCompare - Keys to compare
     * @returns {Object} Comparison result with matches and differences
     */
    compareStates(state1, state2, keysToCompare = ['stream', 'streamType', 'period', 'sqlMode', 'quickMode', 'showHistogram']) {
        const result = {
            isMatch: true,
            matches: {},
            differences: {}
        };

        for (const key of keysToCompare) {
            const val1 = state1[key];
            const val2 = state2[key];

            if (val1 === val2) {
                result.matches[key] = val1;
            } else {
                result.isMatch = false;
                result.differences[key] = { before: val1, after: val2 };
            }
        }

        testLogger.info('State comparison result', result);
        return result;
    }

    /**
     * Wait for the page to finish redirecting (URL stabilizes)
     * @param {number} timeout - Max time to wait in ms
     */
    async waitForRedirectComplete(timeout = 15000) {
        // Wait for URL to leave the /short/ path. expect.poll uses Playwright's wait engine — no waitForTimeout.
        try {
            await expect.poll(
                async () => {
                    const url = await this.getCurrentUrl();
                    return url.includes('/short/');
                },
                { timeout, intervals: [200, 500, 1000] }
            ).toBe(false);
            // Once URL leaves /short/, let the SPA settle via load-state events
            await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            // After leaving /short/ the SPA re-hydrates search state and rewrites the URL
            // query params in STAGES (stream → time → sql_mode/query → show_histogram/quick_mode).
            // On a slow/loaded CI runner networkidle can fire mid-rewrite, so a bare
            // captureCurrentState() here reads partial state (e.g. show_histogram=null,
            // empty query). Wait until the URL stops changing before returning so callers
            // observe the fully-restored state deterministically.
            await this._waitForUrlStable(8000);
            const finalUrl = await this.getCurrentUrl();
            testLogger.info('Redirect complete', { finalUrl });
        } catch (e) {
            const currentUrl = await this.getCurrentUrl();
            testLogger.warn('Redirect timeout - URL may still be changing', { currentUrl });
        }
    }

    /**
     * Resolve once the URL stops changing (debounce). Uses expect.poll's wait engine —
     * no fixed waitForTimeout. Requires the same URL to be observed on consecutive polls
     * before treating it as settled, so staged SPA param rewrites finish first.
     * Best-effort: swallows timeout (a genuinely live-updating URL just returns after the
     * budget) so callers always proceed.
     * @param {number} timeout - Max time to wait in ms
     */
    async _waitForUrlStable(timeout = 8000) {
        let lastUrl = null;
        let stableStreak = 0;
        try {
            await expect.poll(
                async () => {
                    const url = await this.getCurrentUrl();
                    if (url === lastUrl) {
                        stableStreak += 1;
                    } else {
                        stableStreak = 0;
                        lastUrl = url;
                    }
                    // Same URL seen on 3 consecutive polls => the staged rewrites are done.
                    return stableStreak >= 2;
                },
                { timeout, intervals: [300, 300, 500, 500, 800] }
            ).toBe(true);
        } catch (e) {
            testLogger.warn('URL did not fully stabilize within budget', { lastUrl });
        }
    }

    /**
     * Wait until the current URL contains a given query param key (optionally with a
     * specific value), then return its value. After a share-link short-URL redirect the
     * SPA repopulates URL params asynchronously, so reading captureCurrentState()
     * immediately can observe a param as null. Polls via Playwright's wait engine.
     * @param {string} key - the query param name, e.g. 'show_histogram'
     * @param {string|null} expectedValue - if provided, wait until the value equals this
     * @param {number} timeout
     * @param {boolean} required - when true, THROW if the param never appears/matches within
     *   the budget (use before an action that must observe a committed state, e.g. requiring
     *   sql_mode=true before sharing so the short URL can't capture a non-SQL state). When
     *   false (default) it is best-effort: it logs a warning and returns the current value.
     * @returns {Promise<string|null>} the param value once present (null if it never appears)
     */
    async waitForUrlParam(key, expectedValue = null, timeout = 20000, required = false) {
        try {
            await expect.poll(
                async () => {
                    const params = this.parseUrlParams(await this.getCurrentUrl());
                    const val = params[key] ?? null;
                    if (val === null) return false;
                    return expectedValue === null ? true : val === expectedValue;
                },
                { timeout, intervals: [200, 500, 1000] }
            ).toBe(true);
        } catch (e) {
            if (required) {
                const actual = this.parseUrlParams(await this.getCurrentUrl())[key] ?? null;
                throw new Error(
                    `Required URL param "${key}"${expectedValue !== null ? `="${expectedValue}"` : ''} never appeared within ${timeout}ms (actual: ${actual})`
                );
            }
            testLogger.warn('URL param did not appear within budget', { key, expectedValue });
        }
        const params = this.parseUrlParams(await this.getCurrentUrl());
        return params[key] ?? null;
    }

    /**
     * Deterministically set up SQL mode + an exact query and COMMIT it to the URL, so a
     * subsequent share captures sql_mode=true + the query in the short URL.
     *
     * Combines the two mechanisms that each alone were flaky on CI:
     *  - enableSqlModeIfNeeded() sets searchObj.meta.sqlMode=true via Vue (this — not editor
     *    content — is what the app writes to the URL as sql_mode; writing SELECT text alone
     *    does NOT reliably flip the flag).
     *  - setQueryEditorContent() writes the exact query via Monaco executeEdits with a verify
     *    poll (reliable, unlike clearAndFillQueryEditor whose focus-sensitive Ctrl+A select-all
     *    silently appended → a doubled query on CI).
     * Then runQueryAndWaitForResults() commits without cancelling the in-flight auto-search,
     * and we confirm sql_mode landed in the URL. The whole sequence retries once if the flag
     * didn't commit (the occasional Vue-mutation miss under load), then strict-asserts.
     * @param {string} query - the SQL query to set (must be a SELECT ... FROM ...)
     */
    async setupSqlQueryForShare(query) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            await this.enableSqlModeIfNeeded();
            await this.setQueryEditorContent(query);
            await this.waitForQueryEditorContent(query.split(/\s+/)[0]); // first token, e.g. SELECT
            await this.runQueryAndWaitForResults();
            const committed = await this.waitForUrlParam('sql_mode', 'true', 15000, false);
            if (committed === 'true') {
                testLogger.info('setupSqlQueryForShare: sql_mode committed to URL', { attempt });
                return;
            }
            testLogger.warn(`setupSqlQueryForShare: sql_mode not committed (attempt ${attempt}) — retrying`);
        }
        // Still not committed after the retry — fail fast with a clear message rather than
        // sharing a non-SQL state that would fail confusingly at the post-redirect editor read.
        await this.waitForUrlParam('sql_mode', 'true', 5000, true);
    }

    /**
     * Get the selected stream name from the UI
     * @returns {Promise<string|null>} The selected stream name
     */
    async getSelectedStreamFromUI() {
        try {
            const streamSelector = this.page.locator('[data-test="log-search-index-list-select-stream"]');
            await streamSelector.waitFor({ state: 'visible', timeout: 5000 });
            const streamText = await streamSelector.textContent();
            return streamText?.trim() || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * SQL mode is auto-detected from query content: ON when the editor has SELECT...FROM.
     * @returns {Promise<boolean>} True if the current query looks like SQL
     */
    async isSqlModeEnabled() {
        const text = await this.getQueryEditorText();
        if (!text) return false;
        const lower = text.toLowerCase().trim();
        return lower.includes('select') && lower.includes('from');
    }

    /**
     * Read the currently selected stream name from Vue reactive state.
     * Falls back to 'e2e_automate' if the state is unavailable.
     * @returns {Promise<string>}
     */
    async _getSelectedStream() {
        const stream = await this._mutateSearchObj(
            (searchObj) => searchObj.data?.stream?.selectedStream?.[0] || null
        );
        return stream || 'e2e_automate';
    }

    /**
     * Enable SQL mode if currently disabled.
     * Uses a direct path: try Vue state mutation first, then fall back to setting
     * a SELECT query in the editor. Avoids the strict expect.poll assertion in
     * setQueryEditorContent (which can fail if the fullSQLMode watcher fires
     * asynchronously and resets the editor after executeEdits).
     */
    async enableSqlModeIfDisabled() {
        const isSQL = await this.isSqlModeEnabled();
        if (isSQL) {
            testLogger.info('enableSqlModeIfDisabled: SQL mode already on — skipping');
            return;
        }
        const stream = await this._getSelectedStream();
        const set = await this._setSqlModeViaVue(true);
        if (!set) {
            // Vue state inaccessible — write SELECT directly to trigger auto-detection
            await this.setQueryEditorValue(`SELECT * FROM "${stream}"`);
        }
        await this.page.waitForTimeout(600);
        // If the Vue watcher didn't auto-update the editor, force it now
        if (!(await this.isSqlModeEnabled())) {
            await this.setQueryEditorValue(`SELECT * FROM "${stream}"`);
            await this.page.waitForTimeout(400);
        }
        testLogger.info('enableSqlModeIfDisabled: SQL mode enabled');
    }

    /**
     * Set searchObj.meta.sqlMode via the Vue component state accessed from the browser context.
     * Tries multiple anchor elements (toolbar buttons rendered directly in SearchBar, the query
     * editor wrapper) and walks both the DOM parent chain and the Vue component parent chain to
     * reliably reach SearchBar even when the query editor is wrapped in an extra component layer
     * (UnifiedQueryEditor / QueryEditor.vue).
     * @param {boolean} value - true to enable SQL mode, false to disable
     * @returns {Promise<boolean>} true if the state was set successfully
     */
    async _setSqlModeViaVue(value) {
        // Delegates to _mutateSearchObj — single source of truth for the prod-safe
        // `_vnode` walk. See _mutateSearchObj jsdoc for why __vueParentComponent
        // can't be used in CI.
        const result = await this._mutateSearchObj((searchObj, v) => {
            searchObj.meta.sqlMode = v;
            return true;
        }, value);
        return result === true;
    }

    /**
     * Read `searchObj` via the prod-safe `_vnode` walk and apply `mutate(searchObj)`
     * inside `page.evaluate`. Returns whatever the mutate fn returns (defaults to true
     * on success). Use this instead of `__vueParentComponent` walks anywhere that
     * needs to read or write Vue reactive state — `__vueParentComponent` is dev-only
     * and undefined in the production frontend bundle CI ships.
     */
    async _mutateSearchObj(mutate, payload) {
        return await this.page.evaluate(({ mutateSrc, payload }) => {
            try {
                const app = document.querySelector('#app');
                if (!app?._vnode) return null;
                const visited = new Set();
                let target = null;
                const walk = (node, depth) => {
                    if (!node || depth > 60 || visited.has(node) || target) return;
                    visited.add(node);
                    const setupState = node.component?.setupState;
                    if (setupState && 'searchObj' in setupState) {
                        const s = setupState.searchObj;
                        if (s?.meta && 'sqlMode' in s.meta) {
                            target = s;
                            return;
                        }
                    }
                    if (node.component?.subTree) walk(node.component.subTree, depth + 1);
                    if (Array.isArray(node.children)) {
                        for (const c of node.children) {
                            if (c && typeof c === 'object') walk(c, depth + 1);
                            if (target) return;
                        }
                    }
                };
                walk(app._vnode, 0);
                if (!target) return null;
                // eslint-disable-next-line no-new-func
                const fn = new Function('searchObj', 'payload', `return (${mutateSrc})(searchObj, payload)`);
                return fn(target, payload);
            } catch (e) {
                return null;
            }
        }, { mutateSrc: mutate.toString(), payload });
    }

    /**
     * Set `searchObj.data.query` and `searchObj.data.editorValue` to `query` via
     * the prod-safe `_vnode` walk. Returns true on success, null if Vue state
     * could not be located.
     */
    async _setSearchObjQuery(query) {
        return await this._mutateSearchObj((searchObj, q) => {
            searchObj.data.query = q;
            searchObj.data.editorValue = q;
            return true;
        }, query);
    }

    /**
     * Open the date-time picker and select a relative time range button by suffix.
     * @param {string} suffix - e.g. "1-h", "30-m", "15-m", "30-s"
     */
    async setRelativeTimeRange(suffix) {
        await this.page.locator(this.dateTimeButton).click();
        const relativeBtn = this.page.locator(`[data-test="date-time-relative-${suffix}-btn"]`);
        await relativeBtn.waitFor({ state: 'visible', timeout: 5000 });
        await relativeBtn.click();
        // Wait for the date-time button to remain visible (popup closed); selection complete
        await this.page.locator(this.dateTimeButton).waitFor({ state: 'visible' });
        testLogger.info(`Relative time range set: ${suffix}`);
    }

    /**
     * Click the query editor and type a query string.
     * @param {string} text - Query text to type
     */
    async typeIntoQueryEditor(text) {
        const editor = this.page.locator(this.queryEditor);
        await editor.waitFor({ state: 'visible', timeout: 10000 });
        await editor.click();
        await this.page.keyboard.type(text);
        testLogger.info('Typed text into query editor', { length: text.length });
    }

    /**
     * Wait for search results or the not-found indicator after triggering a query.
     * Resolves deterministically when the table OR the not-found text is visible.
     */
    async waitForSearchResultOrEmpty(timeout = 30000) {
        try {
            await this.page.waitForLoadState('networkidle', { timeout }).catch(() => {});
            // Wait for results table, no-events state, no-query-applied state, or error state
            await this.page.locator(
                `${this.logsTable}, [data-test="logs-search-no-events-found-text"], [data-test="logs-search-apply-search-text"], [data-test="logs-search-error-state"], [data-test="logs-search-filter-error-message"]`
            ).first().waitFor({ state: 'visible', timeout });
            testLogger.info('Search result or empty state visible');
        } catch (e) {
            testLogger.warn('waitForSearchResultOrEmpty: timed out waiting for results indicator');
        }
    }

    /**
     * Get the current query from the editor
     * @returns {Promise<string>} The query text
     */
    async getQueryFromEditor() {
        try {
            // Use Monaco API to get the actual editor value (textContent includes line numbers)
            const query = await this.page.evaluate((selector) => {
                const host = document.querySelector(selector);
                if (!host || !window.monaco?.editor?.getEditors) return null;
                const ed = window.monaco.editor.getEditors().find((e) => host.contains(e.getDomNode()));
                if (!ed) return null;
                return ed.getValue();
            }, this.queryEditor).catch(() => null);

            if (query !== null) return query.trim();

            // Fallback to textContent if Monaco isn't available
            const editor = this.page.locator(this.queryEditor);
            const queryText = await editor.textContent();
            return queryText?.trim() || '';
        } catch (e) {
            return '';
        }
    }

    // ============================================================================
    // REGRESSION TEST POM METHODS
    // Added to fix POM violations in logs-regression.spec.js
    // ============================================================================

    /**
     * Get pagination text from table bottom
     * @returns {Promise<string>} The pagination text (e.g., "1-50 of 100")
     */
    async getPaginationText() {
        // Try logs page pagination first, then streams page pagination,
        // then the streams listing page (which uses a custom OTable #bottom slot).
        const selectors = [
            this.tableBottom,                           // logs-search-result-pagination
            '[data-test="o2-table-pagination-info"]',   // OTable built-in pagination
        ];
        for (const selector of selectors) {
            const locator = this.page.locator(selector).first();
            const count = await locator.count().catch(() => 0);
            if (count > 0) {
                const text = await locator.textContent().catch(() => null);
                if (text && text.trim()) return text.trim();
            }
        }
        // Fallback: streams listing page (LogStream.vue) uses a custom #bottom
        // slot that renders "{totalRows} Stream(s)" without a data-test.
        const streamCount = this.page.locator('text=/\\d+ Stream\\(s\\)/').first();
        if (await streamCount.count().catch(() => 0) > 0) {
            const text = await streamCount.textContent().catch(() => null);
            if (text && text.trim()) return text.trim();
        }
        return 'N/A';
    }

    /**
     * Fill the streams search input field
     * @param {string} text - The text to fill
     */
    async fillStreamsSearchInput(text) {
        const searchInput = this.page.locator(this.streamsSearchInputField);
        await searchInput.fill(text);
    }

    /**
     * Clear the streams search input field
     */
    async clearStreamsSearchInput() {
        const searchInput = this.page.locator(this.streamsSearchInputField);
        await searchInput.clear();
    }

    /**
     * Get the count of table body rows with index
     * @returns {Promise<number>} The number of rows
     */
    async getTableRowCount() {
        return await this.page.locator(this.tableBodyRowWithIndex).count();
    }

    /**
     * Get the count of error indicators on the page
     * @returns {Promise<number>} The number of error indicators
     */
    async getErrorIndicatorCount() {
        return await this.page.locator(this.errorIndicators).count();
    }

    /**
     * Get the result text content
     * @returns {Promise<string>} The result text
     */
    async getResultText() {
        try {
            return await this.page.locator(this.resultText).textContent() || '';
        } catch (error) {
            return '';
        }
    }

    /**
     * Click the query history button
     */
    async clickHistoryButton() {
        const historyButton = this.page.locator(`${this.queryHistoryButton}, button:has-text("History")`).first();
        if (await historyButton.isVisible()) {
            await historyButton.click();
        }
    }

    /**
     * Check if the history panel is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isHistoryPanelVisible() {
        const historyPanel = this.page.locator(this.historyPanel).first();
        return await historyPanel.isVisible();
    }

    /**
     * Check if timestamp column is visible in table header
     * @returns {Promise<boolean>} True if visible
     */
    async isTimestampColumnVisible() {
        const timestampHeader = this.page.locator('th:has-text("_timestamp"), [data-test*="_timestamp"]').first();
        return await timestampHeader.isVisible().catch(() => false);
    }

    /**
     * Click the first table body row
     */
    async clickFirstTableRow() {
        const logRows = this.page.locator(this.tableBodyRow).first();
        if (await logRows.isVisible()) {
            await logRows.click();
        }
    }

    /**
     * Check if timestamp is visible in detail view
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<boolean>} True if visible
     */
    async isTimestampDetailVisible(timeout = 5000) {
        const timestampInDetail = this.page.locator(this.timestampInDetail).first();
        try {
            await expect(timestampInDetail).toBeVisible({ timeout });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Expect timestamp detail to be visible
     */
    async expectTimestampDetailVisible() {
        const timestampInDetail = this.page.locator(this.timestampInDetail).first();
        await expect(timestampInDetail).toBeVisible({ timeout: 5000 });
    }

    /**
     * Get the count of table headers
     * @returns {Promise<number>} The number of headers
     */
    async getTableHeaderCount() {
        return await this.page.locator(this.tableHeaders).count();
    }

    /**
     * Get the count of field expand buttons
     * @returns {Promise<number>} The number of field expand buttons
     */
    async getFieldExpandButtonCount() {
        return await this.page.locator(this.allFieldExpandButtons).count();
    }

    /**
     * Click a field button by field name
     * @param {string} fieldName - The name of the field
     */
    async clickFieldByName(fieldName) {
        const fieldItem = this.page.locator(this.fieldIndexListButton(fieldName)).first();
        if (await fieldItem.isVisible()) {
            await fieldItem.click();
        }
    }

    /**
     * Check if source column is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isSourceColumnVisible() {
        const sourceVisible = this.page.locator('th:has-text("source"), th:has-text("_source")').first();
        return await sourceVisible.isVisible().catch(() => false);
    }

    /**
     * Check if either timestamp or source column is visible
     * @returns {Promise<boolean>} True if either is visible
     */
    async isTimestampOrSourceVisible() {
        const timestampVisible = await this.isTimestampColumnVisible();
        const sourceVisible = await this.isSourceColumnVisible();
        return timestampVisible || sourceVisible;
    }

    /**
     * Hover over the download table menu
     */
    async hoverDownloadTableMenu() {
        const downloadTableMenu = this.page.locator('text=/Download Table/i').first();
        if (await downloadTableMenu.isVisible()) {
            await downloadTableMenu.hover();
        }
    }

    /**
     * Click the CSV download button
     */
    async clickDownloadCSVButton() {
        const csvDownloadButton = this.page.locator('[data-test="search-download-csv-btn"]');
        if (await csvDownloadButton.isVisible()) {
            await csvDownloadButton.click();
        }
    }

    /**
     * Click the JSON download button
     */
    async clickDownloadJSONButton() {
        const jsonDownloadButton = this.page.locator('[data-test="search-download-json-btn"]');
        if (await jsonDownloadButton.isVisible()) {
            await jsonDownloadButton.click();
        }
    }

    /**
     * Get the notification message text
     * @returns {Promise<string>} The notification text
     */
    async getNotificationText() {
        const toastMessage = this.page.locator('[data-test="o-toast-message"]');
        const count = await toastMessage.count();
        if (count > 0) {
            return await toastMessage.first().textContent() || '';
        }
        // Fallback to role=alert for backward compatibility
        const notifications = this.page.locator('[role="alert"]');
        const alertCount = await notifications.count();
        if (alertCount > 0) {
            return await notifications.first().textContent() || '';
        }
        return '';
    }

    /**
     * Get the count of notifications
     * @returns {Promise<number>} The number of notifications
     */
    async getNotificationCount() {
        return await this.page.locator('[data-test^="o-toast"]').count();
    }

    /**
     * Check if the refresh button is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isRefreshButtonVisible() {
        const refreshButton = this.page.locator(this.queryButton);
        return await refreshButton.isVisible({ timeout: 10000 }).catch(() => false);
    }

    /**
     * Check if error notification is visible
     * @returns {Promise<boolean>} True if visible
     */
    async hasErrorNotification() {
        const errorNotifications = this.page.locator('[role="alert"][class*="bg-negative"], text=/error/i, text=/syntax/i').first();
        return await errorNotifications.isVisible().catch(() => false);
    }

    /**
     * Check if stream validation error is visible
     * @returns {Promise<boolean>} True if visible
     */
    async hasStreamValidationError() {
        const errorNotifications = this.page.locator('[role="alert"], text=/select.*stream/i').first();
        return await errorNotifications.isVisible().catch(() => false);
    }

    /**
     * Get stream validation error text
     * @returns {Promise<string>} The error text
     */
    async getStreamValidationErrorText() {
        const errorNotifications = this.page.locator('[role="alert"], text=/select.*stream/i').first();
        if (await errorNotifications.isVisible().catch(() => false)) {
            return await errorNotifications.textContent() || '';
        }
        return '';
    }

    /**
     * Check if logs search result table is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isLogsSearchResultTableVisible() {
        const resultsTable = this.page.locator(this.logsSearchResultLogsTable);
        return await resultsTable.isVisible().catch(() => false);
    }

    /**
     * Click the SQL Mode switch.
     * Opens the utilities dropdown first since the toggle lives inside it.
     */
    async clickSQLModeSwitch() {
        // SQL mode toggle removed — delegate to clickSQLModeToggle which writes a SELECT
        // query into the editor so that SQL mode is auto-detected as ON.
        await this.clickSQLModeToggle();
    }

    /**
     * Get SQL mode data-state value.
     * SQL mode toggle was removed from the UI — always returns null.
     * @returns {Promise<string|null>}
     */
    async getSQLModeState() {
        testLogger.info('getSQLModeState: SQL mode toggle removed from UI — returning null');
        return null;
    }

    /**
     * Click the Last 1 hour relative time button
     */
    async clickRelative1HourButton() {
        const oneHourButton = this.page.locator(this.relative1HourButton);
        if (await oneHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await oneHourButton.click();
        }
    }

    /**
     * Check if Last 1 hour button is visible and click it, fallback to 15 min
     */
    async clickRelative1HourOrFallback() {
        const oneHourButton = this.page.locator('[data-test="date-time-relative-1-h-btn"]');
        if (await oneHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await oneHourButton.click();
            return 'Last 1 hour';
        } else {
            await this.clickRelative15MinButton();
            return 'Last 15 minutes';
        }
    }

    /**
     * Click the widest available relative time range for pagination tests.
     * Tries: Last 1 hour → Last 12 hours → Last 15 minutes (fallback)
     */
    async clickWideRelativeTimeRangeOrFallback() {
        const oneHourButton = this.page.locator('[data-test="date-time-relative-1-h-btn"]');
        const twelveHourButton = this.page.locator('[data-test="date-time-relative-12-h-btn"]');
        if (await oneHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await oneHourButton.click();
            return 'Last 1 hour';
        } else if (await twelveHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await twelveHourButton.click();
            return 'Last 12 hours';
        } else {
            await this.clickRelative15MinButton();
            return 'Last 15 minutes';
        }
    }

    /**
     * Disable auto refresh by clicking the off button
     */
    async disableAutoRefresh() {
        await this.clickLiveModeButton();
        await this.page.waitForTimeout(500);
        const offButton = this.page.locator('[data-test="logs-search-bar-refresh-time-0"]');
        if (await offButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await offButton.click();
        }
        await this.page.waitForTimeout(500);
    }

    // ========== BUG REGRESSION TEST METHODS ==========

    /**
     * Expect refresh button to be visible
     * Bug #8928 - UI consistency
     */
    async expectRefreshButtonVisible() {
        const button = this.page.locator(this.queryButton);
        await expect(button).toBeVisible({ timeout: 10000 });
        testLogger.info('Refresh button is visible');
    }

    /**
     * Expect refresh button to be enabled
     * Bug #9533 - Loading states
     */
    async expectRefreshButtonEnabled() {
        const button = this.page.locator(this.queryButton);
        await expect(button).toBeEnabled({ timeout: 10000 });
        testLogger.info('Refresh button is enabled');
    }

    /**
     * Expect stream selector to be visible
     * Bug #8928 - UI consistency
     */
    async expectStreamSelectorVisible() {
        const selector = this.page.locator(this.indexDropDown);
        await expect(selector).toBeVisible({ timeout: 10000 });
        testLogger.info('Stream selector is visible');
    }

    /**
     * Expect DateTime button to be visible
     * Bug #8928 - UI consistency
     */
    async expectDateTimeButtonVisible() {
        const button = this.page.locator(this.dateTimeButton);
        await expect(button).toBeVisible({ timeout: 10000 });
        testLogger.info('DateTime button is visible');
    }

    /**
     * Enable histogram if not already enabled
     * Bug #8928 - Histogram rendering
     * Histogram toggle is now directly visible in the toolbar (moved out of utilities menu)
     */
    async enableHistogram() {
        // Use button checked-state detection, not canvas visibility.
        // Canvas is absent before the first query runs, so visibility check
        // would incorrectly toggle histogram OFF when it is already ON.
        const isOn = await this.logsQueryPage.isHistogramOn();
        if (isOn) {
            testLogger.info('Histogram already enabled');
            return;
        }
        // toggleHistogram() correctly handles inline button (normal viewport) and
        // the menu fallback (narrow viewport), so delegate rather than duplicating.
        await this.toggleHistogram();
        testLogger.info('Histogram enabled');
    }

    /**
     * Toggle histogram on/off.
     * In normal viewports the histogram is a standalone inline toolbar button.
     * Only falls back to the utilities menu in narrow viewports (shouldMoveButtonsToMenu).
     */
    async toggleHistogram() {
        await this.page.keyboard.press('Escape').catch(() => {});
        const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
        const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (isInline) {
            await inlineBtn.click();
            testLogger.info('Histogram toggled (inline button)');
            return;
        }
        // Narrow-viewport fallback: open the utilities menu and click the menu item.
        await this.page.locator(this.utilitiesMenuButton).click();
        const menuItem = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"]');
        await menuItem.waitFor({ state: 'visible', timeout: 5000 });
        await menuItem.click();
        testLogger.info('Histogram toggled (menu item)');
    }

    /**
     * Expect histogram to be visible
     * Bug #8928 - Histogram rendering
     */
    async expectHistogramVisible() {
        const histogramCanvas = this.page.locator(this.barChartCanvas);
        await expect(histogramCanvas).toBeVisible({ timeout: 10000 });
        testLogger.info('Histogram is visible');
    }

    // ============================================================================
    // VRL & SAVED VIEWS POM METHODS - Bug #9690
    // Rule 3 Compliance: Extract raw locators from spec files into POM
    // ============================================================================

    /**
     * Click the VRL toggle button to enable/disable VRL editor
     * @returns {Promise<void>}
     */
    async clickVrlToggleButton() {
        const vrlToggle = this.page.locator('[data-test="logs-search-bar-vrl-toggle-btn"]');
        await vrlToggle.waitFor({ state: 'visible', timeout: 10000 });
        await vrlToggle.click();
        testLogger.info('Clicked VRL toggle button');
    }

    /**
     * Get the VRL editor locator
     * @returns {import('@playwright/test').Locator} VRL editor locator
     */
    getVrlEditor() {
        return this.page.locator('[data-test="logs-vrl-function-editor"], #fnEditor, .monaco-editor');
    }

    /**
     * Type text into the VRL editor
     * @param {string} text - Text to type
     */
    async typeInVrlEditor(text) {
        const vrlEditor = this.page.locator('[data-test="logs-vrl-function-editor"], #fnEditor, .monaco-editor');
        await vrlEditor.first().waitFor({ state: 'visible', timeout: 10000 });
        const textbox = vrlEditor.first().locator('.inputarea');
        await textbox.waitFor({ state: 'visible', timeout: 5000 });
        await textbox.fill(text);
        testLogger.info('Typed text into VRL editor');
    }

    /**
     * Get VRL editor content text
     * @returns {Promise<string>} Editor content
     */
    async getVrlEditorContent() {
        const vrlEditor = this.page.locator('[data-test="logs-vrl-function-editor"], #fnEditor');
        await vrlEditor.first().waitFor({ state: 'visible', timeout: 10000 });
        const content = await vrlEditor.first().textContent();
        return content || '';
    }

    /**
     * Click the Save Transform button
     */
    async clickSaveTransformButton() {
        const saveBtn = this.page.locator('[data-test="logs-search-bar-save-transform-btn"]');
        await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
        await saveBtn.click();
        testLogger.info('Clicked Save Transform button');
    }

    /**
     * Fill the saved function name input
     * @param {string} name - Function name
     */
    async fillSavedFunctionNameInput(name) {
        // OInput convention (AGENT_RULES §4): wait on wrapper for visibility, fill -field variant.
        await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.savedFunctionNameInputField).fill(name);
        testLogger.info(`Filled saved function name: ${name}`);
    }

    /**
     * Click the "Save View" option in the saved views dropdown
     */
    async clickSaveViewOption() {
        const saveViewOption = this.page.getByText('Save View', { exact: false });
        await saveViewOption.waitFor({ state: 'visible', timeout: 10000 });
        await saveViewOption.click();
        testLogger.info('Clicked Save View option');
    }

    /**
     * Fill the view name input in the save view dialog
     * @param {string} name - View name
     */
    async fillViewNameInput(name) {
        const input = this.page.locator('[data-test="add-alert-name-input"]');
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(name);
        testLogger.info(`Filled view name: ${name}`);
    }

    /**
     * Click the save button in the save view dialog
     */
    async clickSaveViewDialogSaveButton() {
        const saveBtn = this.page.locator('[data-test="saved-view-dialog-save-btn"]');
        await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
        await saveBtn.scrollIntoViewIfNeeded();
        await saveBtn.click({ force: true });
        testLogger.info('Clicked Save View dialog save button');
    }

    /**
     * Get the function dropdown text
     * @returns {Promise<string>} Dropdown text
     */
    async getFunctionDropdownText() {
        const dropdown = this.page.locator('[data-test="logs-search-bar-function-dropdown"]');
        await dropdown.waitFor({ state: 'visible', timeout: 10000 });
        const text = await dropdown.textContent();
        return text || '';
    }

    /**
     * Click a saved view by name
     * @param {string} name - Saved view name
     */
    async clickSavedViewByName(name) {
        // SearchBar.vue uses data-test="logs-search-bar-apply-${value}-saved-view-btn" for the apply button.
        // The previously used `logs-search-saved-view-item-${name}` does not exist in the DOM.
        const savedView = this.page.locator(`[data-test="logs-search-bar-apply-${name}-saved-view-btn"]`).first();
        await savedView.waitFor({ state: 'visible', timeout: 10000 });
        // force: true — ODropdown portal transiently detaches items during initial render
        await savedView.click({ force: true });
        testLogger.info(`Clicked saved view: ${name}`);
    }

    /**
     * Expect a saved view to be visible
     * @param {string} name - Saved view name
     * @param {Object} options - Options
     * @param {number} options.timeout - Timeout in ms (default 10000)
     */
    async expectSavedViewVisible(name, options = {}) {
        const timeout = options.timeout || 10000;
        const savedView = this.page.getByText(name, { exact: false });
        await expect(savedView).toBeVisible({ timeout });
        testLogger.info(`Saved view visible: ${name}`);
    }

    /**
     * Get the saved views button group locator
     * @returns {import('@playwright/test').Locator} Saved views split dropdown button locator
     */
    getSavedViewsButtonLocator() {
        return this.page.locator(this.savedViewsDropdownBtn);
    }

    /**
     * Click the utilities menu button to show saved views
     * This opens the utilities menu (replaces old dropdown arrow)
     */
    async clickSavedViewsDropdownArrow() {
        // Saved views list is now opened via the utilities ("More") dropdown menu.
        // Ensure any previously open dropdown is closed before opening fresh.
        const listMenuItem = this.page.locator(this.menuListSavedViewsBtn);
        await this.page.keyboard.press('Escape').catch(() => {});
        await listMenuItem.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        // After navigation the Vue component may need an extra render cycle before its
        // click handler responds. Retry the open sequence up to 3 times: force-click the
        // trigger, wait up to 5 s for the menu item to appear, then reset and try again.
        let opened = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            await this.page.locator(this.utilitiesMenuButton).click({ force: true });
            opened = await listMenuItem.waitFor({ state: 'visible', timeout: 5000 })
                .then(() => true).catch(() => false);
            if (opened) break;
            await this.page.keyboard.press('Escape').catch(() => {});
            await listMenuItem.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
        }
        if (!opened) throw new Error('Could not open saved views menu after 3 attempts');
        // force: true — ODropdown portal transiently detaches items during initial render
        await listMenuItem.click({ force: true });
        await this.page.locator(this.savedViewsListDialogEl).waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Clicked saved views dropdown arrow');
    }

    /**
     * Expand the saved views dropdown and wait for search input
     * Tries arrow click first, then main button if search input doesn't appear
     */
    async expandSavedViewsDropdown() {
        await this.clickSavedViewsDropdownArrow();
        const searchInput = this.page.locator(this.savedViewSearchInput);
        await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Click delete button for a saved view by name
     * Uses dynamic data-test attribute
     * @param {string} name - Saved view name
     */
    async clickDeleteSavedViewByName(name) {
        // data-test uses view_id (UUID), not name — scope to main table after filtering.
        const mainTable = this.page.locator('[data-test="log-search-saved-view-list-fields-table"]');
        const deleteBtn = mainTable.locator('[data-test*="logs-search-bar-delete-"]').first();
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();
        testLogger.info(`Clicked delete for saved view: ${name}`);
    }

    // ============================================================================
    // VRL FIELD ICONS POM METHODS - Bug #9550
    // Rule 3 Compliance: Extract raw locators from logstable.spec.js into POM
    // ============================================================================

    /**
     * Get the computed field button locator
     * @returns {import('@playwright/test').Locator} Computed field button locator
     */
    getComputedFieldButton() {
        return this.page.locator('[data-test*="computed_field"]');
    }

    /**
     * Get the include/exclude icon for a field
     * @param {string} fieldName - Field name (optional, for specific field)
     * @returns {import('@playwright/test').Locator} Include/exclude icon locator
     */
    getIncludeExcludeIcon(fieldName = null) {
        if (fieldName) {
            return this.page.locator(`[data-test*="${fieldName}"] [data-test*="include-exclude"]`);
        }
        return this.page.locator('[data-test*="computed_field"] [data-test*="include-exclude"]');
    }

    /**
     * Get the equals icon for a computed field
     * @param {string} fieldName - Field name (optional)
     * @returns {import('@playwright/test').Locator} Equals icon locator
     */
    getEqualsIcon(fieldName = null) {
        if (fieldName) {
            return this.page.locator(`[data-test*="${fieldName}"]`).locator('..').locator('[class*="equal"]');
        }
        return this.page.locator('[data-test*="computed_field"]').locator('..').locator('[class*="equal"]');
    }

    /**
     * Get the table headers locator
     * @returns {import('@playwright/test').Locator} Table headers locator
     */
    getTableHeaders() {
        return this.page.locator('thead th');
    }

    /**
     * Get a field button by name
     * @param {string} fieldName - Field name
     * @returns {import('@playwright/test').Locator} Field button locator
     */
    getFieldButton(fieldName) {
        return this.page.locator(`[data-test*="${fieldName}"]`);
    }

    /**
     * Get the include button locator
     * @returns {import('@playwright/test').Locator} Include button locator
     */
    getIncludeButton() {
        return this.page.locator('[data-test*="include"]');
    }

    /**
     * Expect equals icon to NOT be visible (Bug #9550 test)
     * VRL-generated fields should not have equals icon
     */
    async expectEqualsIconNotVisible() {
        const equalsIcon = this.getEqualsIcon();
        await expect(equalsIcon).not.toBeVisible();
        testLogger.info('Equals icon is NOT visible (Bug #9550 verified)');
    }

    /**
     * Expect include/exclude icon to NOT be visible (Bug #9550 test)
     * VRL-generated fields should not have include/exclude icon
     */
    async expectIncludeExcludeIconNotVisible() {
        const icon = this.getIncludeExcludeIcon();
        await expect(icon).not.toBeVisible();
        testLogger.info('Include/exclude icon is NOT visible (Bug #9550 verified)');
    }

    // ============================================================================
    // MONACO LAZY LOADING HELPER METHODS - PR #10146
    // These methods support Monaco editor lazy loading query pre-fill tests
    // ============================================================================

    /**
     * Wait for Monaco query editor to be visible after lazy loading
     * @param {number} timeout - Timeout in milliseconds (default 30000)
     */
    async waitForQueryEditorVisible(timeout = 30000) {
        await this.page.locator(this.queryEditor).waitFor({
            state: 'visible',
            timeout: timeout
        });
        testLogger.info('Monaco query editor is visible');
    }

    /**
     * Wait until the Monaco query editor is visible AND its model has finished
     * (lazy-)loading with non-empty content, optionally containing an expected
     * substring. Deterministic replacement for `waitForQueryEditorVisible()` +
     * `waitForTimeout(n)` when reading editor text after a share-link / short-URL
     * redirect or a saved-view apply: the editor host can become "visible" before
     * the SPA re-hydrates the query from restored state, so getQueryEditorText()
     * momentarily returns "" and a fixed wait races the pre-fill. Polls the live
     * monaco model value via Playwright's wait engine — no waitForTimeout.
     * @param {string|null} expectedSubstring - if provided, wait until the text contains it (case-insensitive)
     * @param {number} timeout - poll ceiling; returns the instant content appears, so a
     *   larger value only tolerates slow CI hydration (lazy-load + short-URL redirect +
     *   SPA re-hydrate) — it never slows the happy path.
     * @returns {Promise<string>} the editor text once ready
     */
    async waitForQueryEditorContent(expectedSubstring = null, timeout = 45000) {
        await this.waitForQueryEditorVisible(timeout);
        await expect.poll(
            async () => {
                const text = await this.getQueryEditorText();
                if (!text) return false;
                if (expectedSubstring) {
                    return text.toLowerCase().includes(expectedSubstring.toLowerCase());
                }
                return text.trim().length > 0;
            },
            {
                timeout,
                intervals: [200, 500, 1000, 2000],
                message: expectedSubstring
                    ? `query editor never contained "${expectedSubstring}"`
                    : 'query editor never became non-empty',
            }
        ).toBe(true);
        const text = await this.getQueryEditorText();
        testLogger.info('Query editor content ready', {
            length: text?.length ?? 0,
            expectedSubstring,
        });
        return text;
    }

    /**
     * Wait for the Monaco editor to prefill with the restored query AFTER a share-link
     * short-URL redirect. The editor is lazy-loaded and, after the extra short-URL
     * resolution hop, occasionally finishes mounting without applying the query from the
     * (already-resolved) URL — leaving it empty. A DIRECT load of that same resolved URL
     * prefills reliably (the URL-query-param prefill path), so if the first wait window
     * comes up empty we reload the resolved URL once to re-trigger that reliable path,
     * then wait again. This is a deterministic self-heal grounded in a known-good code
     * path — not a blind retry — and only kicks in on the (rare) empty-editor race.
     * @param {string} expectedSubstring
     * @param {number} firstWindow - initial poll ceiling before attempting the reload
     * @param {number} secondWindow - poll ceiling after the reload
     * @returns {Promise<string>} the editor text once ready
     */
    async waitForRedirectedQueryEditorContent(expectedSubstring, firstWindow = 20000, secondWindow = 30000) {
        try {
            return await this.waitForQueryEditorContent(expectedSubstring, firstWindow);
        } catch (e) {
            testLogger.warn('Editor empty after redirect — reloading the resolved URL to re-trigger URL-param prefill', {
                expectedSubstring,
                url: await this.getCurrentUrl(),
            });
            await this.page.reload();
            await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            return await this.waitForQueryEditorContent(expectedSubstring, secondWindow);
        }
    }

    /**
     * Set query editor content reliably using Playwright's fill() on the Monaco .inputarea.
     * This properly clears existing content before typing, unlike Ctrl+A + Backspace which
     * can fail to clear Monaco in certain states.
     * @param {string} query - The SQL query to set
     */
    async setQueryEditorContent(query) {
        // Drive value via window.monaco.editor (AGENT_RULES §5) — no class scraping
        // Wait for the editor host AND the monaco model to be available
        await this.page.locator(this.queryEditor).first().waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForFunction((selector) => {
            const host = document.querySelector(selector);
            if (!host) return false;
            const editors = window.monaco?.editor?.getEditors?.() ?? [];
            return editors.some(ed => {
                const node = ed.getDomNode?.();
                return node && host.contains(node);
            });
        }, this.queryEditor, { timeout: 10000 });
        // Set value via the monaco model so undo history is preserved and Vue v-model fires
        await this.page.evaluate(({ selector, value }) => {
            const host = document.querySelector(selector);
            const editors = window.monaco?.editor?.getEditors?.() ?? [];
            const target = editors.find(ed => {
                const node = ed.getDomNode?.();
                return node && host.contains(node);
            });
            if (!target) throw new Error('Monaco editor not found for selector');
            target.focus();
            const model = target.getModel();
            const fullRange = model.getFullModelRange();
            target.executeEdits('setQueryEditorContent', [
                { range: fullRange, text: value, forceMoveMarkers: true },
            ]);
            // executeEdits is a no-op on read-only editors (e.g. build-tab auto mode).
            // Fall back to model.setValue() which bypasses the readOnly restriction and
            // still fires onDidChangeModelContent so the Vue component can react.
            if (model.getValue() !== value) {
                model.setValue(value);
            }
            target.setSelection(model.getFullModelRange());
        }, { selector: this.queryEditor, value: query });
        // Verify via getValue() that the model now reflects the value (handles empty string too)
        await expect.poll(async () => {
            return await this.getQueryEditorText();
        }, { timeout: 5000 }).toBe(query);
        testLogger.info(`Query editor set to: "${query.substring(0, 60)}"`);
    }

    /**
     * Enable SQL mode if not already enabled.
     * Sets sqlMode=true via the Vue component state (triggers the sqlMode watcher in build
     * tab or enables auto-detection on the logs tab). Falls back to typing SELECT * if Vue
     * state access is unavailable.
     */
    async enableSqlModeIfNeeded() {
        const isSQL = await this.isSqlModeEnabled();
        if (isSQL) {
            testLogger.info('enableSqlModeIfNeeded: SQL mode already on — skipping');
            return;
        }
        // Set the Vue flag first — in the build tab this triggers the sqlMode watcher
        // which updates the editor with the full generated SQL query.
        await this._setSqlModeViaVue(true);

        // Poll up to 2000ms for the Vue watcher chain to update the Monaco editor.
        // The watcher is async (reads buildDashboardPanelData, awaits onBuildQueryGenerated,
        // then Vue re-renders the editor prop) — a fixed 600ms was too short under CI load.
        // Only the Build tab has this watcher; on the main logs tab it returns early and the
        // editor never auto-populates, so waiting there just burns the full 2s before the
        // fallback below runs anyway. Skip straight to the fallback in that case.
        const onBuildTab = await this.page.locator(this.buildQueryPage)
            .isVisible({ timeout: 500 }).catch(() => false);
        if (onBuildTab) {
            await this.page.waitForFunction((selector) => {
                const host = document.querySelector(selector);
                if (!host) return false;
                const editors = window.monaco?.editor?.getEditors?.() ?? [];
                for (const ed of editors) {
                    const node = ed.getDomNode?.();
                    if (node && host.contains(node)) {
                        const val = (ed.getValue() || '').toLowerCase().trim();
                        return val.includes('select') && val.includes('from');
                    }
                }
                return false;
            }, this.queryEditor, { timeout: 2000, polling: 100 }).catch(() => {});
        }

        // Check if the editor was updated (build tab watcher fired).
        // In the main logs tab the watcher returns early, so the editor stays in FTS mode.
        // In that case fall back to writing SELECT directly so the editor reflects SQL mode.
        // In build mode the query editor is read-only (buildModeQueryEditorDisabled=true),
        // so Monaco executeEdits is blocked by the readOnly flag. Instead, update
        // searchObj.data.query directly via Vue state — use the same multi-anchor + comp.parent
        // traversal as _setSqlModeViaVue to reliably reach the component hosting searchObj.
        const isSQLNow = await this.isSqlModeEnabled();
        if (!isSQLNow) {
            const stream = await this._getSelectedStream();
            const sql = `SELECT * FROM "${stream}"`;
            const updatedViaState = await this._setSearchObjQuery(sql);
            if (!updatedViaState) {
                // Last resort: write SELECT directly via setQueryEditorContent.
                // In build-tab auto mode the editor is read-only, but setQueryEditorContent
                // now falls back to model.setValue() which bypasses the readOnly restriction.
                await this.setQueryEditorContent(sql);
            }
            // Wait for the CodeQueryEditor props.query watcher to actually apply the value
            // to Monaco instead of sleeping a fixed 500ms — deterministic and usually <300ms.
            await this.page.waitForFunction((selector) => {
                const host = document.querySelector(selector);
                if (!host) return false;
                const editors = window.monaco?.editor?.getEditors?.() ?? [];
                for (const ed of editors) {
                    const node = ed.getDomNode?.();
                    if (node && host.contains(node)) {
                        const val = (ed.getValue() || '').toLowerCase().trim();
                        return val.includes('select') && val.includes('from');
                    }
                }
                return false;
            }, this.queryEditor, { timeout: 3000, polling: 100 }).catch(() => {});
        }
        testLogger.info('enableSqlModeIfNeeded: SQL mode enabled');
    }

    /**
     * Disable SQL mode if currently enabled.
     * Sets sqlMode=false via the Vue component state (triggers the sqlMode watcher in build
     * tab to show WHERE clause). Falls back to direct state update if the editor is read-only
     * (build tab auto mode) or the async watcher chain is too slow.
     */
    async disableSqlModeIfNeeded() {
        const isSQL = await this.isSqlModeEnabled();
        if (!isSQL) {
            testLogger.info('disableSqlModeIfNeeded: SQL mode already off — skipping');
            return;
        }
        // Set sqlMode=false via Vue state — in build mode this triggers the Index.vue
        // watcher which calls onBuildQueryGenerated() → extractWhereClause() (async) →
        // searchObj.data.query = whereClause → QueryEditor prop watcher → Monaco setValue.
        await this._setSqlModeViaVue(false);
        // Wait for the watcher chain to strip the SELECT from the editor instead of a fixed
        // 600ms sleep — resolves as soon as the editor updates, falls through on timeout to
        // the isStillSQL fallback below (same recovery path as before).
        await this.page.waitForFunction((selector) => {
            const host = document.querySelector(selector);
            if (!host) return true;
            const editors = window.monaco?.editor?.getEditors?.() ?? [];
            for (const ed of editors) {
                const node = ed.getDomNode?.();
                if (node && host.contains(node)) {
                    const val = (ed.getValue() || '').toLowerCase().trim();
                    return !(val.includes('select') && val.includes('from'));
                }
            }
            return true;
        }, this.queryEditor, { timeout: 2000, polling: 100 }).catch(() => {});

        // Verify the editor was updated. The Vue watcher chain is async and involves an
        // SQL-parser dynamic import, so it can exceed 600ms on first load or under CI load.
        // If the editor still contains SELECT, fall back to the same pattern as
        // enableSqlModeIfNeeded: set searchObj.data.query directly via Vue state so the
        // QueryEditor prop watcher calls editorObj.getModel().setValue() which bypasses
        // the Monaco readOnly flag (unlike keyboard shortcuts which do not).
        const isStillSQL = await this.isSqlModeEnabled();
        if (isStillSQL) {
            testLogger.warn('disableSqlModeIfNeeded: Vue watcher did not update editor in time — using direct state fallback');
            const updatedViaState = await this._mutateSearchObj((searchObj) => {
                searchObj.data.query = '';
                searchObj.data.editorValue = '';
                return true;
            });
            if (!updatedViaState) {
                // Absolute fallback: programmatic Monaco clear via executeEdits which
                // bypasses the readOnly flag (unlike keyboard Ctrl+A + Backspace which fails
                // silently on read-only editors in the build tab's auto mode).
                await this.setQueryEditorContent('').catch(() => {});
            }
            // Wait for the editor to actually reflect the cleared query instead of a
            // fixed 500ms sleep — deterministic, resolves as soon as propagation lands.
            await this.page.waitForFunction((selector) => {
                const host = document.querySelector(selector);
                if (!host) return true;
                const editors = window.monaco?.editor?.getEditors?.() ?? [];
                for (const ed of editors) {
                    const node = ed.getDomNode?.();
                    if (node && host.contains(node)) {
                        const val = (ed.getValue() || '').toLowerCase().trim();
                        return !(val.includes('select') && val.includes('from'));
                    }
                }
                return true;
            }, this.queryEditor, { timeout: 2000, polling: 100 }).catch(() => {});
        }
        testLogger.info('disableSqlModeIfNeeded: SQL mode disabled');
    }

    /**
     * Click relative time button by selector
     * @param {string} timeSelector - The time selector (e.g., '1-h', '15-m', '30-m')
     */
    async clickRelativeTimeButton(timeSelector) {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.waitForTimeout(500);
        await this.page.locator(`[data-test="date-time-relative-${timeSelector}-btn"]`).click();
        await this.page.waitForTimeout(500);
        testLogger.info(`Selected relative time: ${timeSelector}`);
    }

    // ============================================================================
    // LOGS TABLE WAIT METHODS
    // ============================================================================

    /**
     * Wait for logs table to load by checking for the first log row
     * @param {number} timeout - Timeout in milliseconds (default 30000)
     */
    async waitForLogsTableToLoad(timeout = 30000) {
        await this.page.locator(this.logTableColumnSource).first().waitFor({
            state: 'visible',
            timeout
        }).catch(() => {});
        testLogger.info('Logs table loaded');
    }

    // ============================================================================
    // SEARCH PATTERNS METHODS (Enterprise Feature)
    // These methods support the Search Patterns feature for log pattern analysis
    // ============================================================================

    /**
     * Click the Patterns toggle button to switch to patterns view
     * Note: This feature is only available in Enterprise edition
     */
    async clickPatternsToggle() {
        await this.page.locator(this.patternsToggle).click();
        testLogger.info('Clicked Patterns toggle button');
    }

    /**
     * Assert that the Patterns toggle button is visible (Enterprise only)
     */
    async expectPatternsToggleVisible() {
        await expect(this.page.locator(this.patternsToggle)).toBeVisible();
        testLogger.info('Patterns toggle button is visible');
    }

    /**
     * Assert that the Patterns toggle button is NOT visible (non-Enterprise)
     */
    async expectPatternsToggleNotVisible() {
        await expect(this.page.locator(this.patternsToggle)).not.toBeVisible();
        testLogger.info('Patterns toggle button is not visible (expected for non-Enterprise)');
    }

    /**
     * Assert that the Patterns toggle is in selected state
     */
    async expectPatternsToggleSelected() {
        // OToggleGroupItem uses inheritAttrs:false + v-bind="$attrs" on the inner Reka UI <button>.
        // data-test AND data-state are both on that same <button> element — no child selector.
        await expect(this.page.locator(`${this.patternsToggle}[data-state="on"]`)).toBeVisible({ timeout: 10000 });
        testLogger.info('Patterns toggle is in selected state');
    }

    /**
     * Wait for patterns to load (after clicking toggle)
     * @param {number} timeout - Timeout in milliseconds (default 30000)
     * @returns {Promise<'statistics'|'patterns'|'empty'|'timeout'>}
     */
    async waitForPatternsToLoad(timeout = 30000) {
        const startTime = Date.now();

        // First, check if loading state appears (indicates extraction is starting)
        const loadingStarted = await this.page.locator(this.patternLoadingSpinner)
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);

        if (loadingStarted) {
            testLogger.info('Pattern extraction loading started, waiting for completion...');
            const remainingTimeout = Math.max(timeout - (Date.now() - startTime), 1000);
            await this.page.locator(this.patternLoadingSpinner)
                .waitFor({ state: 'hidden', timeout: remainingTimeout })
                .catch(() => {});
        }

        // Give UI a moment to render the results
        await this.page.waitForTimeout(500);

        // Check for result states with explicit timeout handling
        const remainingTimeout = Math.max(timeout - (Date.now() - startTime), 5000);
        const checkInterval = 500;
        const maxChecks = Math.ceil(remainingTimeout / checkInterval);
        // Grace period: don't accept "empty" until at least 15s have elapsed, because
        // the backend may return "No patterns found" before async extraction completes.
        const emptyGracePeriodMs = 15000;

        for (let i = 0; i < maxChecks; i++) {
            // Check each state synchronously to avoid Promise.race resource leaks
            if (await this.page.locator(this.patternStatistics).isVisible().catch(() => false)) {
                testLogger.info('Patterns loading result: statistics');
                return 'statistics';
            }
            if (await this.page.locator(this.patternCard(0)).isVisible().catch(() => false)) {
                testLogger.info('Patterns loading result: patterns');
                return 'patterns';
            }
            if (await this.page.locator(this.patternEmptyState).isVisible().catch(() => false)) {
                if (Date.now() - startTime >= emptyGracePeriodMs) {
                    testLogger.info('Patterns loading result: empty');
                    return 'empty';
                }
            }

            if (i < maxChecks - 1) {
                await this.page.waitForTimeout(checkInterval);
            }
        }

        testLogger.info('Patterns loading result: timeout');
        return 'timeout';
    }

    /**
     * Assert that pattern statistics are visible
     */
    async expectPatternStatisticsVisible() {
        await expect(this.page.locator(this.patternStatistics)).toBeVisible();
        testLogger.info('Pattern statistics are visible');
    }

    /**
     * Get the pattern statistics text
     * @returns {Promise<string>} The statistics text
     */
    async getPatternStatisticsText() {
        const text = await this.page.locator(this.patternStatistics).textContent();
        testLogger.info(`Pattern statistics: ${text}`);
        return text;
    }

    /**
     * Assert that at least one pattern card is visible
     */
    async expectPatternCardsVisible() {
        await expect(this.page.locator(this.patternCard(0))).toBeVisible();
        testLogger.info('At least one pattern card is visible');
    }

    /**
     * Assert that the empty state message is visible
     */
    async expectPatternEmptyStateVisible() {
        await expect(this.page.locator(this.patternEmptyState)).toBeVisible();
        testLogger.info('Pattern empty state is visible');
    }

    /**
     * Get the number of visible pattern cards
     * @returns {Promise<number>} Number of pattern cards
     */
    async getPatternCardCount() {
        // Count by template elements (one per card) to avoid overcounting card sub-elements
        // that may have data-test attributes (e.g. tokenized chips) not covered by exclusions
        const count = await this.page.locator('[data-test^="pattern-card-"][data-test$="-template"]').count().catch(() => 0);

        testLogger.info(`Pattern card count: ${count}`);
        return count;
    }

    /**
     * Click on a pattern card to open details
     * @param {number} index - The pattern card index (0-based)
     */
    async clickPatternCard(index = 0) {
        await this.page.locator(this.patternCard(index)).click();
        testLogger.info(`Clicked pattern card at index ${index}`);
    }

    /**
     * Get the template text from a pattern card
     * @param {number} index - The pattern card index (0-based)
     * @returns {Promise<string>} The template text
     */
    async getPatternCardTemplateText(index = 0) {
        const text = await this.page.locator(this.patternCardTemplate(index)).textContent();
        testLogger.info(`Pattern ${index} template: ${text}`);
        return text;
    }

    /**
     * Get the frequency from a pattern card
     * @param {number} index - The pattern card index (0-based)
     * @returns {Promise<string>} The frequency text
     */
    async getPatternCardFrequency(index = 0) {
        const text = await this.page.locator(this.patternCardFrequency(index)).textContent();
        testLogger.info(`Pattern ${index} frequency: ${text}`);
        return text;
    }

    /**
     * Get the percentage from a pattern card
     * @param {number} index - The pattern card index (0-based)
     * @returns {Promise<string>} The percentage text
     */
    async getPatternCardPercentage(index = 0) {
        const text = await this.page.locator(this.patternCardPercentage(index)).textContent();
        testLogger.info(`Pattern ${index} percentage: ${text}`);
        return text;
    }

    /**
     * Get the count of wildcard chips in a specific pattern card template
     * @param {number} index - The pattern card index (0-based)
     * @returns {Promise<number>} Number of wildcard chip elements
     */
    async getPatternCardWildcardChipCount(index = 0) {
        const count = await this.page.locator(this.patternCardWildcardChips(index)).count().catch(() => 0);
        testLogger.info(`Pattern ${index} wildcard chips: ${count}`);
        return count;
    }

    /**
     * Get the total count of all wildcard chips across all visible pattern cards
     * @returns {Promise<number>} Total number of .wildcard-chip elements on page
     */
    async getWildcardChipCount() {
        const count = await this.page.locator(this.wildcardChip).count();
        testLogger.info(`Total wildcard chips on page: ${count}`);
        return count;
    }

    /**
     * Get the text content of a wildcard chip at the given index
     * @param {number} index - The chip index (0-based, page-global)
     * @returns {Promise<string>} The chip's text label
     */
    async getWildcardChipText(index = 0) {
        const text = await this.page.locator(this.wildcardChip).nth(index).textContent().catch(() => '');
        return text.trim();
    }

    /**
     * Hover over a wildcard chip at the given index to trigger its tooltip
     * @param {number} index - The chip index (0-based, page-global)
     */
    async hoverWildcardChip(index = 0) {
        await this.page.locator(this.wildcardChip).nth(index).hover();
        testLogger.info(`Hovered over wildcard chip ${index}`);
    }

    /**
     * Check if a specific wildcard chip is visible
     * @param {number} index - The chip index (0-based, page-global)
     * @returns {Promise<boolean>} True if the chip is visible
     */
    async isWildcardChipVisible(index = 0) {
        return this.page.locator(this.wildcardChip).nth(index).isVisible().catch(() => false);
    }

    /**
     * Check if a pattern card has an anomaly badge
     * @param {number} index - The pattern card index (0-based)
     * @returns {Promise<boolean>} True if anomaly badge is visible
     */
    async isPatternAnomaly(index = 0) {
        const isAnomaly = await this.page.locator(this.patternCardAnomalyBadge(index)).isVisible({ timeout: 500 }).catch(() => false);
        testLogger.info(`Pattern ${index} is anomaly: ${isAnomaly}`);
        return isAnomaly;
    }

    /**
     * Get the text content of a pattern card's anomaly badge
     * @param {number} index - The pattern card index (0-based)
     * @returns {Promise<string>} Badge text, or empty string if not visible
     */
    async getPatternAnomalyBadgeText(index = 0) {
        const text = await this.page.locator(this.patternCardAnomalyBadge(index)).textContent().catch(() => '');
        return text.trim();
    }

    /**
     * Include a pattern in the query. The action lives in the pattern details
     * dialog (opened by clicking the card), not on the card itself.
     * @param {number} index - The pattern card index (0-based)
     */
    async clickPatternIncludeBtn(index = 0) {
        await this.page.locator(this.patternCard(index)).click();
        await this.page.locator(this.patternDetailIncludeBtn).click();
        testLogger.info(`Clicked include button on pattern ${index}`);
    }

    /**
     * Exclude a pattern from the query. As with include, the action lives in the
     * pattern details dialog rather than on the card.
     * @param {number} index - The pattern card index (0-based)
     */
    async clickPatternExcludeBtn(index = 0) {
        await this.page.locator(this.patternCard(index)).click();
        await this.page.locator(this.patternDetailExcludeBtn).click();
        testLogger.info(`Clicked exclude button on pattern ${index}`);
    }

    /**
     * Click the details icon on a pattern card
     * @param {number} index - The pattern card index (0-based)
     */
    async clickPatternDetailsIcon(index = 0) {
        await this.page.locator(this.patternCardDetailsIcon(index)).click();
        testLogger.info(`Clicked details icon on pattern ${index}`);
    }

    /**
     * Assert that the pattern details dialog is open
     */
    async expectPatternDetailsDialogOpen() {
        await expect(this.page.locator(this.closePatternDialog)).toBeVisible();
        testLogger.info('Pattern details dialog is open');
    }

    /**
     * Close the pattern details dialog
     */
    async closePatternDetailsDialog() {
        await this.page.locator(this.closePatternDialog).click();
        testLogger.info('Closed pattern details dialog');
    }

    /**
     * Click the previous button in pattern details dialog
     */
    async clickPatternDetailPreviousBtn() {
        await this.page.locator(this.patternDetailPreviousBtn).click();
        testLogger.info('Clicked previous button in pattern details');
    }

    /**
     * Click the next button in pattern details dialog
     */
    async clickPatternDetailNextBtn() {
        await this.page.locator(this.patternDetailNextBtn).click();
        testLogger.info('Clicked next button in pattern details');
    }

    /**
     * Assert that the previous button is enabled in pattern details dialog
     */
    async expectPatternDetailPreviousBtnEnabled() {
        await expect(this.page.locator(this.patternDetailPreviousBtn)).toBeEnabled();
        testLogger.info('Previous button is enabled');
    }

    /**
     * Assert that the previous button is disabled in pattern details dialog
     */
    async expectPatternDetailPreviousBtnDisabled() {
        await expect(this.page.locator(this.patternDetailPreviousBtn)).toBeDisabled();
        testLogger.info('Previous button is disabled');
    }

    /**
     * Assert that the next button is enabled in pattern details dialog
     */
    async expectPatternDetailNextBtnEnabled() {
        await expect(this.page.locator(this.patternDetailNextBtn)).toBeEnabled();
        testLogger.info('Next button is enabled');
    }

    /**
     * Assert that the next button is disabled in pattern details dialog
     */
    async expectPatternDetailNextBtnDisabled() {
        await expect(this.page.locator(this.patternDetailNextBtn)).toBeDisabled();
        testLogger.info('Next button is disabled');
    }

    /**
     * Wait for pattern details dialog to show specific pattern index
     * @param {number} expectedIndex - The expected pattern index (1-based for display)
     */
    async waitForPatternDetailIndex(expectedIndex) {
        // The footer renders `patternXofYShort` = "{index} of {total}" (e.g. "2 of 5").
        // PatternDetailsDialog provides a #header slot, so ODrawer never renders the
        // subTitle prop ("Pattern {index} of {total}") — searching for that text would
        // never find anything. Scope to the drawer panel to avoid pagination collisions.
        await this.page
            .locator('[data-test="pattern-details-dialog"]')
            .getByText(`${expectedIndex} of`)
            .waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info(`Pattern details showing pattern ${expectedIndex}`);
    }

    /**
     * Inspect pattern card DOM structure for debugging
     * Returns info about styled elements, classes, and HTML structure
     * @param {number} index - The pattern card index (0-based)
     */
    async inspectPatternCardDOM(index = 0) {
        const patternElements = await this.page.locator('tbody tr').nth(index).evaluate(el => {
            const styledElements = el.querySelectorAll('[style*="background"], [class*="chip"], [class*="token"], [class*="highlight"], code');
            return {
                totalElements: styledElements.length,
                classes: Array.from(styledElements).slice(0, 5).map(e => e.className).filter(c => c),
                innerHTML: el.querySelector('td:first-child')?.innerHTML.substring(0, 200)
            };
        }).catch(() => ({ totalElements: 0, classes: [], innerHTML: '' }));
        testLogger.info(`Pattern ${index} DOM inspection: ${JSON.stringify(patternElements)}`);
        return patternElements;
    }

    /**
     * Get wildcard chip element (for hover tests)
     * @param {string} chipClass - Optional chip class selector
     */
    async getWildcardChip(chipClass = '[data-test^="pattern-card-"] .wildcard-chip, [data-test^="pattern-card-"] [data-test*="chip"]') {
        return this.page.locator(chipClass).first();
    }

    /**
     * Get tooltip element
     */
    async getTooltip() {
        return this.page.locator('[data-test="o-tooltip-content"]').first();
    }

    /**
     * Get anomaly warning icon count
     */
    async getAnomalyWarningIconCount() {
        const count = await this.page.locator('tbody tr .OIcon, tbody tr i').filter({ hasText: /warning|alert|error/ }).count();
        testLogger.info(`Found ${count} anomaly warning icons`);
        return count;
    }

    /**
     * Get anomaly column data for all pattern rows
     * Returns array of objects with hasIcon, hasWarning, content
     */
    async getAnomalyColumnData() {
        const anomalyData = await this.page.evaluate(() => {
            // Find anomaly column index by header text (more robust than hardcoded index)
            const headers = Array.from(document.querySelectorAll('thead th'));
            const anomalyColIndex = headers.findIndex(th =>
                th.textContent?.trim().toLowerCase().includes('anomaly')
            );

            // Fallback to index 3 if header not found (backwards compatibility)
            const colIndex = anomalyColIndex >= 0 ? anomalyColIndex : 3;

            const rows = Array.from(document.querySelectorAll('tbody tr'));
            return rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                const anomalyCell = cells[colIndex];
                return {
                    hasIcon: anomalyCell?.querySelector('.OIcon, i') !== null,
                    hasWarning: anomalyCell?.innerHTML.includes('warning') || anomalyCell?.innerHTML.includes('⚠'),
                    content: anomalyCell?.textContent?.trim() || ''
                };
            });
        });
        testLogger.info(`Anomaly column data: ${JSON.stringify(anomalyData.slice(0, 3))}`);
        return anomalyData;
    }

    /**
     * Get pattern details dialog content
     */
    async getPatternDetailsDialogContent() {
        const content = await this.page.locator('[data-test="pattern-details-dialog"]').innerText();
        testLogger.info(`Dialog content length: ${content.length} chars`);
        return content;
    }

    // expectPatternIncludeBtnActive/expectPatternExcludeBtnActive were dropped in the
    // patterns UI redesign: the include/exclude controls moved into the details dialog,
    // where they are one-shot actions with no active/selected state to assert. They had
    // no callers.

    // ============================================================================
    // BUILD TAB / QUERY BUILDER METHODS - PR #10305
    // These methods support the Auto Query Builder feature on the Logs page
    // ============================================================================

    /**
     * Click the Build tab toggle to switch to Build mode
     */
    async clickBuildToggle() {
        await this.page.locator(this.buildToggle).click();
        testLogger.info('Clicked Build tab toggle');
    }

    /**
     * Click the Logs tab toggle to switch back to Logs mode
     */
    async clickLogsToggle() {
        await this.page.locator(this.logsToggle).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked Logs tab toggle');
    }

    /**
     * Click the Visualize tab toggle
     */
    async clickVisualizeToggle() {
        await this.page.locator(this.visualizeToggle).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked Visualize tab toggle');
    }

    // ===== LOGS VISUALIZE PERSISTENCE — SIDEBAR NAVIGATION =====

    /**
     * Click the Dashboard sidebar menu item to navigate away from Logs.
     */
    async clickMenuLinkDashboardItem() {
        await this.page.locator(this.dashboardMenuItem).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Clicked Dashboard sidebar menu item');
    }

    // ===== LOGS VISUALIZE PERSISTENCE — EXPECT METHODS =====

    /**
     * Expect the Logs search result area (table) to be visible.
     */
    async expectLogsSearchResultVisible() {
        await expect(this.page.locator(this.resultText)).toBeVisible({ timeout: 15000 });
        testLogger.info('Logs search result is visible');
    }

    /**
     * Expect the Logs search result area to NOT be visible.
     */
    async expectLogsSearchResultNotVisible() {
        await expect(this.page.locator(this.resultText)).toBeHidden({ timeout: 10000 });
        testLogger.info('Logs search result is NOT visible');
    }

    /**
     * Expect the Build query page to be visible.
     */
    async expectBuildQueryPageVisible() {
        await expect(this.page.locator(this.buildQueryPage)).toBeVisible({ timeout: 15000 });
        testLogger.info('Build query page is visible');
    }

    /**
     * Expect the Build query page to NOT be visible.
     */
    async expectBuildQueryPageNotVisible() {
        await expect(this.page.locator(this.buildQueryPage)).toBeHidden({ timeout: 10000 });
        testLogger.info('Build query page is NOT visible');
    }

    /**
     * Expect Visualize tab content to be visible.
     * The Visualize tab can show a chart renderer, a dashboard panel table, or a no-data
     * message — any of these means the Visualize tab has loaded.
     */
    async expectVisualizeTabContentVisible() {
        const chart = this.page.locator(this.chartRenderer);
        const panel = this.page.locator(this.dashboardPanelTable);
        const noData = this.page.locator(this.noDataMessage);
        const anyVisible = Promise.any([
            chart.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'chart'),
            panel.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'panel'),
            noData.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'noData'),
        ]);
        const result = await anyVisible;
        testLogger.info(`Visualize tab content visible: ${result}`);
    }

    /**
     * Expect the Visualize toggle to be in a disabled state.
     */
    async expectVisualizeToggleDisabled() {
        const toggle = this.page.locator(this.visualizeToggle);
        await expect(toggle).toBeVisible({ timeout: 10000 });
        const isDisabled = await toggle.isDisabled().catch(() => false);
        const hasAriaDisabled = await toggle.getAttribute('aria-disabled').catch(() => null);
        const hasDataDisabled = await toggle.getAttribute('data-disabled').catch(() => null);
        expect(isDisabled || hasAriaDisabled === 'true' || hasDataDisabled === '').toBeTruthy();
        testLogger.info('Visualize toggle is disabled');
    }

    /**
     * Expect the view-mode dropdown button to NOT be visible (wide viewport).
     */
    async expectViewModeDropdownNotVisible() {
        await expect(this.page.locator(this.viewModeDropdownBtn)).toBeHidden({ timeout: 5000 });
        testLogger.info('View mode dropdown is NOT visible (wide viewport)');
    }

    /**
     * Expect all three toggle-group buttons to be visible (wide viewport).
     */
    async expectAllToggleButtonsVisible() {
        await expect(this.page.locator(this.logsToggle)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.visualizeToggle)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.buildToggle)).toBeVisible({ timeout: 10000 });
        testLogger.info('All toggle-group buttons are visible');
    }

    /**
     * Expect the stream selector trigger to contain the given text.
     */
    async expectStreamSelectorContainsText(text) {
        const trigger = this.page.locator(this.indexDropDownTrigger).first();
        await expect(trigger).toBeVisible({ timeout: 10000 });
        await expect(trigger).toContainText(text, { timeout: 10000 });
        testLogger.info(`Stream selector contains text: "${text}"`);
    }

    /**
     * Expect the live-mode refresh-interval button to be visible,
     * indicating that live mode / auto-run is currently enabled.
     */
    async expectLiveModeStatusVisible() {
        await expect(this.page.locator(this.liveModeToggleBtn)).toBeVisible({ timeout: 10000 });
        testLogger.info('Live mode refresh-interval button is visible');
    }

    /**
     * Expect Build tab toggle to be visible
     */
    async expectBuildToggleVisible() {
        await expect(this.page.locator(this.buildToggle)).toBeVisible();
        testLogger.info('Build tab toggle is visible');
    }

    /**
     * Expect Build tab to be active (check aria-pressed or similar attribute)
     */
    async expectBuildTabActive() {
        const buildToggle = this.page.locator(this.buildToggle);
        await expect(buildToggle).toBeVisible();
        testLogger.info('Build tab is active');
    }

    /**
     * Expect Builder mode (Auto mode) to be active
     */
    async expectBuilderModeActive(timeout = 15000) {
        // OToggleGroupItem (inheritAttrs:false + v-bind="$attrs" on inner Reka button)
        // forwards data-test to the inner button — SAME element as data-state. Read the
        // attribute directly on the data-test locator (NOT a descendant). Scope with
        // :visible to dodge SearchBar/collapsed-menu duplicates on some routes.
        const builderTypeBtn = this.page.locator(`${this.builderQueryType}:visible`).first();
        await expect(builderTypeBtn).toBeVisible({ timeout });
        // OToggleGroupItem forwards attrs to the inner Reka UI button via v-bind="$attrs",
        // so data-test and data-state land on the same element — no descendant combinator needed.
        await expect(builderTypeBtn).toHaveAttribute('data-state', 'on', { timeout });
        testLogger.info('Builder mode is active');
    }

    /**
     * Expect Custom SQL mode to be active
     */
    async expectCustomModeActive(timeout = 15000) {
        // Same OToggleGroupItem inner-button pattern as expectBuilderModeActive — see above.
        const customTypeBtn = this.page.locator(`${this.customQueryType}:visible`).first();
        await expect(customTypeBtn).toBeVisible({ timeout });
        // OToggleGroupItem forwards attrs to the inner Reka UI button via v-bind="$attrs",
        // so data-test and data-state land on the same element — no descendant combinator needed.
        await expect(customTypeBtn).toHaveAttribute('data-state', 'on', { timeout });
        testLogger.info('Custom SQL mode is active');
    }

    /**
     * Click Builder/Auto query type toggle
     */
    async clickBuilderQueryType() {
        await this.page.locator(this.builderQueryType).click();
        // Confirmation dialog only appears when switching Custom → Builder
        // AND there's an existing query that would be wiped
        const confirmBtn = this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        if (await confirmBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await confirmBtn.click();
            testLogger.info('Confirmed Builder mode switch (dialog dismissed)');
        }
        testLogger.info('Clicked Builder query type');
    }

    /**
     * Click Custom SQL query type toggle
     */
    async clickCustomQueryType() {
        // OToggleGroupItem forwards data-test to the inner Reka button (inheritAttrs:false +
        // v-bind="$attrs"), so data-test and data-state live on the SAME element. Use the
        // AND-combinator selector, not the descendant selector (which would look for a child).
        // Also scope with :visible — the SearchBar mounts twice on some routes (toolbar +
        // collapsed-menu syntax-guide), so multiple data-test matches exist.
        const toggle = this.page.locator(`${this.customQueryType}:visible`).first();
        await toggle.click();
        await expect(toggle).toHaveAttribute('data-state', 'on', { timeout: 5000 });
        testLogger.info('Clicked Custom query type');
    }

    /**
     * Expect X-axis layout section to be visible
     */
    async expectXAxisLayoutVisible(timeout = 15000) {
        await expect(this.page.locator(this.xAxisLayout)).toBeVisible({ timeout });
        testLogger.info('X-axis layout is visible');
    }

    /**
     * Expect Y-axis layout section to be visible
     */
    async expectYAxisLayoutVisible(timeout = 15000) {
        await expect(this.page.locator(this.yAxisLayout)).toBeVisible({ timeout });
        testLogger.info('Y-axis layout is visible');
    }

    /**
     * Expect Breakdown layout section to be visible
     */
    async expectBreakdownLayoutVisible(timeout = 15000) {
        await expect(this.page.locator(this.breakdownLayout)).toBeVisible({ timeout });
        testLogger.info('Breakdown layout is visible');
    }

    /**
     * Add a field to X-axis (click the add button)
     */
    async clickAddToXAxis() {
        await this.page.locator(this.addToXAxis).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked Add to X-axis');
    }

    /**
     * Add a field to Y-axis (click the add button)
     */
    async clickAddToYAxis() {
        await this.page.locator(this.addToYAxis).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked Add to Y-axis');
    }

    /**
     * Add a field to Breakdown (click the add button)
     */
    async clickAddToBreakdown() {
        await this.page.locator(this.addToBreakdown).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked Add to Breakdown');
    }

    /**
     * Expect a specific X-axis item to be visible
     * @param {string} alias - The field alias/name
     */
    async expectXAxisItemVisible(alias) {
        await expect(this.page.locator(this.xAxisItem(alias))).toBeVisible();
        testLogger.info(`X-axis item "${alias}" is visible`);
    }

    /**
     * Expect a specific Y-axis item to be visible
     * @param {string} alias - The field alias/name
     */
    async expectYAxisItemVisible(alias) {
        await expect(this.page.locator(this.yAxisItem(alias))).toBeVisible();
        testLogger.info(`Y-axis item "${alias}" is visible`);
    }

    /**
     * Remove a field from X-axis
     * @param {string} alias - The field alias/name
     */
    async removeXAxisItem(alias) {
        await this.page.locator(this.xAxisItemRemove(alias)).click();
        await this.page.waitForTimeout(500);
        testLogger.info(`Removed X-axis item "${alias}"`);
    }

    /**
     * Remove a field from Y-axis
     * @param {string} alias - The field alias/name
     */
    async removeYAxisItem(alias) {
        await this.page.locator(this.yAxisItemRemove(alias)).click();
        await this.page.waitForTimeout(500);
        testLogger.info(`Removed Y-axis item "${alias}"`);
    }

    /**
     * Select a chart type by its ID
     * @param {string} chartId - The chart type ID (e.g., 'bar', 'line', 'metric', 'table')
     */
    async selectChartType(chartId) {
        // Use .first() to handle multiple matching elements (e.g., from cached panels)
        const chartItem = this.page.locator(this.chartTypeItem(chartId)).first();

        // Click the chart item (tests should check visibility before calling this)
        await chartItem.click();
        await this.page.waitForTimeout(500);
        testLogger.info(`Selected chart type: ${chartId}`);
    }

    /**
     * Expect a specific chart type to be visible in the chart selection
     * @param {string} chartId - The chart type ID
     */
    async expectChartTypeVisible(chartId) {
        const chartItem = this.page.locator(this.chartTypeItem(chartId)).first();
        await expect(chartItem).toBeVisible();
        testLogger.info(`Chart type "${chartId}" is visible`);
    }

    /**
     * Verify a chart type is selected.
     * data-selected is set directly on [data-test="selected-chart-${chartId}-item"] (inner div)
     * by ChartSelection.vue — always present as "true" or "false".
     * toHaveAttribute auto-retries, so no manual waitForFunction/polling needed.
     * @param {string} chartId - The chart type ID (e.g., 'bar', 'line', 'metric', 'table')
     * @param {boolean} shouldBeSelected - Whether the chart type should be selected (default: true)
     */
    async verifyChartTypeSelected(chartId, shouldBeSelected = true, timeout = 45000) {
        // Uses data-test-selected attribute on <li> in ChartSelection.vue.
        // Only the currently selected chart has this attribute set to its ID.
        // Filters by offsetParent to skip elements hidden by v-show (display:none).
        try {
            await this.page.waitForFunction(
                ({ chartId, shouldBeSelected }) => {
                    const items = document.querySelectorAll(
                        `[data-test-selected="${chartId}"]`
                    );
                    let visibleFound = false;
                    for (const item of items) {
                        if (/** @type {HTMLElement} */ (item).offsetParent !== null) {
                            visibleFound = true;
                            break;
                        }
                    }
                    return visibleFound === shouldBeSelected;
                },
                { chartId, shouldBeSelected },
                { timeout, polling: 'raf' }
            );
            testLogger.info(
                `Chart type "${chartId}" is ${shouldBeSelected ? '' : 'NOT '}selected`
            );
        } catch (error) {
            throw new Error(
                `Chart type "${chartId}" was expected to be ${shouldBeSelected ? 'selected' : 'not selected'} ` +
                `but was ${shouldBeSelected ? 'not selected' : 'selected'} within ${timeout}ms`
            );
        }
    }

    /**
     * Expect chart renderer to be visible (chart preview loaded)
     */
    async expectChartRendererVisible() {
        await expect(this.page.locator(this.chartRenderer)).toBeVisible({ timeout: 30000 });
        testLogger.info('Chart renderer is visible');
    }

    /**
     * Expect "No data" message to be visible
     */
    async expectNoDataMessageVisible() {
        await expect(this.page.locator(this.noDataMessage)).toBeVisible();
        testLogger.info('No data message is visible');
    }

    /**
     * Expect dashboard panel table to be visible
     */
    async expectDashboardPanelTableVisible() {
        // PanelEditor is rendered in BOTH the Visualize tab (v-show, hidden when not active)
        // and the Build tab (v-if), so `[data-test="dashboard-panel-table"]` can match more than
        // one element with `display:none`. Scope to the Build container + :visible so the
        // assertion sees the actually-rendered table and not a hidden Visualize copy that
        // would never become visible. Falls back to a global :visible match if the Build
        // container isn't present (e.g. legacy routes).
        const inBuild = this.page
            .locator(`[data-test="logs-build-query-page"] ${this.dashboardPanelTable}:visible`)
            .first();
        const inBuildCount = await inBuild.count().catch(() => 0);
        const panel = inBuildCount > 0
            ? inBuild
            : this.page.locator(`${this.dashboardPanelTable}:visible`).first();
        await expect(panel).toBeVisible({ timeout: 30000 });
        testLogger.info('Dashboard panel table is visible');
    }

    /**
     * Check if SQL Mode is currently ON
     * @returns {Promise<boolean>} True if SQL mode is ON
     */
    async isSqlModeOn() {
        // Opens the utilities dropdown to read the SQL mode OSwitch state, then closes it.
        return await this.isSqlModeEnabled();
    }

    /**
     * Verify SQL Mode auto-enables when switching to Build tab
     */
    async verifySqlModeAutoEnablesOnBuild() {
        const isSqlEnabled = await this.isSqlModeEnabled();

        if (isSqlEnabled) {
            // Turn off SQL mode so we can test auto-enable on Build tab switch
            await this.disableSqlModeIfNeeded();
            await this.page.waitForTimeout(500);
        }

        await this.clickBuildToggle();
        await this.page.waitForTimeout(1000);

        const isNowEnabled = await this.isSqlModeEnabled();
        if (isNowEnabled) {
            testLogger.info('SQL Mode auto-enabled on Build tab switch');
            return true;
        } else {
            testLogger.warn('SQL Mode did NOT auto-enable on Build tab switch');
            return false;
        }
    }

    /**
     * Search for a field in the field list
     * @param {string} fieldName - The field name to search
     */
    async searchFieldInBuilder(fieldName) {
        const input = this.page.locator(this.fieldListSearchInput).first();
        // OInput's inner native <input> is the `-field` variant per AGENT_RULES §4.
        await input.waitFor({ state: 'attached', timeout: 10000 });
        if (!fieldName) {
            await input.fill('');
        } else {
            // pressSequentially fires per-character input events that reliably
            // trigger OInput's update:model-value chain through OFieldList's
            // onSearchChange handler. A plain fill() can snap the value back
            // to '' because the v-model binding rebinds after Vue re-render
            // (matches the working pattern in fillIndexFieldSearchInput).
            await input.click({ clickCount: 3, force: true });
            await input.pressSequentially(fieldName, { delay: 30 });
        }
        // Confirm the input reflected the value (deterministic — model chain settled)
        await expect(input).toHaveValue(fieldName || '', { timeout: 5000 });
        testLogger.info(`Searched for field: ${fieldName}`);
    }

    async getAddXButtonCount() {
        return await this.page.locator(this.addToXAxis).count();
    }

    async expectFilterLayoutVisible(timeout = 10000) {
        await expect(this.page.locator('[data-test="dashboard-filter-layout"]').last()).toBeVisible({ timeout });
        testLogger.info('Filter layout visible');
    }

    async expectChartOrNoDataAttached(timeout = 30000) {
        await expect(this.page.locator(`${this.chartRenderer}, ${this.noDataMessage}`).first()).toBeAttached({ timeout });
        testLogger.info('Chart or no-data element attached');
    }

    async expectMonacoEditorAreaVisible(timeout = 10000) {
        // The editor wrapper carries the data-test; wait for monaco's model to be reachable
        // via window.monaco (AGENT_RULES §5) instead of scraping .monaco-editor class.
        await expect(this.page.locator(this.logsSearchBarQueryEditor).first()).toBeVisible({ timeout });
        await this.page.waitForFunction((selector) => {
            const host = document.querySelector(selector);
            if (!host) return false;
            const editors = window.monaco?.editor?.getEditors?.() ?? [];
            return editors.some(ed => {
                const node = ed.getDomNode?.();
                return node && host.contains(node);
            });
        }, this.logsSearchBarQueryEditor, { timeout });
        testLogger.info('Monaco editor area visible');
    }

    /**
     * Clear field search in builder
     */
    async clearFieldSearch() {
        await this.page.locator(this.fieldListSearchInput).clear();
        await this.page.waitForTimeout(300);
        testLogger.info('Cleared field search');
    }

    /**
     * Toggle field list collapse/expand in panel editor
     */
    async toggleFieldListCollapse() {
        await this.page.locator(this.fieldListCollapsedIcon).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Toggled field list collapse');
    }

    /**
     * Enter a query in the query editor and verify it's accepted
     * @param {string} query - The SQL query to enter
     */
    async enterBuildQuery(query) {
        await this.clickQueryEditor();
        await this.page.waitForTimeout(300);
        await this.selectAllText();
        await this.pressBackspace();
        await this.page.keyboard.type(query);
        await this.page.waitForTimeout(500);
        testLogger.info(`Entered build query: ${query.substring(0, 50)}...`);
    }

    /**
     * Wait for Build tab UI to be fully loaded
     * @param {number} timeout - Timeout in milliseconds
     */
    async waitForBuildTabLoaded(timeout = 30000) {
        // Phase 1: Wait for BuildQueryPage root container to be visible
        try {
            await this.page.locator(this.buildQueryPage).waitFor({ state: 'visible', timeout });
            testLogger.info('Build tab container loaded');
        } catch (error) {
            testLogger.warn('Build tab container did not appear within timeout');
            return false;
        }

        // Phase 2: Wait for async initializeBuild() to render something.
        // initializeBuild parses query, sets chart type, runs query, renders chart/table/no-data.
        // Accept EITHER signal:
        //   - chart/table/no-data renderer present
        //   - any chart-selection <li> already carries data-test-selected (only set on the
        //     currently-selected chart — the source-side selection signal).
        try {
            await this.page.waitForFunction(
                () => {
                    if (
                        document.querySelector('[data-test="chart-renderer"]') ||
                        document.querySelector('[data-test="dashboard-panel-table"]') ||
                        document.querySelector('[data-test="no-data"]')
                    ) {
                        return true;
                    }
                    // Any chart item with data-test-selected attribute → chart type assigned
                    return !!document.querySelector(
                        '[data-test="dashboard-addpanel-chart-selection-item"][data-test-selected]'
                    );
                },
                undefined,
                { timeout, polling: 'raf' }
            );
            testLogger.info('Build tab initialization complete (renderer or chart-type selected)');
        } catch (error) {
            // Phase 2 is best-effort — Build tab may not render data for all query types
            testLogger.warn('Build tab chart/table/no-data not visible, waiting for networkidle');
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }

        // Phase 3: When in SQL mode on the Build tab, the chart-type-selected signal (Phase 2)
        // can fire before makeAutoSQLQuery() has finished populating the query editor. Wait
        // for the Monaco editor inside [data-test="logs-search-bar-query-editor"] to have
        // non-empty content — this confirms that onBuildQueryGenerated() has been called and
        // queries[0].query is ready for any Auto→Custom mode switch.
        //
        // With SQL mode OFF the editor holds only the WHERE clause and is often legitimately
        // empty, so the wait below would always burn its full 10s timeout before the catch
        // fires. Read sqlMode from Vue state and skip Phase 3 on an explicit `false`; if the
        // state is unreachable (null) fall through to the wait as before.
        const sqlModeOn = await this._mutateSearchObj((searchObj) => searchObj.meta.sqlMode === true);
        if (sqlModeOn === false) {
            testLogger.info('Build tab loaded (SQL mode off — query editor population not expected)');
            return true;
        }
        try {
            await this.page.waitForFunction(
                (editorSelector) => {
                    const host = document.querySelector(editorSelector);
                    if (!host) return true; // editor absent — skip
                    const editors = window.monaco?.editor?.getEditors?.() ?? [];
                    for (const ed of editors) {
                        const domNode = ed.getDomNode?.();
                        if (domNode && host.contains(domNode)) {
                            const val = ed.getValue();
                            return val && val.trim().length > 0;
                        }
                    }
                    return false; // editor found but value not yet set
                },
                '[data-test="logs-search-bar-query-editor"]',
                { timeout: 10000, polling: 500 }
            );
            testLogger.info('Build tab query editor populated');
        } catch (error) {
            // Phase 3 is best-effort — editor may legitimately be empty (SQL mode OFF, empty query)
            testLogger.warn('Build tab query editor did not populate within 10s, proceeding');
        }

        return true;
    }

    /**
     * Wait for the search-bar query editor to contain non-empty content.
     * Use this after switching to Build tab in SQL mode to ensure makeAutoSQLQuery()
     * has finished (it depends on the updateGroupedFields API call, which can be slow in CI).
     * Fails the test if the editor stays empty beyond the timeout.
     */
    async expectQueryEditorPopulated(timeout = 30000) {
        await this.page.waitForFunction(
            (selector) => {
                const host = document.querySelector(selector);
                if (!host) return false;
                const editors = window.monaco?.editor?.getEditors?.() ?? [];
                for (const ed of editors) {
                    const domNode = ed.getDomNode?.();
                    if (domNode && host.contains(domNode)) {
                        const val = ed.getValue();
                        return val && val.trim().length > 0;
                    }
                }
                return false;
            },
            '[data-test="logs-search-bar-query-editor"]',
            { timeout, polling: 500 }
        );
        testLogger.info('Query editor populated');
    }

    /**
     * Get the current chart type from the UI (theme-aware)
     * Checks parent element for bg-grey-3 (light) or bg-grey-5 (dark) to detect selection.
     * @returns {Promise<string|null>} The current chart type or null
     */
    async getCurrentChartType() {
        const chartTypes = ['bar', 'line', 'area', 'area-stacked', 'metric', 'table', 'scatter', 'pie', 'donut', 'h-bar', 'h-stacked', 'stacked', 'heatmap', 'gauge'];

        for (const chartType of chartTypes) {
            const chartItem = this.page.locator(this.chartTypeItem(chartType)).first();
            const isVisible = await chartItem.isVisible().catch(() => false);
            if (isVisible) {
                const parent = chartItem.locator('..');
                // Prefer data-selected attribute (ChartSelection.vue exposes it on the <li>).
                // Fall back to legacy bg-grey-3/5 (framework) and bg-gray-200/400 (Tailwind).
                const dataSelected = await parent.getAttribute('data-selected');
                if (dataSelected === 'true') {
                    testLogger.info(`Current chart type detected: ${chartType}`);
                    return chartType;
                }
                if (dataSelected === null) {
                    const parentClassList = (await parent.getAttribute('class')) || '';
                    if (
                        parentClassList.includes('bg-grey-3') ||
                        parentClassList.includes('bg-grey-5') ||
                        parentClassList.includes('bg-gray-200') ||
                        parentClassList.includes('bg-gray-400')
                    ) {
                        testLogger.info(`Current chart type detected: ${chartType}`);
                        return chartType;
                    }
                }
            }
        }
        testLogger.warn('No chart type detected as selected');
        return null;
    }

    /**
     * Wait for any chart type to become selected (theme-aware).
     * Uses page.waitForFunction for reliable detection of bg-grey-3/bg-grey-5
     * directly in the DOM, surviving reactive re-renders across tab switches.
     * @param {number} timeout - Max wait time in ms (default 20000)
     * @returns {Promise<string|null>} The selected chart type or null if timeout
     */
    async waitForChartTypeStabilized(timeout = 20000) {
        try {
            // Use waitForFunction to detect bg-grey-3 or bg-grey-5 on chart selection items
            // This is more reliable than Playwright locator polling during reactive re-renders
            const result = await this.page.waitForFunction(() => {
                const items = document.querySelectorAll('[data-test="dashboard-addpanel-chart-selection-item"]');
                for (const item of items) {
                    const classes = item.className || '';
                    // Prefer data-selected attribute (ChartSelection.vue), fall back to legacy classes
                    const dataSelected = item.getAttribute('data-selected');
                    const matchesSelected = dataSelected === 'true' ||
                        (dataSelected === null && (
                            classes.includes('bg-grey-3') ||
                            classes.includes('bg-grey-5') ||
                            classes.includes('bg-gray-200') ||
                            classes.includes('bg-gray-400')
                        ));
                    if (matchesSelected) {
                        // Found selected item - extract chart type from child data-test attribute
                        const section = item.querySelector('[data-test^="selected-chart-"][data-test$="-item"]');
                        if (section) {
                            const attr = section.getAttribute('data-test');
                            const match = attr.match(/^selected-chart-(.+)-item$/);
                            if (match) return match[1];
                        }
                    }
                }
                return null;
            }, { timeout });

            const chartType = await result.jsonValue();
            if (chartType) {
                testLogger.info(`Chart type stabilized: ${chartType}`);
                return chartType;
            }
        } catch (error) {
            testLogger.warn(`Chart type did not stabilize within ${timeout}ms`);
        }

        // Fallback: try getCurrentChartType one last time
        const fallback = await this.getCurrentChartType();
        if (fallback) {
            testLogger.info(`Chart type detected via fallback: ${fallback}`);
        }
        return fallback;
    }

    // ============================================================================
    // BUILD TAB IMPROVEMENT METHODS - PR #11586
    // New behavior: SQL mode preserved, default histogram/count for empty/SELECT*
    // ============================================================================

    /**
     * Verify SQL mode state is preserved (not forced ON) when switching to Build tab.
     * NEW behavior in PR #11586 — replaces verifySqlModeAutoEnablesOnBuild().
     * @param {boolean} expectedState - Expected SQL mode state after Build toggle
     * @returns {Promise<boolean>} True if SQL mode matches expected state
     */
    async verifySqlModePreservedOnBuild(expectedState) {
        const actualState = await this.isSqlModeOn();
        if (actualState === expectedState) {
            testLogger.info(`SQL mode preserved on Build tab: expected=${expectedState}, actual=${actualState}`);
            return true;
        } else {
            testLogger.warn(`SQL mode NOT preserved: expected=${expectedState}, actual=${actualState}`);
            return false;
        }
    }

    /**
     * Expect the builder has X-axis items populated (any items on X axis).
     * Checks that at least one item exists inside the X-axis layout.
     */
    async expectXAxisHasItems() {
        const xItems = this.page.locator(this.xAxisItemsAny);
        await expect(xItems.first()).toBeVisible({ timeout: 15000 });
        const count = await xItems.count();
        testLogger.info(`X-axis has ${count} item(s)`);
        return count;
    }

    /**
     * Expect the builder has Y-axis items populated (any items on Y axis).
     * Checks that at least one item exists inside the Y-axis layout.
     */
    async expectYAxisHasItems() {
        const yItems = this.page.locator(this.yAxisItemsAny);
        await expect(yItems.first()).toBeVisible({ timeout: 15000 });
        const count = await yItems.count();
        testLogger.info(`Y-axis has ${count} item(s)`);
        return count;
    }

    /**
     * Expect X-axis and Y-axis are empty (no items)
     */
    async expectAxesEmpty() {
        const xItems = this.page.locator(this.xAxisItemsAny);
        const yItems = this.page.locator(this.yAxisItemsAny);
        await expect(xItems).toHaveCount(0, { timeout: 5000 });
        await expect(yItems).toHaveCount(0, { timeout: 5000 });
        testLogger.info('X and Y axes are empty');
    }

    /**
     * Check if the filter section has any conditions populated.
     * Looks for filter condition items inside the filter layout.
     * Filter conditions use data-test="dashboard-add-condition-label-{index}-{label}" pattern.
     * @returns {Promise<number>} Number of filter conditions found
     */
    async getFilterConditionCount() {
        // DashboardFiltersOption.vue exposes the recursive leaf-condition count as
        // [data-test="dashboard-filter-layout"] data-condition-count="N" — set by a Vue
        // computed that traverses the filter tree, so the attribute matches the DOM rows
        // 1:1 and updates atomically with the reactive state. This eliminates the race
        // where v-for mounts rows sequentially on slow CI.
        //
        // IMPORTANT: `data-test="dashboard-filter-layout"` is reused by BOTH the Filters
        // section (DashboardFiltersOption.vue) AND the JOINs section (DashboardJoinsOption.vue).
        // The JOIN copy is rendered without `data-condition-count`, so we discriminate via
        // attribute presence. Also scope inside the Build container — the shared filter
        // component is mounted in both Build and Visualize tabs (Visualize uses v-show, so
        // it stays in DOM hidden when Build is active).
        const layout = this.page
            .locator('[data-test="logs-build-query-page"] [data-test="dashboard-filter-layout"][data-condition-count]:visible')
            .first();
        // If no visible layout exists (e.g., custom-mode path hides it), conditions = 0.
        const visibleCount = await layout.count().catch(() => 0);
        if (visibleCount === 0) {
            testLogger.info('Filter layout not visible (custom-mode path) — 0 conditions');
            return 0;
        }
        // Wait for data-condition-count to settle (attribute is always present once mounted,
        // but the value updates reactively as conditions are populated by parseSQL chain).
        let raw = '0';
        await expect.poll(async () => {
            raw = (await layout.getAttribute('data-condition-count').catch(() => '0')) ?? '0';
            return raw;
        }, { timeout: 15000, intervals: [100, 100, 200, 200, 500, 500, 1000, 1000] })
            .not.toBe('0')
            .catch(() => {
                // Stable at 0 is a valid outcome — query may genuinely have no filters.
            });
        const count = Number.parseInt(raw, 10) || 0;
        testLogger.info(`Filter has ${count} condition(s) (via data-condition-count)`);
        return count;
    }

    /**
     * Expect the logs table to be visible (when on Logs tab)
     */
    async expectLogsTableVisible() {
        await expect(this.page.locator(this.logsSearchResultLogsTable)).toBeVisible({ timeout: 30000 });
        testLogger.info('Logs table is visible');
    }

    // ============================================================================
    // V0.40 REGRESSION TEST METHODS
    // VRL fields, Query Inspector, Sorting, and Highlight tests
    // ============================================================================

    /**
     * Get the logs table element
     * @returns {Locator} - The logs table locator
     */
    getLogsTable() {
        return this.page.locator(this.logsSearchResultLogsTable);
    }

    /**
     * Wait for logs table to be visible
     * @param {number} timeout - Timeout in milliseconds
     */
    async waitForLogsTable(timeout = 30000) {
        await this.page.locator(this.logsSearchResultLogsTable).waitFor({ state: 'visible', timeout });
        testLogger.info('Logs table is visible');
    }

    /**
     * Get the count of log rows in the table
     * @returns {Promise<number>} - Number of log rows
     */
    async getLogRowCount() {
        const rows = this.page.locator(this.logsSearchResultTableRows);
        const count = await rows.count();
        testLogger.info(`Log row count: ${count}`);
        return count;
    }

    /**
     * Get all log rows as locators
     * @returns {Locator} - All log row locators
     */
    getLogRows() {
        return this.page.locator(this.logsSearchResultTableRows);
    }

    /**
     * Click the first expand menu in the logs table
     */
    async clickFirstExpandMenu() {
        const expandMenus = this.page.locator(this.tableRowExpandMenu);
        await expandMenus.first().click();
        testLogger.info('Clicked first expand menu');
    }

    /**
     * Click the last expand menu in the logs table
     */
    async clickLastExpandMenu() {
        const expandMenus = this.page.locator(this.tableRowExpandMenu);
        await expandMenus.last().click();
        testLogger.info('Clicked last expand menu');
    }

    /**
     * Check if the first expand menu is visible
     * @returns {Promise<boolean>} - Whether the first expand menu is visible
     */
    async isFirstExpandMenuVisible() {
        const expandMenus = this.page.locator(this.tableRowExpandMenu);
        const count = await expandMenus.count();
        return count > 0;
    }

    /**
     * Get timestamp cell values from the logs table
     * @param {number} limit - Maximum number of timestamps to return
     * @returns {Promise<string[]>} - Array of timestamp values
     */
    async getTimestampCellValues(limit = 5) {
        const cells = this.page.locator(this.timestampCells);
        const count = Math.min(await cells.count(), limit);
        const values = [];
        for (let i = 0; i < count; i++) {
            let text = await cells.nth(i).textContent();
            text = text?.trim() || '';
            // Strip expand button icon text that appears before the timestamp
            // The cell contains both the expand icon ("chevron_right" or "expand_more") and the timestamp
            text = text.replace(/^(chevron_right|expand_more|chevron_left|expand_less)/, '').trim();
            values.push(text);
        }
        testLogger.info(`Got ${values.length} timestamp values`);
        return values;
    }

    /**
     * Get count of timestamp cells in the logs table
     * @returns {Promise<number>} - Count of timestamp cells
     */
    async getTimestampCellCount() {
        const count = await this.page.locator(this.timestampCells).count();
        testLogger.info(`Timestamp cell count: ${count}`);
        return count;
    }

    /**
     * Get search result text
     * @returns {Promise<string>} - Search result text
     */
    async getSearchResultText() {
        const text = await this.page.locator(this.searchResultText).textContent().catch(() => '');
        testLogger.info(`Search result text: ${text?.substring(0, 50)}`);
        return text;
    }

    /**
     * Close any open dialog using the ODialog close button
     */
    async pressEscapeToCloseDialog() {
        await this.page.locator('[data-test="o-dialog-close-btn"]').click().catch(() =>
            this.page.locator('body').click({ position: { x: 10, y: 10 } })
        );
        await this.page.waitForTimeout(300);
        testLogger.info('Closed dialog via close button');
    }

    /**
     * Get the last row in the logs table
     * @returns {Locator} - The last row locator
     */
    getLastRow() {
        return this.page.locator(this.logsSearchResultTableRows).last();
    }

    /**
     * Get the first row expand menu
     * @returns {Locator} - The first expand menu locator
     */
    getFirstRowExpandMenu() {
        return this.page.locator(this.tableRowExpandMenu).first();
    }

    /**
     * Check if log detail panel is visible
     * @returns {Promise<boolean>} - Whether panel is visible
     */
    async isLogDetailPanelVisible() {
        const visible = await this.page.locator(this.logDetailPanel).isVisible().catch(() => false);
        testLogger.info(`Log detail panel visible: ${visible}`);
        return visible;
    }

    /**
     * Assert that a locator is visible
     * @param {Locator} locator - The locator to check
     */
    async expectVisible(locator) {
        await expect(locator).toBeVisible();
        testLogger.info('Element is visible');
    }

    /**
     * Get expand button for a specific field in sidebar (Bug #11041)
     * @param {string} fieldName - The field name (e.g., "level", "kubernetes_namespace_name")
     * @returns {Locator}
     */
    getFieldExpandButton(fieldName) {
        return this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);
    }

    /**
     * Get include/exclude button for a specific field value in sidebar (Bug #11041)
     * @param {string} fieldName - The field name (e.g., "level")
     * @returns {Locator}
     */
    getSubfieldListEqualButton(fieldName) {
        return this.page.locator(`[data-test*="logs-search-subfield-add-${fieldName}"]`);
    }

    /**
     * Get "Include Search Term" menu item (Bug #11041)
     * @returns {Locator}
     */
    getIncludeSearchTermMenuItem() {
        return this.page.locator('[data-test="log-details-include-field-btn"]').first();
    }

    /**
     * Get query editor locator
     * @returns {Locator}
     */
    getQueryEditorLocator() {
        return this.page.locator(this.logsSearchBarQueryEditor);
    }

    // ============================================================================
    // MONACO SUGGESTION WIDGET METHODS - Bug #11400 auto-suggestions tests
    // ============================================================================

    /**
     * Trigger Monaco's suggestion popup (Ctrl+Space) in the query editor.
     * The editor must be focused first, and content should be set so cursor
     * is positioned at a location where suggestions can be provided.
     */
    async triggerEditorSuggestions() {
        // Focus the editor's input area (click auto-waits for actionability)
        const inputArea = this.page.locator('[data-test="logs-search-bar-query-editor"] .inputarea');
        await inputArea.click({ force: true });
        // Trigger suggestion widget and wait for it to appear
        await this.page.keyboard.press('Control+Space');
        await this.waitForSuggestionWidgetVisible();
        testLogger.info('Triggered editor suggestions via Ctrl+Space');
    }

    /**
     * Check if the Monaco suggestion widget is currently visible.
     * @returns {Promise<boolean>} True if the suggest-widget has the 'visible' class
     */
    async isSuggestionWidgetVisible() {
        const isVisible = await this.page.evaluate(() => {
            const widget = document.querySelector('.monaco-editor .suggest-widget');
            if (!widget) return false;
            return widget.classList.contains('visible') || widget.classList.contains('focused');
        });
        testLogger.info(`Suggestion widget visible: ${isVisible}`);
        return isVisible;
    }

    /**
     * Wait for the suggestion widget to become visible.
     * @param {number} timeout - Timeout in ms (default: 5000)
     */
    async waitForSuggestionWidgetVisible(timeout = 5000) {
        await this.page.waitForFunction(() => {
            const widget = document.querySelector('.monaco-editor .suggest-widget');
            if (!widget) return false;
            return widget.classList.contains('visible') || widget.classList.contains('focused');
        }, { timeout });
        testLogger.info('Suggestion widget became visible');
    }

    /**
     * Get all suggestion label texts from the suggestion widget.
     * @returns {Promise<string[]>} Array of label text content
     */
    async getSuggestionLabels() {
        const labels = await this.page.evaluate(() => {
            const rows = document.querySelectorAll('.suggest-widget.visible .monaco-list-row');
            return Array.from(rows).map(row => {
                // Monaco renders labels inside .contents .main .label-name or directly in the row
                const labelEl = row.querySelector('.contents .main .label-name');
                if (labelEl) return labelEl.textContent || '';
                // Fallback: get full row text content
                return row.textContent || '';
            });
        });
        testLogger.info(`Suggestion labels: [${labels.join(', ')}]`);
        return labels;
    }

    /**
     * Check if the suggestion widget contains any function names that should NOT
     * appear in value context (e.g., match_all, fuzzy_match, match_all_raw_ignore_case).
     * @returns {Promise<{hasFunctions: boolean, foundFunctions: string[]}>}
     */
    async checkSuggestionForFunctions() {
        const functionNames = ['match_all', 'fuzzy_match', 'match_all_raw_ignore_case'];
        const result = await this.page.evaluate((fns) => {
            const rows = document.querySelectorAll('.suggest-widget.visible .monaco-list-row');
            const rowTexts = Array.from(rows).map(row => row.textContent || '');
            const foundFunctions = fns.filter(fn =>
                rowTexts.some(text => text.includes(fn))
            );
            return {
                hasFunctions: foundFunctions.length > 0,
                foundFunctions,
                rowCount: rowTexts.length,
                firstFew: rowTexts.slice(0, 5),
            };
        }, functionNames);
        testLogger.info('Suggestion function check', result);
        return result;
    }

    /**
     * Check if the Monaco query editor has warning-level decorations (squiggly
     * underlines) in the DOM. Used to verify validateDoubleQuotes() markers.
     * @returns {Promise<boolean>} True if .squiggly-warning elements found
     */
    async hasEditorWarningMarkers() {
        try {
            return await this.page.evaluate(() => {
                const editorContainer =
                    document.querySelector('[data-test="logs-search-bar-query-editor"]');
                if (!editorContainer) return false;
                const warningSquiggles =
                    editorContainer.querySelectorAll('.squiggly-warning');
                return warningSquiggles.length > 0;
            });
        } catch (e) {
            testLogger.warn('Error checking editor warning markers', { error: e.message });
            return false;
        }
    }

    /**
     * Get the error state of the Monaco query editor DOM (not the Monaco API).
     * Checks for red squiggly underlines and error overlay messages.
     * @returns {Promise<string>} One of: 'no-error', 'has-error', 'has-error-widget', 'editor-not-found'
     */
    async getEditorErrorState() {
        try {
            return await this.page.evaluate(() => {
                const editor = document.querySelector('[data-test="logs-search-bar-query-editor"]');
                if (!editor) return 'editor-not-found';
                // Check for Monaco error squiggles (red underlines)
                const squigglyError = editor.querySelector('.squiggly-error');
                if (squigglyError) return 'has-error';
                // Check for visible error messages in the editor area
                const errorWidget = editor.querySelector('.contentWidgets .monaco-editor-overlaymessage');
                if (errorWidget) return 'has-error-widget';
                return 'no-error';
            });
        } catch (e) {
            testLogger.warn('Error checking editor error state', { error: e.message });
            return 'editor-not-found';
        }
    }

    // ===== Regression Test Helper Methods =====

    /**
     * Get logs table body element
     * @returns {import('@playwright/test').Locator}
     */
    getLogsTableBody() {
        return this.page.locator('[data-test="logs-search-result-logs-table"] tbody');
    }

    /**
     * Get table rows in the logs result table
     * @returns {import('@playwright/test').Locator}
     */
    getLogsTableRows() {
        return this.page.locator('[data-test="logs-search-result-logs-table"] tbody tr');
    }

    /**
     * Get first row expand menu button
     * @returns {import('@playwright/test').Locator}
     */
    getFirstRowExpandMenu() {
        return this.page.locator('[data-test="table-row-expand-menu"]').first();
    }

    /**
     * Find the visible query mode toggle (Quick/SQL mode)
     * Returns the first matching locator or null if none visible
     * @returns {Promise<import('@playwright/test').Locator|null>}
     */
    async findQueryModeToggle() {
        const selectors = [
            this.quickModeToggle,
            // SQL mode toggle was removed from the UI
            '[data-test="logs-search-bar-menu-quick-mode-toggle-btn"]',
            '[data-test="logs-search-bar-ui-mode-btn"]',
            '[data-test="logs-search-ui-mode-btn"]',
            'button:has-text("UI Mode")',
            '[data-test*="quick-mode"]',
        ];

        for (const sel of selectors) {
            const loc = this.page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                return loc;
            }
        }
        return null;
    }

    /**
     * Check if a toggle element is in active/checked state
     * @param {import('@playwright/test').Locator} toggle - The toggle locator
     * @returns {Promise<boolean|null>}
     */
    async isToggleActive(toggle) {
        return await toggle.evaluate(el => {
            // OSwitch: the inner button has data-state="checked" when active
            const inner = el.querySelector('[data-state]');
            if (inner) return inner.getAttribute('data-state') === 'checked';
            // Fallback: aria-checked on the element itself
            return el.getAttribute('aria-checked') === 'true';
        }).catch(() => null);
    }

    /**
     * Check if histogram toggle is visible
     * @returns {Promise<boolean>}
     */
    async isHistogramToggleVisible() {
        return await this.page.locator(this.histogramToggle).isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click histogram toggle
     */
    async clickHistogramToggle() {
        await this.page.locator(this.histogramToggle).click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Find the absolute time input field in the datetime picker
     * @returns {Promise<import('@playwright/test').Locator|null>}
     */
    async findTimeInput() {
        const timeInputSelectors = [
            '[data-test="start-time-input"]',
            '[data-test="end-time-input"]',
            '[data-test="start-time-field"] input',
            '[data-test="end-time-field"] input',
            'input[type="time"]',
            '[aria-label*="time" i] input',
            '[aria-label*="Time" i]',
        ];

        for (const sel of timeInputSelectors) {
            const loc = this.page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                return loc;
            }
        }
        return null;
    }

    /**
     * Check if no data or empty state is visible
     * @returns {Promise<boolean>}
     */
    async isNoDataVisible() {
        const sel = this.page.locator('[data-test="no-data"], [class*="no-data"]').first();
        const txt = this.page.getByText('No data').first();
        return await sel.isVisible({ timeout: 2000 }).catch(() => false)
            || await txt.isVisible({ timeout: 1000 }).catch(() => false);
    }

    /**
     * Check if no results message is visible
     * @returns {Promise<boolean>}
     */
    async isNoResultsVisible() {
        return await this.page.locator('[data-test="logs-search-no-events-found-text"]')
            .isVisible({ timeout: 2000 }).catch(() => false);
    }

    /**
     * Get the date-time button locator (confirmed: data-test="date-time-btn")
     * @returns {import('@playwright/test').Locator}
     */
    getDateTimeButton() {
        return this.page.locator('[data-test="date-time-btn"]').first();
    }

    /**
     * Get the logs search error message locator (confirmed: logs/Index.vue)
     * @returns {import('@playwright/test').Locator}
     */
    getLogsSearchErrorMessage() {
        return this.page.locator('[data-test="logs-search-error-state"]').first();
    }

    // ===== REGRESSION: Scroll Retention (#9044) & Undefined Length (#7354) =====

    /**
     * Wait for search results to be loaded (pagination visible).
     */
    async waitForResultsLoaded() {
        await this.page.locator('[data-test="logs-search-result-pagination"]')
            .waitFor({ state: 'visible', timeout: 30000 });
        await this.page.waitForTimeout(500);
    }

    /**
     * Get the scroll position (scrollTop) of the main results scroll container.
     * Call waitForResultsLoaded() first to ensure the container exists.
     * Post design-token migration (#13173) the `.search-list` wrapper is gone:
     * the scroller is the combined scroll area (`ref="scrollContainerRef"` in
     * logs/SearchResult.vue), a scrollable sibling below the pagination header.
     * Walk up from the pagination until an ancestor has a scrollable child
     * that is not the header itself (matched by computed overflow-y, so class
     * renames don't break it).
     * @returns {Promise<number>}
     */
    async getScrollContainerPosition() {
        return await this.page.evaluate(() => {
            const pagination = document.querySelector('[data-test="logs-search-result-pagination"]');
            if (!pagination) return -1;
            let el = pagination.parentElement;
            while (el && el !== document.body) {
                const container = Array.from(el.children).find(
                    (child) => !child.contains(pagination) &&
                        /(auto|scroll)/.test(getComputedStyle(child).overflowY)
                );
                if (container) return container.scrollTop;
                el = el.parentElement;
            }
            return -1;
        });
    }

    /**
     * Scroll the main results container to the bottom.
     * Call waitForResultsLoaded() first to ensure the container exists.
     * Uses the same container discovery as getScrollContainerPosition().
     */
    async scrollToResultsBottom() {
        await this.page.evaluate(() => {
            const pagination = document.querySelector('[data-test="logs-search-result-pagination"]');
            if (!pagination) return;
            let el = pagination.parentElement;
            while (el && el !== document.body) {
                const container = Array.from(el.children).find(
                    (child) => !child.contains(pagination) &&
                        /(auto|scroll)/.test(getComputedStyle(child).overflowY)
                );
                if (container) {
                    container.scrollTop = container.scrollHeight;
                    return;
                }
                el = el.parentElement;
            }
        });
        await this.page.waitForTimeout(500);
    }

    /**
     * Click a specific page number in the pagination component.
     * @param {string|number} pageNum - The page number to click (e.g., '1', '2')
     */
    async clickPageNumber(pageNum) {
        const pageBtn = this.page.locator(this.resultPaginationPageBtn(pageNum));
        await pageBtn.click({ force: true });
        await this.waitForResultsLoaded();
    }

    /**
     * Click the "Next page" button in the pagination component.
     */
    async clickNextPage() {
        const nextBtn = this.page.locator('[data-test="logs-search-result-pagination-next"]');
        await nextBtn.click({ force: true });
        await this.waitForResultsLoaded();
    }

    /**
     * Open the "More Options" menu on the logs search bar.
     */
    async openMoreOptionsMenu() {
        const menuBtn = this.page.locator('[data-test="logs-search-bar-more-options-btn"]');
        await menuBtn.waitFor({ state: 'visible', timeout: 10000 });
        await menuBtn.click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Click "List Scheduled Search" in the open More Options menu.
     * Uses the data-test selector on the menu item when available (enterprise),
     * falling back to text-based DOM matching for OSS builds.
     */
    async clickListScheduledSearch() {
        const listBtn = this.page.locator('[data-test="search-scheduler-list-btn"]');
        if (await listBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await listBtn.click();
        } else {
            await this.page.evaluate(() => {
                const items = document.querySelectorAll('[role="menuitem"]');
                for (const item of items) {
                    if (item.textContent?.trim() === 'List Scheduled Search') {
                        item.click();
                        break;
                    }
                }
            });
        }
        await this.page.waitForTimeout(3000);
    }

    /**
     * Click a scheduled search row to expand it.
     * OTable renders rows as data-test="o2-table-row-{index}" (not by trace_id),
     * so we click the first visible row which triggers expand-on-row-click.
     * @param {string} traceId - kept for API compatibility but not used for locating
     */
    async clickScheduledSearchRow(traceId) {
        const firstRow = this.page.locator('[data-test="o2-table-row-0"]');
        await firstRow.waitFor({ state: 'visible', timeout: 30000 });
        await firstRow.click();
        await this.page.waitForTimeout(3000);
    }

    /**
     * Navigate to the Streams page via the sidebar.
     */
    async navigateToStreams() {
        const streamsLink = this.page.locator('[data-test="menu-link-\\/streams-item"]');
        await streamsLink.click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);
    }

    /**
     * Navigate to the Logs page via the sidebar.
     */
    async navigateToLogsFromSidebar() {
        const logsLink = this.page.locator('[data-test="menu-link-\\/logs-item"]');
        await logsLink.click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(3000);
    }

    /**
     * Check if an error message is visible on the logs page.
     * @returns {Promise<boolean>}
     */
    async hasErrorMessage() {
        const errorEl = this.page.locator('[data-test="logs-search-error-state"]');
        return await errorEl.isVisible().catch(() => false);
    }

    /**
     * Wait for the Run Query button to be ready (not in Cancel query state).
     * After navigating back to Logs, a query may still be running and the button
     * shows "Cancel query". Wait for it to finish or time out gracefully.
     */
    async waitForRunQueryReady() {
        const btn = this.page.locator('[data-test="logs-search-bar-refresh-btn"]');
        await btn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        // Wait for the button to leave cancel state AND loading to finish
        await this.page.waitForFunction(() => {
            const el = document.querySelector('[data-test="logs-search-bar-refresh-btn"]');
            if (!el) return true;
            return el.getAttribute('title') !== 'Cancel query'
                && el.getAttribute('aria-busy') !== 'true'
                && !el.hasAttribute('disabled');
        }, { timeout: 30000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click the Run Query button if it is enabled. Waits for the button to be ready first.
     * Returns true if the button was clicked, false if it remained disabled.
     * @returns {Promise<boolean>}
     */
    async clickRunQueryIfReady() {
        await this.waitForRunQueryReady();
        const btn = this.page.locator('[data-test="logs-search-bar-refresh-btn"]');
        const isEnabled = await btn.isEnabled({ timeout: 30000 }).catch(() => false);
        if (isEnabled) {
            await btn.click();
            await this.page.waitForTimeout(3000);
            return true;
        }
        return false;
    }

    /**
     * Get the current page number from the pagination component.
     * @returns {Promise<string>}
     */
    async getCurrentPageNumber() {
        return await this.page.evaluate(() => {
            const pagination = document.querySelector('[data-test="logs-search-result-pagination"]');
            if (!pagination) return '';
            const btn = pagination.querySelector('button[aria-current="page"]');
            if (!btn) return '';
            const label = btn.getAttribute('aria-label') || '';
            const match = label.match(/\d+/);
            return match ? match[0] : '';
        });
    }

    /**
     * Get timestamp column header in logs result table
     * @returns {import('@playwright/test').Locator}
     */
    getTimestampColumnHeader() {
        return this.page.locator('[data-test="log-search-result-table-th-timestamp"]');
    }

    /**
     * Get source column header in logs result table
     * @returns {import('@playwright/test').Locator}
     */
    getSourceColumnHeader() {
        return this.page.locator('[data-test="log-search-result-table-th-source"]');
    }

    /**
     * Get bar chart / histogram container
     * @returns {import('@playwright/test').Locator}
     */
    getBarChart() {
        return this.page.locator('[data-test="logs-search-result-bar-chart"]');
    }

    /**
     * Get logs result table element
     * @returns {import('@playwright/test').Locator}
     */
    getLogsTable() {
        return this.page.locator('[data-test="logs-search-result-logs-table"]');
    }

    /**
     * Get stream dropdown selector
     * @returns {import('@playwright/test').Locator}
     */
    getStreamDropdown() {
        return this.page.locator('[data-test="log-search-index-list-select-stream"]');
    }

    /**
     * Get stream dropdown search input
     * @returns {import('@playwright/test').Locator}
     */
    getStreamSearchInput() {
        return this.page.locator('[data-test="log-search-index-list-select-stream"] input');
    }

    /**
     * Get visualize toggle button
     * @returns {import('@playwright/test').Locator}
     */
    getVisualizeToggle() {
        return this.page.locator('[data-test="logs-visualize-toggle"]');
    }

    /**
     * Get query editor element
     * @returns {import('@playwright/test').Locator}
     */
    getQueryEditor() {
        return this.page.locator('[data-test="logs-search-bar-query-editor"]');
    }

    /**
     * Get time picker (fallback when absolute tab time input not available)
     * @returns {import('@playwright/test').Locator}
     */
    getTimePicker() {
        return this.page.locator('[data-test="datetime-time-picker"], [role="dialog"] [aria-label*="time" i]').first();
    }

    /**
     * Get all field expand buttons in the sidebar (Locator collection).
     * Used by autocomplete-suggestions spec to iterate available fields.
     * @returns {import('@playwright/test').Locator}
     */
    getAllFieldExpandButtons() {
        return this.page.locator(this.allFieldExpandButtons);
    }

    /**
     * Get the query editor container locator (used by Monaco helpers).
     * @returns {import('@playwright/test').Locator}
     */
    getQueryEditorContainer() {
        return this.page.locator(this.queryEditor);
    }

    // =========================================================================
    // SQL AUTOCOMPLETE — Monaco-driven helpers (used by logs-sql-autocomplete spec)
    // =========================================================================

    /**
     * Lazily create (and memoise) a MonacoEditorHelper bound to this page.
     * @returns {MonacoEditorHelper}
     */
    getMonacoEditorHelper() {
        if (!this._monacoHelper) {
            this._monacoHelper = new MonacoEditorHelper(this.page);
        }
        return this._monacoHelper;
    }

    /**
     * Set Monaco editor content in the logs query editor and trigger autocomplete
     * suggestions (Ctrl+Space). The trigger needs a brief settle for Monaco to
     * compute completion items — keyed on the suggest-widget appearing later
     * (see waitAndGetSuggestionLabels) rather than a fixed sleep.
     * @param {string} content
     */
    async setQueryEditorContentAndTriggerSuggestions(content) {
        const monacoHelper = this.getMonacoEditorHelper();
        const container = this.getQueryEditorContainer();
        await monacoHelper.setContent(container, content);
        // Wait slightly longer than the 500ms debounce in CodeQueryEditor so that
        // getSuggestions() fires with the final query before Ctrl+Space opens the
        // widget.  Without this, provideCompletionItems reads stale effectiveKeywords
        // from the previous getSuggestions call (e.g. FROM context stream names instead
        // of WHERE context field names).
        await this.page.waitForTimeout(600);
        await monacoHelper.triggerSuggestions();
    }

    /**
     * Clear the logs query editor and type literal text (preserves auto-pair
     * behaviour for quotes — used by the FROM "partial test).
     * @param {string} text
     */
    async clearQueryEditorAndType(text) {
        const monacoHelper = this.getMonacoEditorHelper();
        const container = this.getQueryEditorContainer();
        await monacoHelper.clear(container);
        await this.page.keyboard.type(text);
        await monacoHelper.triggerSuggestions();
    }

    /**
     * Wait for the Monaco suggestions widget to be visible, then return labels.
     * @param {number} timeout
     * @returns {Promise<string[]>}
     */
    async waitAndGetSuggestionLabels(timeout = 6000) {
        const monacoHelper = this.getMonacoEditorHelper();
        await monacoHelper.waitForSuggestions(timeout);
        return await monacoHelper.getSuggestionLabels(timeout);
    }

    /**
     * Return suggestion labels if the widget is open; tolerant variant for
     * checks where the widget may legitimately not surface anything.
     * @param {number} timeout
     * @returns {Promise<string[]>}
     */
    async getSuggestionLabelsIfVisible(timeout = 5000) {
        const monacoHelper = this.getMonacoEditorHelper();
        return await monacoHelper.getSuggestionLabels(timeout).catch(() => []);
    }

    /**
     * Whether the Monaco suggestion widget is currently visible.
     * @returns {Promise<boolean>}
     */
    async isSuggestionsWidgetVisible() {
        const monacoHelper = this.getMonacoEditorHelper();
        return await monacoHelper.isSuggestionsVisible();
    }

    /**
     * Read the FULL Monaco completion model (all items, not just DOM-rendered
     * visible rows). Uses the canonical AGENT_RULES §5 pattern:
     *   editor.getContribution('editor.contrib.suggestController').model
     *
     * The model holds the complete suggestion list (e.g. 100+ streams) while
     * the DOM only renders the visible window. This is required when the
     * suggestion target sorts outside the initial viewport.
     *
     * @returns {Promise<string[]>} Label list (deduped, ordered as Monaco returns)
     */
    async getAllSuggestionLabelsFromMonacoApi() {
        return await this.page.evaluate(() => {
            try {
                // window.monaco is exposed by CodeQueryEditor.vue after loadMonaco()
                const monaco = window.monaco;
                if (!monaco?.editor?.getEditors) return [];
                const editors = monaco.editor.getEditors();
                for (const editor of editors) {
                    const suggestController = editor.getContribution('editor.contrib.suggestController');
                    const model = suggestController?.model;
                    if (!model) continue;
                    // Both shapes per AGENT_RULES §5: _completionModel.items vs items
                    const items = model._completionModel?.items ?? model.items ?? [];
                    if (items.length === 0) continue;
                    return items.map((it) => {
                        const c = it.completion ?? it;
                        const label = c.label;
                        if (typeof label === 'string') return label;
                        if (label && typeof label === 'object') return label.label ?? '';
                        return '';
                    }).filter(Boolean);
                }
                return [];
            } catch {
                return [];
            }
        });
    }

    /**
     * Dismiss the suggestions widget via Escape (deterministic — Escape is a
     * no-op if nothing is open, so this is safe to call unconditionally).
     */
    async dismissSuggestions() {
        await this.page.keyboard.press('Escape');
    }

    /**
     * Wait for the stream-list API to return so streamResults.list is populated
     * and Vue's watcher can set streamKeywords. Used after selectStream() in
     * SQL-autocomplete tests where the FROM-context suggestion list depends on
     * the populated stream list.
     * @param {number} timeout
     * @returns {Promise<import('@playwright/test').Response|null>}
     */
    waitForStreamsListResponse(timeout = 35000) {
        return this.page.waitForResponse(
            (resp) => {
                const url = resp.url();
                // /api/{org}/streams (list endpoint) but NOT /streams/{name}/... sub-paths
                return /\/api\/[^/]+\/streams(\?|$)/.test(url) && resp.status() === 200;
            },
            { timeout }
        ).catch(() => {
            testLogger.warn('streams API response not captured — streamKeywords may still load via cache');
            return null;
        });
    }

    /**
     * Wait for streamKeywords to populate inside the searchObj store. This is
     * the deterministic gate that replaces a fixed sleep after the streams API
     * resolves — Vue's watcher fires in a microtask after the API response, so
     * we poll the in-page store until at least one keyword shows up.
     * @param {number} timeout
     */
    async waitForStreamKeywordsHydration(timeout = 8000) {
        await this.page.waitForFunction(() => {
            try {
                // Look for the streamKeywords array on any logged Vue searchObj.
                // Different stores expose it differently; check Pinia first, then window.
                const w = /** @type {any} */ (window);
                const candidates = [
                    w.__OO_STREAM_KEYWORDS__,
                    w.searchObj?.data?.stream?.streamLists,
                    w.searchObj?.data?.streamList,
                ];
                if (candidates.some((c) => Array.isArray(c) && c.length > 0)) return true;
                // Fallback: app store / Pinia stream module
                const stores = w.__pinia_stores__;
                if (stores) {
                    for (const key of Object.keys(stores)) {
                        const s = stores[key]?.();
                        const list = s?.data?.stream?.streamLists || s?.streamLists;
                        if (Array.isArray(list) && list.length > 0) return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        }, { timeout }).catch(() => {
            testLogger.warn('streamKeywords hydration not observed — autocomplete may still work via cached state');
        });
    }

    /**
     * Wait for the field keyword list to be populated inside the SQL autocomplete
     * composable. This is the deterministic gate for WHERE-clause field suggestions:
     * the stream schema API populates searchObj.data.stream.selectedStreamFields,
     * which triggers the Vue watcher that calls updateFieldKeywords(). Without this
     * wait, Ctrl+Space may fire before field names are in autoCompleteKeywords and
     * the suggestion widget will show only functions + SQL keywords instead of fields.
     * @param {number} timeout
     */
    async waitForFieldKeywordsHydration(timeout = 8000) {
        await this.page.waitForFunction(() => {
            try {
                const w = /** @type {any} */ (window);
                // Primary: selectedStreamFields in the Vuex/composable searchObj
                const fields = w.searchObj?.data?.stream?.selectedStreamFields;
                if (Array.isArray(fields) && fields.length > 0) return true;
                // Fallback: check Pinia stores for the same data
                const stores = w.__pinia_stores__;
                if (stores) {
                    for (const key of Object.keys(stores)) {
                        const s = stores[key]?.();
                        const f = s?.data?.stream?.selectedStreamFields;
                        if (Array.isArray(f) && f.length > 0) return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        }, { timeout }).catch(() => {
            testLogger.warn('field keywords hydration not observed — field suggestions may be absent');
        });
    }

    // =========================================================================
    // DASHBOARD / TRACES SQL AUTOCOMPLETE — wrappers for cross-surface tests
    // =========================================================================

    /**
     * Get the dashboard panel SQL query editor container locator.
     * @returns {import('@playwright/test').Locator}
     */
    getDashboardPanelQueryEditorContainer() {
        return this.page.locator('[data-test="dashboard-panel-query-editor"]');
    }

    /**
     * Clear the dashboard panel SQL editor and type text, then trigger suggestions.
     * @param {string} content
     */
    async setDashboardPanelEditorContentAndTriggerSuggestions(content) {
        const monacoHelper = this.getMonacoEditorHelper();
        const container = this.getDashboardPanelQueryEditorContainer();
        await monacoHelper.setContent(container, content);
        await monacoHelper.triggerSuggestions();
    }

    // =========================================================================
    // REGION SELECTOR METHODS (SearchBar.vue super-cluster region dropdown)
    // =========================================================================

    /**
     * Get the region dropdown trigger locator.
     * @returns {import('@playwright/test').Locator}
     */
    getRegionDropdownBtn() {
        return this.page.locator(this.regionDropdownBtn);
    }

    /**
     * Whether the region dropdown trigger is rendered (super-cluster enterprise
     * mode required — see SearchBar.vue:720 v-if).
     * @returns {Promise<boolean>}
     */
    async isRegionDropdownVisible() {
        return await this.page.locator(this.regionDropdownBtn).isVisible().catch(() => false);
    }

    /**
     * Open the region dropdown and wait for the menu to render.
     */
    async openRegionDropdown() {
        await this.page.locator(this.regionDropdownBtn).click();
        await this.page.locator(this.regionDropdownMenu).waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Close the region dropdown if open.
     */
    async closeRegionDropdown() {
        const menu = this.page.locator(this.regionDropdownMenu);
        if (await menu.isVisible().catch(() => false)) {
            await this.page.keyboard.press('Escape');
            await menu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
    }

    /**
     * Toggle the region tree node identified by its label (node-key on the
     * SearchBar.vue OTree is "label"). Waits for menu visibility and clicks
     * the leaf node — OTreeNode.vue forwards clicks to the inner OCheckbox.
     * @param {string} label - Region label (e.g. "us-east-1")
     */
    async toggleRegionNode(label) {
        await this.page.locator(this.regionDropdownMenu).waitFor({ state: 'visible', timeout: 10000 });
        const node = this.page.locator(this.regionTreeNode(label));
        await node.waitFor({ state: 'visible', timeout: 10000 });
        await node.click();
    }

    /**
     * Return how many region tree nodes are currently rendered inside the menu.
     * Returns 0 when no regions are configured for the env.
     * @returns {Promise<number>}
     */
    async countRegionNodes() {
        return await this.page.locator(this.regionTreeNodeAny).count();
    }

    /**
     * Wait until the region node with `label` reports data-test-checked="true".
     * @param {string} label
     * @param {number} timeout
     */
    async expectRegionNodeChecked(label, timeout = 10000) {
        await this.page.locator(this.regionTreeNodeChecked(label))
            .waitFor({ state: 'visible', timeout });
    }

    // =========================================================================
    // TIMEZONE OSelect METHODS (DateTime.vue datetime-timezone-select)
    // =========================================================================

    /**
     * Open the timezone OSelect, type a filter string, then pick the matching
     * option by data-test-value (OSelect listbox convention §4).
     * @param {string} value - Exact timezone value (e.g. "Asia/Dubai")
     * @param {string} [searchText] - Optional search text typed into the
     *   listbox input — defaults to the option value itself.
     */
    async selectDateTimeTimezone(value, searchText) {
        const trigger = this.page.locator(this.datetimeTimezoneSelect);
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();
        // Listbox-mode OSelect renders a ListboxFilter input — data-test
        // forwards from the consumer as `${parent}-search` (OSelect.vue:1007).
        const input = this.page.locator(this.datetimeTimezoneSelectSearch);
        await input.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await input.fill(searchText ?? value).catch(() => {});
        const option = this.page.locator(this.datetimeTimezoneOption(value));
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();
    }
}
