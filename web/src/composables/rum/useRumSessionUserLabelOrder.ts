// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref, shallowReactive, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useLocalRumSessionUserLabelOrder } from "@/utils/storage";
import {
  DEFAULT_RUM_SESSION_USER_LABEL_ORDER,
  RUM_SESSION_USER_LABEL_ORDERS,
  type RumSessionUserLabelOrder,
} from "@/utils/rum/sessionUserIdentity";

const ordersByKey = shallowReactive(new Map<string, Ref<string | null>>());

export function useRumSessionUserLabelOrder() {
  const store = useStore();
  const key = computed(() => {
    const email = store?.state?.userInfo?.email;
    const org = store?.state?.selectedOrganization?.identifier;
    return email && org
      ? `o2:rumSessionUserLabelOrder:${encodeURIComponent(email)}:${encodeURIComponent(org)}`
      : null;
  });

  watch(
    key,
    (scope) => {
      if (scope && !ordersByKey.has(scope)) {
        ordersByKey.set(scope, useLocalRumSessionUserLabelOrder(scope) ?? ref(null));
      }
    },
    { immediate: true },
  );

  return computed<RumSessionUserLabelOrder>({
    get: () => {
      const stored = key.value ? ordersByKey.get(key.value)?.value : null;
      return (
        RUM_SESSION_USER_LABEL_ORDERS.find((order) => order === stored) ??
        DEFAULT_RUM_SESSION_USER_LABEL_ORDER
      );
    },
    set: (order) => {
      if (!key.value || !RUM_SESSION_USER_LABEL_ORDERS.includes(order)) return;
      const stored = useLocalRumSessionUserLabelOrder(key.value, order) ?? ref(order);
      stored.value = order;
      ordersByKey.set(key.value, stored);
    },
  });
}
