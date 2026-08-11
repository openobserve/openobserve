<template>
  <div class="flex flex-col gap-4" data-test="oncall-members">
    <OTable
      :data="sortedMembers"
      :columns="columns"
      row-key="id"
      :frame="false"
      pagination="client"
      :show-global-filter="false"
      table-id="oncall-team-members"
      data-test="oncall-members-table"
    >
      <template #toolbar>
        <div class="flex w-full flex-wrap items-end gap-2">
          <div class="min-w-0 flex-1">
            <OSelect
              v-if="!userLookupFailed"
              v-model="selected"
              multiple
              searchable
              :placeholder="t('oncall.memberPickPlaceholder')"
              :options="userOptions"
              :loading="loadingUsers"
              data-test="oncall-members-user-select"
            />
            <OInput
              v-else
              v-model="fallbackEmails"
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
      </template>

      <template #cell-person="{ row }">
        <OUserCell :value="row.user_email" />
      </template>

      <!-- Answers the question adding somebody immediately raises: did that
           actually put them in the paging order? -->
      <template #cell-rotation="{ row }">
        <OTag v-if="rotationOf(row.user_email)" variant="default-soft" size="sm">
          {{ raw(rotationOf(row.user_email) as string) }}
        </OTag>
        <span v-else class="text-text-muted text-sm">{{ t("oncall.notInRotation") }}</span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('oncall.removeMember')"
          :data-test="`oncall-members-remove-${row.id}`"
          @click.stop="removeMember(row)"
        />
      </template>

      <template #empty>
        <OEmptyState
          size="compact"
          preset="no-data"
          :description="t('oncall.noMembers')"
          data-test="oncall-members-empty"
        />
      </template>
    </OTable>

    <!-- The obvious next question after adding people is "so who is primary?",
         and the answer lives one tab over. -->
    <p class="text-text-muted text-xs" data-test="oncall-members-next-step">
      {{ t("oncall.membersNextStep") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import oncallService from "@/services/oncall";
import usersService from "@/services/users";
import type { OnCallTeamMember, Rotation } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  teamId: string;
  members: OnCallTeamMember[];
  rotations?: Rotation[];
}>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();

/// Which rotation, if any, actually pages this person. Adding somebody to a
/// team does not put them in the paging order, and that gap is where "why
/// wasn't I paged" comes from.
function rotationOf(email: string): string | null {
  return (
    props.rotations?.find((r) => r.members?.some((m) => m === email))?.name ?? null
  );
}

const columns = computed<OTableColumnDef<OnCallTeamMember>[]>(() => [
  {
    id: "person",
    header: t("oncall.person"),
    accessorFn: (row: OnCallTeamMember) => row.user_email,
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "rotation",
    header: t("oncall.inRotation"),
    accessorFn: (row: OnCallTeamMember) => rotationOf(row.user_email) ?? "",
    sortable: true,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);
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
