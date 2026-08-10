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
  <OCard data-test="oncall-members">
    <OCardSection>
      <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.membersHint") }}</p>

      <div class="mb-4 flex flex-wrap items-end gap-2">
        <div class="min-w-0 flex-1">
          <OInput
            v-model="newEmail"
            :label="t('oncall.memberEmail')"
            :placeholder="t('oncall.memberEmailPlaceholder')"
            data-test="oncall-members-email-input"
          />
        </div>
        <div class="w-48">
          <OSelect
            v-model="newLevel"
            :label="t('oncall.level')"
            :options="levelOptions"
            data-test="oncall-members-level-select"
          />
        </div>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!newEmail.trim()"
          :loading="adding"
          data-test="oncall-members-add-btn"
          @click="addMember"
        >
          {{ t("oncall.addMember") }}
        </OButton>
      </div>

      <div v-if="grouped.length" class="flex flex-col gap-3">
        <div v-for="group in grouped" :key="group.level" class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <OTag variant="default-soft" size="sm">
              {{ t(`oncall.level_${group.level}`) }}
            </OTag>
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="member in group.members"
              :key="member.id"
              class="border-border-default flex items-center gap-2 rounded-default border px-3 py-1.5"
              data-test="oncall-members-chip"
            >
              <span class="text-text-body text-sm">{{ raw(member.user_email) }}</span>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="close"
                :aria-label="t('oncall.removeMember')"
                data-test="oncall-members-remove-btn"
                @click="removeMember(member)"
              />
            </div>
          </div>
        </div>
      </div>
      <p v-else class="text-text-secondary text-sm">{{ t("oncall.noMembers") }}</p>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import oncallService from "@/services/oncall";
import type { EscalationLevel, OnCallTeamMember } from "@/ts/interfaces/oncall";
import { HUMAN_LEVELS } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { levelOrder } from "@/utils/oncall";

const props = defineProps<{ teamId: string; members: OnCallTeamMember[] }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();
const store = useStore();

const newEmail = ref("");
const newLevel = ref<EscalationLevel>("primary");
const adding = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);

// L0 is the agent's rung and is deliberately absent — no human is ever
// assigned to it.
const levelOptions = computed(() =>
  HUMAN_LEVELS.map((level) => ({
    label: t(`oncall.level_${level}`),
    value: level,
  })),
);

const grouped = computed(() => {
  const byLevel = new Map<EscalationLevel, OnCallTeamMember[]>();
  for (const member of props.members) {
    const list = byLevel.get(member.level) ?? [];
    list.push(member);
    byLevel.set(member.level, list);
  }
  return [...byLevel.entries()]
    .map(([level, list]) => ({ level, members: list }))
    .sort((a, b) => levelOrder(a.level) - levelOrder(b.level));
});

async function addMember() {
  const email = newEmail.value.trim().toLowerCase();
  if (!email) return;
  adding.value = true;
  try {
    await oncallService.addMember({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: { user_email: email, level: newLevel.value },
    });
    newEmail.value = "";
    emit("changed");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.addMemberFailed"),
    });
  } finally {
    adding.value = false;
  }
}

async function removeMember(member: OnCallTeamMember) {
  try {
    await oncallService.removeMember({
      org_identifier: orgId.value,
      team_id: props.teamId,
      user_email: member.user_email,
      level: member.level,
    });
    emit("changed");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.removeMemberFailed"),
    });
  }
}
</script>
