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
  The ways this team would fail to wake somebody.

  Every finding is the server's own sentence, rendered verbatim; this component
  only orders them, groups them by what they cost, adds the evidence the
  sentence cannot carry, and points each at the tab that repairs it.

  Two shapes. Collapsed it is one line — the worst finding and a way in — because
  a banner that stacks three finished sentences is a paragraph nobody finishes.
  Opened it is one finding per row, so each keeps its own detail, evidence and
  fix instead of sharing a line with the next one.
-->
<template>
  <template v-if="rows.length">
    <div
      v-if="expanded"
      class="card-container border-border-default bg-surface-base rounded-surface overflow-hidden border"
      data-test="oncall-team-attention"
    >
      <!-- Tinted on the header only: the findings below carry their own severity
           on the row rail, and tinting the whole card would drown them. -->
      <div
        class="bg-banner-warning-bg border-banner-warning-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5"
      >
        <OIcon name="warning-amber" size="sm" class="text-status-warning-text shrink-0" />
        <OText variant="body-strong">{{ t("oncall.attentionHeading") }}</OText>

        <!-- The three counts are the shape of the problem before any reading:
             what is broken, what is thin, and what is merely dead. -->
        <OTag
          v-for="group in groups"
          :key="`count-${group.id}`"
          :variant="group.countVariant"
          size="sm"
          :data-test="`oncall-attention-count-${group.id}`"
        >
          {{ t(group.countKey, { count: group.rows.length }, group.rows.length) }}
        </OTag>

        <span class="ms-auto flex shrink-0 items-center gap-3">
          <span
            v-if="checkedLabel"
            class="text-text-muted text-xs"
            data-test="oncall-attention-checked"
          >
            {{ checkedLabel }}
          </span>
          <OButton
            variant="ghost"
            size="xs"
            icon-right="expand-less"
            data-test="oncall-attention-collapse"
            @click="expanded = false"
          >
            {{ t("oncall.attentionCollapse") }}
          </OButton>
        </span>
      </div>

      <section
        v-for="group in groups"
        :key="group.id"
        :data-test="`oncall-attention-group-${group.id}`"
      >
        <h3
          class="text-text-secondary text-2xs bg-surface-subtle border-border-subtle flex items-center gap-2 border-b px-4 py-1.5 tracking-wide uppercase"
        >
          {{ t(group.headingKey) }}
          <span class="text-text-muted">{{ group.rows.length }}</span>
        </h3>

        <div
          v-for="row in group.rows"
          :key="row.key"
          class="border-border-subtle flex flex-wrap items-start gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0"
          :data-test="`oncall-attention-${row.kind}`"
        >
          <span
            class="mt-1.5 size-1.5 shrink-0 rounded-full"
            :class="DOT_CLASS[row.bucket]"
            aria-hidden="true"
          />

          <div class="flex min-w-0 flex-1 basis-80 flex-col gap-1">
            <OText variant="body-strong">{{ row.headline }}</OText>
            <p v-if="row.detail" class="text-text-secondary text-sm">{{ row.detail }}</p>

            <!-- What the sentence cannot say: who it costs, and how often this
                 path has actually been used lately. -->
            <p
              v-if="row.evidence.length"
              class="text-text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
              :data-test="`oncall-attention-evidence-${row.kind}`"
            >
              <span v-for="fact in row.evidence" :key="String(fact)">{{ fact }}</span>
            </p>
          </div>

          <!-- One action per finding, named for the repair rather than the
               destination — every one of them is the same tab switch, and two
               buttons that land in the same place is a choice nobody has. -->
          <OButton
            v-if="row.fix"
            :variant="row.bucket === 'blocking' ? 'primary' : 'outline'"
            size="xs"
            class="shrink-0"
            :data-test="`oncall-attention-cta-${row.kind}`"
            @click="emit('act', row.fix)"
          >
            {{ t(row.cta) }}
          </OButton>
        </div>
      </section>

      <div
        class="border-border-default bg-surface-subtle flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2"
      >
        <span class="text-text-muted text-xs">{{ t("oncall.attentionFooter") }}</span>
        <!-- Stated rather than silently dropped: the server truncates, and a
             list that ends without saying so reads as the whole answer. -->
        <span v-if="hidden > 0" class="text-text-muted text-xs" data-test="oncall-attention-hidden">
          {{ t("oncall.attentionHidden", { count: hidden }, hidden) }}
        </span>
        <OButton
          variant="outline"
          size="xs"
          icon-left="refresh"
          class="ms-auto shrink-0"
          data-test="oncall-attention-recheck"
          @click="emit('recheck')"
        >
          {{ t("oncall.attentionRecheck") }}
        </OButton>
      </div>
    </div>

    <OBanner
      v-else
      variant="warning"
      icon="warning-amber"
      inline-actions
      dense
      data-test="oncall-team-attention"
    >
      <span class="flex min-w-0 items-center gap-x-3">
        <span class="text-text-secondary text-2xs shrink-0 tracking-wide uppercase">
          {{ t("oncall.attentionHeading") }}
        </span>
        <span class="flex min-w-0 items-center gap-1.5" :data-test="`oncall-attention-${worst.kind}`">
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="DOT_CLASS[worst.bucket]"
            aria-hidden="true"
          />
          <!-- The worst finding whole, on one line. The count moved into the
               disclosure button, so nothing here can wrap the strip. -->
          <span class="text-text-body min-w-0 truncate text-sm">
            {{ worst.message }}
            <OTooltip side="bottom" :content="worst.message" />
          </span>
        </span>
      </span>

      <template #actions>
        <span class="flex shrink-0 items-center gap-2">
          <OButton
            v-if="worst.fix"
            variant="outline"
            size="xs"
            data-test="oncall-attention-fix-now"
            @click="emit('act', worst.fix)"
          >
            {{ t(worst.cta) }}
          </OButton>
          <OButton
            variant="ghost"
            size="xs"
            icon-right="expand-more"
            data-test="oncall-attention-expand"
            @click="expanded = true"
          >
            {{ t("oncall.attentionFindings", { count: findingCount }, findingCount) }}
          </OButton>
        </span>
      </template>
    </OBanner>
  </template>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  ConfigRisk,
  ConfigRisks,
  TeamOverview,
  TeamReachability,
} from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    risks?: ConfigRisks | null;
    /**
     * `GET .../reachability` — the deployment-level half of "can we page".
     *
     * Present so the banner can tell one broken deployment apart from N broken
     * people: the server reports `unreachable_on_rung` once per (person,
     * priority), which on a deployment with no transport is the same sentence
     * as many times as the ladder names somebody.
     */
    reachability?: TeamReachability | null;
    /**
     * `GET .../overview` — the team's last N days of paging.
     *
     * The findings are computed from configuration and so can only describe
     * what WOULD happen. This is what already did: a broken ladder that carried
     * twenty pages last week is a different priority from one that carried none.
     */
    overview?: TeamOverview | null;
    /** Micros — when the findings were last fetched. */
    checkedAt?: number | null;
    /**
     * Whether the team has anybody on it.
     *
     * The engine reports no finding for an empty roster — it sees the coverage
     * gap that follows from it — so a team nobody is on was told to go and fix
     * its schedule, which is the one tab that cannot fix it. `null` means the
     * roster has not been read yet and nothing is claimed.
     */
    hasMembers?: boolean | null;
  }>(),
  { risks: null, reachability: null, overview: null, checkedAt: null, hasMembers: null },
);

const emit = defineEmits<{
  /** The tab that repairs the finding: `policy` | `schedule` | `ownership`. */
  (e: "act", tab: string): void;
  /** Re-run the checks — they are derived, so a refetch is the whole answer. */
  (e: "recheck"): void;
}>();

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

const expanded = ref(false);

type FixTab = "policy" | "schedule" | "ownership" | "members";

/// Which tab repairs each finding, and what the button that goes there should
/// be called. Named for the repair — "Add a final rung" tells you what you are
/// about to do in a way "Open escalation" does not.
const FIX_FOR_KIND: Record<string, { tab: FixTab; cta: I18nKey }> = {
  priority_pages_nobody: { tab: "policy", cta: "oncall.attentionOpenPolicy" },
  ladder_last_rung_is_not_the_whole_team: {
    tab: "policy",
    cta: "oncall.attentionAddFinalRung",
  },
  slot_pages_nobody: { tab: "policy", cta: "oncall.attentionOpenPolicy" },
  unreachable_on_rung: { tab: "policy", cta: "oncall.attentionOpenPolicy" },
  coverage_gap: { tab: "schedule", cta: "oncall.attentionFillGap" },
  single_member_rotation: { tab: "schedule", cta: "oncall.attentionAddMember" },
  rotation_hands_a_shift_to_someone_away: {
    tab: "schedule",
    cta: "oncall.attentionOpenSchedule",
  },
  slots_can_collide: { tab: "schedule", cta: "oncall.attentionOpenSchedule" },
  ownership_rule_never_matched: { tab: "ownership", cta: "oncall.attentionOpenRouting" },
};

/// Synthesised here, not reported by the engine: a team with nobody on it.
const NO_MEMBERS = "team_has_no_members";

const DEFAULT_FIX = { tab: "policy" as FixTab, cta: "oncall.attentionOpenPolicy" as I18nKey };

/// What a finding costs, which is what decides where it sits. `high` is a page
/// that will not be delivered; `low` is configuration that stopped meaning
/// anything; everything else is a page that can run out of people.
type Bucket = "blocking" | "gaps" | "inert";

function bucketFor(severity: string): Bucket {
  if (severity === "high") return "blocking";
  if (severity === "low") return "inert";
  return "gaps";
}

const DOT_CLASS: Record<Bucket, string> = {
  blocking: "bg-status-error-text",
  gaps: "bg-status-warning-text",
  inert: "bg-text-muted",
};

const BUCKET_ORDER: Bucket[] = ["blocking", "gaps", "inert"];

/// Stable across re-sorts: two findings of one kind differ by who they name.
function riskKey(risk: ConfigRisk): string {
  return `${risk.kind}:${risk.priority ?? ""}:${risk.user_email ?? risk.rotation ?? risk.rule_id ?? ""}`;
}

/** One finding — the server's sentence, split into what it is and why. */
interface AttentionRow {
  key: string;
  kind: string;
  bucket: Bucket;
  /** The sentence whole, for the one-line collapsed strip. */
  message: I18nText;
  /** Its first clause: what is wrong. */
  headline: I18nText;
  /** The rest: why that matters. Empty when the sentence has one clause. */
  detail: I18nText | "";
  /** Facts the sentence cannot carry — who it costs, how often it has mattered. */
  evidence: I18nText[];
  /** The tab that repairs it, or null when this screen cannot. */
  fix: FixTab | null;
  cta: I18nKey;
}

/// The server writes `what is wrong — why it matters`. Split on that break so
/// the two halves can be weighted differently; never re-worded, so the UI and
/// the engine cannot disagree about what is broken.
const CLAUSE_BREAK = " — ";

function splitMessage(message: string): [string, string] {
  const at = message.indexOf(CLAUSE_BREAK);
  if (at < 0) return [message, ""];
  return [message.slice(0, at), message.slice(at + CLAUSE_BREAK.length)];
}

/// The finding the server reports per person, per priority.
const UNREACHABLE_ON_RUNG = "unreachable_on_rung";

const transportMissing = computed(
  () => !!props.reachability && !props.reachability.smtp_configured,
);

const sorted = computed<ConfigRisk[]>(() =>
  [...(props.risks?.risks ?? [])].sort(
    (a, b) => BUCKET_ORDER.indexOf(bucketFor(a.severity)) - BUCKET_ORDER.indexOf(bucketFor(b.severity)),
  ),
);

/// The unreachable-on-rung findings, which collapse into one line when their
/// cause is the deployment rather than the people.
const collapsible = computed(() =>
  transportMissing.value ? sorted.value.filter((risk) => risk.kind === UNREACHABLE_ON_RUNG) : [],
);

/// How many pages actually travelled this team's ladder in the overview window.
/// The number that turns "this would not deliver" into "this did not deliver".
const pagesInWindow = computed<I18nText | null>(() => {
  const stats = props.overview?.stats;
  const days = props.overview?.days;
  if (!stats?.pages || !days) return null;
  return t("oncall.attentionPagesSent", { count: stats.pages, days }, stats.pages);
});

function evidenceFor(risk: ConfigRisk): I18nText[] {
  const out: I18nText[] = [];
  const days = props.overview?.days ?? 0;
  const reachedFinal = props.overview?.stats?.reached_final_rung ?? 0;

  switch (risk.kind) {
    case "coverage_gap": {
      // Only while it is still ahead: a gap that has opened is described by the
      // schedule itself, and a countdown that has passed reads as stale.
      const at = risk.at;
      if (at) {
        const away = at - nowMicros.value;
        if (away > 0) out.push(t("oncall.attentionStartsIn", { duration: formatMicrosDuration(away) }));
      }
      break;
    }
    case "single_member_rotation":
      if (risk.rotation) out.push(raw(risk.rotation));
      break;
    case "ladder_last_rung_is_not_the_whole_team":
      if (reachedFinal && days) {
        out.push(t("oncall.attentionReachedFinal", { count: reachedFinal, days }, reachedFinal));
      }
      break;
    case "ownership_rule_never_matched":
      if (risk.path) out.push(raw(risk.path));
      break;
    default:
      break;
  }
  return out;
}

function rowFor(risk: ConfigRisk): AttentionRow {
  const [headline, detail] = splitMessage(risk.message);
  const fix = FIX_FOR_KIND[risk.kind] ?? DEFAULT_FIX;
  return {
    key: riskKey(risk),
    kind: risk.kind,
    bucket: bucketFor(risk.severity),
    message: raw(risk.message),
    headline: raw(headline),
    detail: detail ? raw(detail) : "",
    evidence: evidenceFor(risk),
    fix: fix.tab,
    cta: fix.cta,
  };
}

/// Rows to draw.
///
/// With no transport configured, "ana is on the P1 ladder and no page can reach
/// them" arrives once per person per priority — five findings, one cause, and
/// the reader learns nothing from the fifth that the first did not say. They
/// become one line naming who it costs.
const rows = computed<AttentionRow[]>(() => {
  const collapsed = collapsible.value;
  const empty = props.hasMembers === false;
  const out: AttentionRow[] = sorted.value
    .filter((risk) => !collapsed.includes(risk))
    // On an empty roster the gap IS the missing people, and saying both stacks
    // two sentences with one cause and sends the reader to the wrong tab first.
    .filter((risk) => !(empty && risk.kind === "coverage_gap"))
    .map(rowFor);

  if (empty) {
    out.unshift({
      key: NO_MEMBERS,
      kind: NO_MEMBERS,
      bucket: "blocking",
      message: t("oncall.attentionNoMembers"),
      headline: t("oncall.attentionNoMembersHeadline"),
      detail: t("oncall.attentionNoMembersDetail"),
      evidence: [],
      fix: "members",
      cta: "oncall.attentionAddMember",
    });
  }

  if (!collapsed.length) return out;

  // Distinct people, in the order the server named them: the same person on
  // three ladders is one person who cannot be paged.
  const who = [...new Set(collapsed.map((risk) => risk.user_email).filter(Boolean))] as string[];
  const evidence: I18nText[] = [t("oncall.attentionPeopleAffected", { count: who.length, names: raw(who.join(", ")) }, who.length)];
  const sent = pagesInWindow.value;
  if (sent) evidence.push(sent);

  // Blocking, so it sorts to the front the way its members would have.
  out.unshift({
    key: `${UNREACHABLE_ON_RUNG}:no-transport`,
    kind: UNREACHABLE_ON_RUNG,
    bucket: "blocking",
    message: t("oncall.attentionNoTransport"),
    headline: t("oncall.attentionNoTransportHeadline"),
    detail: t("oncall.attentionNoTransportDetail"),
    evidence,
    // Nothing on this page configures a transport.
    fix: null,
    cta: DEFAULT_FIX.cta,
  });
  return out;
});

const COUNT_KEY: Record<Bucket, I18nKey> = {
  blocking: "oncall.attentionCountBlocking",
  gaps: "oncall.attentionCountGaps",
  inert: "oncall.attentionCountInert",
};

const HEADING_KEY: Record<Bucket, I18nKey> = {
  blocking: "oncall.attentionGroupBlocking",
  gaps: "oncall.attentionGroupGaps",
  inert: "oncall.attentionGroupInert",
};

const COUNT_VARIANT: Record<Bucket, "error-soft" | "amber-soft" | "default-soft"> = {
  blocking: "error-soft",
  gaps: "amber-soft",
  inert: "default-soft",
};

const groups = computed(() =>
  BUCKET_ORDER.map((bucket) => ({
    id: bucket,
    headingKey: HEADING_KEY[bucket],
    countKey: COUNT_KEY[bucket],
    countVariant: COUNT_VARIANT[bucket],
    rows: rows.value.filter((row) => row.bucket === bucket),
  })).filter((group) => group.rows.length),
);

/// The worst one, which is the whole collapsed strip.
const worst = computed<AttentionRow>(() => rows.value[0] as AttentionRow);

/// Counted against the server's `total`, not the list it sent: it truncates,
/// and a count describing only what arrived would quietly under-report. The
/// folded findings are discounted from that total — re-counting them behind a
/// count would put the same fact back on the screen the moment somebody opened it.
const findingCount = computed(() => {
  const total = props.risks?.total ?? sorted.value.length;
  const folded = collapsible.value.length ? collapsible.value.length - 1 : 0;
  return Math.max(rows.value.length, total - folded);
});

const hidden = computed(() => Math.max(0, findingCount.value - rows.value.length));

/// Empty until the first fetch lands: "checked never" is a fact about this
/// component, not about the team.
const checkedLabel = computed<I18nText | "">(() => {
  const at = props.checkedAt;
  if (!at) return "";
  const ago = nowMicros.value - at;
  if (ago < 60_000_000) return t("oncall.attentionCheckedJustNow");
  return t("oncall.attentionCheckedAgo", { duration: formatMicrosDuration(ago) });
});
</script>
