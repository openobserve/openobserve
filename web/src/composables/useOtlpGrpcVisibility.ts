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

import { computed } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { isPrimaryCloudWebUrl } from "@/utils/otelCollectorConfig";

/**
 * Whether the "OTLP gRPC" section should render at all, and which variant:
 * self-hosted everywhere except cloud, OpenObserve Cloud's public gateway only
 * on the primary region — never both, never neither for a supported env.
 */
export default function useOtlpGrpcVisibility() {
  const store = useStore();

  const isPrimaryCloud = computed(() => isPrimaryCloudWebUrl(store.state.zoConfig?.web_url));
  const showOtlpGrpc = computed(() => config.isCloud === "false" || isPrimaryCloud.value);

  return { isPrimaryCloud, showOtlpGrpc };
}
