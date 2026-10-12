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
  <SectionCard
    v-if="requests.length"
    :title="
      pending
        ? t('autoobserve2.needs.heading', { count: pending }, pending)
        : t('autoobserve2.needs.allAnswered')
    "
    data-test="autoobserve2-needs-you"
  >
    <ul class="border-border-subtle divide-border-subtle divide-y border-t">
      <li
        v-for="request in requests"
        :key="request.id"
        class="px-5 py-3"
        :data-test="`autoobserve2-request-${testId(request)}`"
      >
        <div class="flex flex-col gap-3">
          <span
            class="flex items-center gap-2.5 text-sm font-semibold"
            :class="decisions[request.id] ? 'text-text-secondary' : 'text-text-heading'"
          >
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-full transition-colors"
              :class="
                decisions[request.id]
                  ? 'bg-surface-subtle text-text-secondary'
                  : 'bg-surface-accent text-accent'
              "
            >
              <OIcon :name="META[request.kind].icon" size="sm" />
            </span>
            {{ t(META[request.kind].label) }}
          </span>
          <p
            class="text-sm leading-relaxed text-pretty transition-colors duration-200"
            :class="decisions[request.id] ? 'text-text-secondary' : 'text-text-body'"
          >
            {{ say(t, request.body) }}
          </p>
          <div class="grid min-h-10">
            <div
              class="col-start-1 row-start-1 grid grid-cols-2 gap-2 self-start transition-opacity duration-200"
              :class="decisions[request.id] ? 'invisible opacity-0' : 'opacity-100'"
              :aria-hidden="!!decisions[request.id]"
            >
              <OButton
                variant="outline"
                size="sm"
                block
                :data-test="`autoobserve2-request-no-${testId(request)}`"
                @click="decide(request.id, 'no')"
              >
                {{ t(request.no) }}
              </OButton>
              <OButton
                variant="primary"
                size="sm"
                block
                :data-test="`autoobserve2-request-yes-${testId(request)}`"
                @click="decide(request.id, 'yes')"
              >
                {{ t(request.yes) }}
              </OButton>
            </div>
            <div
              class="col-start-1 row-start-1 flex min-w-0 items-start gap-2 transition-opacity duration-200"
              :class="decisions[request.id] ? 'opacity-100' : 'invisible opacity-0'"
              :aria-hidden="!decisions[request.id]"
            >
              <OIcon
                name="check-circle"
                size="sm"
                class="text-status-success-text mt-0.5 shrink-0"
              />
              <span
                class="text-text-heading min-w-0 flex-1 text-sm font-medium"
                :data-test="`autoobserve2-request-done-${testId(request)}`"
              >
                {{ doneText(request) }}
              </span>
              <OButton
                variant="ghost-primary"
                size="xs"
                class="shrink-0"
                :data-test="`autoobserve2-request-undo-${testId(request)}`"
                @click="undo(request.id)"
              >
                {{ t("autoobserve2.needs.undo") }}
              </OButton>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </SectionCard>
  <SectionCard
    v-else
    :title="t('autoobserve2.needs.empty.title')"
    data-test="autoobserve2-needs-empty"
  >
    <div class="flex items-start gap-3 px-5 pb-5">
      <OIcon name="check-circle" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
      <div class="text-text-secondary flex flex-col gap-1 text-sm leading-relaxed">
        <p>{{ t("autoobserve2.needs.empty.body") }}</p>
        <p v-if="allVisible && learning">{{ t("autoobserve2.needs.empty.stillLearning") }}</p>
        <p v-else-if="allVisible">{{ t("autoobserve2.needs.empty.allVisible") }}</p>
      </div>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import SectionCard from "./SectionCard.vue";
import { useDecisions } from "./useDecisions";
import { say, type Request, type RequestKind } from "./fixtures";

const props = defineProps<{
  requests: Request[];
  allVisible?: boolean;
  learning?: number;
}>();

const { t } = useI18nTyped();

const META: Record<RequestKind, { label: I18nKey; icon: IconName }> = {
  fixNow: { label: "autoobserve2.needs.labels.fixNow", icon: "build" },
  fromNowOn: { label: "autoobserve2.needs.labels.fromNowOn", icon: "verified-user" },
  retune: { label: "autoobserve2.needs.labels.retune", icon: "volume-off" },
};

const { decisions, phases, decide, undo } = useDecisions();

// Fix-now requests other than search carry their problem, so each card has a distinct test id.
const testId = (request: Request) =>
  request.problem && request.problem !== "search"
    ? `${request.kind}-${request.problem}`
    : request.kind;

const pending = computed(() => props.requests.filter((r) => !decisions[r.id]).length);

const doneText = (request: Request) => {
  const decision = decisions[request.id];
  if (!decision) return raw("");
  if (decision === "yes" && request.doneSettled && phases[request.id] === "fixed") {
    return say(t, request.doneSettled);
  }
  return say(t, decision === "yes" ? request.doneYes : request.doneNo);
};
</script>
