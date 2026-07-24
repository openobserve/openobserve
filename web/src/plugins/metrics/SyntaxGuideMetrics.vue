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
        {{ t("search.syntaxGuideLabel") }}
      </OButton>
    </template>
    <div>
      <div v-if="!sqlmode">
        <div class="w-105">
          <div class="label text-sm font-bold">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="border-dropdown-separator my-1 border-t" />
        <div class="answers">
          <div class="mb-1.25">
            <div class="ml-1.25 text-xs">
              <ul class="mt-2.5 mb-0 px-2.5 text-sm leading-[1.4375rem]">
                <!-- The prose is translated; the PromQL samples beside it are
                     NOT — they are syntax, and a translated `rate(...)` would be
                     a query that does not run. -->
                <li>
                  {{ t("metrics.syntaxGuide.instantVector") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >metric_name{label1="value1", label2="value2"}</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.rangeVector") }}
                  <span class="bg-highlight-bg rounded-default px-1.25">metric_name[5m]</span>
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.aggregate") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >sum by (label)(metric_name)</span
                  >
                  {{ t("metrics.syntaxGuide.or") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >avg by (label)(metric_name)</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.rate") }}
                  <span class="bg-highlight-bg rounded-default px-1.25">rate(metric_name[5m])</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="w-105">
          <div class="label text-sm font-bold">
            {{ t("metrics.syntaxGuide.sqlTitle") }}
          </div>
        </div>
        <div class="border-dropdown-separator my-1 border-t" />
        <div class="answers">
          <div class="mb-1.25">
            <div class="ml-1.25 text-xs">
              <ul class="mt-2.5 mb-0 px-2.5 text-sm leading-[1.4375rem]">
                <!-- As above: prose translated, SQL samples left literal. -->
                <li>
                  {{ t("metrics.syntaxGuide.sqlFullText") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlColumn") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlCode") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlStream") }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  <!-- The function name is a parameter, so the sentence can be
                       reordered by a translator without stranding the `<i>`. -->
                  {{ t("metrics.syntaxGuide.sqlFunction", { fn: "extract_ip" }) }}
                  <span class="bg-highlight-bg rounded-default px-1.25"
                    >SELECT extract_ip(log) FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  {{ t("metrics.syntaxGuide.sqlMoreExamples") }}
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="text-primary hover:underline"
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
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
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
