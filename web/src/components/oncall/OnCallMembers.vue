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
          <!-- The single-team org is the usual starting point, and picking the
               same eight people one at a time is the whole of its setup. Shown
               only while somebody is still missing. -->
          <OButton
            v-if="everyoneCount"
            variant="outline"
            size="sm-action"
            :loading="adding"
            data-test="oncall-members-add-everyone"
            @click="addEveryone"
          >
            {{ t("oncall.addEveryoneCta", { count: everyoneCount }) }}
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

      <!-- The rota already SKIPS an away member; this says so where the
           people are listed, before somebody asks why the order changed. -->
      <template #cell-away="{ row }">
        <span v-if="awayOf(row.user_email)" class="flex flex-wrap items-center gap-1">
          <OTag variant="warning-soft" size="sm" :data-test="`oncall-members-away-${row.id}`">
            {{ awayLabel(awayOf(row.user_email)!) }}
          </OTag>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="close"
            :aria-label="t('oncall.awayRemove')"
            :data-test="`oncall-members-away-remove-${row.id}`"
            @click.stop="removeAbsence(awayOf(row.user_email)!)"
          />
        </span>
        <span v-else class="text-text-muted text-sm">{{ ABSENT }}</span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="event"
          :aria-label="t('oncall.awayMark')"
          :data-test="`oncall-members-mark-away-${row.id}`"
          @click.stop="openAway(row.user_email)"
        />
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
          size="inline"
          preset="no-data"
          :description="t('oncall.noMembers')"
          data-test="oncall-members-empty"
        />
      </template>
    </OTable>

    <!-- The obvious next question after adding people is "so who is primary?",
         and the answer lives one tab over. -->
    <ODialog
      v-model="awayOpen"
      :title="t('oncall.awayTitle')"
      data-test="oncall-members-away-dialog"
    >
      <div class="flex flex-col gap-3">
        <span class="flex items-center gap-2">
          <OUserCell v-if="awayEmail" :value="awayEmail" />
        </span>
        <p class="text-text-muted text-sm">{{ t("oncall.awayHint") }}</p>
        <OInput
          v-model="awayFrom"
          type="datetime-local"
          :label="t('oncall.awayFrom')"
          data-test="oncall-members-away-from"
        />
        <OInput
          v-model="awayTo"
          type="datetime-local"
          :label="t('oncall.awayTo')"
          :help-text="t('oncall.awayToHint')"
          data-test="oncall-members-away-to"
        />
        <OInput
          v-model="awayReason"
          :label="t('oncall.awayReason')"
          :placeholder="t('oncall.awayReasonPlaceholder')"
          data-test="oncall-members-away-reason"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="awayOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="awaySaving"
            :disabled="!awayFrom || !awayTo"
            data-test="oncall-members-away-save"
            @click="saveAbsence"
          >
            {{ t("oncall.awaySave") }}
          </OButton>
        </div>
      </template>
    </ODialog>

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
import type { OnCallTeamMember, Rotation, Unavailability } from "@/ts/interfaces/oncall";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { ABSENT } from "@/composables/useSloFormat";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  teamId: string;
  members: OnCallTeamMember[];
  rotations?: Rotation[];
  timezone: string;
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

/// The window worth marking: an absence sixty days out is real but not this
/// table's news. Fetched org-wide and filtered to this team's emails.
const ABSENCE_WINDOW_DAYS = 60;
const absences = ref<Unavailability[]>([]);
const awayOpen = ref(false);
const awayEmail = ref("");
const awayFrom = ref("");
const awayTo = ref("");
const awayReason = ref("");
const awaySaving = ref(false);

async function fetchAbsences() {
  try {
    const now = Date.now() * 1000;
    const res = await oncallService.listUnavailability({
      org_identifier: orgId.value,
      from: now,
      to: now + ABSENCE_WINDOW_DAYS * 86_400_000_000,
    });
    absences.value = res.data ?? [];
  } catch {
    absences.value = [];
  }
}

/// The absence worth a chip: current first, else the next upcoming one.
function awayOf(email: string): Unavailability | null {
  const mine = absences.value
    .filter((a) => a.user_email.toLowerCase() === email.toLowerCase())
    .sort((a, b) => a.start_at - b.start_at);
  return mine[0] ?? null;
}

function awayLabel(absence: Unavailability): I18nText {
  const fmt = (micros: number) =>
    new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
      new Date(micros / 1000),
    );
  return Date.now() * 1000 >= absence.start_at
    ? t("oncall.awayUntil", { date: raw(fmt(absence.end_at)) })
    : t("oncall.awayWindow", { from: raw(fmt(absence.start_at)), to: raw(fmt(absence.end_at)) });
}

function openAway(email: string) {
  awayEmail.value = email;
  awayFrom.value = "";
  awayTo.value = "";
  awayReason.value = "";
  awayOpen.value = true;
}

async function saveAbsence() {
  awaySaving.value = true;
  try {
    await oncallService.createUnavailability({
      org_identifier: orgId.value,
      data: {
        user_email: awayEmail.value,
        start_at: new Date(awayFrom.value).getTime() * 1000,
        end_at: new Date(awayTo.value).getTime() * 1000,
        ...(awayReason.value.trim() ? { reason: awayReason.value.trim() } : {}),
      },
    });
    awayOpen.value = false;
    toast({ variant: "success", message: t("oncall.awaySaved") });
    await fetchAbsences();
    // The rota moves the away person's turn, so the schedule tab's answer
    // just changed too.
    emit("changed");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.awaySaveFailed"),
    });
  } finally {
    awaySaving.value = false;
  }
}

async function removeAbsence(absence: Unavailability) {
  try {
    await oncallService.deleteUnavailability({
      org_identifier: orgId.value,
      unavailability_id: absence.id,
    });
    toast({ variant: "success", message: t("oncall.awayRemoved") });
    await fetchAbsences();
    emit("changed");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.awayRemoveFailed"),
    });
  }
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
    id: "away",
    header: t("oncall.awayColumn"),
    accessorFn: (row: OnCallTeamMember) => (awayOf(row.user_email) ? 1 : 0),
    sortable: true,
    size: 200,
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

/// Everybody in the org who is not already on the team — the count the button
/// promises, so it can never add a number different from the one it showed.
const everyoneCount = computed(() => (userLookupFailed.value ? 0 : userOptions.value.length));

function addEveryone() {
  void commitMembers(userOptions.value.map((option) => option.value));
}

/// Takes the list explicitly rather than defaulting to the picker: `@click`
/// hands its own event to the handler, so an optional parameter here would be
/// filled with a MouseEvent and quietly add nobody.
function addMembers() {
  void commitMembers(pendingEmails.value);
}

async function commitMembers(emails: string[]) {
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

onMounted(() => {
  fetchOrgUsers();
  fetchAbsences();
});
</script>
