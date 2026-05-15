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
  <div class="tw:rounded-md q-pa-none"
    style="min-height: inherit; height: calc(100vh - 88px)"
  >
    <!-- Full-page Import View -->
    <ImportModelPricing
      v-if="showImportModelPricingPage"
      :existing-models="
        models.filter((m: any) => !isReadOnly(m)).map((m: any) => m.name)
      "
      @cancel:hideform="showImportModelPricingPage = false"
      @update:list="fetchModels"
    />

    <!-- Test Match Dialog -->
    <TestModelMatchDialog v-model="showTestMatchDialog" />

    <!-- Main List View -->
    <div v-if="!showImportModelPricingPage">
      <!-- List View Header -->
      <div
        class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      >
        <div
          class="q-table__title tw:font-[600]"
          data-test="model-pricing-list-title"
        >
          {{ t("modelPricing.header") }}
          <OButton
            variant="ghost"
            size="icon-xs-sq"
            data-test="model-pricing-info-btn"
          >
            <q-icon name="info_outline" size="14px" />
            <OTooltip :content="t('modelPricing.matchingPriorityTooltip')" />
          </OButton>
        </div>
        <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <div class="app-tabs-container tw:h-[36px]">
            <app-tabs
              class="tabs-selection-container"
              :tabs="tabOptions"
              v-model:active-tab="selectedTab"
              @update:active-tab="onTabChange"
            />
          </div>
          <OInput
            v-model="filterQuery"
            class="no-border o2-search-input"
            :placeholder="t('modelPricing.searchPlaceholder')"
          >
            <template #prepend>
              <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </OInput>
          <OButton
            variant="outline"
            size="sm"
            :loading="refreshing"
            @click="refreshBuiltIn"
            data-test="model-pricing-refresh-btn"
          >
            {{ t("modelPricing.refresh") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            @click="showTestMatchDialog = true"
            data-test="model-pricing-test-match-btn"
          >
            {{ t("modelPricing.testBtn") }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            @click="openImport"
            data-test="model-pricing-import-btn"
          >
            {{ t("modelPricing.importBtn") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm"
            @click="openEditor(null)"
            data-test="model-pricing-add-btn"
          >
            {{ t("modelPricing.newModel") }}
          </OButton>
        </div>
      </div>

      <!-- List Table -->
      <q-table
        ref="qTableRef"
        data-test="model-pricing-list-table"
        :rows="filteredModels"
        :columns="columns"
        row-key="id"
        v-model:pagination="pagination"
        :sort-method="customSort"
        class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        :style="
          filteredModels.length
            ? 'width: 100%; height: calc(100vh - var(--navbar-height) - 87px); overflow-y: auto;'
            : 'width: 100%'
        "
      >
        <template v-slot:header="props">
          <q-tr :props="props">
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :style="col.style"
            >
              <template v-if="col.name === 'select'">
                <OCheckbox
                  v-if="selectableModels.length > 0"
                  :model-value="allSelected"
                  :indeterminate="someSelected"
                  class="o2-table-checkbox"
                  @update:model-value="toggleSelectAll"
                  data-test="model-pricing-select-all"
                />
              </template>
              <template v-else>
                <span
                  class="tw:inline-flex tw:items-center tw:gap-1"
                  :class="{ 'tw:pl-6': col.name === 'name' }"
                >
                  {{ col.label }}
                  <q-icon
                    v-if="col.tooltip"
                    name="info_outline"
                    size="13px"
                    class="col-header-info-icon"
                  >
                    <OTooltip
                      side="top"
                      align="center"
                      :content="col.tooltip"
                    />
                  </q-icon>
                </span>
              </template>
            </q-th>
          </q-tr>
        </template>

        <template #no-data>
          <div
            v-if="loading"
            class="full-width column flex-center q-mt-xs"
            style="font-size: 1.5rem"
          >
            <OSpinner size="lg" class="tw:mt-[20vh]" />
          </div>
          <div
            v-else
            class="full-width column flex-center"
            style="height: calc(100vh - 220px); gap: 8px"
          >
            <q-icon name="monetization_on" size="48px" color="grey-4" />
            <div class="text-subtitle1 text-grey-7 q-mt-sm">
              {{ t("modelPricing.noModels") }}
            </div>
            <div class="text-caption text-grey-7">
              {{ t("modelPricing.noModelsDesc") }}
            </div>
            <OButton
              variant="primary"
              size="sm"
              @click="openEditor(null)"
              data-test="model-pricing-empty-add-btn"
            >
              {{ t("modelPricing.newModel") }}
            </OButton>
          </div>
        </template>

        <template v-slot:body="props">
          <!-- Parent row -->
          <q-tr :props="props">
            <q-td
              v-for="col in columns"
              :key="col.name"
              :props="props"
              :style="col.style"
              :class="{
                'tree-name-cell': col.name === 'name',
                'tree-parent-expanded':
                  col.name === 'name' &&
                  props.row.children?.length > 0 &&
                  expandedParents.has(props.row.id),
              }"
            >
              <template v-if="col.name === 'select'">
                <OCheckbox
                  :model-value="selectedIds.includes(props.row.id)"
                  class="o2-table-checkbox"
                  @update:model-value="toggleSelect(props.row.id)"
                  :data-test="`model-pricing-select-${props.rowIndex}`"
                />
              </template>
              <template v-else-if="col.name === 'name'">
                <div class="row items-center no-wrap tree-node-content">
                  <div class="tree-icon-wrapper">
                    <q-icon
                      v-if="props.row.children?.length > 0"
                      :name="
                        expandedParents.has(props.row.id)
                          ? 'keyboard_arrow_down'
                          : 'keyboard_arrow_right'
                      "
                      size="xs"
                      class="cursor-pointer tree-expand-icon"
                      @click.stop="toggleExpand(props.row.id)"
                    />
                  </div>
                  <span
                    v-if="getSource(props.row) === 'built_in'"
                    class="tw:shrink-0 tw:cursor-default tw:inline-flex tw:mr-1"
                  >
                    <img
                      :src="ooLogo"
                      class="tw:w-[16px] tw:h-[16px]"
                      alt="OpenObserve"
                    />
                    <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
                  </span>
                  <q-icon
                    v-else-if="
                      getSource(props.row) === 'meta_org' ||
                      (getSource(props.row) === 'org' &&
                        props.row.org_id !== orgIdentifier)
                    "
                    name="corporate_fare"
                    size="16px"
                    class="tw:shrink-0 tw:cursor-default tw:mr-1 source-icon"
                  >
                    <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
                  </q-icon>
                  <q-icon
                    v-else
                    name="person"
                    size="16px"
                    class="tw:shrink-0 tw:cursor-default tw:mr-1 source-icon"
                  >
                    <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
                  </q-icon>
                  <div class="o2-table-cell-content">{{ props.row.name }}</div>
                  <OTooltip
                    v-if="props.row.name.length > 30"
                    side="top"
                    align="center"
                    :content="props.row.name"
                  />
                </div>
              </template>
              <template v-else-if="col.name === 'match_pattern'">
                <div class="tw:flex tw:items-center tw:gap-1">
                  <code
                    class="text-caption pattern-code o2-table-cell-content"
                    >{{ props.row.match_pattern }}</code
                  >
                </div>
              </template>
              <template v-else-if="col.name === 'pricing'">
                <div class="tw:flex tw:flex-wrap tw:gap-1">
                  <template
                    v-if="
                      getDefaultTier(props.row) &&
                      Object.keys(getDefaultTier(props.row).prices || {}).length
                    "
                  >
                    <span
                      v-for="(price, key) in getVisiblePrices(props.row)"
                      :key="key"
                      class="dimension-badge"
                      :class="getPriceKeyColorClass(key as string)"
                    >
                      <span class="tw:font-medium">{{
                        formatPriceKey(key as string)
                      }}</span
                      >=<span>{{ formatPerMillion(price as number) }}</span>
                    </span>
                    <span
                      v-if="getOverflowCount(props.row) > 0"
                      class="dimension-badge badge-more tw:cursor-pointer"
                      @click.stop="openPricingDialog(props.row)"
                    >
                      +{{ getOverflowCount(props.row) }}
                      {{ t("modelPricing.overflowMore") }}
                      <OTooltip>
                        <template #content>
                          <div class="pricing-breakdown-tooltip">
                            <div class="pricing-breakdown-title">
                              {{ props.row.name }}
                            </div>
                            <table class="pricing-breakdown-table">
                              <thead>
                                <tr>
                                  <th>{{ t("modelPricing.usageType") }}</th>
                                  <th>
                                    {{ t("modelPricing.colPricingSimple") }}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr
                                  v-for="[key, price] in sortedPriceEntries(
                                    getDefaultTier(props.row)?.prices || {},
                                  )"
                                  :key="key"
                                >
                                  <td>{{ formatPriceKey(key) }}</td>
                                  <td>{{ formatPerMillion(price) }}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </template>
                      </OTooltip>
                    </span>
                  </template>
                  <span v-else class="text-grey-5">—</span>
                </div>
              </template>
              <template v-else-if="col.name === 'actions'">
                <div class="tw:flex tw:items-center tw:gap-1 tw:justify-end">
                  <template v-if="!isReadOnly(props.row)">
                    <OButton
                      :variant="
                        props.row.enabled ? 'ghost-destructive' : 'ghost'
                      "
                      size="icon-xs-sq"
                      :title="
                        props.row.enabled
                          ? t('modelPricing.actionDisable')
                          : t('modelPricing.actionEnable')
                      "
                      @click.stop="toggleEnabled(props.row, !props.row.enabled)"
                      data-test="model-pricing-toggle-btn"
                    >
                      <q-icon
                        :name="
                          props.row.enabled ? outlinedPause : outlinedPlayArrow
                        "
                        size="14px"
                      />
                    </OButton>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      :title="t('modelPricing.actionEdit')"
                      @click.stop="openEditor(props.row)"
                      data-test="model-pricing-edit-btn"
                    >
                      <q-icon name="edit" size="14px" />
                    </OButton>
                    <OButton
                      variant="ghost-destructive"
                      size="icon-xs-sq"
                      :title="t('modelPricing.actionDelete')"
                      @click.stop="confirmDelete(props.row)"
                      data-test="model-pricing-delete-btn"
                    >
                      <q-icon :name="outlinedDelete" size="14px" />
                    </OButton>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      :title="t('modelPricing.actionDuplicate')"
                      @click.stop="duplicateModel(props.row)"
                      data-test="model-pricing-duplicate-btn"
                    >
                      <q-icon name="content_copy" size="14px" />
                    </OButton>
                  </template>
                  <template v-else>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      :title="t('modelPricing.actionClone')"
                      @click.stop="duplicateModel(props.row)"
                      data-test="model-pricing-clone-btn"
                    >
                      <q-icon name="content_copy" size="14px" />
                    </OButton>
                  </template>
                </div>
              </template>
              <template v-else>
                <div class="o2-table-cell-content">
                  {{ props.row[col.field] }}
                </div>
              </template>
            </q-td>
          </q-tr>

          <!-- Inline children (not counted by q-table pagination) -->
          <template
            v-if="
              props.row.children?.length > 0 &&
              expandedParents.has(props.row.id)
            "
          >
            <!-- Shadow banner -->
            <q-tr class="shadow-banner-row">
              <q-td :colspan="columns.length" class="shadow-banner-cell">
                <div class="shadow-banner-tree-line"></div>
                <q-icon
                  name="warning_amber"
                  size="13px"
                  class="shadow-banner-icon"
                />
                {{ t("modelPricing.shadowBannerPrefix") }}
                <strong :title="props.row.name">
                  {{
                    props.row.name.length > 25
                      ? props.row.name.slice(0, 25) + "…"
                      : props.row.name
                  }}
                </strong>
                {{ t("modelPricing.shadowBannerSuffix") }}
              </q-td>
            </q-tr>
            <!-- Child rows -->
            <q-tr
              v-for="(child, idx) in props.row.children"
              :key="child.id"
              class="child-pricing-row"
            >
              <q-td
                v-for="col in columns"
                :key="col.name"
                :style="
                  col.style + (col.align ? `; text-align: ${col.align};` : '')
                "
                :class="{
                  'tree-name-cell': col.name === 'name',
                  'tree-child': col.name === 'name',
                  'tree-last-child':
                    col.name === 'name' &&
                    idx === props.row.children.length - 1,
                }"
              >
                <template v-if="col.name === 'select'">
                  <OCheckbox
                    :model-value="selectedIds.includes(child.id)"
                    class="o2-table-checkbox"
                    @update:model-value="toggleSelect(child.id)"
                  />
                </template>
                <template v-else-if="col.name === 'name'">
                  <div
                    class="row items-center no-wrap tree-node-content tree-child-content"
                  >
                    <div
                      class="tree-dot-marker"
                      :class="{ 'tree-dot-parent': child.children?.length > 0 }"
                    />
                    <span
                      v-if="getSource(child) === 'built_in'"
                      class="tw:shrink-0 tw:cursor-default tw:inline-flex tw:mr-1"
                    >
                      <img
                        :src="ooLogo"
                        class="tw:w-[16px] tw:h-[16px]"
                        alt="OpenObserve"
                      />
                      <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
                    </span>
                    <q-icon
                      v-else-if="
                        getSource(child) === 'meta_org' ||
                        (getSource(child) === 'org' &&
                          child.org_id !== orgIdentifier)
                      "
                      name="corporate_fare"
                      size="16px"
                      class="tw:shrink-0 tw:cursor-default tw:mr-1 source-icon"
                    >
                      <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
                    </q-icon>
                    <q-icon
                      v-else
                      name="person"
                      size="16px"
                      class="tw:shrink-0 tw:cursor-default tw:mr-1 source-icon"
                    >
                      <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
                    </q-icon>
                    <div class="o2-table-cell-content tw:opacity-70">
                      {{ child.name }}
                    </div>
                    <OTooltip
                      v-if="child.name.length > 30"
                      side="top"
                      align="center"
                      :content="child.name"
                    />
                  </div>
                </template>
                <template v-else-if="col.name === 'match_pattern'">
                  <div class="tw:flex tw:items-center tw:gap-1">
                    <code
                      class="text-caption pattern-code o2-table-cell-content shadowed-pattern"
                      >{{ child.match_pattern }}</code
                    >
                    <q-icon
                      name="warning_amber"
                      size="14px"
                      class="tw:shrink-0 shadowed-icon"
                      color="orange-10"
                    >
                      <OTooltip side="top" align="center" :content="t('modelPricing.shadowedTooltip', { name: props.row.name })" />
                    </q-icon>
                  </div>
                </template>
                <template v-else-if="col.name === 'pricing'">
                  <div class="tw:flex tw:flex-wrap tw:gap-1">
                    <template
                      v-if="
                        getDefaultTier(child) &&
                        Object.keys(getDefaultTier(child).prices || {}).length
                      "
                    >
                      <span
                        v-for="(price, key) in getVisiblePrices(child)"
                        :key="key"
                        class="dimension-badge"
                        :class="getPriceKeyColorClass(key as string)"
                      >
                        <span class="tw:font-medium">{{
                          formatPriceKey(key as string)
                        }}</span
                        >=<span>{{ formatPerMillion(price as number) }}</span>
                      </span>
                      <span
                        v-if="getOverflowCount(child) > 0"
                        class="dimension-badge badge-more tw:cursor-pointer"
                        @click.stop="openPricingDialog(child)"
                      >
                        +{{ getOverflowCount(child) }}
                        {{ t("modelPricing.overflowMore") }}
                        <OTooltip>
                          <template #content>
                            <div class="pricing-breakdown-tooltip">
                              <div class="pricing-breakdown-title">
                                {{ child.name }}
                              </div>
                              <table class="pricing-breakdown-table">
                                <thead>
                                  <tr>
                                    <th>{{ t("modelPricing.usageType") }}</th>
                                    <th>
                                      {{ t("modelPricing.colPricingSimple") }}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr
                                    v-for="[key, price] in sortedPriceEntries(
                                      getDefaultTier(child)?.prices || {},
                                    )"
                                    :key="key"
                                  >
                                    <td>{{ formatPriceKey(key) }}</td>
                                    <td>{{ formatPerMillion(price) }}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </template>
                        </OTooltip>
                      </span>
                    </template>
                    <span v-else class="text-grey-5">—</span>
                  </div>
                </template>
                <template v-else-if="col.name === 'actions'">
                  <div class="tw:flex tw:items-center tw:gap-1 tw:justify-end">
                    <template v-if="!isReadOnly(child)">
                      <OButton
                        :variant="child.enabled ? 'ghost-destructive' : 'ghost'"
                        size="icon-xs-sq"
                        :title="
                          child.enabled
                            ? t('modelPricing.actionDisable')
                            : t('modelPricing.actionEnable')
                        "
                        @click.stop="toggleEnabled(child, !child.enabled)"
                      >
                        <q-icon
                          :name="
                            child.enabled ? outlinedPause : outlinedPlayArrow
                          "
                          size="14px"
                        />
                      </OButton>
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        :title="t('modelPricing.actionEdit')"
                        @click.stop="openEditor(child)"
                      >
                        <q-icon name="edit" size="14px" />
                      </OButton>
                      <OButton
                        variant="ghost-destructive"
                        size="icon-xs-sq"
                        :title="t('modelPricing.actionDelete')"
                        @click.stop="confirmDelete(child)"
                      >
                        <q-icon :name="outlinedDelete" size="14px" />
                      </OButton>
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        :title="t('modelPricing.actionDuplicate')"
                        @click.stop="duplicateModel(child)"
                      >
                        <q-icon name="content_copy" size="14px" />
                      </OButton>
                    </template>
                    <template v-else>
                      <OButton
                        variant="ghost"
                        size="icon-xs-sq"
                        :title="t('modelPricing.actionClone')"
                        @click.stop="duplicateModel(child)"
                      >
                        <q-icon name="content_copy" size="14px" />
                      </OButton>
                    </template>
                  </div>
                </template>
                <template v-else>
                  <div class="o2-table-cell-content">
                    {{ child[col.field] }}
                  </div>
                </template>
              </q-td>
            </q-tr>
          </template>
        </template>

        <template #bottom="scope">
          <div class="bottom-btn tw:h-[48px]">
            <div
              class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px]"
            >
              {{ t("modelPricing.modelsCount", { count: resultTotal }) }}
            </div>
            <OButton
              v-if="selectedCount > 0"
              data-test="model-pricing-export-selected-btn"
              variant="outline"
              size="sm"
              @click="exportSelected"
            >
              <template #icon-left
                ><q-icon name="download" size="14px"
              /></template>
              {{ t("modelPricing.exportSelected", { count: selectedCount }) }}
            </OButton>
            <OButton
              v-if="selectedCount > 0 && selectedIdsOnlyContainsOwn"
              data-test="model-pricing-delete-selected-btn"
              variant="ghost-destructive"
              size="sm"
              @click="confirmDeleteSelected"
            >
              <template #icon-left
                ><q-icon :name="outlinedDelete" size="14px"
              /></template>
              {{ t("modelPricing.deleteSelected", { count: selectedCount }) }}
            </OButton>
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
      </q-table>
    </div>
    <!-- end v-if="!showImportModelPricingPage" -->

    <!-- Pricing detail side panel -->
    <ODrawer data-test="model-pricing-list-pricing-drawer" v-model:open="showPricingDialog" :width="30" title="Hello">
      <!-- #header-left: source icon is conditional (3 variants) with tooltips — cannot be expressed as a simple prop -->
      <template #header-left>
        <span
            v-if="getSource(pricingDialogRow) === 'built_in'"
            class="tw:shrink-0 tw:cursor-default tw:inline-flex"
          >
            <img
              :src="ooLogo"
              class="tw:w-[18px] tw:h-[18px]"
              alt="OpenObserve"
            />
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceBuiltIn')" />
          </span>
          <q-icon
            v-else-if="
              pricingDialogRow &&
              (getSource(pricingDialogRow) === 'meta_org' ||
                (getSource(pricingDialogRow) === 'org' &&
                  pricingDialogRow.org_id !== orgIdentifier))
            "
            name="corporate_fare"
            size="18px"
            class="tw:shrink-0 tw:cursor-default source-icon"
          >
             <OTooltip side="top" align="center" :content="t('modelPricing.sourceInherited')" />
          </q-icon>
          <q-icon
            v-else
            name="person"
            size="18px"
            class="tw:shrink-0 tw:cursor-default source-icon"
          >
            <OTooltip side="top" align="center" :content="t('modelPricing.sourceCustom')" />
          </q-icon>
      </template>

      <div class="q-pa-md pricing-dialog-body">
        <div v-if="pricingDialogRow">
          <!-- Pattern section -->
          <div class="tw:mb-4">
            <div class="pricing-section-label">
              {{ t("modelPricing.colPattern") }}
            </div>
            <code class="text-caption pattern-code pattern-code-panel">{{
              pricingDialogRow.match_pattern
            }}</code>
          </div>
          <q-separator class="tw:mb-4" />

          <!-- Pricing per 1M tokens section -->
          <div>
            <div class="pricing-section-label tw:mt-2">
              {{ t("modelPricing.colPricing") }}
            </div>
            <div
              v-if="
                sortedPriceEntries(
                  getDefaultTier(pricingDialogRow)?.prices || {},
                ).length
              "
              class="pricing-panel-table-wrap"
            >
              <table class="pricing-panel-table">
                <thead>
                  <tr>
                    <th>{{ t("modelPricing.usageType") }}</th>
                    <th>{{ t("modelPricing.colPricing") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="[key, price] in sortedPriceEntries(
                      getDefaultTier(pricingDialogRow)?.prices || {},
                    )"
                    :key="key"
                  >
                    <td>{{ formatPriceKey(key) }}</td>
                    <td>{{ formatPerMillion(price) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span v-else class="text-grey-5">—</span>
          </div>
        </div>
      </div>
    </ODrawer>

    <confirm-dialog
      v-model="confirmDialogMeta.show"
      :title="confirmDialogMeta.title"
      :message="confirmDialogMeta.message"
      @update:ok="confirmDialogMeta.onConfirm()"
      @update:cancel="resetConfirmDialog"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeMount, onActivated, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
} from "@quasar/extras/material-icons-outlined";
import { getImageURL } from "@/utils/zincutils";
import modelPricingService from "@/services/model_pricing";
import ImportModelPricing from "@/components/settings/ImportModelPricing.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import { LayoutList, Sliders, Building2 } from "lucide-vue-next";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import TestModelMatchDialog from "@/components/settings/TestModelMatchDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const q = useQuasar();

const qTableRef = ref<any>(null);
const models = ref<any[]>([]);
const loading = ref(true);
const refreshing = ref(false);

// Pricing detail side panel
const showPricingDialog = ref(false);
const pricingDialogRow = ref<any>(null);

function openPricingDialog(row: any) {
  pricingDialogRow.value = row;
  showPricingDialog.value = true;
}

const confirmDialogMeta = ref({
  show: false,
  title: "",
  message: "",
  onConfirm: async () => {},
});

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
};
const filterQuery = ref("");
const showImportModelPricingPage = ref(false);
const showTestMatchDialog = ref(false);
const selectedIds = ref<string[]>([]);
const selectedTab = ref("all");

const tabOptions = computed(() => [
  { label: t("modelPricing.tabAll"), value: "all", icon: LayoutList },
  { label: t("modelPricing.tabCustom"), value: "org", icon: Sliders },
  { label: t("modelPricing.tabSystem"), value: "inherited", icon: Building2 },
]);

function onTabChange() {
  selectedIds.value = [];
}

const perPageOptions: any = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];

function changePagination(val: { label: string; value: any }) {
  pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(pagination.value);
}

const hasSelectableModels = computed(() => models.value.length > 0);

/** Flat list of all models (parents + children) for ID-based lookups. */
const allModels = computed(() => {
  const result: any[] = [];
  for (const m of models.value) {
    result.push(m);
    if (m.children?.length) result.push(...m.children);
  }
  return result;
});

const columns = computed(() => {
  const cols: any[] = [];
  if (hasSelectableModels.value) {
    cols.push({
      name: "select",
      label: "",
      field: "select",
      align: "center",
      style: "width: 40px; min-width: 40px; max-width: 40px;",
    });
  }
  cols.push(
    {
      name: "name",
      label: t("modelPricing.colModel"),
      field: "name",
      align: "left",
      sortable: true,
      style: "width: 280px; min-width: 280px; max-width: 280px;",
      tooltip: t("modelPricing.colModelTooltip"),
    },
    {
      name: "match_pattern",
      label: t("modelPricing.colMatchPattern"),
      field: "match_pattern",
      align: "left",
      style:
        "width: 280px; min-width: 280px; max-width: 280px; overflow: hidden;",
      tooltip: t("modelPricing.colMatchPatternTooltip"),
    },
    {
      name: "pricing",
      label: t("modelPricing.colPricing"),
      field: "pricing",
      align: "left",
      style: "min-width: 200px;",
      tooltip: t("modelPricing.colPricingTooltip"),
    },
    {
      name: "actions",
      label: t("modelPricing.colActions"),
      field: "actions",
      align: "center",
      style: "width: 120px; min-width: 120px; max-width: 120px;",
      classes: "actions-column",
      headerClasses: "actions-column",
    },
  );
  return cols;
});

const pagination = ref({ rowsPerPage: 20 });

const resultTotal = computed(() => filteredModels.value.length);

// Selection helpers
const selectableModels = computed(() => filteredModels.value);

/** Selectable rows visible on the current page (parents + expanded children). */
const currentPageSelectableModels = computed(() => {
  const perPage = pagination.value.rowsPerPage || 0;
  const allParents = filteredModels.value;
  const pageParents =
    perPage === 0
      ? allParents
      : allParents.slice(
          ((qTableRef.value?.computedPagination?.page ?? 1) - 1) * perPage,
          (qTableRef.value?.computedPagination?.page ?? 1) * perPage,
        );
  const result: any[] = [];
  for (const parent of pageParents) {
    result.push(parent);
    if (parent.children?.length > 0 && expandedParents.value.has(parent.id)) {
      result.push(...parent.children);
    }
  }
  return result;
});

const selectedIdsOnlyContainsOwn = computed(() => {
  if (selectedIds.value.length === 0) return false;
  return selectedIds.value.every((id) => {
    const model = allModels.value.find((m: any) => m.id === id);
    return model && !isReadOnly(model);
  });
});

const selectedCount = computed(() => selectedIds.value.length);
const allSelected = computed(
  () =>
    currentPageSelectableModels.value.length > 0 &&
    currentPageSelectableModels.value.every((m: any) =>
      selectedIds.value.includes(m.id),
    ),
);
const someSelected = computed(
  () => selectedCount.value > 0 && !allSelected.value,
);

function toggleSelectAll() {
  const pageIds = currentPageSelectableModels.value.map((m: any) => m.id);
  if (allSelected.value) {
    selectedIds.value = [];
  } else {
    // Select only the current page's selectable items — clear any off-screen selections
    selectedIds.value = [...pageIds];
  }
}

function toggleSelect(id: string) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1);
  } else {
    selectedIds.value.push(id);
  }
}

/** Get the source of a model: 'built_in', 'meta_org', or 'org'. */
function getSource(model: any): string {
  return model.source || "org";
}

/** True when a model entry is read-only (built-in or from another org). */
function isReadOnly(model: any): boolean {
  return model.source === "built_in" || model.org_id !== orgIdentifier.value;
}

function sectionLabel(section: string): string {
  return section === "built_in" ? "Built-in (OpenObserve)" : "Global";
}

const filteredModels = computed(() => {
  let items = models.value;
  if (filterQuery.value) {
    const search = filterQuery.value.toLowerCase();
    items = items.filter(
      (m: any) =>
        m.name.toLowerCase().includes(search) ||
        m.match_pattern.toLowerCase().includes(search),
    );
  }

  // Tab filtering
  const tab = selectedTab.value;
  if (tab === "org") {
    items = items.filter(
      (m: any) => getSource(m) === "org" && m.org_id === orgIdentifier.value,
    );
    return items.map((m: any) => ({ ...m, __sectionStart: null }));
  }
  if (tab === "inherited") {
    const metaItems = items.filter(
      (m: any) =>
        getSource(m) === "meta_org" ||
        (getSource(m) === "org" && m.org_id !== orgIdentifier.value),
    );
    const builtInItems = items.filter((m: any) => getSource(m) === "built_in");
    const sorted: any[] = [];
    if (metaItems.length > 0) {
      metaItems[0] = { ...metaItems[0], __sectionStart: "meta_org" };
      for (let i = 1; i < metaItems.length; i++)
        metaItems[i] = { ...metaItems[i], __sectionStart: null };
      sorted.push(...metaItems);
    }
    if (builtInItems.length > 0) {
      builtInItems[0] = { ...builtInItems[0], __sectionStart: "built_in" };
      for (let i = 1; i < builtInItems.length; i++)
        builtInItems[i] = { ...builtInItems[i], __sectionStart: null };
      sorted.push(...builtInItems);
    }
    return sorted;
  }

  // "all" tab — group by source with section headers
  const orgItems = items.filter(
    (m: any) => getSource(m) === "org" && m.org_id === orgIdentifier.value,
  );
  const metaItems = items.filter(
    (m: any) =>
      getSource(m) === "meta_org" ||
      (getSource(m) === "org" && m.org_id !== orgIdentifier.value),
  );
  const builtInItems = items.filter((m: any) => getSource(m) === "built_in");

  const sorted: any[] = [];

  // Add org items
  sorted.push(...orgItems);

  // Add meta section
  if (metaItems.length > 0) {
    metaItems[0] = { ...metaItems[0], __sectionStart: "meta_org" };
    for (let i = 1; i < metaItems.length; i++) {
      metaItems[i] = { ...metaItems[i], __sectionStart: null };
    }
    sorted.push(...metaItems);
  }

  // Add built-in section
  if (builtInItems.length > 0) {
    builtInItems[0] = { ...builtInItems[0], __sectionStart: "built_in" };
    for (let i = 1; i < builtInItems.length; i++) {
      builtInItems[i] = { ...builtInItems[i], __sectionStart: null };
    }
    sorted.push(...builtInItems);
  }

  // Ensure org items don't have section markers
  for (const item of orgItems) {
    item.__sectionStart = null;
  }

  return sorted;
});

/** Sort within each section group (q-table only receives parent rows). */
function customSort(rows: any[], sortBy: string, descending: boolean) {
  if (!sortBy) return rows;

  const compare = (a: any, b: any) => {
    const aVal = (a[sortBy] ?? "").toString().toLowerCase();
    const bVal = (b[sortBy] ?? "").toString().toLowerCase();
    const cmp = aVal.localeCompare(bVal);
    return descending ? -cmp : cmp;
  };

  const orgRows = rows.filter(
    (r: any) => getSource(r) === "org" && r.org_id === orgIdentifier.value,
  );
  const metaRows = rows.filter(
    (r: any) =>
      getSource(r) === "meta_org" ||
      (getSource(r) === "org" && r.org_id !== orgIdentifier.value),
  );
  const builtInRows = rows.filter((r: any) => getSource(r) === "built_in");

  orgRows.sort(compare);
  metaRows.sort(compare);
  builtInRows.sort(compare);

  [...orgRows, ...metaRows, ...builtInRows].forEach((r: any) => {
    r.__sectionStart = null;
  });
  if (metaRows.length > 0) metaRows[0].__sectionStart = "meta_org";
  if (builtInRows.length > 0) builtInRows[0].__sectionStart = "built_in";

  return [...orgRows, ...metaRows, ...builtInRows];
}

function getDefaultTier(model: any) {
  // Find the first unconditional tier (the fallback/default tier).
  // The editor always stores the default as tiers[0], but inherited/built-in
  // entries might have a different order.
  const fallback = model.tiers?.find((t: any) => !t.condition);
  return fallback || model.tiers?.[0];
}

const PRICE_KEY_ORDER = ["input", "output"];

function sortedPriceEntries(
  prices: Record<string, number>,
): [string, number][] {
  return Object.entries(prices).sort(([a], [b]) => {
    const ai = PRICE_KEY_ORDER.indexOf(a);
    const bi = PRICE_KEY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Return the first N prices to display inline as chips. */
const MAX_VISIBLE_PRICES = 2;
function getVisiblePrices(model: any): Record<string, number> {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return {};
  return Object.fromEntries(
    sortedPriceEntries(tier.prices).slice(0, MAX_VISIBLE_PRICES),
  );
}

/** How many prices are hidden behind the overflow "+N" chip. */
function getOverflowCount(model: any): number {
  const tier = getDefaultTier(model);
  if (!tier?.prices) return 0;
  const total = Object.keys(tier.prices).length;
  return Math.max(0, total - MAX_VISIBLE_PRICES);
}

// ── Parent-children expand/collapse ──────────────────────────────────────────

const expandedParents = ref(new Set<string>());

function toggleExpand(id: string) {
  const next = new Set(expandedParents.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedParents.value = next;
}

/** Shorten usage key for display: replace underscores with hyphens, drop trailing "_tokens". */
function formatPriceKey(key: string): string {
  return key.replace(/_tokens$/, "").replace(/_/g, "-");
}

function getPriceKeyColorClass(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("input")) return "badge-blue";
  if (k.includes("output")) return "badge-green";
  // Hash-based color for all other arbitrary keys
  const palette = [
    "badge-cyan",
    "badge-purple",
    "badge-pink",
    "badge-orange",
    "badge-amber",
    "badge-violet",
    "badge-rose",
    "badge-teal",
    "badge-indigo",
  ];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash = hash & hash;
  }
  return palette[Math.abs(hash) % palette.length];
}

function formatPerMillion(pricePerToken: number | undefined | null): string {
  if (pricePerToken == null || pricePerToken === undefined) return "$0.00";
  if (pricePerToken === 0) return "$0.00";
  const perMillion = pricePerToken * 1_000_000;
  return `$${perMillion.toFixed(2)}`;
}

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier || "",
);

const ooLogo = computed(() =>
  store.state.theme === "dark"
    ? getImageURL("openobserve_favicon_dark.ico")
    : getImageURL("images/common/openobserve_favicon.png"),
);

/** Show error notification only for non-403 errors.
 *  403 errors are already handled by the global HTTP interceptor (persistent top banner). */
function notifyError(prefix: string, e: any) {
  if (e?.response?.status === 403) return;
  const msg =
    e?.response?.data?.message || e?.message || t("modelPricing.errUnknown");
  q.notify({
    type: "negative",
    message: `${prefix}: ${msg}`,
    position: "bottom",
    timeout: 5000,
  });
}

async function fetchModels() {
  loading.value = true;
  try {
    const res = await modelPricingService.list(orgIdentifier.value);
    models.value = res.data || [];
  } catch (e: any) {
    notifyError(t("modelPricing.errLoadModels"), e);
  } finally {
    loading.value = false;
  }
}

function openEditor(model: any) {
  if (model) {
    router.push({
      name: "modelPricingEditor",
      query: { org_identifier: orgIdentifier.value, id: model.id },
    });
  } else {
    router.push({
      name: "modelPricingEditor",
      query: { org_identifier: orgIdentifier.value },
    });
  }
}

async function toggleEnabled(model: any, enabled: boolean) {
  try {
    // Strip internal UI fields before sending to API
    const { __sectionStart, ...clean } = model;
    const updated = { ...clean, enabled };
    await modelPricingService.update(orgIdentifier.value, model.id, updated);
    await fetchModels(); // refetch to reflect server state
    const displayName =
      model.name.length > 30 ? model.name.slice(0, 30) + "…" : model.name;
    const message = enabled
      ? t("modelPricing.modelEnabledNotif", { name: displayName })
      : t("modelPricing.modelDisabledNotif", { name: displayName });
    q.notify({ type: "positive", message, position: "bottom", timeout: 3000 });
  } catch (e: any) {
    notifyError(t("modelPricing.errUpdate"), e);
  }
}

function duplicateModel(model: any) {
  router.push({
    name: "modelPricingEditor",
    query: {
      org_identifier: orgIdentifier.value,
      id: model.id,
      duplicate: "true",
    },
  });
}

function confirmDelete(model: any) {
  confirmDialogMeta.value = {
    show: true,
    title: t("modelPricing.confirmDeleteTitle"),
    message: t("modelPricing.confirmDeleteMessage", { name: model.name }),
    onConfirm: async () => {
      try {
        await modelPricingService.delete(orgIdentifier.value, model.id);
        q.notify({
          type: "positive",
          message: t("modelPricing.modelPricingDeleted"),
          position: "bottom",
          timeout: 3000,
        });
        await fetchModels();
      } catch (e: any) {
        notifyError(t("modelPricing.errDelete"), e);
      }
    },
  };
}

function openImport() {
  showImportModelPricingPage.value = true;
  router.push({
    name: "modelPricing",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
      action: "import",
    },
  });
}

async function refreshBuiltIn() {
  refreshing.value = true;
  try {
    await modelPricingService.refreshBuiltIn(orgIdentifier.value);
    q.notify({
      type: "positive",
      message: t("modelPricing.builtInRefreshed"),
      position: "bottom",
      timeout: 3000,
    });
    await fetchModels();
  } catch (e: any) {
    notifyError(t("modelPricing.errRefresh"), e);
  } finally {
    refreshing.value = false;
  }
}

function exportModel(model: any) {
  const exportData = {
    name: model.name,
    match_pattern: model.match_pattern,
    enabled: model.enabled,
    tiers: model.tiers,
    sort_order: model.sort_order ?? 0,
    valid_from: model.valid_from ?? null,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${model.name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportSelected() {
  const selected = allModels.value.filter((m: any) =>
    selectedIds.value.includes(m.id),
  );
  if (selected.length === 0) {
    q.notify({
      type: "warning",
      message: t("modelPricing.noModelsSelected"),
      position: "bottom",
      timeout: 3000,
    });
    return;
  }
  const exportData = selected.map((m: any) => ({
    name: m.name,
    match_pattern: m.match_pattern,
    enabled: m.enabled,
    tiers: m.tiers,
    sort_order: m.sort_order ?? 0,
    valid_from: m.valid_from ?? null,
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "model_pricing_export.json";
  link.click();
  URL.revokeObjectURL(url);
}

function confirmDeleteSelected() {
  const count = selectedIds.value.length;
  confirmDialogMeta.value = {
    show: true,
    title: t("modelPricing.confirmDeleteSelectedTitle"),
    message: t("modelPricing.confirmDeleteSelectedMessage", { count }),
    onConfirm: async () => {
      let successCount = 0;
      for (const id of selectedIds.value) {
        const modelEntry = allModels.value.find((m: any) => m.id === id);
        const modelName = modelEntry?.name || id;
        try {
          await modelPricingService.delete(orgIdentifier.value, id);
          successCount++;
        } catch (e: any) {
          notifyError(t("modelPricing.errDeleteNamed", { name: modelName }), e);
        }
      }
      if (successCount > 0) {
        q.notify({
          type: "positive",
          message: t("modelPricing.deletedModelsNotif", {
            count: successCount,
          }),
          position: "bottom",
          timeout: 3000,
        });
        selectedIds.value = [];
        await fetchModels();
      }
    },
  };
}

onBeforeMount(() => {
  fetchModels();
  if (router.currentRoute.value.query.action === "import") {
    showImportModelPricingPage.value = true;
  }
});

onActivated(() => {
  fetchModels();
  if (router.currentRoute.value.query.action === "import") {
    showImportModelPricingPage.value = true;
  }
});
</script>

<style lang="scss">
.bottom-btn {
  display: flex;
  align-items: center;
  width: 100%;
}

.o2-table-cell-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  display: block;
}

.section-header-cell {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid var(--o2-border-color);

  .body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }
}

.section-header-title {
  font-weight: 700;
  opacity: 0.8;
}

.section-header-subtitle {
  opacity: 0.6;
}

/* Add pattern code block styling */
.pattern-code {
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid var(--o2-border-color);
  padding: 2px 6px;
  border-radius: 4px;
  color: inherit;
}

body.body--dark .pattern-code {
  background: rgba(255, 255, 255, 0.05);
}

.pricing-section-label {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #555;

  .body--dark & {
    color: #aaa;
  }
}

.pattern-code-panel {
  display: block;
  font-size: 13px;
  padding: 6px 10px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

/* ── Dimension badges (pricing) ─────────────────────── */
.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
  border: 1px solid #d1d5db;
  color: inherit;
}

.badge-more {
  background: #e5e7eb;
  color: #6b7280;
  font-weight: 500;
  border: none;
}

body.body--dark .badge-more {
  background: #4b5563;
  color: #d1d5db;
}

/* ── Pricing detail side panel ────────────────────── */
.pricing-dialog-panel {
  width: 30vw !important;
  min-width: 320px;
  max-width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;

  .add-stream-header {
    min-height: 64px;
  }
}

.pricing-dialog-body {
  flex: 1;
  overflow-y: auto;
}

/* ── Pricing panel table (side panel) ──────────────── */
.pricing-panel-table-wrap {
  margin-top: 8px;
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.pricing-panel-table {
  width: 100%;
  border-collapse: collapse;

  th {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.5;
    text-align: left;
    padding: 6px 14px;
    background: rgba(0, 0, 0, 0.025);
    border-bottom: 1px solid var(--o2-border-color);

    .body--dark & {
      background: rgba(255, 255, 255, 0.04);
    }

    &:last-child {
      text-align: right;
    }
  }

  td {
    font-size: 13px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--o2-border-color);

    &:last-child {
      text-align: right;
      font-weight: 600;
    }
  }

  tr:last-child td {
    border-bottom: none;
  }
}

/* ── Pricing overflow tooltip ──────────────────────── */
.pricing-overflow-tooltip {
  padding: 12px 16px;
  min-width: 260px;
}

.pricing-breakdown-tooltip {
  min-width: 240px;
}

.pricing-breakdown-title {
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 3px;
}

.pricing-breakdown-table {
  width: 100%;
  border-collapse: collapse;

  th {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.65;
    text-align: left;
    padding: 0 16px 4px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);

    &:last-child {
      text-align: right;
      padding-right: 0;
    }
  }

  td {
    font-size: 12px;
    padding: 2px 16px 2px 0;
    border-bottom: none;

    &:last-child {
      text-align: right;
      padding-right: 0;
      font-weight: 500;
    }
  }

  tr:last-child td {
    border-bottom: none;
  }
}

body.body--dark {
  .dimension-badge {
    color: #ffffff;
    border-color: #4b5563;
  }
}

/* ── Shadow banner row ─────────────────────────────────── */
.o2-quasar-table .shadow-banner-row td {
  height: 26px !important;
}

.shadow-banner-row td {
  padding: 3px 12px !important;
  border-top: none !important;
  text-align: center;
  font-size: 11px !important;
  position: relative;
  background: rgba(245, 158, 11, 0.06);
  border-bottom: 1px solid rgba(245, 158, 11, 0.15) !important;
  color: #92400e;
  line-height: 1.5;

  .body--dark & {
    background: rgba(245, 158, 11, 0.08);
    color: #fcd34d;
    border-bottom-color: rgba(245, 158, 11, 0.2) !important;
  }
}

.shadow-banner-tree-line {
  position: absolute;
  left: 54px;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background-color: var(--q-primary);
  opacity: 0.6;
  z-index: 2;
  pointer-events: none;
}

.shadow-banner-icon {
  color: #f59e0b;
  margin-right: 5px;
  vertical-align: middle;
  flex-shrink: 0;
}

/* ── Column header info icon ───────────────────────────── */
.col-header-info-icon {
  opacity: 0.35;
  cursor: default;
  vertical-align: middle;
  &:hover {
    opacity: 0.7;
  }
}

/* ── Source icons (person / corporate_fare) ────────────── */
.source-icon {
  color: #757575;

  .body--dark & {
    color: #bdbdbd;
  }
}

/* ── Shadowed pattern (strikethrough + dim) ────────────── */
.shadowed-pattern {
  opacity: 0.5;
  text-decoration: line-through;
  text-decoration-color: currentColor;
}

/* ── Shadowed icon (orange-ish, muted) ─────────────────── */
.shadowed-icon {
  color: #f59e0b; // amber-500
  opacity: 0.85;

  .body--dark & {
    color: #fbbf24; // amber-400
  }
}

/* ── Child (shadowed) rows ─────────────────────────────── */
.child-pricing-row {
  background: rgba(0, 0, 0, 0.015);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.02);
  }

  td {
    border-top: none !important;
  }
}

/* ── Tree connector lines (SearchJobInspector style) ────── */

// The name-column td — always position:relative so absolute children work
.tree-name-cell {
  position: relative;
}

// Expanded parent: draw a line from the chevron centre DOWN to the cell bottom
.tree-parent-expanded.tree-name-cell::after {
  content: "";
  position: absolute;
  left: 14px;
  top: calc(50% + 11px);
  bottom: 0;
  width: 1.5px;
  background-color: var(--q-primary);
  opacity: 0.6;
  z-index: 1;
}

// Child rows: vertical line top→bottom, horizontal connector at midpoint
.tree-child.tree-name-cell {
  // Vertical line — full height for non-last children
  &::before {
    content: "";
    position: absolute;
    left: 14px;
    top: 0;
    bottom: 0;
    width: 1.5px;
    background-color: var(--q-primary);
    opacity: 0.6;
    z-index: 1;
  }

  // Last child: vertical line only runs top→middle (no downward stub)
  &.tree-last-child::before {
    bottom: 50%;
  }

  // Horizontal connector from vertical line to content
  &::after {
    content: "";
    position: absolute;
    left: 15px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 1.5px;
    background-color: var(--q-primary);
    opacity: 0.6;
    z-index: 1;
  }
}

// Icon wrapper — same fixed width as SearchJobInspector
.tree-icon-wrapper {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 4px;
}

.tree-expand-icon {
  flex-shrink: 0;
}

// Content container — above the connector lines
.tree-node-content {
  position: relative;
  z-index: 2;
  min-height: 24px;
}

// Child row: indent the content so tree lines show on the left
.tree-child-content {
  padding-left: 44px;
}

// Junction dot — matches SearchJobInspector exactly
// (rendered as a real element because ::before and ::after are used for the lines)
.tree-dot-marker {
  position: absolute;
  left: 33px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  background-color: var(--q-primary);
  opacity: 0.7;
  border: 2px solid var(--q-background);
  border-radius: 0; // square for leaf nodes (no deeper children)
  z-index: 3;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
}

// Circular dot when the child itself also has children (matches SearchJobInspector's tree-is-parent)
.tree-dot-marker.tree-dot-parent {
  border-radius: 50%;
}
</style>
