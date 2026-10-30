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

<!-- One rule's people in handover order: a line from whoever holds the turn, or the editable list. -->
<template>
  <div class="flex min-w-0 flex-col gap-2" :data-test="`oncall-rule-people-${ruleIndex}`">
    <div
      v-if="!expanded"
      class="flex flex-wrap items-center gap-2"
      :data-test="`oncall-rule-people-line-${ruleIndex}`"
    >
      <template v-for="(member, position) in shown" :key="member">
        <OIcon
          v-if="position > 0"
          name="arrow-forward"
          size="xs"
          class="text-text-secondary"
          aria-hidden="true"
        />
        <span class="text-sm" :title="member">{{ raw(nameOf(member)) }}</span>
        <OTag
          v-if="position === 0 && holder"
          :variant="holder.now ? 'success-soft' : 'default-soft'"
          size="xs"
          :data-test="`oncall-rule-people-holder-${ruleIndex}`"
        >
          {{ holder.now ? t("oncall.peopleOnNow") : t("oncall.peopleNextUp") }}
        </OTag>
      </template>
      <span v-if="hidden" class="text-text-secondary text-sm">
        {{ t("oncall.peopleMore", { count: hidden }) }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`oncall-rule-people-edit-${ruleIndex}`"
        @click="expanded = true"
      >
        {{ t("oncall.peopleEdit") }}
      </OButton>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <OText variant="meta">
          {{ t("oncall.peopleCount", { count: rule.members.length }, rule.members.length) }}
        </OText>
        <OText variant="meta" class="ms-auto">{{ t("oncall.peopleKeyboardHint") }}</OText>
        <OButton
          v-if="rule.members.length"
          variant="ghost-primary"
          size="xs"
          :data-test="`oncall-rule-people-done-${ruleIndex}`"
          @click="expanded = false"
        >
          {{ t("oncall.peopleDone") }}
        </OButton>
      </div>

      <VueDraggableNext
        v-if="rule.members.length"
        :model-value="rule.members"
        handle=".people-drag-handle"
        class="border-border-default divide-border-default rounded-default flex max-h-72 flex-col divide-y overflow-y-auto border"
        :data-test="`oncall-rule-people-list-${ruleIndex}`"
        @update:model-value="(members: string[]) => setMembers(rule, members)"
      >
        <div
          v-for="(member, position) in rule.members"
          :key="member"
          tabindex="0"
          class="focus-visible:bg-surface-panel flex items-center gap-2 px-2 py-1 outline-none"
          :data-test="`oncall-rule-person-${ruleIndex}-${position}`"
          @keydown.alt.up.prevent="move(position, position - 1, $event)"
          @keydown.alt.down.prevent="move(position, position + 1, $event)"
        >
          <OIcon
            name="drag-indicator"
            size="sm"
            class="people-drag-handle text-text-secondary cursor-grab"
            :label="t('oncall.memberOrderDrag')"
          />
          <span class="text-text-secondary min-w-4 text-xs tabular-nums">{{ position + 1 }}</span>
          <OUserCell :value="member" />
          <OTag
            v-if="holder?.email === member"
            :variant="holder.now ? 'success-soft' : 'default-soft'"
            size="xs"
          >
            {{ holder.now ? t("oncall.peopleOnNow") : t("oncall.peopleNextUp") }}
          </OTag>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                icon-left="more-horiz"
                variant="ghost"
                size="icon-xs-sq"
                class="ms-auto"
                :aria-label="t('oncall.peopleMenu', { name: raw(member) })"
                :data-test="`oncall-rule-person-menu-${ruleIndex}-${position}`"
              />
            </template>
            <ODropdownItem
              :disabled="!holder || holder.email === member"
              :data-test="`oncall-rule-person-make-current-${ruleIndex}-${position}`"
              @select="makeCurrent(member)"
            >
              {{
                holder?.now === false
                  ? t("oncall.peopleMakeNextUp")
                  : t("oncall.peopleMakeOnCallNow")
              }}
            </ODropdownItem>
            <ODropdownItem :disabled="position === 0" @select="move(position, position - 1)">
              {{ t("oncall.peopleMoveUp") }}
            </ODropdownItem>
            <ODropdownItem
              :disabled="position === rule.members.length - 1"
              @select="move(position, position + 1)"
            >
              {{ t("oncall.peopleMoveDown") }}
            </ODropdownItem>
            <ODropdownItem :disabled="position === 0" @select="move(position, 0)">
              {{ t("oncall.peopleMoveTop") }}
            </ODropdownItem>
            <ODropdownSeparator />
            <ODropdownItem
              variant="destructive"
              :data-test="`oncall-rule-person-remove-${ruleIndex}-${position}`"
              @select="remove(member)"
            >
              {{ t("oncall.peopleRemove") }}
            </ODropdownItem>
          </ODropdown>
        </div>
      </VueDraggableNext>

      <div class="flex flex-wrap items-center gap-2">
        <OSelect
          :model-value="null"
          searchable
          class="min-w-0 flex-1"
          :placeholder="t('oncall.peopleAddPlaceholder')"
          :options="addable"
          :disabled="!addable.length"
          :data-test="`oncall-rule-people-add-${ruleIndex}`"
          @update:model-value="add"
        />
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!addable.length"
          :data-test="`oncall-rule-people-add-all-${ruleIndex}`"
          @click="addEveryone"
        >
          {{ t("oncall.peopleAddEveryone", { count: addable.length }) }}
        </OButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import type { ShiftRule } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { rotateMembersTo, turnLine, withRoster } from "@/utils/oncall";

const LINE_NAMES = 4;

const props = defineProps<{
  rule: ShiftRule;
  ruleIndex: number;
  /** Who holds this rule's turn now, or next, read from the server's preview. */
  holder: { email: string; now: boolean } | null;
  nameOf: (email: string) => string;
  teamMembers: string[];
  /** The team's zone; shifts are counted in its wall time, as the server counts them. */
  timezone: string;
  setMembers: (rule: ShiftRule, members: string[]) => void;
}>();

const { t } = useI18nTyped();

const rule = computed(() => props.rule);

// A rule nobody is in has nothing to summarise, so it opens on the list.
const expanded = ref(!props.rule.members.length);

const line = computed(() => turnLine(props.rule.members, props.holder?.email ?? null));
const shown = computed(() => line.value.slice(0, LINE_NAMES));
const hidden = computed(() => Math.max(0, line.value.length - LINE_NAMES));

const addable = computed(() =>
  props.teamMembers
    .filter((email) => !props.rule.members.includes(email))
    .map((email) => ({ label: raw(email), value: email })),
);

// Same rule as the server's save: whoever is on call now stays on call, newcomers go last.
function setRoster(members: string[]) {
  props.setMembers(props.rule, withRoster(props.rule, members, Date.now() * 1000, props.timezone));
}

function add(value: unknown) {
  if (typeof value !== "string" || !value) return;
  setRoster([...props.rule.members, value]);
}

function addEveryone() {
  setRoster([...props.rule.members, ...addable.value.map((option) => option.value)]);
}

function remove(member: string) {
  setRoster(props.rule.members.filter((m) => m !== member));
}

function move(from: number, to: number, event?: KeyboardEvent) {
  const members = [...props.rule.members];
  if (to < 0 || to >= members.length) return;
  const [person] = members.splice(from, 1);
  members.splice(to, 0, person);
  props.setMembers(props.rule, members);
  // Keyboard focus follows the moved person, so Alt+arrow can be pressed again.
  const list = (event?.currentTarget as HTMLElement | undefined)?.parentElement;
  if (list) nextTick(() => (list.children[to] as HTMLElement | undefined)?.focus());
}

// The turn's index stays where it is; the list turns so the chosen person sits on it.
function makeCurrent(member: string) {
  const at = props.holder ? props.rule.members.indexOf(props.holder.email) : -1;
  if (at < 0) return;
  props.setMembers(props.rule, rotateMembersTo(props.rule.members, member, at));
}
</script>
