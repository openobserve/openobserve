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
    :class="store.state.theme === 'dark' ? 'dark-theme' : ''"
    class="logs-search-bar-component"
    id="searchBarComponent"
  >
    <div class="tw:flex tw:m-0! tw:p-[0.375rem]! tw:items-center! tw:w-full tw:overflow-hidden tw:border-b tw:solid tw:border-b-[var(--o2-border-color)]">
      <div
        ref="toolbarLeftRef"
        class="tw:flex tw:items-center tw:gap-1 tw:flex-nowrap tw:flex-1 tw:min-w-0 tw:overflow-hidden"
      >
        <!-- View Mode: Dropdown when very narrow, Toggle Group otherwise -->
        <ODropdown v-if="toolbarToggleAsDropdown" side="bottom" align="start">
          <template #trigger>
            <OButton
              data-test="logs-view-mode-dropdown-btn"
              size="xs"
              variant="outline"
              icon-right="chevron-down"
            >
              <OIcon :name="currentToggleOption.icon" size="sm" class="tw:shrink-0" />
              {{ currentToggleOption.label }}
            </OButton>
          </template>
          <ODropdownItem
            v-for="opt in toggleViewOptions"
            :key="opt.value"
            :data-test="`logs-view-mode-${opt.value}-item`"
            :disabled="opt.disabled"
            @select="onLogsVisualizeToggleUpdate(opt.value)"
          >
            <template #icon-left><OIcon :name="opt.icon" size="sm" /></template>
            {{ opt.label }}
          </ODropdownItem>
        </ODropdown>

        <OToggleGroup
          v-else
          :model-value="searchObj.meta.logsVisualizeToggle"
          @update:model-value="onLogsVisualizeToggleUpdate($event)"
        >
          <OToggleGroupItem
            data-test="logs-logs-toggle"
            value="logs"
            size="sm"
            :tooltip="toolbarToggleIconOnly ? t('common.search') : undefined"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" class="tw:shrink-0" />
            </template>
            <span v-if="!toolbarToggleIconOnly">{{ t("common.search") }}</span>
          </OToggleGroupItem>

          <OToggleGroupItem
            v-if="store.state.zoConfig.timechart_enabled"
            data-test="logs-visualize-toggle"
            :disabled="isVisualizeDisabled"
            :tooltip="isVisualizeDisabled ? t('search.enableSqlModeOrSelectSingleStream') : toolbarToggleIconOnly ? t('search.visualize') : undefined"
            value="visualize"
            size="sm"
          >
            <template #icon-left>
              <OIcon name="timeline" size="sm" class="tw:shrink-0" />
            </template>
            <span v-if="!toolbarToggleIconOnly">{{ t("search.visualize") }}</span>
          </OToggleGroupItem>

          <OToggleGroupItem
            data-test="logs-build-toggle"
            value="build"
            size="sm"
            :tooltip="toolbarToggleIconOnly ? t('search.buildQuery') : undefined"
          >
            <template #icon-left>
              <OIcon name="build" size="sm" class="tw:shrink-0" />
            </template>
            <span v-if="!toolbarToggleIconOnly">{{ t("search.buildQuery") }}</span>
          </OToggleGroupItem>

          <OToggleGroupItem
            v-if="config.isEnterprise == 'true'"
            data-test="logs-patterns-toggle"
            value="patterns"
            size="sm"
            :tooltip="toolbarToggleIconOnly ? t('search.showPatternsLabel') : undefined"
          >
            <template #icon-left>
              <OIcon name="layers" size="sm" class="tw:shrink-0" />
            </template>
            <span v-if="!toolbarToggleIconOnly">{{ t("search.showPatternsLabel") }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
        <!-- reset filters button — moves into More menu at very narrow widths -->
        <OButton
          v-if="!toolbarMoveResetToMenu"
          data-test="logs-search-bar-reset-filters-btn"
          size="xs"
          variant="outline"
          @click="resetFilters"
        >
          <OIcon name="restart-alt" size="sm" />
          <span v-if="!shouldHideToolbarButtonText">{{ t("common.reset") }}</span>
          <OTooltip :content="t('search.resetFilters')" />
        </OButton>

        <!-- Histogram toggle — moves into More menu below 328px available width -->
        <OButton
          v-if="!shouldMoveButtonsToMenu"
          data-test="logs-search-bar-histogram-btn"
          size="xs"
          variant="outline"
          class="tw:gap-1.5"
          @click="searchObj.meta.showHistogram = !searchObj.meta.showHistogram"
        >
          <OSwitch
            v-model="searchObj.meta.showHistogram"
            size="md"
            @click.stop
          />
          <OIcon name="bar-chart" size="sm" class="tw:shrink-0" />
          <OTooltip :content="searchObj.meta.showHistogram ? t('search.hideHistogram') : t('search.showHistogramLabel')" />
        </OButton>

        <!-- this is the button group responsible for showing all the utilities -->
        <ODropdown side="bottom" align="start">
          <template #trigger>
            <OButton
              data-test="logs-search-bar-utilities-menu-btn"
              class="group-menu-btn element-box-shadow"
              icon-left="more-horiz"
              variant="outline"
              size="xs"
            >
              More
            </OButton>
          </template>

          <!-- SET ONCE — view controls that persist across sessions -->
          <ODropdownGroup :label="t('search.menuGroupSetOnce')">
            <!-- Reset filters (shown here only when toolbar is too narrow for inline button) -->
            <ODropdownItem
              v-if="toolbarMoveResetToMenu"
              data-test="logs-search-bar-menu-reset-btn"
              @select="resetFilters"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="restart-alt" size="sm" />
                </span>
              </template>
              {{ t("search.resetFilters") }}
            </ODropdownItem>

            <!-- Histogram (shown here only when toolbar is too narrow for inline button) -->
            <ODropdownItem
              v-if="shouldMoveButtonsToMenu"
              data-test="logs-search-bar-menu-histogram-btn"
              @select.prevent="searchObj.meta.showHistogram = !searchObj.meta.showHistogram"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="bar-chart" size="sm" />
                </span>
              </template>
              {{ t("search.showHistogramLabel") }}
              <template #icon-right>
                <OSwitch
                  v-model="searchObj.meta.showHistogram"
                  size="md"
                  data-test="logs-search-bar-show-histogram-toggle-btn"
                  class="tw:ml-auto"
                  @click.stop
                />
              </template>
            </ODropdownItem>

            <!-- Quick Mode — always in the More menu -->
            <ODropdownItem
              data-test="logs-search-bar-menu-quick-mode-toggle-btn"
              @select.prevent="handleQuickMode"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="bolt" size="sm" />
                </span>
              </template>
              {{ t("search.quickModeLabel") }}
              <template #icon-right>
                <OSwitch
                  :model-value="searchObj.meta.quickMode"
                  size="md"
                  data-test="logs-search-bar-quick-mode-switch"
                  class="tw:ml-auto"
                  @click.stop="handleQuickMode"
                />
              </template>
            </ODropdownItem>

            <!-- Function Editor -->
            <ODropdownItem
              data-test="logs-search-bar-menu-transform-editor-toggle-btn"
              @select.prevent="searchObj.meta.showTransformEditor = !searchObj.meta.showTransformEditor"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge more-menu-icon-badge--mono">fx</span>
              </template>
              {{ t('search.functionEditorLabel') }}
              <template #icon-right>
                <OSwitch
                  data-test="logs-search-bar-show-query-toggle-btn"
                  v-model="searchObj.meta.showTransformEditor"
                  size="md"
                  class="tw:ml-auto"
                  @click.stop
                />
              </template>
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <!-- SAVED VIEWS -->
          <ODropdownGroup :label="t('search.menuGroupSavedViews')">
            <ODropdownItem
              data-test="logs-search-bar-menu-list-saved-views-btn"
              @select="openSavedViewsList"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="format-list-bulleted" size="sm" />
                </span>
              </template>
              {{ t("search.listSavedViews") }}
            </ODropdownItem>

            <ODropdownItem
              data-test="logs-search-bar-menu-create-saved-view-btn"
              @select="fnSavedView"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="add" size="sm" />
                </span>
              </template>
              {{ t("search.createSavedView") }}
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <!-- SYNTAX GUIDE -->
          <SyntaxGuide
            :sqlmode="searchObj.meta.sqlMode"
            :menuItem="true"
            ref="syntaxGuideRef"
            data-test="logs-search-bar-syntax-guide-btn"
          />
        </ODropdown>
      </div>

      <div ref="toolbarRightRef" class="tw:flex tw:items-center tw:gap-1 tw:flex-shrink-0">
        <template v-if="searchObj.meta.showTransformEditor && !shouldMoveShareToMenu">
          <transform-selector
            v-if="isActionsEnabled"
            :function-options="functionOptions"
            :hide-toggle="true"
            @select:function="populateFunctionImplementation"
            @save:function="fnSavedFunctionDialog"
          />
          <function-selector
            v-else
            :function-options="functionOptions"
            :hide-toggle="true"
            @select:function="populateFunctionImplementation"
            @save:function="fnSavedFunctionDialog"
          />
        </template>
        <ODropdown
          side="bottom"
          align="start"
          @update:open="(open) => { if (!open) showDownloadSubmenu = false; }"
        >
          <template #trigger>
            <OButton
              data-test="logs-search-bar-more-options-btn"
              class="download-logs-btn tw:order-4"
              variant="outline"
              size="icon-toolbar"
            >
              <OIcon name="menu" size="sm" />
              <OTooltip style="width: 110px" :content="t('search.moreActions')" />
            </OButton>
          </template>

          <!-- Share Link -->
          <div v-if="shouldMoveShareToMenu" class="tw:p-2" data-test="logs-search-bar-menu-share-link-btn">
            <share-button
              :url="shareURL"
              variant="outline"
              size="sm-action"
              :show-label="true"
              class="tw:w-full"
            />
          </div>

          <ODropdownSeparator v-if="shouldMoveShareToMenu" />

          <!-- HISTORY -->
          <ODropdownGroup :label="t('search.menuGroupHistory')">
            <ODropdownItem
              data-test="search-history-item-btn"
              @select="showSearchHistoryfn"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="history" size="sm" />
                </span>
              </template>
              {{ t("search.searchHistory") }}
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <!-- DOWNLOADS -->
          <ODropdownGroup :label="t('search.menuGroupDownloads')">
            <!-- Download results — nested sub-dropdown (hover to open) -->
            <div
              data-test="search-download-submenu-trigger"
              class="search-download-item"
              :class="{ 'search-download-item--disabled': isDownloadDisabled }"
              :aria-disabled="isDownloadDisabled || undefined"
              @mouseenter="!isDownloadDisabled && (showDownloadSubmenu = true)"
              @mouseleave="showDownloadSubmenu = false"
            >
              <span class="more-menu-icon-badge search-download-item-icon">
                <OIcon size="sm" name="download" />
              </span>
              <span class="search-download-item-label">{{ t("search.downloadTable") }}</span>
              <OIcon size="sm" name="chevron-right" />

              <div
                v-if="showDownloadSubmenu && !isDownloadDisabled"
                class="search-download-submenu"
                data-test="search-download-submenu"
              >
                <button
                  type="button"
                  data-test="search-download-csv-btn"
                  class="search-download-submenu-item"
                  @click="downloadLogs(searchObj.data.queryResults.hits, 'csv'); showDownloadSubmenu = false"
                >
                  <OIcon name="grid-on" size="sm" />
                  <span class="tw:flex-1">{{ t("search.downloadCSV") }}</span>
                </button>
                <button
                  type="button"
                  data-test="search-download-json-btn"
                  class="search-download-submenu-item"
                  @click="downloadLogs(searchObj.data.queryResults.hits, 'json'); showDownloadSubmenu = false"
                >
                  <OIcon name="data-object" size="sm" />
                  <span class="tw:flex-1">{{ t("search.downloadJSON") }}</span>
                </button>
              </div>
            </div>

            <ODropdownItem
              data-test="logs-search-bar-download-custom-range-btn"
              :disabled="isDownloadDisabled"
              @select="toggleCustomDownloadDialog"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <img
                    :src="customRangeIcon"
                    alt="Custom Range"
                    class="tw:w-4 tw:h-4"
                  />
                </span>
              </template>
              {{ t("search.customRange") }}
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <ODropdownGroup
            v-if="config.isEnterprise == 'true'"
            :label="t('search.menuGroupSchedule')"
          >
            <ODropdownItem
              v-if="config.isEnterprise == 'true'"
              data-test="search-scheduler-create-new-btn"
              @select="createScheduleJob"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <img
                    :src="createScheduledSearchIcon"
                    alt="Create Scheduled Search"
                    class="tw:w-4 tw:h-4"
                  />
                </span>
              </template>
              <span data-test="search-scheduler-create-new-label">
                {{ t("search.createScheduledSearch") }}
              </span>
            </ODropdownItem>

            <ODropdownItem
              v-if="config.isEnterprise == 'true'"
              data-test="search-scheduler-list-btn"
              @select="routeToSearchSchedule"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <img
                    :src="listScheduledSearchIcon"
                    alt="List Scheduled Search"
                    class="tw:w-4 tw:h-4"
                  />
                </span>
              </template>
              <span data-test="search-scheduler-list-label">
                {{ t("search.listScheduledSearch") }}
              </span>
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator v-if="config.isEnterprise == 'true'" />

          <ODropdownGroup
            v-if="
              config.isEnterprise == 'true' &&
              config.isCloud == 'false' &&
              store.state.zoConfig.search_inspector_enabled
            "
            :label="t('search.menuGroupInspect')"
          >
            <ODropdownItem
              data-test="search-inspect-btn"
              @select="openSearchInspectDialog"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="troubleshoot" size="sm" />
                </span>
              </template>
              <span data-test="search-inspect-label">Search Inspect</span>
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <ODropdownGroup
            v-if="searchObj.meta.sqlMode"
            :label="t('search.menuGroupExplain')"
          >
            <ODropdownItem
              data-test="logs-search-bar-explain-query-menu-btn"
              :disabled="
                !searchObj.data.query || searchObj.data.query.trim() === ''
              "
              @select="openExplainDialog"
            >
              <template #icon-left>
                <span class="more-menu-icon-badge">
                  <OIcon name="lightbulb" size="sm" />
                </span>
              </template>
              {{ t('search.explainQuery') }}
            </ODropdownItem>
          </ODropdownGroup>
        </ODropdown>
        <share-button
          v-if="!shouldMoveShareToMenu"
          data-test="logs-search-bar-share-link-btn"
          :url="shareURL"
          variant="outline"
          size="icon-toolbar"
          class="tw:order-3"
        />
        <div class="tw:mr-1 tw:order-1">
          <date-time
            ref="dateTimeRef"
            auto-apply
            menu-align="end"
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="logs-search-bar-date-time-dropdown"
            :queryRangeRestrictionMsg="
              searchObj.data.datetime.queryRangeRestrictionMsg
            "
            :queryRangeRestrictionInHour="
              searchObj.data.datetime.queryRangeRestrictionInHour
            "
            @on:date-change="updateDateTime"
            @on:timezone-change="updateTimezone"
            :disable="disable"
            class="element-box-shadow"
          />
        </div>
        <div class="search-time tw:order-2">
          <div class="tw:flex">
            <OButtonGroup
              class="tw:p-0 tw:mr-1 element-box-shadow el-border"
              v-if="
                config.isEnterprise == 'true' &&
                Object.keys(store.state.regionInfo).length > 0 &&
                store.state.zoConfig.super_cluster_enabled
              "
            >
              <ODropdown
                side="bottom"
                align="start"
                data-test="logs-search-bar-region-btn"
              >
                <template #trigger>
                  <OButton
                    variant="outline"
                    size="sm"
                    class="region-dropdown-btn tw:px-1"
                    :title="t('search.regionTitle')"
                  >
                    {{ t("search.region") }}
                    <OIcon name="arrow-drop-down" size="sm" class="tw:ml-1" />
                  </OButton>
                </template>
                <div
                  class="tw:p-2 tw:min-w-[240px]"
                  data-test="logs-search-bar-region-menu"
                >
                  <OInput
                    clearable
                    class="tw:mb-[0.375rem]! indexlist-search-input tw:mx-2 tw:mt-2"
                    v-model="regionFilter"
                    :label="t('search.regionFilterMsg')"
                  />
                  <OTree
                    class="tw:w-full col-sm-6 tw:mx-2 tw:mb-2"
                    :nodes="store.state.regionInfo"
                    node-key="label"
                    :filter="regionFilter"
                    :filter-method="regionFilterMethod"
                    tick-strategy="leaf"
                    v-model:ticked="searchObj.meta.clusters"
                  />
                </div>
              </ODropdown>
            </OButtonGroup>
            <div
              v-if="
                searchObj.meta.logsVisualizeToggle === 'visualize' ||
                searchObj.meta.logsVisualizeToggle === 'build'
              "
            >
              <div
                v-if="config.isEnterprise == 'true'"
                class="tw:flex tw:items-center"
              >
                <OButton
                  v-if="visualizeSearchRequestTraceIds.length > 0"
                  data-test="logs-search-bar-visualize-cancel-btn"
                  :title="t('search.cancel')"
                  variant="ghost"
                  class="tw:p-0 tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow search-button-enterprise-border-radius"
                  @click="cancelVisualizeQueries"
                  >{{ t("search.cancel") }}</OButton
                >
                <!-- Main action button: "Ask AI" when NL detected + AI bar not open, otherwise "Run Query" -->
                <OButton
                  v-else
                  data-test="logs-search-bar-visualize-refresh-btn"
                  variant="ghost"
                  :title="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t('search.generateQueryTooltip')
                      : t('search.runQuery')
                  "
                  :disabled="
                    isGeneratingSQL ||
                    (isNaturalLanguageDetected &&
                      !searchObj.meta.nlpMode &&
                      !searchObj.data.stream.selectedStream.length)
                  "
                  class="tw:p-0 tw:h-[1.875rem]! element-box-shadow"
                  :class="[
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'o2-ai-generate-button search-button-enterprise-border-radius'
                      : 'o2-run-query-button o2-color-primary',
                    'search-button-enterprise-border-radius',
                  ]"
                  @click="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? handleGenerateSQLQuery()
                      : handleRunQueryFn()
                  "
                >
                  {{
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t("search.generateQuery")
                      : t("search.runQuery")
                  }}
                </OButton>
                <OSeparator class="tw:h-[1.875rem]! tw:w-[1px]" vertical />
                <ODropdown align="end" side="bottom">
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="icon-xs"
                      :class="[
                        !(
                          isNaturalLanguageDetected && !searchObj.meta.nlpMode
                        ) &&
                        config.isEnterprise == 'true' &&
                        visualizeSearchRequestTraceIds.length
                          ? 'o2-color-cancel'
                          : !(
                                isNaturalLanguageDetected &&
                                !searchObj.meta.nlpMode
                              )
                            ? 'o2-color-primary'
                            : '',
                        'search-button-dropdown-enterprise-border-radius',
                      ]"
                    >
                      <OIcon name="arrow-drop-down" size="sm" />
                    </OButton>
                  </template>
                  <ODropdownItem
                    v-if="
                      !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                    "
                    data-test="logs-search-bar-refresh-btn"
                    data-cy="search-bar-visuzlie-hard-refresh-button"
                    :disabled="
                      config.isEnterprise == 'true' &&
                      !!visualizeSearchRequestTraceIds.length
                    "
                    @select="handleRunQueryFn(true)"
                  >
                    <template #icon-left
                      ><OIcon name="refresh" size="sm"
                    /></template>
                    {{ t("search.refreshCacheAndRunQuery") }}
                  </ODropdownItem>
                  <p
                    v-else
                    class="tw:text-xs tw:text-[var(--o2-text-caption)] tw:text-center tw:px-3 tw:py-2"
                  >
                    {{ t("nlMode.noAdditionalOptions") }}
                  </p>
                </ODropdown>
              </div>
              <div v-else class="tw:flex tw:items-center">
                <!-- Cancel button when query is running -->
                <OButton
                  v-if="visualizeSearchRequestTraceIds.length > 0 && config.isEnterprise == 'true'"
                  data-test="logs-search-bar-visualize-cancel-btn"
                  variant="ghost"
                  :title="t('search.cancel')"
                  class="tw:p-0 tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow search-button-enterprise-border-radius"
                  @click="cancelVisualizeQueries"
                  >{{ t("search.cancel") }}</OButton
                >
                <!-- Main action button -->
                <OButton
                  v-else
                  data-test="logs-search-bar-visualize-refresh-btn"
                  variant="ghost"
                  :title="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t('search.generateQueryTooltip')
                      : t('search.runQuery')
                  "
                  :disabled="
                    disable ||
                    isGeneratingSQL ||
                    (isNaturalLanguageDetected &&
                      !searchObj.meta.nlpMode &&
                      !searchObj.data.stream.selectedStream.length)
                  "
                  class="tw:p-0 tw:h-[1.875rem]! element-box-shadow"
                  :class="[
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'o2-ai-generate-button search-button-enterprise-border-radius'
                      : 'o2-run-query-button o2-color-primary',
                    'search-button-enterprise-border-radius',
                  ]"
                  @click="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? handleGenerateSQLQuery()
                      : handleRunQueryFn()
                  "
                >
                  {{
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t("search.generateQuery")
                      : t("search.runQuery")
                  }}
                </OButton>
                <OSeparator class="tw:h-[1.875rem]! tw:w-[1px]" vertical />
                <ODropdown align="end" side="bottom">
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="icon-xs"
                      :class="[
                        !(
                          isNaturalLanguageDetected && !searchObj.meta.nlpMode
                        ) &&
                        config.isEnterprise == 'true' &&
                        visualizeSearchRequestTraceIds.length
                          ? 'o2-color-cancel'
                          : !(
                                isNaturalLanguageDetected &&
                                !searchObj.meta.nlpMode
                              )
                            ? 'o2-color-primary'
                            : '',
                        'search-button-dropdown-enterprise-border-radius',
                      ]"
                    >
                      <OIcon name="arrow-drop-down" size="sm" />
                    </OButton>
                  </template>
                  <ODropdownItem
                    v-if="
                      !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                    "
                    data-test="logs-search-bar-refresh-btn"
                    data-cy="search-bar-visuzlie-hard-refresh-button"
                    :disabled="
                      config.isEnterprise == 'true' &&
                      !!visualizeSearchRequestTraceIds.length
                    "
                    @select="handleRunQueryFn(true)"
                  >
                    <template #icon-left
                      ><OIcon name="refresh" size="sm"
                    /></template>
                    {{ t("search.refreshCacheAndRunQuery") }}
                  </ODropdownItem>
                  <p
                    v-else
                    class="tw:text-xs tw:text-[var(--o2-text-caption)] tw:text-center tw:px-3 tw:py-2"
                  >
                    {{ t("nlMode.noAdditionalOptions") }}
                  </p>
                </ODropdown>
              </div>
            </div>
            <div v-else class="tw:flex tw:items-center">
              <!-- Cancel button for patterns tab -->
              <OButton
                v-if="
                  searchObj.meta.logsVisualizeToggle === 'patterns' &&
                  patternsState.loading
                "
                data-test="logs-search-bar-patterns-cancel-btn"
                variant="ghost"
                :title="t('search.cancel')"
                class="tw:p-0 tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow search-button-normal-border-radius"
                @click="cancelPatterns"
                >{{ t("search.cancel") }}</OButton
              >
              <!-- Cancel button for logs tab (enterprise only, trace-based) -->
              <OButton
                v-else-if="
                  config.isEnterprise == 'true' &&
                  (!!searchObj.data.searchRequestTraceIds.length ||
                    !!searchObj.data.searchWebSocketTraceIds.length) &&
                  (searchObj.loading == true ||
                    searchObj.loadingHistogram == true)
                "
                data-test="logs-search-bar-refresh-btn"
                data-cy="search-bar-refresh-button"
                variant="ghost"
                :title="t('search.cancel')"
                class="tw:p-0 tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow"
                :class="
                  config.isEnterprise == 'true'
                    ? 'search-button-enterprise-border-radius'
                    : 'search-button-normal-border-radius'
                "
                @click="cancelQuery"
                >{{ t("search.cancel") }}</OButton
              >
              <!-- Main action button: "Ask AI" when NL detected but AI bar not open, otherwise "Run Query" -->
              <OButton
                v-else
                data-test="logs-search-bar-refresh-btn"
                data-cy="search-bar-refresh-button"
                variant="ghost"
                :title="
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? t('search.generateQueryTooltip')
                    : t('search.runQuery')
                "
                class="tw:p-0 tw:h-[1.875rem]! element-box-shadow"
                :class="[
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? 'o2-ai-generate-button'
                    : 'o2-run-query-button o2-color-primary',
                  store.state.zoConfig.auto_query_enabled
                    ? 'search-button-enterprise-border-radius'
                    : 'search-button-normal-border-radius',
                ]"
                @click="
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? handleGenerateSQLQuery()
                    : handleRunQueryFn()
                "
                :loading="searchObj.loading || searchObj.loadingHistogram"
                :disabled="
                  searchObj.loading == true ||
                  searchObj.loadingHistogram == true ||
                  patternsState.loading ||
                  isGeneratingSQL ||
                  (isNaturalLanguageDetected &&
                    !searchObj.meta.nlpMode &&
                    !searchObj.data.stream.selectedStream.length)
                "
              >
                <OTooltip
                  v-if="
                    searchObj.meta.liveMode &&
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  :content="t('search.autoRunEnabled')"
                />
                <OIcon
                  v-if="
                    searchObj.meta.liveMode &&
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  name="autorenew"
                  size="xs"
                  class="tw:mr-1"
                />
                {{
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? t("search.generateQuery")
                    : t("search.runQuery")
                }}
              </OButton>
              <!-- Dropdown: shown for enterprise or when live mode feature is enabled -->
              <OSeparator
                v-if="store.state.zoConfig.auto_query_enabled"
                class="tw:h-[1.875rem]! tw:w-[1px]"
                vertical
              />
              <ODropdown
                v-if="store.state.zoConfig.auto_query_enabled"
                align="end"
                side="bottom"
              >
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-xs"
                    :class="[
                      (searchObj.meta.logsVisualizeToggle === 'patterns' &&
                        patternsState.loading) ||
                      (!(isNaturalLanguageDetected && !searchObj.meta.nlpMode) &&
                        config.isEnterprise == 'true' &&
                        (!!searchObj.data.searchRequestTraceIds.length ||
                          !!searchObj.data.searchWebSocketTraceIds.length) &&
                        (searchObj.loading == true ||
                          searchObj.loadingHistogram == true))
                        ? 'o2-color-cancel'
                        : !(
                              isNaturalLanguageDetected &&
                              !searchObj.meta.nlpMode
                            )
                          ? 'o2-color-primary'
                          : '',
                      store.state.zoConfig.auto_query_enabled
                        ? 'search-button-dropdown-enterprise-border-radius'
                        : 'search-button-normal-border-radius',
                    ]"
                  >
                    <OIcon name="arrow-drop-down" size="sm" />
                  </OButton>
                </template>
                <!-- Normal mode: Refresh + Live Mode items -->
                <ODropdownItem
                  v-if="
                    config.isEnterprise == 'true' &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  data-test="logs-search-bar-refresh-btn"
                  data-cy="search-bar-refresh-button"
                  :disabled="
                    searchObj.loading == true ||
                    searchObj.loadingHistogram == true
                  "
                  @select="handleRunQueryFn(true)"
                >
                  <template #icon-left
                    ><OIcon name="refresh" size="sm"
                  /></template>
                  {{ t("search.refreshCacheAndRunQuery") }}
                </ODropdownItem>
                <ODropdownSeparator
                  v-if="
                    config.isEnterprise == 'true' &&
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                />
                <ODropdownItem
                  v-if="
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  data-test="logs-search-bar-live-mode-toggle-btn"
                  @select="toggleLiveMode"
                >
                  <template #icon-left>
                    <OIcon
                      :name="
                        searchObj.meta.liveMode ? 'autorenew' : 'sync-disabled'
                      "
                      size="sm"
                      :class="searchObj.meta.liveMode ? 'tw:text-[var(--o2-primary)]' : ''"
                    />
                  </template>
                  <span>
                    <div class="tw:font-medium">
                      {{
                        searchObj.meta.liveMode
                          ? t("search.turnOffLiveMode")
                          : t("search.turnOnLiveMode")
                      }}
                    </div>
                    <div class="tw:text-xs tw:text-[var(--o2-text-secondary)]">
                      {{ t("search.liveModeTooltip") }}
                    </div>
                  </span>
                </ODropdownItem>
                <!-- NLP mode: info message -->
                <p
                  v-if="isNaturalLanguageDetected && !searchObj.meta.nlpMode"
                  class="tw:text-xs tw:text-[var(--o2-text-caption)] tw:text-center tw:px-3 tw:py-2"
                >
                  {{ t("nlMode.noAdditionalOptions") }}
                </p>
              </ODropdown>
              <!-- Compact Auto Refresh Button -->
              <auto-refresh-interval
                class="tw:ml-1"
                v-model="searchObj.meta.refreshInterval"
                :trigger="true"
                :is-compact="true"
                :min-refresh-interval="
                  store.state?.zoConfig?.min_auto_refresh_interval ?? 0
                "
                @update:model-value="onRefreshIntervalUpdate"
                @trigger="$emit('onAutoIntervalTrigger')"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- pr-1.5 mirrors the editor's ml-1.5 so the editor area sits at 10px on
         the right (4px wrapper + 6px), aligning with the results panel below. -->
    <div
      ref="editorContainerRef"
      class="tw:flex tw:relative query-editor-container tw:w-full tw:overflow-visible"
      :class="{ 'editor-fullscreen': isFocused }"
      :style="editorFullscreenStyle"
    >
      <!-- Expand / collapse button — always top-right of the full editor area -->
      <OButton
        :icon-left="isFocused ? 'fullscreen-exit' : 'fullscreen'"
        data-test="logs-query-editor-full_screen-btn"
        variant="ghost"
        size="icon-toolbar"
        @click="toggleEditorFullscreen"
        class="tw:absolute! tw:z-[51] tw:top-[0.1875rem] tw:right-[0.25rem] editor-expand-btn"
      >
        <OTooltip :content="isFocused ? t('search.collapse') : t('search.expand')" />
      </OButton>
      <div
        class="tw:flex tw:flex-col tw:h-full tw:w-full tw:min-w-0"
      >
        <OSplitter
          class="logs-search-splitter tw:h-full!"
          v-model="searchObj.config.fnSplitterModel"
          :limits="searchObj.config.fnSplitterLimit"
          :horizontal="false"
          separator-class="tw:w-px! tw:bg-[var(--o2-border-color)]"
        >
          <template #before>
            <div
              class="tw:flex tw:flex-col tw:overflow-hidden tw:h-full tw:relative"
              :class="{
                'tw:border-r-0 tw:rounded-r-none': searchObj.data.transformType,
                'fn-editor-open': showFunctionEditor
              }"
            >
              <!-- Unified Query Editor (with built-in AI bar) -->
              <unified-query-editor
                v-if="router.currentRoute.value.name === 'logs'"
                ref="queryEditorRef"
                :query="searchObj.data.query"
                :keywords="effectiveKeywords"
                :suggestions="effectiveSuggestions"
                :debounce-time="100"
                :nlp-mode="searchObj.meta.nlpMode"
                :has-expand-button="!showFunctionEditor"
                :show-ai-icon="
                  config.isEnterprise == 'true' &&
                  store.state.zoConfig.ai_enabled
                "
                :disable-ai="
                  !searchObj.data.stream.selectedStream.length ||
                  isSqlModeDisabled
                "
                :disable-ai-reason="
                  !searchObj.data.stream.selectedStream.length
                    ? t('search.selectStreamForAI')
                    : t('search.nlpModeDisabledForVisualization')
                "
                :ai-placeholder="aiQueryPlaceholder || t('search.askAIPlaceholder')"
                data-test="logs-search-bar-query-editor"
                data-test-prefix="logs-search-bar"
                editor-height="100%"
                :style="editorWidthToggleFunction"
                language="sql"
                :readOnly="
                  searchObj.meta.logsVisualizeToggle === 'build' &&
                  searchObj.meta.buildModeQueryEditorDisabled
                "
                @update:query="updateQueryValue"
                @update:nlp-mode="(val) => (searchObj.meta.nlpMode = val)"
                @run-query="handleRunQueryFn"
                @keydown="handleKeyDown"
                @focus="onQueryEditorFocus"
                @blur="handleQueryEditorBlur"
              />
              <!-- Query editor placeholder overlay — shown when editor is empty and unfocused -->
              <div
                v-if="
                  searchObj.data.editorValue == '' &&
                  searchObj.meta.queryEditorPlaceholderFlag &&
                  !searchObj.meta.nlpMode
                "
                class="query-editor-placeholder-overlay"
              >
                <span class="query-editor-placeholder-typewriter">{{ editorPlaceholder }}</span>
              </div>
            </div>
          </template>
          <template #after>
            <div
              data-test="logs-vrl-function-editor"
              v-if="searchObj.data.transformType"
              class="tw:w-full tw:h-full"
            >
              <template v-if="showFunctionEditor">
                <div class="tw:relative tw:h-full tw:w-full">
                  <div
                    class="tw:relative tw:h-full"
                  >
                    <!-- Unified Query Editor (with built-in AI bar) -->
                    <unified-query-editor
                      v-if="router.currentRoute.value.name === 'logs'"
                      data-test="logs-vrl-function-editor"
                      ref="fnEditorRef"
                      :languages="['vrl']"
                      :default-language="'vrl'"
                      :query="searchObj.data.tempFunctionContent"
                      :nlp-mode="vrlEditorNlpMode"
                      :hide-nl-toggle="false"
                      :has-expand-button="true"
                      :disable-ai="isVrlEditorDisabled"
                      :disable-ai-reason="
                        isVrlEditorDisabled ? t('search.vrlOnlyForTable') : ''
                      "
                      :ai-placeholder="t('search.askAIFunctionPlaceholder')"
                      :ai-tooltip="t('search.enterFunctionPrompt')"
                      :read-only="isVrlEditorDisabled"
                      editor-height="100%"
                      class="monaco-editor"
                      @update:query="
                        searchObj.data.tempFunctionContent = $event
                      "
                      @update:nlp-mode="(val) => (vrlEditorNlpMode = val)"
                      @keydown="handleKeyDown"
                      @focus="
                        searchObj.meta.functionEditorPlaceholderFlag = false
                      "
                      @blur="
                        searchObj.meta.functionEditorPlaceholderFlag = true
                      "
                    />
                    <div
                      v-if="!searchObj.data.tempFunctionContent && searchObj.meta.functionEditorPlaceholderFlag && !isVrlEditorDisabled"
                      class="query-editor-placeholder-overlay"
                    >
                      <span class="query-editor-placeholder-typewriter">{{ vrlPlaceholder }}</span>
                    </div>
                    <!-- VRL disabled warning for non-table charts -->
                    <div
                      v-if="isVrlEditorDisabled"
                      class="tw:absolute tw:bottom-0 tw:w-full tw:mt-3 tw:flex tw:items-center vrl-disabled-warning"
                      data-test="vrl-editor-disabled-warning"
                    >
                      <OIcon name="warning" size="md" class="tw:mx-2" />
                      <span
                        class="tw:text-red-500 tw:p-2 tw:font-semibold"
                        >VRL function is only supported for table chart.</span
                      >
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="searchObj.data.transformType === 'action'">
                <code-query-editor
                  v-if="router.currentRoute.value.name === 'logs'"
                  data-test="logs-vrl-function-editor"
                  ref="fnEditorRef"
                  editor-id="fnEditor"
                  class="monaco-editor"
                  :query="actionEditorQuery"
                  read-only
                  language="markdown"
                />
              </template>
            </div>
          </template>
        </OSplitter>
      </div>
    </div>

    <ODialog
      data-test="search-bar-confirm-dialog"
      ref="confirmDialog"
      v-model:open="confirmDialogVisible"
      size="xs"
      title="Confirm"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      @click:secondary="cancelConfirmDialog"
      @click:primary="confirmDialogOK"
    >
      <p>{{ confirmMessage }}</p>
    </ODialog>

    <ODialog
      data-test="search-bar-confirm-saved-view-dialog"
      ref="confirmSavedViewDialog"
      v-model:open="confirmSavedViewDialogVisible"
      size="xs"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      @click:secondary="cancelConfirmDialog"
      @click:primary="confirmDialogOK"
    >
      <p>{{ confirmMessageSavedView }}</p>
    </ODialog>
    <ODialog
      data-test="search-bar-custom-download-dialog"
      v-model:open="customDownloadDialog"
      size="md"
      title="Custom Download"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('search.btnDownload')"
      @click:secondary="customDownloadDialog = false"
      @click:primary="downloadRangeData"
    >
    <div class="tw:flex tw:flex-col tw:gap-y-2">
      <p>{{ t("search.customDownloadMessage") }}</p>
      <OInput
        type="number"
        data-test="custom-download-initial-number-input"
        v-model="downloadCustomInitialNumber"
        :label="t('search.initialNumber')"
        min="1"
      />
      <OSelect
        data-test="custom-download-range-select"
        v-model="downloadCustomRange"
        :options="downloadCustomRangeOptions"
        :label="t('search.range')"
        class="tw:py-2"
      />
      <div class="file-type">
        <label class="o-input-label tw:text-sm tw:font-semibold tw:leading-tight tw:pr-2">{{ t("search.fileType") }}</label
        ><br />
        <OButtonGroup
          data-test="custom-download-file-type-button-group"
          class="file-type-button-group tw:mt-1"
        >
          <OButton
            v-for="option in downloadCustomFileTypeOptions"
            :key="option.value"
            :data-test="`custom-download-file-type-${option.value}-btn`"
            :active="downloadCustomFileType === option.value"
            variant="outline"
            size="sm"
            @click="downloadCustomFileType = option.value"
            >{{ option.label }}</OButton
          >
        </OButtonGroup>
      </div>
      </div>
    </ODialog>
    <ODialog
      data-test="search-bar-store-state-saved-view-dialog"
      v-model:open="store.state.savedViewDialog"
      size="md"
      :title="t('search.savedViewsLabel')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('common.save')"
      :primary-button-loading="saveViewLoader"
      @click:secondary="store.state.savedViewDialog = false"
      @click:primary="handleSavedView"
    >
      <div v-if="isSavedViewAction == 'create'">
        <OInput
          data-test="add-alert-name-input"
          v-model="savedViewName"
          :label="t('search.savedViewName')"
          :error="!!savedViewNameError"
          :error-message="savedViewNameError"
          @update:model-value="savedViewNameError = ''"
        />
      </div>
      <div v-else>
        <OSelect
          data-test="saved-view-name-select"
          v-model="savedViewSelectedName"
          :options="searchObj.data.savedViews"
          labelKey="view_name"
          valueKey="view_id"
          :label="t('search.savedViewName')"
          class="tw:py-2"
          :error="!!savedViewSelectError"
          :error-message="savedViewSelectError"
          @update:model-value="savedViewSelectError = ''"
        />
      </div>
    </ODialog>
    <ODialog
      data-test="search-bar-store-state-saved-function-dialog"
      v-model:open="store.state.savedFunctionDialog"
      size="md"
      :title="t('search.functionPlaceholder')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      :primary-button-loading="saveFunctionLoader"
      @click:secondary="store.state.savedFunctionDialog = false; functionUpdateConfirm = false"
      @click:primary="saveFunction"
      @update:open="(open) => { if (!open) functionUpdateConfirm = false }"
    >
      <OToggleGroup
        data-test="saved-function-action-toggle"
        :model-value="isSavedFunctionAction"
        :disabled="functionOptions.length == 0"
        class="tw:mb-3"
        @update:model-value="isSavedFunctionAction = $event; savedFunctionName = ''"
      >
        <OToggleGroupItem value="update" size="sm">Update</OToggleGroupItem>
        <OToggleGroupItem value="create" size="sm">Create</OToggleGroupItem>
      </OToggleGroup>
      <div v-if="isSavedFunctionAction == 'create'">
        <OInput
          data-test="saved-function-name-input"
          v-model="savedFunctionName"
          :label="t('search.saveFunctionName')"
          :error="!!savedFunctionNameError"
          :error-message="savedFunctionNameError"
          @update:model-value="savedFunctionNameError = ''"
        />
      </div>
      <div v-else>
        <OSelect
          data-test="saved-function-name-select"
          v-model="savedFunctionSelectedName"
          :options="functionOptions"
          labelKey="name"
          valueKey="name"
          :label="t('search.saveFunctionName')"
          :placeholder="'Select Function Name'"
          class="tw:py-2"
          :error="!!savedFunctionSelectError"
          :error-message="savedFunctionSelectError"
          @update:model-value="savedFunctionSelectError = ''"
        />
      </div>
    </ODialog>

    <!-- Function update confirmation dialog -->
    <ConfirmDialog
      data-test="search-bar-function-update-confirm-dialog"
      title="Confirm Update"
      :message="`Are you sure you want to update the function ${savedFunctionSelectedName}?`"
      v-model="functionUpdateConfirm"
      @update:ok="executeFunctionUpdate"
      @update:cancel="functionUpdateConfirm = false"
    />
    <ODialog
      data-test="search-bar-search-scheduler-job-dialog"
      v-model:open="searchSchedulerJob"
      size="md"
      :title="t('search.scheduleSearchJob')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      @click:secondary="
        searchSchedulerJob = false;
        searchObj.meta.showSearchScheduler = false;
      "
      @click:primary="addJobScheduler"
    >
      <div>
        <div class="tw:text-left tw:mb-1">
          {{ t("search.noOfRecords") }}:
          <OIcon name="info-outline" size="sm" class="tw:ml-1 tw:cursor-pointer" />
            <OTooltip side="right" align="center" max-width="300px">
              <template #content>
                <span class="tw:text-sm">{{ t("search.noOfRecordsTooltip") }}</span>
              </template>
            </OTooltip>
        </div>
        <OInput
          type="number"
          data-test="search-scheuduler-max-number-of-records-input"
          v-model="searchObj.meta.jobRecords"
          min="100"
        />
      </div>
      <div class="tw:text-left">
        {{ t("search.maxEventsScheduleJob") }}
      </div>
      <div class="tw:opacity-80 tw:text-left mapping-warning-msg tw:mt-3">
        <OIcon name="warning" size="sm" class="tw:mr-2 tw:text-red-500" />
        <span>{{ t("search.histogramDisabledScheduleJob") }}</span>
      </div>
    </ODialog>

    <!-- Search Inspect Dialog -->
    <ODialog
      data-test="search-bar-search-inspect-dialog"
      v-model:open="searchInspectDialog"
      size="sm"
      title="Search Inspect"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      :primary-button-disabled="!searchInspectTraceId.trim()"
      @click:secondary="searchInspectDialog = false"
      @click:primary="navigateToSearchInspect"
    >
      <div class="tw:text-left tw:mb-1">Trace ID:</div>
      <OInput
        v-model="searchInspectTraceId"
        placeholder="Enter trace ID"
        autofocus
        data-test="search-inspect-trace-id-input"
      />
    </ODialog>

    <ConfirmDialog
      title="Change Query Mode"
      message="Are you sure you want to change the query mode? The data saved for X-Axis, Y-Axis and Filters will be wiped off."
      @update:ok="confirmBuildModeChangeOk"
      @update:cancel="confirmBuildModeChange = false"
      v-model="confirmBuildModeChange"
    />
    <ConfirmDialog
      title="Delete Saved View"
      message="Are you sure you want to delete saved view?"
      @update:ok="confirmDeleteSavedViews"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <ConfirmDialog
      title="Update Saved View"
      message="Are you sure you want to update the saved view? This action will overwrite the existing one."
      @update:ok="confirmUpdateSavedViews"
      @update:cancel="confirmUpdate = false"
      v-model="confirmUpdate"
    />
    <!-- Query Plan Dialog -->
    <QueryPlanDialog v-model="showExplainDialog" :searchObj="searchObj" />

    <!-- Saved Views List Dialog -->
    <ODialog
      v-model:open="savedViewsListDialog"
      size="lg"
      :title="t('search.savedViewsLabel')"
      data-test="saved-views-list-dialog"
    >
      <div>
          <div data-test="logs-search-saved-view-list" class="tw:flex">
            <div
              class="tw:flex tw:flex-col"
              :class="localSavedViews.length > 0 ? 'tw:border-r tw:border-[var(--o2-border-color)]' : ''"
              :style="localSavedViews.length > 0 ? 'width: 60%' : 'width: 100%'"
            >
              <div style="max-height: 486px; min-height: 280px; display: flex; flex-direction: column;">
              <OTable
                data-test="log-search-saved-view-list-fields-table"
                :data="searchObj.data.savedViews"
                :columns="savedViewColumns"
                row-key="view_id"
                :global-filter="searchObj.data.savedViewFilterFields"
                :page-size="rowsPerPage"
                :page-size-options="[10, 20, 50]"
                class="saved-view-table full-height o2-table-hide-header"
              >
                <template #top>
                  <div class="tw:px-2 tw:py-2 tw:w-full tw:min-w-0 tw:box-border">
                    <OSearchInput
                      data-test="log-search-saved-view-field-search-input"
                      v-model="searchObj.data.savedViewFilterFields"
                      clearable
                      :debounce="300"
                      class="tw:w-full"
                      :placeholder="t('search.searchSavedView')"
                    />
                  </div>
                  <div
                    v-if="searchObj.loadingSavedView == true"
                    class="tw:w-full tw:p-2"
                  >
                    <div class="tw:text-sm tw:font-medium text-weight-bold">
                      <OSpinner size="xs" />
                      {{ t("confirmDialog.loading") }}
                    </div>
                  </div>
                </template>
                <template #cell-view_name="{ row, value }">
                  <div
                    class="tw:truncate tw:cursor-pointer tw:text-sm tw:min-w-0 tw:w-full"
                    :title="value"
                    :data-test="`logs-search-bar-apply-${value}-saved-view-btn`"
                    @click.stop="
                      applySavedView(row);
                      savedViewsListDialog = false;
                    "
                  >
                    {{ value }}
                  </div>
                </template>
                <template #cell-actions="{ row }">
                  <div class="tw:flex tw:items-center tw:gap-0.5">
                    <OButton
                      :title="t('common.favourite')"
                      class="logs-saved-view-icon action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-favorite-${row.view_id}-saved-view-btn`"
                      @click.stop="
                        handleFavoriteSavedView(
                          row,
                          favoriteViews.includes(row.view_id),
                        )
                      "
                    >
                      <OIcon
                        :name="
                          favoriteViews.includes(row.view_id)
                            ? 'favorite'
                            : 'favorite-border'
                        "
                        size="xs"
                      />
                    </OButton>
                    <OButton
                      :title="t('common.edit')"
                      class="logs-saved-view-icon action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-update-${row.view_id}-saved-view-btn`"
                      @click.stop="handleUpdateSavedView(row)"
                    >
                      <OIcon name="edit" size="xs" />
                    </OButton>
                    <OButton
                      :title="t('common.delete')"
                      class="logs-saved-view-icon action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-delete-${row.view_id}-saved-view-btn`"
                      @click.stop="handleDeleteSavedView(row)"
                    >
                      <OIcon name="delete" size="xs" />
                    </OButton>
                  </div>
                </template>
                <template #empty>
                  <div
                    v-if="searchObj.loadingSavedView == false"
                    class="tw:text-center tw:p-2 tw:w-full"
                  >
                    <span>{{
                      t("search.savedViewsNotFound")
                    }}</span>
                  </div>
                </template>
              </OTable>
              </div>
            </div>

            <div
              class="tw:flex tw:flex-col tw:w-[40%] tw:ml-0 tw:pl-3"
              v-if="localSavedViews.length > 0"
            >
              <div style="max-height: 480px; min-height: 280px; display: flex; flex-direction: column;">
              <OTable
                data-test="log-search-saved-view-favorite-list-fields-table"
                :data="localSavedViews"
                :columns="savedViewColumns"
                row-key="view_id"
                pagination="none"
                class="saved-view-table full-height o2-table-hide-header"
              >
                <template #top>
                  <div
                    class="tw:p-2 tw:font-bold favorite-label tw:text-xs tw:uppercase tw:tracking-wide tw:text-muted-foreground"
                  >
                    {{ t("search.favoriteViews") }}
                  </div>
                  <div class="tw:border-t tw:my-1 tw:border-border" />
                </template>
                <template #cell-view_name="{ row, value }">
                  <div
                    class="tw:truncate tw:cursor-pointer tw:text-sm tw:min-w-0 tw:w-full"
                    :title="value"
                    :data-test="`logs-search-bar-dialog-favorite-saved-view-row-${value}`"
                    @click.stop="
                      applySavedView(row);
                      savedViewsListDialog = false;
                    "
                  >
                    {{ value }}
                  </div>
                </template>
                <template #cell-actions="{ row }">
                  <div class="tw:flex tw:items-center tw:gap-0.5">
                    <OButton
                      :title="t('common.favourite')"
                      class="logs-saved-view-icon action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-favorite-${row.view_id}-saved-view-btn`"
                      @click.stop="handleFavoriteSavedView(row, true)"
                    >
                      <OIcon name="favorite" size="xs" />
                    </OButton>
                    <OButton
                      :title="t('common.edit')"
                      class="logs-saved-view-icon action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-update-${row.view_id}-favorite-saved-view-btn`"
                      @click.stop="handleUpdateSavedView(row)"
                    >
                      <OIcon name="edit" size="xs" />
                    </OButton>
                    <OButton
                      :title="t('common.delete')"
                      class="logs-saved-view-icon action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-delete-${row.view_id}-favorite-saved-view-btn`"
                      @click.stop="handleDeleteSavedView(row)"
                    >
                      <OIcon name="delete" size="xs" />
                    </OButton>
                  </div>
                </template>
              </OTable>
              </div>
            </div>
          </div>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  onMounted,
  nextTick,
  watch,
  toRaw,
  onActivated,
  onUnmounted,
  onDeactivated,
  defineAsyncComponent,
  onBeforeMount,
  onBeforeUnmount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import useLogs from "@/composables/useLogs";
import { useToolbarResponsive } from "@/composables/useToolbarResponsive";
import useStreams from "@/composables/useStreams";
import SyntaxGuide from "./SyntaxGuide.vue";
import jsTransformService from "@/services/jstransform";
import searchService from "@/services/search";
import shortURLService from "@/services/short_url";

import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
// Lazy load CodeQueryEditor to avoid loading Monaco Editor eagerly
const CodeQueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
// Unified QueryEditor for main query editor (with built-in AI bar)
const UnifiedQueryEditor = defineAsyncComponent(
  () => import("@/components/QueryEditor.vue"),
);

import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import useSqlSuggestions from "@/composables/useSuggestions";
import { json2csv } from "json-2-csv";
import QueryPlanDialog from "@/components/QueryPlanDialog.vue";
import {
  mergeDeep,
  b64DecodeUnicode,
  getImageURL,
  useLocalInterestingFields,
  useLocalSavedView,
  queryIndexSplit,
  timestampToTimezoneDate,
  b64EncodeUnicode,
  buildDateTimeObject,
} from "@/utils/zincutils";

import { debounce } from "lodash-es";
import savedviewsService from "@/services/saved_views";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { inject, toRef, computed } from "vue";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import { useLoading } from "@/composables/useLoading";
import TransformSelector from "./TransformSelector.vue";
import FunctionSelector from "./FunctionSelector.vue";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useNotifications from "@/composables/useNotifications";
import histogram_svg from "../../assets/images/common/histogram_image.svg";
import { allSelectionFieldsHaveAlias } from "@/utils/query/visualizationUtils";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { isSqlQuery } from "@/utils/query/sqlUtils";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useVrlPlaceholder } from "@/composables/useVrlPlaceholder";
import {
  logsUtils,
  removeFieldFromWhereAST,
} from "@/composables/useLogs/logsUtils";
import { searchState } from "@/composables/useLogs/searchState";
import {
  getVisualizationConfig,
  encodeVisualizationConfig,
  decodeVisualizationConfig,
} from "@/composables/useLogs/logsVisualization";

import useSearchBar from "@/composables/useLogs/useSearchBar";
import usePatterns, { patternsState } from "@/composables/useLogs/usePatterns";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import {
  getFieldFromExpression,
  hasFieldCondition,
  replaceExistingFieldCondition,
  removeFieldCondition,
} from "@/plugins/logs/filterUtils";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OTree from "@/lib/data/Tree/OTree.vue";

const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

/**
 * Extracts the field name from a filter expression.
 * Handles single: `field = 'val'`, multi: `(field = 'x' OR field = 'y')`,
 * and SQL-prefixed: `"stream".field = 'val'`.
 */
const getFieldFromExpression = (expression: string): string | null => {
  const cleaned = expression.trim().replace(/^\(\s*/, "");
  const match =
    cleaned.match(/^"[^"]+"\."?(\w+)"?\s*(?:=|!=|is)/i) ||
    cleaned.match(/^"?(\w+)"?\s*(?:=|!=|is)/i);
  return match ? match[1] : null;
};

/**
 * Tries to replace an existing condition for `fieldName` in `queryStr` with
 * `newExpression`. Returns the modified string, or the original if not found.
 * Handles both parenthesized multi-value groups and single conditions.
 */
const replaceExistingFieldCondition = (
  queryStr: string,
  fieldName: string,
  newExpression: string,
): string => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'[^']*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  const fieldPat = `(?:"${esc}"|${esc})`;
  const condPat = `(?:"[^"]+"\\.)?${fieldPat}\\s*${opPat}\\s*${valPat}`;

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  const multiRegex = new RegExp(
    `\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`,
    "gi",
  );
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, newExpression);
  }

  // Try single condition
  const singleRegex = new RegExp(condPat, "gi");
  if (singleRegex.test(queryStr)) {
    return queryStr.replace(singleRegex, newExpression);
  }

  return queryStr;
};

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    OSeparator,
    OSplitter,
    OButtonGroup,
    ODialog,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    ODropdownGroup,
    DateTime,
    ShareButton,
    OButton,
    SyntaxGuide,
    AutoRefreshInterval,
    ConfirmDialog,
    TransformSelector,
    FunctionSelector,
    CodeQueryEditor,
    UnifiedQueryEditor,
    QueryPlanDialog,
    OIcon,
    OToggleGroup,
    OToggleGroupItem,
    OSpinner,
    OTooltip,
    OInput,
    OSearchInput,
    OSelect,
    OSwitch,
    OTree,
    OTable,
  },
  emits: [
    "searchdata",
    "onChangeInterval",
    "onChangeTimezone",
    "handleQuickModeChange",
    "handleRunQueryFn",
    "onAutoIntervalTrigger",
    "showSearchHistory",
    "extractPatterns",
    "buildModeToggle",
  ],
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
    changeFunctionName(value) {
      // alert(value)
      // console.log(value);
    },
    createNewValue(inputValue, doneFn) {
      // Call the doneFn with the new value
      doneFn(inputValue);
    },
    updateSelectedValue() {
      // Update the selected value with the newly created value
      if (
        this.functionModel &&
        !this.functionOptions.includes(this.functionModel)
      ) {
        this.functionOptions.push(this.functionModel);
      }
    },
    handleDeleteSavedView(item: any) {
      this.savedViewDropdownModel = false;
      this.savedViewsListDialog = false;
      this.deleteViewID = item.view_id;
      this.confirmDelete = true;
    },
    handleUpdateSavedView(item: any) {
      if (this.searchObj.data.stream.selectedStream.length == 0) {
        toast({
          variant: "error",
          message: "No stream available to update save view.",
        });
        return;
      }
      this.savedViewDropdownModel = false;
      this.savedViewsListDialog = false;
      this.updateViewObj = item;
      this.confirmUpdate = true;
    },
    confirmDeleteSavedViews() {
      this.deleteSavedViews();
    },
    toggleCustomDownloadDialog() {
      this.customDownloadDialog = true;
    },
    confirmUpdateSavedViews() {
      this.updateSavedViews(
        this.updateViewObj.view_id,
        this.updateViewObj.view_name,
      );
      return;
    },
    downloadRangeData() {
      let initNumber = parseInt(this.downloadCustomInitialNumber);
      if (initNumber < 0) {
        toast({
          message: "Initial number must be positive number.",
          variant: "warning",
        });
        return;
      }
      if (!this.searchObj?.data?.customDownloadQueryObj?.query) {
        toast({
          message: "Please run a query first before downloading.",
          variant: "warning",
        });
        return;
      }
      // const queryReq = this.buildSearch();
      this.searchObj.data.customDownloadQueryObj.query.from =
        initNumber == 0 ? 0 : initNumber - 1;
      this.searchObj.data.customDownloadQueryObj.query.size =
        this.downloadCustomRange;
      searchService
        .search(
          {
            org_identifier: this.searchObj.organizationIdentifier,
            query: this.searchObj.data.customDownloadQueryObj,
            page_type: this.searchObj.data.stream.streamType,
          },
          "ui",
        )
        .then((res) => {
          this.customDownloadDialog = false;
          if (res.data.hits.length > 0) {
            this.downloadLogs(res.data.hits, this.downloadCustomFileType);
          } else {
            toast({
              message: "No data found to download.",
              variant: "warning",
            });
          }
        })
        .catch((err) => {
          toast({
            message: err.message,
            variant: "error",
          });
        });
    },
    handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        this.handleRunQueryFn();
      }
    },
  },
  props: {
    fieldValues: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const store = useStore();
    const { showErrorNotification } = useNotifications();
    const rowsPerPage = ref(10);
    const savedViewColumns = [
      {
        id: "view_name",
        header: "",
        accessorKey: "view_name",
        sortable: false,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: "",
        isAction: true,
        sortable: false,
        size: 30,
        meta: { align: "right" },
      },
    ];
    const regionFilter = ref();
    const regionFilterRef = ref(null);
    const { resetStreamData, searchObj } = searchState();
    const { buildSearch } = useSearchStream();

    const {
      fnParsedSQL,
      fnUnparsedSQL,
      updatedLocalLogFilterField,
      updateUrlQueryParams,
      generateURLQuery,
      isActionsEnabled,
      checkTimestampAlias,
    } = logsUtils();
    const {
      getSavedViews,
      setSelectedStreams,
      onStreamChange,
      getQueryData,
      cancelQuery,
    } = useSearchBar();
    const { loadStreamLists, extractFields } = useStreamFields();
    const { cancelPatterns } = usePatterns();

    const {
      refreshData,
      handleRunQuery,
      getJobData,
      routeToSearchSchedule,
      getHistogramTitle,
    } = useLogs();

    const { isStreamExists, isStreamFetched, getStreams, getStream } =
      useStreams();
    const queryEditorRef = ref(null);
    const syntaxGuideRef = ref(null);

    const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
      useSqlEditorDiagnostics({
        queryEditorRef,
        sqlMode: computed(() => searchObj.meta.sqlMode),
        query: computed(() => searchObj.data.query ?? ""),
        streamName: computed(() => searchObj.data.stream.selectedStream?.[0]),
        externalErrors: toRef(searchObj.data, "sqlSyntaxErrorRanges"),
      });

    const onQueryEditorFocus = () => {
      searchObj.meta.queryEditorPlaceholderFlag = false;
      _sqlOnFocus();
    };

    const handleQueryEditorBlur = async () => {
      searchObj.meta.queryEditorPlaceholderFlag = true;
      await _sqlOnBlur();
    };

    const formData: any = ref(defaultValue());
    const functionOptions = ref(searchObj.data.transforms);

    const { closeSocketWithError } = useSearchWebSocket();

    const transformsExpandState = ref({
      actions: false,
      functions: false,
    });

    const functionModel: string = ref(null);
    const fnEditorRef: any = ref(null);

    const isSavedFunctionAction: string = ref("create");
    const savedFunctionName: string = ref("");
    const savedFunctionNameError = ref("");
    const savedFunctionSelectError = ref("");
    const savedFunctionSelectedName: string = ref("");
    const saveFunctionLoader = ref(false);
    const functionUpdateConfirm = ref(false);

    const isFocused = ref(false);
    const editorContainerRef = ref<HTMLElement | null>(null);
    const fullscreenRect = ref<{ left: number; width: number; top: number } | null>(null);

    const editorFullscreenStyle = computed(() => {
      if (!isFocused.value || !fullscreenRect.value) return {};
      const { left, width, top } = fullscreenRect.value;
      return {
        position: 'fixed' as const,
        left: `${left}px`,
        width: `${width}px`,
        top: `${top}px`,
        height: `${Math.round(window.innerHeight * 0.75)}px !important`,
        zIndex: 50,
      };
    });

    const toggleEditorFullscreen = () => {
      if (!isFocused.value) {
        const el = editorContainerRef.value;
        if (el) {
          const rect = el.getBoundingClientRect();
          fullscreenRect.value = { left: rect.left, width: rect.width, top: rect.top };
        }
        isFocused.value = true;
      } else {
        isFocused.value = false;
        fullscreenRect.value = null;
      }
    };

    const confirmDialogVisible: boolean = ref(false);
    const confirmSavedViewDialogVisible: boolean = ref(false);
    const searchSchedulerJob = ref(false);
    const autoSearchSchedulerJob = ref(false);
    const searchInspectDialog = ref(false);
    const searchInspectTraceId = ref("");
    let confirmCallback;
    let streamName = "";

    const dateTimeRef = ref(null);
    const saveViewLoader = ref(false);
    const favoriteViews = ref([]);

    const localSavedViews = ref([]);
    let savedViews = useLocalSavedView();
    if (savedViews.value != null) {
      const favoriteValues = [];
      Object.values(savedViews.value).forEach((view) => {
        if (view.org_id === store.state.selectedOrganization.identifier) {
          favoriteViews.value.push(view.view_id);
          favoriteValues.push(view);
        }
      });

      localSavedViews.value.push(...favoriteValues);
    }

    const {
      autoCompleteData,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      effectiveKeywords,
      effectiveSuggestions,
      getSuggestions,
      updateFieldKeywords,
      updateFunctionKeywords,
      updateStreamKeywords,
    } = useSqlSuggestions();

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = Number(item.value);
    };

    const isSavedViewAction = ref("create");
    const savedViewName = ref("");
    const savedViewNameError = ref("");
    const savedViewSelectError = ref("");
    const savedViewSelectedName = ref("");
    const showExplainDialog = ref(false);
    const confirmDelete = ref(false);
    const deleteViewID = ref("");
    const savedViewDropdownModel = ref(false);
    const savedViewsListDialog = ref(false);
    const moreOptionsDropdownModel = ref(false);
    const searchTerm = ref("");

    const filteredFunctionOptions = computed(() => {
      if (searchObj.data.transformType !== "function") return [];
      if (!searchTerm.value) return functionOptions.value;
      return functionOptions.value.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
      );
    });

    const filteredActionOptions = computed(() => {
      if (searchObj.data.transformType !== "action") return [];
      if (!searchTerm.value) return searchObj.data.actions;
      return searchObj.data.actions.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
      );
    });

    const filteredTransformOptions = computed(() => {
      if (!searchObj.data.transformType) return [];

      if (searchObj.data.transformType === "action")
        return filteredActionOptions.value;

      if (searchObj.data.transformType === "function")
        return filteredFunctionOptions.value;

      return [];
    });

    // const toggleHistogram = ref(false);

    const toggleHistogram = computed({
      get: () => {
        return searchObj.meta.showHistogram;
      },
      set: (value) => {
        searchObj.meta.showHistogram = value;
      },
    });

    // Track if AI is currently generating SQL query
    // Updated via @generation-start / @generation-end events from QueryEditor
    const isGeneratingSQL = ref(false);

    const hasInteractedWithAI = ref(false); // Track if user has used AI in non-NLP mode
    const isNaturalLanguageDetected = ref(false); // Track NL detection without switching modes

    // Track window width for responsive toolbar layout
    const windowWidth = ref(window.innerWidth);
    const onWindowResize = () => {
      windowWidth.value = window.innerWidth;
    };

    // Responsive breakpoint: share button moves into overflow menu at narrow widths
    const shouldMoveShareToMenu = computed(() => windowWidth.value <= 1100);

    // Responsive toolbar — width tracking via shared composable
    const { toolbarLeftRef, toolbarRightRef, availableLeftWidth } = useToolbarResponsive();

    // Approximate rendered widths of left-section content at each collapse state:
    // Each threshold has a small buffer (+16px) so collapse fires before clipping.
    const shouldHideToolbarButtonText = computed(() => availableLeftWidth.value < 720);
    const toolbarToggleIconOnly       = computed(() => availableLeftWidth.value < 568);
    const shouldMoveButtonsToMenu     = computed(() => availableLeftWidth.value < 328);
    const toolbarMoveResetToMenu      = computed(() => availableLeftWidth.value < 248);
    const toolbarToggleAsDropdown     = computed(() => availableLeftWidth.value < 176);

    // Computed label/icon for the toggle-group-as-dropdown trigger
    const toggleViewOptions = computed(() => [
      { value: 'logs',      icon: 'search',   label: t('common.search'),          disabled: false },
      ...(store.state.zoConfig.timechart_enabled
        ? [{ value: 'visualize', icon: 'timeline', label: t('search.visualize'),
            disabled: !searchObj.meta.sqlMode && searchObj.data.stream.selectedStream.length > 1 }]
        : []),
      { value: 'build',     icon: 'build',    label: t('search.buildQuery'),      disabled: false },
      ...(config.isEnterprise === 'true'
        ? [{ value: 'patterns', icon: 'layers', label: t('search.showPatternsLabel'), disabled: false }]
        : []),
    ]);
    const currentToggleOption = computed(() =>
      toggleViewOptions.value.find((o) => o.value === searchObj.meta.logsVisualizeToggle)
        ?? toggleViewOptions.value[0],
    );

    const vrlEditorNlpMode = ref(false); // Track VRL editor's AI mode

    const confirmUpdate = ref(false);
    const updateViewObj = ref({});

    const transformTypes = computed(() => {
      return [
        { label: "Function", value: "function" },
        { label: "Action", value: "action" },
      ];
    });

    const showFunctionEditor = computed(() => {
      // IF actions are disabled, we are reverting to the old behavior of function editor
      if (!isActionsEnabled.value) return searchObj.meta.showTransformEditor;

      return searchObj.data.transformType === "function";
    });

    // Check if VRL editor should be disabled (in visualize mode with non-table chart)
    const isVrlEditorDisabled = computed(() => {
      return (
        searchObj.meta.logsVisualizeToggle === "visualize" &&
        dashboardPanelData.data.type !== "table"
      );
    });

    watch(
      () => searchObj.data.transforms,
      (newVal) => {
        functionOptions.value = newVal;
      },
    );

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      (fields) => {
        if (fields != undefined && fields.length) updateFieldKeywords(fields);
      },
      { immediate: true, deep: true },
    );

    watch(
      () => searchObj.data.streamResults?.list,
      (list) => {
        updateStreamKeywords((list ?? []).map((s: any) => ({ name: s.name })));
      },
      { immediate: true, deep: false },
    );
    watch(
      () => searchObj.meta.showSearchScheduler,
      (showSearchScheduler) => {
        if (showSearchScheduler) {
          searchSchedulerJob.value = true;
        }
      },
      { immediate: true, deep: true },
    );
    watch(
      () => searchObj.meta.functionEditorPlaceholderFlag,
      (val) => {
        if (
          searchObj.meta.jobId != "" &&
          val == true &&
          (router.currentRoute.value.query.functionContent ||
            searchObj.data.tempFunctionContent != "")
        ) {
          if (!checkFnQuery(searchObj.data.tempFunctionContent)) {
            toast({
              message: "Job Context have been removed",
              variant: "info",
            });
            searchObj.meta.jobId = "";
            searchObj.data.queryResults.hits = [];
            // getQueryData(false);
          }
        }
      },
      { immediate: true, deep: true },
    );
    watch(
      () => searchObj.meta.showHistogram,
      (val) => {
        if (val == true && searchObj.meta.jobId != "") {
          toast({
            message: "Histogram is not available for scheduled search",
            variant: "info",
          });
          searchObj.meta.showHistogram = false;
          searchObj.loadingHistogram = false;
        }
      },
      { immediate: true, deep: true },
    );
    watch(
      () => searchObj.data.stream.functions,
      (funs) => {
        if (funs.length) updateFunctionKeywords(funs);
      },
      { immediate: true, deep: true },
    );

    // Watch NLP mode toggle - AI mode is independent of SQL mode
    watch(
      () => searchObj.meta.nlpMode,
      (newNlpMode, oldNlpMode) => {
        if (newNlpMode === true && oldNlpMode === false) {
          // NLP mode turned ON - reset detection flag
          isNaturalLanguageDetected.value = false;
        } else if (newNlpMode === false && oldNlpMode === true) {
          // NLP mode turned OFF - reset flags
          isNaturalLanguageDetected.value = false;
          hasInteractedWithAI.value = false;
        }
      },
    );

    onBeforeUnmount(() => {
      queryEditorRef.value = null;
      fnEditorRef.value = null;
    });

    const transformsLabel = computed(() => {
      if (
        searchObj.data.selectedTransform?.type ===
          searchObj.data.transformType &&
        searchObj.data.transformType
      ) {
        return searchObj.data.selectedTransform.name;
      }

      return searchObj.data.transformType === "action"
        ? "Action"
        : searchObj.data.transformType === "function"
          ? "Function"
          : "Transform";
    });

    const actionEditorQuery = computed(() => {
      if (
        searchObj.data.transformType === "action" &&
        searchObj.data.selectedTransform?.type === "action" &&
        searchObj.data.selectedTransform?.name
      ) {
        return `${searchObj.data.selectedTransform?.name} action applied successfully. Run Query to see results.`;
      }

      return "Select an action to apply";
    });

    const updateAutoComplete = (value) => {
      autoCompleteData.value.query = value;
      autoCompleteData.value.cursorIndex =
        queryEditorRef?.value?.getCursorIndex();
      autoCompleteData.value.fieldValues = props.fieldValues;
      autoCompleteData.value.popup.open =
        queryEditorRef?.value?.triggerAutoComplete;
      // [NEW] Pass stream context for IndexedDB value lookups
      autoCompleteData.value.org = store.state.selectedOrganization.identifier;
      autoCompleteData.value.streamType =
        searchObj.data.stream.streamType ?? "logs";
      autoCompleteData.value.streamName =
        searchObj.data.stream.selectedStream?.[0] ?? "";
      getSuggestions();
    };

    const transformIcon = computed(() => {
      if (searchObj.data.transformType === "function")
        return "img:" + getImageURL("images/common/function.svg");

      if (searchObj.data.transformType === "action") return "code";

      if (!searchObj.data.transformType)
        return "img:" + getImageURL("images/common/transform.svg");
    });

    const getColumnNames = (parsedSQL: any) => {
      const columnData = parsedSQL?.columns;
      let columnNames = [];
      for (const item of columnData) {
        if (item.expr.type === "column_ref") {
          columnNames.push(item.expr.column?.expr?.value);
        } else if (item.expr.type === "aggr_func") {
          if (item.expr.args?.expr?.hasOwnProperty("column")) {
            columnNames.push(item.expr.args?.expr?.column?.value);
          } else if (item.expr.args?.expr?.value) {
            columnNames.push(item.expr.args?.expr?.value);
          }
        } else if (item.expr.type === "function") {
          item.expr.args.value.map((val) => {
            if (val.type === "column_ref") {
              columnNames.push(val.column?.expr?.value);
            }
          });
        }
      }

      if (parsedSQL?._next) {
        columnNames = [
          ...new Set([...columnNames, ...getColumnNames(parsedSQL._next)]),
        ];
      }

      return columnNames;
    };

    const updateQueryValue = (value: string, event?: any) => {
      // During stream changes, the editor's debounced onDidChangeModelContent
      // callback can re-emit a stale value after onStreamChange has cleared the
      // query. Reject these stale re-emissions to prevent the old filter from
      // reappearing in the search bar.
      if (searchObj.loadingStream) {
        return;
      }

      // if (searchObj.meta.jobId != "") {
      //   searchObj.meta.jobId = "";
      //   getQueryData(false);
      // }
      searchObj.data.editorValue = value;
      searchObj.data.query = value;

      _sqlOnQueryChange();

      // Turn off SQL mode when query is completely cleared
      if (value.trim() === "" && searchObj.meta.sqlMode === true) {
        searchObj.meta.sqlMode = false;
      }

      // Turn off SQL mode when the query is no longer a SQL statement (user
      // removed the SELECT/WITH prefix). Set sqlModeEditTransition so the
      // Index.vue watcher preserves the remaining filter expression instead of
      // clearing the editor.
      if (
        value.trim() !== "" &&
        searchObj.meta.sqlMode === true &&
        !isSqlQuery(value)
      ) {
        searchObj.meta.sqlModeEditTransition = true;
        searchObj.meta.sqlMode = false;
      }

      if (searchObj.meta.quickMode === true) {
        const parsedSQL = fnParsedSQL();
        if (
          searchObj.meta.sqlMode === true &&
          Object.hasOwn(parsedSQL, "from") &&
          isStreamFetched(searchObj.data.stream.streamType) &&
          isStreamExists(value, searchObj.data.stream.streamType)
        ) {
          setSelectedStreams(value);
          // onStreamChange(value);
        }
        if (parsedSQL != undefined && parsedSQL?.columns?.length > 0) {
          const columnNames = getColumnNames(parsedSQL);

          searchObj.data.stream.interestingFieldList = [];

          const defaultInterestingFields = new Set(
            store.state?.zoConfig?.default_quick_mode_fields || [],
          );

          for (const col of columnNames) {
            if (
              !searchObj.data.stream.interestingFieldList.includes(col) &&
              col != "*"
            ) {
              // searchObj.data.stream.interestingFieldList.push(col);
              const localInterestingFields: any = useLocalInterestingFields();
              let localFields: any = {};
              if (localInterestingFields.value != null) {
                localFields = localInterestingFields.value;
              }
              for (const stream of searchObj.data.stream
                ?.selectedStreamFields || []) {
                if (
                  stream.name == col &&
                  !searchObj.data.stream.interestingFieldList.includes(col) &&
                  col !== store.state.zoConfig?.timestamp_column
                ) {
                  const interestingFieldsCopy = [
                    ...searchObj.data.stream.interestingFieldList,
                  ];

                  searchObj.data.stream.interestingFieldList.push(col);

                  if (!defaultInterestingFields.has(col)) {
                    interestingFieldsCopy.push(col);
                  }

                  localFields[
                    searchObj.organizationIdentifier +
                      "_" +
                      searchObj.data.stream.selectedStream[0]
                  ] = interestingFieldsCopy;
                }
              }
              useLocalInterestingFields(localFields);
            }
          }

          // Add timestamp column to the interesting field list, as it is default interesting field
          searchObj.data.stream.interestingFieldList.unshift(
            store.state.zoConfig?.timestamp_column,
          );

          for (const item of searchObj.data.stream?.selectedStreamFields ||
            []) {
            if (
              searchObj.data.stream.interestingFieldList.includes(item.name)
            ) {
              item.isInterestingField = true;
            } else {
              item.isInterestingField = false;
            }
          }
        }
      }
      if (
        searchObj.meta.sqlMode === false &&
        searchObj.meta.logsVisualizeToggle !== "build" &&
        value.toLowerCase().includes("select") &&
        value.toLowerCase().includes("from")
      ) {
        searchObj.meta.sqlMode = true;
        searchObj.meta.sqlModeManualTrigger = true;
      }

      if (value != "" && searchObj.meta.sqlMode === true) {
        const parsedSQL = fnParsedSQL();
        if (
          (Object.hasOwn(parsedSQL, "from") ||
            Object.hasOwn(parsedSQL, "select")) &&
          isStreamFetched(searchObj.data.stream.streamType) &&
          isStreamExists(value, searchObj.data.stream.streamType)
        ) {
          setSelectedStreams(value);
          // onStreamChange(value);
        }
      }

      updateAutoComplete(value);
      try {
        if (searchObj.meta.sqlMode === true) {
          let parsedQuery = null;
          try {
            parsedQuery = fnParsedSQL(value);
          } catch (e) {
            console.log(e, "Logs: Error while parsing query");
          }

          if (parsedQuery?.from?.length > 0) {
            //this condition is to handle the with queries so for WITH queries the table name is not present in the from array it will be there in the with array
            //the table which is there in from array is the temporary array
            const tableName: string = !parsedQuery.with
              ? parsedQuery.from[0].table ||
                parsedQuery.from[0].expr?.ast?.from?.[0]?.table
              : "";
            if (
              !searchObj.data.stream.selectedStream.includes(tableName) &&
              tableName !== streamName
            ) {
              let streamFound = false;
              searchObj.data.stream.selectedStream = [];

              streamName = tableName;
              searchObj.data.streamResults.list.forEach((stream) => {
                if (stream.name == streamName) {
                  streamFound = true;
                  let itemObj = {
                    label: stream.name,
                    value: stream.name,
                  };

                  // searchObj.data.stream.selectedStream = itemObj;
                  searchObj.data.stream.selectedStream.push(itemObj.value);
                  onStreamChange(searchObj.data.query);
                }
              });

              if (streamFound == false) {
                // searchObj.data.stream.selectedStream = { label: "", value: "" };
                searchObj.data.stream.selectedStream = [];
                searchObj.data.stream.selectedStreamFields = [];
                // toast({
                //   message: "Stream not found",
                //   color: "info",
                //   position: "bottom-right",
                //   timeout: 2000,
                // });
              }
            }
          }
        }
        //here we reset the job id if user change the query and move outside of the editor
        if (
          searchObj.meta.jobId != "" &&
          searchObj.meta.queryEditorPlaceholderFlag == true
        ) {
          if (!checkQuery(value)) {
            toast({
              message: "Job Context have been removed",
              variant: "info",
            });
            searchObj.meta.jobId = "";
            searchObj.data.queryResults.hits = [];
            // getQueryData(false);
          }
        }
      } catch (e) {
        console.log(e, "Logs: Error while updating query value");
      }
    };
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        isFocused.value = false;
      }
    };

    // Debounced auto-run for absolute time — gives the user 2.5s to finish
    // typing start/end time before firing the query.
    const debouncedAutoRunAbsolute = debounce(() => {
      emit("searchdata");
    }, 2500);

    const debouncedAutoRunPatterns = debounce(() => {
      emit("extractPatterns");
    }, 2500);


    let ignoreAutoTrigger = false;
    // Guard against the cascade that happens when we auto-clamp an absolute
    // range that exceeds queryRangeRestrictionInHour. The clamp path calls
    // dateTimeRef.setAbsoluteTime + setDateType, each of which re-triggers
    // DateTime.vue's selectedDate watcher → saveDate → on:date-change, so
    // without this flag updateDateTime would re-enter twice.
    let suppressUpdateDateTime = false;
    const updateDateTime = async (value: object) => {
      if (suppressUpdateDateTime) return;
      ignoreAutoTrigger = searchObj.shouldIgnoreWatcher;
      if (
        value.valueType == "absolute" &&
        searchObj.data.stream.selectedStream.length > 0 &&
        searchObj.data.datetime.queryRangeRestrictionInHour > 0 &&
        value.hasOwnProperty("selectedDate") &&
        value.hasOwnProperty("selectedTime") &&
        value.selectedDate.hasOwnProperty("from") &&
        value.selectedTime.hasOwnProperty("startTime")
      ) {
        // Convert hours to microseconds
        let newStartTime =
          parseInt(value.endTime) -
          searchObj.data.datetime.queryRangeRestrictionInHour *
            60 *
            60 *
            1000000;

        if (parseInt(newStartTime) > parseInt(value.startTime)) {
          // User-visible warning so the silent rewrite isn't invisible.
          toast({
            variant: "warning",
            message: `Selected range exceeds the ${searchObj.data.datetime.queryRangeRestrictionInHour}-hour limit. Start time was adjusted to fit.`,
          });

          value.startTime = newStartTime;

          value.selectedDate.from = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "yyyy/MM/DD",
          );
          value.selectedTime.startTime = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "HH:mm",
          );

          // Suppress the re-entrant cascade: setAbsoluteTime + setDateType
          // each fire DateTime.vue's auto-apply watchers, which would call
          // updateDateTime again twice with the already-clamped values.
          suppressUpdateDateTime = true;
          try {
            dateTimeRef.value.setAbsoluteTime(value.startTime, value.endTime);
            dateTimeRef.value.setDateType("absolute");
          } finally {
            // Release on the next microtask so all queued watchers see the
            // suppress flag.
            await nextTick();
            suppressUpdateDateTime = false;
          }
        }
      }
      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: value.relativeTimePeriod
          ? value.relativeTimePeriod
          : searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
        selectedDate: value?.selectedDate,
        selectedTime: value?.selectedTime,
        queryRangeRestrictionMsg:
          searchObj.data.datetime?.queryRangeRestrictionMsg || "",
        queryRangeRestrictionInHour:
          searchObj.data.datetime?.queryRangeRestrictionInHour || 0,
      };

      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();

      if (
        value.userChangedValue !== false &&
        searchObj.loading == false &&
        store.state.zoConfig.query_on_stream_selection == false &&
        searchObj.meta.logsVisualizeToggle === "logs" &&
        searchObj.data.stream.selectedStream.length > 0
      ) {
        searchObj.loading = true;
        searchObj.runQuery = true;
      }

      if (config.isCloud == "true" && value.userChangedValue) {
        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: value,
          //user_org: this.store.state.selectedOrganization.identifier,
          //user_id: this.store.state.userInfo.email,
          stream_name: searchObj.data.stream.selectedStream.join(","),
          page: "Search Logs",
        });
      }

      if (
        value.valueType === "relative" &&
        store.state.zoConfig.query_on_stream_selection == false &&
        searchObj.meta.logsVisualizeToggle === "logs"
      ) {
        emit("searchdata");
        return;
      }

      if (
        searchObj.meta.liveMode &&
        ignoreAutoTrigger == false &&
        searchObj.meta.logsVisualizeToggle === "logs"
      ) {
        if (value.valueType === "absolute") {
          debouncedAutoRunAbsolute();
        } else {
          emit("searchdata");
        }
      }

      // Patterns tab: re-run when auto-run is enabled (live or non-live)
      if (
        store.state.zoConfig.auto_query_enabled &&
        searchObj.meta.logsVisualizeToggle === "patterns" &&
        searchObj.loading == false &&
        ignoreAutoTrigger == false
      ) {
        if (searchObj.meta.liveMode && value.valueType === "absolute") {
          debouncedAutoRunPatterns();
        } else {
          emit("extractPatterns");
        }
      }
    };

    const updateTimezone = () => {
      if (store.state.zoConfig.query_on_stream_selection == false) {
        emit("onChangeTimezone");
      }
    };

    const updateQuery = () => {
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(searchObj.data.query);
    };

    const downloadLogs = async (data, format) => {
      //here we are using a package json2csv which converts json to csv data
      //why package because we faced one issue where user has , in some of the fields so
      //it is treating it as seperate fields
      //eg: {body:"hey this is the email body , with some info in it "}
      //after converting it will treat hey this is the email body this as the body and remaining will be the next column
      //to solve this issue we are using json2csv package

      if (!data || data.length === 0) {
        toast({
          message: "No data found to download.",
          variant: "warning",
        });
        return;
      }

      try {
        let filename = "logs-data";
        let dataobj;
        const options = {
          emptyFieldValue: "",
        };

        if (format === "csv") {
          filename += ".csv";
          dataobj = await json2csv(data, options);
        } else {
          filename += ".json";
          dataobj = JSON.stringify(data, null, 2);
        }
        if (format === "csv") {
          dataobj = new Blob([dataobj], { type: "text/csv" });
        } else {
          dataobj = new Blob([dataobj], { type: "application/json" });
        }
        const file = new File([dataobj], filename, {
          type: format === "csv" ? "text/csv" : "application/json",
        });
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showDownloadMenu.value = false;
      } catch (error) {
        showDownloadMenu.value = false;
        toast({
          variant: "error",
          message: "Error downloading logs",
        });
      }
    };

    onMounted(async () => {
      searchObj.data.transformType =
        router.currentRoute.value.query.transformType || "function";

      if (
        router.currentRoute.value.query.transformType === "function" &&
        (router.currentRoute.value.query.functionContent ||
          searchObj.data.tempFunctionContent)
      ) {
        const fnContent = router.currentRoute.value.query.functionContent
          ? b64DecodeUnicode(router.currentRoute.value.query.functionContent)
          : searchObj.data.tempFunctionContent;
        fnEditorRef?.value?.setValue(fnContent);
      }

      updateEditorWidth();

      window.addEventListener("keydown", handleEscKey);
      window.addEventListener("resize", onWindowResize);

    });

    onUnmounted(() => {
      window.removeEventListener("click", () => {
        fnEditorRef?.value?.resetEditorLayout();
      });
      window.removeEventListener("keydown", handleEscKey);
      window.removeEventListener("resize", onWindowResize);
    });

    onActivated(() => {
      updateQuery();

      updateEditorWidth();

      if (
        (router.currentRoute.value.query.functionContent ||
          searchObj.data.tempFunctionContent) &&
        searchObj.data.transformType === "function"
      ) {
        const fnContent = router.currentRoute.value.query.functionContent
          ? b64DecodeUnicode(router.currentRoute.value.query.functionContent)
          : searchObj.data.tempFunctionContent;
        fnEditorRef?.value?.setValue(fnContent);
        fnEditorRef?.value?.resetEditorLayout();
        window.removeEventListener("click", () => {
          fnEditorRef?.value?.resetEditorLayout();
        });
      }

      fnEditorRef?.value?.resetEditorLayout();
    });

    onDeactivated(() => {
      window.removeEventListener("click", () => {
        fnEditorRef?.value?.resetEditorLayout();
      });
    });

    const saveFunction = () => {
      saveFunctionLoader.value = true;
      let callTransform: Promise<{ data: any }>;
      const content = searchObj.data.tempFunctionContent;
      let fnName = "";
      if (isSavedFunctionAction.value == "create") {
        fnName = savedFunctionName.value;
        if (!fnName.trim()) {
          savedFunctionNameError.value = "This field is required";
          saveFunctionLoader.value = false;
          return;
        }
        const pattern = /^[a-zA-Z][a-zA-Z0-9_]*$/;
        if (!pattern.test(fnName)) {
          savedFunctionNameError.value = "Input must be alphanumeric";
          saveFunctionLoader.value = false;
          return;
        }
      } else {
        if (!savedFunctionSelectedName.value) {
          savedFunctionSelectError.value = "Field is required!";
          saveFunctionLoader.value = false;
          return;
        }
        fnName = savedFunctionSelectedName.value;
      }

      if (content.trim() == "") {
        toast({
          variant: "warning",
          message:
            "The function field must contain a value and cannot be left empty.",
        });
        saveFunctionLoader.value = false;
        return;
      }

      formData.value.params = "row";
      formData.value.function = content;
      formData.value.transType = 0;
      formData.value.name = fnName;
      searchObj.data.tempFunctionContent = content;

      // const result = functionOptions.value.find((obj) => obj.name === fnName);
      if (isSavedFunctionAction.value == "create") {
        callTransform = jsTransformService.create(
          store.state.selectedOrganization.identifier,
          formData.value,
        );

        callTransform
          .then((res: { data: any }) => {
            toast({
              variant: "success",
              message: res.data.message,
            });

            functionModel.value = {
              name: formData.value.name,
              function: formData.value.function,
            };
            functionOptions.value.push({
              name: formData.value.name,
              function: formData.value.function,
              transType: 0,
              params: "row",
            });
            store.dispatch("setSavedFunctionDialog", false);
            isSavedFunctionAction.value = "create";
            savedFunctionName.value = "";
            saveFunctionLoader.value = false;
            savedFunctionSelectedName.value = "";
          })
          .catch((err) => {
            saveFunctionLoader.value = false;
            toast({
              variant: "error",
              message:
                JSON.stringify(err.response.data["message"]) ||
                "Function creation failed",
              timeout: 5000,
            });
          });
      } else {
        // Validate, set up formData, then show the teleported confirmation overlay
        saveFunctionLoader.value = false;
        functionUpdateConfirm.value = true;
        return;
      }
    };

    const executeFunctionUpdate = () => {
      saveFunctionLoader.value = true;
      const callTransform = jsTransformService.update(
        store.state.selectedOrganization.identifier,
        formData.value,
      );

      callTransform
        .then((res: { data: any }) => {
          toast({
            variant: "success",
            message: "Function updated successfully.",
          });

          const transformIndex = searchObj.data.transforms.findIndex(
            (obj) => obj.name === formData.value.name,
          );
          if (transformIndex !== -1) {
            searchObj.data.transforms[transformIndex].name =
              formData.value.name;
            searchObj.data.transforms[transformIndex].function =
              formData.value.function;
          }

          functionOptions.value = searchObj.data.transforms;
          store.dispatch("setSavedFunctionDialog", false);
          functionUpdateConfirm.value = false;
          isSavedFunctionAction.value = "create";
          savedFunctionName.value = "";
          saveFunctionLoader.value = false;
          savedFunctionSelectedName.value = "";
        })
        .catch((err) => {
          functionUpdateConfirm.value = false;
          saveFunctionLoader.value = false;
          toast({
            variant: "error",
            message:
              JSON.stringify(err.response.data["message"]) ||
              "Function updation failed",
            timeout: 5000,
          });
        });
    };

    const resetFunctionContent = () => {
      fnEditorRef?.value?.setValue("");
      store.dispatch("setSavedFunctionDialog", false);
      functionUpdateConfirm.value = false;
      isSavedFunctionAction.value = "create";
      savedFunctionName.value = "";
      saveFunctionLoader.value = false;
      savedFunctionSelectedName.value = "";
    };

    const resetEditorLayout = () => {
      setTimeout(() => {
        queryEditorRef?.value?.resetEditorLayout();
        fnEditorRef?.value?.resetEditorLayout();
      }, 100);
    };

    const applyAction = (actionId) => {
      searchObj.data.actionId = actionId.id;
    };

    const populateFunctionImplementation = (
      fnValue,
      flag = false,
      openEditor = true,
    ) => {
      if (flag) {
        toast({
          variant: "success",
          message: `${fnValue.name} function applied successfully.`,
        });
      }

      if (openEditor) {
        searchObj.meta.showTransformEditor = true;
        searchObj.config.fnSplitterModel = 60;
      }
      fnEditorRef?.value?.setValue(fnValue.function);
      searchObj.data.tempFunctionName = fnValue.name;
      searchObj.data.tempFunctionContent = fnValue.function;

      if (store.state.zoConfig?.auto_query_enabled && searchObj.meta.liveMode) {
        emit("searchdata");
      }
    };

    const fnSavedFunctionDialog = () => {
      const content = searchObj.data.tempFunctionContent;
      if (content == "") {
        toast({
          variant: "error",
          message: "No function definition found.",
        });
        return;
      }
      store.dispatch("setSavedFunctionDialog", true);
      isSavedFunctionAction.value = "create";
      savedFunctionName.value = "";
      saveFunctionLoader.value = false;
      savedFunctionSelectedName.value = "";
    };

    const showConfirmDialog = (callback) => {
      confirmDialogVisible.value = true;
      confirmCallback = callback;
    };

    const showSavedViewConfirmDialog = (callback) => {
      confirmSavedViewDialogVisible.value = true;
      confirmCallback = callback;
    };

    const cancelConfirmDialog = () => {
      confirmSavedViewDialogVisible.value = false;
      confirmDialogVisible.value = false;
      confirmCallback = null;
    };

    const confirmDialogOK = () => {
      if (confirmCallback) {
        confirmCallback();
      }
      confirmDialogVisible.value = false;
      confirmCallback = null;
    };

    const filterFn = (val, update) => {
      update(() => {
        if (val === "") {
          functionOptions.value = searchObj.data.transforms;
        } else {
          const needle = val.toLowerCase();
          functionOptions.value = searchObj.data.transforms.filter(
            (v) => v.name?.toLowerCase().indexOf(needle) > -1,
          );
        }
      });
    };

    const onRefreshIntervalUpdate = () => {
      emit("onChangeInterval");
    };

    const fnSavedView = () => {
      if (searchObj.data.stream.selectedStream.length == 0) {
        toast({
          variant: "error",
          message: "No stream available to save view.",
        });
        return;
      }
      store.dispatch("setSavedViewDialog", true);
      isSavedViewAction.value = "create";
      savedViewName.value = "";
      saveViewLoader.value = false;
      savedViewSelectedName.value = "";
      savedViewDropdownModel.value = false;
    };

    const openSavedViewsList = () => {
      loadSavedView();
      savedViewsListDialog.value = true;
    };

    // Common function to restore visualization data and sync to URL
    const restoreVisualizationData = async (visualizationData) => {
      if (!visualizationData) return;

      // Restore visualization config to dashboardPanelData
      if (visualizationData.config) {
        dashboardPanelData.data.config = visualizationData.config;
      }
      if (visualizationData.type) {
        dashboardPanelData.data.type = visualizationData.type;
      }

      // Sync visualization data to URL
      const currentVisualizationData =
        getVisualizationConfig(dashboardPanelData);
      if (currentVisualizationData) {
        const encoded = encodeVisualizationConfig(currentVisualizationData);
        if (encoded) {
          const currentQuery = { ...router.currentRoute.value.query };
          currentQuery.visualization_data = encoded;

          await router.replace({
            name: router.currentRoute.value.name,
            query: currentQuery,
          });
        }
      }
    };

    const applySavedView = async (item) => {
      savedViewDropdownModel.value = false;
      await cancelQuery();
      searchObj.shouldIgnoreWatcher = true;
      searchObj.meta.sqlMode = false;
      savedviewsService
        .getViewDetail(
          store.state.selectedOrganization.identifier,
          item.view_id,
        )
        .then(async (res) => {
          if (res.status == 200) {
            store.dispatch("setSavedViewFlag", true);
            const extractedObj = res.data.data;

            // Resetting columns as its not required in searchObj
            // As we reassign columns from selectedFields and search results
            extractedObj.data.resultGrid.columns = [];

            // As in saved view, we observed field getting duplicated in selectedFields
            // So, we are removing duplicates before applying saved view
            if (extractedObj.data.stream.selectedFields?.length) {
              extractedObj.data.stream.selectedFields = [
                ...new Set(extractedObj.data.stream.selectedFields),
              ];
            }

            if (extractedObj.data?.timezone) {
              store.dispatch("setTimezone", extractedObj.data.timezone);
            }

            if (!extractedObj.data.stream.hasOwnProperty("streamType")) {
              extractedObj.data.stream.streamType = "logs";
            }

            delete searchObj.data.queryResults.aggs;

            if (
              searchObj.data.stream.streamType ==
              extractedObj.data.stream.streamType
            ) {
              // if (
              //   extractedObj.data.stream.selectedStream.value !=
              //   searchObj.data.stream.selectedStream.value
              // ) {
              //   extractedObj.data.stream.streamLists =
              //     searchObj.data.stream.streamLists;
              // }
              // ----- Here we are explicitly handling stream change for multistream -----
              let selectedStreams = [];
              const streamValues = searchObj.data.stream.streamLists.map(
                (item) => item.value,
              );
              if (typeof extractedObj.data.stream.selectedStream == "object") {
                if (
                  extractedObj.data.stream.selectedStream.hasOwnProperty(
                    "value",
                  )
                ) {
                  selectedStreams.push(
                    extractedObj.data.stream.selectedStream.value,
                  );
                } else {
                  selectedStreams.push(
                    ...extractedObj.data.stream.selectedStream,
                  );
                }
              } else {
                selectedStreams.push(extractedObj.data.stream.selectedStream);
              }
              const streamNotExist = selectedStreams.filter(
                (stream_str) => !streamValues.includes(stream_str),
              );
              if (streamNotExist.length > 0) {
                let errMsg = t("search.streamNotExist").replace(
                  "[STREAM_NAME]",
                  streamNotExist,
                );
                throw new Error(errMsg);
                return;
              }
              // extractedObj.data.stream.selectedStream = [];
              // extractedObj.data.stream.selectedStream = selectedStreams;
              delete extractedObj.data.stream.streamLists;
              delete extractedObj.data.stream.selectedStream;
              delete searchObj.data.stream.selectedStream;
              delete searchObj.meta.regions;
              if (extractedObj.meta.hasOwnProperty("regions")) {
                searchObj.meta["regions"] = extractedObj.meta.regions;
              } else {
                searchObj.meta["regions"] = [];
              }
              delete searchObj.data.queryResults.aggs;
              delete searchObj.data.stream.interestingFieldList;
              searchObj.data.stream.selectedStream = [];
              extractedObj.data.transforms = searchObj.data.transforms;
              extractedObj.data.stream.functions =
                searchObj.data.stream.functions;
              extractedObj.data.histogram = {
                xData: [],
                yData: [],
                chartParams: {},
              };
              extractedObj.data.savedViews = searchObj.data.savedViews;
              extractedObj.data.queryResults = [];
              extractedObj.meta.scrollInfo = {};
              //here we are merging deep to the searchObj with the extractedObj
              mergeDeep(searchObj, extractedObj);
              searchObj.shouldIgnoreWatcher = true;

              // Restore visualization data if available
              if (extractedObj.data.visualizationData) {
                await restoreVisualizationData(
                  extractedObj.data.visualizationData,
                );
              }
              // await nextTick();
              if (extractedObj.data.tempFunctionContent != "") {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: extractedObj.data.tempFunctionContent,
                  },
                  false,
                  extractedObj.meta.showTransformEditor, // Use saved view's editor state
                );
                searchObj.data.tempFunctionContent =
                  extractedObj.data.tempFunctionContent;
                searchObj.meta.functionEditorPlaceholderFlag = false;
                searchObj.data.transformType = "function";
                if (showFunctionEditor.value)
                  searchObj.meta.showTransformEditor = true;
              } else {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: "",
                  },
                  false,
                  extractedObj.meta.showTransformEditor, // No function content, so don't open editor
                );
                searchObj.data.tempFunctionContent = "";
                searchObj.meta.functionEditorPlaceholderFlag = true;
              }

              //here we are getting data so we need to check here
              //before we set the time to the dateTimeRef.value we need to check if the startTime and endTime difference is greater than maxQueryRange in hours
              //solution will be we will do endTime - startTime and convert that difference into hours and check with both global and stream level maxQueryRange and if it is less than or equal to that we will keep that as it is
              //if that exceeds the maxQueryRange we will convert that to relative type (because we cannot assume the start and end date) or we can do that by converting present time - maxQueryRange

              // Validate and adjust time range based on maxQueryRange
              //before we check all this we need to get the current selected stream max query range and also global max query range
              //we need to compare so if max query range of stream is there we will use that otherwise we will use the global max query if both are not present
              //we will skip this below process

              // Get max query range for all selected streams and take the minimum
              // Preference: stream max query range > global max query range
              const globalMaxQueryRange =
                store.state.zoConfig.max_query_range || 0;
              let effectiveMaxQueryRange = -1;

              if (selectedStreams && selectedStreams.length > 0) {
                // Fetch all stream data in parallel
                const streamDataPromises = selectedStreams.map((streamName) =>
                  getStream(
                    streamName,
                    searchObj.data.stream.streamType,
                    false,
                  ),
                );

                try {
                  const streamDataList = await Promise.all(streamDataPromises);

                  // Extract max_query_range from each stream's settings
                  const streamMaxQueryRanges = streamDataList
                    .map(
                      (streamData) =>
                        streamData?.settings?.max_query_range || 0,
                    )
                    .filter((range) => range > 0); // Only consider positive values

                  // If we have stream-specific max query ranges, find the minimum (stream takes preference)
                  if (streamMaxQueryRanges.length > 0) {
                    effectiveMaxQueryRange = Math.min(...streamMaxQueryRanges);
                  } else if (globalMaxQueryRange > 0) {
                    // No stream-specific ranges, fall back to global max query range
                    effectiveMaxQueryRange = globalMaxQueryRange;
                  }
                } catch (error) {
                  // On error, fall back to global max query range
                  effectiveMaxQueryRange =
                    globalMaxQueryRange > 0 ? globalMaxQueryRange : -1;
                }
              } else if (globalMaxQueryRange > 0) {
                // No selected streams, use global max query range
                effectiveMaxQueryRange = globalMaxQueryRange;
              }

              // Validate and adjust time range if effective max query range exists
              if (
                effectiveMaxQueryRange > 0 &&
                searchObj.data.datetime?.startTime &&
                searchObj.data.datetime?.endTime
              ) {
                // Calculate time difference in hours
                const startTimeMicros = parseInt(
                  searchObj.data.datetime.startTime,
                );
                const endTimeMicros = parseInt(searchObj.data.datetime.endTime);
                const timeDiffInHours =
                  (endTimeMicros - startTimeMicros) / (60 * 60 * 1000000);

                // Check if time difference exceeds effective max query range
                if (timeDiffInHours > effectiveMaxQueryRange) {
                  // Adjust to current time - maxQueryRange
                  const currentTimeMicros = Date.now() * 1000; // Convert milliseconds to microseconds
                  const maxQueryRangeMicros =
                    effectiveMaxQueryRange * 60 * 60 * 1000000;

                  const adjustedStartTime =
                    currentTimeMicros - maxQueryRangeMicros;
                  const adjustedEndTime = currentTimeMicros;

                  // Get the current datetime type
                  const currentType =
                    searchObj.data.datetime.type || "relative";

                  // Build the complete datetime object with all required fields
                  const updatedDateTime = buildDateTimeObject(
                    adjustedStartTime,
                    adjustedEndTime,
                    currentType,
                  );

                  // Update searchObj.data.datetime with all fields
                  searchObj.data.datetime.startTime = adjustedStartTime;
                  searchObj.data.datetime.endTime = adjustedEndTime;

                  if (currentType === "relative") {
                    // For relative type, update relativeTimePeriod
                    searchObj.data.datetime.relativeTimePeriod =
                      updatedDateTime.relativeTimePeriod;
                  } else if (currentType === "absolute") {
                    // For absolute type, update selectedDate and selectedTime
                    searchObj.data.datetime.selectedDate =
                      updatedDateTime.selectedDate;
                    searchObj.data.datetime.selectedTime =
                      updatedDateTime.selectedTime;
                    searchObj.data.datetime.relativeTimePeriod = null;
                  }
                }
              }

              dateTimeRef.value.setSavedDate(searchObj.data.datetime);
              if (searchObj.meta.refreshInterval != "0") {
                onRefreshIntervalUpdate();
              } else {
                clearInterval(store.state.refreshIntervalID);
              }
              searchObj.data.stream.selectedStream.push(...selectedStreams);
              // we dont need to update local log filter field because
              // if visualize is there for any saved views we will get right any previous local filter fields
              // they will get applied to the current visualize selected stream
              // so we need to make sure we dont update that local filter fields when it is visualize
              if (extractedObj.meta.logsVisualizeToggle == "logs") {
                await updatedLocalLogFilterField();
              }
              await getStreams("logs", true);
            } else {
              // ----- Here we are explicitly handling stream change -----
              resetStreamData();
              searchObj.data.stream.streamType =
                extractedObj.data.stream.streamType;

              delete searchObj.meta.regions;
              if (extractedObj.meta.hasOwnProperty("regions")) {
                searchObj.meta["regions"] = extractedObj.meta.regions;
              } else {
                searchObj.meta["regions"] = [];
              }
              // Here copying selected stream object, as in loadStreamLists() we are setting selected stream object to empty object
              // After loading stream list, we are setting selected stream object to copied object
              // const selectedStream = cloneDeep(
              //   extractedObj.data.stream.selectedStream
              // );
              let selectedStreams = [];
              if (typeof extractedObj.data.stream.selectedStream == "object") {
                if (
                  extractedObj.data.stream.selectedStream.hasOwnProperty(
                    "value",
                  )
                ) {
                  selectedStreams.push(
                    extractedObj.data.stream.selectedStream.value,
                  );
                } else {
                  selectedStreams.push(
                    ...extractedObj.data.stream.selectedStream,
                  );
                }
              } else {
                selectedStreams.push(extractedObj.data.stream.selectedStream);
              }

              extractedObj.data.transforms = searchObj.data.transforms;
              extractedObj.data.histogram = {
                xData: [],
                yData: [],
                chartParams: {},
              };
              extractedObj.data.savedViews = searchObj.data.savedViews;
              extractedObj.data.queryResults = [];
              extractedObj.meta.scrollInfo = {};
              delete searchObj.data.queryResults.aggs;

              mergeDeep(searchObj, extractedObj);
              searchObj.data.streamResults = {};

              // Restore visualization data if available
              if (extractedObj.data.visualizationData) {
                await restoreVisualizationData(
                  extractedObj.data.visualizationData,
                );
              }

              const streamData = await getStreams(
                searchObj.data.stream.streamType,
                true,
              );
              searchObj.data.streamResults = streamData;
              await loadStreamLists();
              searchObj.data.stream.selectedStream = [selectedStreams];

              const streamValues = searchObj.data.stream.streamLists.map(
                (item) => item.value,
              );
              const streamNotExist = selectedStreams.filter(
                (stream_str) => !streamValues.includes(stream_str),
              );
              if (streamNotExist.length > 0) {
                let errMsg = t("search.streamNotExist").replace(
                  "[STREAM_NAME]",
                  streamNotExist,
                );
                throw new Error(errMsg);
                return;
              }
              // await nextTick();
              if (extractedObj.data.tempFunctionContent != "") {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: extractedObj.data.tempFunctionContent,
                  },
                  false,
                  extractedObj.meta.showTransformEditor, // Use saved view's editor state
                );
                searchObj.data.tempFunctionContent =
                  extractedObj.data.tempFunctionContent;
                searchObj.meta.functionEditorPlaceholderFlag = false;
              } else {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: "",
                  },
                  false,
                  false, // No function content, so don't open editor
                );
                searchObj.data.tempFunctionContent = "";
                searchObj.meta.functionEditorPlaceholderFlag = true;
              }
              dateTimeRef.value.setSavedDate(searchObj.data.datetime);
              if (searchObj.meta.refreshInterval != "0") {
                onRefreshIntervalUpdate();
              } else {
                clearInterval(store.state.refreshIntervalID);
              }
              // we dont need to update local log filter field because
              // if visualize is there for any saved views we will get right any previous local filter fields
              // they will get applied to the current visualize selected stream
              // so we need to make sure we dont update that local filter fields when it is visualize
              if (extractedObj.meta.logsVisualizeToggle == "logs") {
                await updatedLocalLogFilterField();
              }
            }

            // Only reset function content if there's no function in the saved view
            if (
              searchObj.meta.toggleFunction == false &&
              !extractedObj.data.tempFunctionContent
            ) {
              searchObj.config.fnSplitterModel = 100;
              resetFunctionContent();
            }

            updateEditorWidth();

            toast({
              message: `${item.view_name} view applied successfully.`,
              variant: "success",
            });
            setTimeout(async () => {
              try {
                searchObj.loadingHistogram = false;
                searchObj.loading = true;
                searchObj.meta.refreshHistogram = true;
                // TODO OK: Remove all the instances of communicationMethod and below assignment aswell
                searchObj.communicationMethod = "streaming";
                await extractFields();
                await getQueryData();
                store.dispatch("setSavedViewFlag", false);
                updateUrlQueryParams();
                searchObj.shouldIgnoreWatcher = false;
              } catch (e) {
                searchObj.shouldIgnoreWatcher = false;
                console.log("Error while applying saved view", e);
              }
            }, 1000);

            if (
              extractedObj.data.resultGrid.colOrder &&
              extractedObj.data.resultGrid.colOrder.hasOwnProperty(
                searchObj.data.stream.selectedStream,
              )
            ) {
              searchObj.data.stream.selectedFields =
                extractedObj.data.resultGrid.colOrder[
                  searchObj.data.stream.selectedStream
                ].filter(
                  (_field) =>
                    _field !==
                    (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
                );
            } else {
              searchObj.data.stream.selectedFields =
                extractedObj.data.stream.selectedFields;
            }

            if (
              extractedObj.data.resultGrid.colSizes &&
              extractedObj.data.resultGrid.colSizes.hasOwnProperty(
                searchObj.data.stream.selectedStream,
              )
            ) {
              searchObj.data.resultGrid.colSizes[
                searchObj.data.stream.selectedStream
              ] =
                extractedObj.data.resultGrid.colSizes[
                  searchObj.data.stream.selectedStream
                ];
            }
          } else {
            searchObj.shouldIgnoreWatcher = false;
            store.dispatch("setSavedViewFlag", false);
            toast({
              message: err.message || `Error while applying saved view.`,
              variant: "error",
            });
          }
        })
        .catch((err) => {
          searchObj.shouldIgnoreWatcher = false;
          store.dispatch("setSavedViewFlag", false);
          toast({
            message: `Error while applying saved view.`,
            variant: "error",
          });
          console.log("Error while applying saved view", err);
        });
    };

    const handleSavedView = () => {
      if (isSavedViewAction.value == "create") {
        if (!savedViewName.value.trim()) {
          savedViewNameError.value = "This field is required";
          return;
        }
        if (!/^[A-Za-z0-9 _-]+$/.test(savedViewName.value)) {
          savedViewNameError.value = "Input must be alphanumeric";
          return;
        }
        saveViewLoader.value = true;
        createSavedViews(savedViewName.value);
      } else {
        if (!savedViewSelectedName.value) {
          savedViewSelectError.value = "Field is required!";
          return;
        }
      }
      //  else {
      //   if (savedViewSelectedName.value.view_id) {
      //     saveViewLoader.value = false;
      //     showSavedViewConfirmDialog(() => {
      //       saveViewLoader.value = true;
      //       updateSavedViews(
      //         savedViewSelectedName.value.view_id,
      //         savedViewSelectedName.value.view_name,
      //       );
      //     });
      //   } else {
      //     toast({
      //       message: `Please select saved view to update.`,
      //       color: "negative",
      //       position: "bottom-right",
      //       timeout: 1000,
      //     });
      //   }
      // }
    };

    const deleteSavedViews = async () => {
      try {
        savedviewsService
          .delete(
            store.state.selectedOrganization.identifier,
            deleteViewID.value,
          )
          .then((res) => {
            //remove it from localstorage as well
            const localStoredSavedViews = JSON.parse(
              localStorage.getItem("savedViews") || "[]",
            );
            delete localStoredSavedViews[deleteViewID.value];
            favoriteViews.value.forEach((item: any) => {
              //remove it from favorite views list because we dont need to show it in the favorite views list
              if (item == deleteViewID.value) {
                favoriteViews.value.splice(
                  favoriteViews.value.indexOf(item),
                  1,
                );
              }
            });
            //remove it from local saved views list because we dont need to show it in the local saved views list
            localSavedViews.value = localSavedViews.value.filter(
              (item: any) => item.view_id !== deleteViewID.value,
            );
            localStorage.setItem(
              "savedViews",
              JSON.stringify(localStoredSavedViews),
            );
            //we are deleting the local storage item and also we are removing the item from the favoriteViews array
            if (res.status == 200) {
              toast({
                message: t("search.viewDeletedSuccessfully"),
                variant: "success",
              });
              getSavedViews();
            } else {
              toast({
                message: `${t("search.errorDeletingSavedView")} ${res.data.error_detail}`,
                variant: "error",
              });
            }
          })
          .catch((err) => {
            toast({
              message: t("search.errorDeletingSavedView"),
              variant: "error",
            });
            console.log("Error while deleting saved view", err);
          });
      } catch (e: any) {
        console.log("Error while getting saved views", e);
      }
    };

    const getSearchObj = () => {
      try {
        delete searchObj.meta.scrollInfo;
        delete searchObj?.value;
        let savedSearchObj = toRaw(searchObj);
        savedSearchObj = JSON.parse(JSON.stringify(savedSearchObj));

        delete savedSearchObj.data.queryResults;
        delete savedSearchObj.data.histogram;
        delete savedSearchObj.data.sortedQueryResults;
        delete savedSearchObj.data.stream.streamLists;
        delete savedSearchObj.data.stream.functions;
        delete savedSearchObj.data.streamResults;
        delete savedSearchObj.data.savedViews;
        delete savedSearchObj.data.transforms;

        // Turn off all loaders before saving view
        savedSearchObj.loading = false;
        savedSearchObj.loadingHistogram = false;
        savedSearchObj.loadingCounter = false;
        savedSearchObj.loadingStream = false;
        savedSearchObj.loadingSavedView = false;

        savedSearchObj.data.timezone = store.state.timezone;

        if (savedSearchObj.data.parsedQuery) {
          delete savedSearchObj.data.parsedQuery;
        }

        // Include visualization data if in visualization mode
        if (
          searchObj.meta.logsVisualizeToggle === "visualize" &&
          dashboardPanelData
        ) {
          const visualizationData = getVisualizationConfig(dashboardPanelData);
          if (visualizationData) {
            savedSearchObj.data.visualizationData = visualizationData;
          }
        }

        return savedSearchObj;
        // return b64EncodeUnicode(JSON.stringify(savedSearchObj));
      } catch (e) {
        console.log("Error while encoding search obj", e);
      }
    };

    const createSavedViews = (viewName: string) => {
      try {
        if (viewName.trim() == "") {
          toast({
            message: `Please provide valid view name.`,
            variant: "warning",
          });
          saveViewLoader.value = false;
          return;
        }

        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        savedviewsService
          .post(store.state.selectedOrganization.identifier, viewObj)
          .then((res) => {
            if (res.status == 200) {
              store.dispatch("setSavedViewDialog", false);
              if (searchObj.data.hasOwnProperty("savedViews") == false) {
                searchObj.data.savedViews = [];
              }
              searchObj.data.savedViews.push({
                org_id: res.data.org_id,
                payload: viewObj.data,
                view_id: res.data.view_id,
                view_name: viewName,
              });
              toast({
                message: t("search.viewCreatedSuccessfully"),
                variant: "success",
              });
              getSavedViews();
              isSavedViewAction.value = "create";
              savedViewName.value = "";
              saveViewLoader.value = false;
            } else {
              saveViewLoader.value = false;
              toast({
                message: `${t("search.errorCreatingSavedView")} ${res.data.error_detail}`,
                variant: "error",
              });
            }
          })
          .catch((err) => {
            saveViewLoader.value = false;
            toast({
              message: t("search.errorCreatingSavedView"),
              variant: "error",
            });
            console.log("Error while creating saved view", err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        savedViewName.value = "";
        saveViewLoader.value = false;
        toast({
          message: `Error while saving view: ${e}`,
          variant: "error",
        });
        console.log("Error while saving view", e);
      }
    };

    const updateSavedViews = (viewID: string, viewName: string) => {
      try {
        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        const dismiss = toast({
          message: "Updating saved view...",
          variant: "loading",
          timeout: 0,
        });

        savedviewsService
          .put(store.state.selectedOrganization.identifier, viewID, viewObj)
          .then((res) => {
            dismiss();
            if (res.status == 200) {
              store.dispatch("setSavedViewDialog", false);
              //update the payload and view_name in savedViews object based on id
              searchObj.data.savedViews.forEach(
                (item: { view_id: string }, index: string | number) => {
                  if (item.view_id == viewID) {
                    searchObj.data.savedViews[index].payload = viewObj.data;
                    searchObj.data.savedViews[index].view_name = viewName;
                  }
                },
              );

              toast({
                message: t("search.viewUpdatedSuccessfully"),
                variant: "success",
              });
              isSavedViewAction.value = "create";
              savedViewSelectedName.value = "";
              saveViewLoader.value = false;
              confirmSavedViewDialogVisible.value = false;
            } else {
              saveViewLoader.value = false;
              toast({
                message: `${t("search.errorUpdatingSavedView")} ${res.data.error_detail}`,
                variant: "error",
              });
            }
          })
          .catch((err) => {
            dismiss();
            saveViewLoader.value = false;
            toast({
              message: t("search.errorUpdatingSavedView"),
              variant: "error",
            });
            console.log("Error while updating saved view", err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        savedViewSelectedName.value = "";
        saveViewLoader.value = false;
        toast({
          message: `Error while saving view: ${e}`,
          variant: "error",
        });
        console.log("Error while saving view", e);
      }
    };

    /**
     * Computed property for share URL
     * Generates the full shareable URL with all query parameters
     */
    const shareURL = computed(() => {
      const queryObj = generateURLQuery(true, dashboardPanelData);
      // Removed the 'type' property from the object to avoid issues when navigating from the stream to the logs page,
      // especially when the user performs multi-select on streams and shares the URL.
      delete queryObj?.type;
      const queryString = Object.entries(queryObj)
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
        )
        .join("&");

      let url = window.location.origin + window.location.pathname;

      if (queryString != "") {
        url += "?" + queryString;
      }

      return url;
    });
    const showSearchHistoryfn = () => {
      emit("showSearchHistory");
    };

    const QUERY_TEMPLATE = 'SELECT [FIELD_LIST] FROM "[STREAM_NAME]"';

    function getFieldList(
      stream,
      streamFields,
      interestingFields,
      isQuickMode,
    ) {
      searchObj.data.streamResults.list.forEach((item) => {
        if (
          item.name == stream &&
          Object.hasOwn(item, "schema") &&
          item.schema.length > 0
        ) {
          streamFields = item.schema;
        }
      });
      return streamFields
        .filter((item) => interestingFields.includes(item.name))
        .map((item) => item.name);
    }

    function buildStreamQuery(stream, fieldList, isQuickMode) {
      const selectFields =
        fieldList.length > 0 && isQuickMode
          ? fieldList
              .map((field) => quoteSqlIdentifierIfNeeded(field))
              .join(",")
          : "*";

      return QUERY_TEMPLATE.replace("[STREAM_NAME]", stream).replace(
        "[FIELD_LIST]",
        selectFields,
      );
    }

    const resetFilters = () => {
      if (searchObj.meta.sqlMode == true) {
        const parsedSQL = fnParsedSQL();
        if (Object.hasOwn(parsedSQL, "from") && parsedSQL.from.length > 0) {
          if (Object.hasOwn(parsedSQL, "where") && parsedSQL.where != "") {
            parsedSQL.where = null;
          }

          if (Object.hasOwn(parsedSQL, "limit") && parsedSQL.limit != "") {
            parsedSQL.limit = null;
          }

          if (Object.hasOwn(parsedSQL, "_next") && parsedSQL._next != "") {
            parsedSQL._next.where = null;
            parsedSQL._next.limit = null;
          }

          searchObj.data.query = fnUnparsedSQL(parsedSQL);
          searchObj.data.query = searchObj.data.query.replaceAll("`", '"');
          searchObj.data.editorValue = searchObj.data.query;
        } else {
          // Handle both single and multiple stream scenarios
          const queries = searchObj.data.stream.selectedStream
            .map((stream) => {
              // Destructure for better readability
              const { selectedStreamFields, interestingFieldList } =
                searchObj.data.stream;
              const { quickMode } = searchObj.meta;

              // Generate the field list for the current stream
              const fieldList = getFieldList(
                stream,
                selectedStreamFields,
                interestingFieldList,
                quickMode,
              );

              // Ensure fieldList is valid before building the query
              if (!fieldList || fieldList.length === 0) {
                console.warn(`No fields available for stream: ${stream}`);
                return null;
              }

              // Build and return the query for the current stream
              return buildStreamQuery(stream, fieldList, quickMode);
            })
            .filter(Boolean);

          searchObj.data.query = queries.join(" UNION ALL BY NAME ");
          searchObj.data.editorValue = searchObj.data.query;
        }
      } else {
        searchObj.data.query = "";
        searchObj.data.editorValue = "";
      }

      queryEditorRef.value?.setValue(searchObj.data.query);
      updateUrlQueryParams();
      if (
        store.state.zoConfig.query_on_stream_selection == false ||
        (store.state.zoConfig.auto_query_enabled && searchObj.meta.liveMode)
      ) {
        handleRunQueryFn();
      }
    };

    const customDownloadDialog = ref(false);
    const showDownloadMenu = ref(false);
    const downloadCustomInitialNumber = ref(1);
    const downloadCustomRange = ref(100);
    const downloadCustomRangeOptions = ref([100, 500, 1000, 5000, 10000]);
    const downloadCustomFileName = ref("");
    const downloadCustomFileType = ref("csv");
    // Hover-triggered submenu state for "Download results → CSV/JSON" in the more-options dropdown.
    // Resets automatically when the parent ODropdown closes (via @update:open handler).
    const showDownloadSubmenu = ref(false);
    const isDownloadDisabled = computed(
      () =>
        !searchObj.data.stream.selectedStream?.length ||
        !searchObj.data.queryResults?.hits?.length,
    );
    const downloadCustomFileTypeOptions = ref([
      { label: "CSV", value: "csv" },
      { label: "JSON", value: "json" },
    ]);

    const loadSavedView = () => {
      if (searchObj.data.savedViews.length == 0) {
        getSavedViews();
      }
    };

    const filteredSavedViews = computed(() => {
      const filter = (searchObj.data.savedViewFilterFields ?? "").toLowerCase();
      if (!filter) return searchObj.data.savedViews;
      return searchObj.data.savedViews.filter((v: any) =>
        (v.view_name ?? "").toLowerCase().includes(filter),
      );
    });

    const savedViewPage = ref(1);
    const savedViewPageSize = ref(10);

    const savedViewTotalPages = computed(() =>
      Math.ceil(filteredSavedViews.value.length / savedViewPageSize.value),
    );

    const paginatedSavedViews = computed(() => {
      const start = (savedViewPage.value - 1) * savedViewPageSize.value;
      return filteredSavedViews.value.slice(start, start + savedViewPageSize.value);
    });

    watch(filteredSavedViews, () => {
      savedViewPage.value = 1;
    });

    const handleFavoriteSavedView = (row: any, flag: boolean) => {
      let localSavedView: any = {};
      let savedViews = useLocalSavedView();

      if (savedViews.value != null) {
        localSavedView = savedViews.value;
      }

      Object.keys(localSavedView).forEach((item, key) => {
        if (item == row.view_id) {
          if (flag) {
            delete localSavedView[item];
            useLocalSavedView(localSavedView);
            const index = favoriteViews.value.indexOf(row.view_id);
            if (index > -1) {
              favoriteViews.value.splice(index, 1);
            }

            let favoriteViewsList = localSavedViews.value;
            if (favoriteViewsList.length > 0) {
              favoriteViewsList = favoriteViewsList.filter(
                (item) => item.view_id != row.view_id,
              );
              // for (const [key, item] of favoriteViewsList.entries()) {
              //   console.log(item, key);
              //   if (item.view_id == row.view_id) {
              //     delete favoriteViewsList[key];
              //   }
              // }
              localSavedViews.value = favoriteViewsList;
            }
          }
        }
      });

      if (!flag) {
        if (favoriteViews.value.length >= 10) {
          toast({
            message: "You can only save 10 views.",
            variant: "warning",
          });
          return;
        }
        localSavedView[row.view_id] = JSON.parse(JSON.stringify(row));
        favoriteViews.value = [...favoriteViews.value, row.view_id];
        localSavedViews.value = [...localSavedViews.value, row];

        // moveItemsToTop(localSavedView, favoriteViews.value);

        useLocalSavedView(localSavedView);
        toast({
          message: "View added to favorites.",
          variant: "success",
        });
      } else {
        // alert(favoriteViews.value.length)
        // moveItemsToTop(localSavedView, favoriteViews.value);
        toast({
          message: "View removed from favorites.",
          variant: "success",
        });
      }
    };

    const filterSavedViewFn = (rows: any, terms: any) => {
      var filtered = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["view_name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      }
      return filtered;
    };

    const regionFilterMethod = (node, filter) => {
      const filt = filter.toLowerCase();
      return node.label && node.label.toLowerCase().indexOf(filt) > -1;
    };
    const resetRegionFilter = () => {
      regionFilter.value = "";
    };

    const handleRegionsSelection = (item, isSelected) => {
      if (isSelected) {
        const index = searchObj.meta.regions.indexOf(item);
        if (index > -1) {
          searchObj.meta.regions.splice(index, 1);
        }
      } else {
        searchObj.meta.regions.push(item);
      }
    };

    const handleQuickMode = () => {
      searchObj.meta.quickMode = !searchObj.meta.quickMode;
      emit("handleQuickModeChange");
    };

    const toggleLiveMode = () => {
      searchObj.meta.liveMode = !searchObj.meta.liveMode;
      localStorage.setItem(
        "oo_toggle_auto_run",
        String(searchObj.meta.liveMode),
      );
    };

    const handleHistogramMode = () => {};

    const handleRunQueryFn = (clear_cache = false) => {
      // Flush the Monaco editor value synchronously so the search uses what the
      // user actually typed, not the last debounced emission. Without this, a Run
      // click within 100ms of typing sends the stale searchObj.data.query value.
      const currentEditorVal = queryEditorRef.value?.getValue?.();
      if (typeof currentEditorVal === "string") {
        searchObj.data.editorValue = currentEditorVal;
        searchObj.data.query = currentEditorVal;
      }

      if (
        searchObj.meta.logsVisualizeToggle == "visualize" ||
        searchObj.meta.logsVisualizeToggle == "patterns" ||
        searchObj.meta.logsVisualizeToggle == "build"
      ) {
        emit(
          "handleRunQueryFn",
          typeof clear_cache === "boolean" ? clear_cache : false,
        );
      } else {
        handleRunQuery(typeof clear_cache === "boolean" ? clear_cache : false);
      }
    };

    // Toggle between Builder and Custom mode in Build tab
    const confirmBuildModeChange = ref(false);

    const onBuildModeToggle = (isBuilderMode: boolean) => {
      const currentlyCustom = !searchObj.meta.buildModeQueryEditorDisabled;

      // Show confirmation when switching from Custom to Builder
      if (currentlyCustom && isBuilderMode) {
        confirmBuildModeChange.value = true;
        return;
      }

      searchObj.meta.buildModeQueryEditorDisabled = isBuilderMode;
      emit("buildModeToggle", !isBuilderMode);
    };

    const confirmBuildModeChangeOk = () => {
      confirmBuildModeChange.value = false;
      searchObj.meta.buildModeQueryEditorDisabled = true;
      emit("buildModeToggle", false); // isCustomMode = false
    };

    const onLogsVisualizeToggleUpdate = async (value: any) => {
      // prevent action if visualize is disabled (SQL mode disabled with multiple streams)
      if (
        value === "visualize" &&
        !searchObj.meta.sqlMode &&
        searchObj.data.stream.selectedStream.length > 1
      ) {
        showErrorNotification(t("search.enableSqlOrSelectStream"));
        return;
      }

      // confirm with user on toggle from visualize to logs
      if (
        value == "logs" &&
        searchObj.meta.logsVisualizeToggle == "visualize"
      ) {
        // cancel all the visualize queries
        cancelVisualizeQueries();

        if (
          searchObj.meta.logsVisualizeDirtyFlag === true ||
          !Object.hasOwn(searchObj.data?.queryResults, "hits") ||
          searchObj.data?.queryResults?.hits?.length == 0
        ) {
          searchObj.loading = true;
          if (searchObj.meta.sqlMode) {
            searchObj.data.queryResults.aggs = undefined;
          }
          searchObj.meta.refreshHistogram = true;
          getQueryData();
          searchObj.meta.logsVisualizeDirtyFlag = false;
        }
      } else if (
        value == "logs" &&
        searchObj.meta.logsVisualizeToggle == "patterns"
      ) {
        // Switching from patterns to logs - check if we need to fetch logs
        const hasLogs =
          searchObj.data?.queryResults?.hits &&
          searchObj.data.queryResults.hits.length > 0;

        // console.log("[SearchBar] Switching patterns ? logs, hasLogs:", hasLogs);

        // Reset pagination visibility when switching back to logs
        searchObj.meta.resultGrid.showPagination = true;

        if (!hasLogs) {
          // No logs data - fetch them
          // console.log("[SearchBar] Fetching logs data");
          searchObj.loading = true;
          searchObj.meta.refreshHistogram = true;
          getQueryData();
        } else {
          // Logs exist - just switch the view
          // console.log("[SearchBar] Reusing existing logs data");
        }
      } else if (
        value == "patterns" &&
        (searchObj.meta.logsVisualizeToggle == "logs" ||
          searchObj.meta.logsVisualizeToggle == "visualize")
      ) {
        // Switching to patterns mode - this will be handled by a separate watcher in Index.vue
        emit("extractPatterns");
        // console.log("[SearchBar] Switching to patterns mode");
      } else if (value == "visualize") {
        // validate query
        // return if query is empty and stream is not selected
        if (
          searchObj.data.query === "" &&
          searchObj?.data?.stream?.selectedStream?.length === 0
        ) {
          showErrorNotification(t("search.queryEmptyToVisualize"));
          return;
        }

        let logsPageQuery = searchObj.data.query;

        // handle sql mode
        if (!searchObj.data.sqlMode) {
          const queryBuild = buildSearch();
          logsPageQuery = queryBuild?.query?.sql ?? "";
        }

        // if multiple sql, then do not allow to visualize
        if (
          logsPageQuery &&
          Array.isArray(logsPageQuery) &&
          logsPageQuery.length > 1
        ) {
          showErrorNotification(t("search.multipleSqlNotAllowed"));
          return;
        }

        // validate that timestamp column is not used as an alias
        if (!checkTimestampAlias(logsPageQuery)) {
          showErrorNotification(
            `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
          );
          return;
        }

        // validate sql query that all fields have alias
        if (!allSelectionFieldsHaveAlias(logsPageQuery)) {
          showErrorNotification(t("search.aggregationFieldsNeedAlias"));
          return;
        }

        // cancel all the logs queries
        cancelQuery();
      } else if (value == "build") {
        // Only generate SQL query if user is already in SQL mode (Case 3).
        // When SQL mode is OFF (Case 1), BuildQueryPage will set up builder
        // mode with default histogram/count fields and carry over WHERE clause.
        if (searchObj.meta.sqlMode) {
          // Generate query using buildSearch if query is empty or doesn't have SELECT
          if (
            !searchObj.data.query ||
            searchObj.data.query.toLowerCase().indexOf("select") < 0
          ) {
            const queryBuild = buildSearch();
            const builtQuery = queryBuild?.query?.sql ?? "";
            if (builtQuery) {
              searchObj.data.query = builtQuery;
              searchObj.data.editorValue = builtQuery;
            }
          }
        }

        // Wait for Vue reactivity to process query changes before switching tabs
        await nextTick();

        // Quick mode logic only relevant for SQL mode
        if (searchObj.meta.sqlMode) {
          const isSelectAllQuery = /^\s*select\s+\*\s+from\s+/i.test(
            searchObj.data.query || "",
          );
          const shouldEnableQuickMode =
            !searchObj.meta.sqlMode || isSelectAllQuery;
          const isQuickModeDisabled = !searchObj.meta.quickMode;
          const isQuickModeConfigEnabled =
            store.state.zoConfig.quick_mode_enabled === true;

          if (
            shouldEnableQuickMode &&
            isQuickModeDisabled &&
            isQuickModeConfigEnabled
          ) {
            searchObj.meta.quickMode = true;
          }
        }
      }
      searchObj.meta.logsVisualizeToggle = value;
      updateUrlQueryParams();

      if (searchObj.meta.logsVisualizeToggle === "logs") {
        const hasLogs =
          searchObj.data?.queryResults?.hits &&
          searchObj.data.queryResults.hits.length > 0;

        if (hasLogs) {
          searchObj.data.histogram.chartParams.title = getHistogramTitle(false);
        }
      }

      // dispatch resize event
      window.dispatchEvent(new Event("resize"));
    };

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "logs",
    );
    const { dashboardPanelData, resetDashboardPanelData } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    // [START] cancel running queries

    const variablesAndPanelsDataLoadingState =
      inject("variablesAndPanelsDataLoadingState", {}) || {};

    const visualizeSearchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState?.searchRequestTraceIds ?? {},
      )
        .filter((item: any) => item.length > 0)
        .flat() as string[];

      // If custom field extraction is in progress, push a dummy trace id so that cancel button is visible.
      if (variablesAndPanelsDataLoadingState?.fieldsExtractionLoading) {
        searchIds.push("fieldExtraction");
      }

      return searchIds;
    });
    const editorWidthToggleFunction = computed(() => {
      if (!searchObj.data.transformType === "function" && isFocused.value) {
        return {
          width: `calc(100 - ${searchObj.config.fnSplitterModel})%`,
          borderBottom: "0.125rem solid var(--o2-border-color)",
        };
      } else {
        return {
          width: "100%",
          borderBottom: "none",
        };
      }
    });
    const { traceIdRef, cancelQuery: cancelVisualizeQuery } = useCancelQuery();

    const cancelVisualizeQueries = () => {
      // Filter out the dummy id before sending to backend cancel API
      traceIdRef.value = visualizeSearchRequestTraceIds.value.filter(
        (id: any) => id !== "fieldExtraction",
      );

      cancelVisualizeQuery();
    };

    const disable = ref(false);

    watch(variablesAndPanelsDataLoadingState, () => {
      const panelsValues = Object.values(
        variablesAndPanelsDataLoadingState?.panels,
      );
      disable.value = panelsValues.some((item: any) => item === true);
    });

    const iconRight = computed(() => {
      return (
        "img:" +
        getImageURL(
          store.state.theme === "dark"
            ? "images/common/function_dark.svg"
            : "images/common/function.svg",
        )
      );
    });
    const functionToggleIcon = computed(() => {
      return (
        "img:" +
        getImageURL(
          searchObj.data.transformType === "function"
            ? "images/common/function_dark.svg"
            : "images/common/function.svg",
        )
      );
    });
    const addJobScheduler = async () => {
      try {
        // if(searchObj.meta.jobId != ""){
        //   searchObj.meta.jobId = "";
        // }
        if (
          !searchObj.data.stream.selectedStream ||
          searchObj.data.stream.selectedStream.length === 0
        ) {
          toast({
            variant: "error",
            message: "Please select a stream before scheduling a job",
          });
          return;
        }
        if (searchObj.meta.jobId != "") {
          toast({
            variant: "error",
            message: t("search.jobAlreadyScheduled"),
          });
          return;
        }
        if (
          searchObj.meta.jobRecords > 100000 ||
          searchObj.meta.jobRecords == 0 ||
          searchObj.meta.jobRecords < 0
        ) {
          toast({
            variant: "error",
            message: t("search.jobSchedulerRange"),
          });
          return;
        }

        searchSchedulerJob.value = false;
        searchObj.meta.showSearchScheduler = false;
        await getJobData();
      } catch (e) {
        if (e.response.status != 403) {
          toast({
            variant: "error",
            message: t("search.errorAddingJob"),
          });
          return;
        }
      }
    };

    const createScheduleJob = () => {
      searchSchedulerJob.value = true;
      searchObj.meta.jobRecords = 100;
    };

    const openSearchInspectDialog = () => {
      searchInspectTraceId.value = "";
      searchInspectDialog.value = true;
    };

    const navigateToSearchInspect = () => {
      const traceId = searchInspectTraceId.value.trim();
      if (!traceId) return;
      router.push({
        name: "searchJobInspector",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          trace_id: traceId,
        },
      });
    };

    const checkQuery = (query) => {
      const jobQuery = router.currentRoute.value.query.query;
      if (jobQuery == b64EncodeUnicode(query)) {
        return true;
      }
      return false;
    };
    const checkFnQuery = (fnQuery) => {
      const jobFnQuery = router.currentRoute.value.query.functionContent;
      if (jobFnQuery == b64EncodeUnicode(fnQuery)) {
        return true;
      }
      return false;
    };

    const updateTransforms = () => {
      updateEditorWidth();
    };

    const selectTransform = (item: any, isSelected: boolean) => {
      if (searchObj.data.transformType === "function") {
        populateFunctionImplementation(item, isSelected);
      }

      // If action is selected notify the user
      if (searchObj.data.transformType === "action") {
        updateActionSelection(item);
      }

      if (typeof item === "object")
        searchObj.data.selectedTransform = {
          ...item,
          type: searchObj.data.transformType,
        };
    };

    const updateActionSelection = (item: any) => {
      toast({
        message: `${item?.name} action applied successfully`,
        variant: "success",
      });
    };

    const updateEditorWidth = () => {
      if (searchObj.data.transformType) {
        if (searchObj.meta.showTransformEditor) {
          searchObj.config.fnSplitterModel = 60;
        } else {
          searchObj.config.fnSplitterModel = 100;
        }
      } else {
        searchObj.config.fnSplitterModel = 100;
      }
    };
    //so if it is active we need light this is fixed
    //if it is inactive we will be having 2 conditions
    //1. if dark mode show light color
    //2.if light mode show dark color
    const visualizeIcon = computed(() => {
      return searchObj.meta.logsVisualizeToggle === "visualize"
        ? getImageURL("images/common/visualize_icon_light.svg")
        : store.state.theme == "dark"
          ? getImageURL("images/common/visualize_icon_light.svg")
          : getImageURL("images/common/visualize_icon_dark.svg");
    });
    const histogramIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/bar_chart_histogram_light.svg")
        : getImageURL("images/common/bar_chart_histogram.svg");
    });
    const sqlIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/hugeicons_sql_light.svg")
        : getImageURL("images/common/hugeicons_sql.svg");
    });
    const quickModeIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/quick_mode_light.svg")
        : getImageURL("images/common/quick_mode.svg");
    });
    const searchHistoryIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/search_history_light.svg")
        : getImageURL("images/common/search_history.svg");
    });
    const downloadTableIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/download_table_light.svg")
        : getImageURL("images/common/download_table.svg");
    });
    const customRangeIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/custom_range_light.svg")
        : getImageURL("images/common/custom_range.svg");
    });
    const createScheduledSearchIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/create_scheduled_search_light.svg")
        : getImageURL("images/common/create_scheduled_search.svg");
    });
    const listScheduledSearchIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/list_scheduled_search_light.svg")
        : getImageURL("images/common/list_scheduled_search.svg");
    });

    // [END] cancel running queries

    // [START] explain query functionality
    const openExplainDialog = () => {
      if (searchObj.data.query && searchObj.data.query.trim() !== "") {
        showExplainDialog.value = true;
      }
    };
    // [END] explain query functionality

    // [START] query editor placeholder overlay
    const _streamFields = computed(
      () => searchObj.data.stream.selectedStreamFields ?? [],
    );
    const _fieldValues = computed(() => props.fieldValues ?? {});
    const _sqlMode = computed(() => searchObj.meta.sqlMode);
    const _noStream = computed(() => !searchObj.data.stream.selectedStream.length);
    const { placeholder: editorPlaceholder } = useQueryPlaceholder(
      _streamFields,
      _fieldValues,
      _sqlMode,
      _noStream,
    );
    // [END] query editor placeholder overlay

    const { placeholder: vrlPlaceholder } = useVrlPlaceholder();

    // [START] typewriter placeholder for AI query input
    const aiQueryPlaceholderPrompts = computed(() => [
      t("search.askAIPlaceholderRotation.one"),
      t("search.askAIPlaceholderRotation.two"),
      t("search.askAIPlaceholderRotation.three"),
      t("search.askAIPlaceholderRotation.four"),
    ]);
    const { placeholder: aiQueryPlaceholder } = useTypewriterPlaceholder(
      aiQueryPlaceholderPrompts,
    );
    // [END] typewriter placeholder for AI query input

    return {
      t,
      store,
      router,
      fnEditorRef,
      searchObj,
      queryEditorRef,
      syntaxGuideRef,
      confirmDialogVisible,
      confirmCallback,
      showDownloadSubmenu,
      isDownloadDisabled,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      showConfirmDialog,
      showSavedViewConfirmDialog,
      cancelConfirmDialog,
      confirmDialogOK,
      updateQuery,
      downloadLogs,
      saveFunction,
      resetFunctionContent,
      resetEditorLayout,
      populateFunctionImplementation,
      functionModel,
      functionOptions,
      filterFn,
      refreshData,
      handleRunQuery,
      handleRunQueryFn,
      onQueryEditorFocus,
      handleQueryEditorBlur,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      effectiveKeywords,
      effectiveSuggestions,
      onRefreshIntervalUpdate,
      updateTimezone,
      dateTimeRef,
      fnSavedView,
      openSavedViewsList,
      applySavedView,
      isSavedViewAction,
      savedViewName,
      savedViewNameError,
      savedViewSelectError,
      savedViewSelectedName,
      handleSavedView,
      deleteSavedViews,
      deleteViewID,
      confirmDelete,
      saveViewLoader,
      savedViewDropdownModel,
      savedViewsListDialog,
      moreOptionsDropdownModel,
      fnSavedFunctionDialog,
      isSavedFunctionAction,
      savedFunctionName,
      savedFunctionNameError,
      savedFunctionSelectError,
      savedFunctionSelectedName,
      saveFunctionLoader,
      functionUpdateConfirm,
      executeFunctionUpdate,
      shareURL,
      showSearchHistoryfn,
      getImageURL,
      resetFilters,
      customDownloadDialog,
      downloadCustomInitialNumber,
      downloadCustomRange,
      downloadCustomRangeOptions,
      buildSearch,
      confirmSavedViewDialogVisible,
      rowsPerPage,
      handleFavoriteSavedView,
      favoriteViews,
      localSavedViews,
      loadSavedView,
      filterSavedViewFn,
      filteredSavedViews,
      savedViewPage,
      savedViewPageSize,
      savedViewTotalPages,
      paginatedSavedViews,
      savedViewColumns,
      config,
      handleRegionsSelection,
      handleQuickMode,
      handleHistogramMode,
      regionFilterMethod,
      regionFilterRef,
      regionFilter,
      resetRegionFilter,
      cancelQuery,
      onLogsVisualizeToggleUpdate,
      onBuildModeToggle,
      confirmBuildModeChange,
      confirmBuildModeChangeOk,
      visualizeSearchRequestTraceIds,
      disable,
      cancelVisualizeQueries,
      isFocused,
      editorContainerRef,
      editorFullscreenStyle,
      toggleEditorFullscreen,

      editorWidthToggleFunction,
      fnParsedSQL,
      fnUnparsedSQL,
      iconRight,
      functionToggleIcon,
      searchSchedulerJob,
      autoSearchSchedulerJob,
      addJobScheduler,
      routeToSearchSchedule,
      createScheduleJob,
      searchInspectDialog,
      searchInspectTraceId,
      openSearchInspectDialog,
      navigateToSearchInspect,
      searchTerm,
      filteredActionOptions,
      filteredFunctionOptions,
      confirmUpdate,
      updateViewObj,
      updateSavedViews,
      checkQuery,
      checkFnQuery,
      transformsExpandState,
      transformsLabel,
      transformIcon,
      transformTypes,
      filteredTransformOptions,
      updateTransforms,
      selectTransform,
      actionEditorQuery,
      isActionsEnabled,
      showFunctionEditor,
      isVrlEditorDisabled,
      closeSocketWithError,
      histogram_svg,
      visualizeIcon,
      histogramIcon,
      sqlIcon,
      quickModeIcon,
      searchHistoryIcon,
      downloadTableIcon,
      customRangeIcon,
      createScheduledSearchIcon,
      listScheduledSearchIcon,
      getColumnNames,
      getSearchObj,
      toggleHistogram,
      createSavedViews,
      downloadCustomFileName,
      downloadCustomFileType,
      downloadCustomFileTypeOptions,
      showDownloadMenu,
      // Expose additional functions for testing
      updateAutoComplete,
      handleEscKey,
      applyAction,
      getFieldList,
      buildStreamQuery,
      updateActionSelection,
      updateEditorWidth,
      showExplainDialog,
      openExplainDialog,
      isNaturalLanguageDetected,
      isGeneratingSQL,
      vrlEditorNlpMode,
      shouldMoveShareToMenu,
      toolbarLeftRef,
      toolbarRightRef,
      shouldHideToolbarButtonText,
      toolbarToggleIconOnly,
      shouldMoveButtonsToMenu,
      toolbarMoveResetToMenu,
      toolbarToggleAsDropdown,
      toggleViewOptions,
      currentToggleOption,
      toggleLiveMode,
      aiQueryPlaceholder,
      editorPlaceholder,
      vrlPlaceholder,
      patternsState,
      cancelPatterns,
    };
  },
  computed: {
    isVisualizeDisabled() {
      return (
        !this.searchObj.meta.sqlMode &&
        this.searchObj.data.stream.selectedStream.length > 1
      );
    },
    isSqlModeDisabled() {
      return (
        this.searchObj.meta.logsVisualizeToggle === "visualize" &&
        this.searchObj.data.stream.selectedStream.length > 1
      );
    },
    addSearchTerm() {
      return this.searchObj.data.stream.addToFilter;
    },
    removeFieldTerm() {
      return this.searchObj.data.stream.removeFilterField;
    },
    toggleTransformEditor() {
      return this.searchObj.meta.showTransformEditor;
    },
    confirmMessage() {
      return "Are you sure you want to update the function?";
    },
    confirmMessageSavedView() {
      return "Are you sure you want to update the saved view?";
    },
    resetFunction() {
      return this.searchObj.data.tempFunctionName;
    },
    resetFunctionDefinition() {
      return this.searchObj.data.tempFunctionContent;
    },
  },
  watch: {
    addSearchTerm() {
      if (this.searchObj.data.stream.addToFilter != "") {
        let currentQuery = this.searchObj.data.query.split("|");
        if (currentQuery.length > 1) {
          if (currentQuery[1].trim() != "") {
            currentQuery[1] += " and " + filter;
          } else {
            currentQuery[1] = filter;
          }
          this.searchObj.data.query = currentQuery.join("| ");
          this.searchObj.data.editorValue = this.searchObj.data.query;
        } else {
          let unionType: string = "";
          if (
            currentQuery[0]
              .replace("union all", "UNION ALL")
              .includes("UNION ALL")
          ) {
            unionType = "UNION ALL";
          } else if (
            currentQuery[0].replace("union", "UNION").includes("UNION")
          ) {
            unionType = "UNION";
          }

          // Use regular expression to match "UNION" or "UNION ALL" (case insensitive)
          const unionRegex = /\bUNION ALL\b|\bUNION\b/i;

          // Split the string by "UNION" or "UNION ALL" if they are present
          const queries = currentQuery[0].split(unionRegex);

          // Iterate over each part
          queries.forEach((query, index) => {
            let filter = this.searchObj.data.stream.addToFilter;

            const isFilterValueNull = filter.split(/=|!=/)[1] === "'null'";

            if (isFilterValueNull) {
              filter = filter
                .replace(/=|!=/, (match) => {
                  return match === "=" ? " is " : " is not ";
                })
                .replace(/'null'/, "null");
            }

            if (this.searchObj.meta.sqlMode == true) {
              if (
                unionType == "" &&
                this.searchObj.data.stream.selectedStream.length > 1
              ) {
                const parsedSQL = this.fnParsedSQL();
                const streamPrefix: string =
                  parsedSQL.from[0].as != null
                    ? parsedSQL.from[0].as
                    : parsedSQL.from[0].table;
                filter = `"${streamPrefix}".${filter}`;
              }

              // if query contains order by clause or limit clause then add where clause before that
              // if query contains where clause then add filter after that with and operator and keep order by or limit after that
              // if query does not contain where clause then add where clause before filter
              if (query.toLowerCase().includes("where")) {
                // Replace an existing condition for this field, or append if none.
                // In append mode (SearchResult include/exclude), skip the
                // field-level replace so multiple values for the same field
                // coexist with AND.
                const appendOnlySQL =
                  this.searchObj.data.stream.addToFilterMode === "append";
                const fieldNameSQL = appendOnlySQL
                  ? null
                  : getFieldFromExpression(filter);
                if (fieldNameSQL && hasFieldCondition(query, fieldNameSQL)) {
                  query = replaceExistingFieldCondition(
                    query,
                    fieldNameSQL,
                    filter,
                  );
                } else {
                  // Find the earliest clause that ends the WHERE conditions.
                  // Standard SQL clause order: WHERE ? GROUP BY ? HAVING ? ORDER BY ? LIMIT.
                  // We must insert the new filter before whichever comes first so it
                  // stays inside the WHERE clause rather than after GROUP BY / ORDER BY.
                  const terminatingClauses = [
                    "group by",
                    "having",
                    "order by",
                    "limit",
                  ];
                  const lowerQuery = query.toLowerCase();
                  let firstClause: string | null = null;
                  let firstIndex = Infinity;
                  for (const clause of terminatingClauses) {
                    const idx = lowerQuery.indexOf(clause);
                    if (idx !== -1 && idx < firstIndex) {
                      firstIndex = idx;
                      firstClause = clause;
                    }
                  }
                  if (firstClause) {
                    const [beforeClause, afterClause] = queryIndexSplit(
                      query,
                      firstClause,
                    );
                    query =
                      beforeClause.trim() +
                      " AND " +
                      filter +
                      " " +
                      firstClause +
                      afterClause;
                  } else {
                    query = query + " AND " + filter;
                  }
                }
              } else {
                // Find the earliest clause to insert WHERE before.
                // SQL clause order: FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT
                const terminatingClauses = [
                  "group by",
                  "having",
                  "order by",
                  "limit",
                ];
                const lowerQuery = query.toLowerCase();
                let firstClause: string | null = null;
                let firstIndex = Infinity;
                for (const clause of terminatingClauses) {
                  const idx = lowerQuery.indexOf(clause);
                  if (idx !== -1 && idx < firstIndex) {
                    firstIndex = idx;
                    firstClause = clause;
                  }
                }
                if (firstClause) {
                  const [beforeClause, afterClause] = queryIndexSplit(
                    query,
                    firstClause,
                  );
                  query =
                    beforeClause.trim() +
                    " where " +
                    filter +
                    " " +
                    firstClause +
                    afterClause;
                } else {
                  query = query + " where " + filter;
                }
              }
              currentQuery[0] = query;
            } else {
              const appendOnly =
                this.searchObj.data.stream.addToFilterMode === "append";
              const fieldName = appendOnly
                ? null
                : getFieldFromExpression(filter);
              if (fieldName && hasFieldCondition(currentQuery[0], fieldName)) {
                currentQuery[0] = replaceExistingFieldCondition(
                  currentQuery[0],
                  fieldName,
                  filter,
                );
              } else {
                currentQuery[0].length == 0
                  ? (currentQuery[0] = filter)
                  : (currentQuery[0] += " and " + filter);
              }
            }

            // this.searchObj.data.query = currentQuery[0];
            queries[index] = currentQuery[0];
          });

          if (unionType == "") {
            this.searchObj.data.query = queries.join("");
          } else {
            this.searchObj.data.query = queries.join(` ${unionType} `);
          }
          this.searchObj.data.editorValue = this.searchObj.data.query;
          this.searchObj.data.stream.addToFilter = "";
          this.searchObj.data.stream.addToFilterMode = "replace";
          if (this.queryEditorRef?.setValue)
            this.queryEditorRef.setValue(this.searchObj.data.query);
          if (
            this.store.state.zoConfig.auto_query_enabled &&
            this.searchObj.meta.liveMode
          ) {
            this.$emit("searchdata");
          }
        }
      }
    },
    removeFieldTerm(fieldName: string) {
      if (!fieldName) return;
      let newValue: string;
      if (this.searchObj.meta.sqlMode) {
        try {
          const parsed = this.fnParsedSQL();
          if (parsed?.where) {
            const newWhere = removeFieldFromWhereAST(parsed.where, fieldName);
            newValue = this.fnUnparsedSQL({
              ...parsed,
              where: newWhere,
            }).replaceAll("`", '"');
          } else {
            newValue = this.searchObj.data.editorValue;
          }
        } catch (e) {
          console.log("Error removing field condition from SQL:", e);
          newValue = removeFieldCondition(
            this.searchObj.data.editorValue,
            fieldName,
          );
        }
      } else {
        newValue = removeFieldCondition(
          this.searchObj.data.editorValue,
          fieldName,
        );
      }
      this.searchObj.data.editorValue = newValue;
      this.searchObj.data.query = newValue;
      this.searchObj.data.stream.removeFilterField = "";
      if (this.queryEditorRef?.setValue) this.queryEditorRef.setValue(newValue);
      if (
        this.store.state.zoConfig.auto_query_enabled &&
        this.searchObj.meta.liveMode
      ) {
        this.$emit("searchdata");
      }
    },
    toggleTransformEditor(newVal) {
      if (newVal == false) {
        this.searchObj.config.fnSplitterModel = 100;
      } else {
        this.searchObj.config.fnSplitterModel = 60;
      }

      this.resetEditorLayout();
    },
    resetFunction(newVal) {
      if (newVal == "" && store && !store?.state?.savedViewFlag) {
        this.resetFunctionContent();
        if (
          this.store.state.zoConfig?.auto_query_enabled &&
          this.searchObj.meta.liveMode
        ) {
          this.$emit("searchdata");
        }
      }
    },
    resetFunctionDefinition(newVal) {
      if (newVal == "") this.resetFunctionContent();
    },
  },
});
</script>

<style scoped lang="scss">
/* Icon badge — small rounded square used as icon container in dropdown menus */
.more-menu-icon-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  background: var(--o2-section-header-bg);
  color: var(--o2-text-secondary);
  flex-shrink: 0;

  &--mono {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-sm);
    font-style: italic;
    font-weight: var(--font-bold);
    color: var(--o2-primary-color);
  }
}

/* "Download results" item with hover-triggered CSV/JSON sub-popover.
   Matches the language sub-menu pattern in Header.vue. */
.search-download-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: var(--text-base);
  line-height: 1.2;
  cursor: pointer;
  user-select: none;

  &:hover {
    background-color: var(--o2-hover-accent);
  }

  &--disabled {
    cursor: not-allowed;
    color: var(--o2-text-muted);

    &:hover {
      background-color: transparent;
    }
  }

  /* Invisible hover bridge extending to the LEFT of the parent item,
     covering the gap between the parent and the submenu. Without this,
     moving the cursor leftward toward the submenu briefly enters dead
     space, fires mouseleave on the parent, and closes the submenu
     before the cursor can land on it. */
  &::before {
    content: "";
    position: absolute;
    top: 0;
    right: 100%;
    width: 0.625rem;
    height: 100%;
    /* Stays transparent — only present to extend the hover hit-test area */
  }

  body.body--dark & {
    &:hover {
      background-color: var(--o2-hover-accent);
    }
  }
}

.search-download-item-label {
  flex: 1;
  white-space: nowrap;
}

.search-download-submenu {
  position: absolute;
  right: 100%;
  top: 0;
  margin-right: 0.25rem;
  min-width: 10rem;
  background-color: var(--color-dropdown-bg);
  border: 0.063rem solid var(--o2-border-color);
  border-radius: 0.375rem;
  box-shadow: 0 0.5rem 1.5rem var(--o2-hover-shadow);
  padding: 0.25rem 0;
  z-index: 9999;

  body.body--dark & {
    background-color: var(--color-dropdown-bg);
    border-color: var(--o2-border-color);
    box-shadow: 0 0.5rem 1.5rem var(--o2-hover-shadow);
  }
}

.search-download-submenu-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.375rem 0.75rem;
  font-size: var(--text-base);
  line-height: 1.2;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--o2-text-body);

  &:hover {
    background-color: var(--o2-hover-accent);
  }

  body.body--dark & {
    &:hover {
      background-color: var(--o2-hover-accent);
    }
  }
}

.file-type label {
  font-weight: 600;
  font-size: 0.875rem;
  color: #262626;
}
html.dark .file-type label,
.body--dark .file-type label {
  color: #e5e5e5;
}

// Toolbar Icon and Toggle Styles
.toolbar-toggle-container {
  padding: 0.25rem 0.375rem; // 4px 6px
  margin-left: 0.25rem; // 8px
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0.0625rem solid var(--color-button-outline-border); // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    background-color: var(--o2-hover-accent);
  }
}


.toolbar-icon {
  width: 1rem; // 16px
  height: 1rem; // 16px
  object-fit: contain;
}


.toolbar-icon-in-toggle {
  font-size: 0.9rem; // ~14.4px
}

.syntax-guide-in-menu {
  :deep(.q-btn) {
    border: none !important;
    margin-left: 0 !important;

    &:hover {
      background-color: transparent !important;
    }

    &::before {
      display: none !important;
    }
  }
}

.syntax-guide-menu-item {
  :deep(button) {
    width: 100%;
    justify-content: flex-start;
    height: auto;
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    border: none;
    margin: 0;
    gap: 0.5rem;
    color: var(--color-dropdown-item-text);
    background: transparent;
    font-size: var(--text-sm);

    &:hover {
      background-color: var(--color-dropdown-item-hover-bg);
    }
  }
}

.toolbar-reset-btn {
  padding: 0.25rem 0.375rem; // 4px 6px
  margin-left: 0.25rem; // 8px
  border: 0.0625rem solid var(--o2-border-color); // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  min-height: 1.875rem; // 30px
&:hover {
    background-color: var(--o2-hover-accent);
  }

  &.theme-dark {
    border-color: var(--o2-border-color) !important;
  }
}


.group-menu-btn {
  padding: 0.25rem 0.25rem !important; // 4px 8px
  margin-left: 0.25rem; // 8px
  border: 0.0625rem solid var(--color-button-outline-border) !important; // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  min-height: 1.875rem !important; // 30px
  font-size: 0.75rem; // 12px
  font-weight: 500;
&:hover {
    background-color: var(--o2-hover-accent);
  }
}

.o2-run-query-button {
  font-size: var(--text-xs);
  font-weight: var(--font-medium) !important;
  line-height: 1rem !important;
  padding: 0 0.25rem !important;
  width: 5.875rem !important;
  white-space: normal;
  word-break: break-word;
  text-align: center;
  transition:
    box-shadow 0.3s ease,
    opacity 0.2s ease;
  /* subtle default glow */
  // box-shadow: 0 0 8px color-mix(in srgb, var(--o2-primary-btn-bg), transparent 60%);
}
.o2-color-primary {
  background-color: var(--o2-primary-btn-bg);
  color: var(--o2-primary-btn-text);
  &:hover {
    opacity: 0.9;
    box-shadow: 0 0 8px
      color-mix(in srgb, var(--o2-primary-btn-bg), transparent 30%);
  }
}
.search-button-enterprise-border-radius {
  border-radius: 0.375rem 0px 0px 0.375rem !important;
}
.search-button-normal-border-radius {
  border-radius: 0.375rem;
}
.search-button-dropdown-enterprise-border-radius {
  border-radius: 0px 0.375rem 0.375rem 0px !important;
}

.o2-color-cancel {
  background-color: var(--o2-cancel-query-bg);
  color: var(--o2-primary-btn-text);
}

.logs-search-splitter {
  :deep(.q-splitter__separator) {
    height: 100%;
  }
}

/* When function editor is open, move AI button flush to the right of the query panel */
.fn-editor-open :deep(.ai-floating-button) {
  right: 0.25rem;
}

/* Expand button border */
.editor-expand-btn {
  border: 1px solid var(--o2-border-color) !important;
  border-radius: 0.375rem;
  width: 30px !important;
  height: 30px !important;
  min-width: 30px !important;
  min-height: 30px !important;
}

.editor-fullscreen {
  overflow: hidden !important;
  background: var(--o2-body-primary-bg) !important;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.18);
}

.query-mode-toggle {
  position: absolute;
  bottom: 0.375rem;
  right: 0.375rem;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--o2-muted-background);
  padding: 0.125rem 0.25rem;
  border-radius: 0.375rem;
  box-shadow: 0 0.063rem 0.25rem var(--o2-hover-shadow);
  border: 0.063rem solid var(--o2-border-color);

  .mode-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--o2-text-secondary);
  }
}

// Dark mode support
.body--dark .query-mode-toggle {
  background: var(--o2-card-bg-solid);
  border-color: var(--o2-border-color);

  .mode-label {
    color: var(--o2-text-secondary);
  }
}

.o2-table-hide-header :deep(thead) {
  display: none;
}

.saved-view-table :deep(.action-btn-hover) {
  opacity: 0;
  transition: opacity 0.15s;
}

.saved-view-table :deep(tr:hover .action-btn-hover) {
  opacity: 1;
}

// Remove outer box border so both panels blend into the dialog background
// Exclude elements that also have tw:rounded-md (OInput wrapper) so the
// search input keeps its visible border.
.saved-view-table :deep(.tw\:border:not(.tw\:rounded-md)) {
  border: none;
}

// Normalize cell background and strip the auto-pin shadow
// (isAction columns are auto-pinned right by OTable, which adds an inline box-shadow)
.saved-view-table :deep(td) {
  background: transparent;
  box-shadow: none !important;
}

// Remove pagination top separator
.saved-view-table :deep(.tw\:border-t) {
  border-top: none;
}

// Hide the redundant total-count chip on the left — "of N" on the right already shows it
.saved-view-table :deep([data-test="o2-table-pagination-bottom"] .o2-table-footer-title) {
  display: none;
}

// VRL disabled warning background — theme-aware via CSS cascade
.vrl-disabled-warning {
  background-color: rgba(0, 0, 0, 0.1);
}

.body--dark .vrl-disabled-warning {
  background-color: rgba(255, 255, 255, 0.1);
}

.query-editor-placeholder-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-start;
  /* Must line up with where Monaco actually starts rendering text in
     CodeQueryEditor: host padding-left (0.5rem) + the line-number gutter
     (lineNumbersMinChars: 2 @ 14px ≈ 1.05rem) + lineDecorationsWidth (10px ≈
     0.625rem) ≈ 2.15rem. Keep this in sync if those editor options change.
     top 0.1875rem matches the editor's padding.top (3px) so the placeholder sits
     on line 1 next to the "1" gutter number. */
  padding: 0.1875rem 0.5rem 0 2.15rem;
  pointer-events: none;
  z-index: 1;
  user-select: none;

  .query-editor-placeholder-typewriter {
    /* Mirror Monaco's rendered text so the placeholder reads as the future
       typed query, not a different (proportional) font on a different baseline:
       same monospace family and same ~21px (1.5 × 14px) line height. */
    font-family: monospace;
    font-size: var(--text-base);
    line-height: 1.3125rem;
    color: #a0aec0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.body--dark .query-editor-placeholder-overlay {
  .query-editor-placeholder-typewriter {
    color: #718096;
  }
}
</style>
