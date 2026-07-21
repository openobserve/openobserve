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
    class="logs-search-bar-component"
    id="searchBarComponent"
  >
    <div class="flex m-0! p-1.5! items-center! w-full overflow-hidden border-b solid border-b-card-glass-border">
      <div
        ref="toolbarLeftRef"
        class="flex items-center gap-1 flex-nowrap flex-1 min-w-0"
      >
        <!-- Collapsible region — clips its overflow so the More button (a
             shrink-0 sibling below) always stays visible. Pinned items hide via
             the pinBudget computation before they would clip. `flex-initial`
             (not `flex-1`) keeps this sized to its content so the More button
             sits right after the pinned items instead of being pushed to the
             far right; it still shrinks + clips when content overflows. -->
        <div class="flex items-center gap-1 flex-nowrap flex-initial min-w-0 overflow-hidden">
        <!-- View Mode: Dropdown when very narrow, Toggle Group otherwise -->
        <ODropdown v-if="toolbarToggleAsDropdown" side="bottom" align="start">
          <template #trigger>
            <OButton
              data-test="logs-view-mode-dropdown-btn"
              size="xs"
              variant="outline"
              icon-right="chevron-down"
            >
              <OIcon :name="currentToggleOption.icon" size="sm" class="shrink-0" />
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
              <OIcon name="search" size="sm" class="shrink-0" />
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
              <OIcon name="timeline" size="sm" class="shrink-0" />
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
              <OIcon name="build" size="sm" class="shrink-0" />
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
              <OIcon name="layers" size="sm" class="shrink-0" />
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

        <!-- ── Pinned toolbar controls ──────────────────────────────────
             Items pinned out of the More menu render here in fixed order.
             They collapse back into the menu on narrow widths (see
             showPinned*/pin* computeds). -->

        <!-- Histogram (pinned by default — see useToolbarPins) -->
        <OButton
          v-if="showPinnedHistogram"
          data-test="logs-search-bar-histogram-btn"
          size="xs"
          variant="outline"
          class="gap-1.5"
          @click="searchObj.meta.showHistogram = !searchObj.meta.showHistogram"
        >
          <OSwitch
            v-model="searchObj.meta.showHistogram"
            :size="toolbarToggleIconOnly ? 'sm' : 'md'"
            @click.stop
          />
          <OIcon name="bar-chart" :size="toolbarToggleIconOnly ? 'xs' : 'sm'" class="shrink-0" />
          <OTooltip :content="searchObj.meta.showHistogram ? t('search.hideHistogram') : t('search.showHistogramLabel')" shortcut-id="logsToggleHistogram" />
        </OButton>

        <!-- SQL Mode (pinned) -->
        <OButton
          v-if="showPinnedSqlMode"
          data-test="logs-search-bar-sql-mode-pinned-btn"
          size="xs"
          variant="outline"
          class="gap-1.5"
          @click="!isSqlModeDisabled && (searchObj.meta.sqlMode = !searchObj.meta.sqlMode)"
        >
          <OSwitch
            :model-value="searchObj.meta.sqlMode"
            :disabled="isSqlModeDisabled"
            :size="toolbarToggleIconOnly ? 'sm' : 'md'"
            @click.stop="!isSqlModeDisabled && (searchObj.meta.sqlMode = !searchObj.meta.sqlMode)"
          />
          <OIcon name="code" :size="toolbarToggleIconOnly ? 'xs' : 'sm'" class="shrink-0" />
          <OTooltip :content="t('search.sqlModeLabel')" />
        </OButton>

        <!-- Quick Mode (pinned) -->
        <OButton
          v-if="showPinnedQuickMode"
          data-test="logs-search-bar-quick-mode-pinned-btn"
          size="xs"
          variant="outline"
          class="gap-1.5"
          @click="handleQuickMode"
        >
          <OSwitch
            :model-value="searchObj.meta.quickMode"
            :size="toolbarToggleIconOnly ? 'sm' : 'md'"
            @click.stop="handleQuickMode"
          />
          <!-- child-mode OTooltip attaches to its previous sibling, so this one
               gives the switch its own tooltip (the button-level tooltip below
               only covers the bolt icon). -->
          <OTooltip :content="t('search.quickModeLabel')" :side-offset="2" />
          <OIcon name="bolt" :size="toolbarToggleIconOnly ? 'xs' : 'sm'" class="shrink-0" />
          <OTooltip :content="t('search.quickModeLabel')" />
        </OButton>

        <!-- Saved Views (pinned) — button group styled to match the function
             selector for visual consistency: open-list dropdown trigger + create. -->
        <OButtonGroup
          v-if="showPinnedSavedViews"
          data-test="logs-search-bar-saved-views-pinned"
          class="p-0 element-box-shadow border border-button-outline-border"
        >
          <!-- A real dropdown, not a modal: one click to open, one click to
               apply. The heavyweight list dialog stays reachable via Manage. -->
          <ODropdown
            :open="savedViewsDropdownOpen"
            side="bottom"
            align="start"
            @update:open="onSavedViewsDropdownOpenChange"
          >
            <template #trigger>
              <OButton
                data-test="logs-search-bar-saved-views-pinned-list-btn"
                variant="ghost"
                size="icon-toolbar"
              >
                <OIcon name="saved-search" size="sm" />
                <OIcon name="arrow-drop-down" size="sm" class="-ml-0.5" />
                <OTooltip
                  :content="t('search.listSavedViews')"
                  :side-offset="2"
                />
              </OButton>
            </template>
            <ODropdownGroup :label="t('search.savedViewsLabel')">
              <div
                v-if="searchObj.loadingSavedView"
                class="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary"
              >
                <OSpinner size="xs" />
                {{ t("confirmDialog.loading") }}
              </div>
              <div
                v-else-if="sortedSavedViews.length"
                class="max-h-72 overflow-y-auto overscroll-contain"
                data-test="logs-search-bar-saved-views-menu-list"
              >
                <ODropdownItem
                  v-for="view in sortedSavedViews"
                  :key="view.view_id"
                  :data-test="`logs-search-bar-saved-views-menu-apply-${view.view_name}`"
                  @select="applySavedView(view)"
                >
                  <template #icon-left>
                    <OIcon
                      :name="
                        favoriteViews.includes(view.view_id)
                          ? 'favorite'
                          : 'saved-search'
                      "
                      size="sm"
                      :class="
                        favoriteViews.includes(view.view_id)
                          ? 'text-favorite'
                          : ''
                      "
                    />
                  </template>
                  <span class="truncate max-w-56">{{ view.view_name }}</span>
                  <template #icon-right>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      icon-left="edit"
                      class="ms-auto"
                      :title="t('search.updateSavedViewWithCurrent')"
                      :data-test="`logs-search-bar-saved-views-menu-update-${view.view_name}`"
                      @click.stop.prevent="quickUpdateSavedView(view)"
                    />
                  </template>
                </ODropdownItem>
              </div>
              <ODropdownItem v-else disabled>
                {{ t("search.savedViewsNotFound") }}
              </ODropdownItem>
            </ODropdownGroup>
            <ODropdownSeparator />
            <ODropdownItem
              icon-left="save"
              data-test="logs-search-bar-saved-views-menu-create"
              @select="fnSavedView"
            >
              {{ t("search.createSavedView") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="settings"
              data-test="logs-search-bar-saved-views-menu-manage"
              @select="openSavedViewsList"
            >
              {{ t("search.manageSavedViews") }}
            </ODropdownItem>
          </ODropdown>
          <OButton
            data-test="logs-search-bar-saved-views-pinned-create-btn"
            variant="ghost"
            size="icon-toolbar"
            @click="fnSavedView"
          >
            <OIcon name="save" size="sm" />
            <OTooltip :content="t('search.createSavedView')" :side-offset="6" />
          </OButton>
        </OButtonGroup>

        <!-- Syntax Guide (pinned) — icon+label, becomes icon-only at narrow widths -->
        <SyntaxGuide
          v-if="showPinnedSyntaxGuide"
          :sqlmode="searchObj.meta.sqlMode"
          :toolbar="true"
          :label="pinSyntaxGuideIconOnly ? '' : t('search.syntaxGuideLabel')"
          data-test="logs-search-bar-syntax-guide-pinned-btn"
        />

        </div>
        <!-- this is the button group responsible for showing all the utilities -->
        <ODropdown class="flex-shrink-0" side="bottom" align="start">
          <template #trigger>
            <OButton
              data-test="logs-search-bar-utilities-menu-btn"
              class="p-1! ml-1 [border:0.0625rem_solid_var(--color-button-outline-border)]! rounded-default [transition:all_0.2s_ease] min-h-[1.875rem]! text-xs font-medium hover:bg-button-outline-hover-bg element-box-shadow"
              icon-left="more-horiz"
              variant="outline"
              size="xs"
            >
              {{ t('search.menuMore') }}
            </OButton>
          </template>

          <!-- SET ONCE — view controls that persist across sessions -->
          <ODropdownGroup :label="t('search.menuGroupSetOnce')">
            <!-- SQL Mode — toggles the same flag used for SQL auto-detection -->
            <ODropdownItem
              data-test="logs-search-bar-menu-sql-mode-toggle-btn"
              @select.prevent="!isSqlModeDisabled && (searchObj.meta.sqlMode = !searchObj.meta.sqlMode)"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="code" size="sm" />
                </span>
              </template>
              {{ t("search.sqlModeLabel") }}
              <template #icon-right>
                <span class="ml-auto flex items-center gap-1">
                  <OSwitch
                    :model-value="searchObj.meta.sqlMode"
                    :disabled="isSqlModeDisabled"
                    size="md"
                    data-test="logs-search-bar-sql-mode-toggle"
                    @click.stop="!isSqlModeDisabled && (searchObj.meta.sqlMode = !searchObj.meta.sqlMode)"
                  />
                  <OButton
                    data-test="logs-search-bar-menu-pin-sql-mode-btn"
                    variant="ghost-neutral"
                    size="icon-sm"
                    :title="isPinned('sqlMode') ? t('search.unpinFromToolbar') : t('search.pinToToolbar')"
                    @click.stop="togglePin('sqlMode')"
                  >
                    <OIcon :name="isPinned('sqlMode') ? 'keep' : 'keep-outline'" size="sm" />
                  </OButton>
                </span>
              </template>
            </ODropdownItem>

            <!-- Reset filters (shown here only when toolbar is too narrow for inline button) -->
            <ODropdownItem
              v-if="toolbarMoveResetToMenu"
              data-test="logs-search-bar-menu-reset-btn"
              @select="resetFilters"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="restart-alt" size="sm" />
                </span>
              </template>
              {{ t("search.resetFilters") }}
            </ODropdownItem>

            <!-- Histogram — pinned copy renders on the toolbar -->
            <ODropdownItem
              data-test="logs-search-bar-menu-histogram-btn"
              @select.prevent="searchObj.meta.showHistogram = !searchObj.meta.showHistogram"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="bar-chart" size="sm" />
                </span>
              </template>
              {{ t("search.showHistogramLabel") }}
              <template #icon-right>
                <span class="ml-auto flex items-center gap-1">
                  <OSwitch
                    v-model="searchObj.meta.showHistogram"
                    size="md"
                    data-test="logs-search-bar-show-histogram-toggle-btn"
                    @click.stop
                  />
                  <OButton
                    data-test="logs-search-bar-menu-pin-histogram-btn"
                    variant="ghost-neutral"
                    size="icon-sm"
                    :title="isPinned('histogram') ? t('search.unpinFromToolbar') : t('search.pinToToolbar')"
                    @click.stop="togglePin('histogram')"
                  >
                    <OIcon :name="isPinned('histogram') ? 'keep' : 'keep-outline'" size="sm" />
                  </OButton>
                </span>
              </template>
            </ODropdownItem>

            <!-- Quick Mode — always in the More menu -->
            <ODropdownItem
              data-test="logs-search-bar-menu-quick-mode-toggle-btn"
              @select.prevent="handleQuickMode"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="bolt" size="sm" />
                </span>
              </template>
              {{ t("search.quickModeLabel") }}
              <template #icon-right>
                <span class="ml-auto flex items-center gap-1">
                  <OSwitch
                    :model-value="searchObj.meta.quickMode"
                    size="md"
                    data-test="logs-search-bar-quick-mode-switch"
                    @click.stop="handleQuickMode"
                  />
                  <OButton
                    data-test="logs-search-bar-menu-pin-quick-mode-btn"
                    variant="ghost-neutral"
                    size="icon-sm"
                    :title="isPinned('quickMode') ? t('search.unpinFromToolbar') : t('search.pinToToolbar')"
                    @click.stop="togglePin('quickMode')"
                  >
                    <OIcon :name="isPinned('quickMode') ? 'keep' : 'keep-outline'" size="sm" />
                  </OButton>
                </span>
              </template>
            </ODropdownItem>

            <!-- Function Editor -->
            <ODropdownItem
              data-test="logs-search-bar-menu-transform-editor-toggle-btn"
              @select.prevent="searchObj.meta.showTransformEditor = !searchObj.meta.showTransformEditor"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0 font-mono text-compact italic font-bold text-accent">fx</span>
              </template>
              {{ t('search.functionEditorLabel') }}
              <template #icon-right>
                <span class="ml-auto flex items-center gap-1">
                  <OSwitch
                    data-test="logs-search-bar-show-query-toggle-btn"
                    v-model="searchObj.meta.showTransformEditor"
                    size="md"
                    @click.stop
                  />
                  <OButton
                    data-test="logs-search-bar-menu-pin-function-editor-btn"
                    variant="ghost-neutral"
                    size="icon-sm"
                    :title="isPinned('functionEditor') ? t('search.unpinFromToolbar') : t('search.pinToToolbar')"
                    @click.stop="togglePin('functionEditor')"
                  >
                    <OIcon :name="isPinned('functionEditor') ? 'keep' : 'keep-outline'" size="sm" />
                  </OButton>
                </span>
              </template>
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <!-- SAVED VIEWS -->
          <ODropdownGroup :label="t('search.menuGroupSavedViews')">
            <template #label-action>
              <OButton
                data-test="logs-search-bar-menu-pin-saved-views-btn"
                variant="ghost-neutral"
                size="icon-sm"
                :title="isPinned('savedViews') ? t('search.unpinFromToolbar') : t('search.pinToToolbar')"
                @click.stop="togglePin('savedViews')"
              >
                <OIcon :name="isPinned('savedViews') ? 'keep' : 'keep-outline'" size="sm" />
              </OButton>
            </template>
            <ODropdownItem
              data-test="logs-search-bar-menu-list-saved-views-btn"
              @select="openSavedViewsList"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="format-list-bulleted" size="sm" />
                </span>
              </template>
              {{ t("search.listSavedViews") }}
            </ODropdownItem>

            <ODropdownItem
              data-test="logs-search-bar-menu-create-saved-view-btn"
              shortcut-id="logsSaveView"
              @select="fnSavedView"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="add" size="sm" />
                </span>
              </template>
              {{ t("search.createSavedView") }}
            </ODropdownItem>
          </ODropdownGroup>

          <ODropdownSeparator />

          <!-- SYNTAX GUIDE -->
          <div class="flex items-center w-full pr-2">
            <SyntaxGuide
              :sqlmode="searchObj.meta.sqlMode"
              :menuItem="true"
              ref="syntaxGuideRef"
              class="min-w-0"
              data-test="logs-search-bar-syntax-guide-btn"
            />
            <OButton
              data-test="logs-search-bar-menu-pin-syntax-guide-btn"
              variant="ghost-neutral"
              size="icon-sm"
              class="ml-auto"
              :title="isPinned('syntaxGuide') ? t('search.unpinFromToolbar') : t('search.pinToToolbar')"
              @click.stop="togglePin('syntaxGuide')"
            >
              <OIcon :name="isPinned('syntaxGuide') ? 'keep' : 'keep-outline'" size="sm" />
            </OButton>
          </div>
        </ODropdown>
      </div>

      <div ref="toolbarRightRef" class="flex items-center gap-1 flex-shrink-0">
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
              class="download-logs-btn order-4"
              variant="outline"
              size="icon-toolbar"
            >
              <OIcon name="menu" size="sm" />
              <OTooltip style="width: 110px" :content="t('search.moreActions')" />
            </OButton>
          </template>

          <!-- Share Link -->
          <div v-if="shouldMoveShareToMenu" class="p-2" data-test="logs-search-bar-menu-share-link-btn">
            <share-button
              :url="shareURL"
              variant="outline"
              size="sm-action"
              :show-label="true"
              class="w-full"
            />
          </div>

          <ODropdownSeparator v-if="shouldMoveShareToMenu" />

          <!-- HISTORY -->
          <ODropdownGroup :label="t('search.menuGroupHistory')">
            <ODropdownItem
              data-test="search-history-item-btn"
              shortcut-id="logsSearchHistory"
              @select="showSearchHistoryfn"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
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
              :aria-disabled="isDownloadDisabled || undefined"
              @mouseenter="!isDownloadDisabled && (showDownloadSubmenu = true)"
              @mouseleave="showDownloadSubmenu = false"
              class="relative flex items-center gap-2 py-1.5 px-3 text-[var(--text-sm)] [line-height:1.2] cursor-pointer select-none hover:bg-interactive-hover-bg search-download-item before:content-[''] before:absolute before:top-0 before:right-full before:w-2.5 before:h-full"
              :class="{ 'cursor-not-allowed! text-text-muted hover:bg-transparent!': isDownloadDisabled }"
            >
              <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                <OIcon size="sm" name="download" />
              </span>
              <span class="flex-1 whitespace-nowrap">{{ t("search.downloadTable") }}</span>
              <OIcon size="sm" name="chevron-right" />

              <div
                v-if="showDownloadSubmenu && !isDownloadDisabled"
                class="search-download-submenu absolute right-full top-0 mr-1 min-w-40 bg-dropdown-bg [border:0.063rem_solid_var(--color-card-glass-border)] rounded-default [box-shadow:0_0.5rem_1.5rem_var(--color-hover-shadow)] py-1 px-0 z-[9999]"
                data-test="search-download-submenu"
              >
                <button
                  type="button"
                  data-test="search-download-csv-btn"
                  class="flex items-center gap-2.5 w-full py-1.5 px-3 text-[var(--text-sm)] [line-height:1.2] text-left bg-transparent border-0 cursor-pointer text-text-body hover:bg-interactive-hover-bg"
                  @click="downloadLogs(searchObj.data.queryResults.hits, 'csv'); showDownloadSubmenu = false"
                >
                  <OIcon name="grid-on" size="sm" />
                  <span class="flex-1">{{ t("search.downloadCSV") }}</span>
                </button>
                <button
                  type="button"
                  data-test="search-download-json-btn"
                  class="flex items-center gap-2.5 w-full py-1.5 px-3 text-[var(--text-sm)] [line-height:1.2] text-left bg-transparent border-0 cursor-pointer text-text-body hover:bg-interactive-hover-bg"
                  @click="downloadLogs(searchObj.data.queryResults.hits, 'json'); showDownloadSubmenu = false"
                >
                  <OIcon name="data-object" size="sm" />
                  <span class="flex-1">{{ t("search.downloadJSON") }}</span>
                </button>
              </div>
            </div>

            <ODropdownItem
              data-test="logs-search-bar-download-custom-range-btn"
              :disabled="isDownloadDisabled"
              @select="toggleCustomDownloadDialog"
            >
              <template #icon-left>
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <img
                    :src="customRangeIcon"
                    :alt="t('logs.searchBar.customRangeAlt')"
                    class="w-4 h-4"
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
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <img
                    :src="createScheduledSearchIcon"
                    :alt="t('logs.searchBar.createScheduledSearchAlt')"
                    class="w-4 h-4"
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
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <img
                    :src="listScheduledSearchIcon"
                    :alt="t('logs.searchBar.listScheduledSearchAlt')"
                    class="w-4 h-4"
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
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
                  <OIcon name="troubleshoot" size="sm" />
                </span>
              </template>
              <span data-test="search-inspect-label">{{ t('search.searchInspect') }}</span>
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
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
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
          class="order-3"
        />
        <!-- Function Editor (pinned) — sits to the left of the date picker -->
        <OButton
          v-if="showPinnedFunctionEditor"
          data-test="logs-search-bar-function-editor-pinned-btn"
          size="xs"
          variant="outline"
          class="gap-1.5 mr-1 order-1 element-box-shadow"
          @click="searchObj.meta.showTransformEditor = !searchObj.meta.showTransformEditor"
        >
          <OSwitch
            v-model="searchObj.meta.showTransformEditor"
            :size="toolbarToggleIconOnly ? 'sm' : 'md'"
            @click.stop
          />
          <span class="font-mono text-sm italic font-bold text-accent shrink-0">fx</span>
          <OTooltip :content="t('search.functionEditorLabel')" />
        </OButton>

        <div class="mr-1 order-1">
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

        <div class="search-time order-2">
          <div class="flex">
            <OButtonGroup
              class="p-0 mr-1 element-box-shadow border border-card-glass-border"
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
                    class="region-dropdown-btn px-1"
                    :title="t('search.regionTitle')"
                  >
                    {{ t("search.region") }}
                    <OIcon name="arrow-drop-down" size="sm" class="ml-1" />
                  </OButton>
                </template>
                <div
                  class="p-2 min-w-60"
                  data-test="logs-search-bar-region-menu"
                >
                  <OInput
                    clearable
                    class="mb-1.5! indexlist-search-input mx-2 mt-2"
                    v-model="regionFilter"
                    :label="t('search.regionFilterMsg')"
                  />
                  <OTree
                    class="w-full col-sm-6 mx-2 mb-2"
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
                class="flex items-center"
              >
                <OButton
                  v-if="visualizeSearchRequestTraceIds.length > 0"
                  data-test="logs-search-bar-visualize-cancel-btn"
                  :title="t('search.cancel')"
                  variant="ghost"
                  size="sm-toolbar"
                  class="p-0 h-[1.875rem]! font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-cancel-query-bg! text-button-primary-foreground! element-box-shadow rounded-s-default! rounded-e-none!"
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
                  :size="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'md'
                      : 'sm-toolbar'
                  "
                  class="p-0 h-[1.875rem]! element-box-shadow"
                  :class="[
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'o2-ai-generate-button rounded-s-default! rounded-e-none!'
                      : 'font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-button-primary! text-button-primary-foreground! hover:opacity-90 hover:[box-shadow:0_0_8px_color-mix(in_srgb,var(--color-button-primary),transparent_30%)]',
                    'rounded-s-default! rounded-e-none!',
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
                <OSeparator class="h-[1.875rem]! w-px" vertical />
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
                          ? 'bg-cancel-query-bg! text-button-primary-foreground!'
                          : !(
                                isNaturalLanguageDetected &&
                                !searchObj.meta.nlpMode
                              )
                            ? 'bg-button-primary! text-button-primary-foreground! hover:opacity-90 hover:[box-shadow:0_0_8px_color-mix(in_srgb,var(--color-button-primary),transparent_30%)]'
                            : '',
                        'rounded-s-none! rounded-e-default!',
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
                    class="text-xs text-text-secondary text-center px-3 py-2"
                  >
                    {{ t("nlMode.noAdditionalOptions") }}
                  </p>
                </ODropdown>
              </div>
              <div v-else class="flex items-center">
                <!-- Cancel button when query is running -->
                <OButton
                  v-if="visualizeSearchRequestTraceIds.length > 0 && config.isEnterprise == 'true'"
                  data-test="logs-search-bar-visualize-cancel-btn"
                  variant="ghost"
                  :title="t('search.cancel')"
                  size="sm-toolbar"
                  class="p-0 h-[1.875rem]! font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-cancel-query-bg! text-button-primary-foreground! element-box-shadow rounded-s-default! rounded-e-none!"
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
                  :size="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'md'
                      : 'sm-toolbar'
                  "
                  class="p-0 h-[1.875rem]! element-box-shadow"
                  :class="[
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'o2-ai-generate-button rounded-s-default! rounded-e-none!'
                      : 'font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-button-primary! text-button-primary-foreground! hover:opacity-90 hover:[box-shadow:0_0_8px_color-mix(in_srgb,var(--color-button-primary),transparent_30%)]',
                    'rounded-s-default! rounded-e-none!',
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
                <OSeparator class="h-[1.875rem]! w-px" vertical />
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
                          ? 'bg-cancel-query-bg! text-button-primary-foreground!'
                          : !(
                                isNaturalLanguageDetected &&
                                !searchObj.meta.nlpMode
                              )
                            ? 'bg-button-primary! text-button-primary-foreground! hover:opacity-90 hover:[box-shadow:0_0_8px_color-mix(in_srgb,var(--color-button-primary),transparent_30%)]'
                            : '',
                        'rounded-s-none! rounded-e-default!',
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
                    class="text-xs text-text-secondary text-center px-3 py-2"
                  >
                    {{ t("nlMode.noAdditionalOptions") }}
                  </p>
                </ODropdown>
              </div>
            </div>
            <div v-else class="flex items-center">
              <!-- Cancel button for patterns tab -->
              <OButton
                v-if="
                  searchObj.meta.logsVisualizeToggle === 'patterns' &&
                  patternsState.loading
                "
                data-test="logs-search-bar-patterns-cancel-btn"
                variant="ghost"
                :title="t('search.cancel')"
                size="sm-toolbar"
                class="p-0 h-[1.875rem]! font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-cancel-query-bg! text-button-primary-foreground! element-box-shadow rounded-default"
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
                variant="primary"
                :title="t('search.cancel')"
                size="sm-toolbar"
                class="p-0 h-[1.875rem]! font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-cancel-query-bg! text-button-primary-foreground! element-box-shadow"
                :class="
                  config.isEnterprise == 'true'
                    ? 'rounded-s-default! rounded-e-none!'
                    : 'rounded-default'
                "
                @click="cancelQuery"
                >{{ t("search.cancel") }}</OButton
              >
              <!-- Main action button: "Ask AI" when NL detected but AI bar not open, otherwise "Run Query" -->
              <OButton
                v-else
                data-test="logs-search-bar-refresh-btn"
                data-cy="search-bar-refresh-button"
                variant="primary"
                :title="
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? t('search.generateQueryTooltip')
                    : t('search.runQuery')
                "
                :size="
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? 'md'
                    : 'sm-toolbar'
                "
                class="p-0 h-[1.875rem]! element-box-shadow"
                :class="[
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? 'o2-ai-generate-button'
                    : 'font-medium! leading-4! px-1! w-[5.875rem]! whitespace-normal break-words text-center [transition:box-shadow_0.3s_ease,opacity_0.2s_ease] bg-button-primary! text-button-primary-foreground! hover:opacity-90 hover:[box-shadow:0_0_8px_color-mix(in_srgb,var(--color-button-primary),transparent_30%)]',
                  store.state.zoConfig.auto_query_enabled
                    ? 'rounded-s-default! rounded-e-none!'
                    : 'rounded-default',
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
                  class="mr-1"
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
                class="h-[1.875rem]! w-px"
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
                        ? 'bg-cancel-query-bg! text-button-primary-foreground!'
                        : !(
                              isNaturalLanguageDetected &&
                              !searchObj.meta.nlpMode
                            )
                          ? 'bg-button-primary! text-button-primary-foreground! hover:opacity-90 hover:[box-shadow:0_0_8px_color-mix(in_srgb,var(--color-button-primary),transparent_30%)]'
                          : '',
                      store.state.zoConfig.auto_query_enabled
                        ? 'rounded-s-none! rounded-e-default!'
                        : 'rounded-default',
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
                      :class="searchObj.meta.liveMode ? 'text-accent' : ''"
                    />
                  </template>
                  <span>
                    <div class="font-medium">
                      {{
                        searchObj.meta.liveMode
                          ? t("search.turnOffLiveMode")
                          : t("search.turnOnLiveMode")
                      }}
                    </div>
                    <div class="text-xs text-text-secondary">
                      {{ t("search.liveModeTooltip") }}
                    </div>
                  </span>
                </ODropdownItem>
                <!-- NLP mode: info message -->
                <p
                  v-if="isNaturalLanguageDetected && !searchObj.meta.nlpMode"
                  class="text-xs text-text-secondary text-center px-3 py-2"
                >
                  {{ t("nlMode.noAdditionalOptions") }}
                </p>
              </ODropdown>
              <!-- Compact Auto Refresh Button -->
              <auto-refresh-interval
                class="ml-1"
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
         the right (4px wrapper + 6px), aligning with the results panel below.
         data-fullscreen is a stable test hook exposing the fullscreen state
         (the styling itself is driven by the inline `isFocused` class binding).
         Expanded state carries no border/radius/shadow of its own: the editor
         fills the area it is given, and the panel chrome around it already
         supplies the frame — a second curved, shadowed edge on top of it just
         reads as a stray card. -->
    <div
      ref="editorContainerRef"
      class="flex relative query-editor-container w-full overflow-visible"
      :class="{ 'overflow-hidden! bg-theme-body-bg-primary!': isFocused }"
      :data-fullscreen="isFocused ? 'true' : 'false'"
      :style="editorFullscreenStyle"
    >
      <!-- Expand / collapse button — always top-right of the full editor area -->
      <OButton
        :icon-left="isFocused ? 'fullscreen-exit' : 'fullscreen'"
        data-test="logs-query-editor-full_screen-btn"
        variant="ghost"
        size="icon-toolbar"
        @click="toggleEditorFullscreen"
        class="absolute! z-[51] top-[0.1875rem] right-1 [border:1px_solid_var(--color-card-glass-border)]! rounded-default w-7.5! h-7.5! min-w-7.5! min-h-7.5!"
      >
        <OTooltip :content="isFocused ? t('search.collapse') : t('search.expand')" />
      </OButton>
      <div
        class="flex flex-col h-full w-full min-w-0"
      >
        <OSplitter
          class="h-full!"
          v-model="searchObj.config.fnSplitterModel"
          :limits="searchObj.config.fnSplitterLimit"
          :horizontal="false"
          :separator="!!searchObj.data.transformType"
          separator-class="w-px! bg-card-glass-border"
        >
          <template #before>
            <div
              class="flex flex-col overflow-hidden h-full relative"
              :class="{
                'border-r-0 rounded-r-none': searchObj.data.transformType,
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
                class="query-editor-placeholder-overlay absolute top-0 left-0 right-0 bottom-0 flex items-start [padding:0.1875rem_0.5rem_0_2.15rem] pointer-events-none z-[1] select-none"
              >
                <span class="query-editor-placeholder-typewriter">{{ editorPlaceholder }}</span>
              </div>
            </div>
          </template>
          <template #after>
            <div
              data-test="logs-vrl-function-editor"
              v-if="searchObj.data.transformType"
              class="w-full h-full"
            >
              <template v-if="showFunctionEditor">
                <div class="relative h-full w-full">
                  <div
                    class="relative h-full"
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
                      class="query-editor-placeholder-overlay absolute top-0 left-0 right-0 bottom-0 flex items-start [padding:0.1875rem_0.5rem_0_2.15rem] pointer-events-none z-[1] select-none"
                    >
                      <span class="query-editor-placeholder-typewriter">{{ vrlPlaceholder }}</span>
                    </div>
                    <!-- VRL disabled warning for non-table charts -->
                    <div
                      v-if="isVrlEditorDisabled"
                      class="absolute bottom-0 w-full mt-3 flex items-center bg-black/10 dark:bg-[rgba(255,255,255,0.1)]"
                      data-test="vrl-editor-disabled-warning"
                    >
                      <OIcon name="warning" size="md" class="mx-2" />
                      <span
                        class="text-status-error-text p-2 font-semibold"
                        >{{ t('search.vrlOnlyForTableWarning') }}</span
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
      :title="t('common.confirm')"
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
      :title="t('search.customDownloadTitle')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('search.btnDownload')"
      @click:secondary="customDownloadDialog = false"
      @click:primary="downloadRangeData"
    >
    <div class="flex flex-col gap-y-2">
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
        class="py-2"
      />
      <div>
        <div
          class="text-sm font-semibold leading-tight pr-2 text-text-label"
        >{{ t("search.fileType") }}</div>
        <OButtonGroup
          data-test="custom-download-file-type-button-group"
          class="file-type-button-group mt-1"
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
      form-id="saved-view-form"
      :title="t('search.savedViewsLabel')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('common.save')"
      @click:secondary="store.state.savedViewDialog = false"
    >
      <OForm
        id="saved-view-form"
        ref="savedViewFormRef"
        :schema="savedViewSchema"
        :default-values="savedViewDefaults"
        @submit="handleSavedView"
      >
        <div v-if="isSavedViewAction == 'create'">
          <OFormInput
            name="savedViewName"
            data-test="add-alert-name-input"
            :label="t('search.savedViewName')"
            required
          />
        </div>
        <div v-else>
          <OFormSelect
            name="savedViewSelectedName"
            data-test="saved-view-name-select"
            :options="searchObj.data.savedViews"
            label-key="view_name"
            value-key="view_id"
            :label="t('search.savedViewName')"
            class="py-2"
            required
          />
        </div>
      </OForm>
    </ODialog>
    <ODialog
      data-test="search-bar-store-state-saved-function-dialog"
      v-model:open="store.state.savedFunctionDialog"
      size="md"
      form-id="saved-function-form"
      :title="t('search.functionPlaceholder')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      @click:secondary="store.state.savedFunctionDialog = false; functionUpdateConfirm = false"
      @update:open="(open) => { if (!open) functionUpdateConfirm = false }"
    >
      <OForm id="saved-function-form" :form="savedFunctionForm">
        <!-- Form-owned create/update mode (OFormToggleGroup binds it to the
             `isSavedFunctionAction` field so the schema's superRefine branches
             on it). The v-if reads `savedFunctionMode`, a mirror of that field. -->
        <OFormToggleGroup
          name="isSavedFunctionAction"
          data-test="saved-function-action-toggle"
          :disabled="functionOptions.length == 0"
          class="mb-3"
        >
          <OToggleGroupItem value="update" size="sm">{{ t('common.update') }}</OToggleGroupItem>
          <OToggleGroupItem value="create" size="sm">{{ t('common.create') }}</OToggleGroupItem>
        </OFormToggleGroup>
        <div v-if="savedFunctionMode == 'create'">
          <OFormInput
            name="savedFunctionName"
            data-test="saved-function-name-input"
            :label="t('search.saveFunctionName')"
            required
          />
        </div>
        <div v-else>
          <OFormSelect
            name="savedFunctionSelectedName"
            data-test="saved-function-name-select"
            :options="functionOptions"
            label-key="name"
            value-key="name"
            :label="t('search.saveFunctionName')"
            :placeholder="t('search.selectFunctionNamePlaceholder')"
            class="py-2"
            required
          />
        </div>
      </OForm>
    </ODialog>

    <!-- Function update confirmation dialog -->
    <ConfirmDialog
      data-test="search-bar-function-update-confirm-dialog"
      :title="t('search.confirmFunctionUpdateTitle')"
      :message="t('search.confirmFunctionUpdateMsg', { name: functionToUpdateName })"
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
        <div class="text-left mb-1">
          {{ t("search.noOfRecords") }}:
          <OIcon name="info-outline" size="sm" class="ml-1 cursor-pointer" />
            <OTooltip side="right" align="center" max-width="300px">
              <template #content>
                <span class="text-sm">{{ t("search.noOfRecordsTooltip") }}</span>
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
      <div class="text-left">
        {{ t("search.maxEventsScheduleJob") }}
      </div>
      <div class="opacity-80 text-left mapping-warning-msg mt-3">
        <OIcon name="warning" size="sm" class="mr-2 text-status-error-text" />
        <span>{{ t("search.histogramDisabledScheduleJob") }}</span>
      </div>
    </ODialog>

    <!-- Search Inspect Dialog -->
    <ODialog
      data-test="search-bar-search-inspect-dialog"
      v-model:open="searchInspectDialog"
      size="sm"
      :title="t('search.searchInspect')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      :primary-button-disabled="!searchInspectTraceId.trim()"
      @click:secondary="searchInspectDialog = false"
      @click:primary="navigateToSearchInspect"
    >
      <div class="text-left mb-1">{{ t('search.traceIdLabel') }}</div>
      <OInput
        v-model="searchInspectTraceId"
        :placeholder="t('search.enterTraceIdPlaceholder')"
        autofocus
        data-test="search-inspect-trace-id-input"
      />
    </ODialog>

    <ConfirmDialog
      :title="t('search.changeQueryModeTitle')"
      :message="t('search.changeQueryModeConfirm')"
      @update:ok="confirmBuildModeChangeOk"
      @update:cancel="confirmBuildModeChange = false"
      v-model="confirmBuildModeChange"
    />
    <ConfirmDialog
      :title="t('search.deleteSavedView')"
      :message="t('search.deleteSavedViewConfirm')"
      @update:ok="confirmDeleteSavedViews"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <ConfirmDialog
      :title="t('search.updateSavedView')"
      :message="t('search.updateSavedViewConfirm')"
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
          <div data-test="logs-search-saved-view-list" class="flex">
            <div
              class="flex flex-col"
              :class="localSavedViews.length > 0 ? 'border-r border-card-glass-border' : ''"
              :style="localSavedViews.length > 0 ? 'width: 60%' : 'width: 100%'"
            >
              <div class="flex flex-col" style="max-height: 486px; min-height: 280px">
              <OTable
                data-test="log-search-saved-view-list-fields-table"
                :data="searchObj.data.savedViews"
                :columns="savedViewColumns"
                row-key="view_id"
                :global-filter="searchObj.data.savedViewFilterFields"
                :page-size="rowsPerPage"
                :page-size-options="[10, 20, 50]"
                class="saved-view-table h-full! max-h-full o2-table-hide-header"
              >
                <template #top>
                  <div class="px-2 py-2 w-full min-w-0 box-border">
                    <OSearchInput
                      data-test="log-search-saved-view-field-search-input"
                      v-model="searchObj.data.savedViewFilterFields"
                      clearable
                      :debounce="300"
                      class="w-full"
                      :placeholder="t('search.searchSavedView')"
                    />
                  </div>
                  <div
                    v-if="searchObj.loadingSavedView == true"
                    class="w-full p-2"
                  >
                    <div class="text-sm font-medium font-bold">
                      <OSpinner size="xs" />
                      {{ t("confirmDialog.loading") }}
                    </div>
                  </div>
                </template>
                <template #cell-view_name="{ row, value }">
                  <div
                    class="truncate cursor-pointer text-sm min-w-0 w-full"
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
                  <div class="flex items-center gap-0.5">
                    <OButton
                      :title="t('common.favourite')"
                      class="hover:text-text-body! hover:bg-interactive-hover-bg! action-btn-hover"
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
                        :class="
                          favoriteViews.includes(row.view_id)
                            ? 'text-favorite'
                            : ''
                        "
                      />
                    </OButton>
                    <OButton
                      :title="t('common.edit')"
                      class="hover:text-text-body! hover:bg-interactive-hover-bg! action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-update-${row.view_id}-saved-view-btn`"
                      @click.stop="handleUpdateSavedView(row)"
                    >
                      <OIcon name="edit" size="xs" />
                    </OButton>
                    <OButton
                      :title="t('common.delete')"
                      class="hover:text-text-body! hover:bg-interactive-hover-bg! action-btn-hover"
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
                    class="text-center p-2 w-full"
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
              class="flex flex-col w-[40%] ml-0 pl-3"
              v-if="localSavedViews.length > 0"
            >
              <div class="flex flex-col" style="max-height: 480px; min-height: 280px">
              <OTable
                data-test="log-search-saved-view-favorite-list-fields-table"
                :data="localSavedViews"
                :columns="savedViewColumns"
                row-key="view_id"
                pagination="none"
                class="saved-view-table h-full! max-h-full o2-table-hide-header"
              >
                <template #top>
                  <div
                    class="p-2 font-bold text-xs leading-6 uppercase tracking-wide text-muted-foreground"
                  >
                    {{ t("search.favoriteViews") }}
                  </div>
                  <div class="border-t my-1 border-border" />
                </template>
                <template #cell-view_name="{ row, value }">
                  <div
                    class="truncate cursor-pointer text-sm min-w-0 w-full"
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
                  <div class="flex items-center gap-0.5">
                    <OButton
                      :title="t('common.favourite')"
                      class="hover:text-text-body! hover:bg-interactive-hover-bg! action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-favorite-${row.view_id}-saved-view-btn`"
                      @click.stop="handleFavoriteSavedView(row, true)"
                    >
                      <OIcon name="favorite" size="xs" class="text-favorite" />
                    </OButton>
                    <OButton
                      :title="t('common.edit')"
                      class="hover:text-text-body! hover:bg-interactive-hover-bg! action-btn-hover"
                      variant="ghost-neutral"
                      size="icon-sm"
                      :data-test="`logs-search-bar-update-${row.view_id}-favorite-saved-view-btn`"
                      @click.stop="handleUpdateSavedView(row)"
                    >
                      <OIcon name="edit" size="xs" />
                    </OButton>
                    <OButton
                      :title="t('common.delete')"
                      class="hover:text-text-body! hover:bg-interactive-hover-bg! action-btn-hover"
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
import { useTheme } from "@/composables/useTheme";
import DateTime from "@/components/DateTime.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import useLogs from "@/composables/useLogs";
import { useToolbarResponsive } from "@/composables/useToolbarResponsive";
import { useToolbarPins } from "@/composables/useToolbarPins";
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
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
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
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OTree from "@/lib/data/Tree/OTree.vue";
import {
  makeSavedViewSchema,
  type SavedViewForm,
} from "./SearchBar.SavedView.schema";
import { sortSavedViews } from "./savedViewsSort";
import {
  makeSavedFunctionSchema,
  type SavedFunctionForm,
} from "./SearchBar.SavedFunction.schema";

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
    OFormToggleGroup,
    OSpinner,
    OTooltip,
    OInput,
    OSearchInput,
    OSelect,
    OForm,
    OFormInput,
    OFormSelect,
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
          message: this.t('logs.searchBar.noStreamUpdateView'),
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
          message: this.t('logs.searchBar.initialNumberPositive'),
          variant: "warning",
        });
        return;
      }
      if (!this.searchObj?.data?.customDownloadQueryObj?.query) {
        toast({
          message: this.t('logs.searchBar.runQueryBeforeDownload'),
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
              message: this.t('logs.searchBar.noDataToDownload'),
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
    const { isDark } = useTheme();
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

    // savedFunctionName / savedFunctionSelectedName are now OForm-owned fields
    // (see savedFunctionSchema). The name the confirm dialog + update flow show
    // is captured into this ref when the update is requested.
    const functionToUpdateName = ref("");
    const functionUpdateConfirm = ref(false);
    const savedFunctionSchema = makeSavedFunctionSchema(t);
    // The dialog body unmounts on close + remounts on open; the form is created
    // here (owner pattern), so re-seed it to "create" mode on open. The
    // OFormToggleGroup changes the mode within the open session.
    const savedFunctionDefaults = computed((): SavedFunctionForm => ({
      isSavedFunctionAction: "create",
      savedFunctionName: "",
      savedFunctionSelectedName: "",
    }));

    // Owner-pattern form (Rule ③): SearchBar OWNS this <OForm> and its dialog
    // body needs the create/update mode to drive a v-if. We create the form here
    // with useOForm and read `isSavedFunctionAction` reactively via
    // form.useStore — ONE source of truth (no mirror ref / store.subscribe).
    // Handed to <OForm :form="savedFunctionForm">.
    const savedFunctionForm = useOForm<SavedFunctionForm>({
      defaultValues: savedFunctionDefaults.value,
      schema: savedFunctionSchema,
      onSubmit: saveFunction,
    });
    const savedFunctionMode = savedFunctionForm.useStore(
      (s) => (s.values.isSavedFunctionAction as string) ?? "create",
    );
    // Re-seed on open (the form persists in setup across the dialog remount).
    watch(
      () => store.state.savedFunctionDialog,
      (open) => {
        if (open) savedFunctionForm.reset(savedFunctionDefaults.value);
      },
    );
    // Clear ONLY the create-mode name field when the mode changes so toggling
    // update→create shows a blank input, not a stale name (the update select is
    // untouched). `dontUpdateMeta`/`dontValidate` avoid touched/dirty marking
    // and a premature "required" flash.
    watch(savedFunctionMode, () => {
      savedFunctionForm.setFieldValue("savedFunctionName", "", {
        dontUpdateMeta: true,
        dontValidate: true,
      });
    });

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

    // Mode flag (always "create" in the current flow — the update branch is
    // dead UI). Kept as a local ref AND seeded into the saved-view OForm so the
    // schema's superRefine can branch on it.
    const isSavedViewAction = ref("create");
    // savedViewName / savedViewSelectedName are now OForm-owned fields (see
    // savedViewSchema).
    const savedViewFormRef = ref<any>(null);
    const savedViewSchema = makeSavedViewSchema(t);
    const savedViewDefaults = computed((): SavedViewForm => ({
      isSavedViewAction: isSavedViewAction.value,
      savedViewName: "",
      savedViewSelectedName: "",
    }));
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
    const toolbarMoveResetToMenu      = computed(() => availableLeftWidth.value < 248);
    const toolbarToggleAsDropdown     = computed(() => availableLeftWidth.value < 176);

    // ── Pinned toolbar items ──────────────────────────────────────────────
    // Items pinned out of the "More" menu render as fixed-position toolbar
    // controls. They share the left section with the toggle group / reset, so we
    // allocate the leftover width to pinned items with a running budget: the More
    // button is always reserved, then pinned items are kept in priority order
    // (histogram kept longest, syntax guide dropped first).
    const { isPinned, togglePin } = useToolbarPins();

    // Approximate rendered widths (px) of each pinned control and of the fixed
    // left-section content, used only to decide how many pinned items fit before
    // they would clip. Hidden pinned items stay reachable inside the More menu.
    const PIN_ITEM_WIDTH = { histogram: 46, sqlMode: 46, quickMode: 46, savedViews: 62 };
    const SYNTAX_GUIDE_LABEL_WIDTH = 108;
    const SYNTAX_GUIDE_ICON_WIDTH = 40;
    const PIN_ITEM_GAP = 4;

    // Width consumed by the always-present left content (toggle group in its
    // current collapse state, reset) plus the reserved More button.
    const baseReservedWidth = computed(() => {
      let w = 0;
      if (toolbarToggleAsDropdown.value) w += 120;
      else if (toolbarToggleIconOnly.value) w += 190;
      else w += 350;
      if (!toolbarMoveResetToMenu.value) w += shouldHideToolbarButtonText.value ? 40 : 88;
      w += 92; // More button (always visible)
      w += 24; // inter-item gaps / padding buffer
      return w;
    });

    const pinBudget = computed(() =>
      Math.max(0, availableLeftWidth.value - baseReservedWidth.value),
    );

    // Greedily fit pinned items within the budget. Order = kept-longest-first, so
    // the last item (syntax guide) is the first to drop when space runs out.
    const pinnedVisibility = computed(() => {
      const budget = pinBudget.value;
      let used = 0;
      const res = {
        histogram: false,
        sqlMode: false,
        quickMode: false,
        savedViews: false,
        syntaxGuide: false,
        syntaxGuideIconOnly: false,
      };
      const tryFit = (width: number) => {
        const need = (used > 0 ? PIN_ITEM_GAP : 0) + width;
        if (used + need <= budget) {
          used += need;
          return true;
        }
        return false;
      };
      if (isPinned("histogram")) res.histogram = tryFit(PIN_ITEM_WIDTH.histogram);
      if (isPinned("sqlMode")) res.sqlMode = tryFit(PIN_ITEM_WIDTH.sqlMode);
      if (isPinned("quickMode")) res.quickMode = tryFit(PIN_ITEM_WIDTH.quickMode);
      if (isPinned("savedViews")) res.savedViews = tryFit(PIN_ITEM_WIDTH.savedViews);
      if (isPinned("syntaxGuide")) {
        if (tryFit(SYNTAX_GUIDE_LABEL_WIDTH)) {
          res.syntaxGuide = true;
        } else if (tryFit(SYNTAX_GUIDE_ICON_WIDTH)) {
          res.syntaxGuide = true;
          res.syntaxGuideIconOnly = true;
        }
      }
      return res;
    });

    // Function editor lives on the right toolbar (next to the date picker), so it
    // is not part of the left-section budget.
    const showPinnedHistogram      = computed(() => pinnedVisibility.value.histogram);
    const showPinnedSqlMode        = computed(() => pinnedVisibility.value.sqlMode);
    const showPinnedQuickMode      = computed(() => pinnedVisibility.value.quickMode);
    const showPinnedFunctionEditor = computed(() => isPinned("functionEditor"));
    const showPinnedSavedViews     = computed(() => pinnedVisibility.value.savedViews);
    const showPinnedSyntaxGuide    = computed(() => pinnedVisibility.value.syntaxGuide);
    const pinSyntaxGuideIconOnly   = computed(() => pinnedVisibility.value.syntaxGuideIconOnly);

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
        { label: t('logs.searchBar.transformTypeFunction'), value: "function" },
        { label: t('logs.searchBar.transformTypeAction'), value: "action" },
      ];
    });

    const showFunctionEditor = computed(() => {
      // When actions are disabled, fall back to the transform-editor toggle
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
              message: t('logs.searchBar.jobContextRemoved'),
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
            message: t('logs.searchBar.histogramNotAvailableScheduled'),
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
        return t('logs.searchBar.actionAppliedRunQuery', { name: searchObj.data.selectedTransform?.name });
      }

      return t('logs.searchBar.selectActionToApply');
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
              message: t('logs.searchBar.jobContextRemoved'),
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
            message: t('logs.searchBar.rangeExceedsLimit', { hours: searchObj.data.datetime.queryRangeRestrictionInHour }),
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
          message: t('logs.searchBar.noDataToDownload'),
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
          message: t('logs.searchBar.errorDownloadingLogs'),
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

    // @submit handler — the schema already gated the name/select per mode
    // (required + alphanumeric regexes), so there is no imperative
    // field validation here. The content check is a NON-form guard (about the
    // function-editor content). Loading is form-driven (OForm awaits this).
    // Declared as a hoisted function so useOForm (above) can reference it.
    async function saveFunction(value: SavedFunctionForm) {
      const content = searchObj.data.tempFunctionContent;
      const fnName =
        value.isSavedFunctionAction == "create"
          ? value.savedFunctionName
          : value.savedFunctionSelectedName;

      if (content.trim() == "") {
        toast({
          variant: "warning",
          message: t('logs.searchBar.functionFieldRequired'),
        });
        return;
      }

      formData.value.params = "row";
      formData.value.function = content;
      formData.value.transType = 0;
      formData.value.name = fnName;
      searchObj.data.tempFunctionContent = content;

      if (value.isSavedFunctionAction == "create") {
        try {
          const res: { data: any } = await jsTransformService.create(
            store.state.selectedOrganization.identifier,
            formData.value,
          );
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
        } catch (err: any) {
          toast({
            variant: "error",
            message:
              JSON.stringify(err.response.data["message"]) ||
              t('logs.searchBar.functionCreationFailed'),
            timeout: 5000,
          });
        }
      } else {
        // Update mode → capture the function name + open the confirmation
        // overlay (the update itself runs in executeFunctionUpdate).
        functionToUpdateName.value = fnName;
        functionUpdateConfirm.value = true;
      }
    }

    const executeFunctionUpdate = () => {
      const callTransform = jsTransformService.update(
        store.state.selectedOrganization.identifier,
        formData.value,
      );

      callTransform
        .then((res: { data: any }) => {
          toast({
            variant: "success",
            message: t('logs.searchBar.functionUpdatedSuccess'),
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
        })
        .catch((err) => {
          functionUpdateConfirm.value = false;
          toast({
            variant: "error",
            message:
              JSON.stringify(err.response.data["message"]) ||
              t('logs.searchBar.functionUpdationFailed'),
            timeout: 5000,
          });
        });
    };

    const resetFunctionContent = () => {
      fnEditorRef?.value?.setValue("");
      store.dispatch("setSavedFunctionDialog", false);
      functionUpdateConfirm.value = false;
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
          message: t('logs.searchBar.functionAppliedSuccess', { name: fnValue.name }),
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
          message: t('logs.searchBar.noFunctionDefinition'),
        });
        return;
      }
      store.dispatch("setSavedFunctionDialog", true);
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
          message: t('logs.searchBar.noStreamSaveView'),
        });
        return;
      }
      store.dispatch("setSavedViewDialog", true);
      isSavedViewAction.value = "create";
      savedViewDropdownModel.value = false;
    };

    const openSavedViewsList = () => {
      loadSavedView();
      savedViewsListDialog.value = true;
    };

    // ── Saved views quick dropdown (pinned toolbar) ──────────────────────
    // Controlled open state so a quick update can close the menu itself.
    const savedViewsDropdownOpen = ref(false);
    const onSavedViewsDropdownOpenChange = (open: boolean) => {
      savedViewsDropdownOpen.value = open;
      // Lazy-fetch the list the first time the menu opens.
      if (open) loadSavedView();
    };

    const sortedSavedViews = computed(() =>
      sortSavedViews(searchObj.data.savedViews, favoriteViews.value),
    );

    // One-click overwrite of a view with the current search state — no list
    // dialog, no stacked confirm dialog.
    const quickUpdateSavedView = (item: any) => {
      if (searchObj.data.stream.selectedStream.length == 0) {
        toast({
          variant: "error",
          message: t('logs.searchBar.noStreamUpdateView'),
        });
        return;
      }
      savedViewsDropdownOpen.value = false;
      updateSavedViews(item.view_id, item.view_name);
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

            // A saved view's columns are an explicit user choice, not a system
            // FTS default, so they must persist and never be auto-overridden.
            searchObj.meta.isFtsDefaultColumn = false;

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
              message: t('logs.searchBar.viewAppliedSuccess', { name: item.view_name }),
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
            message: t('logs.searchBar.errorApplyingSavedView'),
            variant: "error",
          });
          console.log("Error while applying saved view", err);
        });
    };

    // @submit handler — the schema already gated the name (required + the
    // `/^[A-Za-z0-9 _-]+$/` alphanumeric rule) in create mode and the
    // selected view in update mode, so there is no imperative validation here.
    // Loading is form-driven (OForm awaits createSavedViews).
    const handleSavedView = async (value: SavedViewForm) => {
      if (value.isSavedViewAction == "create") {
        await createSavedViews(value.savedViewName);
      }
      // The update branch is intentionally a no-op: updating from this dialog
      // is disabled; the schema still requires a selected view so this path
      // can't run with an empty select.
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

    // Returns the post promise so the @submit handler can await it (the Save
    // spinner is form-driven and spans the request).
    const createSavedViews = (viewName: string) => {
      try {
        if (viewName.trim() == "") {
          toast({
            message: t('logs.searchBar.provideValidViewName'),
            variant: "warning",
          });
          return;
        }

        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        return savedviewsService
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
            } else {
              toast({
                message: `${t("search.errorCreatingSavedView")} ${res.data.error_detail}`,
                variant: "error",
              });
            }
          })
          .catch((err) => {
            toast({
              message: t("search.errorCreatingSavedView"),
              variant: "error",
            });
            console.log("Error while creating saved view", err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        toast({
          message: t('logs.searchBar.errorSavingView', { e }),
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
          message: t('logs.searchBar.updatingSavedView'),
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
              confirmSavedViewDialogVisible.value = false;
            } else {
              toast({
                message: `${t("search.errorUpdatingSavedView")} ${res.data.error_detail}`,
                variant: "error",
              });
            }
          })
          .catch((err) => {
            dismiss();
            toast({
              message: t("search.errorUpdatingSavedView"),
              variant: "error",
            });
            console.log("Error while updating saved view", err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        toast({
          message: t('logs.searchBar.errorSavingView', { e }),
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
            message: t('logs.searchBar.maxViewsLimit'),
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
          message: t('logs.searchBar.viewAddedFavorites'),
          variant: "success",
        });
      } else {
        // alert(favoriteViews.value.length)
        // moveItemsToTop(localSavedView, favoriteViews.value);
        toast({
          message: t('logs.searchBar.viewRemovedFavorites'),
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
          borderBottom: "0.125rem solid var(--color-card-glass-border)",
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
          isDark.value
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
            message: t('logs.searchBar.selectStreamBeforeSchedule'),
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
        message: t('logs.searchBar.actionAppliedSuccess', { name: item?.name }),
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
        : isDark.value
          ? getImageURL("images/common/visualize_icon_light.svg")
          : getImageURL("images/common/visualize_icon_dark.svg");
    });
    const histogramIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/bar_chart_histogram_light.svg")
        : getImageURL("images/common/bar_chart_histogram.svg");
    });
    const sqlIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/hugeicons_sql_light.svg")
        : getImageURL("images/common/hugeicons_sql.svg");
    });
    const quickModeIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/quick_mode_light.svg")
        : getImageURL("images/common/quick_mode.svg");
    });
    const searchHistoryIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/search_history_light.svg")
        : getImageURL("images/common/search_history.svg");
    });
    const downloadTableIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/download_table_light.svg")
        : getImageURL("images/common/download_table.svg");
    });
    const customRangeIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/custom_range_light.svg")
        : getImageURL("images/common/custom_range.svg");
    });
    const createScheduledSearchIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/create_scheduled_search_light.svg")
        : getImageURL("images/common/create_scheduled_search.svg");
    });
    const listScheduledSearchIcon = computed(() => {
      return isDark.value
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
      savedViewsDropdownOpen,
      onSavedViewsDropdownOpenChange,
      sortedSavedViews,
      quickUpdateSavedView,
      isSavedViewAction,
      // Saved-view OForm (schema returned from setup() so the Options-API
      // template resolves :schema; a bare import would be out of scope).
      savedViewSchema,
      savedViewDefaults,
      savedViewFormRef,
      handleSavedView,
      deleteSavedViews,
      deleteViewID,
      confirmDelete,
      savedViewDropdownModel,
      savedViewsListDialog,
      moreOptionsDropdownModel,
      fnSavedFunctionDialog,
      // Saved-function OForm (owner pattern, Rule ③): the form is created with
      // useOForm and handed to <OForm :form>; `savedFunctionMode` is a reactive
      // form.useStore read of `isSavedFunctionAction` that drives the dialog v-if.
      savedFunctionForm,
      savedFunctionMode,
      savedFunctionSchema,
      savedFunctionDefaults,
      functionToUpdateName,
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
      toolbarMoveResetToMenu,
      toolbarToggleAsDropdown,
      isPinned,
      togglePin,
      pinSyntaxGuideIconOnly,
      showPinnedHistogram,
      showPinnedSqlMode,
      showPinnedQuickMode,
      showPinnedFunctionEditor,
      showPinnedSavedViews,
      showPinnedSyntaxGuide,
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
      return this.t('logs.searchBar.confirmUpdateFunction');
    },
    confirmMessageSavedView() {
      return this.t('logs.searchBar.confirmUpdateSavedViewMsg');
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

<style scoped>
/* keep(complex-state): every selector below reaches into OTable's internal DOM
   (its <td>, its border/pagination wrappers, its footer chip) from the
   .saved-view-table modifier this file puts on the OTable root, so they need
   :deep() rather than template utilities — the markup is not ours to annotate. */
.saved-view-table :deep(.action-btn-hover) {
  opacity: 0;
  transition: opacity 0.15s;
}

.saved-view-table :deep(tr:hover .action-btn-hover) {
  opacity: 1;
}

/* Remove outer box border so both panels blend into the dialog background
   Exclude elements that also have rounded-default (OInput wrapper) so the
   search input keeps its visible border. */
.saved-view-table :deep(.border:not(.rounded-default)) {
  border: none;
}

/* Normalize cell background and strip the auto-pin shadow
   (isAction columns are auto-pinned right by OTable, which adds an inline box-shadow) */
.saved-view-table :deep(td) {
  background: transparent;
  box-shadow: none !important;
  padding: 0;
  height: 1.5625rem !important;
  min-height: 1.5625rem !important;
}

/* ── .logs-search-bar-component: the root modifier this file puts on its own
   wrapper. The rest of the former global block (18 nested rules — .reset-filters,
   .toggle-container, .ddlWrapper/.listWrapper, .savedview-dropdown, #logsQueryEditor,
   #fnEditor, the legacy `> .row` rules, …) targeted DOM that no longer exists
   and was deleted rather than moved. */
.logs-search-bar-component {
  height: 100%;
  overflow: visible;
}

.logs-search-bar-component .download-logs-btn {
  height: 1.875rem;
  border-radius: var(--radius-default);
  transition: all 0.2s ease;
}

.logs-search-bar-component .download-logs-btn:hover {
  background-color: var(--color-interactive-hover-bg);
}

.logs-search-bar-component .query-editor-container {
  height: calc(100% - 2.9rem) !important;
}

/* padding-left intentionally outranks the `px-1` utility on this button — that
   is the pre-existing computed result. */
.logs-search-bar-component .region-dropdown-btn {
  text-transform: capitalize;
  font-weight: 600;
  font-size: var(--text-xs);
  padding-left: 0.5rem;
  height: 1.875rem;
  padding-top: 0.1875rem;
  border-radius: var(--radius-default);
}

/* keep(lib-override:o2): .saved-view-item is rendered by the Function/Transform
   selector child components, so it needs :deep(). The !important outranks the
   px-3/py-2 utilities TransformSelector puts on the same node. */
.logs-search-bar-component :deep(.saved-view-item) {
  padding: 0.125rem 0.25rem !important;
}

/* Remove pagination top separator */
.saved-view-table :deep(.border-t) {
  border-top: none;
}

/* Hide the redundant total-count chip on the left — "of N" on the right already shows it */
.saved-view-table :deep([data-test="o2-table-pagination-bottom"] [data-test="o2-table-pagination-actions"]) {
  display: none;
}

/* Query editor placeholder text styling is global (styles/tailwind.css) —
   shared with traces, RUM sessions, RUM error tracking, and alerts. */
</style>
