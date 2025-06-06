<!-- Copyright 2023 OpenObserve Inc.

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
  <q-btn
    data-cy="syntax-guide-button"
    size="sm"
    dense
    flat
    class="q-ml-xs q-pa-xs"
    :class="[sqlmode ? 'sql-mode' : 'normal-mode',
      !store.state.isAiChatEnabled ? 'syntax-guide-button' : ''
    ]"
    icon="help"
  >
    <q-menu :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'">
      <q-card flat v-if="!sqlmode">
        <q-card-section class="syntax-guide-title">
          <div class="label">{{ t("search.syntaxGuideLabel") }}</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pt-none answers">
          <div class="syntax-section">
            <div class="syntax-guide-text">
              <ul class="guide-list">
                <li>
                  For inverted index search of value 'error' use
                  <span class="bg-highlight">match_all('error')</span>
                  in query editor. Search terms are case-insensitive.
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight"
                    >str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  For fuzzy string matching based on Levenshtein distance,
                  search of value 'error' use
                  <span class="bg-highlight"
                    >fuzzy_match(<b>fieldname</b>, 'error', 1)</span
                  >
                  OR
                  <span class="bg-highlight">fuzzy_match_all('error', 1)</span>
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
                    class="hover:tw-underline text-primary"
                    >click here</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </q-card-section>
      </q-card>
      <q-card flat v-else>
        <q-card-section class="syntax-guide-title">
          <div class="label">Syntax Guide: SQL Mode</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pt-none answers">
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
                  For column search of value 'error' use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    str_match(<b>fieldname</b>, 'error')</span
                  >
                </li>
                <li>
                  For column search of value 'error' use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE
                    fuzzy_match(<b>fieldname</b>, 'error', 1)</span
                  >
                </li>
                <li>
                  For all column search of value 'error' use
                  <span class="bg-highlight"
                    >SELECT * FROM <b>stream</b> WHERE fuzzy_match_all('error',
                    1)</span
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
                    class="hover:tw-underline text-primary"
                    >click here</a
                  >.
                </li>
              </ul>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </q-menu>
    <q-tooltip>
      {{ t('search.syntaxGuideLabel') }}
    </q-tooltip>
  </q-btn>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

export default defineComponent({
  name: "ComponentSearchSyntaxGuide",
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

<style lang="scss" scoped>
.guide-list {
  padding: 0 10px;
  margin: 10px 0 0 0;
}

.guide-list li {
  font-size: 14px;
  line-height: 23px;
}

.q-btn:before {
  border: 0px solid #d5d5d5;
}

.syntax-guide-button {
  cursor: pointer;
  text-transform: capitalize;
  width: 32px;
  height: 32px;
  font-weight: bold;
  border: 1px solid rgba(89, 96, 178, 0.3);
}

.sql-mode {
  background-color: rgba(89, 96, 178, 0.8);
  color: #ffffff;
}

.syntax-guide-title {
  width: 420px;

  .label {
    font-size: 15px;
    font-weight: bold;
  }
}

.syntax-guide-sub-title {
  color: $primary;
  font-size: 15px;
  margin-left: 5px;
}

.syntax-guide-text {
  font-size: 12px;
  margin-left: 5px;
}

.syntax-section {
  margin-bottom: 5px;
}

.bg-highlight {
  padding-left: 5px;
  padding-right: 5px;
}

.theme-dark .bg-highlight {
  background-color: #747474;
}

.theme-light .bg-highlight {
  background-color: #e7e6e6;
}
</style>
