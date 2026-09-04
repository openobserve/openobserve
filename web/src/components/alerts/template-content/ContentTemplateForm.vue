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
<!--
  ContentTemplateForm: the "content" (structured, kind="content") template
  editor. Owns a ContentSpec value passed in/out via v-model — NOT bound as
  OForm fields, because ContentSpec is a nested object (arrays of rows, a
  record of overrides) serialized into the parent AddTemplate form's plain
  `body` string field, the same bridging pattern AddTemplate.vue already uses
  for its bare Monaco editor.

  First-run redesign (Task 17): only Title + Message are visible by default.
  Fields, Links, Matching rows and Channel titles all live behind ONE
  "Add to this template" disclosure, which auto-opens whenever the spec
  already carries content in any of those sections (hasOptionalContent) so
  opening a saved template never hides data the user wrote.
-->
<template>
  <div class="flex flex-col gap-5" data-test="content-template-form-container">
    <div class="o2-input w-full">
      <OInput
        :model-value="spec.title"
        :label="t('alert_templates.contentTitle')"
        :placeholder="t('alert_templates.contentTitlePlaceholder')"
        data-test="content-template-form-title-input"
        @update:model-value="(v) => updateField('title', String(v ?? ''))"
      />
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-0.5 font-bold" data-test="content-template-form-body-title">
        <span>{{ t("alert_templates.contentBody") }}</span>
      </div>
      <div class="flex flex-wrap gap-1" data-test="content-template-form-toolbar">
        <OButton
          v-for="action in toolbarActions"
          :key="action.name"
          variant="ghost"
          size="icon-sm"
          :icon-left="action.icon"
          :aria-label="action.label"
          :title="action.label"
          :data-test="`content-template-form-toolbar-${action.name}-btn`"
          @click="applyToolbarAction(action.name)"
        />
        <OPopover side="bottom" align="start" content-class="p-1.5">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="add-reaction"
              :aria-label="t('alert_templates.toolbarEmoji')"
              :title="t('alert_templates.toolbarEmoji')"
              data-test="content-template-form-toolbar-emoji-btn"
            />
          </template>
          <div class="grid grid-cols-4 gap-0.5" data-test="content-template-form-emoji-picker">
            <OButton
              v-for="emoji in emojiOptions"
              :key="emoji.char"
              variant="ghost"
              size="icon-sm"
              :aria-label="emoji.label"
              :title="emoji.label"
              :data-test="`content-template-form-emoji-${emoji.name}-btn`"
              @click="insertText(emoji.char)"
              >{{ emoji.char }}</OButton
            >
          </div>
        </OPopover>
      </div>
      <!-- `:key` forces a remount on language change — CodeQueryEditor only
           reads `language` at monaco.editor.create() time (see AddTemplate.vue
           for the full rationale). This editor is always markdown, but the
           remount hack is kept in place for consistency and future-proofing. -->
      <QueryEditor
        ref="bodyEditorRef"
        :key="'markdown'"
        data-test="content-template-form-body-editor"
        editor-id="content-template-body-editor"
        class="rounded-default border-card-glass-border min-h-77.5 w-full resize-y overflow-auto border"
        language="markdown"
        :query="spec.body"
        @update:query="(v: string) => updateField('body', v ?? '')"
      />
      <span
        v-if="bodyMarkdownLintHint"
        class="text-text-secondary text-xs"
        data-test="content-template-form-body-lint-hint"
        >{{
          t("alert_templates.bodyMarkdownLint", {
            line: bodyMarkdownLintHint.line,
            marker: bodyMarkdownLintHint.marker,
          })
        }}</span
      >
      <div
        class="flex flex-wrap items-center gap-1"
        data-test="content-template-form-variable-chips"
      >
        <OButton
          v-for="variable in visibleVariables"
          :key="variable"
          variant="outline"
          size="chip"
          :data-test="`content-template-form-variable-chip-${variable}-btn`"
          :aria-label="t('alert_templates.insertVariable') + ' ' + variable"
          @click="insertVariable(variable)"
          >{{ variableChipLabel(variable) }}</OButton
        >
        <OButton
          v-if="hiddenVariableCount > 0"
          variant="ghost"
          size="chip"
          data-test="content-template-form-variable-chips-more-btn"
          @click="showAllVariables = true"
          >{{ t("alert_templates.moreVariables", { count: hiddenVariableCount }) }}</OButton
        >
      </div>
    </div>

    <OCollapsible
      :default-open="hasOptionalContentInitially"
      :label="t('alert_templates.addToTemplate')"
      :caption="t('alert_templates.addToTemplateCaption')"
      data-test="content-template-form-optional-collapsible"
    >
      <!-- Each optional section is a card styled like the alert-creation
           screen's section headers (AddAlert.vue): glass background, bordered
           header row with the theme-accent stripe beside a compact semibold
           title, content padded below. -->
      <div class="flex flex-col gap-4 pt-3">
        <div class="bg-card-glass-bg rounded-default overflow-hidden">
          <div class="border-border-default flex items-center gap-0 border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span
              class="text-compact font-semibold tracking-[0.01em]"
              data-test="content-template-form-fields-title"
              >{{ t("alert_templates.fieldsSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-2 px-3 py-3">
            <div
              class="text-text-secondary text-xs"
              data-test="content-template-form-fields-description"
            >
              {{ t("alert_templates.fieldsSectionDescription") }}
            </div>
            <ContentFieldsEditor
              :rows="spec.fields"
              value-key="value"
              :label-label="t('alert_templates.fieldLabel')"
              :value-label="t('alert_templates.fieldValue')"
              :label-placeholder="t('alert_templates.fieldLabelPlaceholder')"
              :value-placeholder="t('alert_templates.fieldValuePlaceholder')"
              :add-label="t('alert_templates.addField')"
              data-test-prefix="content-template-form-fields"
              @update:rows="(rows) => updateField('fields', rows as ContentField[])"
            />
          </div>
        </div>

        <div class="bg-card-glass-bg rounded-default overflow-hidden">
          <div class="border-border-default flex items-center gap-0 border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span
              class="text-compact font-semibold tracking-[0.01em]"
              data-test="content-template-form-links-title"
              >{{ t("alert_templates.linksSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-2 px-3 py-3">
            <div
              class="text-text-secondary text-xs"
              data-test="content-template-form-links-description"
            >
              {{ t("alert_templates.linksSectionDescription") }}
            </div>
            <ContentFieldsEditor
              :rows="spec.links"
              value-key="url"
              :label-label="t('alert_templates.linkLabel')"
              :value-label="t('alert_templates.linkUrl')"
              :label-placeholder="t('alert_templates.linkLabelPlaceholder')"
              :value-placeholder="t('alert_templates.linkUrlPlaceholder')"
              :add-label="t('alert_templates.addLink')"
              data-test-prefix="content-template-form-links"
              @update:rows="(rows) => updateField('links', rows as ContentLink[])"
            />
          </div>
        </div>

        <div class="bg-card-glass-bg rounded-default overflow-hidden">
          <div class="border-border-default flex items-center gap-0 border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span
              class="text-compact font-semibold tracking-[0.01em]"
              data-test="content-template-form-rows-title"
              >{{ t("alert_templates.rowsSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-2 px-3 py-3">
            <div
              class="text-text-secondary text-xs"
              data-test="content-template-form-rows-description"
            >
              {{ t("alert_templates.rowsSectionDescription") }}
            </div>
            <!-- One wrapping line: [switch] [max] [format]. `items-end` seats
               the switch on the inputs' baseline (their labels sit above,
               making them taller — centering left the switch hovering mid-air,
               live-UX-audit finding). Fixed widths keep all three on one line
               at normal panel widths. -->
            <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
              <OSwitch
                :model-value="spec.rows.enabled"
                :label="t('alert_templates.rowsEnabled')"
                class="shrink-0 pb-2"
                data-test="content-template-form-rows-enabled-switch"
                @update:model-value="(v) => updateRows('enabled', Boolean(v))"
              />
              <template v-if="spec.rows.enabled">
                <OInput
                  type="number"
                  width="sm"
                  class="shrink-0"
                  :model-value="spec.rows.max"
                  :label="t('alert_templates.rowsMax')"
                  data-test="content-template-form-rows-max-input"
                  @update:model-value="(v) => updateRows('max', clampRowsMax(v))"
                />
                <OInput
                  width="md"
                  class="shrink-0"
                  :model-value="spec.rows.format ?? ''"
                  :label="t('alert_templates.rowsFormat')"
                  :placeholder="t('alert_templates.rowsFormatPlaceholder')"
                  data-test="content-template-form-rows-format-input"
                  @update:model-value="(v) => updateRows('format', String(v ?? ''))"
                />
              </template>
            </div>
            <span
              v-if="spec.rows.enabled"
              class="text-text-secondary text-xs"
              data-test="content-template-form-rows-format-caption"
              >{{ t("alert_templates.rowsFormatCaption") }}</span
            >
            <span
              v-if="spec.rows.enabled && rowsFormatLintHint"
              class="text-text-secondary text-xs"
              data-test="content-template-form-rows-format-lint-hint"
              >{{ t("alert_templates.rowsFormatLint") }}</span
            >
          </div>
        </div>

        <div class="bg-card-glass-bg rounded-default overflow-hidden">
          <div class="border-border-default flex items-center gap-0 border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span
              class="text-compact font-semibold tracking-[0.01em]"
              data-test="content-template-form-channel-titles-title"
              >{{ t("alert_templates.channelTitles") }}</span
            >
          </div>
          <div class="flex flex-col gap-2 px-3 py-3">
            <div
              class="text-text-secondary text-xs"
              data-test="content-template-form-channel-titles-description"
            >
              {{ t("alert_templates.channelTitlesDescription") }}
            </div>
            <!-- Dynamic rows (channel + title), mirroring the Fields/Links table:
               only the channels the user actually overrides take up space,
               instead of one permanent input per channel. -->
            <div
              v-if="titleOverrideRows.length > 0"
              class="grid grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2"
              data-test="content-template-form-channel-titles-table"
            >
              <span class="text-text-secondary text-xs font-medium">{{
                t("alert_templates.channelTitleChannel")
              }}</span>
              <span class="text-text-secondary text-xs font-medium">{{
                t("alert_templates.channelTitleTitle")
              }}</span>
              <span></span>
              <div
                v-for="(row, index) in titleOverrideRows"
                :key="index"
                class="contents"
                :data-test="`content-template-form-channel-titles-row-${index}`"
              >
                <!-- `searchable=false`: nine known options need no search
                     box, and dropping it lets the whole list fit the menu
                     without clipping the last entry (live-UX-audit finding). -->
                <OSelect
                  :model-value="row.channel"
                  :options="channelOptionsFor(index)"
                  :searchable="false"
                  :placeholder="t('alert_templates.channelTitleChannelPlaceholder')"
                  :data-test="`content-template-form-channel-titles-row-${index}-channel-select`"
                  @update:model-value="(v) => updateOverrideRow(index, 'channel', String(v ?? ''))"
                />
                <OInput
                  :model-value="row.title"
                  :placeholder="t('alert_templates.channelTitleTitlePlaceholder')"
                  :data-test="`content-template-form-channel-titles-row-${index}-title-input`"
                  @update:model-value="(v) => updateOverrideRow(index, 'title', String(v ?? ''))"
                />
                <OButton
                  variant="ghost-destructive"
                  size="icon-sm"
                  icon-left="delete"
                  :data-test="`content-template-form-channel-titles-row-${index}-remove-btn`"
                  :aria-label="t('common.delete')"
                  @click="removeOverrideRow(index)"
                />
              </div>
            </div>
            <OButton
              variant="dashed"
              size="sm-action"
              icon-left="add"
              class="self-start"
              :disabled="titleOverrideRows.length >= overrideChannels.length"
              data-test="content-template-form-channel-titles-add-btn"
              @click="addOverrideRow"
              >{{ t("alert_templates.addChannelTitle") }}</OButton
            >
          </div>
        </div>

        <div class="bg-card-glass-bg rounded-default overflow-hidden">
          <div class="border-border-default flex items-center gap-0 border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span
              class="text-compact font-semibold tracking-[0.01em]"
              data-test="content-template-form-chart-title"
              >{{ t("alert_templates.chartSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-2 px-3 py-3">
            <div
              class="text-text-secondary text-xs"
              data-test="content-template-form-chart-description"
            >
              {{ t("alert_templates.chartSectionDescription") }}
            </div>
            <OSwitch
              :model-value="spec.chart.enabled"
              :label="t('alert_templates.chartEnabled')"
              data-test="content-template-form-chart-enabled-switch"
              @update:model-value="(v) => updateField('chart', { enabled: Boolean(v) })"
            />
          </div>
        </div>
      </div>
    </OCollapsible>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import ContentFieldsEditor from "./ContentFieldsEditor.vue";
import {
  hasOptionalContent,
  type ContentField,
  type ContentLink,
  type ContentSpec,
  type RowsSpec,
} from "./contentSpec";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

const props = defineProps<{
  modelValue: ContentSpec;
  /**
   * True when this is a brand-new template seeded from `starterContentSpec()`.
   * The seed deliberately carries optional content (matched rows on, three
   * fields), so `hasOptionalContent` is honestly true for it — but none of
   * that is the USER's work yet, and the disclosure exists to keep first run
   * quiet. Existing templates ignore this and open on their real content.
   */
  isSeeded?: boolean;
}>();

const emit = defineEmits<{
  (_e: "update:modelValue", _value: ContentSpec): void;
}>();

const { t } = useI18nTyped();

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
const bodyEditorRef = ref<any>(null);

const spec = computed(() => props.modelValue);

// Computed ONCE at mount (not reactively) — OCollapsible's `default-open` only
// seeds its OWN internal uncontrolled state; re-evaluating this on every spec
// mutation would just be dead weight the collapsible never reads again. This
// still satisfies the "auto-open when populated" requirement because the form
// is freshly mounted (new `key`/parent remount) whenever a different template
// (or a newly-seeded one) is loaded.
// The rule the disclosure actually encodes is "would collapsing hide
// something the USER wrote?" — not "does the spec have optional content".
// For a freshly seeded template the answer is no: they have written nothing
// yet, so first run stays quiet and the seeded rows/fields are discoverable
// behind the disclosure (and visible in the preview regardless).
const hasOptionalContentInitially = !props.isSeeded && hasOptionalContent(spec.value);

// The channel families the backend's resolve_content() keys `title_overrides`
// by (resolve.rs) — every one is honored, not just the human-facing three.
const overrideChannels = [
  "slack",
  "teams",
  "email",
  "discord",
  "pagerduty",
  "opsgenie",
  "servicenow",
  "sns",
  "webhook",
] as const;

const overrideChannelLabels = computed<Record<string, I18nText>>(() => ({
  slack: t("alert_templates.channelTitleSlack"),
  teams: t("alert_templates.channelTitleTeams"),
  email: t("alert_templates.channelTitleEmail"),
  discord: t("alert_templates.channelTitleDiscord"),
  pagerduty: t("alert_templates.channelTitlePagerduty"),
  opsgenie: t("alert_templates.channelTitleOpsgenie"),
  servicenow: t("alert_templates.channelTitleServicenow"),
  sns: t("alert_templates.channelTitleSns"),
  webhook: t("alert_templates.channelTitleWebhook"),
}));

// Row state is LOCAL, not derived reactively from the record: a Record can't
// represent a row whose channel isn't picked yet (or whose title is still
// empty), and the form is remounted per template load (parent `key`), so
// seeding once from the saved record is safe. Every edit re-commits the
// record built from the complete rows only.
const titleOverrideRows = ref<{ channel: string; title: string }[]>(
  Object.entries(props.modelValue.title_overrides).map(([channel, title]) => ({
    channel,
    title,
  })),
);

// Each row's dropdown hides channels already claimed by OTHER rows, so two
// rows can never silently fight over one record key.
const channelOptionsFor = (index: number) => {
  const taken = new Set(
    titleOverrideRows.value.filter((_, i) => i !== index).map((r) => r.channel),
  );
  return overrideChannels
    .filter((c) => !taken.has(c))
    .map((c) => ({ label: overrideChannelLabels.value[c], value: c }));
};

const commitTitleOverrides = () => {
  const record: Record<string, string> = {};
  for (const row of titleOverrideRows.value) {
    if (row.channel && row.title.trim() !== "") record[row.channel] = row.title;
  }
  updateField("title_overrides", record);
};

const updateOverrideRow = (index: number, key: "channel" | "title", value: string) => {
  titleOverrideRows.value[index] = { ...titleOverrideRows.value[index], [key]: value };
  commitTitleOverrides();
};

const removeOverrideRow = (index: number) => {
  titleOverrideRows.value.splice(index, 1);
  commitTitleOverrides();
};

const addOverrideRow = () => {
  titleOverrideRows.value.push({ channel: "", title: "" });
};

const updateField = <K extends keyof ContentSpec>(key: K, value: ContentSpec[K]) => {
  emit("update:modelValue", { ...spec.value, [key]: value });
};

const updateRows = <K extends keyof RowsSpec>(key: K, value: RowsSpec[K]) => {
  emit("update:modelValue", { ...spec.value, rows: { ...spec.value.rows, [key]: value } });
};

const clampRowsMax = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return spec.value.rows.max;
  return Math.min(100, Math.max(1, Math.round(n)));
};

// Lint hint: warn when the row format string references a `{column}` token
// that isn't in the declared columns list. Best-effort — only flags when both
// a format and a non-empty columns list are present.
const rowsFormatLintHint = computed(() => {
  const format = spec.value.rows.format;
  const columns = spec.value.rows.columns;
  if (!format || !columns || columns.length === 0) return false;
  const referenced = Array.from(format.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1]);
  if (referenced.length === 0) return false;
  return referenced.some((token) => !columns.includes(token));
});

// Lint hint: the two malformed-markdown mistakes CommonMark swallows
// SILENTLY. `-foo` (no space) is not a list and `#foo` is not a heading —
// both parse as ordinary paragraph text, so a user who types them sees their
// lines merge into one run with no indication of why. A reported case was
// `-{alert_agg_value}` on consecutive lines rendering as a single paragraph.
//
// Deliberately only these two patterns, and deliberately a HINT: it never
// blocks save, because both forms are legal markdown that a user may have
// meant literally. Reports the first offending line only — a list of every
// line would be noise for the common case of one typo.
const bodyMarkdownLintHint = computed<{ line: number; marker: string } | null>(() => {
  const lines = (spec.value.body ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    // A list marker or a heading marker immediately followed by a non-space.
    //
    // The marker run must be MAXIMAL before the lookahead applies, or `#`
    // backtracks out of `## Summary` and flags a correct heading (and `---`,
    // a valid horizontal rule, would flag as a malformed list). Hence
    // `#{1,6}(?!#)` and a single list char not followed by more of itself.
    const match = /^\s*(#{1,6}(?!#)|-(?!-)|\*(?!\*)|\+(?!\+))(?=\S)/.exec(lines[i]);
    if (match) return { line: i + 1, marker: match[1] };
  }
  return null;
});

// Markdown toolbar: wraps the current Monaco selection with the given
// syntax. CodeQueryEditor exposes its raw Monaco instance as `editorObj`
// (see CodeQueryEditor.vue's setup() return), so the template ref reaches it
// directly rather than adding a new prop surface to that shared component.
interface ToolbarAction {
  name: string;
  icon: IconName;
  label: string;
}

const toolbarActions = computed<ToolbarAction[]>(() => [
  { name: "bold", icon: "format-bold", label: t("alert_templates.toolbarBold") },
  { name: "italic", icon: "format-italic", label: t("alert_templates.toolbarItalic") },
  { name: "code", icon: "code", label: t("alert_templates.toolbarCode") },
  { name: "list", icon: "format-list-bulleted", label: t("alert_templates.toolbarList") },
  { name: "link", icon: "link", label: t("alert_templates.toolbarLink") },
  { name: "heading", icon: "title", label: t("alert_templates.toolbarHeading") },
]);

const wrapSyntax: Record<string, { before: string; after: string }> = {
  bold: { before: "**", after: "**" },
  italic: { before: "_", after: "_" },
  code: { before: "`", after: "`" },
  link: { before: "[", after: "](url)" },
};

// list/heading are line-prefix markers, not wrap markers — they belong at
// column 1 of each affected line, not at the cursor/selection position.
const linePrefixSyntax: Record<string, string> = {
  list: "- ",
  heading: "## ",
};

const applyToolbarAction = (name: string) => {
  const editorObj = bodyEditorRef.value?.editorObj;
  const prefix = linePrefixSyntax[name];
  const syntax = wrapSyntax[name];
  if (!prefix && !syntax) return;

  if (!editorObj) {
    // Editor not mounted (e.g. unit test double) — fall back to appending at
    // the end of the body so the toolbar still does something useful.
    const fallback = prefix ? prefix : `${syntax!.before}${syntax!.after}`;
    updateField("body", `${spec.value.body}${fallback}`);
    return;
  }

  const selection = editorObj.getSelection();
  const model = editorObj.getModel();
  if (!selection || !model) return;

  if (prefix) {
    // Insert the prefix at the start of every line the selection touches.
    const startLine = selection.startLineNumber;
    const endLine = selection.endLineNumber;
    const edits = [];
    for (let line = startLine; line <= endLine; line++) {
      edits.push({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        text: prefix,
        forceMoveMarkers: true,
      });
    }
    editorObj.executeEdits("content-template-toolbar", edits);
    editorObj.setPosition({ lineNumber: endLine, column: 1 + prefix.length });
    editorObj.focus();
    const newValue = model.getValue();
    updateField("body", newValue);
    return;
  }

  const selectedText = model.getValueInRange(selection);
  const isEmptySelection = selectedText.length === 0;
  const replacement = `${syntax!.before}${selectedText}${syntax!.after}`;
  editorObj.executeEdits("content-template-toolbar", [
    { range: selection, text: replacement, forceMoveMarkers: true },
  ]);

  if (isEmptySelection) {
    // Empty selection (first-run case): land the cursor BETWEEN the inserted
    // delimiters instead of after the whole replacement, so typing continues
    // the bold/italic/code run rather than starting after it.
    const startLineNumber = selection.startLineNumber;
    const startColumn = selection.startColumn + syntax!.before.length;
    editorObj.setPosition({ lineNumber: startLineNumber, column: startColumn });
  }

  editorObj.focus();
  updateField("body", model.getValue());
};

// Variable chips: insert `{var}` at the current cursor position via Monaco
// executeEdits (Datadog's insert-at-cursor pattern, not PagerDuty's
// copy-to-clipboard step). Falls back to appending at the end of the body
// when the editor isn't mounted, mirroring applyToolbarAction above.
const allVariables = [
  "alert_name",
  "alert_agg_value",
  "alert_operator",
  "alert_threshold",
  "alert_trigger_time_str",
  "stream_name",
  "org_name",
  "alert_description",
  "alert_url",
  "alert_count",
  "alert_period",
  "alert_type",
];
const mostUsedVariables = allVariables.slice(0, 5);
const showAllVariables = ref(false);

const visibleVariables = computed(() =>
  showAllVariables.value ? allVariables : mostUsedVariables,
);
const hiddenVariableCount = computed(() =>
  showAllVariables.value ? 0 : allVariables.length - mostUsedVariables.length,
);

const variableChipLabel = (name: string): string => `{${name}}`;

// Shared insert-at-cursor primitive behind both the variable chips and the
// emoji picker — falls back to appending at the end when the editor isn't
// mounted yet, mirroring applyToolbarAction's fallback above.
const insertText = (token: string) => {
  const editorObj = bodyEditorRef.value?.editorObj;

  if (!editorObj) {
    updateField("body", `${spec.value.body}${token}`);
    return;
  }

  const selection = editorObj.getSelection();
  const model = editorObj.getModel();
  if (!selection || !model) return;

  editorObj.executeEdits("content-template-insert-text", [
    { range: selection, text: token, forceMoveMarkers: true },
  ]);
  editorObj.setPosition({
    lineNumber: selection.startLineNumber,
    column: selection.startColumn + token.length,
  });
  editorObj.focus();
  updateField("body", model.getValue());
};

const insertVariable = (name: string) => insertText(`{${name}}`);

// Curated set (not a full picker — see design discussion) mirroring the
// status/severity icons alert-notification tools commonly use (Datadog,
// PagerDuty). Plain Unicode characters: no special rendering needed, they
// pass through markdown/Slack/email as ordinary text.
const emojiOptions = [
  { name: "siren", char: "🚨", label: t("alert_templates.emojiSiren") },
  { name: "fire", char: "🔥", label: t("alert_templates.emojiFire") },
  { name: "warning", char: "⚠️", label: t("alert_templates.emojiWarning") },
  { name: "check", char: "✅", label: t("alert_templates.emojiCheck") },
  { name: "cross", char: "❌", label: t("alert_templates.emojiCross") },
  { name: "chart", char: "📈", label: t("alert_templates.emojiChart") },
  { name: "bell", char: "🔔", label: t("alert_templates.emojiBell") },
  { name: "clock", char: "⏱️", label: t("alert_templates.emojiClock") },
];

defineExpose({ applyToolbarAction, insertVariable, insertText });
</script>
