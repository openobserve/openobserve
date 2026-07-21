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
  <ODropdown side="bottom" align="start">
    <template #trigger>
      <!-- Menu-item style: full-width, left-aligned, badge icon -->
      <OButton
        v-if="menuItem"
        data-cy="syntax-guide-button"
        variant="ghost"
        size="sm"
        class="w-full! justify-start! px-3! py-1.5! h-auto! rounded-default! gap-2! font-normal!"
      >
        <template #icon-left>
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-default bg-section-header-bg text-text-secondary shrink-0">
            <OIcon name="help" size="sm" />
          </span>
        </template>
        {{ t('search.syntaxGuideLabel') }}
      </OButton>
      <!-- Default: compact toolbar button -->
      <OButton
        v-else
        data-cy="syntax-guide-button"
        v-bind="$attrs"
        variant="outline"
        size="icon-xs"
        :class="[sqlmode ? 'sql-mode' : 'normal-mode']"
      >
        <OIcon name="help" size="sm" />
        <OTooltip :content="t('search.syntaxGuideLabel')" />
      </OButton>
    </template>
    <div
      data-test="syntax-guide-menu"
      class="syntax-guide-menu"
    >
      <div v-if="!sqlmode">
        <div class="w-105">
          <div class="label text-sm font-bold">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="mb-1.25">
            <div class="text-xs ml-1.25">
              <ul class="px-2.5 mt-2.5 mb-0 text-sm leading-[1.4375rem]">
                <li>
                  For full text search of value 'error' use
                  <span class="bg-highlight-bg px-1.25"
                    >match_all('error') in query editor</span
                  >
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight-bg px-1.25"
                    >str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  For case-insensitive column search of value 'error' use
                  <span class="bg-highlight-bg px-1.25"
                    >str_match_ignore_case(<b>fieldname</b>, 'Error')</span
                  >
                </li>
                <li>
                  To search value 200 for code column use
                  <span class="bg-highlight-bg px-1.25">code=200</span>
                </li>
                <li>
                  To search value 'stderr' for stream column use
                  <span class="bg-highlight-bg px-1.25">stream='stderr'</span>
                </li>
                <li>
                  For additional examples,
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:underline text-primary"
                    >click here</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="w-105">
          <div class="label text-sm font-bold">Syntax Guide: SQL Mode</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="mb-1.25">
            <div class="text-xs ml-1.25">
              <ul class="px-2.5 mt-2.5 mb-0 text-sm leading-[1.4375rem]">
                <li>
                  For full text search of value 'error' use
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE
                    str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  To search value 200 for code column use
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  To search value 'stderr' for stream column use
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  To search and use query function <i>extract_ip</i> on column
                  log use
                  <span class="bg-highlight-bg px-1.25"
                    >SELECT extract_ip(log) FROM <b>stream</b> WHERE
                    code=200</span
                  >
                </li>
                <li>
                  For additional examples,
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:underline text-primary"
                    >click here</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ODropdown>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

export default defineComponent({
  name: "ComponentSearchSyntaxGuide",
  components: { OButton, OTooltip, OIcon, ODropdown },
  props: {
    sqlmode: { type: Boolean, default: false },
    menuItem: { type: Boolean, default: false },
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    return {
      t,
      store,
    };
  },
});
</script>

