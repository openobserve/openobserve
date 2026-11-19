<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { raw } from "@/types/i18n";

import ONoticeBar from "@/lib/feedback/NoticeBar/ONoticeBar.vue";
import type { Notice, NoticeTone as BarTone } from "@/lib/feedback/NoticeBar/ONoticeBar.types";

export type NoticeTone = BarTone;

export interface SecurityNotice {
  key: string;
  tone: NoticeTone;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  dataTest?: string;
}

const props = defineProps<{ notices: SecurityNotice[]; dataTest?: string }>();

// Security pages build their notice text before render, so it arrives already translated.
const notices = computed<Notice[]>(() =>
  props.notices.map(({ text, actionLabel, ...rest }) => ({
    ...rest,
    text: raw(text),
    ...(actionLabel ? { actionLabel: raw(actionLabel) } : {}),
  })),
);
</script>

<template>
  <ONoticeBar :notices="notices" :data-test="dataTest" toggle-data-test="security-notices-toggle" />
</template>
