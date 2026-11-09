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
  <dl
    class="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1"
    :data-test="dataTest"
  >
    <template v-for="row in rows" :key="row.field">
      <dt class="text-text-secondary text-xs">{{ row.field }}</dt>
      <dd class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-mono text-xs break-all">
        <template v-if="row.before !== null">
          <s class="text-text-secondary" data-test="assistant-approval-diff-before">{{
            row.before
          }}</s>
          <OIcon
            :name="assistantGlyph.goTo"
            size="xs"
            class="text-text-secondary"
            aria-hidden="true"
          />
          <span
            class="text-status-success-text font-medium"
            data-test="assistant-approval-diff-after"
            >{{ row.value }}</span
          >
        </template>
        <span v-else class="text-text-body" data-test="assistant-approval-diff-after">{{
          row.value
        }}</span>
      </dd>
    </template>
  </dl>
</template>

<script setup lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OIcon from "@/lib/core/Icon/OIcon.vue";

import type { ApprovalDiffRow } from "./approvals.types";

defineProps<{ rows: ApprovalDiffRow[]; dataTest: string }>();
</script>
