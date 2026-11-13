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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

// Same wording as the default semantic groups, so a chip and an org's group name agree.
const K8S_LABELS: Record<string, I18nKey> = {
  "k8s-cluster": "settings.serviceIdentitySetup.trackedK8sCluster",
  "k8s-namespace": "settings.serviceIdentitySetup.trackedK8sNamespace",
  "k8s-deployment": "settings.serviceIdentitySetup.trackedK8sDeployment",
  "k8s-statefulset": "settings.serviceIdentitySetup.trackedK8sStatefulSet",
  "k8s-daemonset": "settings.serviceIdentitySetup.trackedK8sDaemonSet",
  "k8s-workload": "settings.serviceIdentitySetup.trackedK8sWorkload",
  "k8s-pod": "settings.serviceIdentitySetup.trackedK8sPod",
  "k8s-pod-name": "settings.serviceIdentitySetup.trackedK8sPodName",
};

/** The reader-facing name of a dimension id; an id without a label reads as words, never as the raw key. */
export function dimensionLabel(key: string, t: TranslateFn): I18nText {
  const label = K8S_LABELS[key];
  if (label) return t(label);
  return raw(
    key
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" "),
  );
}
