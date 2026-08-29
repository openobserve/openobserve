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

import { computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";

const defaultObject = {
  data: {
    datetime: {
      startTime: 0,
      endTime: 0,
      relativeTimePeriod: "15m",
      valueType: "relative",
    },
    streams: {} as any,
  },
};

let rumState = reactive(Object.assign({}, defaultObject));

const useRum = () => {
  const route = useRoute();
  const router = useRouter();

  const resetSessionState = () => {
    // delete searchObj.data;
    rumState = reactive(Object.assign({}, defaultObject));
  };

  // Every RUM page pushes its full state into the router query, so location is the link.
  const shareUrl = computed(() => window.location.origin + router.resolve(route.fullPath).href);

  return { rumState, resetSessionState, shareUrl };
};

export default useRum;
