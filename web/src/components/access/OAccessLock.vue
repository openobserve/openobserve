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
  <OEmptyState
    preset="no-access"
    :size="size"
    :title="named ? message.title : undefined"
    :description="description"
    :action-label="actionLabel ?? (named ? copyLabel : undefined)"
    :action-icon="actionLabel ? actionIcon : 'content-copy'"
    :secondary-action-label="actionLabel && named ? copyLabel : undefined"
    @action="actionLabel ? emit('action') : copyDetails()"
    @secondary-action="copyDetails"
  >
    <template #illustration>
      <span
        class="bg-banner-error-soft-bg text-banner-error-soft-text inline-flex size-20 items-center justify-center rounded-full"
        data-test="access-lock-icon"
      >
        <OIcon name="lock" size="xl" />
      </span>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useAccessCopy } from "@/components/access/useAccessCopy";
import { coverDenials } from "@/components/access/surfaceDenials";
import {
  accessDeniedMessage,
  accessDetails,
  accessReason,
  type AccessDenial,
} from "@/composables/useAccessStore";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** What the lock names; one denial gives the "You can't ..." title and its missing-permission line, none the general no-access wording. */
    denials: AccessDenial[];
    /** Read when Copy details is pressed, since a page's denied requests keep arriving after it locks. */
    requests?: () => string[];
    size?: "hero" | "block";
    /** The view's own next step; Copy details then moves to the secondary button. */
    actionLabel?: I18nText;
    actionIcon?: IconName;
    /** The access chip leaves these denials out while the lock shows, for a lock whose page would otherwise list them a second time. */
    covers?: boolean;
  }>(),
  {
    size: "block",
    requests: undefined,
    actionLabel: undefined,
    actionIcon: undefined,
    covers: false,
  },
);
const emit = defineEmits<{ (e: "action"): void }>();

const { t } = useI18nTyped();
if (props.covers) coverDenials(() => props.denials);
const named = computed(() => props.denials.length > 0);
const message = computed(() => accessDeniedMessage(props.denials, t));
const description = computed(() => {
  if (message.value.groups[0]) return accessReason(message.value.groups[0], t);
  return message.value.askAdmin ? t("accessBoundary.denied.askAdmin") : undefined;
});
const { copied, copyDetails } = useAccessCopy(() => {
  const requests = props.requests;
  return accessDetails(
    requests ? props.denials.map((d) => ({ ...d, requests: requests() })) : props.denials,
  );
});
const copyLabel = computed(() =>
  copied.value ? t("accessBoundary.copied") : t("accessBoundary.copyDetails"),
);
</script>
