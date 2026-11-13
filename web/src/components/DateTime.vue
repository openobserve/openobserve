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
    ref="groupEl"
    icon="info"
    class="date-time-container inline-flex max-w-full min-w-0 items-stretch [&_button:focus-visible]:z-1"
    :class="{
      'rounded-default border-button-outline-border min-h-8.5 border': !hideRangeShift,
      'w-full [&>*]:flex-1': fieldAppearance,
    }"
  >
    <OTooltip v-if="!hideRangeShift" shortcut-id="timeRangePrevious">
      <template #content>
        <span class="flex flex-col">
          <span>{{ stepTooltip.prev.title }}</span>
          <span v-if="stepTooltip.prev.window" class="text-text-secondary text-xs tabular-nums">{{
            stepTooltip.prev.window
          }}</span>
        </span>
      </template>
      <OButton
        data-test="date-time-prev-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! disabled:text-text-disabled! h-auto! rounded-e-none! border-e! max-md:hidden"
        icon-left="chevron-left"
        :aria-label="stepTooltip.prev.title"
        :disabled="disable || disablePrevShift"
        @click.prevent.stop="shiftTimeRange('prev')"
      />
    </OTooltip>
    <OPopover
      v-model:open="menuOpen"
      :anchor="hideRangeShift ? null : groupEl"
      side="bottom"
      :align="menuAlign"
      :z-index="10001"
      :aria-label="t('common.selectDateRange')"
      :collision-padding="POPOVER_COLLISION_PADDING"
      content-class="border-border-default! bg-surface-overlay! rounded-surface! overflow-hidden p-0 shadow-lg!"
      @update:open="onMenuOpenChange"
      @open-auto-focus="onPopoverOpenAutoFocus"
    >
      <template #trigger>
        <OButton
          :data-test="dataTestName"
          id="date-time-button"
          ref="datetimeBtn"
          data-cy="date-time-button"
          :variant="variant"
          :size="fieldAppearance ? 'sm' : 'sm-toolbar'"
          :class="{
            [selectedType + 'type']: !disableRelative,
            hideRelative: disableRelative,
            'w-fit': disableRelative,
            'h-auto! rounded-none! border-0!': !hideRangeShift,
            'enabled:hover:bg-interactive-hover-bg! data-[state=open]:bg-surface-accent-active!':
              !fieldAppearance,
            'border-select-border! enabled:hover:border-select-border-hover! w-full':
              fieldAppearance,
            'max-md:rounded-default!': !hideRangeShift,
          }"
          class="max-md:max-w-full max-md:min-w-0"
          :aria-label="triggerAriaLabel"
          :disabled="disable"
          @mouseenter="onTriggerHover(true)"
          @mouseleave="onTriggerHover(false)"
          @focus="onTriggerHover(true)"
          @blur="onTriggerHover(false)"
        >
          <template #icon-left>
            <OIcon name="schedule" size="sm" :class="{ 'max-md:hidden': !fieldAppearance }" />
          </template>
          <OTruncatedText
            class="date-time-label flex-1 text-start tabular-nums max-md:min-w-16"
            :class="fieldAppearance ? 'font-normal' : 'font-semibold'"
            >{{ triggerLabel }}</OTruncatedText
          >
          <OIcon
            v-if="narrowedByQuery"
            name="filter-alt"
            size="sm"
            class="text-text-secondary shrink-0"
            data-test="date-time-trigger-narrowed"
          />
          <OBadge
            v-if="zoneBadgeText"
            data-test="date-time-zone-badge"
            variant="default-soft"
            size="sm"
            class="shrink-0 tabular-nums"
            >{{ zoneBadgeText }}</OBadge
          >
          <template #icon-right
            ><OIcon
              name="arrow-drop-down"
              size="sm"
              class="date-time-arrow ms-auto text-lg! transition-transform duration-250"
              :class="{ 'max-md:hidden': !fieldAppearance }"
          /></template>
        </OButton>
      </template>
      <div
        id="date-time-menu"
        class="date-time-dialog z-10001 flex h-82 max-h-(--reka-popover-content-available-height) w-110 max-w-[min(27.5rem,calc(100vw-1.5rem))] flex-col"
        @keydown.capture="onPickerKeydown"
        @paste="onPickerPaste"
      >
        <div class="flex shrink-0 flex-col gap-1.5 px-3 pt-2.5 pb-2" data-test="date-time-top-bar">
          <div class="flex min-w-0 items-center gap-2">
            <div v-if="!hideClipboard" class="relative min-w-0 flex-1" @focusout="onBarFocusOut">
              <OInput
                ref="inputBar"
                v-model="inputText"
                data-test="date-time-input"
                class="min-w-0 [&>div:first-of-type]:h-8!"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                :aria-expanded="shownRows.length > 0"
                :aria-controls="shownRows.length > 0 ? listId : undefined"
                :aria-activedescendant="activeRow >= 0 ? `${listId}-${activeRow}` : undefined"
                :placeholder="
                  isMobile ? t('dateTime.placeholderShort') : t('common.timeRangeInputPlaceholder')
                "
                :aria-label="t('common.timeRangeInputLabel')"
                :error="inputError"
                :aria-describedby="inputError ? inputErrorId : undefined"
                @update:model-value="onInputEdit"
                @keydown="onInputKeydown"
              >
                <template #icon-right>
                  <OShortcut
                    v-if="previewLine?.ready && !suggestionsOpen && listCursor < 0"
                    data-test="date-time-input-enter-hint"
                    class="me-1"
                    keys="enter"
                    size="sm"
                  />
                  <OTooltip v-else :content="t('common.pasteRange')" side="bottom" align="end">
                    <OButton
                      data-test="date-time-paste-btn"
                      variant="ghost"
                      size="icon-xs-sq"
                      icon-left="content-paste"
                      class="text-text-secondary!"
                      :aria-label="t('common.pasteRange')"
                      @click="pasteRange"
                    />
                  </OTooltip>
                </template>
              </OInput>
            </div>
            <div v-else class="flex-1" />
            <OSelect
              v-if="!hideRelativeTimezone"
              data-test="datetime-timezone-select"
              v-model="timezone"
              :options="timezoneSelectOptions"
              searchable
              :aria-label="t('logStream.timezone')"
              :search-placeholder="t('dateTime.searchZones')"
              :dropdown-style="{ minWidth: 'min(24rem, calc(100vw - 2rem))' }"
              @update:model-value="onTimezoneChange"
              @open="isTimezoneSelectOpen = true"
              @close="isTimezoneSelectOpen = false"
              class="w-auto! max-w-36 min-w-0 shrink-0 [&_[role=combobox]]:h-8!"
            >
              <template #trigger>
                <span
                  class="text-select-text text-compact flex-1 truncate text-start tabular-nums"
                  data-test="datetime-timezone-short"
                  >{{ zoneShortLabel }}</span
                >
              </template>
            </OSelect>
          </div>
          <div class="flex h-6 min-w-0 items-center gap-2">
            <div
              v-if="summaryError"
              :id="inputErrorId"
              data-test="date-time-input-error"
              role="alert"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-xs whitespace-nowrap"
            >
              <OIcon name="error-outline" size="sm" class="text-input-error-text shrink-0" />
              <span class="text-input-error-text shrink-0 font-medium">{{
                summaryError.message
              }}</span>
              <span
                v-if="summaryError.examples"
                class="text-text-secondary min-w-0 truncate"
                data-test="date-time-input-examples"
                >{{ summaryError.examples }}</span
              >
            </div>
            <div
              v-else
              data-test="date-time-resolved"
              :data-preview="previewLine ? 'true' : undefined"
              class="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap tabular-nums"
            >
              <span
                v-if="shownLine.name"
                class="text-compact font-semibold"
                :class="[
                  shownLine.fixed ? 'shrink-0' : 'min-w-0 shrink truncate',
                  previewLine ? 'text-toggle-item-active-text' : 'text-text-heading',
                ]"
                data-test="date-time-resolved-name"
                >{{ shownLine.name }}</span
              >
              <OBadge
                v-if="shownLine.live"
                variant="primary-soft"
                size="sm"
                class="shrink-0"
                data-test="date-time-preview-live"
                >{{ t("dateTime.tagLive")
                }}<OTooltip :content="t('dateTime.tagLiveHint')" side="bottom"
              /></OBadge>
              <OBadge
                v-else-if="shownLine.fixed"
                variant="default-soft"
                size="sm"
                class="shrink-0"
                data-test="date-time-preview-fixed"
                >{{ t("dateTime.fixed")
                }}<OTooltip :content="t('dateTime.tagFixedHint')" side="bottom"
              /></OBadge>
              <span
                v-if="shownLine.range"
                class="text-compact shrink-0"
                :class="previewLine ? 'text-toggle-item-active-text' : 'text-text-secondary'"
                data-test="date-time-resolved-range"
                >{{ shownLine.range }}</span
              >
              <OBadge
                v-if="shownLine.duration"
                variant="default-soft"
                size="sm"
                class="shrink-0 max-md:hidden"
                data-test="date-time-resolved-duration"
                >{{ shownLine.duration }}</OBadge
              >
              <span
                v-if="shownLine.note"
                class="min-w-0 shrink-[4] truncate text-xs"
                :class="shownLine.warning ? 'text-status-warning-text' : 'text-text-secondary'"
                :title="shownLine.note"
                data-test="date-time-preview-note"
                >{{ shownLine.note }}</span
              >
              <OButton
                v-if="asUtcLabel"
                data-test="date-time-as-utc-toggle"
                variant="outline"
                size="chip"
                class="text-text-link! shrink-0 rounded-full!"
                @click="toggleAsUtc"
                >{{ asUtcLabel.short
                }}<OTooltip :content="asUtcLabel.full" side="bottom" align="end"
              /></OButton>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <!-- Copy takes the selection, not a preview, so it steps aside and the preview's note shows in full. -->
              <OTooltip
                v-if="!hideClipboard && !previewLine"
                :content="copyDisabled ? t('dateTime.nothingToCopy') : t('common.copyRange')"
                :shortcut="copyShortcut"
                side="bottom"
                align="end"
              >
                <OButton
                  data-test="date-time-copy-btn"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="content-copy"
                  class="enabled:text-text-secondary! disabled:text-text-disabled! max-md:hidden"
                  :aria-label="t('common.copyRange')"
                  :disabled="copyDisabled"
                  @click="copyRange"
                />
              </OTooltip>
              <OTooltip
                v-if="showLiveButton"
                :content="t('dateTime.goLiveHint', { duration: liveDurationLabel })"
                side="bottom"
                align="end"
              >
                <OButton
                  data-test="date-time-live-btn"
                  variant="outline"
                  size="xs"
                  class="text-text-link! h-6! shrink-0 gap-1.5! px-2!"
                  :aria-label="t('dateTime.goLiveHint', { duration: liveDurationLabel })"
                  @click="goLive"
                  ><span class="bg-accent size-1.5 rounded-full" aria-hidden="true" />{{
                    t("dateTime.live")
                  }}</OButton
                >
              </OTooltip>
            </div>
          </div>
        </div>
        <div class="border-border-default min-h-0 flex-1 border-y" data-test="date-time-body">
          <div v-if="calendarMode" class="h-full overflow-hidden px-3 py-1">
            <ODateRangeCalendar
              ref="calendarRef"
              band-range
              prevent-deselect
              fill
              compact
              auto-focus
              :locale="intlLocale"
              :week-starts-on="weekStart"
              :calendar-label="t('dateTime.dateRangeGrid')"
              :prev-label="t('dateTime.calendarPrevMonth')"
              :next-label="t('dateTime.calendarNextMonth')"
              :hide-selection="selectedType === 'relative'"
              :start-date="selectedDate.from"
              :end-date="selectedDate.to"
              :min-date="calendarMinDate"
              :max-date="calendarMaxDate"
              :unavailable-before="retentionFloorDay ?? undefined"
              :unavailable-reason="
                retentionDays ? t('dateTime.outsideRetention', { days: retentionDays }) : undefined
              "
              @update:start-date="onCalendarStartDate"
              @update:end-date="onCalendarEndDate"
              @update:pending-date="onCalendarPendingDay"
              @update:preview-date="calendarPreviewDay = $event"
            />
          </div>
          <div v-else class="flex h-full flex-col">
            <div
              v-if="showChips && !typing"
              class="border-border-subtle flex h-9 shrink-0 items-center gap-2 border-b px-3 max-md:h-11"
              data-test="date-time-chips"
            >
              <OToggleGroup :model-value="litChip ?? undefined" @update:model-value="onChipToggle">
                <OToggleGroupItem
                  v-for="chip in chipItems"
                  :key="chip.value"
                  :value="chip.value"
                  size="xs"
                  :disabled="chip.disabled"
                  focusable-unavailable
                  :tooltip="chip.reason ? raw(chip.reason) : undefined"
                  :aria-label="chip.title"
                  class="o-time-chip data-[state=on]:bg-accent! data-[state=on]:text-text-inverse! data-disabled:border-border-default h-6! tabular-nums data-disabled:border data-disabled:bg-transparent! max-md:h-8! max-md:min-w-10"
                  :data-test="`date-time-chip-${chip.label}`"
                  >{{ raw(chip.label) }}<OTooltip v-if="!chip.disabled" :content="chip.title"
                /></OToggleGroupItem>
              </OToggleGroup>
              <OTooltip
                v-for="(note, noteIndex) in chipsNotes"
                :key="note.testId"
                :content="note.tooltip"
                side="right"
              >
                <span
                  class="text-text-secondary inline-flex min-w-0 shrink items-center gap-1 text-xs"
                  :class="{ 'ms-auto': noteIndex === 0 }"
                  :data-test="note.testId"
                >
                  <OIcon :name="note.icon" size="xs" class="shrink-0" />
                  <span class="truncate">{{ note.text }}</span>
                </span>
              </OTooltip>
            </div>
            <div class="min-h-0 flex-1">
              <DateTimeRangeList
                v-if="shownRows.length > 0"
                :id="listId"
                :rows="shownRows"
                :active="activeRow"
                :editing-id="editingPinRowId"
                :heading="listHeading"
                @pick="pickShownRow"
                @cursor="setCursorRow"
                @pin="pinRecentRow"
                @unpin="unpinRow"
                @remove="removeRecentRow"
                @rename="renamePin"
                @rename-cancel="cancelPinName"
              />
            </div>
          </div>
        </div>
        <div class="flex h-9 shrink-0 items-center gap-1 ps-1 pe-2" data-test="date-time-footer">
          <template v-if="calendarMode">
            <OTooltip v-if="!disableRelative" :content="t('dateTime.backToList')">
              <OButton
                data-test="date-time-calendar-back-btn"
                variant="ghost"
                size="icon-xs-sq"
                icon-left="arrow-back"
                class="text-text-secondary! shrink-0"
                :aria-label="t('dateTime.backToList')"
                @click="closeCalendar"
              />
            </OTooltip>
            <div
              v-if="!hideRelativeTime"
              class="startEndTime grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-0.5 max-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              data-test="date-time-start-end"
              @keydown.enter="onTimeFieldEnter"
            >
              <OTime
                class="min-w-0"
                size="sm"
                :aria-label="t('common.timeRangeStart')"
                :prefix="startDayLabel"
                hide-icon
                format24
                revert-refused
                :error="unreadableFields.start || timeFieldError?.field === 'start'"
                hide-message
                :model-value="selectedTime.startTime"
                with-seconds
                optional-seconds
                data-test="datetime-start-time"
                @input="onTimeFieldTyping('start', $event)"
                @invalid="onTimeFieldInvalid('start', $event)"
                @update:model-value="onStartTimeEdit"
                @focus="timeFieldFocused = true"
                @blur="onTimeFieldBlur"
              />
              <OIcon
                name="arrow-forward"
                size="xs"
                class="text-text-label self-center justify-self-center max-md:hidden"
                aria-hidden="true"
              />
              <OTime
                class="min-w-0"
                :class="{ '[&_input]:text-text-label': calendarPreviewDay && pendingDay }"
                size="sm"
                :aria-label="t('common.timeRangeEnd')"
                :prefix="endDayLabel"
                hide-icon
                format24
                revert-refused
                :error="unreadableFields.end || timeFieldError?.field === 'end'"
                hide-message
                :model-value="selectedTime.endTime"
                with-seconds
                optional-seconds
                data-test="datetime-end-time"
                @input="onTimeFieldTyping('end', $event)"
                @invalid="onTimeFieldInvalid('end', $event)"
                @update:model-value="onEndTimeEdit"
                @focus="timeFieldFocused = true"
                @blur="onTimeFieldBlur"
              />
            </div>
            <div v-else class="flex-1" />
            <OTooltip :content="needsStartDate ? t('dateTime.pickStartDate') : undefined">
              <OButton
                data-test="date-time-apply-btn"
                variant="primary"
                size="xs"
                class="shrink-0 px-3!"
                :disabled="applyDisabled"
                @click="applyAndClose"
              >
                {{ t("common.apply") }}
              </OButton>
            </OTooltip>
          </template>
          <template v-else>
            <OButton
              data-test="date-time-pick-dates-btn"
              variant="ghost"
              size="xs"
              icon-left="calendar-month"
              class="text-text-heading!"
              @click="openCalendar"
              >{{ t("dateTime.pickDates") }}</OButton
            >
            <div class="flex-1" />
            <template v-if="!hideRangeShift">
              <OTooltip shortcut-id="timeRangePrevious">
                <template #content>
                  <span class="flex flex-col">
                    <span>{{ stepTooltip.prev.title }}</span>
                    <span
                      v-if="stepTooltip.prev.window"
                      class="text-text-secondary text-xs tabular-nums"
                      >{{ stepTooltip.prev.window }}</span
                    >
                  </span>
                </template>
                <OButton
                  data-test="date-time-prev-btn-footer"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="chevron-left"
                  class="enabled:text-text-secondary! disabled:text-text-disabled!"
                  :aria-label="stepTooltip.prev.title"
                  :disabled="disable || disablePrevShift"
                  @click="shiftTimeRange('prev')"
                />
              </OTooltip>
              <OTooltip shortcut-id="timeRangeNext">
                <template #content>
                  <span class="flex flex-col">
                    <span>{{ stepTooltip.next.title }}</span>
                    <span
                      v-if="stepTooltip.next.window"
                      class="text-text-secondary text-xs tabular-nums"
                      >{{ stepTooltip.next.window }}</span
                    >
                  </span>
                </template>
                <OButton
                  data-test="date-time-next-btn-footer"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="chevron-right"
                  class="enabled:text-text-secondary! disabled:text-text-disabled!"
                  :aria-label="stepTooltip.next.title"
                  :disabled="disable || isNextShiftDisabled()"
                  @click="shiftTimeRange('next')"
                />
              </OTooltip>
              <OTooltip
                v-if="!hideRelativeTime"
                :content="stepTooltip.zoom"
                shortcut-id="timeRangeZoomOut"
              >
                <OButton
                  data-test="date-time-zoom-out-btn-footer"
                  variant="ghost"
                  size="icon-xs-sq"
                  icon-left="zoom-out"
                  class="enabled:text-text-secondary! disabled:text-text-disabled!"
                  :aria-label="stepTooltip.zoom"
                  :disabled="disable"
                  @click="zoomOut"
                />
              </OTooltip>
            </template>
          </template>
        </div>
        <div class="sr-only" aria-live="polite" data-test="date-time-live-region">
          {{ panelSpeech }}
        </div>
      </div>
    </OPopover>
    <OTooltip
      v-if="triggerTooltip"
      :anchor="triggerElement"
      :open="triggerTooltipOpen && !menuOpen"
      side="bottom"
    >
      <template #content>
        <span class="flex flex-col tabular-nums" data-test="date-time-trigger-tooltip">
          <span>{{ triggerTooltip.stamps }}</span>
          <span class="text-text-secondary text-xs">{{ triggerTooltip.detail }}</span>
        </span>
      </template>
    </OTooltip>
    <OTooltip v-if="!hideRangeShift" shortcut-id="timeRangeNext">
      <template #content>
        <span class="flex flex-col">
          <span>{{ stepTooltip.next.title }}</span>
          <span v-if="stepTooltip.next.window" class="text-text-secondary text-xs tabular-nums">{{
            stepTooltip.next.window
          }}</span>
        </span>
      </template>
      <OButton
        data-test="date-time-next-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! disabled:text-text-disabled! h-auto! rounded-none! border-s! max-md:hidden"
        icon-left="chevron-right"
        :aria-label="stepTooltip.next.title"
        :disabled="disable || isNextShiftDisabled()"
        @click.prevent.stop="shiftTimeRange('next')"
      />
    </OTooltip>
    <OTooltip
      v-if="!hideRangeShift && !hideRelativeTime"
      :content="stepTooltip.zoom"
      shortcut-id="timeRangeZoomOut"
    >
      <OButton
        data-test="date-time-zoom-out-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! disabled:text-text-disabled! h-auto! border-s! max-md:hidden"
        :class="showUndo ? 'rounded-none!' : 'rounded-s-none!'"
        icon-left="zoom-out"
        :aria-label="stepTooltip.zoom"
        :disabled="disable"
        @click.prevent.stop="zoomOut"
      />
    </OTooltip>
    <OTooltip v-if="showUndo" :content="undoTooltip" shortcut-id="timeRangeUndo">
      <OButton
        data-test="date-time-undo-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border enabled:hover:bg-interactive-hover-bg! h-auto! rounded-s-none! border-s!"
        icon-left="undo"
        :aria-label="undoTooltip"
        :disabled="disable"
        @click.prevent.stop="undoRange"
      />
    </OTooltip>
    <div class="sr-only" aria-live="polite" data-test="date-time-applied-live-region">
      {{ appliedSpeech }}
    </div>
  </div>
</template>

<script lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import { formatTypedTime, parseTypedTime } from "@/lib/forms/Time/parseTypedTime";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import DateTimeRangeList from "@/components/DateTimeRangeList.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import {
  ref,
  defineComponent,
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  useId,
  watch,
  nextTick,
  type PropType,
} from "vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import {
  getImageURL,
  useLocalTimezone,
  convertToUtcTimestamp,
  timestampToTimezoneDate,
} from "../utils/zincutils";
import { subtractRelativeTime } from "@/utils/date";
import {
  formatCalendarLabel,
  formatCalendarTooltip,
  formatRangeTooltip,
  parseCalendarToken,
  resolveCalendarPeriod,
  shiftCalendarToken,
} from "@/utils/dashboard/calendarPeriods";
import {
  CALENDAR_RAIL_ITEMS,
  PAST_PERIOD_KEYS,
  exceedsRangeRestriction,
  formatAbsoluteInstant,
  formatCivilDay,
  formatCivilDayPrefix,
  formatDurationMicros,
  formatRecentRangeLabel,
  formatPeriodLabel,
  formatZoneAbbreviation,
  formatZoneBadge,
} from "@/utils/timeRangeRail";
import useTimeRangeHistory, {
  isRelativeHistoryEntry,
  type TimeRangeHistoryEntry,
} from "@/composables/useTimeRangeHistory";
import useTimeRangePins from "@/composables/useTimeRangePins";
import {
  TIME_RANGE_CHIP_SETS,
  composeTimeRangeList,
  formatLimitShorthand,
  orderCalendarItems,
  TIME_INPUT_EXAMPLES,
  type TimeRangePreset,
  filterTimeRangeList,
  rangeLimitReason,
  retentionFloorMicros,
  stepListCursor,
  visibleRecentEntries,
  isOfferedElsewhere,
  type OfferedElsewhere,
  type TimeRangeListRow,
} from "@/utils/timeRangeList";
import { popUndoStep, pushUndoStep, type TimeRangeUndoStep } from "@/utils/timeRangeUndo";
import { instantFromShiftedMs } from "@/utils/timeRangeZoom";
import { useShortcuts } from "@/lib/vue-shortcut-manager/composables";
import { localeFileMap } from "@/locales";
import {
  formatRangeCopyText,
  formatRangeDates,
  formatRangeDuration,
  formatRangeLabel,
  formatRangeStamps,
  formatZoneOffset,
  namedFixedPeriod,
  type RangeLabelInput,
} from "@/utils/timeRangeLabel";
import {
  DEFAULT_ANCHOR_WINDOW,
  anchorRows,
  anchorWindowLabel,
  readingAnchorMicros,
  type AnchorRow,
} from "@/utils/timeRangeAnchor";
import { formatReadingNote, readingNote } from "@/utils/timeRangeNotes";
import { reportParseFailure } from "@/utils/timeInputFailure";
import { weekStartsOn } from "@/utils/weekStart";
import { readSearchAroundChoice, searchAroundAnchorId } from "@/utils/searchAroundWindow";
import type { DateRangeCalendarExposed } from "@/lib/forms/DateTimeRange/ODateRangeCalendar.types";
import {
  SINGLE_WINDOW_MICROS,
  capRollingPeriod,
  explainTimeInputFailure,
  resolveZonedCivil,
  parseRollingPeriod,
  parseTimeInput,
  suggestTimeInput,
  type AbsoluteRangeResult,
  type ParsedTimeInput,
} from "@/utils/dateTimeRangeParse";
import { formatTimeInputText } from "@/utils/timeInputText";
import { copyToClipboard } from "@/utils/clipboard";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import { fromZonedTime } from "date-fns-tz";

const MICROS_PER_SECOND = 1_000_000;
const MICROS_PER_MINUTE = 60 * MICROS_PER_SECOND;
const MICROS_PER_HOUR = 60 * MICROS_PER_MINUTE;
const POPOVER_COLLISION_PADDING = { top: 48, right: 8, bottom: 8, left: 8 };
// Seconds each unit nominally spans, months at their longest; a DST day can still run 25h, so typed periods also check the real span.
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  M: 2_678_400,
};
// Units of a fixed length, largest first; weeks and months keep their own unit when zoomed.
const EXACT_UNIT_SECONDS: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };
// Largest custom relative range per unit (~10 years), so a typo can't produce an absurd or overflowing range.
const MAX_CUSTOM_RELATIVE_VALUE: Record<string, number> = {
  s: 315_360_000,
  m: 5_256_000,
  h: 87_600,
  d: 3_650,
  w: 520,
  M: 120,
};

// Typed text is read this long after the last keystroke, so the preview does not flicker per key.
const INPUT_READ_DELAY_MS = 100;
const MAX_SUGGESTIONS = 5;

// What Enter would do with a reading, worked out once so the preview and Enter never disagree.
type InputPlan =
  | { kind: "rolling"; unit: string; value: number; startTime: number; endTime: number }
  | { kind: "calendar"; token: string }
  | { kind: "absolute"; start: number; end: number; calendarPeriod: string | null }
  | { kind: "refused"; message: I18nText }
  | { kind: "restricted"; message: I18nText };

interface SummaryLine {
  name: string;
  range: string;
  duration: string;
  live?: boolean;
  fixed?: boolean;
  note?: string;
  /** The note warns (over a limit), so it takes the warning colour. */
  warning?: boolean;
  ready?: boolean;
}

interface TimeInputSuggestionRow {
  key: string;
  label: string;
  hint: string;
  relative: boolean;
}

// What a typed-text row stands for beyond its reading: a window around a pasted instant, or the longest range a limit allows.
type SuggestionTag = { anchor: AnchorRow["id"] } | { longestAllowed: true } | null;

interface ConsumableDateTime {
  startTime: number;
  endTime: number;
  relativeTimePeriod: string | null;
  selectedDate?: unknown;
  selectedTime?: unknown;
  valueType?: string;
  userChangedValue?: boolean;
}

// One offset lookup per zone for the whole app, renewed each quarter hour as DST moves offsets on those bounds.
const zoneOffsets = { quarterHour: -1, byZone: new Map<string, string>() };
// Toolbar pickers on screen, oldest first; the oldest holds the key bindings and the newest acts on them.
const shortcutPickers = ref<{ token: symbol; act: Record<string, () => void> }[]>([]);

const civilDayMs = (date: string): number => Date.parse(`${date.replace(/\//g, "-")}T00:00:00Z`);

const addCivilDays = (date: string, days: number): string =>
  new Date(civilDayMs(date) + days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "/");

export default defineComponent({
  components: {
    OButton,
    OIcon,
    OTooltip,
    OTruncatedText,
    OInput,
    OSelect,
    OTime,
    ODateRangeCalendar,
    OPopover,
    DateTimeRangeList,
    OBadge,
    OShortcut,
    OToggleGroup,
    OToggleGroupItem,
  },
  props: {
    defaultType: {
      type: String,
      default: "relative",
    },
    defaultAbsoluteTime: {
      type: Object,
      default: null,
    },
    defaultRelativeTime: {
      type: String,
      default: "15m",
    },
    autoApply: {
      type: Boolean,
      default: false,
    },
    applyPresets: {
      type: Boolean,
      default: false,
    },
    initialTimezone: {
      type: String as PropType<string | null>,
      required: false,
      default: null,
    },
    disable: {
      type: Boolean,
      default: false,
    },
    queryRangeRestrictionMsg: {
      type: String,
      default: "",
    },
    queryRangeRestrictionInHour: {
      type: Number,
      default: 0,
    },
    dataTestName: {
      type: String,
      default: "date-time-btn",
    },
    disableRelative: {
      type: Boolean,
      default: false,
    },
    hideRelativeTime: {
      type: Boolean,
      default: false,
    },
    hideRelativeTimezone: {
      type: Boolean,
      default: false,
    },
    /** Starts the picker on this IANA zone and keeps zone changes local to it instead of writing the app's timezone. */
    pickerTimezone: {
      type: String,
      default: "",
    },
    /** Drops the paste box and the copy and paste buttons; a date-only picker then loses its whole top row. */
    hideClipboard: {
      type: Boolean,
      default: false,
    },
    hideRangeShift: {
      type: Boolean,
      default: false,
    },
    /** Turns off the ‹ shift, for a parent that knows there is nothing earlier to show. */
    disablePrevShift: {
      type: Boolean,
      default: false,
    },
    minDate: {
      type: String,
      default: null,
    },
    /** The last pickable calendar day (yyyy/MM/dd); absent means today, for a caller that schedules ahead. */
    maxDate: {
      type: String,
      default: null,
    },
    menuAlign: {
      type: String as PropType<"center" | "start" | "end">,
      default: "end",
    },
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "outline",
    },
    /** Offers Today … Last year; off where the backend only parses rolling `<n><unit>` periods. */
    calendarPresets: {
      type: Boolean,
      default: false,
    },
    /** Sizes the trigger like a form field (full width, field height and border) instead of a toolbar button. */
    fieldAppearance: {
      type: Boolean,
      default: false,
    },
    /** Opens the picker as soon as it mounts, for a range the user just asked to add. */
    defaultOpen: {
      type: Boolean,
      default: false,
    },
    /** Drops the relative Seconds unit, for a caller that accepts only whole minutes. */
    hideSeconds: {
      type: Boolean,
      default: false,
    },
    /** Replaces the trigger's range text, for a caller that states the range on its own clock; empty keeps the picker's. */
    triggerText: {
      type: String,
      default: "",
    },
    /** Days of data the page keeps; rows, chips and dates wholly before it are greyed. Unset greys nothing. */
    retentionDays: {
      type: Number as PropType<number | null>,
      default: null,
    },
    /** Binds the global time-range keys (T [ ] - Z); only a page's own toolbar picker sets it, never a panel's. */
    shortcuts: {
      type: Boolean,
      default: false,
    },
    /** Offers undo after a zoom, shift, brush or zoom-out; pickers without range shift never show it. */
    undoable: {
      type: Boolean,
      default: true,
    },
    /** Chip set and calendar row order; dashboards lead with long ranges and show dates on the trigger. */
    preset: {
      type: String as PropType<TimeRangePreset>,
      default: "ops",
    },
    /** Live ranges show their dates after the name on the trigger; null follows the preset. */
    showDates: {
      type: Boolean as PropType<boolean | null>,
      default: null,
    },
    /** "always" shows the zone offset on the trigger even when it is the browser's. */
    zoneBadge: {
      type: String as PropType<"auto" | "always">,
      default: "auto",
    },
    /** The window a query's own `_timestamp` filter keeps inside the picked range, if any. */
    narrowedByQuery: {
      type: Object as PropType<{ startUs: number; endUs: number } | null>,
      default: null,
    },
  },

  emits: ["on:date-change", "on:timezone-change", "hide", "show", "on:undo"],

  setup(props, { emit }) {
    const store = useStore();
    const pickerZone = ref(props.pickerTimezone);
    const zone = computed<string>(() =>
      props.pickerTimezone ? pickerZone.value : store.state.timezone,
    );
    const { t, locale } = useI18nTyped();
    const selectedType = ref("relative");
    const selectedTime = ref({
      startTime: "00:00:00",
      endTime: "23:59:59",
    });
    const selectedDate = ref({
      from: "",
      to: "",
    });
    const relativePeriod = ref("m");
    const relativeValue = ref(15);
    // A selected calendar period overrides relativePeriod/relativeValue while the type is relative.
    const calendarToken = ref<string | null>(null);
    const appliedCalendarToken = ref<string | null>(null);
    // Type and relative selection last applied; closing without Apply restores these.
    let appliedSelection = {
      selectedType: "relative",
      calendarToken: null as string | null,
      relativePeriod: "m",
      relativeValue: 15,
    };
    // Offset-0 tooltips end at now, so they read a clock refreshed on hover rather than a stale render time.
    const tooltipNow = ref(Date.now());
    const timeRangeHistory = useTimeRangeHistory();
    // A single clicked day the range calendar is still waiting to pair with an end date.
    const pendingDay = ref<string | null>(null);
    // The day a second calendar pick would end on, under the pointer or focus.
    const calendarPreviewDay = ref<string | null>(null);
    const calendarRef = ref<DateRangeCalendarExposed | null>(null);
    // The End time a picked day not over yet replaced with now, restored if another day is picked instead.
    let endBeforeCut: string | null = null;
    // The Start/End fields as the panel opened, restored when it closes with nothing applied, since showing a relative pick overwrites it.
    let absoluteAtOpen: {
      date: { from: string; to: string };
      time: { startTime: string; endTime: string };
      seededEnd: { date: string; time: string } | null;
    } | null = null;
    let appliedSinceOpen = false;
    const inputText = ref("");
    const inputError = ref(false);
    // Why readable text was refused, shown instead of the generic unreadable message.
    const inputRefusal = ref<I18nText | null>(null);
    // A stamped range with its end not after its start reads as nothing, so the summary row says why.
    const inputReversed = ref(false);
    const inputErrorText = computed(() => inputRefusal.value ?? t("common.timeRangeInputError"));
    const inputAsUtc = ref(false);
    // Text typed into Start or End commits on change, so the clock must not reseed a field still being typed in.
    const timeFieldFocused = ref(false);
    // The panel aligns to the whole ‹ trigger › group, not the trigger alone.
    const groupEl = ref<HTMLElement | null>(null);
    // The Start or End field whose last edit was refused, and why.
    const timeFieldError = ref<{ field: "start" | "end"; message: I18nText } | null>(null);
    // Set only by each field's own @invalid, so an edit to the other field cannot unblock Apply.
    const unreadableFields = ref({ start: false, end: false });
    // A readable time still being typed in Start or End, previewed in the summary before the field commits it.
    const typedFieldTime = ref<{ field: "start" | "end"; time: string; ms: boolean } | null>(null);
    // The bar's current reading and its alternatives; nothing applies until Enter or a pick.
    const inputReading = ref<ParsedTimeInput | null>(null);
    const inputSuggestions = ref<ParsedTimeInput[]>([]);
    const suggestionTags = ref<SuggestionTag[]>([]);
    // The one row shown is the bar's own reading, not a list of alternatives.
    const readingOnly = ref(false);
    const activeSuggestion = ref(0);
    const suggestionsDismissed = ref(false);
    const inputBar = ref<{ focus: () => void } | null>(null);
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    // Reactive twin of readTimer, so the examples wait until the typed text has been read.
    const readPending = ref(false);
    // A paste replaces the bar's text only when Enter or a paste last read exactly that text.
    let lastReadText = "";
    // Fields written by the picker itself (seeding Start/End, a Recent pick) are not user edits for auto-apply.
    let isSeedingAbsolute = false;
    let seededEnd: { date: string; time: string } | null = null;
    // Civil fields hold a DST fall-back's repeated hour only once, so an applied instant they cannot show is kept while they stay as written.
    let heldInstants: { key: string; startUTC: number; endUTC: number } | null = null;
    // The one way the picker writes its own Absolute fields; an omitted shown end keeps the current one.
    const writeSeededFields = (
      fields: { from: string; to: string; startTime?: string; endTime?: string },
      shownEnd?: { date: string; time: string } | null,
    ) => {
      isSeedingAbsolute = true;
      selectedDate.value.from = fields.from;
      selectedDate.value.to = fields.to;
      if (fields.startTime !== undefined) selectedTime.value.startTime = fields.startTime;
      if (fields.endTime !== undefined) selectedTime.value.endTime = fields.endTime;
      if (shownEnd !== undefined) seededEnd = shownEnd;
      nextTick(() => {
        isSeedingAbsolute = false;
      });
    };
    // Date-only pickers cannot show the times a recent range carries.
    const showRail = computed(() => !props.disableRelative);
    const lastValidCustomValue = ref(15);
    const currentTimezone = useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = ref(props.pickerTimezone || currentTimezone);
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => {
      return tz;
    });
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserTime = raw("Browser Time (" + browserTz + ")");

    // Add the UTC option
    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);
    if (props.pickerTimezone && !timezoneOptions.includes(props.pickerTimezone)) {
      timezoneOptions.unshift(props.pickerTimezone);
    }

    // A fixed range keeps its instants across a zone change and is only redrawn; live ones re-resolve.
    const onTimezoneChange = async () => {
      const fixed = selectedType.value === "absolute" ? getUTCTimeStamp() : null;
      let selectedTimezone = timezone.value;
      if (selectedTimezone.toLowerCase() == browserTime.toLowerCase()) {
        selectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      if (props.pickerTimezone) {
        pickerZone.value = selectedTimezone;
      } else {
        useLocalTimezone(selectedTimezone);
        store.dispatch("setTimezone", selectedTimezone);
      }
      await nextTick();
      // A pending live pick still closes back to the applied fixed range, so its fields redraw too.
      redrawAbsoluteAtOpen();
      if (fixed) {
        heldInstants = null;
        writeAbsoluteFields(fixed.startUTC, fixed.endUTC);
        holdUnshownInstants(fixed.startUTC, fixed.endUTC);
        // After the flush in which the redrawn fields settle, or the selection watcher clears it.
        nextTick(() => (zoneRedrawn.value = true));
      } else if (props.autoApply) {
        // Read after the await: a linked fixed range is only set once the picker mounts.
        saveDate(selectedType.value);
      }

      emit("on:timezone-change", selectedTimezone);
    };

    // if initial timezone is provided
    if (props.initialTimezone) {
      // check if it is a valid timezone
      // ignore case
      timezone.value =
        timezoneOptions.find((tz) => tz.toLowerCase() === props.initialTimezone?.toLowerCase()) ||
        currentTimezone;

      // call onTimezoneChange to set the timezone in the store
      onTimezoneChange();
    }

    const filteredTimezone: any = ref(timezoneOptions);
    const isTimezoneSelectOpen = ref(false);

    // longOffset throws on engines that lack it, so the label falls back to no offset.
    const zoneOffset = (zone: string, atMs: number): string => {
      const quarterHour = Math.floor(atMs / 900_000);
      if (quarterHour !== zoneOffsets.quarterHour) {
        zoneOffsets.quarterHour = quarterHour;
        zoneOffsets.byZone.clear();
      }
      const cached = zoneOffsets.byZone.get(zone);
      if (cached !== undefined) return cached;
      let offset = "";
      try {
        const name = new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          timeZoneName: "longOffset",
        })
          .formatToParts(new Date(atMs))
          .find((part) => part.type === "timeZoneName")?.value;
        offset = name?.replace("GMT", "") || "+00:00";
      } catch {
        offset = "";
      }
      zoneOffsets.byZone.set(zone, offset);
      return offset;
    };

    const timezoneSelectOptions = computed(() =>
      timezoneOptions.map((tz: string) => {
        const isBrowser = tz === browserTime;
        const zone = isBrowser ? browserTz : tz;
        const offset = zoneOffset(zone, tooltipNow.value);
        const suffix = offset ? raw(`UTC${offset}`) : undefined;
        if (isBrowser) {
          return { label: t("common.browserTimeWithZone", { zone: browserTz }), suffix, value: tz };
        }
        if (tz === "UTC") return { label: raw(tz), suffix, value: tz };
        // The label is the name alone, so `utc` matches zone names, not every `UTC+…` offset.
        return { label: raw(tz), suffix, value: tz, searchText: offset };
      }),
    );

    let relativePeriods = [
      { label: t("common.seconds"), value: "s" },
      { label: t("common.minutes"), value: "m" },
      { label: t("common.hours"), value: "h" },
      { label: t("common.days"), value: "d" },
      { label: t("common.weeks"), value: "w" },
      { label: t("common.months"), value: "M" },
    ].filter((period) => !props.hideSeconds || period.value !== "s");

    const inputErrorId = useId();
    const listId = useId();

    let relativePeriodsMaxValue = ref<Record<string, number>>({
      s: 0,
      m: 0,
      h: 0,
      d: 0,
      w: 0,
      M: 0,
    });

    const intlLocale = computed(() => localeFileMap[String(locale.value)] ?? "en-US");

    const refreshTooltipNow = () => {
      tooltipNow.value = Date.now();
    };

    const calendarTooltip = (token: string | null) =>
      token === null
        ? undefined
        : (formatCalendarTooltip(token, zone.value, tooltipNow.value) ?? undefined);

    const calendarExceedsRestriction = (token: string | null) => {
      const range = resolveCalendarPeriod(token, zone.value, tooltipNow.value);
      return (
        !!range &&
        exceedsRangeRestriction(range.startTime, range.endTime, props.queryRangeRestrictionInHour)
      );
    };

    const timeRangePins = useTimeRangePins();
    // Index into the list rows below the suggestions; -1 while the cursor is in the bar.
    const listCursor = ref(-1);
    const calendarMode = ref(false);
    const editingPinRowId = ref<string | null>(null);
    // The rolling period in force, so the one chip equal to it is the only control lit for it (D1).
    const appliedPeriod = ref<string | null>(null);

    const rangeLimits = computed(() => ({
      retentionFloorUs: retentionFloorMicros(props.retentionDays, tooltipNow.value),
      maxHours: props.queryRangeRestrictionInHour,
    }));

    const limitReason = (startUs: number, endUs: number): string | null =>
      rangeLimitReason(startUs, endUs, rangeLimits.value, {
        retention: String(t("dateTime.outsideRetention", { days: props.retentionDays ?? 0 })),
        restriction: String(maxLimitText()),
      });

    // Rows the picker could not apply as stored are left out: out-of-bounds ranges, over-cap periods, and calendar tokens where calendar presets are off.
    const isUsableRecentEntry = (entry: TimeRangeHistoryEntry) => {
      if (!isRelativeHistoryEntry(entry)) return boundedRange(entry.startUs, entry.endUs) !== null;
      if (boundedPeriod(entry.relative) !== entry.relative) return false;
      return props.calendarPresets || parseCalendarToken(entry.relative) === null;
    };

    const entryRange = (entry: TimeRangeHistoryEntry) =>
      isRelativeHistoryEntry(entry)
        ? resolveRelativePeriod(entry.relative, tooltipNow.value)
        : { startTime: entry.startUs, endTime: entry.endUs };

    const labelOptions = () => ({
      timezone: zone.value,
      locale: intlLocale.value,
      nowMs: tooltipNow.value,
    });

    const entryLabel = (entry: TimeRangeHistoryEntry): string =>
      isRelativeHistoryEntry(entry)
        ? String(relativeLabel(entry.relative))
        : formatRangeLabel(
            { startUs: entry.startUs, endUs: entry.endUs },
            { ...labelOptions(), surface: "row" },
          );

    const entryRow = (
      entry: TimeRangeHistoryEntry,
      base: Pick<TimeRangeListRow, "id" | "kind" | "testId" | "label" | "meta">,
    ): TimeRangeListRow => {
      const range = entryRange(entry);
      const reason = range ? limitReason(range.startTime, range.endTime) : null;
      const tooltip = isRelativeHistoryEntry(entry)
        ? calendarTooltip(parseCalendarToken(entry.relative) ? entry.relative : null)
        : formatRangeTooltip(entry.startUs, entry.endUs, zone.value);
      return {
        ...base,
        meta: reason ?? base.meta,
        reason: reason !== null,
        tooltip: reason ?? (tooltip ? String(tooltip) : undefined),
        disabled: reason !== null,
        period: isRelativeHistoryEntry(entry) ? entry.relative : undefined,
      };
    };

    // A live entry shows where it resolves now; a fixed one its length.
    const entryDuration = (entry: TimeRangeHistoryEntry) => {
      if (!isRelativeHistoryEntry(entry)) return formatRangeDuration(entry.startUs, entry.endUs);
      const range = resolveRelativePeriod(entry.relative, tooltipNow.value);
      if (!range) return "";
      return parseCalendarToken(entry.relative)
        ? calendarMeta(entry.relative, range)
        : String(t("common.timeRangeUntilNow", { start: formatShownInstant(range.startTime) }));
    };

    // The applied range is already the summary, so Recent never repeats it.
    const currentEntry = computed<TimeRangeHistoryEntry | null>(() => {
      if (selectedType.value === "relative") return { relative: currentRelativePeriod() };
      const range = pendingRange.value;
      return range ? { startUs: range.startTime, endUs: range.endTime } : null;
    });

    const pinnedRows = computed<TimeRangeListRow[]>(() => {
      if (!showRail.value) return [];
      return timeRangePins.pins.value.flatMap((pin) => {
        if (!isUsableRecentEntry(pin.range)) return [];
        const label = entryLabel(pin.range);
        return [
          entryRow(pin.range, {
            id: `pinned-${pin.id}`,
            kind: "pinned",
            testId: `date-time-list-pinned-${pin.id}`,
            label: pin.name || label,
            meta: pin.name ? label : entryDuration(pin.range),
          }),
        ];
      });
    });

    const offeredElsewhere = computed<OfferedElsewhere>(() => ({
      pinned: timeRangePins.pins.value.map((pin) => pin.range),
      chips: showChips.value ? chipSet.value.map((chip) => chip.value) : [],
      calendarTokens: calendarRows.value.flatMap((row) => (row.period ? [row.period] : [])),
    }));

    const recentRows = computed<TimeRangeListRow[]>(() => {
      if (!showRail.value) return [];
      const entries = timeRangeHistory.entries.value;
      const shown = visibleRecentEntries(entries, {
        ...offeredElsewhere.value,
        applied: currentEntry.value,
      });
      return entries.flatMap((entry, index) => {
        if (!shown.includes(entry) || !isUsableRecentEntry(entry)) return [];
        return [
          entryRow(entry, {
            id: `recent-${index}`,
            kind: "recent",
            testId: `date-time-list-recent-${index}`,
            label: entryLabel(entry),
            meta: entryDuration(entry),
          }),
        ];
      });
    });

    // "Nov 11, 00:00 – now" for today, "Nov 8 – now" for a period so far, "Nov 1 – 7" for a finished one.
    const calendarMeta = (token: string, range: { startTime: number; endTime: number }) => {
      const period = parseCalendarToken(token);
      if (period?.offset !== 0) {
        return formatRangeDates(
          { startUs: range.startTime, endUs: range.endTime, calendar: true },
          labelOptions(),
        );
      }
      const day = convertUnixTime(range.startTime).date;
      const start =
        period.unit === "day"
          ? `${dayLabel(day)} 00:00`
          : formatCivilDay(day, zone.value, tooltipNow.value, intlLocale.value);
      return String(t("common.timeRangeUntilNow", { start }));
    };

    const calendarRows = computed<TimeRangeListRow[]>(() => {
      if (!props.calendarPresets || props.disableRelative) return [];
      return orderCalendarItems(CALENDAR_RAIL_ITEMS, props.preset).flatMap((preset) => {
        const range = resolveCalendarPeriod(preset.token, zone.value, tooltipNow.value);
        if (!range) return [];
        const reason = limitReason(range.startTime, range.endTime);
        const tooltip = calendarTooltip(preset.token);
        return [
          {
            id: `calendar-${preset.id}`,
            kind: "calendar" as const,
            label: String(t(preset.labelKey)),
            meta: reason ?? calendarMeta(preset.token, range),
            reason: reason !== null,
            tooltip: reason ?? (tooltip ? String(tooltip) : undefined),
            disabled: reason !== null,
            testId: `date-time-list-calendar-${preset.id}`,
            period: preset.token,
          },
        ];
      });
    });

    const defaultRows = computed(() =>
      composeTimeRangeList([pinnedRows.value, recentRows.value, calendarRows.value]),
    );

    // Chips and rolling suggestions are periods, which a day-only or dates-only picker cannot apply.
    const showChips = computed(() => !props.disableRelative && !props.hideRelativeTime);

    const chipSet = computed(() => TIME_RANGE_CHIP_SETS[props.preset] ?? TIME_RANGE_CHIP_SETS.ops);

    const chipItems = computed(() =>
      chipSet.value.map(({ value, label }) => {
        const range = resolveRelativePeriod(value, tooltipNow.value);
        const reason = range ? limitReason(range.startTime, range.endTime) : null;
        return { value, label, title: relativeLabel(value), disabled: reason !== null, reason };
      }),
    );

    const litChip = computed(() =>
      chipSet.value.some((chip) => chip.value === appliedPeriod.value) ? appliedPeriod.value : null,
    );

    const maxLimitText = (): I18nText =>
      t("dateTime.maxLimit", {
        limit: formatLimitShorthand(props.queryRangeRestrictionInHour),
      });

    // Notes at the strip's end: the page limit when it greys chips, and the query's narrowing (P4), short when both show.
    const chipsNotes = computed(() => {
      const notes: { icon: string; text: string; tooltip: I18nText; testId: string }[] = [];
      if (chipItems.value.some((chip) => chip.disabled) && props.queryRangeRestrictionInHour > 0) {
        notes.push({
          icon: "lock",
          text: String(maxLimitText()),
          tooltip: restrictionMessage(),
          testId: "date-time-chips-note-limit",
        });
      }
      const narrowed = props.narrowedByQuery;
      if (!narrowed || !(narrowed.endUs > narrowed.startUs)) return notes;
      const range = formatRangeLabel(
        { startUs: narrowed.startUs, endUs: narrowed.endUs },
        { ...labelOptions(), surface: "row" },
      );
      notes.push({
        icon: "filter-alt",
        text: String(t(notes.length > 0 ? "dateTime.narrowed" : "dateTime.narrowedByQuery")),
        tooltip: t("dateTime.queryKeeps", { range }),
        testId: "date-time-chips-note-narrowed",
      });
      return notes;
    });

    const periodUnits = ["s", "m", "h", "d", "w", "M"];

    const datetimeBtn = ref<unknown>(null);

    const displayValue = ref("");

    /**
     * The label as of the last APPLY, which is what the trigger button shows.
     * With `autoApply` off, a selection only takes effect when the user presses
     * Apply, so the trigger renders the range actually in force rather than the
     * pending selection in `getDisplayValue`. Every path that applies a range
     * stamps it via `markApplied`.
     */
    const appliedDisplayValue = ref("");
    // The applied type and absolute range, so the closed trigger can label them compactly.
    const appliedType = ref("relative");
    const appliedRange = ref<{ startTime: number; endTime: number } | null>(null);

    const datePayload = ref({});
    // True while this picker's own change is being emitted, so a page answering it in the handler is not a new range.
    let emittingOwnChange = false;

    const dateLocale = {
      daysShort: ["S", "M", "T", "W", "T", "F", "S"],
    };

    const calendarMinDate = computed(() => {
      if (props.disableRelative && props.minDate) return props.minDate;
      return "1999/01/01";
    });

    const calendarMaxDate = computed(() => {
      if (props.maxDate) return props.maxDate;
      return timestampToTimezoneDate(new Date().getTime(), zone.value, "yyyy/MM/dd");
    });

    onMounted(() => {
      // updateDisplayValue();
      try {
        resetTime("", "");

        let startTime = (new Date().getTime() - 900000) * 1000;
        let endTime = new Date().getTime() * 1000;

        if (props.defaultAbsoluteTime?.startTime) {
          startTime =
            props.defaultAbsoluteTime?.startTime.toString().length > 13
              ? props.defaultAbsoluteTime?.startTime
              : props.defaultAbsoluteTime?.startTime * 1000;
        }

        if (props.defaultAbsoluteTime?.endTime) {
          endTime =
            props.defaultAbsoluteTime?.endTime.toString().length > 13
              ? props.defaultAbsoluteTime?.endTime
              : props.defaultAbsoluteTime?.endTime * 1000;
        }

        const initialType = props.disableRelative ? "absolute" : props.defaultType;
        selectedType.value = initialType;

        markProgrammaticDateChange();
        const rangeKept = writeOutsideRange(startTime, endTime) !== "refused";
        const periodKept = readRelativeTime(props.defaultRelativeTime) !== "refused";
        if (initialType === "absolute" ? !rangeKept : !periodKept) fallBackToDefaultPeriod();

        if (props.queryRangeRestrictionInHour) computeRelativePeriod();
        // Stamped programmatic, so consumers skip a refetch; the parent's own onMounted covers the first load.
        saveDate(selectedType.value);
      } catch (e) {
        console.log(e);
      }
    });

    watch(
      () => {
        selectedTime.value.startTime;
        selectedTime.value.endTime;
        selectedDate.value?.from;
        selectedDate.value?.to;
        pendingDay.value;
      },
      () => {
        if (
          props.autoApply &&
          selectedType.value === "absolute" &&
          !isSeedingAbsolute &&
          pendingDay.value === null &&
          store.state.savedViewFlag == false
        ) {
          saveDate("absolute");
        }
      },
      { deep: true },
    );

    watch(
      () => props.defaultType,
      () => {
        if (props.defaultType !== selectedType.value) {
          selectedType.value = props.defaultType;
        }
      },
    );

    const setRelativeDate = (
      period: string,
      value: number,
      commit: boolean = props.autoApply || props.applyPresets,
    ) => {
      refreshTooltipNow();
      selectedType.value = "relative";
      calendarToken.value = null;
      pendingDay.value = null;
      relativePeriod.value = period;
      relativeValue.value = value;
      if (commit) saveDate("relative");
    };

    const isValidCustomValue = (value: unknown) =>
      value !== "" && value !== null && Number.isFinite(Number(value));

    // A finished calendar period ends at the next one's start; second-precision fields show its last second, as its tooltip does.
    const lastInstant = (token: string | null, endUs: number) =>
      (parseCalendarToken(token)?.offset ?? 0) < 0 ? endUs - 1 : endUs;

    // The shown 23:59:59 of a copied calendar end stands for the next period's start until the user edits it.
    const rememberShownEnd = (exclusiveEndUs: number) => {
      const shown = convertUnixTime(exclusiveEndUs - 1);
      seededEnd = { date: shown.date, time: shown.time };
    };
    const rememberSeededEnd = (token: string | null, endUs: number) => {
      if ((parseCalendarToken(token)?.offset ?? 0) >= 0) seededEnd = null;
      else rememberShownEnd(endUs);
    };

    // A period from outside the picker, capped as Custom is and to the calendar's first day; null when it is not a whole-count period.
    const boundedPeriod = (period: string): string | null => {
      if (resolveCalendarPeriod(period, zone.value)) return period;
      const rolling = parseRollingPeriod(period);
      if (!rolling || !periodUnits.includes(rolling.unit)) return null;
      const { unit } = rolling;
      const nowMs = Date.now();
      const floorUs = convertToUtcTimestamp(`${calendarMinDate.value} 00:00:00`, zone.value);
      const reach = Math.floor((nowMs * 1000 - floorUs) / (UNIT_SECONDS[unit] * MICROS_PER_SECOND));
      let count = Math.min(rolling.value, MAX_CUSTOM_RELATIVE_VALUE[unit], reach);
      // A 25h DST day can still overshoot the nominal reach by one.
      while (count > 1 && rollingRange(count, unit, nowMs).startTime < floorUs) count -= 1;
      if (count < 1) return null;
      if (count === rolling.value) return period;
      const [cappedUnit, cappedCount] = largestExactUnit(unit, count);
      return `${cappedCount}${cappedUnit}`;
    };

    // "corrected" and "refused" tell a caller from outside that the range in force is not the one it asked for.
    const readRelativeTime = (period: unknown): "kept" | "corrected" | "refused" => {
      const text = typeof period === "string" ? period.trim() : "";
      if (!text) return "kept";
      const bounded = boundedPeriod(text);
      if (bounded === null) return "refused";
      const calendarRange = resolveCalendarPeriod(bounded, zone.value);
      if (calendarRange && props.calendarPresets) {
        calendarToken.value = bounded;
        return "kept";
      }
      if (calendarRange) {
        // A stale token beside an applied absolute range is not the range in force, so it must not replace it.
        if (selectedType.value !== "relative") return "kept";
        // A picker without calendar presets keeps a shared calendar range as its dates instead of dropping it.
        selectedType.value = "absolute";
        calendarToken.value = null;
        markProgrammaticDateChange();
        writeOutsideRange(calendarRange.startTime, calendarRange.endTime);
        return "kept";
      }
      const rolling = parseRollingPeriod(bounded);
      if (rolling) {
        calendarToken.value = null;
        relativePeriod.value = rolling.unit;
        relativeValue.value = rolling.value;
      }
      if (bounded === text) return "kept";
      // A silently shortened range would read as the one the link asked for.
      toast({
        variant: "warning",
        message: t("common.timeRangeShortened", { label: relativeLabel(bounded) }),
      });
      return "corrected";
    };

    const setRelativeTime = (period: string) => {
      clearUndoForPageRange({ relativeTimePeriod: period });
      const outcome = readRelativeTime(period);
      if (outcome === "kept") return;
      markProgrammaticDateChange();
      if (outcome === "refused") fallBackToDefaultPeriod();
      else if (!props.disableRelative) selectedType.value = "relative";
      emitCorrectionLater();
    };

    const resetTime = (startTime: string, endTime: string) => {
      if (!startTime || !endTime) {
        var dateString = new Date().toLocaleDateString("en-ZA");

        if (!selectedDate.value.from) selectedDate.value.from = dateString;

        if (!selectedDate.value.to) selectedDate.value.to = dateString;

        if (!startTime) selectedTime.value.startTime = "00:00:00";

        if (!endTime) {
          const endDateTime = convertUnixTime(new Date().getTime() * 1000);

          // If the selected date is today, set the end time to the current time
          if (selectedDate.value.to === endDateTime.date) {
            selectedTime.value.endTime = endDateTime.time;
          } else selectedTime.value.endTime = "23:59:59";
        }

        return;
      }
      return;
    };

    // A stored Recent range the calendar can show, with an end past the ceiling cut to it; null when it cannot.
    const boundedRange = (
      startUs: number,
      endUs: number,
    ): { start: number; end: number } | null => {
      if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) return null;
      if (startBoundError(startUs) !== null) return null;
      return { start: startUs, end: Math.min(endUs, selectionCeilingMicros()) };
    };

    // A parent's range is trusted as given, ahead of the browser clock too; only an explicit maxDate bounds it.
    const trustedRange = (
      startUs: number,
      endUs: number,
    ): { start: number; end: number } | null => {
      if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) return null;
      if (!props.maxDate) return { start: startUs, end: endUs };
      const ceiling = forwardCeilingMicros();
      return startUs < ceiling ? { start: startUs, end: Math.min(endUs, ceiling) } : null;
    };

    // "refused" when nothing was written, "corrected" when the end was cut to maxDate.
    const writeOutsideRange = (
      startTime: number,
      endTime: number,
    ): "kept" | "corrected" | "refused" => {
      seededEnd = null;
      if (!startTime || !endTime) {
        var dateString = new Date().toLocaleDateString("en-ZA");
        selectedDate.value.from = dateString;
        selectedDate.value.to = dateString;
        return "kept";
      }
      const range = trustedRange(Number(startTime), Number(endTime));
      if (!range) return "refused";

      const startDateTime = convertUnixTime(range.start);
      const endDateTime = convertUnixTime(shownEndMicros(range.start, range.end));

      selectedDate.value.from = startDateTime.date;
      selectedDate.value.to = endDateTime.date;

      selectedTime.value.startTime = startDateTime.time;
      selectedTime.value.endTime = endDateTime.time;
      heldInstants = null;
      holdUnshownInstants(range.start, range.end);
      return range.end === Number(endTime) ? "kept" : "corrected";
    };

    // A range the picker cannot show must never reach a query, so the picker says so and shows the default 15 minutes.
    const fallBackToDefaultPeriod = () => {
      toast({ variant: "warning", message: t("common.timeRangeOutOfBounds") });
      const nowUs = Date.now() * 1000;
      writeAbsoluteFields(nowUs - 15 * MICROS_PER_MINUTE, nowUs);
      calendarToken.value = null;
      relativePeriod.value = "m";
      relativeValue.value = 15;
      lastValidCustomValue.value = 15;
      selectedType.value = props.disableRelative ? "absolute" : "relative";
    };

    const setAbsoluteTime = (startTime: number, endTime: number) => {
      // Parent-invoked setter — the resulting auto-apply emit is programmatic.
      markProgrammaticDateChange();
      clearUndoForPageRange({ startTime, endTime });
      const outcome = writeOutsideRange(startTime, endTime);
      if (outcome === "refused") fallBackToDefaultPeriod();
      // A parent's range set while the panel is open is what closing without Apply returns to.
      if (menuOpen.value && absoluteAtOpen !== null) {
        absoluteAtOpen = {
          date: { ...selectedDate.value },
          time: { ...selectedTime.value },
          seededEnd,
        };
      }
      if (outcome !== "kept") emitCorrectionLater();
    };

    // A whole-second midnight end is the day before's 23:59:59 in the fields, which reads back as that midnight.
    const shownEndMicros = (startUs: number, endUs: number) =>
      endUs > startUs &&
      endUs % MICROS_PER_SECOND === 0 &&
      convertUnixTime(endUs).time === "00:00:00"
        ? endUs - MICROS_PER_SECOND
        : endUs;

    function convertUnixTime(unixTimeMicros: number) {
      return formatAbsoluteInstant(unixTimeMicros, zone.value);
    }

    const refresh = () => {
      // Parent-invoked (e.g. on tab re-activation / auto-refresh) — programmatic.
      markProgrammaticDateChange();
      saveDate();
    };

    // Distinguishes genuine user-driven date changes from programmatic ones
    // (parent-invoked setters, mount replay). Stamped onto each `on:date-change`
    // payload as `userChangedValue` so consumers (e.g. traces live-mode auto-run)
    // can ignore programmatic changes instead of relying on value-diff heuristics.
    let isUserInitiated = true;
    const markProgrammaticDateChange = () => {
      isUserInitiated = false;
      // Reset after the current flush. Default ('pre') watchers — including the
      // deep selectedDate/selectedTime watcher that drives auto-apply — run before
      // nextTick callbacks, so the watch-triggered saveDate still reads `false`.
      nextTick(() => {
        isUserInitiated = true;
      });
    };

    let saveCount = 0;
    const appliedSpeech = ref("");
    // Callers often follow a setter with setDateType or refresh, so a setter's correction is emitted only if no save followed it.
    const emitCorrectionLater = () => {
      const seen = saveCount;
      nextTick(() => {
        if (saveCount !== seen) return;
        isUserInitiated = false;
        saveDate(null);
        isUserInitiated = true;
      });
    };

    // The trigger shows only what is in force, so this runs on every path that applies a range.
    // Panel edits without autoApply stay pending until Apply.
    const markApplied = () => {
      appliedSinceOpen = true;
      appliedPeriod.value =
        selectedType.value === "relative" && calendarToken.value === null
          ? currentRelativePeriod()
          : null;
      appliedDisplayValue.value = getDisplayValue.value;
      appliedType.value = selectedType.value;
      if (selectedType.value === "absolute") {
        const { startUTC, endUTC } = getUTCTimeStamp();
        appliedRange.value = { startTime: startUTC, endTime: endUTC };
      } else {
        appliedRange.value = null;
      }
      appliedCalendarToken.value = selectedType.value === "relative" ? calendarToken.value : null;
      appliedSelection = {
        selectedType: selectedType.value,
        calendarToken: calendarToken.value,
        relativePeriod: relativePeriod.value,
        relativeValue: relativeValue.value,
      };
    };

    // Closing without Apply restores the fields seen at open, so a zone change redraws them from the applied instants.
    const redrawAbsoluteAtOpen = () => {
      const applied = appliedRange.value;
      if (absoluteAtOpen === null || appliedSinceOpen || applied === null) return;
      const start = convertUnixTime(applied.startTime);
      const end = convertUnixTime(shownEndMicros(applied.startTime, applied.endTime));
      absoluteAtOpen = {
        date: { from: start.date, to: end.date },
        time: { startTime: start.time, endTime: end.time },
        seededEnd: null,
      };
    };

    const restoreAppliedSelection = () => {
      selectedType.value = appliedSelection.selectedType;
      calendarToken.value = appliedSelection.calendarToken;
      relativePeriod.value = appliedSelection.relativePeriod;
      relativeValue.value = appliedSelection.relativeValue;
      const atOpen = absoluteAtOpen;
      if (appliedSinceOpen || atOpen === null) return;
      writeSeededFields({ ...atOpen.date, ...atOpen.time }, atOpen.seededEnd);
    };

    const saveDate = (dateType?: string | null) => {
      saveCount += 1;
      // The resolved line and the seeded Start/End read this clock, so they match the range emitted now.
      if (selectedType.value === "relative") refreshTooltipNow();
      markApplied();
      const date = getConsumableDateTime();
      // if (isNaN(date.endTime) || isNaN(date.startTime)) {
      //   // return false;
      // }
      datePayload.value = date;
      date["valueType"] = dateType || selectedType.value;
      date["userChangedValue"] = isUserInitiated;
      if (isUserInitiated) nextTick(() => (appliedSpeech.value = String(triggerLabel.value)));
      // date["relativeTimePeriod"] = "";
      if (store.state.savedViewFlag == false) {
        emittingOwnChange = true;
        try {
          emit("on:date-change", date);
        } finally {
          emittingOwnChange = false;
        }
      }
    };

    // Writes true instants in the picker zone, holding them where its civil fields cannot show them.
    const applyInstants = (dateType: string, startUs: number, endUs: number) => {
      const start = convertUnixTime(startUs);
      const end = convertUnixTime(shownEndMicros(startUs, endUs));
      heldInstants = null;
      seededEnd = null;
      // Written as edits, not seeds, so an auto-apply picker saves the zoom through its date watcher.
      selectedDate.value.from = start.date;
      selectedDate.value.to = end.date;
      selectedTime.value.startTime = start.time;
      selectedTime.value.endTime = end.time;
      holdUnshownInstants(startUs, endUs);
      selectedType.value = dateType;
      markProgrammaticDateChange();
      markApplied();
    };

    // Parent-invoked setter for a chart drag-zoom — programmatic, but a range the user picked.
    const setCustomDate = (dateType: string, dateobj: { start: number; end: number }): boolean => {
      // Charts hand over `toZonedTime(instant, appZone)` values, so they become instants once, before any bound.
      const appZone = store.state.timezone || zone.value;
      const range = trustedRange(
        instantFromShiftedMs(Math.floor(Number(dateobj.start)), appZone),
        instantFromShiftedMs(Math.floor(Number(dateobj.end)), appZone),
      );
      // A refused zoom (zero width, or past maxDate) keeps the range the user is looking at.
      if (!range) return false;
      const shownBefore = JSON.stringify([selectedType.value, absoluteFieldsKey()]);
      captureUndo();
      applyInstants(dateType, range.start, range.end);
      recordSelection();
      // Unchanged fields fire no watcher, yet the parent's search (e.g. Search around) still expects its run.
      const unchanged = shownBefore === JSON.stringify([selectedType.value, absoluteFieldsKey()]);
      if (unchanged && props.autoApply && store.state.savedViewFlag == false) saveDate(dateType);
      return true;
    };

    const onBeforeShow = () => {
      // if (props.modelValue) selectedDate.value = cloneDeep(props.modelValue);
    };

    const onBeforeHide = () => {
      if (selectedType.value === "absolute")
        resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
    };

    // Arithmetic unit consumed by getConsumableDateTime's `subtractObject` —
    // a code token, never rendered, so it must stay English regardless of locale.
    const PERIOD_ARITHMETIC_UNIT: Record<string, string> = {
      s: "seconds",
      m: "minutes",
      h: "hours",
      d: "days",
      w: "weeks",
      M: "months",
    };

    const pastPeriodKey = computed<I18nKey>(() => PAST_PERIOD_KEYS[relativePeriod.value]);

    // "Last 1 hour" for a rolling period, the calendar label for a token.
    const relativeLabel = (period: string): I18nText =>
      formatPeriodLabel(period, zone.value, t, intlLocale.value, tooltipNow.value);

    // Weeks have no date arithmetic of their own, so they count as seven days each.
    const rollingRange = (value: number, unit: string, nowMs: number) => {
      const subtraction =
        unit === "w" ? { days: value * 7 } : { [PERIOD_ARITHMETIC_UNIT[unit]]: value };
      const start = subtractRelativeTime(new Date(nowMs), subtraction);
      return { startTime: new Date(start).getTime() * 1000, endTime: nowMs * 1000 };
    };

    const resolveRelativePeriod = (
      period: string,
      nowMs: number,
    ): { startTime: number; endTime: number } | null => {
      const calendarRange = resolveCalendarPeriod(period, zone.value, nowMs);
      if (calendarRange) return calendarRange;
      const rolling = parseRollingPeriod(period);
      return rolling ? rollingRange(rolling.value, rolling.unit, nowMs) : null;
    };

    // A mid-edit custom value (empty, 2.5, 0) reads as the last whole count, so the label and the emitted range agree.
    const normalizedCount = (): number => {
      const count = Math.trunc(Number(relativeValue.value));
      return isValidCustomValue(relativeValue.value) && count >= 1
        ? count
        : lastValidCustomValue.value;
    };

    const currentRelativePeriod = (): string =>
      calendarToken.value ?? `${normalizedCount()}${relativePeriod.value}`;

    function isValidDateTimeString(dateStr: string, timeStr: string): boolean {
      return !isNaN(Date.parse(`${dateStr} ${timeStr}`));
    }

    const getConsumableDateTime = (): ConsumableDateTime => {
      const calendarRange =
        selectedType.value === "relative"
          ? resolveCalendarPeriod(calendarToken.value, zone.value)
          : null;
      if (calendarRange) {
        return { ...calendarRange, relativeTimePeriod: calendarToken.value };
      }
      if (selectedType.value == "relative") {
        const period = `${normalizedCount()}${relativePeriod.value}`;
        const rolling = parseRollingPeriod(period);
        if (!rolling) console.error("getConsumableDateTime: Invalid relative period");
        return {
          ...rollingRange(rolling?.value ?? 15, rolling?.unit ?? "m", Date.now()),
          relativeTimePeriod: period,
        };
      } else {
        if (typeof selectedDate.value === "string") {
          selectedDate.value = {
            from: selectedDate.value,
            to: selectedDate.value,
          };
        }

        const startDateStr = selectedDate.value.from + " " + selectedTime.value.startTime;
        if (!isValidDateTimeString(selectedDate.value.from, selectedTime.value.startTime)) {
          // console.warn(`Invalid start date/time: ${startDateStr}`);
          // return new Date();
        }

        const endDateStr = selectedDate.value.to + " " + selectedTime.value.endTime;
        if (!isValidDateTimeString(selectedDate.value.to, selectedTime.value.endTime)) {
          // console.error(`Invalid end date/time: ${endDateStr}`);
          // return new Date();
        }

        let start, end;
        if (!selectedDate.value?.from && !selectedTime.value?.startTime) {
          start = new Date();
        } else {
          start = new Date(startDateStr);
        }

        if (selectedDate.value?.to == "" && selectedTime.value?.endTime == "") {
          end = new Date();
        } else {
          end = new Date(endDateStr);
        }

        if (start.toString() === "Invalid Date" && end.toString() === "Invalid Date") {
          start = selectedDate.value + " " + selectedTime.value.startTime;
          end = selectedDate.value + " " + selectedTime.value.endTime;
        }
        const absoluteUTCTimestamp = getUTCTimeStamp();
        const rVal = {
          startTime: absoluteUTCTimestamp.startUTC,
          endTime: absoluteUTCTimestamp.endUTC,
          relativeTimePeriod: null,
          selectedDate: JSON.parse(JSON.stringify(selectedDate.value)),
          selectedTime: JSON.parse(JSON.stringify(selectedTime.value)),
        };
        return rVal;
      }
    };

    const absoluteFieldsKey = () =>
      [
        zone.value,
        selectedDate.value.from,
        selectedTime.value.startTime,
        selectedDate.value.to,
        selectedTime.value.endTime,
      ].join(" ");

    const getUTCTimeStamp = () => {
      if (heldInstants?.key === absoluteFieldsKey()) {
        return { startUTC: heldInstants.startUTC, endUTC: heldInstants.endUTC };
      }
      const startUTC = absoluteToMicros(selectedDate.value.from, selectedTime.value.startTime);
      const untouchedSeededEnd =
        seededEnd !== null &&
        seededEnd.date === selectedDate.value.to &&
        seededEnd.time === selectedTime.value.endTime;
      const endUTC = endFieldToMicros(
        selectedDate.value.to,
        selectedTime.value.endTime,
        untouchedSeededEnd,
      );
      return { startUTC, endUTC };
    };

    const setSavedDate = (dateobj: any) => {
      clearUndoForPageRange(
        dateobj.type === "relative"
          ? { relativeTimePeriod: dateobj.relativeTimePeriod }
          : { startTime: dateobj.startTime, endTime: dateobj.endTime },
      );
      timezone.value = zone.value;
      selectedType.value = dateobj.type;

      if (dateobj.type === "relative") {
        selectedType.value = "relative";
        readRelativeTime(dateobj.relativeTimePeriod);
      } else {
        if (
          Object.prototype.hasOwnProperty.call(dateobj, "selectedDate") &&
          Object.prototype.hasOwnProperty.call(dateobj, "selectedTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "from") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "to") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "startTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "endTime")
        ) {
          selectedDate.value = dateobj.selectedDate;
          selectedTime.value = dateobj.selectedTime;
        } else {
          applyInstants(dateobj.type, Number(dateobj.startTime), Number(dateobj.endTime));
        }
      }

      markApplied();
    };

    const { isMobile } = useBreakpoint();

    const labelSurface = computed(() => (props.preset === "dashboard" ? "dashboard" : "toolbar"));
    const datesShown = computed(() => props.showDates ?? props.preset === "dashboard");

    // What the trigger names: the selection while it is in force or edited, else the applied one.
    const triggerRange = computed<RangeLabelInput | null>(() => {
      const showsApplied = !props.autoApply && !menuOpen.value;
      const shownType = showsApplied ? appliedType.value : selectedType.value;
      if (shownType === "absolute") {
        const range = showsApplied ? appliedRange.value : pendingRange.value;
        if (!range || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
          return null;
        }
        return { startUs: range.startTime, endUs: range.endTime };
      }
      const period = showsApplied
        ? (appliedCalendarToken.value ?? appliedPeriod.value)
        : currentRelativePeriod();
      if (!period) return null;
      const range = resolveRelativePeriod(period, tooltipNow.value);
      if (!range) return null;
      return {
        startUs: range.startTime,
        endUs: range.endTime,
        name: String(relativeLabel(period)),
        live: true,
        calendar: parseCalendarToken(period) !== null,
      };
    });

    const triggerLabel = computed(() => {
      if (props.triggerText) return props.triggerText;
      const range = triggerRange.value;
      if (props.disableRelative || !range) {
        const showsApplied = !props.autoApply && !menuOpen.value;
        return showsApplied
          ? appliedDisplayValue.value || getDisplayValue.value
          : getDisplayValue.value;
      }
      return formatRangeLabel(range, {
        ...labelOptions(),
        surface: labelSurface.value,
        showDates: datesShown.value,
      });
    });

    const kindText = (live: boolean | undefined) =>
      String(live ? t("dateTime.tagLive") : t("dateTime.fixed"));

    // Line 1 the full stamps, line 2 zone, kind and length; the label alone can round them.
    const triggerTooltip = computed(() => {
      const range = triggerRange.value;
      if (!range || props.disableRelative || props.triggerText) return null;
      const detail = [
        formatZoneOffset(zone.value, range.startUs / 1000),
        kindText(range.live),
        formatRangeDuration(range.startUs, range.endUs),
      ].join(" · ");
      return { stamps: formatRangeStamps(range, labelOptions()), detail };
    });

    const triggerAriaLabel = computed(() =>
      t("dateTime.triggerLabel", {
        label: String(triggerLabel.value),
        zone: formatZoneOffset(zone.value, tooltipNow.value),
      }),
    );

    const triggerTooltipOpen = ref(false);
    let triggerHoverTimer: ReturnType<typeof setTimeout> | null = null;
    const onTriggerHover = (on: boolean) => {
      if (triggerHoverTimer !== null) clearTimeout(triggerHoverTimer);
      triggerHoverTimer = null;
      if (!on) {
        triggerTooltipOpen.value = false;
        return;
      }
      refreshTooltipNow();
      triggerHoverTimer = setTimeout(() => {
        triggerTooltipOpen.value = true;
      }, 400);
    };
    onBeforeUnmount(() => onTriggerHover(false));
    const triggerElement = computed<HTMLElement | null>(() => {
      const button = datetimeBtn.value as { $el?: HTMLElement } | null;
      return button?.$el ?? null;
    });

    const getDisplayValue = computed(() => {
      const calendarLabel =
        !props.disableRelative && selectedType.value === "relative" && calendarToken.value !== null
          ? formatCalendarLabel(
              calendarToken.value,
              zone.value,
              t,
              intlLocale.value,
              tooltipNow.value,
            )
          : null;
      if (calendarLabel) return calendarLabel;
      if (!props.disableRelative && selectedType.value === "relative") {
        return t(pastPeriodKey.value, { count: normalizedCount() });
      } else {
        if (selectedDate.value != null) {
          // Here as if multiple dates is selected we get object with from and to keys
          // If single date is selected we get string with date value
          // So have added check for from and to
          if (selectedDate.value?.from && selectedDate.value?.to && !props.disableRelative) {
            // A pending single clicked day is what Apply will use, so the label shows it already.
            const pending = menuOpen.value ? pendingDay.value : null;
            const from = pending ?? selectedDate.value.from;
            const to = pending ?? selectedDate.value.to;
            return `${from} ${selectedTime.value.startTime} - ${to} ${selectedTime.value.endTime}`;
          } else if (selectedDate.value?.from && selectedDate.value?.to && props.disableRelative) {
            return `${selectedDate.value.from} - ${selectedDate.value.to}`;
          } else {
            return `${selectedDate.value} ${selectedTime.value.startTime} - ${selectedDate.value} ${selectedTime.value.endTime}`;
          }
        } else {
          const todayDate = new Date().toLocaleDateString("en-ZA");
          return `${todayDate} ${selectedTime.value.startTime} - ${todayDate} ${selectedTime.value.endTime}`;
        }
      }
    });

    // A clicked day still waiting for its end is the selection the panel shows, so Recent highlights it.
    const selectionKey = computed<string>(() => {
      if (selectedType.value === "relative") return `rel:${currentRelativePeriod()}`;
      const range = pendingRange.value;
      return range ? `${range.startTime}-${range.endTime}` : "";
    });

    // The pending selection as microseconds, including a clicked day still waiting for its end.
    const pendingRange = computed<{ startTime: number; endTime: number } | null>(() => {
      if (selectedType.value === "relative" && !props.disableRelative) {
        return resolveRelativePeriod(currentRelativePeriod(), tooltipNow.value);
      }
      const pending = menuOpen.value ? pendingDay.value : null;
      if (pending === null) {
        const { startUTC, endUTC } = getUTCTimeStamp();
        return { startTime: startUTC, endTime: endUTC };
      }
      return {
        startTime: absoluteToMicros(pending, selectedTime.value.startTime),
        endTime: endFieldToMicros(pending, selectedTime.value.endTime),
      };
    });

    // A day-only or zone-hidden picker never shows a zone, so its line and the as-UTC chip must not either.
    const showsZone = computed(() => !props.hideRelativeTimezone && !props.hideRelativeTime);

    // Whole civil days from the first to the last day the range touches, as a day-only trigger shows it.
    const resolvedDays = (range: { startTime: number; endTime: number }) => {
      const from = convertUnixTime(range.startTime).date;
      // An exclusive midnight end belongs to the day before.
      const to = convertUnixTime(
        isZoneMidnight(range.endTime) && range.endTime > range.startTime
          ? range.endTime - 1
          : range.endTime,
      ).date;
      const days =
        Math.round(
          (Date.parse(to.replace(/\//g, "-")) - Date.parse(from.replace(/\//g, "-"))) / 86_400_000,
        ) + 1;
      return {
        name: formatRecentRangeLabel(
          convertToUtcTimestamp(`${from} 00:00:00`, zone.value),
          convertToUtcTimestamp(`${to} 23:59:59`, zone.value),
          zone.value,
          tooltipNow.value,
          intlLocale.value,
        ),
        range: "",
        duration: formatDurationMicros(Math.max(1, days) * 86_400 * MICROS_PER_SECOND),
      };
    };

    // A fixed range drawn in another zone after a zone change; it names the same instants.
    const zoneRedrawn = ref(false);

    const fixedLine = (start: number, end: number): SummaryLine => {
      const opts = labelOptions();
      const named = namedFixedPeriod(start, end, opts);
      const dates = formatRangeDates({ startUs: start, endUs: end }, opts);
      return {
        name: named ?? dates,
        range: named ? dates : "",
        duration: formatRangeDuration(start, end),
        fixed: !props.disableRelative,
      };
    };

    const liveLine = (period: string, start: number, end: number): SummaryLine => ({
      name: String(relativeLabel(period)),
      range: formatRangeDates(
        { startUs: start, endUs: end, live: true, calendar: parseCalendarToken(period) !== null },
        labelOptions(),
      ),
      duration: "",
      live: true,
    });

    const resolvedLine = computed<SummaryLine>(() => {
      const range = pendingRange.value;
      if (!range || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
        return { name: "", range: "", duration: "" };
      }
      if (props.hideRelativeTime) return resolvedDays(range);
      if (selectedType.value === "relative" && !props.disableRelative) {
        return liveLine(currentRelativePeriod(), range.startTime, range.endTime);
      }
      const line = fixedLine(range.startTime, range.endTime);
      return zoneRedrawn.value ? { ...line, note: String(t("dateTime.sameWindow")) } : line;
    });

    const dayLabel = (date: string): string =>
      formatCivilDayPrefix(date, zone.value, tooltipNow.value, intlLocale.value);

    const startDayLabel = computed(() =>
      raw(dayLabel((menuOpen.value ? pendingDay.value : null) ?? selectedDate.value.from)),
    );
    // Mid-pick, End names the day under the pointer: the end a second pick would make.
    const endDayLabel = computed(() => {
      const pending = menuOpen.value ? pendingDay.value : null;
      const end = pending ? (calendarPreviewDay.value ?? pending) : selectedDate.value.to;
      return raw(dayLabel(end));
    });

    const cancelPendingRead = () => {
      if (readTimer !== null) clearTimeout(readTimer);
      readTimer = null;
      readPending.value = false;
    };

    const clearTimeFieldErrors = () => {
      timeFieldError.value = null;
      unreadableFields.value = { start: false, end: false };
    };

    const clearInput = () => {
      cancelPendingRead();
      inputText.value = "";
      inputError.value = false;
      inputRefusal.value = null;
      inputAsUtc.value = false;
      inputReading.value = null;
      inputSuggestions.value = [];
      activeSuggestion.value = 0;
      suggestionsDismissed.value = false;
      lastReadText = "";
    };

    // Any other pick replaces the selection the bar's text was aimed at, so the text goes with it.
    watch(selectionKey, () => {
      timeFieldError.value = null;
      zoneRedrawn.value = false;
      if (inputText.value) clearInput();
    });

    const zonelessToMicros = (range: AbsoluteRangeResult, asUtc: boolean) => {
      if (range.exact && !asUtc)
        return { start: range.exact.startMicros, end: range.exact.endMicros };
      const zoneName = asUtc ? "UTC" : zone.value;
      if (range.centre) {
        const centre = absoluteToMicros(range.centre.date, range.centre.time, zoneName);
        return { start: centre - SINGLE_WINDOW_MICROS, end: centre + SINGLE_WINDOW_MICROS };
      }
      return {
        start: absoluteToMicros(range.startDate, range.startTime, zoneName),
        end: absoluteToMicros(range.endDate, range.endTime, zoneName),
      };
    };

    const restrictionMessage = (): I18nText =>
      props.queryRangeRestrictionMsg
        ? raw(props.queryRangeRestrictionMsg)
        : t("common.timeRangeOverLimit", { count: props.queryRangeRestrictionInHour });

    const refusedPlan = (message: I18nText): InputPlan => ({ kind: "refused", message });

    // Only the start is bounded: an end past the ceiling is cut to it.
    const planAbsolute = (
      start: number,
      rawEnd: number,
      calendarPeriod: string | null = null,
    ): InputPlan => {
      if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) {
        return refusedPlan(t("common.timeRangeInputError"));
      }
      // A start out of bounds is named first, so `since` a future date says so rather than blaming the end.
      const refusal =
        startBoundError(start) ?? (rawEnd <= start ? t("common.timeRangeEndBeforeStart") : null);
      if (refusal !== null) return refusedPlan(refusal);
      const end = Math.min(rawEnd, selectionCeilingMicros());
      if (exceedsRangeRestriction(start, end, props.queryRangeRestrictionInHour)) {
        return { kind: "restricted", message: restrictionMessage() };
      }
      return { kind: "absolute", start, end, calendarPeriod };
    };

    // Typed calendar words select the rail's token, or its dates where the picker has no calendar presets.
    const planCalendar = (token: string): InputPlan => {
      const range = resolveCalendarPeriod(token, zone.value);
      if (!range) return refusedPlan(t("common.timeRangeInputError"));
      if (!props.calendarPresets || props.disableRelative) {
        return planAbsolute(range.startTime, range.endTime, token);
      }
      if (calendarExceedsRestriction(token)) {
        return { kind: "restricted", message: restrictionMessage() };
      }
      return { kind: "calendar", token };
    };

    const planRelative = (period: string): InputPlan => {
      if (parseCalendarToken(period)) return planCalendar(period);
      const rolling = parseRollingPeriod(period);
      if (!rolling) return refusedPlan(t("common.timeRangeInputError"));
      if (props.disableRelative) return refusedPlan(t("common.timeRangeDatesOnly"));
      const unit = rolling.unit;
      if (!relativePeriods.some((option) => option.value === unit)) {
        return refusedPlan(t("common.timeRangeNoSeconds"));
      }
      const value = Math.min(rolling.value, MAX_CUSTOM_RELATIVE_VALUE[unit] ?? rolling.value);
      const max = relativePeriodsMaxValue.value[unit];
      // The panel's minute clock, so an open preview keeps re-reading against now.
      const span = rollingRange(value, unit, tooltipNow.value);
      // Presets and the Custom row check nominal unit spans only; typed text also checks the real span, so only it refuses a 25h DST day.
      if (
        props.queryRangeRestrictionInHour > 0 &&
        (max < 1 ||
          value > max ||
          exceedsRangeRestriction(span.startTime, span.endTime, props.queryRangeRestrictionInHour))
      ) {
        return { kind: "restricted", message: restrictionMessage() };
      }
      return { kind: "rolling", unit, value, startTime: span.startTime, endTime: span.endTime };
    };

    const planInput = (reading: ParsedTimeInput, asUtc: boolean): InputPlan => {
      if (reading.type === "relative") return planRelative(reading.period);
      if (reading.type === "timestamp") return planAbsolute(reading.startMicros, reading.endMicros);
      const { start, end } = zonelessToMicros(reading, asUtc);
      return planAbsolute(start, end);
    };

    const applyPlan = (plan: InputPlan) => {
      clearUndo();
      if (plan.kind === "absolute") {
        applyAbsoluteRange(plan.start, plan.end, plan.calendarPeriod);
        return;
      }
      if (plan.kind !== "rolling" && plan.kind !== "calendar") return;
      refreshTooltipNow();
      selectedType.value = "relative";
      pendingDay.value = null;
      if (plan.kind === "calendar") {
        calendarToken.value = plan.token;
        if (props.autoApply) saveDate("relative");
        return;
      }
      calendarToken.value = null;
      relativePeriod.value = plan.unit;
      relativeValue.value = plan.value;
      lastValidCustomValue.value = plan.value;
      if (props.autoApply) saveDate("relative-custom");
    };

    const parseOptions = () => ({
      now: new Date(),
      locale: intlLocale.value,
      timeZone: zone.value,
    });

    // Where a lone instant puts the cursor first: the user's Search around window, else ± 5 min.
    const preferredAnchor = (): AnchorRow["id"] => {
      const user = String(store.state.userInfo?.email ?? "");
      return searchAroundAnchorId(readSearchAroundChoice(user)) ?? DEFAULT_ANCHOR_WINDOW;
    };

    // A lone reading gets a row of its own when no list row already applies it, so the body is never blank.
    const needsReadingRow = (reading: ParsedTimeInput | null): boolean => {
      if (!reading) return false;
      const plan = planInput(reading, false);
      if (plan.kind === "refused") return false;
      const period =
        plan.kind === "calendar"
          ? plan.token
          : plan.kind === "rolling"
            ? `${plan.value}${plan.unit}`
            : null;
      if (period !== null && defaultRows.value.some((row) => row.period === period)) return false;
      return (
        plan.kind === "restricted" ||
        !filterTimeRangeList(defaultRows.value, inputText.value).length
      );
    };

    // A zone abbreviation's preferred reading is never dropped; a future one is listed greyed.
    const isFutureReading = (reading: ParsedTimeInput) =>
      reading.type === "timestamp" && reading.future === true;

    const suggestionBlocked = (reading: ParsedTimeInput) =>
      isFutureReading(reading) || planInput(reading, false).kind === "restricted";

    // A rolling reading over the page limit stays listed, greyed, followed by the longest it allows.
    const withLongestAllowed = (readings: ParsedTimeInput[]): ParsedTimeInput[] => {
      const hours = props.queryRangeRestrictionInHour;
      if (!(hours > 0)) return readings;
      const over = readings.findIndex(
        (reading) => reading.type === "relative" && planInput(reading, false).kind === "restricted",
      );
      if (over < 0) return readings;
      const allowed: ParsedTimeInput = { type: "relative", period: formatLimitShorthand(hours) };
      if (planInput(allowed, false).kind !== "rolling") return readings;
      return [...readings.slice(0, over + 1), allowed, ...readings.slice(over + 1)];
    };

    // The instant a lone pasted time stands for; a text with several readings (zone abbreviations, DST folds) lists those instead.
    const loneInstant = (text: string, options: ReturnType<typeof parseOptions>): number | null => {
      const reading = inputReading.value;
      if (!reading || suggestTimeInput(text, options).length > 1) return null;
      const centre = readingAnchorMicros(reading, zone.value);
      if (centre === null || !inputAsUtc.value || reading.type !== "absolute") return centre;
      const { start, end } = zonelessToMicros(reading, true);
      return Math.round((start + end) / 2);
    };

    // Every keystroke schedules this; Enter and a paste read at once, against a fresh now.
    const readInputText = (keepActive = false) => {
      cancelPendingRead();
      refreshTooltipNow();
      const text = inputText.value.trim();
      suggestionTags.value = [];
      readingOnly.value = false;
      inputReversed.value = false;
      if (!text) {
        inputReading.value = null;
        inputSuggestions.value = [];
        return;
      }
      const options = parseOptions();
      inputReading.value = parseTimeInput(text, options);
      const anchorUs = loneInstant(text, options);
      if (anchorUs !== null) {
        const rows = anchorRows(anchorUs, Date.now() * 1000);
        inputSuggestions.value = rows.map((row) => ({
          type: "timestamp" as const,
          startMicros: row.startUs,
          endMicros: row.endUs,
          centreMicros: anchorUs,
        }));
        suggestionTags.value = rows.map((row) => ({ anchor: row.id }));
        const preferred = rows.findIndex((row) => row.id === preferredAnchor());
        activeSuggestion.value = keepActive
          ? Math.min(activeSuggestion.value, rows.length - 1)
          : Math.max(preferred, 0);
        return;
      }
      // A reading the picker would refuse is not offered, as picking it could do nothing.
      const suggested = suggestTimeInput(text, options)
        .filter(
          (reading) => isFutureReading(reading) || planInput(reading, false).kind !== "refused",
        )
        .slice(0, MAX_SUGGESTIONS);
      readingOnly.value = suggested.length === 0 && needsReadingRow(inputReading.value);
      inputReversed.value =
        !inputReading.value &&
        suggested.length === 0 &&
        explainTimeInputFailure(text, options) === "reversed";
      const offered = readingOnly.value && inputReading.value ? [inputReading.value] : suggested;
      const readings = withLongestAllowed(offered);
      inputSuggestions.value = readings;
      suggestionTags.value = readings.map((reading) =>
        offered.includes(reading) ? null : { longestAllowed: true as const },
      );
      const first = readings.findIndex((reading) => !suggestionBlocked(reading));
      const last = Math.max(readings.length - 1, 0);
      activeSuggestion.value = keepActive
        ? Math.min(activeSuggestion.value, last)
        : Math.max(first, 0);
    };

    // The old list goes at once, so a key pressed before the pause can never pick a row of stale text.
    const onInputEdit = () => {
      listCursor.value = -1;
      inputError.value = false;
      inputRefusal.value = null;
      inputReversed.value = false;
      inputAsUtc.value = false;
      suggestionsDismissed.value = false;
      inputSuggestions.value = [];
      cancelPendingRead();
      readTimer = setTimeout(readInputText, INPUT_READ_DELAY_MS);
      readPending.value = true;
    };

    const suggestionsOpen = computed(
      () =>
        menuOpen.value &&
        !suggestionsDismissed.value &&
        inputSuggestions.value.length > 0 &&
        inputText.value.trim() !== "" &&
        (!readingOnly.value || inputSuggestions.value.length > 1),
    );

    // The bar's own reading as a row with no cursor: nothing lights while typing (D5), Enter applies it as before.
    const readingRows = computed<TimeRangeListRow[]>(() => {
      const reading = inputReading.value;
      if (!readingOnly.value || suggestionsOpen.value || !reading || !typing.value) return [];
      const row = suggestionRow(reading, 0);
      return [
        {
          id: `reading-${row.key}`,
          kind: "reading" as const,
          label: row.label,
          hint: row.relative ? row.hint : undefined,
          meta: row.relative ? "" : row.hint,
          disabled: false,
          testId: "date-time-list-reading",
          group: -1,
        },
      ];
    });

    // Enter applies this same reading, so the preview and what applies never differ.
    const shownReading = computed<ParsedTimeInput | null>(() =>
      suggestionsOpen.value
        ? (inputSuggestions.value[activeSuggestion.value] ?? null)
        : inputReading.value,
    );

    const inputPlan = computed<InputPlan | null>(() => {
      const reading = shownReading.value;
      if (!reading || !inputText.value.trim()) return null;
      return planInput(reading, inputAsUtc.value);
    });

    const formatShownInstant = (micros: number) => {
      const { date, time } = convertUnixTime(micros);
      return `${dayLabel(date)} ${time.slice(0, 5)}`;
    };

    // "Nov 12, 21:13:49.948", the instant a pasted time was read as.
    const formatExactInstant = (micros: number) => {
      const { date, time } = convertUnixTime(micros);
      const ms = String(Math.floor((((micros % 1e6) + 1e6) % 1e6) / 1000)).padStart(3, "0");
      return `${dayLabel(date)} ${time}.${ms}`;
    };

    // "21:08:49.948 – 21:18:49.948" for an anchor row, the day added only when the ends differ.
    const formatClockSpan = (startUs: number, endUs: number) => {
      const clock = (us: number) => formatExactInstant(us).split(" ").pop() ?? "";
      const sameDay = convertUnixTime(startUs).date === convertUnixTime(endUs).date;
      return sameDay
        ? `${clock(startUs)} – ${clock(endUs)}`
        : `${formatExactInstant(startUs)} – ${formatExactInstant(endUs)}`;
    };

    const shownTag = computed<SuggestionTag>(() =>
      suggestionsOpen.value ? (suggestionTags.value[activeSuggestion.value] ?? null) : null,
    );

    const noteFor = (reading: ParsedTimeInput | null, asUtc: boolean): string => {
      if (asUtc) return String(formatReadingNote({ kind: "utc" }, t, intlLocale.value, zone.value));
      const note = reading ? readingNote(reading, zone.value) : null;
      return note ? String(formatReadingNote(note, t, intlLocale.value, zone.value)) : "";
    };

    const rollingLine = (period: string, startTime: number): SummaryLine => {
      const line = liveLine(period, startTime, tooltipNow.value * 1000);
      const cut = capRollingPeriod(inputText.value.trim())?.cut ?? false;
      return { ...line, note: cut ? String(t("dateTime.cutToTenYears")) : "", ready: true };
    };

    const absoluteLine = (start: number, end: number): SummaryLine => {
      if (props.hideRelativeTime)
        return { ...resolvedDays({ startTime: start, endTime: end }), ready: true };
      const reading = shownReading.value;
      const line = fixedLine(start, end);
      const tag = shownTag.value;
      if (tag && "anchor" in tag && tag.anchor !== "to-now" && reading?.type === "timestamp") {
        const centre = reading.centreMicros ?? (start + end) / 2;
        line.name = String(
          t("dateTime.aroundInstant", {
            window: String(anchorWindowLabel(tag.anchor, t)),
            instant: formatExactInstant(centre),
          }),
        );
        line.range = "";
        line.duration = "";
      }
      const first = inputReading.value;
      return { ...line, note: noteFor(tag ? first : reading, inputAsUtc.value), ready: true };
    };

    const calendarLine = (token: string): SummaryLine | null => {
      const range = resolveCalendarPeriod(token, zone.value, tooltipNow.value);
      if (!range) return null;
      if (props.hideRelativeTime) {
        return {
          ...absoluteLine(range.startTime, range.endTime),
          name: String(relativeLabel(token)),
        };
      }
      return { ...liveLine(token, range.startTime, range.endTime), ready: true };
    };

    const overLimitNote = (typed: string): I18nText => {
      const hours = props.queryRangeRestrictionInHour;
      const limit =
        hours % 24 === 0
          ? t("dateTime.limitDays", { n: hours / 24 })
          : t("dateTime.limitHours", { n: hours });
      return t("dateTime.overLimit", { typed, limit });
    };

    // Mid-pick in the calendar: the start day through the day under the pointer or focus.
    const calendarPickLine = computed<SummaryLine | null>(() => {
      const day = menuOpen.value && calendarMode.value ? pendingDay.value : null;
      if (day === null) return null;
      const other = calendarPreviewDay.value ?? day;
      const [first, last] = other < day ? [other, day] : [day, other];
      const start = civilDayStart(first);
      const end = civilDayStart(addCivilDays(last, 1));
      return { ...fixedLine(start, end), note: String(t("dateTime.pickEndDate")) };
    });

    // The range the fields would make with the time being typed, before the field commits it.
    const typedFieldLine = computed<SummaryLine | null>(() => {
      const typed = menuOpen.value && calendarMode.value ? typedFieldTime.value : null;
      const range = pendingRange.value;
      if (!typed || !range) return null;
      const day = pendingDay.value ?? selectedDate.value[typed.field === "start" ? "from" : "to"];
      const start = typed.field === "start" ? absoluteToMicros(day, typed.time) : range.startTime;
      const end = typed.field === "end" ? endFieldToMicros(day, typed.time) : range.endTime;
      if (!(end > start)) return null;
      const line = fixedLine(start, end);
      // The duration tag gives way to this long note, as it is the first part of the row to go.
      return typed.ms
        ? { ...line, duration: "", note: String(t("dateTime.secondsOnlyHere")) }
        : line;
    });

    const reversedLine = (): SummaryLine | null =>
      inputReversed.value && inputText.value.trim() && !inputError.value
        ? {
            name: "",
            range: "",
            duration: "",
            note: String(t("common.timeRangeEndBeforeStart")),
            warning: true,
          }
        : null;

    // What Enter would apply, in the summary row; the panel's buttons and calendar keep showing the applied range.
    const previewLine = computed<SummaryLine | null>(() => {
      if (typedFieldLine.value) return typedFieldLine.value;
      if (calendarPickLine.value) return calendarPickLine.value;
      const plan = inputPlan.value;
      if (!plan) return reversedLine();
      if (plan.kind === "refused" || plan.kind === "restricted") {
        const typed = inputText.value.trim();
        const rolling = plan.kind === "restricted" && shownReading.value?.type === "relative";
        const message = rolling ? overLimitNote(typed) : plan.message;
        return { name: "", range: "", duration: "", note: String(message), warning: true };
      }
      if (plan.kind === "rolling") {
        const line = rollingLine(`${plan.value}${plan.unit}`, plan.startTime);
        const tag = shownTag.value;
        if (!tag || !("longestAllowed" in tag)) return line;
        return { ...line, note: String(overLimitNote(inputText.value.trim())), warning: true };
      }
      if (plan.kind === "calendar") return calendarLine(plan.token);
      return absoluteLine(plan.start, plan.end);
    });

    const shownLine = computed<SummaryLine>(() => previewLine.value ?? resolvedLine.value);

    const suggestionRow = (reading: ParsedTimeInput, index: number): TimeInputSuggestionRow => {
      const plan = planInput(reading, inputAsUtc.value);
      const text = formatTimeInputText(reading);
      const key = `${index}-${text}`;
      const tag = suggestionTags.value[index] ?? null;
      if (reading.type === "timestamp" && reading.future) {
        const label = formatRangeLabel(
          { startUs: reading.startMicros, endUs: reading.endMicros },
          { ...labelOptions(), surface: "row" },
        );
        return { key, label: reading.fold ? text : label, hint: "", relative: false };
      }
      if (tag && "anchor" in tag && plan.kind === "absolute") {
        const span =
          tag.anchor === "to-now"
            ? formatRangeLabel(
                { startUs: plan.start, endUs: plan.end },
                { ...labelOptions(), surface: "row" },
              )
            : formatClockSpan(plan.start, plan.end);
        return {
          key,
          label: String(anchorWindowLabel(tag.anchor, t)),
          hint: span,
          relative: false,
        };
      }
      if (plan.kind === "rolling" || plan.kind === "restricted") {
        const period = reading.type === "relative" ? reading.period : text.replace(/mo$/, "M");
        return { key, label: String(relativeLabel(period)), hint: text, relative: true };
      }
      if (plan.kind === "calendar") {
        return { key, label: String(relativeLabel(plan.token)), hint: text, relative: true };
      }
      if (plan.kind !== "absolute") return { key, label: text, hint: "", relative: false };
      const opts = { ...labelOptions(), surface: "row" as const };
      const label =
        reading.type === "timestamp" && reading.fold
          ? text
          : formatRangeLabel({ startUs: plan.start, endUs: plan.end }, opts);
      const future = reading.type === "timestamp" && reading.future;
      const source = reading.type === "timestamp" ? reading.sourceZone : undefined;
      return {
        key,
        label,
        hint: future
          ? String(t("dateTime.inTheFuture"))
          : (source ?? formatRangeDuration(plan.start, plan.end)),
        relative: false,
      };
    };

    const suggestionRows = computed(() => inputSuggestions.value.map(suggestionRow));

    // Typed text turns the list into suggestions and matching rows; a refused Enter returns it to the default.
    const typing = computed(() => inputText.value.trim() !== "" && !inputError.value);

    const suggestionKind = (index: number): TimeRangeListRow["kind"] => {
      const tag = suggestionTags.value[index];
      if (tag && "anchor" in tag) return tag.anchor === "to-now" ? "to-now" : "anchor";
      return "suggestion";
    };

    const suggestionTestId = (index: number) => {
      const tag = suggestionTags.value[index];
      if (tag && "anchor" in tag) return `date-time-list-anchor-${tag.anchor}`;
      return readingOnly.value && index === 0
        ? "date-time-list-reading"
        : `date-time-suggest-${index}`;
    };

    const suggestionListRows = computed<TimeRangeListRow[]>(() =>
      suggestionsOpen.value
        ? suggestionRows.value.map((row, index) => {
            const reading = inputSuggestions.value[index];
            const future = isFutureReading(reading);
            const restricted = future || planInput(reading, inputAsUtc.value).kind === "restricted";
            const tag = suggestionTags.value[index];
            const anchored = !!tag && "anchor" in tag;
            const meta = future
              ? String(t("dateTime.inTheFuture"))
              : restricted
                ? String(maxLimitText())
                : tag && "longestAllowed" in tag
                  ? String(t("dateTime.longestAllowed"))
                  : row.relative
                    ? ""
                    : row.hint;
            return {
              id: `suggest-${row.key}`,
              kind: suggestionKind(index),
              label: row.label,
              hint: row.relative && !restricted ? row.hint : undefined,
              meta,
              reason: restricted,
              disabled: restricted,
              testId: suggestionTestId(index),
              group: anchored && tag && "anchor" in tag && tag.anchor === "to-now" ? -2 : -1,
            };
          })
        : [],
    );

    // A snap or calendar word keeps the row it resolves to, though its words match no label.
    const readPeriod = computed(() => {
      const plan = inputPlan.value;
      if (plan?.kind === "calendar") return plan.token;
      if (plan?.kind === "rolling") return `${plan.value}${plan.unit}`;
      return null;
    });

    const listRows = computed(() =>
      typing.value
        ? filterTimeRangeList(defaultRows.value, inputText.value, readPeriod.value)
        : defaultRows.value,
    );

    // Typed text that reads as nothing and matches no row teaches the grammar instead of a blank body.
    const exampleRows = computed<TimeRangeListRow[]>(() => {
      if (!typing.value || readPending.value || inputReading.value) return [];
      if (suggestionListRows.value.length > 0 || listRows.value.length > 0) return [];
      if (readingRows.value.length > 0) return [];
      return TIME_INPUT_EXAMPLES.map((example, index) => ({
        id: `example-${index}`,
        kind: "example" as const,
        label: example.text,
        meta: String(t(example.description)),
        disabled: false,
        testId: `date-time-list-example-${index}`,
        group: 0,
      }));
    });

    const listHeading = computed(() =>
      exampleRows.value.length > 0 ? String(t("dateTime.noMatchYet")) : undefined,
    );

    const shownRows = computed(() =>
      exampleRows.value.length > 0
        ? exampleRows.value
        : [...readingRows.value, ...suggestionListRows.value, ...listRows.value],
    );

    // Rows above the default list: the reading row or the suggestions.
    const listOffset = computed(() => readingRows.value.length + suggestionListRows.value.length);

    const activeRow = computed(() => {
      if (exampleRows.value.length > 0) return -1;
      if (listCursor.value >= 0) return listOffset.value + listCursor.value;
      return suggestionsOpen.value ? activeSuggestion.value : -1;
    });

    // The pointer sets the same cursor the arrow keys move.
    const setCursorRow = (index: number) => {
      const suggestions = suggestionListRows.value.length;
      if (exampleRows.value.length > 0 || index < readingRows.value.length) return;
      if (index < suggestions) {
        listCursor.value = -1;
        activeSuggestion.value = index;
        return;
      }
      listCursor.value = index - listOffset.value;
    };

    // The nearest enabled list row from `from` in a direction, without wrapping; -1 when none.
    const enabledListRow = (from: number, step: 1 | -1) => {
      const rows = listRows.value;
      for (let i = from + step; i >= 0 && i < rows.length; i += step) {
        if (!rows[i].disabled) return i;
      }
      return -1;
    };

    // Down from the bar or the last suggestion enters the list; Up from its first row returns.
    const moveCursor = (step: 1 | -1): boolean => {
      const suggestions = suggestionListRows.value.length;
      if (listCursor.value >= 0) {
        const next = enabledListRow(listCursor.value, step);
        if (next >= 0) listCursor.value = next;
        else if (step === -1) {
          listCursor.value = -1;
          if (suggestions > 0) activeSuggestion.value = suggestions - 1;
        }
        return true;
      }
      if (suggestionsOpen.value) {
        const last = activeSuggestion.value === suggestions - 1;
        const intoList = step === 1 && last ? enabledListRow(-1, 1) : -1;
        if (intoList >= 0) listCursor.value = intoList;
        else
          activeSuggestion.value = stepListCursor(
            suggestionListRows.value,
            activeSuggestion.value,
            step,
          );
        return true;
      }
      if (step === -1) return false;
      const first = enabledListRow(-1, 1);
      listCursor.value = first;
      return first >= 0;
    };

    // Times alone when both ends share a day, as the zone toggle sits beside the full range.
    const formatTimesOnly = (startUs: number, endUs: number): string => {
      const start = convertUnixTime(startUs);
      const end = convertUnixTime(endUs);
      if (start.date !== end.date) {
        return formatRecentRangeLabel(startUs, endUs, zone.value, Date.now(), intlLocale.value);
      }
      return `${start.time.slice(0, 5)} – ${end.time.slice(0, 5)}`;
    };

    // Only a date with its year may be a stamp pasted from another zone; "since 9am" means this one.
    // Anchor rows are built from the typed reading, so its zone toggle still applies to them.
    const zonelessPreview = computed<AbsoluteRangeResult | null>(() => {
      const anchored = suggestionTags.value.some((tag) => !!tag && "anchor" in tag);
      if (anchored) {
        const typed = inputReading.value;
        return typed?.type === "absolute" && typed.hasYear ? typed : null;
      }
      const reading = shownReading.value;
      if (reading?.type !== "absolute" || !reading.hasYear) return null;
      return inputPlan.value?.kind === "absolute" ? reading : null;
    });

    // The chip names the reading a click switches to, so once pressed it offers the picker-zone reading back.
    // Short on the chip, the converted range in its tooltip, so the summary keeps room for the dates.
    const asUtcLabel = computed<{ short: I18nText; full: I18nText } | null>(() => {
      const parsed = zonelessPreview.value;
      if (!parsed || zone.value === "UTC" || !showsZone.value) return null;
      const { start, end } = zonelessToMicros(parsed, !inputAsUtc.value);
      // A reading the picker would refuse is not offered, as clicking it could do nothing.
      if (startBoundError(start) !== null) return null;
      const range = formatTimesOnly(start, end);
      if (!inputAsUtc.value) {
        return { short: t("dateTime.asUtcShort"), full: t("common.timeRangeAsUtc", { range }) };
      }
      const zoneName = formatZoneAbbreviation(zone.value, start / 1000, intlLocale.value);
      return {
        short: t("dateTime.asZoneShort", { zone: zoneName }),
        full: t("common.timeRangeAsZone", { zone: zoneName, range }),
      };
    });

    const toggleAsUtc = () => {
      inputAsUtc.value = !inputAsUtc.value;
      if (suggestionTags.value.some((tag) => !!tag && "anchor" in tag)) readInputText(true);
    };

    const finishInput = () => {
      if (props.autoApply) closeMenu();
      else applyAndClose();
    };

    // A refused reading says why on Enter; one over the query-range limit already says so in the preview.
    const applyReading = (reading: ParsedTimeInput, asUtc: boolean) => {
      const plan = planInput(reading, asUtc);
      if (plan.kind === "restricted") return;
      if (plan.kind === "refused") {
        inputRefusal.value = plan.message;
        inputError.value = true;
        return;
      }
      applyPlan(plan);
      finishInput();
    };

    const applySuggestion = (index: number) => {
      const reading = inputSuggestions.value[index];
      if (reading) applyReading(reading, inputAsUtc.value);
    };

    // Tab takes the highlighted reading into the bar as unambiguous text, without applying it.
    const acceptSuggestion = (index: number) => {
      const reading = inputSuggestions.value[index];
      if (!reading) return;
      const asUtc = inputAsUtc.value;
      inputText.value = formatTimeInputText(reading);
      onInputEdit();
      readInputText();
      inputAsUtc.value = asUtc;
      suggestionsDismissed.value = true;
    };

    // Enter reads again against a fresh now; a list the user has not seen yet is shown before anything applies.
    const commitInput = () => {
      if (!inputText.value.trim()) return;
      const pending = readTimer !== null;
      const listWasOpen = suggestionsOpen.value;
      readInputText(listWasOpen && !pending);
      lastReadText = inputText.value.trim();
      const unseenList = pending || (!listWasOpen && !inputReading.value);
      if (inputSuggestions.value.length > 0 && unseenList && !readingOnly.value) {
        suggestionsDismissed.value = false;
        return;
      }
      const reading = shownReading.value;
      if (reading) {
        applyReading(reading, inputAsUtc.value);
        return;
      }
      const text = inputText.value.trim();
      const reason = explainTimeInputFailure(text, parseOptions());
      reportParseFailure(text, reason);
      inputRefusal.value =
        reason === "future"
          ? t("common.timeRangeStartInFuture")
          : reason === "reversed"
            ? t("common.timeRangeEndBeforeStart")
            : null;
      inputError.value = true;
    };

    // Delete removes the Recent row under the cursor; Alt+P pins or unpins it.
    const onCursorRowKey = (event: KeyboardEvent): boolean => {
      const row = listRows.value[listCursor.value];
      if (!row) return false;
      if (event.key === "Delete" && row.kind === "recent") removeRecentRow(row.id);
      else if (event.altKey && event.code === "KeyP" && row.kind === "recent") pinRecentRow(row.id);
      else if (event.altKey && event.code === "KeyP" && row.kind === "pinned") unpinRow(row.id);
      else return false;
      event.preventDefault();
      return true;
    };

    // Examples have no cursor, so Tab takes the first one into the bar.
    const tabToExample = (event: KeyboardEvent): boolean => {
      const first = exampleRows.value[0];
      if (!first) return false;
      event.preventDefault();
      takeExample(first.label);
      return true;
    };

    const onInputKeydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (listCursor.value >= 0 && onCursorRowKey(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (listCursor.value >= 0) pickListRow(listCursor.value);
        else commitInput();
        return;
      }
      if (event.key === "Tab" && readTimer !== null) {
        readInputText();
        if (suggestionsOpen.value) event.preventDefault();
        else if (!event.shiftKey) tabToExample(event);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && tabToExample(event)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (moveCursor(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
        return;
      }
      if (!suggestionsOpen.value || listCursor.value >= 0) return;
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        acceptSuggestion(activeSuggestion.value);
      }
    };

    // A press on a row keeps focus in the bar, so only a move elsewhere closes the list.
    const onBarFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      const bar = event.currentTarget;
      if (next instanceof Node && bar instanceof HTMLElement && bar.contains(next)) return;
      suggestionsDismissed.value = true;
    };

    // Escape backs out one step at a time: the list, then the typed text, then the panel.
    const escapeInput = (event: KeyboardEvent): boolean => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest("[data-test='date-time-input']")) {
        return false;
      }
      if (listCursor.value >= 0) listCursor.value = -1;
      else if (suggestionsOpen.value) suggestionsDismissed.value = true;
      else if (inputText.value) clearInput();
      else return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    const showRestrictionToast = () => {
      toast({
        variant: "warning",
        message: props.queryRangeRestrictionMsg
          ? raw(props.queryRangeRestrictionMsg)
          : t("common.timeRangeOverLimit", { count: props.queryRangeRestrictionInHour }),
      });
    };

    // The largest unit that divides the span exactly, else whole minutes.
    const toRelativeUnit = (spanMicros: number): [string, number] => {
      const minutes = Math.max(1, Math.round(spanMicros / MICROS_PER_MINUTE));
      if (minutes % 1440 === 0) return ["d", minutes / 1440];
      if (minutes % 60 === 0) return ["h", minutes / 60];
      return ["m", minutes];
    };

    const restrictionLimitMicros = () =>
      props.queryRangeRestrictionInHour > 0
        ? props.queryRangeRestrictionInHour * MICROS_PER_HOUR
        : Number.POSITIVE_INFINITY;

    const goLive = () => {
      if (selectedType.value === "relative") return;
      const range = pendingRange.value;
      if (!range || !(range.endTime > range.startTime)) return;
      let span = range.endTime - range.startTime;
      if (span > restrictionLimitMicros()) {
        showRestrictionToast();
        span = restrictionLimitMicros();
      }
      const [unit, value] = toRelativeUnit(span);
      clearUndo();
      pendingDay.value = null;
      // Live has no Apply step on any picker, and an uncommitted pick would be undone when the panel closes.
      setRelativeDate(unit, Math.min(value, MAX_CUSTOM_RELATIVE_VALUE[unit]), true);
    };

    const writeAbsoluteFields = (startMicros: number, endMicros: number) => {
      const start = convertUnixTime(startMicros);
      const end = convertUnixTime(shownEndMicros(startMicros, endMicros));
      writeSeededFields(
        { from: start.date, to: end.date, startTime: start.time, endTime: end.time },
        null,
      );
    };

    // Seconds through days roll up into the largest offered unit that holds the count exactly, so 60m lights the 1h chip.
    const largestExactUnit = (unit: string, value: number): [string, number] => {
      if (!(unit in EXACT_UNIT_SECONDS)) return [unit, value];
      const seconds = value * EXACT_UNIT_SECONDS[unit];
      const fit = Object.entries(EXACT_UNIT_SECONDS).find(
        ([candidate, size]) =>
          seconds % size === 0 && relativePeriods.some((option) => option.value === candidate),
      );
      return fit ? [fit[0], seconds / fit[1]] : [unit, value];
    };

    const zoomOutRelative = () => {
      const unit = relativePeriod.value;
      const current = normalizedCount();
      let next = largestExactUnit(
        unit,
        Math.min(current * 2, MAX_CUSTOM_RELATIVE_VALUE[unit] ?? current * 2),
      );
      const span = resolveRelativePeriod(`${next[1]}${next[0]}`, Date.now());
      if (span && span.endTime - span.startTime > restrictionLimitMicros()) {
        showRestrictionToast();
        next = toRelativeUnit(restrictionLimitMicros());
      }
      if (next[0] === unit && next[1] === current) return;
      captureUndo();
      selectedType.value = "relative";
      calendarToken.value = null;
      relativePeriod.value = next[0];
      relativeValue.value = next[1];
      menuOpen.value = false;
      saveDate("relative");
    };

    const zoomOutAbsolute = () => {
      const { startTime, endTime } = getConsumableDateTime();
      const duration = endTime - startTime;
      if (!(duration > 0)) return;
      let width = duration * 2;
      if (width > restrictionLimitMicros()) {
        showRestrictionToast();
        width = restrictionLimitMicros();
        if (width <= duration) return;
      }
      const floor = Math.min(civilDayStart(calendarMinDate.value), startTime);
      // An end already past now stays; otherwise widening stops at now, as Next does.
      const ceiling = Math.max(forwardCeilingMicros(), endTime);
      // With ‹ off there is nothing earlier to show, so the range only grows forward.
      const centred = Math.round(startTime + duration / 2 - width / 2);
      const start = Math.max(props.disablePrevShift ? startTime : centred, floor);
      const end = Math.min(start + width, ceiling);
      if (start === startTime && end === endTime) return;
      captureUndo();
      writeAbsoluteFields(start, end);
      selectedType.value = "absolute";
      calendarToken.value = null;
      menuOpen.value = false;
      saveDate("absolute");
    };

    // A rolling period doubles its count; any other range doubles around its centre.
    const zoomOut = () => {
      // An absolute-only picker shows only its dates, so they are what zoom widens.
      if (props.disableRelative) selectedType.value = "absolute";
      if (selectedType.value === "relative" && calendarToken.value === null) zoomOutRelative();
      else zoomOutAbsolute();
    };

    // The selection as the label formatter reads it, for the copied text.
    const selectionRange = computed<RangeLabelInput | null>(() => {
      const range = pendingRange.value;
      if (!range || !Number.isFinite(range.startTime) || !(range.endTime > range.startTime)) {
        return null;
      }
      if (selectedType.value !== "relative" || props.disableRelative) {
        return { startUs: range.startTime, endUs: range.endTime };
      }
      const period = currentRelativePeriod();
      return {
        startUs: range.startTime,
        endUs: range.endTime,
        name: String(relativeLabel(period)),
        live: true,
        calendar: parseCalendarToken(period) !== null,
      };
    });

    const copyDisabled = computed(() => selectionRange.value === null);
    const copyShortcut = isMacOS() ? "ctrl+shift+c" : "alt+shift+c";

    // Readable text the bar reads back; it names the zone, so it means the same in every timezone.
    const copyRange = () => {
      const range = selectionRange.value;
      if (!range) return;
      copyToClipboard(formatRangeCopyText(range, labelOptions()), t, {
        successMessage: t("common.dateRangeCopied"),
      });
    };

    // Wall-clock date and time in the picker zone to epoch µs, the inverse of convertUnixTime.
    // One rule for the bar and the Start/End fields: a gap time moves forward, a repeated one takes its first instant.
    const absoluteToMicros = (date: string, time: string, zoneName = zone.value): number => {
      try {
        return resolveZonedCivil(date, time, zoneName).micros;
      } catch {
        const iso = `${date.replace(/\//g, "-")}T${time}`;
        return fromZonedTime(iso, zoneName).getTime() * 1000;
      }
    };

    // A shown 23:59:59 is the whole last second, so the exclusive backend end is the next midnight.
    const endFieldToMicros = (date: string, time: string, throughSecond = false): number =>
      absoluteToMicros(date, time) + (throughSecond || time === "23:59:59" ? MICROS_PER_SECOND : 0);

    const isZoneMidnight = (micros: number) =>
      micros % MICROS_PER_SECOND === 0 && convertUnixTime(micros).time === "00:00:00";

    const holdUnshownInstants = (startMicros: number, endMicros: number) => {
      // Exact, not floored: the fields show seconds, but the query keeps the sub-second bounds.
      const held = { startUTC: startMicros, endUTC: endMicros };
      const shown = getUTCTimeStamp();
      if (shown.startUTC === held.startUTC && shown.endUTC === held.endUTC) return;
      heldInstants = { key: absoluteFieldsKey(), ...held };
    };

    const applyAbsoluteRange = (
      startMicros: number,
      endMicros: number,
      calendarPeriod: string | null,
    ) => {
      selectedType.value = "absolute";
      calendarToken.value = null;
      // A day clicked before the paste would otherwise overwrite the pasted range when the panel closes.
      pendingDay.value = null;
      // Saved once below, so the auto-apply date watcher must not save it a second time.
      heldInstants = null;
      // An exclusive midnight end shows as the day before's 23:59:59, which reads back as that midnight.
      const midnightEnd = endMicros > startMicros && isZoneMidnight(endMicros);
      writeAbsoluteFields(
        startMicros,
        midnightEnd ? endMicros - MICROS_PER_SECOND : lastInstant(calendarPeriod, endMicros),
      );
      if (calendarPeriod !== null && !midnightEnd) rememberSeededEnd(calendarPeriod, endMicros);
      holdUnshownInstants(startMicros, endMicros);
      if (props.autoApply) {
        saveDate(null);
        recordSelection();
      }
    };

    // A paste fills the bar and shows what it reads as; like typed text it applies only on Enter.
    const readPastedText = (text: string) => {
      inputText.value = text.trim();
      onInputEdit();
      readInputText();
      lastReadText = inputText.value;
      inputBar.value?.focus();
    };

    const pasteRange = async () => {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        toast({
          variant: "error",
          message: t("common.dateRangePasteBlocked", {
            shortcut: isMacOS() ? raw("⌘V") : raw("Ctrl+V"),
          }),
        });
        return;
      }
      if (!text.trim()) {
        toast({ variant: "info", message: t("common.dateRangePasteEmpty") });
        return;
      }
      readPastedText(text);
    };

    // Any other paste into the box goes in at the caret, so `yesterday` and a pasted `15:00` read together.
    const isWholePasteBoxEntry = (target: EventTarget | null) => {
      if (!(target instanceof HTMLInputElement)) return false;
      if (!target.closest("[data-test='date-time-input']")) return false;
      const text = target.value.trim();
      return (
        text === "" ||
        text === lastReadText ||
        (target.selectionStart === 0 && target.selectionEnd === target.value.length)
      );
    };

    // A full stamp pasted into Start or End is read by the bar's parser and fills both fields.
    const pasteIntoTimeFields = (event: ClipboardEvent): boolean => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.closest("[data-test='date-time-start-end']")
      ) {
        return false;
      }
      const text = event.clipboardData?.getData("text")?.trim() ?? "";
      const reading = text ? parseTimeInput(text, parseOptions()) : null;
      if (!reading || reading.type === "relative") return false;
      const plan = planInput(reading, false);
      if (plan.kind !== "absolute") return false;
      event.preventDefault();
      markAbsoluteEdit();
      pendingDay.value = null;
      writeAbsoluteFields(
        plan.start,
        isZoneMidnight(plan.end) ? plan.end - MICROS_PER_SECOND : plan.end,
      );
      return true;
    };

    // A native paste event carries the clipboard text without the read permission pasteRange needs.
    const onPickerPaste = (event: ClipboardEvent) => {
      if (pasteIntoTimeFields(event)) return;
      if (isInputFocused(event.target) && !isWholePasteBoxEntry(event.target)) return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (!text.trim()) return;
      event.preventDefault();
      readPastedText(text);
    };

    const timezoneFilterFn = (val: string, update: (cb: () => void) => void) => {
      filteredTimezone.value = filterColumns(timezoneOptions, val, update);
    };

    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter((column: any) => column.toLowerCase().includes(value));
      });
      return filteredOptions;
    };

    const optionsFn = (date: string) => {
      const formattedDate = calendarMaxDate.value;
      if (props.disableRelative) {
        return date >= props.minDate && date <= formattedDate;
      }
      return date >= "1999/01/01" && date <= formattedDate;
    };

    // Resolved at the resolved line's clock, so the fields and the line show the same instants.
    const seedAbsoluteFromSelection = () => {
      const range = resolveRelativePeriod(currentRelativePeriod(), tooltipNow.value);
      if (!range) return;
      const { startTime, endTime } = range;
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
      const start = convertUnixTime(startTime);
      const end = convertUnixTime(lastInstant(calendarToken.value, endTime));
      rememberSeededEnd(calendarToken.value, endTime);
      writeSeededFields({
        from: start.date,
        to: end.date,
        startTime: start.time,
        endTime: end.time,
      });
    };

    // An edit in Start/End makes the selection absolute; the shown values were the relative one's.
    const markAbsoluteEdit = () => {
      if (selectedType.value === "absolute") return;
      selectedType.value = "absolute";
      calendarToken.value = null;
    };

    const setWholeDayTimes = () => {
      selectedTime.value.startTime = "00:00:00";
      selectedTime.value.endTime = "23:59:59";
      seededEnd = null;
    };

    // A relative range's times were seeded, not chosen, so days picked from it cover whole days.
    const markCalendarEdit = () => {
      if (selectedType.value === "absolute") return;
      markAbsoluteEdit();
      setWholeDayTimes();
    };

    const timesReversedOn = (from: string, to: string, startTime: string, endTime: string) => {
      if (!startTime || !endTime) return false;
      const start = convertToUtcTimestamp(`${from} ${startTime}`, zone.value);
      const end = convertToUtcTimestamp(`${to} ${endTime}`, zone.value);
      return Number.isFinite(start) && Number.isFinite(end) && end <= start;
    };

    // A picked end past the calendar's last instant stops there, as the Today row stops at now; the cut-off time is kept for a later pick.
    const cutEndToCeiling = (to: string) => {
      const ceiling = selectionCeilingMicros();
      if (!Number.isFinite(ceiling)) return;
      const cut = convertUnixTime(ceiling);
      const end = convertToUtcTimestamp(`${to} ${selectedTime.value.endTime}`, zone.value);
      if (!(end > ceiling) || cut.date !== to) return;
      endBeforeCut ??= selectedTime.value.endTime;
      selectedTime.value.endTime = cut.time;
    };

    // Kept times on the picked days can run backwards or past now, so they fall back to whole days that stop at now.
    const fitPickedDays = (from: string, to: string) => {
      if (endBeforeCut !== null) selectedTime.value.endTime = endBeforeCut;
      endBeforeCut = null;
      cutEndToCeiling(to);
      const { startTime, endTime } = selectedTime.value;
      if (!timesReversedOn(from, to, startTime, endTime)) return;
      setWholeDayTimes();
      endBeforeCut = null;
      cutEndToCeiling(to);
    };

    const onCalendarStartDate = (value: string) => {
      markCalendarEdit();
      selectedDate.value.from = value;
    };

    const onCalendarEndDate = (value: string) => {
      markCalendarEdit();
      selectedDate.value.to = value;
      fitPickedDays(selectedDate.value.from, value);
      endBeforeCut = null;
    };

    // A clicked day replaces whatever the box read, and is staged as the whole day it will commit as.
    const onCalendarPendingDay = (value: string | null) => {
      pendingDay.value = value;
      if (value === null) return;
      markCalendarEdit();
      clearInput();
      fitPickedDays(value, value);
    };

    // Whether the fields would read End at or before Start, on the pending day when one is clicked.
    const timesReversed = (startTime: string, endTime: string) => {
      const pending = menuOpen.value ? pendingDay.value : null;
      return timesReversedOn(
        pending ?? selectedDate.value.from,
        pending ?? selectedDate.value.to,
        startTime,
        endTime,
      );
    };

    // A Start typed at or past End moves the range: End follows at the same duration, stopped at now; null when that leaves End not after Start.
    const shiftedEnd = (startTime: string): { date: string; time: string } | null => {
      const pending = menuOpen.value ? pendingDay.value : null;
      const from = pending ?? selectedDate.value.from;
      const to = pending ?? selectedDate.value.to;
      const oldStart = convertToUtcTimestamp(`${from} ${selectedTime.value.startTime}`, zone.value);
      const oldEnd = convertToUtcTimestamp(`${to} ${selectedTime.value.endTime}`, zone.value);
      const start = convertToUtcTimestamp(`${from} ${startTime}`, zone.value);
      const end = Math.min(start + Math.max(0, oldEnd - oldStart), selectionCeilingMicros());
      return end > start ? convertUnixTime(end) : null;
    };

    // A refused edit leaves the model alone, so the field shows the kept value again.
    const onStartTimeEdit = (value: string) => {
      typedFieldTime.value = null;
      const pending = menuOpen.value ? pendingDay.value : null;
      const from = pending ?? selectedDate.value.from;
      const bound = startBoundError(convertToUtcTimestamp(`${from} ${value}`, zone.value));
      if (bound !== null) {
        timeFieldError.value = { field: "start", message: bound };
        return;
      }
      if (timesReversed(value, selectedTime.value.endTime)) {
        const end = shiftedEnd(value);
        if (!end) {
          timeFieldError.value = { field: "start", message: t("common.timeRangeEndBeforeStart") };
          return;
        }
        // A moved End makes the clicked day a range of its own, committed like a settled one.
        pendingDay.value = null;
        selectedDate.value.from = from;
        selectedDate.value.to = end.date;
        selectedTime.value.endTime = end.time;
        seededEnd = null;
      }
      timeFieldError.value = null;
      endBeforeCut = null;
      markAbsoluteEdit();
      selectedTime.value.startTime = value;
    };

    // The field refuses milliseconds, so the preview says where they can be typed.
    const onTimeFieldTyping = (field: "start" | "end", event: Event) => {
      const text = (event.target as HTMLInputElement | null)?.value.trim() ?? "";
      const ms = /\.\d{1,3}$/.test(text);
      const parsed = parseTypedTime(ms ? text.replace(/\.\d{1,3}$/, "") : text);
      if (!parsed) {
        typedFieldTime.value = null;
        return;
      }
      const time = formatTypedTime(parsed);
      const current = field === "start" ? selectedTime.value.startTime : selectedTime.value.endTime;
      typedFieldTime.value = time === current && !ms ? null : { field, time, ms };
    };

    const onTimeFieldInvalid = (field: "start" | "end", invalid: boolean) => {
      if (invalid) typedFieldTime.value = null;
      unreadableFields.value[field] = invalid;
    };

    const onTimeFieldBlur = () => {
      typedFieldTime.value = null;
      timeFieldFocused.value = false;
      resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
    };

    const onEndTimeEdit = (value: string) => {
      typedFieldTime.value = null;
      if (timesReversed(selectedTime.value.startTime, value)) {
        timeFieldError.value = { field: "end", message: t("common.timeRangeEndBeforeStart") };
        return;
      }
      timeFieldError.value = null;
      endBeforeCut = null;
      markAbsoluteEdit();
      selectedTime.value.endTime = value;
    };

    const setDateType = (type: string) => {
      selectedType.value = type;
      // displayValue.value = getDisplayValue();
      if (props.autoApply) saveDate(type === "absolute" ? "absolute" : "relative-custom");
    };

    /**
     * Shift the applied time window backward (`prev`) or forward (`next`) by its
     * own duration, then promote the picker to an absolute range and emit the
     * change so the page re-runs its query. Works from both relative and
     * absolute modes: `getConsumableDateTime` resolves the current window to
     * concrete microsecond timestamps first, so shifting across midnight/day
     * boundaries stays exact and a relative picker is switched to absolute.
     *
     * Deliberately does NOT call `markProgrammaticDateChange()`: the change is
     * user-driven, so `userChangedValue` stays `true` and consumers (e.g.
     * traces live-mode) re-run their query just like a manual Apply. With
     * `autoApply` the deep `selectedDate`/`selectedTime` watcher saves the new
     * range; otherwise we save and emit directly.
     */
    const shiftTimeRange = (direction: "prev" | "next") => {
      if (selectedType.value === "relative" && calendarToken.value !== null) {
        const shifted = shiftCalendarToken(calendarToken.value, direction === "prev" ? -1 : 1);
        if (shifted === null || !resolveCalendarPeriod(shifted, zone.value)) return;
        refreshTooltipNow();
        // A partial period can step into a full one longer than the page allows, which the rail would have refused.
        if (calendarExceedsRestriction(shifted)) {
          if (props.queryRangeRestrictionMsg) {
            toast({ variant: "warning", message: raw(props.queryRangeRestrictionMsg) });
          }
          return;
        }
        captureUndo();
        calendarToken.value = shifted;
        menuOpen.value = false;
        saveDate("relative");
        return;
      }
      if (shiftWholeDays(direction)) return;
      const { startTime, endTime } = getConsumableDateTime();
      const duration = endTime - startTime;
      if (!(duration > 0)) return;

      let delta = (direction === "prev" ? -1 : 1) * duration;
      if (direction === "next") {
        // A forward shift stops where the calendar does: now, or the end of `maxDate`.
        delta = Math.min(delta, forwardCeilingMicros() - endTime);
        if (delta < MICROS_PER_SECOND) return;
        if (returnToLiveOrigin(endTime + delta)) return;
      }
      captureUndo();
      const startDateTime = convertUnixTime(startTime + delta);
      const endDateTime = convertUnixTime(endTime + delta);

      selectedDate.value.from = startDateTime.date;
      selectedDate.value.to = endDateTime.date;
      selectedTime.value.startTime = startDateTime.time;
      selectedTime.value.endTime = endDateTime.time;
      selectedType.value = "absolute";

      menuOpen.value = false;
      if (!props.autoApply) saveDate("absolute");
    };

    // A chain of steps that began on a rolling range goes back to it once `]` reaches now.
    const returnToLiveOrigin = (endUs: number): boolean => {
      const origin = undoStack.value[0];
      if (props.maxDate || !origin || origin.selectedType !== "relative") return false;
      if (origin.calendarToken !== null || endUs < Date.now() * 1000 - MICROS_PER_SECOND)
        return false;
      captureUndo();
      selectedType.value = "relative";
      calendarToken.value = null;
      relativePeriod.value = origin.relativePeriod;
      relativeValue.value = origin.relativeValue;
      menuOpen.value = false;
      saveDate("relative");
      return true;
    };

    // Whole days, or days from midnight up to some moment today, which are those days so far.
    const wholeDaySpan = (): { from: string; days: number } | null => {
      const { startTime, endTime } = selectedTime.value;
      if (selectedType.value !== "absolute" || startTime !== "00:00:00") return null;
      const { from, to } = selectedDate.value;
      const days = Math.round((civilDayMs(to) - civilDayMs(from)) / 86_400_000) + 1;
      if (!(days >= 1)) return null;
      if (endTime === "23:59:59") return { from, days };
      // Today counts as a whole day only while it runs to now; a short window from midnight shifts by its length.
      const endsNow = Math.abs(getUTCTimeStamp().endUTC - Date.now() * 1000) <= MICROS_PER_MINUTE;
      return to === convertUnixTime(Date.now() * 1000).date && endsNow ? { from, days } : null;
    };

    const civilDayStart = (date: string) => convertToUtcTimestamp(`${date} 00:00:00`, zone.value);

    // Whole days step by whole civil days, so the inclusive 23:59:59 end and a DST day stay exact; days not over yet end now; false leaves the shift to the timed path.
    const shiftWholeDays = (direction: "prev" | "next"): boolean => {
      const span = wholeDaySpan();
      if (!span) return false;
      const from = addCivilDays(span.from, direction === "prev" ? -span.days : span.days);
      const to = addCivilDays(from, span.days - 1);
      const ceiling = forwardCeilingMicros();
      if (civilDayStart(from) >= ceiling) return true;
      const end =
        convertToUtcTimestamp(`${to} 23:59:59`, zone.value) > ceiling
          ? convertUnixTime(ceiling)
          : { date: to, time: "23:59:59" };
      const endUs = convertToUtcTimestamp(`${end.date} ${end.time}`, zone.value);
      if (exceedsRangeRestriction(civilDayStart(from), endUs, props.queryRangeRestrictionInHour)) {
        showRestrictionToast();
        return true;
      }
      captureUndo();
      selectedDate.value.from = from;
      selectedDate.value.to = end.date;
      selectedTime.value.endTime = end.time;
      seededEnd = null;
      menuOpen.value = false;
      if (!props.autoApply) saveDate("absolute");
      return true;
    };

    // The calendar's own bounds for a start, named so a refusal says which one it hit.
    const startBoundError = (startMicros: number): I18nText | null => {
      if (!Number.isFinite(startMicros)) return null;
      const civilDay = (date: string) =>
        formatCivilDay(date, zone.value, tooltipNow.value, intlLocale.value);
      const floor = convertToUtcTimestamp(`${calendarMinDate.value} 00:00:00`, zone.value);
      if (startMicros < floor) {
        return t("common.timeRangeBeforeMin", { date: civilDay(calendarMinDate.value) });
      }
      if (startMicros < selectionCeilingMicros()) return null;
      return props.maxDate
        ? t("common.timeRangeAfterMax", { date: civilDay(props.maxDate) })
        : t("common.timeRangeStartInFuture");
    };

    // The exclusive end of maxDate (its next midnight), or now.
    const forwardCeilingMicros = () =>
      props.maxDate
        ? absoluteToMicros(addCivilDays(props.maxDate, 1), "00:00:00")
        : Date.now() * 1000;

    // Absolute-only pickers floored by minDate with no maxDate book ahead, so as on main only their calendar and shift stop at now.
    const selectionCeilingMicros = () =>
      props.disableRelative && props.minDate && !props.maxDate
        ? Number.POSITIVE_INFINITY
        : forwardCeilingMicros();

    const isNextShiftDisabled = () => {
      if (selectedType.value === "relative") {
        return (parseCalendarToken(calendarToken.value)?.offset ?? 0) === 0;
      }
      const span = wholeDaySpan();
      if (span) return civilDayStart(addCivilDays(span.from, span.days)) >= forwardCeilingMicros();
      const { endUTC } = getUTCTimeStamp();
      return !(endUTC + MICROS_PER_SECOND <= forwardCeilingMicros());
    };

    // Ctrl+Shift+C opens DevTools off macOS, so there the combo is Alt+Shift+C; the key code survives layouts.
    const isCopyRangeKey = (event: KeyboardEvent) =>
      event.shiftKey &&
      event.code === "KeyC" &&
      (isMacOS()
        ? event.metaKey && !event.ctrlKey && !event.altKey
        : event.altKey && !event.ctrlKey && !event.metaKey);

    // Escape backs out one layer: the list cursor or typed text, a pending day, the calendar, then the panel.
    const onPickerKeydown = (event: KeyboardEvent) => {
      if (isCopyRangeKey(event)) {
        // Handled on the panel so a page's own copy-URL binding of the same combo never wins while it is open.
        event.preventDefault();
        event.stopPropagation();
        copyRange();
        return;
      }
      if (event.key !== "Escape") return;
      const target = event.target;
      // A pin's name field cancels its own edit.
      if (
        target instanceof HTMLElement &&
        target.closest("[data-test='date-time-list-pin-name']")
      ) {
        return;
      }
      if (escapeInput(event)) return;
      // A half-picked day is dropped and the calendar stays; caught here so reka never restores its old range.
      if (pendingDay.value !== null) {
        event.preventDefault();
        event.stopPropagation();
        calendarRef.value?.clearPending();
        restoreAppliedSelection();
        pendingDay.value = null;
        calendarPreviewDay.value = null;
        return;
      }
      if (calendarMode.value && !props.disableRelative) {
        event.preventDefault();
        event.stopPropagation();
        closeCalendar();
        return;
      }
      // An open tooltip is the topmost dismissable layer and would take this Escape, so the panel closes itself; the zone list keeps its own Escape.
      if (!isTimezoneSelectOpen.value) {
        event.preventDefault();
        closeMenu();
      }
    };

    // The per-unit maxima follow the restriction alone, so a period typed while the selection is absolute is still capped.
    const computeRelativeMaxima = () => {
      const limitSeconds = props.queryRangeRestrictionInHour * 3_600;
      relativePeriodsMaxValue.value = Object.fromEntries(
        periodUnits.map((unit) => {
          if (!(limitSeconds > 0)) return [unit, 0];
          const max = Math.floor(limitSeconds / UNIT_SECONDS[unit]);
          return [unit, max >= 1 ? max : -1];
        }),
      );
    };

    // Limits arrive after mount, so a clamp here is never the user's pick.
    const computeRelativePeriod = () => {
      markProgrammaticDateChange();
      computeRelativeMaxima();
      if (selectedType.value === "relative") {
        if (calendarExceedsRestriction(calendarToken.value)) {
          // Clamped like a too-long rolling range: to the largest window the page allows.
          const unit = [...periodUnits].reverse().find((u) => relativePeriodsMaxValue.value[u] > 0);
          if (unit) {
            setRelativeDate(unit, relativePeriodsMaxValue.value[unit]);
          } else {
            calendarToken.value = null;
            if (props.autoApply) saveDate("relative");
          }
        }

        if (props.queryRangeRestrictionInHour > 0) {
          const maxRelativeValue = relativePeriodsMaxValue.value[relativePeriod.value];

          try {
            if (maxRelativeValue !== -1 && relativeValue.value > maxRelativeValue) {
              setRelativeDate(...largestExactUnit(relativePeriod.value, maxRelativeValue));
            } else if (maxRelativeValue === -1) {
              const periodIndex = periodUnits.indexOf(relativePeriod.value);
              for (let i = periodIndex; i >= 0; i--) {
                if (relativePeriodsMaxValue.value[periodUnits[i]] > -1) {
                  setRelativeDate(periodUnits[i], 1);
                  break;
                }
              }
            }
          } catch (e) {
            console.log("Error while setting relative date", e);
          }
        }
      }
    };

    const showOnlyAbsolute = () => {
      if (props.disableRelative) {
        setDateType("absolute");
      }
    };

    const onHide = () => {
      emit("hide");
    };

    const onShow = () => {
      emit("show");
    };

    // Recent never shows what a pin, chip or calendar row offers, so storing it would only push out ranges it does show.
    const recordEntry = (entry: TimeRangeHistoryEntry) => {
      if (isOfferedElsewhere(entry, offeredElsewhere.value)) return;
      if (isRelativeHistoryEntry(entry)) timeRangeHistory.addRelative(entry.relative);
      else timeRangeHistory.add(entry.startUs, entry.endUs);
    };

    const recordSelection = () => {
      if (!showRail.value) return;
      if (selectedType.value === "relative") {
        recordEntry({ relative: currentRelativePeriod() });
        return;
      }
      const { startUTC, endUTC } = getUTCTimeStamp();
      recordEntry({ startUs: startUTC, endUs: endUTC });
    };

    // An auto-applied selection is final only when the panel closes, not after every edit.
    let rangeKeyAtOpen: string | null = null;
    const menuOpen = ref(false);

    // While the open panel holds a relative selection, Start/End show the range it resolves to.
    watch(
      () => [
        menuOpen.value,
        selectedType.value,
        calendarToken.value,
        relativePeriod.value,
        relativeValue.value,
        zone.value,
        tooltipNow.value,
      ],
      () => {
        if (!menuOpen.value || selectedType.value !== "relative" || timeFieldFocused.value) return;
        if (calendarToken.value === null && !isValidCustomValue(relativeValue.value)) return;
        seedAbsoluteFromSelection();
      },
    );

    // Calendar labels name a day and the rail ends "so far" ranges at now, so the clock runs only while one is shown.
    const needsClock = computed(
      () =>
        menuOpen.value ||
        (props.calendarPresets &&
          (calendarToken.value !== null || appliedCalendarToken.value !== null)),
    );
    let clockTick: ReturnType<typeof setInterval> | null = null;
    const stopClock = () => {
      if (clockTick !== null) clearInterval(clockTick);
      clockTick = null;
    };
    const syncClock = () => {
      if (!needsClock.value) return stopClock();
      if (clockTick !== null) return;
      refreshTooltipNow();
      clockTick = setInterval(refreshTooltipNow, 60_000);
    };
    watch(needsClock, syncClock, { immediate: true });
    onActivated(syncClock);
    onDeactivated(stopClock);
    onBeforeUnmount(stopClock);
    onBeforeUnmount(cancelPendingRead);
    const onMenuOpenChange = (open: boolean) => {
      if (open) {
        refreshTooltipNow();
        pendingDay.value = null;
        endBeforeCut = null;
        clearInput();
        clearTimeFieldErrors();
        listCursor.value = -1;
        editingPinRowId.value = null;
        calendarPreviewDay.value = null;
        zoneRedrawn.value = false;
        // A dates-only picker has no list, so its calendar is the panel.
        calendarMode.value = props.disableRelative;
        appliedSinceOpen = false;
        absoluteAtOpen = {
          date: { ...selectedDate.value },
          time: { ...selectedTime.value },
          seededEnd,
        };
        rangeKeyAtOpen = selectionKey.value;
        onBeforeShow();
        onShow();
      } else {
        if (props.autoApply && commitPendingDay()) saveDate("absolute");
        pendingDay.value = null;
        clearInput();
        listCursor.value = -1;
        editingPinRowId.value = null;
        if (!props.autoApply || selectedType.value !== appliedSelection.selectedType) {
          restoreAppliedSelection();
        } else if (selectionKey.value !== rangeKeyAtOpen) {
          recordSelection();
        }
        onBeforeHide();
        onHide();
      }
    };

    // Typing lands in the bar, which leads the Tab order; on a touch screen, where focusing it raises the keyboard, reka's default focus stays.
    const onPopoverOpenAutoFocus = (event: Event) => {
      const touch = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const box = touch
        ? null
        : document.querySelector<HTMLElement>(
            "#date-time-menu [data-test='date-time-input-field']",
          );
      // With no bar, reka's default focus stays inside the panel, or ⌘V would never reach it.
      if (!box) return;
      event.preventDefault();
      box.focus();
    };

    // A pick closes the panel the way a user dismissal does, so listeners waiting on hide still run.
    const closeMenu = () => {
      if (!menuOpen.value) return;
      menuOpen.value = false;
      onMenuOpenChange(false);
    };

    const openMenu = () => {
      if (menuOpen.value || props.disable) return;
      menuOpen.value = true;
      onMenuOpenChange(true);
    };

    // A single clicked day applies as that day.
    const commitPendingDay = (): boolean => {
      const day = pendingDay.value;
      pendingDay.value = null;
      if (!day || selectedType.value !== "absolute") return false;
      writeSeededFields({ from: day, to: day });
      fitPickedDays(day, day);
      endBeforeCut = null;
      return true;
    };

    const applyAndClose = () => {
      clearUndo();
      commitPendingDay();
      saveDate(null);
      recordSelection();
      menuOpen.value = false;
    };

    const openCalendar = () => {
      calendarMode.value = true;
      listCursor.value = -1;
      editingPinRowId.value = null;
    };

    // Leaving the calendar keeps whatever it applied; a half-picked day is dropped.
    const closeCalendar = () => {
      calendarMode.value = false;
      typedFieldTime.value = null;
      clearTimeFieldErrors();
      pendingDay.value = null;
      calendarPreviewDay.value = null;
      nextTick(() => inputBar.value?.focus());
    };

    const applyCalendarItem = (id: string) => {
      const preset = CALENDAR_RAIL_ITEMS.find((item) => item.id === id);
      if (!preset) return;
      clearUndo();
      selectedType.value = "relative";
      calendarToken.value = preset.token;
      pendingDay.value = null;
      saveDate("relative");
      recordSelection();
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    // A chip applies at once, like a row, and is the only control that lights for the range it applied.
    const pickChip = (value: string) => {
      const rolling = parseRollingPeriod(value);
      if (!rolling) return;
      clearUndo();
      selectedType.value = "relative";
      calendarToken.value = null;
      pendingDay.value = null;
      relativePeriod.value = rolling.unit;
      relativeValue.value = rolling.value;
      lastValidCustomValue.value = rolling.value;
      saveDate("relative");
      recordSelection();
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const onChipToggle = (value: unknown) => {
      if (typeof value === "string" && value) pickChip(value);
    };

    const applyRecentPeriod = (period: string) => {
      selectedType.value = "relative";
      pendingDay.value = null;
      if (parseCalendarToken(period)) {
        calendarToken.value = period;
      } else {
        calendarToken.value = null;
        readRelativeTime(period);
      }
      saveDate("relative");
      recordEntry({ relative: period });
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const applyHistoryEntry = (entry: TimeRangeHistoryEntry) => {
      clearUndo();
      if (isRelativeHistoryEntry(entry)) {
        applyRecentPeriod(entry.relative);
        return;
      }
      const range = boundedRange(entry.startUs, entry.endUs);
      if (!range) return;
      const start = convertUnixTime(range.start);
      // An exclusive midnight end shows as the previous day's last second, as the row label does.
      const endsAtMidnight =
        range.end % MICROS_PER_SECOND === 0 && convertUnixTime(range.end).time === "00:00:00";
      const end = convertUnixTime(endsAtMidnight ? range.end - 1 : range.end);
      if (endsAtMidnight) rememberShownEnd(range.end);
      else seededEnd = null;
      // Saved once below, so the auto-apply date watcher must not save it a second time.
      writeSeededFields({
        from: start.date,
        to: end.date,
        startTime: start.time,
        endTime: end.time,
      });
      selectedType.value = "absolute";
      calendarToken.value = null;
      saveDate("absolute");
      recordEntry(entry);
      rangeKeyAtOpen = selectionKey.value;
      closeMenu();
    };

    const applyRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (entry) applyHistoryEntry(entry);
    };

    const removeRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (entry) timeRangeHistory.remove(entry);
    };

    const pinOf = (rowId: string) =>
      timeRangePins.pins.value.find((pin) => `pinned-${pin.id}` === rowId);

    // Row ids carry what they apply: a pin id, a Recent index or a calendar preset id.
    const pickListRow = (index: number) => {
      const row = listRows.value[index];
      if (!row || row.disabled) return;
      if (row.kind === "pinned") {
        const pin = pinOf(row.id);
        if (pin) applyHistoryEntry(pin.range);
      } else if (row.kind === "recent") applyRecentRange(row.id.slice("recent-".length));
      else if (row.kind === "calendar") applyCalendarItem(row.id.slice("calendar-".length));
    };

    // An example is copied into the bar to be read, never applied.
    const takeExample = (text: string) => {
      inputText.value = text;
      onInputEdit();
      readInputText();
      inputBar.value?.focus();
    };

    const pickShownRow = (index: number) => {
      const example = exampleRows.value[index];
      if (example) {
        takeExample(example.label);
        return;
      }
      if (index < readingRows.value.length) {
        commitInput();
        return;
      }
      const suggestions = suggestionListRows.value.length;
      if (index < suggestions) applySuggestion(index);
      else pickListRow(index - listOffset.value);
    };

    const pinRecentRow = (rowId: string) => {
      const entry = timeRangeHistory.entries.value[Number(rowId.slice("recent-".length))];
      const id = entry ? timeRangePins.pin(entry) : null;
      if (id) editingPinRowId.value = `pinned-${id}`;
      listCursor.value = -1;
    };

    const unpinRow = (rowId: string) => {
      const pin = pinOf(rowId);
      if (pin) timeRangePins.unpin(pin.id);
      listCursor.value = -1;
    };

    const removeRecentRow = (rowId: string) => {
      removeRecentRange(rowId.slice("recent-".length));
      listCursor.value = -1;
    };

    // Saving or leaving the name returns focus to the bar, where the list keys work.
    const renamePin = (rowId: string, name: string) => {
      const pin = pinOf(rowId);
      if (pin) timeRangePins.rename(pin.id, name);
      editingPinRowId.value = null;
      nextTick(() => inputBar.value?.focus());
    };

    const cancelPinName = () => {
      editingPinRowId.value = null;
      nextTick(() => inputBar.value?.focus());
    };

    const undoStack = ref<TimeRangeUndoStep[]>([]);

    const clearUndo = () => {
      undoStack.value = [];
    };

    // A range the page sets replaces the one undo leads back from, unless it echoes or answers this picker's own emit.
    const clearUndoForPageRange = (range: {
      relativeTimePeriod?: string | null;
      startTime?: unknown;
      endTime?: unknown;
    }) => {
      if (emittingOwnChange) return;
      const last = datePayload.value as Partial<ConsumableDateTime>;
      const echoed = range.relativeTimePeriod
        ? last.valueType === "relative" && last.relativeTimePeriod === range.relativeTimePeriod
        : last.valueType === "absolute" &&
          Number(last.startTime) === Number(range.startTime) &&
          Number(last.endTime) === Number(range.endTime);
      if (!echoed) clearUndo();
    };

    // The step names what the trigger showed, so the undo tooltip reads the range it returns to.
    const captureUndo = () => {
      if (!props.undoable || props.hideRangeShift) return;
      const { startTime, endTime } = getConsumableDateTime();
      undoStack.value = pushUndoStep(undoStack.value, {
        label: String(triggerLabel.value),
        selectedType: appliedSelection.selectedType,
        calendarToken: appliedSelection.calendarToken,
        relativePeriod: appliedSelection.relativePeriod,
        relativeValue: appliedSelection.relativeValue,
        startUs: startTime,
        endUs: endTime,
      });
    };

    const undoRange = () => {
      const popped = popUndoStep(undoStack.value);
      if (!popped) return;
      const { step } = popped;
      undoStack.value = popped.rest;
      selectedType.value = step.selectedType;
      calendarToken.value = step.calendarToken;
      relativePeriod.value = step.relativePeriod;
      relativeValue.value = step.relativeValue;
      pendingDay.value = null;
      if (step.selectedType === "absolute") {
        heldInstants = null;
        writeAbsoluteFields(step.startUs, step.endUs);
        holdUnshownInstants(step.startUs, step.endUs);
      }
      menuOpen.value = false;
      saveDate(step.selectedType);
      emit("on:undo", step);
    };

    const showUndo = computed(
      () => props.undoable && !props.hideRangeShift && undoStack.value.length > 0,
    );

    const undoTooltip = computed(() => {
      const top = undoStack.value[undoStack.value.length - 1];
      return top ? t("dateTime.backTo", { range: top.label }) : t("dateTime.undo");
    });

    // A badge when the zone differs from the browser's (P7), or always where the page asks (dashboards, print).
    const zoneBadgeText = computed(() => {
      if (!zone.value || props.hideRelativeTimezone) return "";
      if (props.zoneBadge === "always") return formatZoneOffset(zone.value, tooltipNow.value);
      return zone.value !== browserTz ? formatZoneBadge(zone.value, tooltipNow.value) : "";
    });

    const zoneShortLabel = computed(() => {
      const offset = zoneOffset(zone.value, tooltipNow.value);
      if (zone.value === "UTC" || offset === "+00:00") return "UTC";
      return offset ? `UTC${offset}` : zone.value;
    });

    // Days wholly before retention are struck in the calendar; separate from minDate so typed text is not refused.
    const retentionFloorDay = computed<string | null>(() => {
      const floor = retentionFloorMicros(props.retentionDays, tooltipNow.value);
      if (floor === null) return null;
      const day = convertUnixTime(floor).date;
      return day > calendarMinDate.value ? day : null;
    });

    // One binding per key app-wide: two pickers registering the same ids would unregister each other.
    const shortcutToken = Symbol("date-time");
    const takesShortcuts = computed(
      () => props.shortcuts && !props.hideRangeShift && !props.disableRelative,
    );
    const shortcutActions: Record<string, () => void> = {
      open: openMenu,
      prev: () => {
        if (!props.disable && !props.disablePrevShift) shiftTimeRange("prev");
      },
      next: () => {
        if (!props.disable && !isNextShiftDisabled()) shiftTimeRange("next");
      },
      zoomOut: () => {
        if (!props.disable && !props.hideRelativeTime) zoomOut();
      },
      undo: () => {
        if (!props.disable) undoRange();
      },
    };
    const joinShortcuts = () => {
      if (!takesShortcuts.value) return;
      if (shortcutPickers.value.some((item) => item.token === shortcutToken)) return;
      shortcutPickers.value = [
        ...shortcutPickers.value,
        { token: shortcutToken, act: shortcutActions },
      ];
    };
    const leaveShortcuts = () => {
      shortcutPickers.value = shortcutPickers.value.filter((item) => item.token !== shortcutToken);
    };
    const holdsShortcuts = computed(() => shortcutPickers.value[0]?.token === shortcutToken);
    const onNewestPicker = (action: string) => () =>
      shortcutPickers.value[shortcutPickers.value.length - 1]?.act[action]?.();
    onMounted(joinShortcuts);
    onActivated(joinShortcuts);
    // Print and kiosk modes turn the page's keys off while the picker stays mounted.
    watch(takesShortcuts, (takes) => (takes ? joinShortcuts() : leaveShortcuts()));
    onDeactivated(leaveShortcuts);
    onBeforeUnmount(leaveShortcuts);

    useShortcuts(
      [
        { id: "timeRangeOpen", handler: onNewestPicker("open") },
        { id: "timeRangePrevious", handler: onNewestPicker("prev") },
        { id: "timeRangeNext", handler: onNewestPicker("next") },
        { id: "timeRangeZoomOut", handler: onNewestPicker("zoomOut") },
        { id: "timeRangeUndo", handler: onNewestPicker("undo") },
      ],
      undefined,
      { active: holdsShortcuts },
    );

    const weekStart = computed(() => weekStartsOn());

    // From a live range the calendar has no start yet, so there is nothing to apply.
    const needsStartDate = computed(
      () =>
        calendarMode.value &&
        !props.disableRelative &&
        selectedType.value === "relative" &&
        pendingDay.value === null,
    );
    const applyDisabled = computed(
      () => needsStartDate.value || unreadableFields.value.start || unreadableFields.value.end,
    );

    // The native change fires after keydown, so blurring commits the typed text before Apply reads it.
    const onTimeFieldEnter = (event: KeyboardEvent) => {
      const field = event.target as HTMLInputElement | null;
      field?.blur();
      nextTick(() => {
        if (timeFieldError.value === null && !applyDisabled.value) applyAndClose();
        else field?.focus();
      });
    };

    const summaryError = computed<{ message: I18nText; examples?: I18nText } | null>(() => {
      if (inputError.value) {
        return {
          message: inputErrorText.value,
          examples: inputRefusal.value ? undefined : t("common.timeRangeInputExamples"),
        };
      }
      if (timeFieldError.value) return { message: timeFieldError.value.message };
      if (!unreadableFields.value.start && !unreadableFields.value.end) return null;
      return {
        message: t("components.time.invalid", { format: raw("HH:MM") }),
        examples: t("common.timeFieldExamples"),
      };
    });

    const showLiveButton = computed(
      () =>
        !props.disableRelative &&
        selectedType.value === "absolute" &&
        previewLine.value === null &&
        resolvedLine.value.fixed === true,
    );

    const liveDurationLabel = computed(() => {
      const range = pendingRange.value;
      if (!range || !(range.endTime > range.startTime)) return "";
      const span = Math.min(range.endTime - range.startTime, restrictionLimitMicros());
      return formatRangeDuration(0, span);
    });

    // The window a step would move to, for the ‹ › tooltips.
    const stepTooltip = computed(() => {
      const range = pendingRange.value;
      const valid = !!range && range.endTime > range.startTime;
      const span = valid ? range.endTime - range.startTime : 0;
      const duration = valid ? formatRangeDuration(0, span) : "";
      const windowText = (startUs: number, endUs: number) =>
        formatRangeLabel({ startUs, endUs }, { ...labelOptions(), surface: "row" });
      const nextBlocked = isNextShiftDisabled();
      const ceiling = forwardCeilingMicros();
      return {
        prev: {
          title: String(t("dateTime.previousDuration", { duration })),
          window: valid ? windowText(range.startTime - span, range.startTime) : "",
        },
        next: {
          title: String(
            nextBlocked ? t("dateTime.alreadyAtNow") : t("dateTime.nextDuration", { duration }),
          ),
          window:
            valid && !nextBlocked
              ? windowText(range.endTime, Math.min(range.endTime + span, ceiling))
              : "",
        },
        zoom: valid
          ? t("dateTime.zoomOutTo", { duration: formatRangeDuration(0, span * 2) })
          : t("common.timeRangeZoomOut"),
      };
    });

    // Spoken in the panel: the preview, or the cursor row and its place in the list.
    const panelSpeech = computed(() => {
      const row = activeRow.value >= 0 ? shownRows.value[activeRow.value] : null;
      if (row) {
        const position = t("dateTime.rowPosition", {
          n: activeRow.value + 1,
          total: shownRows.value.length,
        });
        return [row.label, row.meta, String(position)].filter(Boolean).join(", ");
      }
      const line = previewLine.value;
      if (!line) return "";
      const kind = line.live ? kindText(true) : line.fixed ? kindText(false) : "";
      return [line.name, line.range, kind, line.duration, line.note].filter(Boolean).join(", ");
    });

    onMounted(() => {
      if (!props.defaultOpen) return;
      // The click that mounted this picker must finish first, or the popover reads it as an outside click.
      nextTick(() => {
        menuOpen.value = true;
        onMenuOpenChange(true);
      });
    });

    return {
      raw,
      t,
      POPOVER_COLLISION_PADDING,
      menuOpen,
      onMenuOpenChange,
      onPopoverOpenAutoFocus,
      datetimeBtn,
      getImageURL,
      setRelativeDate,
      relativePeriods,
      showRail,
      applyCalendarItem,
      applyRecentRange,
      removeRecentRange,
      applyAndClose,
      pendingDay,
      calendarToken,
      calendarTooltip,
      triggerTooltip,
      refreshTooltipNow,
      saveDate,
      onBeforeShow,
      selectedType,
      selectedTime,
      selectedDate,
      relativePeriod,
      relativeValue,
      displayValue,
      triggerLabel,
      copyRange,
      pasteRange,
      onPickerPaste,
      refresh,
      dateLocale,
      resetTime,
      onTimezoneChange,
      timezone,
      filteredTimezone,
      timezoneFilterFn,
      setCustomDate,
      setSavedDate,
      optionsFn,
      setDateType,
      shiftTimeRange,
      zoomOut,
      goLive,
      inputText,
      inputError,
      inputErrorText,
      inputAsUtc,
      inputRefusal,
      onInputEdit,
      onInputKeydown,
      onBarFocusOut,
      inputBar,
      timeFieldError,
      unreadableFields,
      toggleAsUtc,
      asUtcLabel,
      resolvedLine,
      previewLine,
      shownLine,
      suggestionsOpen,
      suggestionRows,
      activeSuggestion,
      applySuggestion,
      startDayLabel,
      endDayLabel,
      inputErrorId,
      onCalendarStartDate,
      onCalendarEndDate,
      onCalendarPendingDay,
      onStartTimeEdit,
      onEndTimeEdit,
      onTimeFieldBlur,
      onTimeFieldTyping,
      typedFieldTime,
      groupEl,
      timeFieldFocused,
      isNextShiftDisabled,
      onPickerKeydown,
      getConsumableDateTime,
      setAbsoluteTime,
      setRelativeTime,
      getDisplayValue,
      relativePeriodsMaxValue,
      computeRelativePeriod,
      onBeforeHide,
      showOnlyAbsolute,
      onShow,
      onHide,
      calendarMinDate,
      calendarMaxDate,
      timezoneSelectOptions,
      isTimezoneSelectOpen,
      listId,
      calendarMode,
      openCalendar,
      closeCalendar,
      typing,
      shownRows,
      activeRow,
      listCursor,
      pickShownRow,
      pinRecentRow,
      unpinRow,
      removeRecentRow,
      renamePin,
      cancelPinName,
      editingPinRowId,
      showChips,
      chipItems,
      litChip,
      onChipToggle,
      pickChip,
      undoRange,
      showUndo,
      undoTooltip,
      zoneBadgeText,
      zoneShortLabel,
      openMenu,
      isMobile,
      intlLocale,
      weekStart,
      retentionFloorDay,
      calendarRef,
      calendarPreviewDay,
      applyDisabled,
      needsStartDate,
      onTimeFieldInvalid,
      onTimeFieldEnter,
      summaryError,
      showLiveButton,
      liveDurationLabel,
      stepTooltip,
      panelSpeech,
      appliedSpeech,
      triggerAriaLabel,
      triggerElement,
      triggerTooltipOpen,
      onTriggerHover,
      copyDisabled,
      copyShortcut,
      chipsNotes,
      listHeading,
      setCursorRow,
    };
  },
  computed: {
    relativePeriodWatch() {
      return this.queryRangeRestrictionInHour;
    },
  },
  watch: {
    relativePeriodWatch() {
      this.computeRelativePeriod();
    },
  },
});
</script>
