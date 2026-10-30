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
  <!-- AddAlert OWNS the ONE form (Rule ③ owner pattern): `form` is created in
       setup() via useAlertForm's useOForm and handed to <OForm :form> so the
       topbar OForm* fields and the already-migrated descendant steps
       (QueryConfig / AlertSettings) bind by nested `name=` into it. -->
  <OForm :form="form" v-slot="{ isSubmitting }" class="h-full w-full">
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- V3 "Single Pane of Glass" Layout (All alert types)                -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <OPageLayout bleed>
      <template #header>
        <OPageHeader
          class="alert-v3-topbar border-border-default [container-type:inline-size] shrink-0 border-b [container-name:topbar]"
          :back="{
            label: activeFolderName || t('alerts.header'),
            onClick: goBackToAlertsList,
            dataTest: 'add-alert-back-btn',
          }"
          title-overflow="visible"
          :overflow-first="isEditingAlert"
        >
          <!-- The name IS the title in both modes, so creating no longer means
             filling a boxed field wedged into the toolbar: it renders as heading
             text and swaps to an input on click. Create mode also gets a
             generated name that tracks the stream + condition until the user
             types (see alertAutoName / useAutoName). EDIT mode is readonly —
             OInlineEdit then renders the saved name as plain heading text with
             no affordance, which is exactly what this header showed before.
             Anomaly and alert names bind the SAME `name` field — see the note on
             the folder select below for why the anomaly path never binds
             anomalyConfig.name directly. -->
          <template #title>
            <OFormInlineEdit
              ref="step1Ref"
              name="name"
              :readonly="beingUpdated || anomalyEditMode"
              :data-test="isAnomalyMode ? 'add-anomaly-name-input' : 'add-alert-name-input'"
              :placeholder="
                isAnomalyMode
                  ? t('alerts.anomalyNamePlaceholder')
                  : t('alerts.alertNamePlaceholder')
              "
              :aria-label="
                isAnomalyMode ? t('alerts.anomalyName') : t('alerts.incidents.alertName')
              "
              :edit-hint="
                alertAutoName.isAuto.value
                  ? t('common.inlineEdit.autoHint')
                  : t('alerts.renameHint')
              "
              @update:model-value="alertAutoName.markManual"
              @commit="alertAutoName.onCommit"
              @cancel="alertAutoName.onCommit"
            />
          </template>

          <!-- EDIT MODE (anomaly): status + last-run + retry trail the name -->
          <template #title-trail>
            <AlertEditStatus
              v-if="isEditingAlert"
              :header="editHeader"
              :alert-id="editAlertId"
              :folder-id="editFolderId"
              :org-id="store.state.selectedOrganization.identifier"
            />
            <div
              v-else-if="(beingUpdated || anomalyEditMode) && isAnomalyMode"
              class="flex items-center gap-1.5"
            >
              <OTooltip
                :content="raw(anomalyConfig.last_error)"
                :disabled="anomalyConfig.status !== 'failed' || !anomalyConfig.last_error"
              >
                <OTag
                  v-if="anomalyConfig.status"
                  type="anomalyStatus"
                  :value="anomalyConfig.status"
                />
              </OTooltip>
              <!-- §4.8 health badge: its own element keyed off notice_class, never folded into the status tag. -->
              <OTooltip v-if="anomalyNoticeBadge" :content="anomalyNoticeTooltip">
                <OTag
                  variant="warning-quiet"
                  :label="anomalyNoticeBadge.label"
                  data-test="anomaly-notice-badge"
                />
              </OTooltip>
              <span
                v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
                class="text-2xs text-text-secondary whitespace-nowrap"
              >
                {{
                  t("alerts.lastRun", { time: anomalyFormatTs(anomalyConfig.last_detection_run) })
                }}
              </span>
              <OTooltip
                v-if="anomalyConfig.status === 'failed'"
                :content="t('alerts.retryTraining')"
              >
                <OButton
                  variant="ghost-destructive"
                  size="xs"
                  :loading="anomalyRetraining"
                  @click="anomalyTriggerRetrain"
                  icon-left="replay"
                >
                  {{ t("alerts.retry") }}
                </OButton>
              </OTooltip>
            </div>
          </template>

          <!-- The description line states what this page is AND where the alert
             will land: "Add Alert in <folder>", the folder being a text-styled
             dropdown. Parked on the right of the header it was invisible; read
             as part of the sentence directly under the name it is exactly where
             someone looks to answer "where is this being saved?". Edit mode
             prints the folder as plain text — an alert does not move folders
             from here.
             (The anomaly name binds the SAME `name` field as the alert name,
             not `anomalyConfig.name`: a bare input has no field for the schema
             to paint, so a blank name could only ever toast. The
             formData.name → anomalyConfig.name watcher in useAlertForm still
             feeds the value saveAnomalyDetection reads, and anomaly edit-load
             seeds it via setF("name", data.name).) -->
          <template #subtitle>
            <span class="flex min-w-0 items-center gap-1 leading-normal">
              <span class="whitespace-nowrap">
                {{ t("alerts.modeInFolder", { mode: headerModeLabel }) }}
              </span>
              <InlineSelectFolderDropdown
                v-if="!(beingUpdated || anomalyEditMode)"
                variant="inline"
                :model-value="activeFolderId as string"
                type="alerts"
                @update:model-value="updateActiveFolderId({ value: $event })"
              />
              <OTruncatedText v-else class="text-text-body font-medium">
                {{ activeFolderName }}
              </OTruncatedText>
            </span>
          </template>

          <template v-if="isEditingAlert && lgUp" #actions-overflow>
            <AlertEditActions
              part="fire"
              :header="editHeader"
              :name="formData.name"
              :folder-id="editFolderId"
            />
          </template>
          <template v-if="isEditingAlert" #actions>
            <AlertEditActions
              part="more"
              :compact="!lgUp"
              :header="editHeader"
              :name="formData.name"
              :folder-id="editFolderId"
              @edit-json="openJsonEditor"
            >
              <template #menu-start>
                <AlertEditStatus
                  part="menu"
                  :header="editHeader"
                  :alert-id="editAlertId"
                  :folder-id="editFolderId"
                  :org-id="store.state.selectedOrganization.identifier"
                />
              </template>
            </AlertEditActions>
          </template>
        </OPageHeader>
      </template>

      <!-- What the source adapter had to change to turn the user's query into an
           alert — a stripped LIMIT, an absolute range become a rolling window.
           Shown here rather than only in the confirm dialog because most
           surfaces now skip that dialog and come straight to this form; without
           this the transforms would be silent. -->
      <div v-if="prefillWarnings.length" class="flex shrink-0 flex-col gap-2 px-3 pt-2">
        <OBanner
          v-for="(warning, index) in prefillWarnings"
          :key="`${warning.key}-${index}`"
          dense
          :variant="warning.level === 'info' ? 'info' : 'warning'"
          :content="t(`alerts.prefill.warnings.${warning.key}`, warning.params ?? {})"
          :data-test="`add-alert-prefill-warning-${warning.key}`"
        />
      </div>

      <div :key="draftFormKey" class="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
        <aside
          class="border-border-default max-lg:bg-surface-base flex w-53 shrink-0 flex-col gap-3 overflow-y-auto border-e px-2 py-3 max-lg:sticky max-lg:top-0 max-lg:z-1 max-lg:w-auto max-lg:gap-2 max-lg:border-e-0 max-lg:border-b max-lg:px-3 max-lg:py-2"
          data-test="add-alert-section-nav"
        >
          <OCommandSearch
            v-if="!isAnomalyMode"
            v-model="settingFind.query.value"
            :items="settingFind.items.value"
            :label="t('alerts.find.label')"
            :placeholder="t('alerts.find.placeholder')"
            :count-text="settingFind.countText.value"
            :empty-text="settingFind.emptyText.value"
            shortcut-id="sectionedFormFind"
            data-test="add-alert-find-setting"
            @select="settingFind.select"
          >
            <template #footer>{{ t("alerts.find.hint") }}</template>
          </OCommandSearch>
          <OSectionNav
            :items="sectionItems"
            :active="activeSection"
            :label="t('alerts.sections.navLabel')"
            @select="goToSection"
          />
        </aside>

        <OSnapScroll
          ref="snapScrollRef"
          v-model:active="activeSection"
          :snap="lgUp"
          class="min-w-0 flex-1 max-lg:flex-none"
          data-test="add-alert-sections"
        >
          <AlertFormSection
            id="watch"
            :index="1"
            :title="t('alerts.sections.watch.title')"
            :next-title="t('alerts.sections.condition.title')"
            @next="goToSection('condition')"
          >
            <div class="flex flex-col gap-2" data-snap-stop>
              <span class="text-text-heading text-sm font-medium">{{
                t("alerts.sections.howItChecks")
              }}</span>
              <OToggleGroup
                :model-value="formData.is_real_time"
                :disabled="beingUpdated || anomalyEditMode"
                class="min-w-0 self-start"
                mobile-dropdown
                data-test="add-alert-type-tabs"
                @update:model-value="onAlertTypeChange"
              >
                <OToggleGroupItem
                  v-for="option in alertTypeOptions"
                  :key="option.value"
                  :value="option.value"
                  size="sm"
                  :data-test="`add-alert-type-tab-${option.value}`"
                >
                  <template #icon-left>
                    <OIcon :name="option.icon" size="sm" />
                  </template>
                  {{ option.label }}
                </OToggleGroupItem>
              </OToggleGroup>
            </div>

            <div
              v-if="!isCompositeMode"
              class="stream-config-card [container-type:inline-size] flex items-center gap-4 [container-name:stream-config] max-md:flex-wrap max-md:gap-2"
              data-snap-stop
            >
              <!-- Stream Type -->
              <div class="flex items-center gap-1.5">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ t("alerts.streamType") }} <span class="text-text-body">*</span>
                </div>
                <!-- eslint-disable local/no-hardcoded-px -- query condition: a threshold for WHEN layout changes, not a rendered length -->
                <OFormSelect
                  ref="streamTypeRef"
                  name="stream_type"
                  :aria-label="t('alerts.streamType')"
                  data-test="add-alert-stream-type-select-dropdown"
                  :options="streamTypes"
                  :searchable="false"
                  class="stream-type-select w-37.5! @max-[900px]/stream-config:w-27.5! @max-[600px]/stream-config:w-17.5!"
                  :disabled="beingUpdated || anomalyEditMode"
                  @update:model-value="onStreamTypeChange"
                />
                <!-- eslint-enable local/no-hardcoded-px -->
              </div>

              <!-- Stream Name -->
              <div class="flex min-w-0 flex-1 items-center gap-1.5 max-md:basis-full">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ t("alerts.stream_name") }} <span class="text-text-body">*</span>
                </div>
                <OFormSelect
                  ref="streamNameRef"
                  name="stream_name"
                  :aria-label="t('alerts.stream_name')"
                  data-test="add-alert-stream-name-select-dropdown"
                  :options="indexOptions"
                  :loading="isFetchingStreams"
                  class="stream-name-select w-full! max-w-75 min-w-0"
                  :disabled="beingUpdated || anomalyEditMode || !formData.stream_type"
                  @update:model-value="updateStreamFields($event)"
                />
                <OTooltip
                  v-if="!formData.stream_type"
                  :content="t('alerts.selectStreamTypeFirst')"
                />
              </div>
            </div>

            <div data-snap-stop>
              <CompositeAlertForm
                v-if="isCompositeMode"
                :model-value="formData"
                :org-identifier="store.state.selectedOrganization.identifier"
                :folder-id="activeFolderId as string"
                :available-children="availableCompositeChildren"
                :section-targets="sectionTargets"
                @update:model-value="updateCompositeDraft"
                @validation="onCompositeValidation"
              />
              <QueryConfig
                v-else
                v-show="!isAnomalyMode"
                ref="step2Ref"
                :section-targets="sectionTargets"
                :tab="formData.query_condition.type || 'custom'"
                :multiTimeRange="formData.query_condition.multi_time_range"
                :columns="filteredColumns"
                :streamFieldsMap="streamFieldsMap"
                :generatedSqlQuery="generatedSqlQuery"
                :inputData="formData.query_condition"
                :streamType="formData.stream_type"
                :isRealTime="formData.is_real_time"
                :sqlQuery="formData.query_condition.sql"
                :promqlQuery="formData.query_condition.promql"
                :vrlFunction="decodedVrlFunction"
                :streamName="formData.stream_name"
                :sqlQueryErrorMsg="sqlQueryErrorMsg"
                :sqlAggColumnOptions="sqlAggColumnOptions"
                :sqlQueryHasHaving="sqlQueryHasHaving"
                :isAggregationEnabled="isAggregationEnabled"
                :beingUpdated="beingUpdated"
                :isSeeding="isLoadingPrefill"
                :promqlCondition="formData.query_condition.promql_condition"
                :triggerCondition="formData.trigger_condition"
                @update:tab="updateTab"
                @update-group="updateGroup"
                @remove-group="removeConditionGroup"
                @input:update="onInputUpdate"
                @update:sqlQuery="updateSqlQuery"
                @update:promqlQuery="updatePromqlQuery"
                @update:vrlFunction="updateVrlFunction"
                @validate-sql="validateSqlQuery"
                @clear-multi-windows="clearMultiWindows"
                @editor-closed="handleEditorClosed"
                @editor-state-changed="handleEditorStateChanged"
                @update:isAggregationEnabled="(value) => (isAggregationEnabled = value)"
                @update:aggregation="updateAggregation"
                @update:promqlCondition="updatePromqlCondition"
                @update:triggerCondition="updateTriggerCondition"
              />
              <AnomalyDetectionConfig
                v-show="isAnomalyMode"
                ref="anomalyStep2Ref"
                :config="anomalyConfig"
                :preview-sql="anomalyPreviewSql"
                :stored-intervals="anomalyStoredIntervals"
                :section-targets="sectionTargets"
              />
            </div>
          </AlertFormSection>

          <AlertFormSection
            id="condition"
            :index="2"
            :title="t('alerts.sections.condition.title')"
            :next-title="t('alerts.sections.notify.title')"
            @next="goToSection('notify')"
          >
            <p
              v-if="formData.is_real_time === 'true'"
              class="text-text-secondary m-0 text-sm"
              data-test="add-alert-realtime-condition-note"
            >
              {{ t("alerts.summary.plainEnglish.realTime") }}
            </p>
            <div
              v-show="!isAnomalyMode && !isCompositeMode"
              :ref="(el) => setSectionTarget('queryCondition', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="isCompositeMode"
              :ref="(el) => setSectionTarget('compositeCondition', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="isAnomalyMode"
              :ref="(el) => setSectionTarget('anomalyCondition', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="isAnomalyMode"
              :ref="(el) => setSectionTarget('anomalyTraining', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('settingsHold', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-if="formData.is_real_time === 'false' && tiers.isVisible('compareWithPast')"
              data-snap-stop
            >
              <CompareWithPast
                ref="step3Ref"
                :multiTimeRange="formData.query_condition.multi_time_range"
                :period="formData.trigger_condition.period"
                :frequency="formData.trigger_condition.frequency"
                :frequencyType="formData.trigger_condition.frequency_type"
                :cron="formData.trigger_condition.cron"
                :selectedTab="formData.query_condition.type || 'custom'"
                @update:multiTimeRange="updateMultiTimeRange"
              />
            </div>
            <AlertTierLinks
              v-if="!isAnomalyMode"
              section="condition"
              :view="tiers.view('condition')"
              @add="onTierAdd"
              @toggle="tiers.toggle('condition')"
            />
          </AlertFormSection>

          <AlertFormSection
            id="notify"
            :index="3"
            :title="t('alerts.sections.notify.title')"
            :next-title="t('alerts.sections.schedule.title')"
            @next="goToSection('schedule')"
          >
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('settingsNotify', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('settingsNotifyMore', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('advancedMessage', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('advancedOncall', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-if="formData.is_real_time === 'false' && tiers.isVisible('dedup')"
              data-snap-stop
            >
              <Deduplication
                :deduplication="formData.deduplication"
                :columns="filteredColumns"
                @update:deduplication="updateDeduplication"
              />
            </div>
            <div v-show="isAnomalyMode" data-snap-stop>
              <AnomalyAlerting
                :config="anomalyConfig"
                :destinations="destinations as (SelectOption & { name: string })[]"
                @refresh:destinations="$emit('refresh:destinations')"
              />
            </div>
            <AlertTierLinks
              v-if="!isAnomalyMode"
              section="notify"
              :view="tiers.view('notify')"
              @add="onTierAdd"
              @toggle="tiers.toggle('notify')"
            />
          </AlertFormSection>

          <AlertFormSection
            id="schedule"
            :index="4"
            :title="t('alerts.sections.schedule.title')"
            :next-title="t('alerts.sections.details.title')"
            @next="goToSection('details')"
          >
            <div
              v-show="!isAnomalyMode && !isCompositeMode"
              :ref="(el) => setSectionTarget('querySchedule', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="isAnomalyMode"
              :ref="(el) => setSectionTarget('anomalySchedule', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('settingsSchedule', el)"
              class="empty:hidden"
              data-snap-stop
            />
          </AlertFormSection>

          <AlertFormSection id="details" :index="5" :title="t('alerts.sections.details.title')">
            <div
              v-if="!(beingUpdated || anomalyEditMode)"
              class="flex min-w-0 items-center gap-2"
              data-snap-stop
            >
              <span class="text-text-secondary shrink-0 text-sm">{{
                t("alerts.sections.details.name")
              }}</span>
              <OTruncatedText
                class="text-text-heading min-w-0 text-sm font-medium"
                data-test="add-alert-details-name"
                >{{ formData.name || t("alerts.sections.details.unnamed") }}</OTruncatedText
              >
              <OButton
                variant="ghost-primary"
                size="sm"
                icon-left="edit"
                data-test="add-alert-details-rename-btn"
                @click="focusNameField"
                >{{ t("alerts.plain.rename") }}</OButton
              >
            </div>
            <div
              v-show="!isAnomalyMode"
              :ref="(el) => setSectionTarget('advancedDetails', el)"
              class="empty:hidden"
              data-snap-stop
            />
            <div v-show="!isAnomalyMode" data-snap-stop>
              <Advanced
                :section-targets="sectionTargets"
                :template="formData.template"
                :templates="templates"
                :contextAttributes="formData.context_attributes"
                :description="formData.description"
                :rowTemplate="formData.row_template"
                :rowTemplateType="formData.row_template_type"
                :destinations="destinations"
                :selectedDestinations="formData.destinations"
                :alertName="formData.name"
                :streamName="formData.stream_name"
                :streamType="formData.stream_type"
                :triggerCondition="formData.trigger_condition"
                :streamFields="filteredColumns"
                @update:template="updateTemplate"
                @refresh:templates="refreshTemplates"
                @update:contextAttributes="updateContextAttributes"
                @update:description="updateDescription"
                @update:rowTemplate="updateRowTemplate"
                @update:rowTemplateType="updateRowTemplateType"
              />
            </div>
            <!-- AlertSettings renders nothing inline in the sectioned editor: every slice lives in a section slot. -->
            <AlertSettings
              v-show="!isAnomalyMode"
              ref="step4Ref"
              :section-targets="sectionTargets"
              :formData="formData"
              :isRealTime="formData.is_real_time"
              :columns="filteredColumns"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :recoveryDestinations="formData.recovery_destinations"
              :formattedDestinations="getFormattedDestinations"
              :destinationObjects="destinations"
              :workflows="formData.workflows"
              @update:trigger="updateTriggerCondition"
              @update:aggregation="updateAggregation"
              @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
              @update:promqlCondition="updatePromqlCondition"
              @update:destinations="updateDestinations"
              @update:recoveryDestinations="updateRecoveryDestinations"
              @refresh:destinations="refreshDestinations"
              @update:workflows="updateWorkflows"
            />
            <AlertTierLinks
              v-if="!isAnomalyMode"
              section="details"
              :view="tiers.view('details')"
              @add="onTierAdd"
              @toggle="tiers.toggle('details')"
            />
            <div
              v-if="alertSentence"
              class="border-border-default rounded-surface flex flex-col gap-1 border p-3"
              data-test="add-alert-read-back"
              data-snap-stop
            >
              <span class="text-text-heading text-sm font-semibold">{{
                t("alerts.readBack.title")
              }}</span>
              <p class="text-text-body m-0 text-sm">{{ alertSentence }}</p>
            </div>
          </AlertFormSection>
        </OSnapScroll>

        <aside
          class="border-border-default flex w-83 shrink-0 flex-col gap-3 overflow-y-auto border-s p-3 max-lg:w-auto max-lg:border-s-0 max-lg:border-t"
          data-test="add-alert-rail"
        >
          <div
            v-if="!isCompositeMode"
            class="bg-surface-base border-border-default rounded-surface flex shrink-0 flex-col overflow-hidden border"
          >
            <div
              class="border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-2 select-none"
            >
              <span class="text-sm font-medium">{{ t("alerts.preview") }}</span>
            </div>
            <div class="h-60 min-h-0">
              <AnomalyDataPreview v-if="isAnomalyMode" :config="anomalyConfig" />
              <template v-else>
                <div
                  v-if="!formData.stream_name"
                  class="flex h-full flex-col items-center justify-center gap-2 px-3"
                >
                  <OIcon name="query-stats" size="lg" class="opacity-20" />
                  <span class="text-text-secondary text-center text-sm font-medium">
                    {{ t("alerts.previewEmptyState") }}
                  </span>
                </div>
                <PreviewAlert
                  v-else
                  ref="previewAlertRef"
                  class="h-full w-full"
                  :formData="formData"
                  :query="previewQuery"
                  :selectedTab="formData.query_condition.type || 'custom'"
                  :isAggregationEnabled="isAggregationEnabled"
                  :isUsingBackendSql="isUsingBackendSql"
                  :isEditorOpen="isEditorOpen"
                  :previewDateTime="previewDateTimeValue"
                  labelled-limit
                  @schema-updated="handleSqlSchemaUpdated"
                />
              </template>
            </div>
          </div>
          <div
            v-show="isCompositeMode"
            :ref="(el) => setSectionTarget('compositePreview', el)"
            class="empty:hidden"
          />
          <p
            v-if="railVerdict"
            class="m-0 flex items-start gap-2 text-sm"
            :class="railVerdict.tone === 'fires' ? 'text-text-heading' : 'text-text-body'"
            data-test="add-alert-rail-verdict"
          >
            <OIcon
              :name="RAIL_VERDICT_ICONS[railVerdict.tone].name"
              :class="RAIL_VERDICT_ICONS[railVerdict.tone].class"
              size="sm"
              class="mt-0.5 shrink-0"
            />
            <span>{{ railVerdict.text }}</span>
          </p>
          <p
            v-if="alertSentence"
            class="text-text-body m-0 text-sm"
            data-test="add-alert-rail-sentence"
          >
            {{ alertSentence }}
          </p>
          <AlertRecentRuns
            v-if="isEditingAlert && editAlertId"
            :alert-id="editAlertId"
            :folder-id="editFolderId"
          />
        </aside>
      </div>

      <div
        class="border-border-default flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2.5"
        data-test="add-alert-footer"
      >
        <AlertUnsavedChanges
          v-if="isEditingAlert"
          class="me-auto"
          :changes="unsavedChanges"
          :disabled="isSubmitting"
          @discard="discardChanges"
        />
        <OButton
          data-test="add-alert-cancel-btn"
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="cancelEditor"
          >{{ t("alerts.cancel") }}</OButton
        >
        <OButton
          data-test="add-alert-submit-btn"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting || (isAnomalyMode && anomalySaving)"
          :disabled="compositeSaveDisabled"
          @click="handleSave"
          >{{
            isAnomalyMode && !anomalyEditMode
              ? t("alerts.saveAndTrain")
              : isEditingAlert
                ? t("alerts.editMode.saveChanges")
                : t("alerts.save")
          }}</OButton
        >
      </div>
    </OPageLayout>
  </OForm>

  <ODrawer
    data-test="add-alert-json-editor-drawer"
    bleed
    v-model:open="showJsonEditorDialog"
    size="lg"
    :title="t('alerts.editJson')"
    persistent
  >
    <JsonEditor
      :data="jsonEditorData"
      :title="t('alerts.editJson')"
      :type="'alerts'"
      :validation-errors="validationErrors"
      @close="showJsonEditorDialog = false"
      @saveJson="saveAlertJson"
      :isEditing="beingUpdated"
    />
  </ODrawer>

  <ODialog
    data-test="alert-save-mode-dialog"
    v-model:open="saveModeDialogOpen"
    size="sm"
    :title="t('alerts.saveModeDialog.title')"
    persistent
    :show-close="false"
    :secondary-button-label="t('alerts.cancel')"
    :primary-button-label="
      t('alerts.saveModeDialog.saveWithMode', { mode: queryModeName(saveModePick) })
    "
    @click:secondary="saveModeDialogOpen = false"
    @click:primary="saveWithPickedMode"
  >
    <div class="flex flex-col gap-3 text-sm">
      <p data-test="alert-save-mode-lead">{{ saveModeLead }}</p>
      <OToggleGroup v-model="saveModePick" class="self-start" data-test="alert-save-mode-options">
        <OToggleGroupItem
          v-for="mode in saveModeChoices ?? []"
          :key="mode"
          :value="mode"
          size="sm"
          :data-test="`alert-save-mode-option-${mode}`"
        >
          <template #icon-left>
            <OIcon v-if="mode === 'custom'" name="build" size="sm" />
            <OIcon v-else-if="mode === 'sql'" name="database" size="sm" />
            <OIcon v-else name="show-chart" size="sm" />
          </template>
          {{ queryModeName(mode) }}
        </OToggleGroupItem>
      </OToggleGroup>
      <p v-if="saveModeInfo" class="text-status-warning-text" data-test="alert-save-mode-warning">
        {{ saveModeInfo }}
      </p>
      <p class="text-text-secondary text-xs" data-test="alert-save-mode-note">
        {{ saveModeNote }}
      </p>
    </div>
  </ODialog>

  <EditorDraftDialogs :draft="alertDraft" />
</template>

<script lang="ts">
import { raw } from "@/types/i18n";
import { defineComponent, computed, watch, provide, ref, reactive, onMounted } from "vue";
import { useStore } from "vuex";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only in a template `as` cast (:destinations), which eslint-plugin-vue cannot see; vue-tsc keeps it honest
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

import JsonEditor from "../common/JsonEditor.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Deduplication from "./steps/Deduplication.vue";
import Advanced from "./steps/Advanced.vue";
import InlineSelectFolderDropdown from "../common/sidebar/InlineSelectFolderDropdown.vue";
import PreviewAlert from "./PreviewAlert.vue";
import AnomalyDetectionConfig from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.vue";
import AnomalyDataPreview from "@/components/anomaly_detection/AnomalyDataPreview.vue";
import AnomalyAlerting from "@/components/anomaly_detection/steps/AnomalyAlerting.vue";
import { useAlertForm, defaultAlertValue, type AlertFormEmit } from "@/composables/useAlertForm";
import { useAlertEditorDraft } from "@/composables/alerts/useAlertEditorDraft";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import { anomalyNoticeBadgeKeys } from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.schema";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInlineEdit from "@/lib/forms/InlineEdit/OFormInlineEdit.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useAutoName } from "@/composables/useAutoName";
import { buildAlertAutoName } from "@/utils/autoName";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import CompositeAlertForm from "./composite/CompositeAlertForm.vue";
import alertsService from "@/services/alerts";
import OSnapScroll from "@/lib/core/SnapScroll/OSnapScroll.vue";
import OSectionNav from "@/lib/navigation/SectionNav/OSectionNav.vue";
import OCommandSearch from "@/lib/forms/CommandSearch/OCommandSearch.vue";
import { isTieredSetting, type AlertFindId } from "./alertSettingFind";
import { useAlertSettingFind } from "@/composables/alerts/useAlertSettingFind";
import AlertFormSection from "./AlertFormSection.vue";
import AlertTierLinks from "./AlertTierLinks.vue";
import type { AlertSettingId } from "./alertSettingTiers";
import {
  ALERT_SETTING_TIERS_KEY,
  useAlertSettingTiers,
} from "@/composables/alerts/useAlertSettingTiers";
import {
  describeAlertInPlainWords,
  describeCompositeInPlainWords,
  previewVerdictSentence,
} from "@/utils/alerts/alertReadBack";
import config from "@/aws-exports";
import { getUUID } from "@/utils/zincutils";
import {
  AGGREGATION_ENABLED_FIELD,
  type AlertSectionId,
  type AlertSectionSlot,
  type AlertSectionTargets,
} from "./alertFormSections";
import {
  useAlertFormSections,
  checkEveryLabel,
  type FieldMetaMap,
} from "@/composables/alerts/useAlertFormSections";
import useBreakpoint from "@/composables/useBreakpoint";
import type { OSnapScrollExpose } from "@/lib/core/SnapScroll/OSnapScroll.types";
import AlertEditStatus from "./AlertEditStatus.vue";
import AlertEditActions from "./AlertEditActions.vue";
import AlertUnsavedChanges from "./AlertUnsavedChanges.vue";
import AlertRecentRuns from "./AlertRecentRuns.vue";
import { useAlertEditHeader } from "@/composables/alerts/useAlertEditHeader";
import { useAlertUnsavedChanges } from "@/composables/alerts/useAlertUnsavedChanges";
import { cloneDeep } from "lodash-es";

const RAIL_VERDICT_ICONS = {
  fires: { name: "notifications-active", class: "text-status-error-text" },
  quiet: { name: "check-circle", class: "text-status-positive" },
  note: { name: "info", class: "text-text-secondary" },
} as const;

export default defineComponent({
  name: "ComponentAddUpdateAlert",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultAlertValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array,
      default: () => [],
    },
    templates: {
      type: Array,
      default: () => [],
    },
    folderId: {
      type: String,
      default: undefined,
    },
  },
  emits: ["update:list", "cancel:hideform", "refresh:destinations", "refresh:templates"],
  components: {
    OIcon,
    OPageLayout,
    OBanner,
    JsonEditor,
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Deduplication,
    Advanced,
    PreviewAlert,
    AnomalyDetectionConfig,
    AnomalyDataPreview,
    AnomalyAlerting,
    InlineSelectFolderDropdown,
    OButton,
    OToggleGroup,
    OToggleGroupItem,
    ODrawer,
    ODialog,
    OTag,
    OTooltip,
    OForm,
    OFormInlineEdit,
    OFormSelect,
    OPageHeader,
    OTruncatedText,
    CompositeAlertForm,
    EditorDraftDialogs,
    OSnapScroll,
    OSectionNav,
    OCommandSearch,
    AlertFormSection,
    AlertTierLinks,
    AlertEditStatus,
    AlertEditActions,
    AlertUnsavedChanges,
    AlertRecentRuns,
  },
  setup(props, { emit }) {
    const store = useStore();
    // Bound once the draft exists; a save reports to the draft first, which decides whether the host navigates.
    let onFormSaved: ((folderId?: string) => void) | null = null;
    const formEmit = ((event: string, ...args: unknown[]) => {
      if (event === "update:list" && onFormSaved) {
        onFormSaved(args[0] as string | undefined);
        return;
      }
      emit(event as Parameters<typeof emit>[0], ...args);
    }) as AlertFormEmit;
    const snapScrollRef = ref<OSnapScrollExpose | null>(null);
    const goToSection = (id: string) => snapScrollRef.value?.scrollToSection(id);
    const alertForm = useAlertForm(props, formEmit, { showSection: goToSection });
    const alertEditorDraft = useAlertEditorDraft({
      form: alertForm,
      modelValue: () => props.modelValue,
      onSaved: (folderId, options) => emit("update:list", folderId, options),
    });
    onFormSaved = alertEditorDraft.handleSaved;
    onMounted(() => alertEditorDraft.start());

    const cancelEditor = async () => {
      if (await alertEditorDraft.draft.confirmLeave()) emit("cancel:hideform");
    };

    // Share server SQL-validation squiggle ranges with the descendant query
    // editors (QueryEditorDialog / QueryConfig) via inject.
    provide("alertSqlErrorRanges", alertForm.sqlErrorRanges);

    // SQL tab's Multi Alert value-column dropdown (sql_simple_multi_alert_fe_prd.md
    // §11): PreviewAlert already calls /result_schema every time the preview
    // query itself fires (its own reactive query watcher / editor-closed
    // refresh) — reuse that response instead of a second, differently-timed
    // fetch. QueryConfig's own watcher on this prop does the actual
    // clear-if-missing comparison; this handler only forwards the list.
    const handleSqlSchemaUpdated = (payload: { projections: string[]; hasHaving: boolean }) => {
      alertForm.sqlAggColumnOptions.value = payload.projections;
      alertForm.sqlQueryHasHaving.value = payload.hasHaving;
    };

    const isAnomalyDetectionEnabled = computed(
      () => alertForm.store.state.zoConfig.anomaly_detection_enabled === true,
    );

    // §4.8: keyed off the config API's notice_class field alone.
    const anomalyNoticeBadge = computed(() => {
      const keys = anomalyNoticeBadgeKeys(alertForm.anomalyConfig.value.notice_class);
      return keys ? { label: alertForm.t(keys.labelKey as any) } : null;
    });
    const anomalyNoticeTooltip = computed(() => {
      const keys = anomalyNoticeBadgeKeys(alertForm.anomalyConfig.value.notice_class);
      return raw(keys ? keys.tooltipKeys.map((k) => alertForm.t(k as any)).join(" ") : "");
    });
    const isCompositeMode = computed(() => alertForm.formData.value.is_real_time === "composite");
    const availableCompositeChildren = ref<any[]>([]);

    const loadCompositeChildren = async () => {
      if (!isCompositeMode.value) return;
      try {
        const response = await alertsService.listByFolderId(
          0,
          1000,
          "name",
          false,
          "",
          alertForm.store.state.selectedOrganization.identifier,
          undefined,
          "",
          "all",
        );
        const rows = Array.isArray(response.data?.list) ? response.data.list : [];
        availableCompositeChildren.value = rows
          .filter((row: any) => {
            const id = row.alert_id ?? row.id;
            return (
              id && id !== alertForm.formData.value.id && row.alert_type !== "anomaly_detection"
            );
          })
          .map((row: any) => ({
            alert_id: row.alert_id ?? row.id,
            name: row.name,
            alert_type: row.alert_type,
            folder_id: row.folder_id,
            folder_name: row.folder_name,
            enabled: row.enabled,
            level: row.level,
            stale: row.stale,
            accessible: true,
          }));
      } catch {
        availableCompositeChildren.value = [];
      }
    };

    const updateCompositeDraft = (draft: any) => {
      alertForm.setF("composite_condition", draft.composite_condition);
      alertForm.setF("children", draft.children ?? []);
    };

    // Composite drafts validate asynchronously against the server; until the
    // form reports a valid expression the Save button stays disabled (the schema
    // blocks a bad expression on submit too — this is the visible affordance).
    const compositeValidation = ref<{ valid: boolean }>({ valid: false });
    const compositeSaveDisabled = computed(
      () => isCompositeMode.value && compositeValidation.value.valid !== true,
    );
    const onCompositeValidation = (value: { valid: boolean }) => {
      compositeValidation.value = value;
    };

    watch(
      isCompositeMode,
      (enabled) => {
        if (!enabled) return;
        // Fresh draft → re-validate before the button can re-enable on a stale
        // `valid` from a previous visit to composite mode.
        compositeValidation.value = { valid: false };
        loadCompositeChildren();
      },
      { immediate: true },
    );

    // Auto-expand preview when stream name is selected, collapse when cleared
    watch(
      () => alertForm.formData.value.stream_name,
      (newVal) => {
        alertForm.chartCollapsed.value = !newVal;
      },
    );

    const activeEvaluationStatus = computed(
      () => alertForm.previewAlertRef.value?.evaluationStatus || null,
    );
    const alertTypeOptions = computed(() => [
      {
        label: checkEveryLabel(alertForm.formData.value, alertForm.t),
        value: "false",
        icon: "schedule",
      },
      { label: alertForm.t("alerts.sections.asItHappens"), value: "true", icon: "bolt" },
      ...(isAnomalyDetectionEnabled.value
        ? [
            {
              label: alertForm.t("alerts.sections.whenUnusual"),
              value: "anomaly",
              icon: "query-stats",
            },
          ]
        : []),
      ...(alertForm.store.state.zoConfig.composite_alerts_available === true ||
      isCompositeMode.value
        ? [
            {
              label: alertForm.t("alerts.sections.whenCombined"),
              value: "composite",
              icon: "account-tree",
            },
          ]
        : []),
    ]);

    // Mode as the subtitle, exactly as AddPanel does it ("Add Panel" / "Edit
    // Panel"): the header then reads NAME first, what-you're-doing second, and
    // the two pages have the same shape. The containing folder is already the
    // back button's label, so the subtitle no longer repeats it.
    const headerModeLabel = computed(() => {
      const editing = alertForm.beingUpdated.value || alertForm.anomalyEditMode.value;
      if (alertForm.isAnomalyMode.value) {
        return editing
          ? alertForm.t("alerts.editAnomalyMode")
          : alertForm.t("alerts.addAnomalyMode");
      }
      return editing ? alertForm.t("alerts.editAlertMode") : alertForm.t("alerts.addAlertMode");
    });

    const activeFolderName = computed(() => {
      const folders = alertForm.store.state.organizationData.foldersByType?.alerts ?? [];
      const found = folders.find((f: any) => f.folderId === alertForm.activeFolderId.value);
      return found?.name ?? "default";
    });

    const goBackToAlertsList = () => {
      return alertForm.router.push({
        path: "/alerts",
        query: {
          folder: alertForm.activeFolderId.value ?? "default",
          tab: alertForm.router.currentRoute.value.query.tab,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    // Stream-type change: write the value into the ONE form explicitly (so the
    // synchronous form store is current before updateStreams reads it — not
    // relying on the OFormSelect field-change flush order), then refresh streams
    // (which also resets stream_name via setF).
    const onStreamTypeChange = (value: any) => {
      alertForm.setF("stream_type", value);
      alertForm.updateStreams();
    };

    // Alert type now lives in a toggle group, not an OFormSelect, so it writes
    // the ONE form directly. The existing watch on is_real_time still drives the
    // anomaly/composite tab switch.
    const onAlertTypeChange = (value: unknown) => {
      alertForm.setF("is_real_time", value);
      // Realtime runs Builder only. The query text and Compare-with-Past windows
      // stay in the form for a switch back; the payload never sends windows here.
      if (value === "true" && alertForm.formData.value.query_condition?.type !== "custom") {
        alertForm.setF("query_condition.type", "custom");
      }
    };

    const { lgUp } = useBreakpoint();
    const activeSection = ref<AlertSectionId>("watch");

    // Filled by template refs after mount; until then every step renders its slices inline.
    const sectionTargets = reactive<AlertSectionTargets>({});
    const setSectionTarget = (slot: AlertSectionSlot, el: unknown) => {
      const next = el instanceof HTMLElement ? el : null;
      if (sectionTargets[slot] !== next) sectionTargets[slot] = next;
    };

    // Anomaly edits keep their own header trail and save path.
    const isEditingAlert = computed(
      () => alertForm.beingUpdated.value && !alertForm.isAnomalyMode.value,
    );
    const editAlertId = computed(() =>
      String(
        alertForm.formData.value?.id ?? props.modelValue?.id ?? props.modelValue?.alert_id ?? "",
      ),
    );
    const editFolderId = computed(() => {
      const id = alertForm.activeFolderId.value;
      return (Array.isArray(id) ? id[0] : id) || undefined;
    });
    // Switching the measure off drops the aggregation from the payload, so the switch is tracked with the values.
    const trackedValues = computed(() => ({
      ...alertForm.formData.value,
      [AGGREGATION_ENABLED_FIELD]: alertForm.isAggregationEnabled.value,
    }));
    const unsaved = useAlertUnsavedChanges({
      values: trackedValues,
      enabled: () => isEditingAlert.value,
      ready: alertForm.formReady,
    });
    const editHeader = useAlertEditHeader({
      alertId: () => (isEditingAlert.value ? editAlertId.value : ""),
      name: () => String(alertForm.formData.value?.name ?? ""),
      folderId: () => editFolderId.value,
      onEnabledSaved: (enabled) => {
        alertForm.setF("enabled", enabled);
        unsaved.acceptSaved("enabled", enabled);
      },
    });
    const discardChanges = async () => {
      const saved = unsaved.baseline.value;
      if (!saved) return;
      const { [AGGREGATION_ENABLED_FIELD]: aggregationEnabled, ...base } = saved;
      const current = alertForm.formData.value;
      const streamChanged =
        current.stream_type !== base.stream_type || current.stream_name !== base.stream_name;
      alertForm.resetForm(cloneDeep(base));
      alertForm.isAggregationEnabled.value = aggregationEnabled === true;
      // Steps hold local copies of what they first read, so they remount on the restored values.
      alertEditorDraft.formKey.value += 1;
      if (streamChanged && base.stream_name) {
        await alertForm.updateStreamFields(String(base.stream_name));
      }
    };

    const { items: sectionItems } = useAlertFormSections({
      fieldMeta: alertForm.form.useStore((s) => s.fieldMeta as FieldMetaMap),
      formData: alertForm.formData,
      anomalyConfig: alertForm.anomalyConfig,
      isAnomalyMode: alertForm.isAnomalyMode,
      isAggregationEnabled: alertForm.isAggregationEnabled,
      isEditing: computed(() => alertForm.beingUpdated.value || alertForm.anomalyEditMode.value),
      changedSections: unsaved.sections,
      t: alertForm.t,
    });

    const alertSentence = computed(() => {
      if (alertForm.isAnomalyMode.value) return "";
      if (isCompositeMode.value) {
        return describeCompositeInPlainWords(alertForm.formData.value, alertForm.t);
      }
      return describeAlertInPlainWords(alertForm.formData.value, alertForm.t, {
        aggregationEnabled: alertForm.isAggregationEnabled.value,
      });
    });

    // A real-time alert has no window to count, so the preview offers no verdict to restate.
    const railVerdict = computed<{ text: string; tone: "fires" | "quiet" | "note" } | null>(() => {
      const status = activeEvaluationStatus.value;
      const fd = alertForm.formData.value;
      if (alertForm.isAnomalyMode.value || !fd.stream_name) return null;
      if (fd.is_real_time === "true")
        return { text: alertForm.t("alerts.verdict.realtime"), tone: "note" };
      if (!status || fd.is_real_time !== "false") return null;
      return {
        text: previewVerdictSentence(status, fd, alertForm.t, {
          countsEvents:
            fd.query_condition?.type === "custom" && !alertForm.isAggregationEnabled.value,
        }),
        tone: status.wouldTrigger ? "fires" : "quiet",
      };
    });

    const has = (v: unknown) => v !== undefined && v !== null && v !== "";
    const tierAvailable = (id: AlertSettingId): boolean => {
      const fd = alertForm.formData.value;
      const scheduled = fd.is_real_time === "false" && !alertForm.isAnomalyMode.value;
      const anomaly = alertForm.isAnomalyMode.value;
      switch (id) {
        case "warning":
        case "holdFor":
        case "recovery":
        case "keepFiring":
        case "dedup":
          return scheduled;
        case "groupBy":
          return (
            scheduled &&
            fd.query_condition?.type === "custom" &&
            alertForm.isAggregationEnabled.value
          );
        case "compareWithPast":
          return scheduled && fd.query_condition?.type === "sql";
        case "createsIncident":
          return (
            !anomaly &&
            (config.isEnterprise === "true" || config.isCloud === "true") &&
            store.state.zoConfig?.incidents_enabled === true
          );
        case "oncall":
          return !anomaly && store.state.zoConfig?.oncall_enabled === true;
        default:
          return !anomaly;
      }
    };
    const tierIsSet = (id: AlertSettingId): boolean => {
      const fd = alertForm.formData.value;
      const qc = fd.query_condition ?? {};
      switch (id) {
        case "warning":
          return (
            has(fd.trigger_condition?.warning_threshold) ||
            has(qc.aggregation?.warning_value) ||
            has(qc.promql_warning_value)
          );
        case "holdFor":
          return Number(fd.pending_period_sec) > 0;
        case "groupBy":
          return (
            (fd.logGroupBy ?? []).some(has) ||
            (qc.aggregation?.group_by ?? []).some(has) ||
            qc.multi_alert === true
          );
        case "compareWithPast":
          return (qc.multi_time_range ?? []).length > 0;
        case "createsIncident":
          return fd.creates_incident === true;
        case "template":
          return has(fd.template);
        case "variables":
          return (fd.context_attributes ?? []).length > 0;
        case "recovery":
          return fd.notify_on_recovery === true || (fd.recovery_destinations ?? []).length > 0;
        case "oncall":
          return has(fd.oncall_team);
        case "dedup":
          return (
            fd.deduplication?.enabled === true ||
            (fd.deduplication?.fingerprint_fields ?? []).length > 0
          );
        case "keepFiring":
          return Number(fd.keep_firing_for) > 0;
        case "priority":
          return has(fd.priority);
        case "tags":
          return (fd.tags ?? []).length > 0;
        default:
          return false;
      }
    };
    const tiers = useAlertSettingTiers({ available: tierAvailable, isSet: tierIsSet });
    provide(ALERT_SETTING_TIERS_KEY, tiers);

    const findAvailable = (id: AlertFindId): boolean => {
      if (isTieredSetting(id)) return tierAvailable(id);
      const fd = alertForm.formData.value;
      const composite = isCompositeMode.value;
      const mode = fd.query_condition?.type || "custom";
      switch (id) {
        case "streamType":
        case "stream":
          return !composite;
        case "filters":
          return !composite && mode === "custom";
        case "queryEditor":
          return !composite && mode !== "custom";
        case "vrl":
          return !composite && mode === "sql";
        case "threshold":
        case "checkEvery":
        case "cron":
        case "timezone":
        case "lookBack":
          return fd.is_real_time === "false";
        case "name":
        case "folder":
          return !alertForm.beingUpdated.value;
        default:
          return true;
      }
    };
    const settingFind = useAlertSettingFind({
      t: alertForm.t,
      available: findAvailable,
      tiers,
      goToSection,
      reveal: (el) => snapScrollRef.value?.revealElement(el),
    });

    const focusNameField = () =>
      (alertForm.step1Ref.value as { focus?: () => void } | null)?.focus?.();

    // A one-click link adds the setting itself, so the click is never only a reveal.
    const onTierAdd = (id: AlertSettingId) => {
      tiers.reveal(id);
      if (id === "createsIncident") alertForm.setF("creates_incident", true);
      if (id === "variables" && !(alertForm.formData.value.context_attributes ?? []).length) {
        alertForm.setF("context_attributes", [{ id: getUUID(), key: "", value: "" }]);
      }
    };

    // ── Save-mode dialog copy ────────────────────────────────────────────────
    // Mode names match the QueryConfig mode toggle.
    const queryModeName = (mode: string) =>
      mode === "sql"
        ? raw("SQL")
        : mode === "promql"
          ? raw("PromQL")
          : alertForm.t("alerts.queryBuilder");

    // Names the modes that are set up; an empty selected mode is named first.
    const saveModeLead = computed(() => {
      const selected = alertForm.formData.value.query_condition?.type || "custom";
      const [first, second, third] = alertForm.queryModesWithContent.value.map(queryModeName);
      if (alertForm.queryModesWithContent.value.includes(selected)) {
        return third
          ? alertForm.t("alerts.saveModeDialog.leadAllSetUp", { first, second, third })
          : alertForm.t("alerts.saveModeDialog.leadBothSetUp", { first, second });
      }
      return second
        ? alertForm.t("alerts.saveModeDialog.leadSelectedEmptyTwoOthers", {
            selected: queryModeName(selected),
            first,
            second,
          })
        : alertForm.t("alerts.saveModeDialog.leadSelectedEmptyOneOther", {
            selected: queryModeName(selected),
            other: first,
          });
    });

    // Only warns, and only when the picked mode is empty by the same rule as the lead.
    const saveModeInfo = computed(() => {
      const pick = alertForm.saveModePick.value;
      if (alertForm.queryModesWithContent.value.includes(pick)) return null;
      return pick === "custom"
        ? alertForm.t("alerts.saveModeDialog.noFilters", {
            stream: alertForm.formData.value.stream_name,
          })
        : alertForm.t("alerts.saveModeDialog.noQuery");
    });

    // Says what runs: the picked mode only. Names the other modes that hold content.
    const saveModeNote = computed(() => {
      const pick = alertForm.saveModePick.value;
      const [first, second] = alertForm.queryModesWithContent.value
        .filter((mode) => mode !== pick)
        .map(queryModeName);
      const params = { pick: queryModeName(pick), first, second, other: first };
      if (second) return alertForm.t("alerts.saveModeDialog.noteTwoOthersUnused", params);
      if (first) return alertForm.t("alerts.saveModeDialog.noteOneOtherUnused", params);
      return alertForm.t("alerts.saveModeDialog.noteOnlyPick", params);
    });

    // ── Smart alert name ─────────────────────────────────────────────────────
    // A new alert names itself after what it actually watches ("k8s_logs where
    // status >= 500") and keeps re-deriving that as the stream and condition
    // change — until the first keystroke in the header, after which the name is
    // the user's. Editing an existing alert (or anomaly) is excluded outright:
    // a saved name is never regenerated behind the user's back.
    const alertNameSuggestion = computed(() =>
      buildAlertAutoName(alertForm.formData.value, alertForm.t),
    );
    const alertAutoName = useAutoName({
      suggestion: alertNameSuggestion,
      currentValue: () => (alertForm.formData.value?.name ?? "") as string,
      apply: (name: string) => alertForm.setF("name", name),
      enabled: () => !alertForm.beingUpdated.value && !alertForm.anomalyEditMode.value,
    });

    return {
      raw,
      ...alertForm,
      alertDraft: alertEditorDraft.draft,
      draftFormKey: alertEditorDraft.formKey,
      cancelEditor,
      alertAutoName,
      headerModeLabel,
      isAnomalyDetectionEnabled,
      anomalyNoticeBadge,
      anomalyNoticeTooltip,
      alertTypeOptions,
      lgUp,
      snapScrollRef,
      activeSection,
      goToSection,
      sectionTargets,
      setSectionTarget,
      sectionItems,
      isEditingAlert,
      editAlertId,
      editFolderId,
      editHeader,
      unsavedChanges: unsaved.changes,
      discardChanges,
      alertSentence,
      railVerdict,
      RAIL_VERDICT_ICONS,
      tiers,
      onTierAdd,
      settingFind,
      focusNameField,
      activeFolderName,
      goBackToAlertsList,
      onStreamTypeChange,
      onAlertTypeChange,
      queryModeName,
      saveModeLead,
      saveModeInfo,
      saveModeNote,
      activeEvaluationStatus,
      isCompositeMode,
      availableCompositeChildren,
      updateCompositeDraft,
      compositeSaveDisabled,
      onCompositeValidation,
      handleSqlSchemaUpdated,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:o2-form): float each control's validation message out of
   flow. A class passed to OInput/OFormSelect lands on the ROOT wrapper — the
   flex-col holding the control AND its message — so an in-flow message would
   grow these fixed-height topbar rows, escape the card, and be painted over by
   the next card. `top:100%` resolves against the wrapper. The selects
   deliberately carry NO height clamp (it only ever shrank the wrapper box,
   never the 2.125rem trigger, which mis-anchored the floating message).
   pointer-events:none so the floating text can't swallow clicks on the tab bar
   it overlaps. `:deep` because [role="alert"] renders inside the child
   component. All widths and container-query steps are template utilities.
   The alert-name field is NOT listed here: OInlineEdit renders its message
   BESIDE the name (below is the subtitle band), so it adds no height either and
   needs no wrapper override. */
.stream-type-select,
.stream-name-select {
  position: relative;
}

.stream-type-select :deep([role="alert"]),
.stream-name-select :deep([role="alert"]) {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 0.125rem;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}
</style>

<style scoped>
/* keep(complex-state): `.alert-field-highlight` is a transient state class that
   AlertFocusManager (utils/alerts/focusManager.ts) adds/removes at RUNTIME via
   classList on refs registered from useAlertForm — no template ever writes it,
   so it cannot become a template utility. AddAlert is the alert-form root and
   owns every registered field's DOM (incl. the QueryConfig subtree, which
   instantiates its own focusManager), so one `:deep()` here covers them all.
   `!important` is preserved: it must beat the field components' own border
   utilities, exactly as the previous global rule did. */
:deep(.alert-field-highlight) {
  border: 0.125rem solid var(--color-accent) !important;
  border-radius: 0.25rem;
  transition: border 0.3s ease;
}
</style>
