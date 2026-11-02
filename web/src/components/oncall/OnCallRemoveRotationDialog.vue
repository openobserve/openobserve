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
    :title="t('oncall.removeRotationTitleNamed', { rotation: rotationName })"
    :primary-button-label="t('oncall.laneDelete')"
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
      <p data-test="oncall-remove-rotation-body">{{ body }}</p>
      <span v-if="blocked || mayBeRefused" class="flex flex-col items-start gap-1">
        <p
          v-if="blocked"
          class="text-status-warning-text"
          data-test="oncall-remove-rotation-blocked"
        >
          {{
            t(
              "oncall.removeRotationBlocked",
              { steps: stepList, rotation: rotationName },
              steps.length,
            )
          }}
        </p>
        <p v-else class="text-status-warning-text" data-test="oncall-remove-rotation-may-refuse">
          {{
            t(
              "oncall.removeRotationMayBeRefused",
              { steps: stepList, rotation: rotationName },
              steps.length,
            )
          }}
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
import type { OnCallPolicy, Rotation } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { listInLocale, rotationMembers, stepsNamingRotation } from "@/utils/oncall";

const props = defineProps<{
  open: boolean;
  rotationId: string;
  /** The team's rotations, so the body can name the ones that stay and those a rebuilt policy pages. */
  rotations: Pick<Rotation, "id" | "name" | "shift_rules">[];
  /** Who holds each rotation right now, by display name; a rotation absent here has nobody on call. */
  holders: { rotation_id: string; name: string }[];
  policy: Pick<OnCallPolicy, "rungs" | "ladder_is_generated"> | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
  "open-policy": [];
}>();

const { t, locale } = useI18nTyped();

const rotationName = computed(() =>
  raw(props.rotations.find((rotation) => rotation.id === props.rotationId)?.name ?? ""),
);

const holderOf = (rotationId: string) =>
  props.holders.find((holder) => holder.rotation_id === rotationId)?.name;

/// Rotations resolve independently (`resolve_on_call`), so the deleted one's shifts go to nobody and every other keeps its own.
const body = computed<I18nText>(() => {
  const holder = holderOf(props.rotationId);
  const now = holder
    ? t("oncall.removeRotationHeldBy", { name: raw(holder), rotation: rotationName.value })
    : t("oncall.removeRotationHeldByNobody", { rotation: rotationName.value });
  const others = props.rotations
    .filter((rotation) => rotation.id !== props.rotationId)
    .map((rotation) => {
      const who = holderOf(rotation.id);
      return who ? `${rotation.name} (${who})` : rotation.name;
    });
  const after = generated.value ? rebuilt.value : remaining(others);
  return raw(`${now} ${after}`);
});

/// What a generated ladder becomes: the server rebuilds the default around the first two remaining rotations with people.
const rebuilt = computed<I18nText>(() => {
  const kept = props.rotations
    .filter((rotation) => rotation.id !== props.rotationId && rotationMembers(rotation).length)
    .slice(0, 2)
    .map((rotation) => rotation.name);
  return kept.length
    ? t("oncall.removeRotationRebuilt", { rotations: raw(listInLocale(kept, locale.value)) })
    : t("oncall.removeRotationWholeTeam");
});

function remaining(others: string[]): I18nText {
  return others.length
    ? t(
        "oncall.removeRotationOthersKeep",
        { others: raw(listInLocale(others, locale.value)) },
        others.length,
      )
    : t("oncall.removeRotationNobodyTakesOver");
}

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

// The server judges this against the stored schedule, the same check its save makes, so true means any delete saves.
const generated = computed(() => props.policy?.ladder_is_generated === true);
</script>
