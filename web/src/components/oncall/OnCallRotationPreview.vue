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
  Who the rotation being described will actually put on call, first three
  shifts. The design asks for a live preview so the rule is verified by looking
  at it rather than by reading documentation (architecture/02 §4).

  A DESCENDANT of the team form's OForm: it injects FORM_CONTEXT_KEY and reads
  the values straight off the form, so there is no second copy of the state to
  drift from the fields.
-->
<template>
  <div class="flex flex-col gap-1" data-test="oncall-rotation-preview">
    <span class="text-text-label text-xs">{{ t("oncall.upcoming") }}</span>

    <p
      v-if="!shifts.length"
      class="text-text-muted text-sm"
      data-test="oncall-rotation-preview-empty"
    >
      {{ t("oncall.rotationPreviewEmpty") }}
    </p>

    <ol v-else class="flex flex-col gap-1">
      <li
        v-for="shift in shifts"
        :key="shift.startMicros"
        class="flex flex-wrap items-center gap-2"
        :data-test="`oncall-rotation-preview-${shift.startMicros}`"
      >
        <OTag variant="default-soft" size="sm">{{ raw(shift.when) }}</OTag>
        <OUserCell :value="shift.member" />
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone, memberAt } from "@/utils/oncall";

const props = defineProps<{ timezone: string }>();

const { t } = useI18nTyped();

const form: any = inject(FORM_CONTEXT_KEY, null);

const members = form.useStore((s: any) => (s.values?.members ?? []) as string[]);
const shiftMicros = form.useStore(
  (s: any) => (s.values?.shift_micros ?? MICROS_PER_WEEK) as number,
);
const firstHandover = form.useStore((s: any) => (s.values?.first_handover ?? "") as string);

/// The first three shifts the rotation would produce. Three because the point
/// is to show the order rotating, which two cannot.
const shifts = computed(() => {
  const anchor = Date.parse(firstHandover.value);
  const shift = shiftMicros.value;
  if (!members.value.length || !Number.isFinite(anchor) || !shift || shift <= 0) return [];

  const anchorMicros = anchor * 1000;
  const rotation = {
    name: "",
    members: members.value,
    shift_micros: shift,
    anchor_micros: anchorMicros,
  };

  return [0, 1, 2].map((index) => {
    const startMicros = anchorMicros + index * shift;
    return {
      startMicros,
      member: memberAt(rotation, startMicros) ?? "",
      when: formatInZone(startMicros, props.timezone, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    };
  });
});
</script>
