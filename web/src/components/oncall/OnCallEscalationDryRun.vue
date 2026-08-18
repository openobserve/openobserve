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
  If this priority fired right now, what would happen.

  Nothing is sent. The point is the verdict per rung: a ladder that reads
  correctly and lands nowhere is the failure this panel exists to catch, and it
  is invisible in the policy editor because the editor knows nothing about
  transports or who is actually on call.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-2 border px-3.5 py-3"
    data-test="oncall-dry-run"
  >
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">
        {{ t("oncall.dryRunTitle", { priority: raw(preview?.priority ?? "") }) }}
      </OText>
      <OText variant="meta">{{ t("oncall.dryRunHint") }}</OText>
    </span>

    <p v-if="!preview" class="text-text-secondary text-sm" data-test="oncall-dry-run-empty">
      {{ t("oncall.dryRunUnavailable") }}
    </p>

    <p
      v-else-if="!preview.pages_anyone"
      class="text-status-error-text text-sm"
      data-test="oncall-dry-run-silent"
    >
      {{ t("oncall.ladderPriorityPagesNobody", { priority: raw(preview.priority) }) }}
    </p>

    <template v-else>
      <ul class="flex flex-col">
        <li
          v-for="rung in preview.rungs"
          :key="rung.after_micros"
          class="border-border-subtle flex items-center gap-3 border-b py-2 last:border-b-0"
          :data-test="`oncall-dry-run-rung-${rung.after_micros}`"
        >
          <OTag variant="default-soft" size="sm" class="shrink-0">
            {{ delayLabel(rung.after_micros) }}
          </OTag>

          <span class="flex min-w-0 flex-col">
            <span class="text-text-heading truncate text-sm font-medium">{{ who(rung) }}</span>
            <span class="text-text-secondary truncate text-xs">{{ detail(rung) }}</span>
          </span>

          <!-- Three states, not two: a rung where some land and some do not is
               the one somebody has to look at, and calling it "landed" hides
               exactly the person who will never be woken. -->
          <OTag
            :variant="verdictOf(rung).tone"
            size="sm"
            class="ms-auto shrink-0"
            :data-test="`oncall-dry-run-verdict-${rung.after_micros}`"
          >
            {{ verdictOf(rung).label }}
          </OTag>
        </li>
      </ul>

      <p class="text-text-secondary text-xs" data-test="oncall-dry-run-ends">
        {{ raw(preview.ends_with) }}
      </p>

      <!-- How a page can leave this team at all. Both sentences are the
           server's: "escalate to a sibling" is not a thing, and wording it that
           way would tell somebody they still hold a page they gave away. -->
      <p
        v-for="(move, index) in preview.cross_team_moves"
        :key="index"
        class="text-text-secondary text-xs"
        :data-test="`oncall-dry-run-move-${index}`"
      >
        {{ raw(move) }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OText from "@/lib/core/Typography/OText.vue";
import type { EscalationPreview, PreviewRung } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { speakTarget } from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

withDefaults(defineProps<{ preview?: EscalationPreview | null }>(), { preview: null });

const { t } = useI18nTyped();

/// The engine's own English, said the way the editor says it — one vocabulary
/// for one concept, rather than two a click apart.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");


function delayLabel(afterMicros: number): I18nText {
  return afterMicros === 0 ? raw("0m") : raw(`+${formatMicrosDuration(afterMicros)}`);
}

/// One name reads better than a list of one; past that the count is the fact.
function who(rung: PreviewRung): I18nText {
  if (!rung.recipients.length) return raw(saidTargets(rung.targets));
  if (rung.recipients.length === 1) return raw(rung.recipients[0].user_email);
  return t("oncall.dryRunPeople", { count: rung.recipients.length });
}

/// The reason they are on this rung, or — when some cannot be reached — who
/// would be skipped, because that is the actionable half.
function detail(rung: PreviewRung): I18nText {
  const skipped = rung.recipients.filter((person) => !person.would_a_page_land);
  if (skipped.length) {
    return t("oncall.dryRunSkipped", {
      names: raw(skipped.map((person) => person.user_email).join(", ")),
    });
  }
  const channels = rung.recipients[0]?.deliverable_channels ?? [];
  return channels.length
    ? raw(channels.map((channel) => String(t(`oncall.channel_${channel}`))).join(" + "))
    : raw(rung.recipients[0]?.reason ?? "");
}

interface Verdict {
  label: I18nText;
  tone: BadgeVariant;
}

function verdictOf(rung: PreviewRung): Verdict {
  const total = rung.recipients.length;
  const landing = rung.recipients.filter((person) => person.would_a_page_land).length;

  if (!total || rung.resolves_to_nobody) {
    return { label: t("oncall.dryRunNobody"), tone: "error-soft" };
  }
  if (landing === 0) return { label: t("oncall.dryRunWouldNotLand"), tone: "error-soft" };
  if (landing < total) return { label: t("oncall.dryRunPartial"), tone: "amber-soft" };
  return { label: t("oncall.dryRunWouldLand"), tone: "success-soft" };
}
</script>
