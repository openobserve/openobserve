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
  <div v-if="count" class="min-w-0" data-test="assistant-action-timeline">
    <OCollapsible
      :label="t('assistant.actions.count', { count }, count)"
      :trigger-class="TOUCH_TARGET_CLASS"
    >
      <div class="flex min-w-0 flex-col gap-1.5">
        <OText variant="label" as="p">{{ t("assistant.actions.heading") }}</OText>
        <ul class="flex min-w-0 flex-col gap-1">
          <li
            v-for="entry in rows"
            :key="entry.id"
            class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
            :data-test="`assistant-action-entry-${entry.id}`"
          >
            <OIcon
              :name="entry.glyph"
              size="xs"
              :class="entry.failed ? 'text-status-error-text' : 'text-text-secondary'"
              aria-hidden="true"
            />
            <span
              :class="[
                'min-w-0 flex-1 break-words',
                entry.failed ? 'text-status-error-text' : 'text-text-body',
              ]"
            >
              {{ entry.text }}
            </span>
            <AssistantUndoControl
              v-if="entry.entry.undoable && !readonly && sid"
              :entry="entry.entry"
              :sid="sid"
              test-id="assistant-action-undo"
            />
          </li>
          <li
            v-for="(change, index) in unreviewedRows"
            :key="`unreviewed:${index}`"
            class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
            data-test="assistant-action-entry-unreviewed"
          >
            <OIcon
              :name="assistantGlyph.interrupted"
              size="xs"
              class="text-text-secondary"
              aria-hidden="true"
            />
            <span class="text-text-body min-w-0 flex-1 break-words">{{ change }}</span>
            <OTag variant="default-soft" size="xs" :label="t('assistant.actions.noReview')" />
          </li>
        </ul>
        <OText variant="meta" as="p" data-test="assistant-action-timeline-limits">
          {{ anyUndoable ? t("assistant.actions.undoLimits") : t("assistant.actions.undoNotYet") }}
        </OText>
      </div>
    </OCollapsible>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  entityKeyOf,
  type ActionLedgerEntry,
  type PolicyBlockData,
  type Sid,
} from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import AssistantUndoControl from "./AssistantUndoControl.vue";

const props = withDefaults(
  defineProps<{
    entries: ActionLedgerEntry[];
    /** Changes the assistant made with no card before them; listed, never undoable. */
    unreviewed?: PolicyBlockData[];
    sid?: Sid | null;
    readonly?: boolean;
  }>(),
  { unreviewed: () => [], sid: null, readonly: false },
);

const { t } = useI18nTyped();

const count = computed(() => props.entries.length + props.unreviewed.length);
const anyUndoable = computed(() => props.entries.some((entry) => entry.undoable));

const rows = computed(() =>
  props.entries.map((entry) => {
    const operation = t(`assistant.actions.op.${entry.op}`, {
      entity: t(`assistant.entity.${entityKeyOf(entry.resource.type)}`, 1),
    });
    const name = raw(entry.resource.name);
    const glyph: IconName =
      entry.status === "failed"
        ? assistantGlyph.failed
        : entry.status === "undone"
          ? assistantGlyph.undo
          : assistantGlyph.done;
    const text = t("assistant.actions.entry", {
      operation,
      name,
      user: t("assistant.actions.you"),
      time: raw(formatOrgTime(entry.at)),
    });
    return { id: entry.id, entry, glyph, text, failed: entry.status === "failed" };
  }),
);

const unreviewedRows = computed(() =>
  props.unreviewed.map((change) => {
    const n = change.count ?? 1;
    return t("assistant.policy.unreviewed", {
      count: n,
      entity: t(`assistant.entity.${entityKeyOf(change.resourceType)}`, n),
    });
  }),
);
</script>
