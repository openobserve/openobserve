import type { RumSection } from "./service_versions";

// The vitals of compare_e2.rum in test/unit/fixtures/serviceVersions/stage7.json; type-check:app checks the shape.
export const goldenRumVitals = {
  lcp_p75: {
    a: 1.6609535575144478,
    b: 2.0287067818024176,
    band_a: "good",
    band_b: "good",
    band_crossed: false,
    ci_kind: "sketch_band",
    delta: -0.3677532242879698,
    hi: -0.3308566208948011,
    insufficient: false,
    lo: -0.4046498276811385,
    straddles_zero: false,
  },
  inp_p75: {
    a: 211.68058794446472,
    b: 176.80942852062574,
    band_a: "needs_improvement",
    band_b: "good",
    band_crossed: true,
    ci_kind: "sketch_band",
    delta: 34.871159423838975,
    hi: 38.756059588489876,
    insufficient: false,
    lo: 30.986259259188067,
    straddles_zero: false,
  },
  cls_p75: {
    a: 0.03319972986653323,
    b: 0.11941256244915416,
    band_a: "good",
    band_b: "needs_improvement",
    band_crossed: true,
    ci_kind: "sketch_band",
    delta: -0.08621283258262091,
    hi: -0.08468670965946405,
    insufficient: false,
    lo: -0.08773895550577779,
    straddles_zero: false,
  },
} satisfies Pick<RumSection, "lcp_p75" | "inp_p75" | "cls_p75">;
