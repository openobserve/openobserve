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
  ContentFieldsEditor: shared table-style row-builder used by both the
  "fields" section (label/value rows) and the "links" section (label/url
  rows) of ContentTemplateForm. Column labels render ONCE in a header row;
  the inputs below are placeholder-only, so each data row stays a single
  compact line. Each row also carries an optional per-row severity filter
  (`show_when.levels`) — empty selection means the row shows for every
  severity, hence the "All" placeholder.

  Layout is one CSS grid: the header cells and every row's cells are all
  grid items (rows use `display: contents` wrappers so they keep a per-row
  data-test hook without breaking the shared column tracks). Grid — not
  flex — so the severity column can never be squeezed to a different width
  per row (the flex-shrink row-height-shift bug this replaced).

  Not an OForm-bound control: `rows` is a plain v-model array (ContentField[]
  or ContentLink[]), mirroring how AddTemplate.vue already bridges its bare
  Monaco `body` into the form rather than modeling every nested array as
  OForm fields.
-->
<template>
  <div class="flex flex-col gap-2" :data-test="`${dataTestPrefix}-container`">
    <div
      v-if="rows.length > 0"
      class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2"
      :data-test="`${dataTestPrefix}-table`"
    >
      <span class="text-text-secondary text-xs font-medium">{{ labelLabel }}</span>
      <span class="text-text-secondary text-xs font-medium">{{ valueLabel }}</span>
      <span
        class="text-text-secondary text-xs font-medium"
        :title="t('alert_templates.showWhenCaption')"
        >{{ t("alert_templates.showWhenLabel") }}</span
      >
      <span></span>
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="contents"
        :data-test="`${dataTestPrefix}-row-${index}`"
      >
        <OInput
          :model-value="row.label"
          :placeholder="labelPlaceholder"
          :data-test="`${dataTestPrefix}-row-${index}-label-input`"
          @update:model-value="(v) => updateRow(index, 'label', String(v ?? ''))"
        />
        <OInput
          :model-value="
            valueKey === 'value' ? (row as ContentField).value : (row as ContentLink).url
          "
          :placeholder="valuePlaceholder"
          :error="!!valueErrorFor(row)"
          :error-message="valueErrorFor(row) ?? undefined"
          :data-test="`${dataTestPrefix}-row-${index}-value-input`"
          @update:model-value="(v) => updateRow(index, valueKey, String(v ?? ''))"
        />
        <!-- `searchable=false`: four fixed options never need a search box. -->
        <OSelect
          :model-value="row.show_when?.levels ?? []"
          multiple
          :options="severityOptions"
          :searchable="false"
          width="sm"
          :placeholder="t('alert_templates.showWhenAllPlaceholder')"
          :title="t('alert_templates.showWhenCaption')"
          :data-test="`${dataTestPrefix}-row-${index}-severity-select`"
          @update:model-value="(v) => updateShowWhen(index, (v as string[]) ?? [])"
        />
        <div class="flex items-center">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="arrow-upward"
            :disabled="index === 0"
            :data-test="`${dataTestPrefix}-row-${index}-move-up-btn`"
            :aria-label="t('alert_templates.moveUp')"
            @click="moveRow(index, -1)"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="arrow-downward"
            :disabled="index === rows.length - 1"
            :data-test="`${dataTestPrefix}-row-${index}-move-down-btn`"
            :aria-label="t('alert_templates.moveDown')"
            @click="moveRow(index, 1)"
          />
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            :data-test="`${dataTestPrefix}-row-${index}-remove-btn`"
            :aria-label="t('common.delete')"
            @click="removeRow(index)"
          />
        </div>
      </div>
    </div>
    <OButton
      variant="dashed"
      size="sm-action"
      icon-left="add"
      class="self-start"
      :data-test="`${dataTestPrefix}-add-btn`"
      @click="addRow"
      >{{ addLabel }}</OButton
    >
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { linkUrlBadScheme, NOT_A_URL, type ContentField, type ContentLink } from "./contentSpec";

type RowKind = ContentField | ContentLink;

const props = defineProps<{
  rows: RowKind[];
  /** Which value key this instance edits: "value" for fields, "url" for links. */
  valueKey: "value" | "url";
  labelLabel: string;
  valueLabel: string;
  labelPlaceholder?: I18nText;
  valuePlaceholder?: I18nText;
  addLabel: string;
  dataTestPrefix: string;
}>();

const emit = defineEmits<{
  (_e: "update:rows", _value: RowKind[]): void;
}>();

const { t } = useI18nTyped();

/**
 * Inline URL validation applies only to the links instance — a field's `value`
 * is arbitrary text with no scheme semantics. The validator returns the bad
 * SCHEME, not a message, so the user-facing copy is translated here.
 */
function valueErrorFor(row: RowKind): I18nText | undefined {
  if (props.valueKey !== "url") return undefined;
  const scheme = linkUrlBadScheme((row as ContentLink).url ?? "");
  if (!scheme) return undefined;
  if (scheme === NOT_A_URL) return t("alerts.validation.linkUrlNotAUrl");
  return t("alerts.validation.linkUrlUnsupportedScheme", { scheme });
}

// Values are the wire strings the backend's AlertLevel serializes to; the
// labels a user reads come from i18n, never the wire vocabulary.
const severityOptions = computed(() => [
  { label: t("alert_templates.severityOk"), value: "ok" },
  { label: t("alert_templates.severityWarning"), value: "warning" },
  { label: t("alert_templates.severityCritical"), value: "critical" },
  { label: t("alert_templates.severityNoData"), value: "no_data" },
]);

const updateRow = (index: number, key: "label" | "value" | "url", value: string) => {
  const next = props.rows.slice();
  next[index] = { ...next[index], [key]: value } as RowKind;
  emit("update:rows", next);
};

const updateShowWhen = (index: number, levels: string[]) => {
  const next = props.rows.slice();
  next[index] = {
    ...next[index],
    show_when: levels.length > 0 ? { levels } : null,
  } as RowKind;
  emit("update:rows", next);
};

const removeRow = (index: number) => {
  const next = props.rows.slice();
  next.splice(index, 1);
  emit("update:rows", next);
};

const moveRow = (index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= props.rows.length) return;
  const next = props.rows.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  emit("update:rows", next);
};

const addRow = () => {
  const blank =
    props.valueKey === "value"
      ? ({ label: "", value: "", show_when: null } as ContentField)
      : ({ label: "", url: "", show_when: null } as ContentLink);
  emit("update:rows", [...props.rows, blank as RowKind]);
};
</script>
