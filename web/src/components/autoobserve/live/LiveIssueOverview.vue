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
  <div
    class="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 [&>*]:shrink-0"
    data-test="autoobserve-live-issue-overview"
  >
    <div class="flex flex-wrap items-center gap-2">
      <OTag type="severity" :value="item.incident.severity" size="sm" />
      <OTag type="incidentStatus" :value="item.incident.status" size="sm" />
      <OTag
        v-for="name in chips.shown"
        :key="name"
        variant="default-soft"
        shape="rounded"
        size="sm"
        :label="raw(name)"
      />
      <OTag
        v-if="chips.more"
        variant="default-soft"
        shape="rounded"
        size="sm"
        :title="chips.rest"
        :label="chips.more"
        data-test="autoobserve-live-issue-streams-more"
      />
    </div>

    <div
      class="flex flex-col gap-4 @min-[64rem]:grid @min-[64rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[64rem]:items-start"
    >
      <div
        class="contents @min-[64rem]:flex @min-[64rem]:min-w-0 @min-[64rem]:flex-col @min-[64rem]:gap-4"
      >
        <OCard variant="glass" data-test="autoobserve-issue-rca">
          <OCardSection role="header" dense>
            <OIcon name="psychology" size="sm" class="text-text-secondary" />
            <OText variant="panel-title">{{
              headline ? t("autoobserve.drawer.rca") : t("autoobserve.issueLive.whatHappened")
            }}</OText>
          </OCardSection>
          <OCardSection role="body" dense class="flex flex-col gap-3">
            <p class="text-text-body text-sm" data-test="autoobserve-live-issue-why">{{ why }}</p>
            <p
              v-if="!headline && causeNote"
              class="text-text-secondary -mt-2 text-xs"
              data-test="autoobserve-live-issue-no-cause"
            >
              {{ causeNote }}
            </p>
            <div class="bg-surface-subtle rounded-surface flex flex-col gap-1.5 p-3">
              <span class="text-text-body text-xs font-medium">{{
                headline
                  ? t("autoobserve.drawer.likelyCause")
                  : t("autoobserve.issueLive.whatToCheck")
              }}</span>
              <p class="text-text-heading text-sm" data-test="autoobserve-live-issue-likely">
                {{ headline ?? next }}
              </p>
            </div>
            <AoConfidenceMeter v-if="band" :band="band" :reason="bandReason" />
            <IssueSignal
              :stream="streams[0] ?? null"
              :anchor-us="item.finding.first_seen_at"
              :end-us="issueEndUs(item)"
              :active="item.incident.status !== 'resolved'"
              size="card"
              class="border-border-subtle border-t pt-3"
              data-test="autoobserve-issue-chart"
            />
            <p
              v-if="streams.length > 1"
              class="text-text-secondary text-xs"
              data-test="autoobserve-issue-chart-note"
            >
              {{
                t(
                  "autoobserve.issueLive.spark.leadNote",
                  { stream: raw(streams[0].name), count: streams.length - 1 },
                  streams.length - 1,
                )
              }}
            </p>
            <OButton
              variant="ghost-primary"
              size="xs"
              class="self-start"
              data-test="autoobserve-issue-see-evidence"
              @click="emit('see-evidence')"
            >
              {{ t("autoobserve.issueLive.seeAnalysis") }}
            </OButton>
          </OCardSection>
        </OCard>
        <OCard
          variant="glass"
          class="order-1 @min-[64rem]:order-none"
          data-test="autoobserve-issue-notification"
        >
          <OCardSection role="header" dense>
            <OIcon :name="notice.icon" size="sm" class="text-text-secondary" />
            <OText variant="panel-title">{{ notice.title }}</OText>
          </OCardSection>
          <OCardSection role="body" dense class="flex flex-col gap-2">
            <p
              class="text-sm"
              :class="NOTICE_INK[notice.tone]"
              data-test="autoobserve-live-issue-page"
            >
              {{ notice.text }}
            </p>
            <OButton
              v-if="notice.routing"
              variant="outline"
              size="sm"
              class="self-start"
              data-test="autoobserve-live-issue-routing"
              @click="router.push({ name: 'onCallRouting', query: { org_identifier: org } })"
            >
              {{ t("autoobserveLive.incidents.routing") }}
            </OButton>
            <p class="text-text-secondary text-xs">{{ t("autoobserve.issueLive.pageNote") }}</p>
          </OCardSection>
        </OCard>
      </div>
      <div
        class="contents @min-[64rem]:flex @min-[64rem]:min-w-0 @min-[64rem]:flex-col @min-[64rem]:gap-4"
      >
        <OCard variant="glass" data-test="autoobserve-issue-timeline">
          <OCardSection role="header" dense>
            <OIcon name="timeline" size="sm" class="text-text-secondary" />
            <OText variant="panel-title">{{ t("autoobserve.drawer.timeline") }}</OText>
          </OCardSection>
          <OCardSection role="body" dense class="flex flex-col gap-2">
            <OTimeline>
              <OTimelineItem
                v-for="(entry, i) in timeline.entries"
                :key="i"
                :label="raw(entry.at)"
                :title="entry.title"
                :subtitle="entry.detail || undefined"
                :variant="entry.variant"
              />
            </OTimeline>
            <p
              v-if="eventsFailed"
              class="text-status-error-text text-xs"
              role="alert"
              data-test="autoobserve-live-issue-events-error"
            >
              {{ t("autoobserve.issueLive.eventsFailed") }}
            </p>
            <OButton
              v-if="timeline.more"
              variant="ghost-primary"
              size="xs"
              class="self-start"
              data-test="autoobserve-live-issue-timeline-more"
              @click="emit('open-activity')"
            >
              {{ t("autoobserve.issueLive.timelineMore", { count: timeline.more }, timeline.more) }}
            </OButton>
          </OCardSection>
        </OCard>
        <OCard variant="glass" data-test="autoobserve-issue-blast">
          <OCardSection role="header" dense>
            <OIcon name="hub" size="sm" class="text-text-secondary" />
            <OText variant="panel-title">{{ t("autoobserve.drawer.blastRadius") }}</OText>
          </OCardSection>
          <OCardSection role="body" dense class="flex flex-col gap-1.5">
            <span class="text-text-secondary text-xs font-medium">{{
              t("autoobserve.issueLive.affectedStreams")
            }}</span>
            <div class="flex flex-wrap gap-1">
              <OTag
                v-for="s in blast.shown"
                :key="`${s.type}/${s.name}`"
                :variant="s.recoveredUs === null ? 'error-soft' : 'default-soft'"
                shape="rounded"
                size="sm"
                :title="s.recoveredUs === null ? stillOut : backText"
                :label="raw(s.name)"
                data-test="autoobserve-live-issue-blast-stream"
              />
              <span v-if="blast.more" class="text-text-secondary self-center text-xs">{{
                blast.more
              }}</span>
            </div>
            <p class="text-text-secondary text-xs">{{ t("autoobserve.issueLive.blastNote") }}</p>
          </OCardSection>
        </OCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import type { RcaBand } from "@/services/incidents";
import { pagedFindingCopy } from "../insight/kindCopy";
import AoConfidenceMeter from "./AoConfidenceMeter.vue";
import IssueSignal from "./IssueSignal.vue";
import { issueEndUs, type IssueStreamInfo, type IssueTimelineView } from "./issueModel";
import { useLiveZone } from "./liveModel";

type NoticeTone = "neutral" | "warning" | "error";

const props = defineProps<{
  item: AutoObserveIncidentItem;
  streams: IssueStreamInfo[];
  why: I18nText;
  next: I18nText;
  headline: I18nText | null;
  // Why the card holds no cause, when no analysis named one.
  causeNote: I18nText | null;
  band: RcaBand | null;
  bandReason: string | null;
  timeline: IssueTimelineView;
  eventsFailed: boolean;
  nowMs: number;
}>();

const emit = defineEmits<{ "see-evidence": []; "open-activity": [] }>();

const { t, locale } = useI18nTyped();
const router = useRouter();
const store = useStore();
const zone = useLiveZone();

const NOTICE_INK: Record<NoticeTone, string> = {
  neutral: "text-text-body",
  warning: "text-status-warning-text",
  error: "text-status-error-text",
};

// Three chips fit the header row, and twelve the blast radius; the rest fold into a count.
const HEADER_CHIPS = 3;
const BLAST_CHIPS = 12;

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const more = (n: number) =>
  t("autoobserve.issueLive.andMore", { count: new Intl.NumberFormat(locale.value).format(n) }, n);

const chips = computed(() => {
  const names = props.streams.map((s) => s.name);
  const rest = names.slice(HEADER_CHIPS);
  return {
    shown: names.slice(0, HEADER_CHIPS),
    more: rest.length ? raw(`+${rest.length}`) : null,
    rest: rest.join(", "),
  };
});

const blast = computed(() => ({
  shown: props.streams.slice(0, BLAST_CHIPS),
  more: props.streams.length > BLAST_CHIPS ? more(props.streams.length - BLAST_CHIPS) : null,
}));

const stillOut = computed(() => t("autoobserve.issueLive.stillOut"));
const backText = computed(() => t("autoobserve.issueLive.back"));

const notice = computed<{
  title: I18nText;
  text: I18nText;
  tone: NoticeTone;
  icon: IconName;
  routing: boolean;
}>(() => {
  const page = pagedFindingCopy(t, zone.value, props.item, props.nowMs).page;
  if (!page)
    return {
      title: t("autoobserve.issueLive.notice.none"),
      text: t("autoobserve.issueLive.notice.noneText"),
      tone: "neutral",
      icon: "notifications-paused",
      routing: false,
    };
  const tone: NoticeTone = page.tone === "pending" ? "neutral" : page.tone;
  const title =
    props.item.page?.outcome === "unrouted"
      ? t("autoobserve.issueLive.page.unrouted")
      : props.item.page?.outcome === "failed"
        ? t("autoobserve.issueLive.page.failed")
        : t("autoobserve.drawer.notification");
  return { title, text: page.text, tone, icon: "send", routing: page.routing };
});
</script>
