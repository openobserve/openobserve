<!-- Copyright 2023 OpenObserve Inc.

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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div
    class="col column full-height"
    style="
      overflow: hidden !important;
      padding: 0 !important;
      margin: 0 !important;
      height: 100%;
    "
  >
    <div class="search-list full-height full-width" ref="searchListContainer">
      <div class="row tw-min-h-[28px] tw-pt-[0.375rem]">
        <div
          class="col-7 text-left q-pl-lg bg-warning text-white rounded-borders"
          v-if="searchObj.data.countErrorMsg != ''"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-total-count-error-message"
            :htmlContent="searchObj.data.countErrorMsg"
          />
        </div>
        <div v-else class="col-7 text-left q-pl-lg warning flex items-center">
          {{ noOfRecordsTitle }}
          <span v-if="searchObj.loadingCounter" class="q-ml-md">
            <q-spinner-hourglass
              color="primary"
              size="25px"
              class="search-spinner"
            />
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="300px"
            >
              <span class="search-loading-text"
                >Fetching the search events</span
              >
            </q-tooltip>
          </span>
          <div
            v-else-if="
              searchObj.data.histogram.errorCode == -1 &&
              !searchObj.loadingCounter &&
              searchObj.meta.showHistogram
            "
            class="q-ml-md tw-cursor-pointer"
            :class="
              store.state.theme == 'dark'
                ? 'histogram-unavailable-text'
                : 'histogram-unavailable-text-light'
            "
          >
            <!-- {{ searchObj.data.histogram.errorMsg }} -->
            <q-icon name="info"
color="warning" size="sm"> </q-icon>
            <q-tooltip position="top" class="tw-text-sm tw-font-semi-bold">
              {{ searchObj.data.histogram.errorMsg }}
            </q-tooltip>
          </div>
        </div>

        <div class="col-5 text-right q-pr-sm q-gutter-xs pagination-block">
          <q-pagination
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
            :disable="searchObj.loading == true"
            v-model="pageNumberInput"
            :key="
              searchObj.data.queryResults.total +
              '-' +
              searchObj.data.resultGrid.currentPage
            "
            :max="
              Math.max(
                1,
                (searchObj.communicationMethod === 'streaming' ||
                searchObj.meta.jobId != ''
                  ? searchObj.data.queryResults?.pagination?.length
                  : searchObj.data.queryResults?.partitionDetail?.paginations
                      ?.length) || 0,
              )
            "
            :input="false"
            direction-links
            :boundary-numbers="false"
            :max-pages="5"
            :ellipses="false"
            icon-first="skip_previous"
            icon-last="skip_next"
            icon-prev="fast_rewind"
            icon-next="fast_forward"
            class="float-right paginator-section"
            @update:model-value="getPageData('pageChange')"
            rowsPerPageLabel="Rows per page"
            :rows-per-page-options="rowsPerPageOptions"
            :rows-per-page="searchObj.meta.resultGrid.rowsPerPage"
            data-test="logs-search-result-pagination"
          />
          <q-select
            v-if="
              searchObj.meta.resultGrid.showPagination &&
              searchObj.meta.logsVisualizeToggle === 'logs'
            "
            data-test="logs-search-result-records-per-page"
            v-model="searchObj.meta.resultGrid.rowsPerPage"
            :options="rowsPerPageOptions"
            class="float-right select-pagination"
            size="sm"
            dense
            borderless
            @update:model-value="getPageData('recordsPerPage')"
          ></q-select>
        </div>
      </div>
      <div
        :class="[
          'histogram-container',
          searchObj.meta.showHistogram
            ? 'histogram-container--visible'
            : 'histogram-container--hidden',
        ]"
        v-if="
          searchObj.data?.histogram?.errorMsg == '' &&
          searchObj.data.histogram.errorCode != -1
        "
      >
        <ChartRenderer
          v-if="
            searchObj.meta.showHistogram &&
            (searchObj.data?.queryResults?.aggs?.length > 0 ||
              (plotChart && Object.keys(plotChart)?.length > 0))
          "
          data-test="logs-search-result-bar-chart"
          :data="plotChart"
          class="histogram-chart"
          @updated:dataZoom="onChartUpdate"
        />

        <div
          class="histogram-empty"
          v-else-if="
            searchObj.meta.showHistogram &&
            !searchObj.loadingHistogram &&
            !searchObj.loading
          "
        >
          <h3 class="text-center">
            <span class="histogram-empty__message">
              <q-icon name="warning"
color="warning" size="xs"></q-icon> No data
              found for histogram.</span
            >
          </h3>
        </div>

        <div
          class="histogram-empty"
          v-else-if="
            searchObj.meta.showHistogram && Object.keys(plotChart)?.length === 0
          "
        >
          <h3 class="text-center">
            <span class="histogram-empty__message"
style="color: transparent"
              >.</span
            >
          </h3>
        </div>

        <div class="q-pb-sm histogram-loader" v-if="histogramLoader">
          <q-spinner-hourglass
            color="primary"
            size="25px"
            class="search-spinner"
          />
        </div>
      </div>
      <div
        :class="[
          'histogram-container',
          searchObj.meta.showHistogram
            ? 'histogram-container--visible'
            : 'histogram-container--hidden',
        ]"
        v-else-if="
          searchObj.data.histogram?.errorMsg != '' &&
          searchObj.meta.showHistogram &&
          searchObj.data.histogram.errorCode != -1
        "
      >
        <h6
          class="text-center histogram-error"
          v-if="
            searchObj.data.histogram.errorCode != 0 &&
            searchObj.data.histogram.errorCode != -1
          "
        >
          <q-icon name="warning"
color="warning" size="xs"></q-icon> Error while
          fetching histogram data.
          <q-btn
            @click="toggleErrorDetails"
            size="sm"
            data-test="logs-page-histogram-error-details-btn"
            class="o2-secondary-button"
            >{{ t("search.histogramErrorBtnLabel") }}</q-btn
          ><br />
          <span v-if="disableMoreErrorDetails">
            <SanitizedHtmlRenderer
              data-test="logs-search-histogram-error-message"
              :htmlContent="searchObj.data?.histogram?.errorMsg"
            />
          </span>
        </h6>
        <h6
          class="text-center"
          v-else-if="searchObj.data.histogram.errorCode != -1"
        >
          <SanitizedHtmlRenderer
            data-test="logs-search-histogram-error-message"
            :htmlContent="searchObj.data?.histogram?.errorMsg"
          />
        </h6>
      </div>

      <!-- Logs View -->
      <template v-if="searchObj.meta.logsVisualizeToggle === 'logs'">
        <tenstack-table
          ref="searchTableRef"
          :columns="getColumns || []"
          :rows="searchObj.data.queryResults?.hits || []"
          :wrap="searchObj.meta.toggleSourceWrap"
          :width="getTableWidth"
          :err-msg="searchObj.data.missingStreamMessage"
          :loading="searchObj.loading"
          :functionErrorMsg="searchObj?.data?.functionError"
          :expandedRows="expandedLogs"
          :highlight-timestamp="searchObj.data?.searchAround?.indexTimestamp"
          :selected-stream-fts-keys="selectedStreamFullTextSearchKeys"
          :highlight-query="
            searchObj.meta.sqlMode
              ? searchObj.data.query.toLowerCase().split('where')[1]
              : searchObj.data.query.toLowerCase()
          "
          :default-columns="!searchObj.data.stream.selectedFields.length"
          class="col-12 tw-mt-[0.375rem]"
          :class="[
            !searchObj.meta.showHistogram ||
            (searchObj.meta.showHistogram &&
              searchObj.data.histogram.errorCode == -1)
              ? 'table-container--without-histogram'
              : 'table-container--with-histogram',
          ]"
          @update:columnSizes="handleColumnSizesUpdate"
          @update:columnOrder="handleColumnOrderUpdate"
          @copy="copyLogToClipboard"
          @add-field-to-table="addFieldToTable"
          @add-search-term="addSearchTerm"
          @close-column="closeColumn"
          @click:data-row="openLogDetails"
          @expand-row="expandLog"
          @send-to-ai-chat="sendToAiChat"
          @view-trace="redirectToTraces"
        />
      </template>

      <!-- Patterns View -->
      <div
        v-if="searchObj.meta.logsVisualizeToggle === 'patterns'"
        style="display: flex; flex-direction: column"
        :class="[
          !searchObj.meta.showHistogram ||
          (searchObj.meta.showHistogram &&
            searchObj.data.histogram.errorCode == -1)
            ? 'table-container--without-histogram'
            : 'table-container--with-histogram',
        ]"
      >
        <!-- Statistics Bar -->
        <div
          v-if="patternsState?.patterns?.statistics"
          class="q-pa-md"
          :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-grey-2'"
          style="border-bottom: 1px solid; flex-shrink: 0"
          :style="{
            borderColor: store.state.theme === 'dark' ? '#3a3a3a' : '#e0e0e0',
          }"
        >
          <div class="row q-col-gutter-md">
            <div class="col-3">
              <q-card
                flat
                :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
              >
                <q-card-section class="q-pa-md">
                  <div
                    class="text-caption"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    Logs Analyzed
                  </div>
                  <div class="row items-center q-mt-xs q-gutter-xs">
                    <!-- View Mode -->
                    <div
                      v-if="!isEditingScanSize"
                      class="row items-center no-wrap tw-m-0 tw-pl-1"
                    >
                      <div
                        class="tw-text-[1.5rem] tw-leading-[2rem] text-weight-bold text-primary tw-h-fit tw-pr-1"
                      >
                        {{ patternsState.scanSize.toLocaleString() }}
                      </div>
                      <q-btn
                        flat
                        round
                        dense
                        size="xs"
                        icon="edit"
                        @click="toggleEditScanSize"
                        :class="
                          store.state.theme === 'dark'
                            ? 'text-grey-5'
                            : 'text-grey-7'
                        "
                      >
                        <q-tooltip>Edit scan size</q-tooltip>
                      </q-btn>
                    </div>

                    <!-- Edit Mode -->
                    <div
                      v-else
                      class="row items-center no-wrap logs-analyzed-input"
                      style="gap: 0.25rem"
                    >
                      <q-input
                        v-model.number="patternsState.scanSize"
                        type="number"
                        dense
                        outlined
                        :min="100"
                        :max="20000"
                        class="!tw-text-[1.2rem] text-weight-bold"
                        style="max-width: 120px"
                        autofocus
                        @keyup.escape="isEditingScanSize = false"
                        @blur="isEditingScanSize = false"
                      />
                    </div>
                  </div>
                </q-card-section>
              </q-card>
            </div>
            <div class="col-3">
              <q-card
                flat
                :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
              >
                <q-card-section class="q-pa-md">
                  <div
                    class="text-caption"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    Patterns Found
                  </div>
                  <div class="text-h5 text-weight-bold q-mt-xs text-primary">
                    {{
                      patternsState?.patterns?.statistics
                        ?.total_patterns_found || 0
                    }}
                  </div>
                </q-card-section>
              </q-card>
            </div>
            <div class="col-3">
              <q-card
                flat
                :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
              >
                <q-card-section class="q-pa-md">
                  <div
                    class="text-caption"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    Coverage
                  </div>
                  <div class="text-h5 text-weight-bold q-mt-xs text-primary">
                    {{
                      (
                        patternsState?.patterns?.statistics
                          ?.coverage_percentage || 0
                      ).toFixed(1)
                    }}%
                  </div>
                </q-card-section>
              </q-card>
            </div>
            <div class="col-3">
              <q-card
                flat
                :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
              >
                <q-card-section class="q-pa-md">
                  <div
                    class="text-caption"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    Processing Time
                  </div>
                  <div class="text-h5 text-weight-bold q-mt-xs text-primary">
                    {{
                      patternsState?.patterns?.statistics?.extraction_time_ms ||
                      0
                    }}ms
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </div>
        </div>

        <!-- Patterns List with Virtual Scroll for Performance -->
        <div
          v-if="patternsState?.patterns?.patterns?.length > 0"
          style="flex: 1; overflow: hidden"
        >
          <q-virtual-scroll
            :items="patternsState?.patterns?.patterns"
            virtual-scroll-slice-size="5"
            v-slot="{ item: pattern, index }"
            style="height: 100%"
            class="q-pa-md"
          >
            <q-card
              flat
              bordered
              :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
              class="q-mb-md cursor-pointer"
              @click="openPatternDetails(pattern, index)"
            >
              <!-- Header with Rank and Stats - Compact -->
              <q-card-section
                class="q-pa-md"
                :class="
                  store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-1'
                "
              >
                <div class="row items-center q-col-gutter-md no-wrap">
                  <div class="col-auto">
                    <q-avatar
                      size="2rem"
                      color="primary"
                      text-color="white"
                      class="text-weight-bold"
                    >
                      {{ index + 1 }}
                    </q-avatar>
                  </div>
                  <div class="col">
                    <!-- Template shown first with info icon -->
                    <div class="tw-flex tw-items-center q-mb-xs">
                      <div
                        class="text-body2 ellipsis"
                        :class="
                          store.state.theme === 'dark'
                            ? 'text-grey-4'
                            : 'text-grey-8'
                        "
                        style="
                          font-family:
                            &quot;Monaco&quot;, &quot;Menlo&quot;,
                            &quot;Courier New&quot;, monospace;
                          font-size: 0.8125rem;
                        "
                      >
                        {{ pattern.template }}
                      </div>
                      <q-icon
                        :name="outlinedInfo"
                        size="17px"
                        class="q-ml-xs cursor-pointer"
                        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                      >
                        <q-tooltip
                          anchor="center right"
                          self="center left"
                          max-width="300px"
                          style="font-size: 12px;"
                        >
                          <div class="text-weight-bold q-mb-xs">Template vs Description</div>
                          <div class="q-mb-xs"><strong>Template:</strong> {{ pattern.template }}</div>
                          <div><strong>Description:</strong> {{ pattern.description }}</div>
                        </q-tooltip>
                      </q-icon>
                    </div>
                    <!-- Occurrences and percentage on second line -->
                    <div
                      class="text-caption"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-grey-6'
                          : 'text-grey-6'
                      "
                    >
                      <span class="text-weight-bold text-primary">{{
                        pattern.frequency.toLocaleString()
                      }}</span>
                      occurrences
                      <span class="q-mx-xs">•</span>
                      <span class="text-weight-bold text-primary"
                        >{{ pattern.percentage.toFixed(2) }}%</span
                      >
                      <span
                        v-if="pattern.is_anomaly"
                        class="text-negative text-weight-bold q-ml-sm"
                        >⚠️ ANOMALY</span
                      >
                    </div>
                  </div>
                  <div class="col-auto row items-center q-gutter-xs">
                    <q-btn
                      size="0.375rem"
                      @click.stop="addPatternToSearch(pattern, 'include')"
                      title="Include pattern in search"
                      round
                      flat
                      dense
                    >
                      <q-icon color="currentColor">
                        <EqualIcon></EqualIcon>
                      </q-icon>
                    </q-btn>
                    <q-btn
                      size="0.375rem"
                      @click.stop="addPatternToSearch(pattern, 'exclude')"
                      title="Exclude pattern from search"
                      round
                      flat
                      dense
                    >
                      <q-icon color="currentColor">
                        <NotEqualIcon></NotEqualIcon>
                      </q-icon>
                    </q-btn>
                    <q-icon
                      name="info"
                      size="1.0625rem"
                      class="cursor-pointer"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-grey-5'
                          : 'text-grey-7'
                      "
                    >
                      <q-tooltip
                        >Show details ({{
                          pattern.examples?.[0]?.variables
                            ? Object.keys(pattern.examples[0].variables).length
                            : 0
                        }}
                        variables,
                        {{ pattern.examples?.length || 0 }} examples)</q-tooltip
                      >
                    </q-icon>
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </q-virtual-scroll>
        </div>

        <div
          v-else-if="searchObj.loading"
          style="
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          "
        >
          <q-spinner-hourglass color="primary" size="3.125rem" />
          <div
            class="q-mt-md text-body2"
            :class="
              store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
            "
          >
            Extracting patterns from logs...
          </div>
        </div>

        <div
          v-else
          style="
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1.25rem;
            text-align: center;
          "
        >
          <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3">
            📊
          </div>
          <div
            class="text-h6 q-mb-sm"
            :class="
              store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
            "
          >
            No patterns found
          </div>
          <div
            class="text-body2"
            :class="
              store.state.theme === 'dark' ? 'text-grey-6' : 'text-grey-8'
            "
            style="max-width: 31.25rem"
          >
            <div
              v-if="patternsState?.patterns?.statistics?.total_logs_analyzed"
            >
              Only
              {{ patternsState?.patterns?.statistics?.total_logs_analyzed }}
              logs were analyzed.
            </div>
            <div class="q-mt-sm">
              Try increasing the time range or selecting a different stream with
              more log data.
              <br />Pattern extraction works best with at least 1000+ logs.
            </div>
          </div>
        </div>
      </div>

      <q-dialog
        data-test="logs-search-result-detail-dialog"
        v-model="searchObj.meta.showDetailTab"
        position="right"
        full-height
        maximized
        @escap.stop="reDrawChart"
        @hide="reDrawChart"
        @before-hide="reDrawChart"
      >
        <DetailTable
          v-if="searchObj.data.queryResults?.hits?.length"
          :key="
            'dialog_' + searchObj.meta.resultGrid.navigation.currentRowIndex
          "
          v-model="
            searchObj.data.queryResults.hits[
              searchObj.meta.resultGrid.navigation.currentRowIndex
            ]
          "
          :stream-type="searchObj.data.stream.streamType"
          class="detail-table-dialog"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex"
          :totalLength="parseInt(searchObj.data.queryResults.hits.length)"
          :highlight-query="
            searchObj.meta.sqlMode
              ? searchObj.data.query.toLowerCase().split('where')[1]
              : searchObj.data.query.toLowerCase()
          "
          @showNextDetail="navigateRowDetail"
          @showPrevDetail="navigateRowDetail"
          @add:searchterm="addSearchTerm"
          @remove:searchterm="removeSearchTerm"
          @search:timeboxed="onTimeBoxed"
          @add:table="addFieldToTable"
          @view-trace="
            redirectToTraces(
              searchObj.data.queryResults.hits[
                searchObj.meta.resultGrid.navigation.currentRowIndex
              ],
            )
          "
          @sendToAiChat="sendToAiChat"
          @closeTable="closeTable"
        />
      </q-dialog>

      <!-- Pattern Details Drawer -->
      <q-dialog
        data-test="pattern-detail-dialog"
        v-model="showPatternDetails"
        position="right"
        full-height
        maximized
      >
        <q-card
          v-if="selectedPattern"
          class="detail-table-dialog"
          :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
          style="width: 70vw; max-width: 70vw"
        >
          <!-- Header -->
          <q-card-section
            class="q-pa-md"
            :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-1'"
          >
            <div class="row items-center">
              <div class="col">
                <div class="text-h6">Pattern Details</div>
                <div
                  class="text-caption"
                  :class="
                    store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                  "
                >
                  Pattern {{ (selectedPattern as any).index + 1 }} of
                  {{ patternsState?.patterns?.patterns?.length || 0 }}
                </div>
              </div>
              <div class="col-auto">
                <q-btn
                  outline
                  no-caps
                  padding="xs md"
                  icon="chevron_left"
                  label="Previous"
                  @click="navigatePatternDetail(false, true)"
                  :disable="(selectedPattern as any).index === 0"
                  :class="
                    store.state.theme === 'dark'
                      ? 'text-grey-5 border-grey-5'
                      : 'text-grey-7 border-grey-7'
                  "
                  class="q-mr-sm"
                />
                <q-btn
                  outline
                  no-caps
                  padding="xs md"
                  icon-right="chevron_right"
                  label="Next"
                  @click="navigatePatternDetail(true, false)"
                  :disable="
                    (selectedPattern as any).index >=
                    (patternsState?.patterns?.patterns?.length || 0) - 1
                  "
                  :class="
                    store.state.theme === 'dark'
                      ? 'text-grey-5 border-grey-5'
                      : 'text-grey-7 border-grey-7'
                  "
                  class="q-mr-sm"
                />
                <q-btn
                  flat
                  round
                  dense
                  icon="close"
                  @click="showPatternDetails = false"
                  :class="
                    store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                  "
                />
              </div>
            </div>
          </q-card-section>

          <q-separator />

          <!-- Content -->
          <q-card-section
            class="q-pa-md"
            style="height: calc(100vh - 100px); overflow-y: auto"
          >
            <!-- Statistics -->
            <div class="q-mb-lg">
              <div class="text-subtitle2 text-weight-medium q-mb-md">
                Statistics
              </div>
              <div class="row q-col-gutter-md">
                <div class="col-6">
                  <q-card
                    flat
                    bordered
                    :class="
                      store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'
                    "
                  >
                    <q-card-section class="q-pa-md">
                      <div
                        class="text-caption"
                        :class="
                          store.state.theme === 'dark'
                            ? 'text-grey-5'
                            : 'text-grey-7'
                        "
                      >
                        Occurrences
                      </div>
                      <div
                        class="text-h5 text-weight-bold text-primary q-mt-xs"
                      >
                        {{
                          (
                            selectedPattern as any
                          ).pattern.frequency.toLocaleString()
                        }}
                      </div>
                    </q-card-section>
                  </q-card>
                </div>
                <div class="col-6">
                  <q-card
                    flat
                    bordered
                    :class="
                      store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'
                    "
                  >
                    <q-card-section class="q-pa-md">
                      <div
                        class="text-caption"
                        :class="
                          store.state.theme === 'dark'
                            ? 'text-grey-5'
                            : 'text-grey-7'
                        "
                      >
                        Percentage
                      </div>
                      <div
                        class="text-h5 text-weight-bold text-primary q-mt-xs"
                      >
                        {{
                          (selectedPattern as any).pattern.percentage.toFixed(
                            2,
                          )
                        }}%
                      </div>
                    </q-card-section>
                  </q-card>
                </div>
              </div>
              <div
                v-if="(selectedPattern as any).pattern.is_anomaly"
                class="q-mt-md"
              >
                <q-banner class="bg-negative text-white">
                  <template v-slot:avatar>
                    <q-icon name="warning" size="md" />
                  </template>
                  This pattern is detected as an anomaly
                </q-banner>
              </div>
            </div>

            <!-- Template -->
            <div class="q-mb-lg">
              <div class="text-subtitle2 text-weight-medium q-mb-md">
                Pattern Template
              </div>
              <div
                class="q-pa-md"
                :class="
                  store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'
                "
                style="
                  font-family:
                    &quot;Monaco&quot;, &quot;Menlo&quot;,
                    &quot;Courier New&quot;, monospace;
                  font-size: 0.8125rem;
                  line-height: 1.6;
                  border-radius: 0.25rem;
                  border-left: 0.25rem solid;
                  word-break: break-all;
                  white-space: pre-wrap;
                  border-color: var(--q-primary);
                "
              >
                {{ (selectedPattern as any).pattern.template }}
              </div>
            </div>

            <!-- Variables -->
            <div
              v-if="
                (selectedPattern as any).pattern.variables &&
                (selectedPattern as any).pattern.variables.length > 0
              "
              class="q-mb-lg"
            >
              <div class="text-subtitle2 text-weight-medium q-mb-md">
                Variables ({{
                  (selectedPattern as any).pattern.variables.length
                }})
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 0.5rem">
                <q-chip
                  v-for="variable in (selectedPattern as any).pattern.variables"
                  :key="variable.index"
                  :class="
                    store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-3'
                  "
                >
                  <span class="text-weight-bold text-primary">{{
                    variable.name || "var_" + variable.index
                  }}</span>
                  <span
                    class="q-mx-xs"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                    >•</span
                  >
                  <span
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-4'
                        : 'text-grey-7'
                    "
                    >{{ variable.var_type || "unknown" }}</span
                  >
                </q-chip>
              </div>
            </div>

            <!-- Example Logs -->
            <div
              v-if="
                (selectedPattern as any).pattern.examples &&
                (selectedPattern as any).pattern.examples.length > 0
              "
              class="q-mb-lg"
            >
              <div class="text-subtitle2 text-weight-medium q-mb-md">
                Example Logs ({{
                  (selectedPattern as any).pattern.examples.length
                }})
              </div>
              <div
                v-for="(example, exIdx) in (selectedPattern as any).pattern
                  .examples"
                :key="exIdx"
                class="q-pa-md q-mb-md"
                :class="
                  store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-1'
                "
                style="
                  font-family:
                    &quot;Monaco&quot;, &quot;Menlo&quot;,
                    &quot;Courier New&quot;, monospace;
                  font-size: 0.75rem;
                  line-height: 1.6;
                  border-radius: 0.25rem;
                  word-break: break-all;
                  white-space: pre-wrap;
                  border-left: 0.1875rem solid;
                "
                :style="{
                  borderColor:
                    store.state.theme === 'dark' ? '#3a3a3a' : '#e0e0e0',
                }"
              >
                {{ example.log_message }}
              </div>
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  onMounted,
  onUpdated,
  defineAsyncComponent,
  watch,
  nextTick,
} from "vue";
import { copyToClipboard, useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";

import HighLight from "../../components/HighLight.vue";
import { byString } from "../../utils/json";
import { getImageURL, useLocalWrapContent } from "../../utils/zincutils";
import useLogs from "../../composables/useLogs";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import usePatterns from "@/composables/useLogs/usePatterns";
import { convertLogData } from "@/utils/logs/convertLogData";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import { useRouter } from "vue-router";
import TenstackTable from "./TenstackTable.vue";
import { useSearchAround } from "@/composables/useLogs/searchAround";
import { usePagination } from "@/composables/useLogs/usePagination";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import { searchState } from "@/composables/useLogs/searchState";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";

export default defineComponent({
  name: "SearchResult",
  components: {
    DetailTable: defineAsyncComponent(() => import("./DetailTable.vue")),
    ChartRenderer: defineAsyncComponent(
      () => import("@/components/dashboards/panels/ChartRenderer.vue"),
    ),
    SanitizedHtmlRenderer,
    TenstackTable: defineAsyncComponent(() => import("./TenstackTable.vue")),
    EqualIcon,
    NotEqualIcon,
  },
  emits: [
    "update:scroll",
    "update:datetime",
    "remove:searchTerm",
    "search:timeboxed",
    "expandlog",
    "update:recordsPerPage",
    "update:columnSizes",
    "sendToAiChat",
  ],
  props: {
    expandedLogs: {
      type: Array,
      default: () => [],
    },
  },
  methods: {
    handleColumnSizesUpdate(newColSizes: any) {
      const prevColSizes =
        this.searchObj.data.resultGrid?.colSizes[
          this.searchObj.data.stream.selectedStream
        ]?.[0] || {};
      this.searchObj.data.resultGrid.colSizes[
        this.searchObj.data.stream.selectedStream
      ] = [
        {
          ...prevColSizes,
          ...newColSizes,
        },
      ];
    },
    handleColumnOrderUpdate(newColOrder: string[], columns: any[]) {
      // Here we are checking if the columns are default columns ( _timestamp and source)
      // If selected fields are empty, then we are setting colOrder to empty array as we
      // don't change the order of default columns
      // If you store the colOrder it will create issue when you save the view and load it again
      if (!this.searchObj.data.stream.selectedFields.length) {
        this.searchObj.data.resultGrid.colOrder[
          this.searchObj.data.stream.selectedStream
        ] = [];
      } else {
        this.searchObj.data.resultGrid.colOrder[
          this.searchObj.data.stream.selectedStream
        ] = [...newColOrder];

        if (newColOrder.length > 0) {
          this.searchObj.organizationIdentifier =
            this.store.state.selectedOrganization.identifier;
          let selectedFields = this.reorderSelectedFields();

          this.searchObj.data.stream.selectedFields = selectedFields.filter((_field) => _field !== (this.store?.state?.zoConfig?.timestamp_column || '_timestamp'));
          this.updatedLocalLogFilterField();
        }
      }
    },

    getPageData(actionType: string) {
      if (actionType == "prev") {
        if (this.searchObj.data.resultGrid.currentPage > 1) {
          this.searchObj.data.resultGrid.currentPage =
            this.searchObj.data.resultGrid.currentPage - 1;
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          this.$emit("update:scroll");
          this.scrollTableToTop(0);
        }
      } else if (actionType == "next") {
        if (
          this.searchObj.data.resultGrid.currentPage <=
          Math.round(
            this.searchObj.data.queryResults.total /
              this.searchObj.meta.resultGrid.rowsPerPage,
          )
        ) {
          this.searchObj.data.resultGrid.currentPage =
            this.searchObj.data.resultGrid.currentPage + 1;
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          this.$emit("update:scroll");
          this.scrollTableToTop(0);
        }
      } else if (actionType == "recordsPerPage") {
        this.searchObj.data.resultGrid.currentPage = 1;
        this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
        if (this.searchObj.communicationMethod === "streaming") {
          if (this.searchObj.meta.jobId == "") {
            this.refreshPagination();
          } else {
            this.refreshJobPagination();
          }
        } else {
          if (this.searchObj.meta.jobId !== "") {
            this.refreshJobPagination();
          } else {
            this.refreshPartitionPagination(true);
          }
        }
        this.$emit("update:recordsPerPage");
        this.scrollTableToTop(0);
      } else if (actionType == "pageChange") {
        //here at first the queryResults is undefined so we are checking if it is undefined then we are setting it to empty array
        if (
          this.searchObj.meta.jobId != "" &&
          this.searchObj.data.queryResults.paginations == undefined
        ) {
          this.searchObj.data.queryResults.pagination = [];
        }
        const maxPages =
          this.searchObj.communicationMethod === "streaming" ||
          this.searchObj.meta.jobId != ""
            ? this.searchObj.data.queryResults.pagination.length
            : this.searchObj.data.queryResults?.partitionDetail?.paginations
                .length;
        if (
          this.pageNumberInput > Math.ceil(maxPages) &&
          this.searchObj.meta.jobId == ""
        ) {
          this.$q.notify({
            type: "negative",
            message:
              "Page number is out of range. Please provide valid page number.",
            timeout: 1000,
          });
          this.pageNumberInput = this.searchObj.data.resultGrid.currentPage;
          return false;
        }

        this.searchObj.data.resultGrid.currentPage = this.pageNumberInput;
        this.$emit("update:scroll");
        this.scrollTableToTop(0);
      }
    },
    closeColumn(col: any) {
      let selectedFields = this.reorderSelectedFields();

      const RGIndex = this.searchObj.data.resultGrid.columns.indexOf(col.id);
      this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = selectedFields.indexOf(col.name);

      selectedFields.splice(SFIndex, 1);

      this.searchObj.data.stream.selectedFields = selectedFields.filter((_field) => _field !== (this.store?.state?.zoConfig?.timestamp_column || '_timestamp'));

      this.searchObj.organizationIdentifier =
        this.store.state.selectedOrganization.identifier;
      this.updatedLocalLogFilterField();
    },
    onChartUpdate({ start, end }: { start: any; end: any }) {
      this.searchObj.meta.showDetailTab = false;
      this.$emit("update:datetime", { start, end });
    },
    onTimeBoxed(obj: any) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.data.searchAround.indexTimestamp = obj.key;
      // this.$emit("search:timeboxed", obj);
      this.searchAroundData(obj);
    },
    toggleErrorDetails() {
      this.disableMoreErrorDetails = !this.disableMoreErrorDetails;
    },
  },
  setup(props, { emit }) {
    // Accessing nested JavaScript objects and arrays by string path
    // https://stackoverflow.com/questions/6491463/accessing-nested-javascript-objects-and-arrays-by-string-path
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const searchListContainer = ref(null);
    const noOfRecordsTitle = ref("");
    const scrollPosition = ref(0);
    const rowsPerPageOptions = [10, 25, 50, 100];
    const disableMoreErrorDetails = ref(false);
    const router = useRouter();
    const { searchAroundData } = useSearchAround();
    const { refreshPagination } = useSearchStream();
    const { refreshPartitionPagination, refreshJobPagination } =
      usePagination();
    const { updatedLocalLogFilterField } = logsUtils();
    const { extractFTSFields, filterHitsColumns } = useStreamFields();

    const { reorderSelectedFields, getFilterExpressionByFieldType } = useLogs();

    const { searchObj } = searchState();

    // Use separate patterns state (completely isolated from logs)
    const { patternsState } = usePatterns();

    const pageNumberInput = ref(1);
    const totalHeight = ref(0);
    const selectedPattern = ref(null);
    const showPatternDetails = ref(false);
    const isEditingScanSize = ref(false);

    const searchTableRef: any = ref(null);

    const patternsColumns = [
      {
        accessorKey: "pattern_id",
        header: "#",
        id: "index",
        size: 60,
        cell: (info: any) => info.row.index + 1,
        meta: {
          closable: false,
          showWrap: false,
        },
      },
      {
        accessorKey: "template",
        header: "Pattern Template",
        id: "template",
        cell: (info: any) => info.getValue(),
        size: 500,
        meta: {
          closable: false,
          showWrap: true,
        },
      },
      {
        accessorKey: "frequency",
        header: "Count",
        id: "frequency",
        size: 100,
        cell: (info: any) =>
          `${info.getValue()} (${info.row.original.percentage.toFixed(1)}%)`,
        meta: {
          closable: false,
          showWrap: false,
        },
      },
      {
        accessorKey: "examples",
        header: "Example Log",
        id: "example",
        size: 400,
        cell: (info: any) => {
          const examples = info.getValue();
          if (examples && examples.length > 0) {
            const msg = examples[0].log_message;
            return msg.length > 200 ? msg.substring(0, 200) + "..." : msg;
          }
          return "";
        },
        meta: {
          closable: false,
          showWrap: false,
        },
      },
    ];

    const plotChart: any = ref({});

    onMounted(() => {
      reDrawChart();
    });

    onUpdated(() => {
      pageNumberInput.value = searchObj.data.resultGrid.currentPage;
    });

    // Patterns are kept in memory when switching views and only cleared on explicit search
    // This allows users to toggle between logs/patterns/visualize without losing pattern data

    const columnSizes = ref({});

    const reDrawChart = () => {
      if (
        // eslint-disable-next-line no-prototype-builtins
        searchObj.data.histogram.hasOwnProperty("xData") &&
        searchObj.data.histogram.xData.length > 0
        // && plotChart.value?.reDraw
      ) {
        //format data in form of echarts options
        plotChart.value = convertLogData(
          searchObj.data.histogram.xData,
          searchObj.data.histogram.yData,
          searchObj.data.histogram.chartParams,
        );
        // plotChart.value.forceReLayout();
      }
    };

    const changeMaxRecordToReturn = (val: any) => {
      // searchObj.meta.resultGrid.pagination.rowsPerPage = val;
    };

    const openLogDetails = (props: any, index: number) => {
      searchObj.meta.showDetailTab = true;
      searchObj.meta.resultGrid.navigation.currentRowIndex = index;
    };

    const openPatternDetails = (pattern: any, index: number) => {
      selectedPattern.value = { pattern, index };
      showPatternDetails.value = true;
    };

    const navigatePatternDetail = (next: boolean, prev: boolean) => {
      if (!selectedPattern.value) return;

      const currentIndex = (selectedPattern.value as any).index;
      const totalPatterns = patternsState.value.patterns?.patterns?.length || 0;

      let newIndex = currentIndex;
      if (next && currentIndex < totalPatterns - 1) {
        newIndex = currentIndex + 1;
      } else if (prev && currentIndex > 0) {
        newIndex = currentIndex - 1;
      }

      if (newIndex !== currentIndex && patternsState.value.patterns?.patterns) {
        const newPattern = patternsState.value.patterns.patterns[newIndex];
        selectedPattern.value = { pattern: newPattern, index: newIndex };
      }
    };

    // const sanitizeForMatchAll = (text: string): string => {
    //   // Remove special characters that Tantivy's match_all doesn't handle well
    //   // Keep only alphanumeric characters and spaces
    //   // Replace multiple spaces with single space
    //   return text
    //     .replace(/[^\w\s]/g, ' ') // Replace special chars with space
    //     .replace(/\s+/g, ' ')      // Replace multiple spaces with single space
    //     .trim();
    // };

    const extractConstantsFromPattern = (template: string): string[] => {
      // Extract longest non-variable strings from pattern template
      // Pattern template has format like: "INFO action <*> at 14:47.1755283"
      // We want continuous strings between <*> that are longer than 10 chars
      const constants: string[] = [];
      const parts = template.split("<*>");

      for (const part of parts) {
        const trimmed = part.trim();
        // For now, use the string as-is without sanitization
        // const sanitized = sanitizeForMatchAll(trimmed);
        // Only include strings longer than 10 characters
        if (trimmed.length > 10) {
          constants.push(trimmed);
        }
      }

      return constants;
    };

    const addPatternToSearch = (
      pattern: any,
      action: "include" | "exclude",
    ) => {
      // Extract constants from pattern template
      const constants = extractConstantsFromPattern(pattern.template);

      if (constants.length === 0) {
        $q.notify({
          type: "warning",
          message: "No strings longer than 10 characters found in pattern",
          timeout: 2000,
        });
        return;
      }

      // Build multiple match_all() clauses, one for each constant
      // Each match_all takes a single string
      const matchAllClauses = constants.map((constant) => {
        // Escape backslashes first, then single quotes in the constant
        const escapedConstant = constant
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'");
        return `match_all('${escapedConstant}')`;
      });

      // Combine with AND
      let filterExpression = matchAllClauses.join(" AND ");

      // For exclude action, wrap the entire expression in NOT (...)
      if (action === "exclude") {
        if (matchAllClauses.length > 1) {
          filterExpression = `NOT (${filterExpression})`;
        } else {
          filterExpression = `NOT ${filterExpression}`;
        }
      }

      // Set the filter to be added to the query
      searchObj.data.stream.addToFilter = filterExpression;

      $q.notify({
        type: "positive",
        message: `Pattern ${action === "include" ? "included in" : "excluded from"} search (${constants.length} match_all clause${constants.length > 1 ? "s" : ""})`,
        timeout: 2000,
      });
    };

    const getRowIndex = (next: boolean, prev: boolean, oldIndex: number) => {
      if (next) {
        return oldIndex + 1;
      } else {
        return oldIndex - 1;
      }
    };

    const navigateRowDetail = (isNext: boolean, isPrev: boolean) => {
      const newIndex = getRowIndex(
        isNext,
        isPrev,
        Number(searchObj.meta.resultGrid.navigation.currentRowIndex),
      );
      searchObj.meta.resultGrid.navigation.currentRowIndex = newIndex;
    };

    const addSearchTerm = (
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) => {
      const searchExpression = getFilterExpressionByFieldType(
        field,
        field_value,
        action,
      );
      searchObj.data.stream.addToFilter = searchExpression;
    };

    const removeSearchTerm = (term: string) => {
      emit("remove:searchTerm", term);
    };

    const expandLog = async (index: number) => {
      emit("expandlog", index);
    };

    const getWidth = computed(() => {
      return "";
    });

    function addFieldToTable(fieldName: string) {
      if (searchObj.data.stream.selectedFields.includes(fieldName)) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter(
            (v: any) => v !== fieldName,
          );
      } else if(fieldName !== (store?.state?.zoConfig?.timestamp_column || '_timestamp')) {
        searchObj.data.stream.selectedFields.push(fieldName);
      }
      searchObj.organizationIdentifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    const copyLogToClipboard = (log: any, copyAsJson: boolean = true) => {
      const copyData = copyAsJson ? JSON.stringify(log) : log;
      copyToClipboard(copyData).then(() =>
        $q.notify({
          type: "positive",
          message: "Content Copied Successfully!",
          timeout: 1000,
        }),
      );
    };

    const redirectToTraces = (log: any) => {
      // 15 mins +- from the log timestamp
      const from = log[store.state.zoConfig.timestamp_column] - 900000000;
      const to = log[store.state.zoConfig.timestamp_column] + 900000000;
      const refresh = 0;

      const query: any = {
        name: "traceDetails",
        query: {
          stream: searchObj.meta.selectedTraceStream,
          from,
          to,
          refresh,
          org_identifier: store.state.selectedOrganization.identifier,
          trace_id:
            log[
              store.state.organizationData.organizationSettings
                .trace_id_field_name
            ],
          reload: "true",
        },
      };

      query["span_id"] =
        log[
          store.state.organizationData.organizationSettings.span_id_field_name
        ];

      router.push(query);
    };

    const getTableWidth = computed(() => {
      const leftSidebarMenu = 56;
      const fieldList =
        (window.innerWidth - leftSidebarMenu) *
        (searchObj.config.splitterModel / 100);
      return window.innerWidth - (leftSidebarMenu + fieldList) - 5;
    });

    const scrollTableToTop = (value: number) => {
      searchTableRef.value?.parentRef?.scrollTo({ top: value });
    };

    const getColumns = computed(() => {
      return searchObj.data?.resultGrid?.columns?.filter(
        (col: any) => !!col.id,
      );
    });

    const getPartitionPaginations = computed(() => {
      return searchObj.data.queryResults?.partitionDetail?.paginations || [];
    });

    const getSocketPaginations = computed(() => {
      return searchObj.data.queryResults.pagination || [];
    });

    const getPaginations = computed(() => {
      try {
        if (searchObj.communicationMethod === "http") {
          return getPartitionPaginations.value || [];
        } else {
          return getSocketPaginations.value || [];
        }
      } catch (e) {
        return [];
      }
    });
    //this is used to show the histogram loader when the histogram is loading
    const histogramLoader = computed(() => {
      return searchObj.meta.showHistogram && searchObj.loadingHistogram == true;
    });

    const sendToAiChat = (value: any) => {
      emit("sendToAiChat", value);
    };

    const closeTable = () => {
      searchObj.meta.showDetailTab = false;
    };

    const resetPlotChart = computed(() => {
      return searchObj.meta.resetPlotChart;
    });

    watch(resetPlotChart, (newVal) => {
      if (newVal) {
        plotChart.value = {};
        searchObj.meta.resetPlotChart = false;
      }
    });

    // Debug watcher for patterns state
    watch(
      () => patternsState.value.patterns,
      (newPatterns) => {
        // console.log("[SearchResult] Patterns state changed:", {
        //   hasPatterns: !!newPatterns,
        //   patternCount: newPatterns?.patterns?.length || 0,
        //   statistics: newPatterns?.statistics,
        // });
      },
      { deep: true },
    );

    const selectedStreamFullTextSearchKeys = computed(() => {
      const defaultFTSKeys = store?.state?.zoConfig?.default_fts_keys || [];
      const selectedStreamFTSKeys = searchObj.data.stream.selectedStreamFields
        .filter((field: string) => field.ftsKey)
        .map((field: any) => field.name);
      //merge default FTS keys with selected stream FTS keys
      return [...new Set([...defaultFTSKeys, ...selectedStreamFTSKeys])];
    });

    const toggleEditScanSize = () => {
      isEditingScanSize.value = !isEditingScanSize.value;
    };

    return {
      t,
      store,
      plotChart,
      searchObj,
      patternsState,
      updatedLocalLogFilterField,
      byString,
      searchTableRef,
      searchAroundData,
      addSearchTerm,
      removeSearchTerm,
      openLogDetails,
      changeMaxRecordToReturn,
      navigateRowDetail,
      totalHeight,
      reDrawChart,
      expandLog,
      getImageURL,
      addFieldToTable,
      searchListContainer,
      getWidth,
      copyLogToClipboard,
      extractFTSFields,
      useLocalWrapContent,
      noOfRecordsTitle,
      scrollPosition,
      rowsPerPageOptions,
      pageNumberInput,
      refreshPartitionPagination,
      disableMoreErrorDetails,
      redirectToTraces,
      getTableWidth,
      scrollTableToTop,
      getColumns,
      reorderSelectedFields,
      getPaginations,
      refreshPagination,
      refreshJobPagination,
      histogramLoader,
      sendToAiChat,
      closeTable,
      getRowIndex,
      getPartitionPaginations,
      getSocketPaginations,
      resetPlotChart,
      columnSizes,
      selectedStreamFullTextSearchKeys,
      patternsColumns,
      selectedPattern,
      showPatternDetails,
      openPatternDetails,
      navigatePatternDetail,
      addPatternToSearch,
      extractConstantsFromPattern,
      isEditingScanSize,
      toggleEditScanSize,
      outlinedInfo,
    };
  },
  computed: {
    toggleWrapFlag() {
      return this.searchObj.meta.toggleSourceWrap;
    },
    findFTSFields() {
      return this.searchObj.data.stream.selectedStreamFields;
    },
    updateTitle() {
      return this.searchObj.data.histogram.chartParams.title;
    },
    reDrawChartData() {
      return this.searchObj.data.histogram;
    },
  },
  watch: {
    toggleWrapFlag() {
      this.useLocalWrapContent(this.searchObj.meta.toggleSourceWrap);
    },
    findFTSFields() {
      this.extractFTSFields();
    },
    updateTitle() {
      this.noOfRecordsTitle = this.searchObj.data.histogram.chartParams.title;
    },
    reDrawChartData: {
      deep: true,
      handler: function () {
        this.reDrawChart();
      },
    },
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/logs/search-result.scss";
</style>
