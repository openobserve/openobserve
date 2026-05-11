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
  <svg
    v-if="hasData"
    class="kpi-sparkline"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    :style="{ width: '100%', height: height + 'px', display: 'block' }"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.5" />
        <stop offset="60%" :stop-color="color" stop-opacity="0.15" />
        <stop offset="100%" :stop-color="color" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    <path :d="areaPath" :fill="`url(#${gradientId})`" />
    <path
      :d="linePath"
      fill="none"
      :stroke="color"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
  <div v-else :style="{ height: height + 'px' }" />
</template>

<script lang="ts" setup>
import { computed } from "vue";

interface Props {
  data: number[];
  color?: string;
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  color: "#3b82f6",
  height: 38,
});

const width = 200;
const gradientId = computed(
  () => `kpi-spark-${Math.random().toString(36).slice(2, 9)}`,
);

const hasData = computed(() => props.data.length > 1);

const points = computed(() => {
  const data = props.data;
  if (data.length < 2) return [];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const padTop = 2;
  const padBottom = 2;
  const usableH = props.height - padTop - padBottom;
  return data.map((v, i) => {
    const x = i * stepX;
    const y = padTop + usableH - ((v - min) / range) * usableH;
    return [x, y] as const;
  });
});

const linePath = computed(() => {
  const pts = points.value;
  if (!pts.length) return "";
  return pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
});

const areaPath = computed(() => {
  const pts = points.value;
  if (!pts.length) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  const top = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  return `${top} L${last[0].toFixed(2)},${props.height} L${first[0].toFixed(2)},${props.height} Z`;
});
</script>
