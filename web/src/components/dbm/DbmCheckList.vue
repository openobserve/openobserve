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
  DbmCheckList — the checklist grammar every DBM empty state speaks.

  DbmEmptyState and DbmLockEmptyState both render "here is everything that has
  to be true, with a verdict per line": a header, then one row per
  check with a tone-coloured glyph, a title and the specific fix. That grammar
  is the product claim — three different empty screens reading as ONE system —
  so it lives in one component; two hand-kept copies would drift apart one
  padding tweak at a time and quietly break exactly the sameness they exist for.

  Each row is one thing that has to be true, its verdict, and — where it
  failed — the specific fix rather than a generic link. The tones and glyphs
  are fixed here for the same reason: a ✓ that is green on one tab and teal on
  another stops reading as the same verdict.

  Rows separate with `not-last:border-b`: the container's own edge already
  closes the list, so a border under the final row would double it.
-->
<template>
  <div class="w-full max-w-105 text-start" :data-test="dataTest">
    <p class="text-text-secondary text-xs font-medium">{{ title }}</p>
    <ul class="mt-2 flex flex-col gap-2">
      <li
        v-for="check in checks"
        :key="check.id"
        class="flex items-start gap-2"
        :data-status="check.status"
        :data-test="`${rowTestPrefix}${check.id}`"
      >
        <OIcon
          :name="STATUS_ICONS[check.status]"
          size="sm"
          :class="['mt-0.5 shrink-0', STATUS_TONES[check.status]]"
        />
        <span class="flex min-w-0 flex-col">
          <span class="text-text-body text-compact leading-5">{{ check.title }}</span>
          <span v-if="check.detail" class="text-text-secondary text-xs">{{ check.detail }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";

export type DbmCheckStatus = "ok" | "fail" | "note";

/** One thing that has to be true, its verdict, and the specific fix. */
export interface DbmCheckRow {
  id: string;
  status: DbmCheckStatus;
  title: I18nText;
  detail: I18nText;
}

defineProps<{
  /** The header — "How we know", "What has to be true". */
  title: I18nText;
  checks: DbmCheckRow[];
  /** `data-test` on the container. */
  dataTest?: string;
  /** Prefix for each row's `data-test`; the check id is appended verbatim. */
  rowTestPrefix: string;
}>();

const STATUS_TONES: Record<DbmCheckStatus, string> = {
  ok: "text-status-success-text",
  fail: "text-status-error-text",
  note: "text-text-secondary",
};

const STATUS_ICONS: Record<DbmCheckStatus, IconName> = {
  ok: "check-circle",
  fail: "cancel",
  note: "info",
};
</script>
