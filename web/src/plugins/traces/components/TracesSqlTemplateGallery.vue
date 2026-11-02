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
    class="bg-card-glass-bg flex h-full flex-col items-center overflow-y-auto px-6 py-8"
    data-test="traces-sql-template-gallery"
  >
    <div class="flex w-full max-w-5xl flex-col gap-5">
      <div class="flex flex-col gap-1.5 text-center">
        <h2 class="text-text-heading text-lg font-medium" data-test="traces-sql-gallery-title">
          {{
            view === "traces"
              ? t("traces.sqlMode.gallery.tracesTitle")
              : t("traces.sqlMode.gallery.spansTitle")
          }}
        </h2>
        <p class="text-text-secondary mx-auto max-w-2xl text-sm leading-relaxed">
          {{
            view === "traces"
              ? t("traces.sqlMode.gallery.tracesLede")
              : t("traces.sqlMode.gallery.spansLede")
          }}
        </p>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <OCard
          v-for="tpl in templates"
          :key="tpl.id"
          variant="outlined"
          class="min-w-0 gap-2 p-3"
          data-test="traces-sql-template-card"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-text-body text-sm font-medium">{{ templateName(tpl) }}</span>
            <span class="text-text-secondary text-xs">{{ templateDescription(tpl) }}</span>
          </div>
          <OCode block wrap class="min-w-0 flex-1 text-xs" data-test="traces-sql-template-sql">
            <span
              v-for="(part, k) in sqlParts(tpl)"
              :key="k"
              :class="part.service ? 'text-primary font-semibold' : undefined"
              :data-test="part.service ? 'traces-sql-template-service' : undefined"
              >{{ part.text }}</span
            >
          </OCode>
          <OButton
            variant="outline"
            size="sm"
            class="self-start"
            data-test="traces-sql-template-use-btn"
            @click="emit('use', tpl.sql)"
          >
            {{ t("traces.sqlMode.gallery.useTemplate") }}
          </OButton>
        </OCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useTracesSqlTemplateText } from "@/plugins/traces/composables/useTracesSqlTemplates";
import type { TracesSqlTemplate, TracesSqlTemplateView } from "@/utils/traces/tracesSqlTemplates";

defineProps<{
  view: TracesSqlTemplateView;
  templates: TracesSqlTemplate[];
}>();

const emit = defineEmits<{
  use: [sql: string];
}>();

const { t } = useI18nTyped();
const { templateName, templateDescription } = useTracesSqlTemplateText();

// The filled-in service names are guesses from the stream, so they stand out for the user to check.
const sqlParts = (tpl: TracesSqlTemplate): { text: string; service: boolean }[] => {
  const literals = tpl.services.map((name) => `'${name.replaceAll("'", "''")}'`);
  const parts: { text: string; service: boolean }[] = [];
  let rest = tpl.sql;
  for (const literal of literals) {
    const at = rest.indexOf(literal);
    if (at < 0) continue;
    parts.push({ text: rest.slice(0, at), service: false }, { text: literal, service: true });
    rest = rest.slice(at + literal.length);
  }
  parts.push({ text: rest, service: false });
  return parts;
};
</script>
