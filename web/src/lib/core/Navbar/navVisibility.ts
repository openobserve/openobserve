import type { NavGateContext, SubnavChild } from "./ONavbar.types";
import { isGateOpen } from "./useNavGateContext";
import { featureState } from "@/utils/featureGate";
import {
  checkFeatureAccess,
  isFeatureKey,
  type FeatureGateContext,
} from "@/utils/enterpriseFeatures";

export function visibleNavChildren(
  children: SubnavChild[],
  context: NavGateContext,
  featureContext: FeatureGateContext,
  hasRoute: (name: string) => boolean,
): SubnavChild[] {
  return children
    .filter((child) => hasRoute(child.name) && !context.hiddenMenus.has(child.name))
    .flatMap((child): SubnavChild[] => {
      if (child.gate && isFeatureKey(child.gate)) {
        const access = checkFeatureAccess(child.gate, featureContext);
        if (!access.visible) return [];
        if (!access.allowed) return [{ ...child, locked: true, lockedMessage: access.message }];
      }
      const license = child.feature ? featureState(context.features, child.feature) : "enabled";
      if (license === "hidden") return [];
      if (license === "locked") return [{ ...child, locked: false, licenseLocked: true }];
      return !child.gate || isGateOpen(context, child.gate) ? [{ ...child, locked: false }] : [];
    });
}
