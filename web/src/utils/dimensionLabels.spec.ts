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

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { dimensionLabel } from "./dimensionLabels";

const t = i18n.global.t as unknown as TranslateFn;

describe("dimensionLabel", () => {
  it("names Kubernetes dimension ids as the default semantic groups do", () => {
    expect(dimensionLabel("k8s-cluster", t)).toBe("K8s Cluster");
    expect(dimensionLabel("k8s-namespace", t)).toBe("K8s Namespace");
    expect(dimensionLabel("k8s-deployment", t)).toBe("K8s Deployment");
    expect(dimensionLabel("k8s-pod", t)).toBe("K8s Pod");
    expect(dimensionLabel("k8s-pod-name", t)).toBe("K8s Pod Name");
  });

  it("never shows a raw key for an id it has no label for", () => {
    expect(dimensionLabel("aws-ecs-cluster", t)).toBe("Aws Ecs Cluster");
    expect(dimensionLabel("environment", t)).toBe("Environment");
  });
});
