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
      <OButton
        data-cy="syntax-guide-button"
        data-test="metrics-syntax-guide-button"
        variant="outline"
        size="sm-toolbar"
        :class="sqlmode ? 'sql-mode' : 'normal-mode'"
      >
        <OIcon name="help" size="sm" />
        {{ t('search.syntaxGuideLabel') }}
      </OButton>
    </template>
    <div>
      <div v-if="!sqlmode">
        <div class="syntax-guide-title w-105">
          <div class="label text-sm font-bold">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="mb-[5px]">
            <div class="text-xs ml-[5px]">
              <ul class="px-2.5 mt-2.5 mb-0 text-sm leading-[23px]">
                <li>
                  For instant vector selectors, use
                  <span class="bg-highlight px-[5px]"
                    >metric_name{label1="value1", label2="value2"}</span
                  >
                </li>
                <li>
                  For range vector selectors, use
                  <span class="bg-highlight px-[5px]">metric_name[5m]</span>
                </li>
                <li>
                  To aggregate data, use
                  <span class="bg-highlight px-[5px]">sum by (label)(metric_name)</span>
                  or
                  <span class="bg-highlight px-[5px]"> avg by (label)(metric_name)</span>
                </li>
                <li>
                  For rate calculations over a range vector, use
                  <span class="bg-highlight px-[5px]">rate(metric_name[5m])</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="syntax-guide-title w-105">
          <div class="label text-sm font-bold">Syntax Guide: SQL Mode</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="mb-[5px]">
            <div class="text-xs ml-[5px]">
              <ul class="px-2.5 mt-2.5 mb-0 text-sm leading-[23px]">
                <li>
                  For full text search of value 'error' use
                  <span class="bg-highlight px-[5px]"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight px-[5px]"
                    >SELECT * FROM <b>stream</b> WHERE
                    str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  To search value 200 for code column use
                  <span class="bg-highlight px-[5px]"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  To search value 'stderr' for stream column use
                  <span class="bg-highlight px-[5px]"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  To search and use query function <i>extract_ip</i> on column
                  log use
                  <span class="bg-highlight px-[5px]"
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
import OButton from '@/lib/core/Button/OButton.vue';
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
export default defineComponent({
  name: "SyntaxGuideMetrics",
  components: { OButton, OIcon, ODropdown },
  props: {
    sqlmode: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    return {
      t,
      store,
    };
  },
});
</script>

<style>
.q-btn:before {
  border: 0px solid var(--color-input-border);
}
</style>
