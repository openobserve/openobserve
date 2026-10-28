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

<!-- The confirm for removing a rotation, saying first what it does to the escalation policy, as the server will. -->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="title"
    :primary-button-label="okLabel"
    primary-button-variant="destructive"
    :primary-button-disabled="blocked"
    :secondary-button-label="t('oncall.cancel')"
    initial-focus="secondary"
    data-test="oncall-remove-rotation-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="emit('confirm')"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-2 text-sm">
      <!-- Names the rotation the way every delete confirm names its item. -->
      <i18n-t :keypath="messageKeypath" tag="p">
        <template #name>
          <span
            data-test="oncall-remove-rotation-name"
            class="text-text-heading font-semibold break-all"
            >{{ messageName }}</span
          >
        </template>
      </i18n-t>
      <p v-if="generatedSteps" data-test="oncall-remove-rotation-steps">{{ generatedSteps }}</p>
      <span v-if="blocked || mayBeRefused" class="flex flex-col items-start gap-1">
        <p
          v-if="blocked"
          class="text-status-warning-text"
          data-test="oncall-remove-rotation-blocked"
        >
          {{ t("oncall.removeRotationBlocked", { steps: stepList }, steps.length) }}
        </p>
        <p v-else class="text-status-warning-text" data-test="oncall-remove-rotation-may-refuse">
          {{ t("oncall.removeRotationMayBeRefused", { steps: stepList }, steps.length) }}
        </p>
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="oncall-remove-rotation-open-policy"
          @click="emit('open-policy')"
        >
          {{ t("oncall.removeRotationOpenPolicy") }}
        </OButton>
      </span>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OnCallPolicy } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { stepsNamingRotation } from "@/utils/oncall";

const props = defineProps<{
  open: boolean;
  title: I18nText;
  /** A key with a `{name}` placeholder, filled with `messageName` in bold. */
  messageKeypath: I18nKey;
  messageName?: string;
  okLabel: I18nText;
  rotationId: string;
  policy: Pick<OnCallPolicy, "rungs" | "ladder_is_generated"> | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
  "open-policy": [];
}>();

const { t } = useI18nTyped();

const steps = computed(() => stepsNamingRotation(props.policy, props.rotationId));

const stepList = computed(() =>
  raw(
    steps.value
      .map(({ priority, step }) =>
        String(t("oncall.ladderStepRef", { priority: raw(`P${priority}`), step })),
      )
      .join(", "),
  ),
);

// The server rewrites a generated ladder without the rotation and refuses the save for a hand-edited one.
const blocked = computed(
  () => steps.value.length > 0 && props.policy?.ladder_is_generated === false,
);

// A server too old to say how the ladder was made may still refuse, so the reader is told before, not by the error.
const mayBeRefused = computed(
  () => steps.value.length > 0 && props.policy?.ladder_is_generated === undefined,
);

const generatedSteps = computed<I18nText | null>(() =>
  steps.value.length && props.policy?.ladder_is_generated === true
    ? t("oncall.removeRotationStepsGo", { steps: stepList.value }, steps.value.length)
    : null,
);
</script>
