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
  Membership is a flat list: who is on this team. No level is chosen here,
  because "what level is this person?" has no answer at add time — somebody is
  on the team, and the Schedule tab says which rung they rotate through. Same
  split PagerDuty, Opsgenie and Grafana OnCall use, and it is what lets one
  person cover two rungs without being added twice.
-->
<template>
  <OCard data-test="oncall-members">
    <OCardSection>
      <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.membersHint") }}</p>

      <div class="mb-4 flex flex-wrap items-end gap-2">
        <div class="min-w-0 flex-1">
          <OSelect
            v-if="!userLookupFailed"
            v-model="selected"
            multiple
            searchable
            :label="t('oncall.addPeople')"
            :placeholder="t('oncall.memberPickPlaceholder')"
            :options="userOptions"
            :loading="loadingUsers"
            data-test="oncall-members-user-select"
          />
          <OInput
            v-else
            v-model="fallbackEmails"
            :label="t('oncall.addPeople')"
            :placeholder="t('oncall.memberEmailPlaceholder')"
            :help-text="t('oncall.memberEmailFallbackHint')"
            data-test="oncall-members-email-input"
          />
        </div>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!pendingEmails.length"
          :loading="adding"
          data-test="oncall-members-add-btn"
          @click="addMembers"
        >
          {{ t("oncall.addPeopleCta", { count: pendingEmails.length }, pendingEmails.length) }}
        </OButton>
      </div>

      <div v-if="members.length" class="flex flex-wrap gap-2">
        <div
          v-for="member in sortedMembers"
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
      <p v-else class="text-text-secondary text-sm">{{ t("oncall.noMembers") }}</p>

      <!-- The obvious next question after adding people is "so who is
           primary?", and the answer lives one tab over. -->
      <p class="text-text-muted mt-4 text-xs" data-test="oncall-members-next-step">
        {{ t("oncall.membersNextStep") }}
      </p>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import oncallService from "@/services/oncall";
import usersService from "@/services/users";
import type { OnCallTeamMember } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ teamId: string; members: OnCallTeamMember[] }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();
const store = useStore();

const selected = ref<string[]>([]);
const fallbackEmails = ref("");
const adding = ref(false);
const orgUsers = ref<{ email: string; first_name?: string; last_name?: string }[]>([]);
const loadingUsers = ref(false);
// Losing the picker must not lose the ability to add anybody.
const userLookupFailed = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const memberEmails = computed(() => new Set(props.members.map((m) => m.user_email)));

/** Org users not already on the team. */
const userOptions = computed(() =>
  orgUsers.value
    .filter((u) => !memberEmails.value.has(u.email.toLowerCase()))
    .map((u) => ({ label: raw(displayName(u)), value: u.email })),
);

const sortedMembers = computed(() =>
  [...props.members].sort((a, b) => a.user_email.localeCompare(b.user_email)),
);

/** Comma/space/newline separated, so a pasted list works in the fallback. */
const pendingEmails = computed(() => {
  if (!userLookupFailed.value) return selected.value;
  return fallbackEmails.value
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
});

/** "Ana Sharma (ana@o2.ai)" when a name exists, the email otherwise. */
function displayName(user: {
  email: string;
  first_name?: string;
  last_name?: string;
}): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name ? `${name} (${user.email})` : user.email;
}

async function fetchOrgUsers() {
  loadingUsers.value = true;
  try {
    const res = await usersService.orgUsers(orgId.value);
    orgUsers.value = res.data?.data ?? [];
    userLookupFailed.value = false;
  } catch {
    // Not a toast: the form still works, and an error banner over a
    // degraded-but-usable control is noise.
    userLookupFailed.value = true;
  } finally {
    loadingUsers.value = false;
  }
}

async function addMembers() {
  const emails = pendingEmails.value;
  if (!emails.length) return;
  adding.value = true;
  try {
    await oncallService.addMembers({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: { user_emails: emails },
    });
    selected.value = [];
    fallbackEmails.value = "";
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
    });
    emit("changed");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.removeMemberFailed"),
    });
  }
}

onMounted(fetchOrgUsers);
</script>
