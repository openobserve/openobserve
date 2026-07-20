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
    <div :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'">
      <div v-if="!sqlmode">
        <div class="syntax-guide-title w-[26.25rem]">
          <div class="label text-[0.9375rem] font-bold">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="mb-[0.3125rem]">
            <div class="text-xs ml-[0.3125rem]">
              <ul class="px-[0.625rem] mt-[0.625rem] mb-0 text-[0.875rem] leading-[1.4375rem]">
                <!-- The prose is translated; the PromQL samples beside it are
                     NOT — they are syntax, and a translated `rate(...)` would be
                     a query that does not run. -->
                <li>
                  {{ t("metrics.syntaxGuide.instantVector") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >metric_name{label1="value1", label2="value2"}</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.rangeVector") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >metric_name[5m]</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.aggregate") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >sum by (label)(metric_name)</span
                  >
                  {{ t("metrics.syntaxGuide.or") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >avg by (label)(metric_name)</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.rate") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >rate(metric_name[5m])</span
                  >
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="syntax-guide-title w-[26.25rem]">
          <div class="label text-[0.9375rem] font-bold">
            {{ t("metrics.syntaxGuide.sqlTitle") }}
          </div>
        </div>
        <div class="border-t my-1 border-dropdown-separator" />
        <div class="answers">
          <div class="mb-[0.3125rem]">
            <div class="text-xs ml-[0.3125rem]">
              <ul class="px-[0.625rem] mt-[0.625rem] mb-0 text-[0.875rem] leading-[1.4375rem]">
                <!-- As above: prose translated, SQL samples left literal. -->
                <li>
                  {{ t("metrics.syntaxGuide.sqlFullText") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlColumn") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >SELECT * FROM <b>stream</b> WHERE
                    str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlCode") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlStream") }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  <!-- The function name is a parameter, so the sentence can be
                       reordered by a translator without stranding the `<i>`. -->
                  {{
                    t("metrics.syntaxGuide.sqlFunction", { fn: "extract_ip" })
                  }}
                  <span class="bg-surface-subtle px-[0.3125rem] rounded-sm"
                    >SELECT extract_ip(log) FROM <b>stream</b> WHERE
                    code=200</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlMoreExamples") }}
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:underline text-primary"
                    >{{ t("metrics.syntaxGuide.sqlClickHere") }}</a
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
