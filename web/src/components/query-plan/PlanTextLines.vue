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
  <div class="text-compact font-mono leading-relaxed" :class="wrap ? '' : 'w-max min-w-full'">
    <div
      v-for="line in lines"
      :key="line.no"
      class="flex"
      :data-test="`query-plan-text-line-${line.no}`"
    >
      <span v-if="numbered" class="text-text-secondary w-14 shrink-0 pe-4 text-end select-none">{{
        line.no
      }}</span>
      <span
        class="text-text-body min-w-0 flex-1"
        :class="[
          wrap ? 'wrap-anywhere whitespace-pre-wrap' : 'whitespace-pre',
          numbered ? 'pe-4' : '',
        ]"
        ><span
          v-for="g in line.guides"
          :key="g"
          class="border-border-subtle inline-block border-s whitespace-pre"
          >{{ GUIDE }}</span
        >{{ line.pad
        }}<span
          v-if="line.name"
          class="font-semibold"
          :class="CATEGORY_STYLE[line.category].text"
          :data-test="`query-plan-text-op-${line.no}`"
          >{{ line.name }}</span
        >{{ line.rest }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { operatorCategory, type OperatorCategory } from "@/utils/queryProfile";
import { CATEGORY_STYLE } from "./profileStyles";

interface PlanLine {
  no: number;
  guides: number;
  pad: string;
  name: string;
  category: OperatorCategory;
  rest: string;
}

const INDENT = 2;
const GUIDE = " ".repeat(INDENT);

const props = defineProps<{
  text: string;
  wrap: boolean;
  numbered?: boolean;
}>();

const lines = computed<PlanLine[]>(() =>
  props.text.trim() ? props.text.replace(/\s+$/, "").split("\n").map(toLine) : [],
);

function toLine(line: string, i: number): PlanLine {
  const indent = line.match(/^ */)?.[0].length ?? 0;
  const body = line.slice(indent);
  const name = body.match(/^([A-Za-z_]\w*)(?=:|$)/)?.[1] ?? "";
  return {
    no: i + 1,
    guides: Math.floor(indent / INDENT),
    pad: " ".repeat(indent % INDENT),
    name,
    category: operatorCategory(name),
    rest: body.slice(name.length),
  };
}
</script>
