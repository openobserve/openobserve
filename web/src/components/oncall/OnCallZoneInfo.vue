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

<!-- The one place a team-clock form says which clock its times are on, and the range on the other clock in play. -->
<template>
  <span
    role="img"
    tabindex="0"
    class="text-text-secondary inline-flex cursor-help"
    :aria-label="spokenLabel"
    data-test="oncall-zone-info"
  >
    <OIcon name="info-outline" size="sm" />
    <OTooltip side="bottom">
      <template #content>
        <span class="flex flex-col gap-1">
          <span>{{ teamLine }}</span>
          <span v-if="otherLine" data-test="oncall-zone-info-other">{{ otherLine }}</span>
        </span>
      </template>
    </OTooltip>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatZonedRange } from "@/utils/oncall";

const props = defineProps<{
  timezone: string;
  viewerTimezone: string;
  /** The picked window in microseconds, restated on the other clock in play. */
  range?: { from?: number; to?: number } | null;
  /** The zone the range control is set to, for a control that can pick another zone than the team's. */
  pickedTimezone?: string;
}>();

const { t } = useI18nTyped();

const teamLine = computed<I18nText>(() =>
  props.pickedTimezone
    ? t("oncall.zoneInfoPickable", { zone: raw(props.timezone) })
    : t("oncall.zoneInfoTeam", { zone: raw(props.timezone) }),
);

const otherLine = computed<I18nText | "">(() => {
  const from = props.range?.from;
  const to = props.range?.to;
  if (typeof from !== "number" || typeof to !== "number") return "";
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "";
  const picked = props.pickedTimezone;
  if (picked && picked !== props.timezone) {
    return t("oncall.zoneInfoPicked", {
      zone: raw(picked),
      range: raw(formatZonedRange(from, to, picked)),
    });
  }
  if (props.viewerTimezone === props.timezone) return "";
  return t("oncall.zoneInfoLocal", {
    range: raw(formatZonedRange(from, to, props.viewerTimezone)),
  });
});
// The tooltip opens on hover and focus only, so a screen reader is handed both of its lines.
const spokenLabel = computed<I18nText>(() =>
  otherLine.value ? raw(`${teamLine.value} ${otherLine.value}`) : teamLine.value,
);
</script>
