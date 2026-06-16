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
      <div>
        <!-- Menu-item style: full-width, left-aligned, badge icon — used when placed inside a dropdown -->
        <OButton
          v-if="menuItem"
          data-cy="syntax-guide-button"
          variant="ghost"
          size="sm"
          class="tw:w-full! tw:justify-start! tw:px-3! tw:py-1.5! tw:h-auto! tw:rounded-md! tw:gap-2! tw:font-normal!"
        >
          <template #icon-left>
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-7 tw:h-7 tw:rounded-md tw:bg-[var(--o2-section-header-bg)] tw:text-[var(--o2-text-secondary)] tw:shrink-0">
              <OIcon name="help" size="sm" />
            </span>
          </template>
          {{ t('search.syntaxGuideLabel') }}
        </OButton>
        <!-- Default style: compact inline button for toolbar use -->
        <OButton
          v-else
          data-cy="syntax-guide-button"
          variant="ghost"
          size="sm"
          :class="[
            noBorder ? 'syntax-guide-no-border' : 'tw:ml-1',
            sqlmode ? 'sql-mode' : 'normal-mode',
          ]"
          class="tw:h-4.5!"
        >
          <OIcon name="help" size="sm" />
          <span v-if="label">{{ label }}</span>
          <span v-else-if="!noBorder" class="tw:ml-1">Syntax Guide</span>
          <OTooltip :content="t('search.syntaxGuideLabel')" />
        </OButton>
      </div>
    </template>
    <div :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'">
      <div v-if="!sqlmode">
        <div class="syntax-guide-title">
          <div class="label">{{ t("search.syntaxGuideLabel") }}</div>
        </div>
        <div class="tw:border-t tw:my-1 tw:border-dropdown-separator" />
        <div class="answers">
          <div class="syntax-section">
            <div class="syntax-guide-text">
              <ul class="guide-list">
                <li>
                  For inverted index search of value 'error' use
                  <span class="bg-highlight">match_all('error')</span>
                  in query editor. Search terms are case-insensitive.
                </li>
                <li>
                  For prefix search use
                  <span class="bg-highlight">match_all('error*')</span>
                  to find all terms starting with 'error'.
                </li>
                <li>
                  For phrase prefix search use
                  <span class="bg-highlight">match_all('error code*')</span>
                  to find phrases starting with 'error code'.
                </li>
                <li>
                  For case sensitive search use
                  <span class="bg-highlight">match_all('traceHits')</span>
                  with exact case matching.
                </li>
                <li>
                  For postfix search use
                  <span class="bg-highlight">match_all('*failed')</span>
                  to find all terms ending with 'failed'.
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight"
                    >str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  For case-insensitive column search of value 'error' use
                  <span class="bg-highlight"
                    >str_match_ignore_case(<b>fieldname</b>, 'Error')</span
                  >
                </li>
                <li>
                  To search value 200 for code column use
                  <span class="bg-highlight">code=200</span>
                </li>
                <li>
                  To search value 'stderr' for stream column use
                  <span class="bg-highlight">stream='stderr'</span>
                </li>
                <li>
                  For additional examples,
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:tw:underline text-primary"
                    >click here</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div v-else>
        <div class="syntax-guide-title">
          <div class="label">Syntax Guide: SQL Mode</div>
        </div>
        <div class="tw:border-t tw:my-1 tw:border-dropdown-separator" />
        <div class="answers">
          <div class="syntax-section">
            <div class="syntax-guide-text">
              <ul class="guide-list">
                <li>
                  For inverted index search of value 'error' use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error')</span
                  >
                  in query editor. Search terms are case-insensitive.
                </li>
                <li>
                  For prefix search use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error*')</span
                  >
                  to find all terms starting with 'error'.
                </li>
                <li>
                  For phrase prefix search use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE match_all('error
                    code*')</span
                  >
                  to find phrases starting with 'error code'.
                </li>
                <li>
                  For case sensitive search use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    match_all('traceHits')</span
                  >
                  with exact case matching.
                </li>
                <li>
                  For postfix search use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    match_all('*failed')</span
                  >
                  to find all terms ending with 'failed'.
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  To search value 200 for code column use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE code=200</span
                  >
                </li>
                <li>
                  To search value 'stderr' for stream column use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE stream='stderr'</span
                  >
                </li>
                <li>
                  To search and use query function <i>extract_ip</i> on column
                  log use
                  <span class="bg-highlight"
                    >SELECT extract_ip(log) FROM <b>stream</b> WHERE
                    code=200</span
                  >
                </li>
                <li>
                  For additional examples,
                  <a
                    href="https://openobserve.ai/docs/example-queries/"
                    target="_blank"
                    class="hover:tw:underline text-primary"
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
  props: {
    sqlmode: {
      type: Boolean,
      default: false,
    },
    noBorder: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String,
      default: "",
    },
    menuItem: {
      type: Boolean,
      default: false,
    },
  },
  components: { OButton, OTooltip, OIcon, ODropdown },
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

<style lang="scss" scoped>
@import "@/styles/logs/syntax-guide.scss";

.syntax-guide-no-border {
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  width: 100%;
  justify-content: flex-start;

  :deep(.q-btn__content) {
    padding: 0 !important;
    gap: 0;
    justify-content: flex-start;
    width: 100%;
}

  &:hover {
    background: transparent !important;
  }

  &:before {
    display: none !important;
  }
}
</style>
