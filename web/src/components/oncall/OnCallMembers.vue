<template>
  <div class="m-4 flex flex-col gap-3" data-test="oncall-members">
    <OTable
      :data="rows"
      :columns="columns"
      row-key="id"
      :frame="true"
      pagination="client"
      :show-global-filter="false"
      :row-class="rowClass"
      table-id="oncall-team-members"
      data-test="oncall-members-table"
    >
      <!-- Add on the left, the state of the roster on the right: the toolbar
           answers "is anyone missing" in the same glance that offers to fix it. -->
      <template #toolbar>
        <div class="flex w-full flex-wrap items-center gap-2">
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

          <span
            v-if="orgTotal"
            class="text-text-secondary ms-auto shrink-0 text-xs"
            data-test="oncall-members-coverage"
          >
            {{ t("oncall.membersOfOrg", { onTeam: onTeamCount, total: orgTotal }) }}
          </span>
        </div>
      </template>

      <!-- Name, why this row matters, and the address underneath it. The three
           badges are mutually exclusive on purpose: a person has one headline. -->
      <template #cell-person="{ row }">
        <span class="flex min-w-0 flex-col gap-0.5 py-1">
          <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-text-heading truncate text-sm font-medium">
              {{ raw(row.name) }}
            </span>
            <OTag v-if="row.state === 'on_call'" variant="success-soft" size="sm">
              {{ t("oncall.badgeOnCallNow") }}
            </OTag>
            <OTag v-else-if="row.state === 'next'" variant="primary-soft" size="sm">
              {{ t("oncall.badgeNextUp") }}
            </OTag>
            <span v-else-if="row.away" class="flex items-center gap-1">
              <OTag variant="warning-soft" size="sm" :data-test="`oncall-members-away-${row.id}`">
                {{ awayLabel(row.away) }}
              </OTag>
              <OButton
                v-if="canConfigure"
                variant="ghost"
                size="icon-xs"
                icon-left="close"
                :aria-label="t('oncall.awayRemove')"
                :data-test="`oncall-members-away-remove-${row.id}`"
                @click.stop="removeAbsence(row.away)"
              />
            </span>
            <OTag v-if="row.unreachable" variant="error-soft" size="sm">
              {{ t("oncall.contactUnreachable") }}
            </OTag>
          </span>
          <span class="text-text-secondary truncate text-xs">{{ raw(row.user_email) }}</span>
        </span>
      </template>

      <template #cell-reach="{ row }">
        <OnCallChannelChips
          :email="row.user_email"
          :channels="row.reach?.channels ?? []"
          :would-land="row.reach?.would_a_page_land ?? true"
        />
      </template>

      <!-- The bar is the whole point: an uneven rota is invisible as a column
           of numbers and obvious as a column of bars. -->
      <template #cell-pages="{ row, value }">
        <ODataBarCell
          :value="row.pages"
          :max="pagesMax"
          :display="String(value)"
          :variant="row.pages > 0 && row.pages >= heavyLoad ? 'warning' : 'default'"
        />
      </template>

      <template #cell-nextShift="{ row }">
        <span class="flex flex-col gap-0.5">
          <span
            :class="row.rotation ? 'text-text-body text-sm' : 'text-text-muted text-sm'"
            :data-test="`oncall-members-shift-${row.id}`"
          >
            {{ shiftLine(row) }}
          </span>
          <span v-if="row.rotation" class="text-text-secondary truncate text-xs">
            {{ row.away ? t("oncall.shiftSkippedWhileAway") : raw(row.rotation) }}
          </span>
        </span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          v-if="canConfigure"
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

    <ODialog
      :open="awayOpen"
      @update:open="(v: boolean) => (awayOpen = v)"
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OnCallChannelChips from "@/components/oncall/OnCallChannelChips.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import oncallService from "@/services/oncall";
import usersService from "@/services/users";
import type {
  MemberReachability,
  OnCallPosition,
  OnCallTeamMember,
  ResolvedSegment,
  Rotation,
  TeamLoad,
  TeamReachability,
  Unavailability,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import { formatInZone, rotationMembers } from "@/utils/oncall";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    teamId: string;
    members: OnCallTeamMember[];
    rotations?: Rotation[];
    timezone: string;
    /**
     * Who holds the pager right now, one entry per rotation — the badge and the
     * row rail. A rotation with a gap is absent rather than null-held.
     */
    onCallNow?: OnCallPosition[];
    /** Would a page land, per person. The verdicts are the server's. */
    reachability?: TeamReachability | null;
    /** Pages carried per person, for the magnitude bars. */
    load?: TeamLoad | null;
    testing?: boolean;
    /** May change on-call configuration. Hides the test-page action when false. */
    canConfigure?: boolean;
  }>(),
  {
    rotations: () => [],
    onCallNow: () => [],
    reachability: null,
    load: null,
    testing: false,
    canConfigure: true,
  },
);
const emit = defineEmits<{ changed: []; "open-schedule": []; "test-page": [] }>();

const { t } = useI18nTyped();
const { noteConfigurationDenied } = useOnCallPermissions();

const store = useStore();
const orgId = computed(() => store.state.selectedOrganization.identifier);

/// Which rotation, if any, actually pages this person. Adding somebody to a
/// team does not put them in the paging order, and that gap is where "why
/// wasn't I paged" comes from.
///
/// Searched through the shift RULES: a rotation is a named position and holds
/// no roster of its own, so a person is on one when any of its rules names
/// them.
function rotationOf(email: string): string | null {
  return (
    props.rotations?.find((rotation) =>
      rotationMembers(rotation).some((m) => m.toLowerCase() === email.toLowerCase()),
    )?.name ?? null
  );
}

/// The window worth marking: an absence sixty days out is real but not this
/// table's news. Fetched org-wide and filtered to this team's emails.
const ABSENCE_WINDOW_DAYS = 60;
/// Far enough to name the next handover for a weekly rota, short enough that
/// the answer is still "soon" rather than a calendar.
const SHIFT_HORIZON_DAYS = 14;

const absences = ref<Unavailability[]>([]);
const segments = ref<ResolvedSegment[]>([]);
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
      to: now + ABSENCE_WINDOW_DAYS * MICROS_PER_DAY,
    });
    absences.value = res.data ?? [];
  } catch {
    absences.value = [];
  }
}

/// The engine's own answer for the next fortnight, so "next shift" is the
/// resolved schedule rather than a guess made from rotation order. Silent on
/// failure: the column falls back to naming the rotation.
async function fetchSegments() {
  try {
    const now = Date.now() * 1000;
    const res = await oncallService.resolvedSchedule({
      org_identifier: orgId.value,
      team_id: props.teamId,
      from: now,
      to: now + SHIFT_HORIZON_DAYS * MICROS_PER_DAY,
    });
    segments.value = res.data ?? [];
  } catch {
    segments.value = [];
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
    await Promise.all([fetchAbsences(), fetchSegments()]);
    // The rota moves the away person's turn, so the schedule tab's answer
    // just changed too.
    emit("changed");
  } catch (err: any) {
    noteConfigurationDenied(err);
    toast({
      variant: "error",
      message:
        err?.response?.status === 403
          ? t("oncall.configDenied")
          : raw(err?.response?.data?.message) || t("oncall.awaySaveFailed"),
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
    await Promise.all([fetchAbsences(), fetchSegments()]);
    emit("changed");
  } catch (err: any) {
    noteConfigurationDenied(err);
    toast({
      variant: "error",
      message:
        err?.response?.status === 403
          ? t("oncall.configDenied")
          : raw(err?.response?.data?.message) || t("oncall.awayRemoveFailed"),
    });
  }
}

// ── The row ───────────────────────────────────────────────────────
// One person, and the four things the tab exists to answer about them: can we
// reach them, how much have they carried, when are they on next, and are they
// in the paging order at all.

type MemberState = "on_call" | "next" | "rostered" | "idle";

interface MemberRow extends OnCallTeamMember {
  /** Display name, or the email when the org has no name on file. */
  name: string;
  /** Rendered under the name — omitted when the name IS the email. */
  subtitle: string;
  state: MemberState;
  rotation: string | null;
  away: Unavailability | null;
  reach: MemberReachability | null;
  pages: number;
  unreachable: boolean;
}

const STATE_RANK: Record<MemberState, number> = { on_call: 0, next: 1, rostered: 2, idle: 3 };

const holders = computed(() => new Set(props.onCallNow.map((s) => s.user_email.toLowerCase())));
const nextHolders = computed(
  () =>
    new Set(
      props.onCallNow
        .map((s) => s.next_user_email?.toLowerCase())
        .filter((e): e is string => Boolean(e)),
    ),
);

function lookup<T extends { user_email: string }>(list: T[] | undefined, email: string) {
  const key = email.toLowerCase();
  return list?.find((x) => x.user_email.toLowerCase() === key) ?? null;
}

/// On call, then next, then merely rostered, then the people no rotation
/// pages. Alphabetical inside each band: the tab's first question is "who is
/// holding it", not "whose name starts with A".
const rows = computed<MemberRow[]>(() => {
  const enriched = props.members.map((m) => {
    const email = m.user_email;
    const name = nameOf(email);
    const reach = lookup(props.reachability?.members, email);
    const rotation = rotationOf(email);
    const state: MemberState = holders.value.has(email.toLowerCase())
      ? "on_call"
      : nextHolders.value.has(email.toLowerCase())
        ? "next"
        : rotation
          ? "rostered"
          : "idle";
    return {
      ...m,
      name,
      subtitle: name === email ? "" : email,
      state,
      rotation,
      away: awayOf(email),
      reach,
      pages: lookup(props.load?.members, email)?.pages ?? 0,
      unreachable: reach ? !reach.would_a_page_land : false,
    };
  });
  return enriched.sort(
    (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name),
  );
});

/// The bar's 100% reference. Computed over every member, not the visible page,
/// so paging cannot rescale the comparison mid-read.
const pagesMax = computed(() => Math.max(0, ...rows.value.map((r) => r.pages)));

/// Colour the bar only once somebody is carrying appreciably more than the
/// middle of the team — a rota is allowed to be slightly uneven.
const UNEVEN_FACTOR = 1.5;
const medianPages = computed(() => {
  const counted = rows.value.map((r) => r.pages).sort((a, b) => a - b);
  if (!counted.length) return 0;
  const mid = Math.floor(counted.length / 2);
  return counted.length % 2 ? counted[mid] : (counted[mid - 1] + counted[mid]) / 2;
});
const heavyLoad = computed(() => medianPages.value * UNEVEN_FACTOR);

/// Only the person actually holding the pager is tinted. Tinting every state
/// turns the table into a legend nobody reads.
const rowClass = (row: MemberRow) => (row.state === "on_call" ? "bg-status-success-bg" : "");

// ── Next shift ────────────────────────────────────────────────────

function segmentsFor(email: string): ResolvedSegment[] {
  const key = email.toLowerCase();
  return segments.value
    .filter((s) => s.user_email?.toLowerCase() === key)
    .sort((a, b) => a.from - b.from);
}

/// Weekday and time inside the week, a date beyond it — the two questions a
/// handover actually raises, and never both at once.
function whenLabel(micros: number): string {
  const withinWeek = micros - Date.now() * 1000 < 7 * MICROS_PER_DAY;
  return formatInZone(
    micros,
    props.timezone,
    withinWeek
      ? { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
      : { weekday: "short", day: "numeric", month: "short" },
  );
}

function shiftLine(row: MemberRow): I18nText {
  const mine = segmentsFor(row.user_email);
  const now = Date.now() * 1000;
  const current = mine.find((s) => s.from <= now && now < s.to);
  if (current) return t("oncall.shiftNowUntil", { until: raw(whenLabel(current.to)) });
  const next = mine.find((s) => s.from > now);
  if (next) return t("oncall.shiftStartsAt", { at: raw(whenLabel(next.from)) });
  // No resolved span for them — either the horizon is too short, or the
  // schedule never reaches them. The rotation tells us which.
  if (row.rotation) {
    return segments.value.length
      ? t("oncall.shiftNoneInHorizon", { days: SHIFT_HORIZON_DAYS })
      : t("oncall.shiftInRotation");
  }
  return t("oncall.notInRotation");
}

// ── Columns ───────────────────────────────────────────────────────

const columns = computed<OTableColumnDef<MemberRow>[]>(() => [
  {
    id: "person",
    header: t("oncall.person"),
    accessorFn: (row) => row.name,
    sortable: true,
    meta: { isName: true, autoWidth: true, fillRemaining: true },
  },
  {
    id: "reach",
    header: t("oncall.reachableVia"),
    accessorFn: (row) => row.reach?.deliverable_channels.length ?? 0,
    sortable: true,
    size: 150,
  },
  {
    id: "pages",
    header: t("oncall.pagesCarriedHeader", { days: props.load?.days ?? 30 }),
    accessorFn: (row) => row.pages,
    sortable: true,
    size: 190,
    meta: { align: "right" },
  },
  {
    id: "nextShift",
    header: t("oncall.nextShift"),
    accessorFn: (row) => STATE_RANK[row.state],
    sortable: true,
    size: 190,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

// ── Adding people ─────────────────────────────────────────────────

const selected = ref<string[]>([]);
const fallbackEmails = ref("");
const adding = ref(false);
const orgUsers = ref<{ email: string; first_name?: string; last_name?: string }[]>([]);
const loadingUsers = ref(false);
// Losing the picker must not lose the ability to add anybody.
const userLookupFailed = ref(false);

const memberEmails = computed(() => new Set(props.members.map((m) => m.user_email)));

/** Org users not already on the team. */
const userOptions = computed(() =>
  orgUsers.value
    .filter((u) => !memberEmails.value.has(u.email.toLowerCase()))
    .map((u) => ({ label: raw(displayName(u)), value: u.email })),
);

const orgTotal = computed(() => orgUsers.value.length);
const onTeamCount = computed(() => props.members.length);

/** Comma/space/newline separated, so a pasted list works in the fallback. */
const pendingEmails = computed(() => {
  if (!userLookupFailed.value) return selected.value;
  return fallbackEmails.value
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
});

/** "Ana Sharma (ana@o2.ai)" when a name exists, the email otherwise. */
function displayName(user: { email: string; first_name?: string; last_name?: string }): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name ? `${name} (${user.email})` : user.email;
}

/** Just the name for the table — the email is already on the line below it. */
function nameOf(email: string): string {
  const user = orgUsers.value.find((u) => u.email.toLowerCase() === email.toLowerCase());
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return name || email;
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

// A team switched under the tab is a different roster and a different schedule.
watch(() => props.teamId, fetchSegments);

onMounted(() => {
  fetchOrgUsers();
  fetchAbsences();
  fetchSegments();
});
</script>
