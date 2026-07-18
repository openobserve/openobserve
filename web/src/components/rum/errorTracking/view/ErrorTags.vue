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
  <div>
    <div data-test="error-tags-title" class="text-base font-bold ml-1">{{ t("rum.tags") }}</div>
    <div class="flex items-center">
      <div class="mr-4 items-center">
        <img
          :src="ip"
          :alt="t('rum.ipLabel')"
          class="mr-2 inline-block w-[1.875rem]! h-auto!"
        />
        <div class="inline-block">
          <div class="pl-1">{{ t("rum.ipLabel") }}</div>
          <span class="pl-1"> {{ error.ip }} </span>
        </div>
      </div>
      <OSeparator vertical />
      <div class="mx-4 items-center">
        <img
          :src="browserIcon"
          :alt="t('rum.browserImageAlt')"
          class="mr-3 inline-block h-auto w-[1.875rem]"
        />
        <div class="inline-block">
          <div class="pl-1">{{ error.user_agent_user_agent_family }}</div>
          <span class="pl-1"> {{ getBrowserVersion }} </span>
        </div>
      </div>
      <OSeparator vertical />
      <div class="mx-4 items-center">
        <img
          :src="osIcon"
          :alt="t('rum.osImageAlt')"
          class="mr-3 inline-block h-auto w-[1.875rem]"
        />
        <div class="inline-block">
          <div class="pl-1">{{ error.user_agent_os_family }}</div>
          <div class="pl-1 flex">{{ getOsVersion }}</div>
        </div>
      </div>
    </div>
    <div class="flex items-center flex-wrap mt-3">
      <template v-for="(value, tag) in getTags" :key="tag">
        <ErrorTag :tag="{ key: tag, value }" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import ErrorTag from "@/components/rum/errorTracking/view/ErrorTag.vue";
import chrome from "@/assets/images/rum/chrome.png";
import firefox from "@/assets/images/rum/firefox.png";
import safari from "@/assets/images/rum/safari.png";
import opera from "@/assets/images/rum/opera.png";
import edge from "@/assets/images/rum/edge.png";
import ip from "@/assets/images/rum/ip_ad.png";
import windows from "@/assets/images/rum/windows.png";
import mac from "@/assets/images/rum/mac.png";
import linux from "@/assets/images/rum/linux.png";
import { useI18n } from "vue-i18n";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const { t } = useI18n();

const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const osIcon = ref("");
const browserIcon = ref("");

onMounted(() => {
  osIcon.value = getOsIcon();
  browserIcon.value = getBrowserIcon();
});

const getBrowserIcon = () => {
  if (!props.error.user_agent_user_agent_family) return chrome;

  if (
    props.error.user_agent_user_agent_family?.toLowerCase().includes("chrome")
  ) {
    return chrome;
  } else if (
    props.error.user_agent_user_agent_family?.toLowerCase().includes("opera")
  ) {
    return opera;
  } else if (
    props.error.user_agent_user_agent_family?.toLowerCase().includes("firefox")
  ) {
    return firefox;
  } else if (
    props.error.user_agent_user_agent_family?.toLowerCase().includes("edge")
  ) {
    return edge;
  } else if (
    props.error.user_agent_user_agent_family?.toLowerCase().includes("safari")
  ) {
    return safari;
  }
  return chrome;
};

const getOsIcon = () => {
  if (props.error?.user_agent_os_family?.toLowerCase().includes("windows")) {
    return windows;
  } else if (props.error?.user_agent_os_family?.toLowerCase().includes("mac")) {
    return mac;
  } else if (
    props.error?.user_agent_os_family?.toLowerCase().includes("linux")
  ) {
    return linux;
  } else {
    return windows;
  }
};

const getOsVersion = computed(() => {
  let version = t("rum.versionPrefix");

  if (!props.error.user_agent_os_major) return version + t("rum.unknown");

  if (props.error.user_agent_os_major)
    version += props.error.user_agent_os_major;

  if (props.error.user_agent_os_minor)
    version += "." + props.error.user_agent_os_minor;

  if (props.error.user_agent_os_patch)
    version += "." + props.error.user_agent_os_patch;

  return version;
});

const getBrowserVersion = computed(() => {
  let version = t("rum.versionPrefix");

  if (!props.error.user_agent_user_agent_major) return version + t("rum.unknown");

  if (props.error.user_agent_user_agent_major)
    version += props.error.user_agent_user_agent_major;

  if (props.error.user_agent_user_agent_minor)
    version += "." + props.error.user_agent_user_agent_minor;

  if (props.error.user_agent_user_agent_patch)
    version += "." + props.error.user_agent_user_agent_patch;

  return version;
});

const getTags = computed(() => {
  return {
    ip: props.error.ip,
    url: props.error.view_url,
    handled: props.error.error_handling === "handled",
    location: getLocation(),
    service: props.error.service || t("rum.unknown"),
    source: props.error.source || t("rum.unknown"),
    device: getDevice(),
    browser: props.error.user_agent_user_agent_family,
    level: "error",
    sdk_version: props.error.sdk_version,
    user_email: props.error.usr_email || t("rum.unknownUser"),
  };
});

const getDevice = () => {
  if (
    !props.error.user_agent_device_brand &&
    !props.error.user_agent_device_family
  )
    return t("rum.unknown");

  if (!props.error.user_agent_device_brand)
    return props.error.user_agent_device_family;

  if (!props.error.user_agent_device_family)
    return props.error.user_agent_device_brand;

  return (
    props.error.user_agent_device_brand +
    " " +
    props.error.user_agent_device_family
  );
};

const getLocation = () => {
  if (!props.error.geo_info_country && !props.error.geo_info_city)
    return t("rum.unknown");
  if (!props.error.geo_info_country) return props.error.geo_info_city;
  if (!props.error.geo_info_city) return props.error.geo_info_country;

  return props.error.geo_info_country + ", " + props.error.geo_info_city;
};
</script>
