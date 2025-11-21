<!-- Copyright 2025 OpenObserve Inc.

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
  <div
    class="full-width database-deprecation-container q-pa-md gradient-banner"
    v-if="showDeprecationWarning"
  >
    <div class="row items-center">
      <div class="col">
        <span class="deprecation-message">
          ⚠️ MySQL support is DEPRECATED and will be removed in future.
        </span>
        <br />
        <span class="deprecation-subtitle">
          Please migrate to PostgreSQL to ensure continued support.
        </span>
      </div>
      <div class="col-auto q-ml-sm">
        <q-btn
          @click="dismissWarning"
          flat
          round
          dense
          icon="close"
          size="sm"
          class="text-grey-7"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useStore } from "vuex";

const DISMISS_KEY = "mysql_deprecation_dismissed";
const DISMISS_DURATION_DAYS = 7;

export default defineComponent({
  name: "DatabaseDeprecationBanner",
  setup() {
    const store = useStore();
    const showDeprecationWarning = ref(false);

    const checkIfShouldShow = () => {
      // Check if MySQL is being used
      const config = store.state.zoConfig;
      if (!config || !config.mysql_deprecated_warning) {
        return false;
      }

      // Check if user has dismissed the warning recently
      const dismissedData = localStorage.getItem(DISMISS_KEY);
      if (dismissedData) {
        try {
          const { timestamp } = JSON.parse(dismissedData);
          const dismissedDate = new Date(timestamp);
          const currentDate = new Date();
          const daysSinceDismissal = Math.floor(
            (currentDate.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Show again if more than DISMISS_DURATION_DAYS have passed
          if (daysSinceDismissal < DISMISS_DURATION_DAYS) {
            return false;
          }
        } catch (e) {
          // Invalid data, show the warning
          console.warn("Invalid dismiss data, showing warning");
        }
      }

      return true;
    };

    const dismissWarning = () => {
      const dismissData = {
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissData));
      showDeprecationWarning.value = false;
    };

    onMounted(() => {
      showDeprecationWarning.value = checkIfShouldShow();
    });

    return {
      showDeprecationWarning,
      dismissWarning,
    };
  },
});
</script>

<style scoped>
.gradient-banner {
  background: linear-gradient(
    to right,
    transparent 60%,
    #fff7e6 70%,
    #ffe8cc 100%
  );
}

.database-deprecation-container {
  border: 1px solid #ffa940;
  border-radius: 6px;
}

.deprecation-message {
  font-size: 16px;
  font-weight: 600;
  line-height: 28px;
  color: #d46b08;
}

.deprecation-subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: #ad6800;
}

.body--dark {
  .gradient-banner {
    background: linear-gradient(
      to right,
      transparent 60%,
      #2d2416 70%,
      #3d2e1a 100%
    );
  }

  .database-deprecation-container {
    border: 1px solid #d46b08;
  }

  .deprecation-message {
    color: #ffa940;
  }

  .deprecation-subtitle {
    color: #ffc069;
  }
}
</style>
