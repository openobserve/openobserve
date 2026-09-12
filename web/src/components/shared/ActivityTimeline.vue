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
  Domain-agnostic activity feed: a vertical timeline of inline events plus
  comment cards, with a comment composer pinned underneath. It renders purely
  from props — every piece of per-domain meaning (icon, badge, colour, body
  text) is supplied by the caller as a function, so this component never
  needs to know what an "incident" or an "on-call page" is. Incidents
  (IncidentTimeline.vue) and on-call (OnCallActivityTimeline.vue) both wrap
  this to get the same look, feel, and comment-composer behaviour.
-->
<template>
  <div class="flex h-full min-h-60 flex-col">
    <div v-if="loading" class="flex items-center justify-center py-8">
      <OSpinner variant="dots" size="md" />
    </div>

    <div
      v-else-if="events.length === 0"
      class="text-text-muted flex flex-col items-center justify-center py-8"
    >
      <OIcon name="forum" class="mb-2 size-10! opacity-40" />
      <div class="mb-1 text-base font-medium">{{ emptyTitle }}</div>
      <div class="text-text-muted text-sm">{{ emptySubtitle }}</div>
    </div>

    <div v-else class="relative flex min-h-0 flex-1 flex-col">
      <div v-if="showScrollButtons" class="absolute top-1 right-1 z-10 flex flex-col gap-1">
        <OButton
          variant="ghost-muted"
          size="icon-circle-sm"
          @click="scrollToTop"
          :data-test="dataTestScrollTop"
          ><OIcon name="keyboard-arrow-up" size="sm" /><OTooltip :content="scrollTopTooltip"
        /></OButton>
        <OButton
          variant="ghost-muted"
          size="icon-circle-sm"
          @click="scrollToBottom"
          :data-test="dataTestScrollBottom"
          ><OIcon name="keyboard-arrow-down" size="sm" /><OTooltip :content="scrollBottomTooltip"
        /></OButton>
      </div>

      <div ref="timelineContainer" class="min-h-0 flex-1 overflow-y-auto px-1 pt-1 pb-2">
        <div class="relative">
          <div class="bg-border-default absolute top-0 bottom-0 left-3 my-2 w-0.5"></div>

          <div class="relative space-y-3">
            <div v-for="(event, index) in events" :key="index" class="relative">
              <!-- INLINE EVENTS -->
              <template v-if="!isCommentEvent(event)">
                <div class="flex items-center gap-3">
                  <div class="flex-shrink-0">
                    <div
                      v-if="getUserId(event) !== systemLabel"
                      class="bg-surface-base border-border-default relative z-10 flex h-6 w-6 items-center justify-center rounded-full border"
                    >
                      <OIcon
                        name="person"
                        size="xs"
                        :style="{ color: getAvatarColor(getUserId(event)) }"
                      />
                    </div>
                    <div
                      v-else
                      class="bg-surface-subtle border-border-default relative z-10 flex h-6 w-6 items-center justify-center rounded-full border"
                    >
                      <OIcon
                        :name="getEventIcon(event)"
                        size="sm"
                        :style="{ color: getEventBadgeColor(event) }"
                      />
                    </div>
                  </div>

                  <div class="flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        v-if="getUserId(event) !== systemLabel"
                        class="text-sm font-semibold"
                        :class="'text-text-body'"
                      >
                        {{ getUserId(event) }}
                      </span>

                      <span
                        v-if="getEventLayout(event) === 'before'"
                        class="rounded-default inline-flex items-center px-2 py-0.5 text-xs font-semibold"
                        :style="badgeStyle(getEventBadgeColor(event))"
                      >
                        {{ isAiLabelledOf(event) ? aiSreBadgeText : getEventBadgeText(event) }}
                        <OTooltip
                          v-if="getTooltip && getTooltip(event)"
                          :delay="300"
                          side="bottom"
                          align="start"
                          :max-width="'24rem'"
                          :content="getTooltip(event) ?? undefined"
                        />
                      </span>

                      <span
                        class="text-sm"
                        :class="'text-text-body'"
                        v-html="getInlineHtml(event)"
                      ></span>

                      <span
                        v-if="getEventLayout(event) === 'after'"
                        class="rounded-default inline-flex items-center px-2 py-0.5 text-xs font-semibold"
                        :style="badgeStyle(getEventBadgeColor(event))"
                      >
                        {{ getEventBadgeText(event) }}
                      </span>

                      <span class="text-xs" :class="'text-text-secondary'">
                        {{ formatRelativeTime(getTimestamp(event)) }}
                      </span>
                    </div>
                  </div>
                </div>
              </template>

              <!-- COMMENT EVENTS -->
              <template v-else>
                <div class="flex gap-3">
                  <div class="flex-shrink-0">
                    <div
                      class="bg-surface-base border-border-default relative z-10 flex h-6 w-6 items-center justify-center rounded-full border"
                    >
                      <OIcon
                        name="person"
                        size="xs"
                        :style="{ color: getAvatarColor(getUserId(event)) }"
                      />
                    </div>
                  </div>

                  <div class="min-w-0 flex-1">
                    <div
                      class="rounded-default bg-surface-base border-border-default overflow-hidden border transition-shadow hover:shadow-md"
                    >
                      <div
                        class="bg-surface-subtle border-b-border-default flex items-center gap-2 border-b px-3 py-1.5"
                      >
                        <span class="text-sm font-semibold" :class="'text-text-body'">
                          {{ getUserId(event) }}
                        </span>
                        <span class="text-xs" :class="'text-text-secondary'">
                          {{ commentedPrefix }} {{ formatRelativeTime(getTimestamp(event)) }}
                        </span>
                      </div>

                      <div class="px-3 py-2">
                        <div
                          class="text-sm leading-relaxed break-words whitespace-pre-wrap"
                          :class="'text-text-body'"
                        >
                          {{ getCommentBody(event) }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Comment Input -->
    <div class="pt-2">
      <div class="flex gap-3">
        <div class="flex-shrink-0 pt-1">
          <div
            class="bg-surface-base border-border-default flex h-6 w-6 items-center justify-center rounded-full border"
          >
            <OIcon name="person" size="xs" :style="{ color: getAvatarColor(currentUserId) }" />
          </div>
        </div>

        <div class="relative flex-1">
          <OTextarea
            :model-value="commentText"
            @update:model-value="$emit('update:commentText', $event)"
            :placeholder="commentPlaceholder"
            :rows="3"
            @keydown="onTextareaKeydown"
            :data-test="dataTestCommentInput"
          />

          <div class="absolute right-3 bottom-3">
            <OButton
              variant="primary"
              size="icon-circle-sm"
              :disabled="!commentText.trim() || submitting"
              :loading="submitting"
              @click="onSubmit"
              :data-test="dataTestCommentSend"
              ><OIcon name="send" size="sm" /><OTooltip :content="sendTooltip"
            /></OButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useTheme } from "@/composables/useTheme";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { raw, type I18nText } from "@/types/i18n";

type EventLayout = "no-badge" | "before" | "after";

interface Props {
  events: any[];
  loading?: boolean;
  submitting?: boolean;
  commentText: string;
  systemLabel?: string;
  /** Off in a compact host (e.g. a table row expansion) where the feed is
   *  short enough that jump-to-top/bottom controls are just clutter. */
  showScrollButtons?: boolean;

  isCommentEvent: (event: any) => boolean;
  getUserId: (event: any) => string;
  getAvatarColor: (userId: string) => string;
  getTimestamp: (event: any) => number;
  formatRelativeTime: (timestamp: number) => string;

  getEventIcon: (event: any) => string;
  getEventBadgeColor: (event: any) => string;
  getEventBadgeText: (event: any) => string;
  getEventLayout: (event: any) => EventLayout;
  /** True only for the fixed-label "AI SRE"-style badge (uses aiSreBadgeText
   * instead of getEventBadgeText). Optional — most domains don't need it. */
  isAiLabelled?: (event: any) => boolean;
  aiSreBadgeText?: I18nText;
  getTooltip?: (event: any) => I18nText | undefined | null;
  /** Pre-sanitized HTML for the inline (non-comment) event text. */
  getInlineHtml: (event: any) => string;

  getCommentBody: (event: any) => string;

  currentUserId: string;
  emptyTitle: I18nText;
  emptySubtitle: I18nText;
  commentPlaceholder: I18nText;
  commentedPrefix: I18nText;
  sendTooltip: I18nText;
  scrollTopTooltip: I18nText;
  scrollBottomTooltip: I18nText;
  dataTestScrollTop: string;
  dataTestScrollBottom: string;
  dataTestCommentInput: string;
  dataTestCommentSend: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  submitting: false,
  systemLabel: "System",
  showScrollButtons: true,
  isAiLabelled: undefined,
  aiSreBadgeText: () => raw(""),
  getTooltip: undefined,
});

const emit = defineEmits<{
  "update:commentText": [value: string];
  submit: [];
}>();

const { isDark } = useTheme();

const timelineContainer = ref<HTMLElement | null>(null);

const scrollToTop = () => {
  if (timelineContainer.value) timelineContainer.value.scrollTop = 0;
};

const scrollToBottom = () => {
  if (timelineContainer.value)
    timelineContainer.value.scrollTop = timelineContainer.value.scrollHeight;
};

const onSubmit = () => {
  if (!props.commentText.trim() || props.submitting) return;
  emit("submit");
};

const onTextareaKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    onSubmit();
  }
};

const isAiLabelledOf = (event: any) => (props.isAiLabelled ? props.isAiLabelled(event) : false);

const badgeStyle = (c: string) => ({
  backgroundColor: `color-mix(in srgb, ${c} ${isDark.value ? "19%" : "8%"}, transparent)`,
  // eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom
  border: `1px solid color-mix(in srgb, ${c} ${isDark.value ? "31%" : "19%"}, transparent)`,
  color: isDark.value ? "var(--color-grey-0)" : c,
});

defineExpose({ scrollToTop, scrollToBottom });
</script>
