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
    class="bg-surface-panel rounded-default flex flex-col gap-4 p-4"
    :data-test="`autoobserve2-change-${change.id}-details`"
  >
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      <dt class="text-text-secondary">{{ t("autoobserve2.activityPage.details.name") }}</dt>
      <dd class="text-text-heading min-w-0 break-words">{{ settings }}</dd>
      <dt class="text-text-secondary">{{ t("autoobserve2.activityPage.details.target") }}</dt>
      <dd class="min-w-0 break-words">
        <a
          v-if="alertHref"
          :href="alertHref"
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-link hover:underline"
          :data-test="`autoobserve2-change-${change.id}-alert`"
          >{{ title }}</a
        >
        <span v-else class="text-text-body">{{ title }}</span>
      </dd>
      <dt class="text-text-secondary">{{ t("autoobserve.activityLive.details.who") }}</dt>
      <dd class="text-text-body min-w-0">
        <span v-for="(line, i) in actors" :key="i" class="block">{{ line }}</span>
      </dd>
    </dl>
    <div v-if="change.shifts.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OCodeBlock
        class="min-w-0"
        :code="configText(change.shifts, 'from')"
        lang="yaml"
        chrome="editor"
        :filename="t('autoobserve.activity.before')"
        wrap
        :copyable="false"
        :data-test="`autoobserve2-change-${change.id}-before`"
      />
      <OCodeBlock
        class="min-w-0"
        :code="configText(change.shifts, 'to')"
        lang="yaml"
        chrome="editor"
        :filename="t('autoobserve.activity.after')"
        wrap
        :copyable="false"
        :data-test="`autoobserve2-change-${change.id}-after`"
      />
    </div>
    <p
      v-else
      class="text-text-secondary text-xs"
      :data-test="`autoobserve2-change-${change.id}-no-fields`"
    >
      {{ t("autoobserve.activityLive.details.noFields") }}
    </p>
    <p class="text-text-secondary flex items-start gap-2 text-xs leading-relaxed">
      <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
      <span>{{
        change.state === "undone"
          ? t("autoobserve.activityLive.details.undoneNote")
          : t("autoobserve.activityLive.details.undoNote")
      }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { configText, type Change } from "./changes";

const props = defineProps<{ change: Change; actors: I18nText[]; alertHref: string | null }>();

const { t, locale } = useI18nTyped();

const title = computed(() =>
  props.change.entry.title ? raw(props.change.entry.title) : t("autoobserveLive.history.untitled"),
);

const settings = computed(() =>
  raw(
    new Intl.ListFormat(locale.value, { type: "conjunction" }).format(
      props.change.shifts.map((s) => String(s.setting)),
    ),
  ),
);
</script>
