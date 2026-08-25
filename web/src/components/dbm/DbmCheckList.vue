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
  to be true, with a verdict per line": an uppercase header, then one row per
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
  <div
    class="border-border-default rounded-surface w-full max-w-2xl overflow-hidden text-left"
    :data-test="dataTest"
  >
    <p
      class="border-border-subtle bg-surface-panel text-text-label text-2xs border-b px-3 py-1.5 font-semibold tracking-wide uppercase"
    >
      {{ title }}
    </p>
    <div
      v-for="check in checks"
      :key="check.id"
      class="border-border-subtle flex items-start gap-2 px-3 py-1.5 not-last:border-b"
      :data-test="`${rowTestPrefix}${check.id}`"
    >
      <span
        class="text-3xs mt-px grid size-3.5 shrink-0 place-items-center rounded-full font-bold text-white"
        :class="STATUS_TONES[check.status]"
      >
        {{ STATUS_GLYPHS[check.status] }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="text-text-heading block text-xs font-semibold">{{ check.title }}</span>
        <span class="text-text-secondary text-2xs mt-px block leading-relaxed">
          {{ check.detail }}
        </span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { raw, type I18nText } from "@/types/i18n";

export type DbmCheckStatus = "ok" | "fail" | "note";

/** One thing that has to be true, its verdict, and the specific fix. */
export interface DbmCheckRow {
  id: string;
  status: DbmCheckStatus;
  title: I18nText;
  detail: I18nText;
}

defineProps<{
  /** The uppercase header — "How we know", "What has to be true". */
  title: I18nText;
  checks: DbmCheckRow[];
  /** `data-test` on the container. */
  dataTest?: string;
  /** Prefix for each row's `data-test`; the check id is appended verbatim. */
  rowTestPrefix: string;
}>();

const STATUS_TONES: Record<DbmCheckStatus, string> = {
  ok: "bg-status-success-text",
  fail: "bg-status-error-text",
  note: "bg-status-warning-text",
};

const STATUS_GLYPHS: Record<DbmCheckStatus, I18nText> = {
  ok: raw("✓"),
  fail: raw("✕"),
  note: raw("!"),
};
</script>
