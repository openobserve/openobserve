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
  Who hit this error and on what — the identity, device and build behind the
  single occurrence the page was opened on. Distinct from the breakdown panel,
  which describes the whole issue.
-->
<template>
  <section
    class="rounded-default border-border-default bg-card-glass-bg border p-3"
    data-test="rum-error-context-card"
  >
    <h4>{{ t("rum.errorDetail.contextTitle") }}</h4>

    <!-- Identity -->
    <div class="mt-2 flex items-center gap-2">
      <span
        class="bg-icon-chip-primary-bg text-icon-chip-primary-text grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase"
        aria-hidden="true"
        >{{ initials }}</span
      >
      <div class="min-w-0">
        <div
          class="text-text-heading truncate font-semibold"
          :title="userName"
          data-test="rum-error-context-user-name"
        >
          {{ userName }}
        </div>
        <small class="block truncate" :title="userEmail" data-test="rum-error-context-user-email">{{
          userEmail
        }}</small>
      </div>
    </div>

    <!-- Environment: browser / OS at a glance -->
    <div class="mt-3 flex items-center gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <img :src="browserIcon" :alt="t('rum.browserImageAlt')" class="h-auto w-6 shrink-0" />
        <div class="min-w-0">
          <div class="truncate" data-test="rum-error-context-browser">{{ browserName }}</div>
          <small class="block">{{ browserVersion }}</small>
        </div>
      </div>
      <OSeparator vertical />
      <div class="flex min-w-0 items-center gap-2">
        <img :src="osIcon" :alt="t('rum.osImageAlt')" class="h-auto w-6 shrink-0" />
        <div class="min-w-0">
          <div class="truncate" data-test="rum-error-context-os">{{ osName }}</div>
          <small class="block">{{ osVersion }}</small>
        </div>
      </div>
    </div>

    <!-- Everything else, in a scannable key/value list -->
    <dl class="border-border-default m-0 mt-3 border-t pt-2">
      <KeyValueRow
        v-for="row in rows"
        :key="row.key"
        :label="row.label"
        :value="row.value"
        :show-border="false"
        :data-test="`rum-error-context-${row.key}`"
      />
    </dl>

    <div class="mt-2 flex flex-wrap">
      <ErrorTag v-for="(value, tag) in chips" :key="tag" :tag="{ key: tag, value }" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import KeyValueRow from "@/components/rum/common/KeyValueRow.vue";
import ErrorTag from "@/components/rum/errorTracking/view/ErrorTag.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import chrome from "@/assets/images/rum/chrome.png";
import firefox from "@/assets/images/rum/firefox.png";
import safari from "@/assets/images/rum/safari.png";
import opera from "@/assets/images/rum/opera.png";
import edge from "@/assets/images/rum/edge.png";
import windows from "@/assets/images/rum/windows.png";
import mac from "@/assets/images/rum/mac.png";
import linux from "@/assets/images/rum/linux.png";

const props = defineProps<{
  error: Record<string, any>;
}>();

const { t } = useI18nTyped();

const BROWSER_ICONS: Array<[string, string]> = [
  ["chrome", chrome],
  ["opera", opera],
  ["firefox", firefox],
  ["edge", edge],
  ["safari", safari],
];

const OS_ICONS: Array<[string, string]> = [
  ["windows", windows],
  ["mac", mac],
  ["linux", linux],
];

const pickIcon = (value: string | undefined, table: Array<[string, string]>, fallback: string) => {
  const needle = value?.toLowerCase() ?? "";
  return table.find(([name]) => needle.includes(name))?.[1] ?? fallback;
};

const browserName = computed(() => props.error.user_agent_user_agent_family || t("rum.unknown"));
const osName = computed(() => props.error.user_agent_os_family || t("rum.unknown"));

const browserIcon = computed(() =>
  pickIcon(props.error.user_agent_user_agent_family, BROWSER_ICONS, chrome),
);
const osIcon = computed(() => pickIcon(props.error.user_agent_os_family, OS_ICONS, windows));

const joinVersion = (parts: Array<string | number | undefined>) => {
  const usable = parts.filter((part) => part != null && part !== "");
  return usable.length ? t("rum.versionPrefix") + usable.join(".") : t("rum.versionUnknown");
};

const browserVersion = computed(() =>
  joinVersion([
    props.error.user_agent_user_agent_major,
    props.error.user_agent_user_agent_minor,
    props.error.user_agent_user_agent_patch,
  ]),
);

const osVersion = computed(() =>
  joinVersion([
    props.error.user_agent_os_major,
    props.error.user_agent_os_minor,
    props.error.user_agent_os_patch,
  ]),
);

const userName = computed(() => props.error.usr_name || t("rum.unknownUser"));
const userEmail = computed(() => props.error.usr_email || t("rum.unknown"));

const initials = computed(() => {
  const source = String(props.error.usr_name || props.error.usr_email || "");
  const letters = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return letters || raw("?");
});

const location = computed(() => {
  const parts = [props.error.geo_info_city, props.error.geo_info_country].filter(Boolean);
  return parts.length ? parts.join(", ") : t("rum.unknown");
});

const device = computed(() => {
  const parts = [props.error.user_agent_device_brand, props.error.user_agent_device_family].filter(
    Boolean,
  );
  return parts.length ? parts.join(" ") : t("rum.unknown");
});

interface ContextRow {
  key: string;
  label: I18nText;
  value: string;
}

const rows = computed<ContextRow[]>(() => {
  const entries: ContextRow[] = [
    { key: "device", label: t("rum.errorDetail.device"), value: device.value },
    { key: "location", label: t("rum.errorDetail.location"), value: location.value },
  ];
  if (props.error.ip) {
    entries.push({ key: "ip", label: t("rum.ipLabel"), value: String(props.error.ip) });
  }
  if (props.error.view_url) {
    entries.push({
      key: "url",
      label: t("rum.errorDetail.pageUrl"),
      value: String(props.error.view_url),
    });
  }
  return entries;
});

/** Deployment identity — the fields you quote when filing the bug. */
const chips = computed(() => {
  const out: Record<string, string> = {};
  if (props.error.service) out.service = String(props.error.service);
  if (props.error.version) out.version = String(props.error.version);
  if (props.error.env) out.env = String(props.error.env);
  if (props.error.sdk_version) out.sdk_version = String(props.error.sdk_version);
  if (props.error.source) out.source = String(props.error.source);
  return out;
});
</script>
