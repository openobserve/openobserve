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

//! Stateless signed chart payload — the URL *is* the chart.
//!
//! A notification's `chart_url` carries the full chart definition (points,
//! thresholds, trigger, expiry) as `?d=<deflate+base64url of JSON>&s=<HMAC>`.
//! The render endpoint reconstructs the PNG from the URL alone: nothing is
//! ever stored, and the URL self-expires via the `exp` embedded in the signed
//! payload. Design + live Slack PoC:
//! docs/___alert_templates/plans/2026-08-04-alert-chart-image-design.md
//!
//! Security invariants (do not reorder):
//! 1. The HMAC is verified BEFORE the payload is inflated — a forged payload must never reach the
//!    decompressor (decompression-bomb guard).
//! 2. The signature covers `org_id` as well as the payload, so a URL minted under one org path
//!    cannot be replayed under another.
//! 3. The payload may contain ONLY numeric series, thresholds and the alert name — never row data
//!    or log content. It is readable by anyone holding the URL, the same exposure class as the
//!    notification body.

use std::io::{Read, Write};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// Hard cap on the inflated payload size (defense in depth behind the
/// verify-first rule).
const MAX_INFLATED_BYTES: u64 = 64 * 1024;

/// Downsample ceiling: > 6 px per point on an 800-px-wide chart; more points
/// add bytes, not information. Also keeps the encoded URL well under Slack's
/// 3,000-char image-URL limit (live-measured: 90 points ≈ 1,800 chars).
pub const MAX_POINTS: usize = 120;

/// Slack rejects image block URLs longer than 3,000 chars; refuse to emit a
/// URL that could not be delivered.
pub const MAX_URL_CHARS: usize = 2900;

/// Domain-separation label for deriving the signing key from the instance
/// secret. Versioned so a future payload format can rotate keys.
const KEY_DERIVATION_LABEL: &[u8] = b"o2-alert-chart-sign-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChartPayload {
    /// Payload format version.
    pub v: u8,
    /// Unix seconds after which the URL must not render.
    pub exp: u64,
    /// Chart caption — alert name / short context ONLY (invariant 3).
    pub title: String,
    /// (unix_seconds, observed value) — the evaluation history series.
    pub points: Vec<(u64, f64)>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub crit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub warn: Option<f64>,
    /// Evaluation timestamp (unix seconds) that fired this notification.
    pub trigger_ts: u64,
}

/// Derive the chart-signing key from per-instance secret material (IKM) and
/// the deployment salt. HKDF-extract (one HMAC application, salt as key) with
/// a versioned domain-separation label — sufficient without a new dependency.
///
/// Callers must fail closed on empty IKM: `ZO_EXT_AUTH_SALT` defaults to the
/// public constant "openobserve", so the salt alone MUST NOT produce a key.
pub fn derive_signing_key(ikm: &str, salt: &str) -> Vec<u8> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(salt.as_bytes()).expect("HMAC accepts any key length");
    mac.update(KEY_DERIVATION_LABEL);
    mac.update(b"\0");
    mac.update(ikm.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn signature(key: &[u8], org_id: &str, d: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(org_id.as_bytes());
    mac.update(b"\0");
    mac.update(d.as_bytes());
    // 128-bit truncated tag: standard for HMAC-SHA256, keeps the URL short.
    mac.finalize().into_bytes()[..16].to_vec()
}

/// Encode + sign. Returns the two query components `(d, s)`.
///
/// Fails (returns `None`) when even the downsampled payload would produce an
/// undeliverable URL — the caller sends a chartless notification instead.
pub fn encode(payload: &ChartPayload, key: &[u8], org_id: &str) -> Option<(String, String)> {
    debug_assert!(payload.points.len() <= MAX_POINTS);
    let json = serde_json::to_vec(payload).ok()?;
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&json).ok()?;
    let compressed = enc.finish().ok()?;
    let d = URL_SAFE_NO_PAD.encode(&compressed);
    let s = URL_SAFE_NO_PAD.encode(signature(key, org_id, &d));
    if d.len() + s.len() > MAX_URL_CHARS {
        return None;
    }
    Some((d, s))
}

#[derive(Debug, PartialEq)]
pub enum DecodeError {
    /// Signature missing/invalid — indistinguishable 404 to callers.
    BadSignature,
    /// Payload malformed (encoding/inflate/JSON) — only reachable with a
    /// valid signature, i.e. never attacker-controlled.
    Malformed,
    Expired,
}

/// Verify + decode. The signature check happens before any decompression
/// (invariant 1).
pub fn decode(
    d: &str,
    s: &str,
    key: &[u8],
    org_id: &str,
    now_unix_secs: u64,
) -> Result<ChartPayload, DecodeError> {
    let provided = URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|_| DecodeError::BadSignature)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(org_id.as_bytes());
    mac.update(b"\0");
    mac.update(d.as_bytes());
    mac.verify_truncated_left(&provided)
        .map_err(|_| DecodeError::BadSignature)?;

    let compressed = URL_SAFE_NO_PAD
        .decode(d)
        .map_err(|_| DecodeError::Malformed)?;
    let inflater = flate2::read::DeflateDecoder::new(&compressed[..]);
    let mut json = Vec::new();
    inflater
        .take(MAX_INFLATED_BYTES)
        .read_to_end(&mut json)
        .map_err(|_| DecodeError::Malformed)?;
    let payload: ChartPayload =
        serde_json::from_slice(&json).map_err(|_| DecodeError::Malformed)?;
    if payload.exp < now_unix_secs {
        return Err(DecodeError::Expired);
    }
    Ok(payload)
}

/// Quantize to 6 significant digits. Chart pixels can't show more, long
/// float reprs bloat the encoded URL, and short decimals round-trip serde's
/// default (non-`float_roundtrip`) parser deterministically.
fn quantize(v: f64) -> f64 {
    // NaN/inf can't be plotted or JSON-serialized; collapse to 0.
    if v == 0.0 || !v.is_finite() {
        return 0.0;
    }
    let mag = v.abs().log10().floor();
    let factor = 10f64.powf(5.0 - mag);
    (v * factor).round() / factor
}

/// Uniform downsample to at most `MAX_POINTS` points (always keeping the
/// first and last), with values quantized (see [`quantize`]). Uniform stride
/// is adequate here: evaluation history is near-regular, and the chart is
/// 800 px wide.
pub fn downsample(points: &[(u64, f64)]) -> Vec<(u64, f64)> {
    let pick = |&(t, v): &(u64, f64)| (t, quantize(v));
    if points.len() <= MAX_POINTS {
        return points.iter().map(&pick).collect();
    }
    let last = points.len() - 1;
    let mut out = Vec::with_capacity(MAX_POINTS);
    for i in 0..MAX_POINTS - 1 {
        out.push(pick(&points[i * last / (MAX_POINTS - 1)]));
    }
    out.push(pick(&points[last]));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(n: usize) -> ChartPayload {
        ChartPayload {
            v: 1,
            exp: 2_000_000_000,
            title: "error_rate_high · default".into(),
            // 0.25 steps are exactly representable in binary, so the JSON
            // round-trip is bit-identical regardless of serde_json's default
            // (non-float_roundtrip) parser.
            points: (0..n as u64)
                .map(|i| (1_700_000_000 + i * 60, 1.5 + i as f64 * 0.25))
                .collect(),
            crit: Some(5.0),
            warn: Some(3.0),
            trigger_ts: 1_700_000_000 + n as u64 * 60,
        }
    }

    const KEY_SECRET: &str = "test-instance-secret";

    #[test]
    fn round_trip_identity() {
        let key = derive_signing_key(KEY_SECRET, "salt");
        let p = sample(90);
        let (d, s) = encode(&p, &key, "default").unwrap();
        let back = decode(&d, &s, &key, "default", 1_900_000_000).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn max_points_payload_fits_slack_url_budget() {
        let key = derive_signing_key(KEY_SECRET, "salt");
        let mut p = sample(MAX_POINTS);
        // Worst-ish case: high-entropy values compress poorly.
        for (i, pt) in p.points.iter_mut().enumerate() {
            pt.1 = (i as f64 * 1234.567).sin() * 98765.4321;
        }
        let (d, s) = encode(&p, &key, "default").unwrap();
        assert!(
            d.len() + s.len() <= MAX_URL_CHARS,
            "len={}",
            d.len() + s.len()
        );
    }

    #[test]
    fn tampered_payload_is_rejected_before_inflate() {
        let key = derive_signing_key(KEY_SECRET, "salt");
        let p = sample(10);
        let (d, s) = encode(&p, &key, "default").unwrap();
        let mut tampered = d.clone();
        tampered.replace_range(0..1, if d.starts_with('A') { "B" } else { "A" });
        assert_eq!(
            decode(&tampered, &s, &key, "default", 0).unwrap_err(),
            DecodeError::BadSignature
        );
    }

    #[test]
    fn signature_is_org_bound() {
        let key = derive_signing_key(KEY_SECRET, "salt");
        let p = sample(10);
        let (d, s) = encode(&p, &key, "org-a").unwrap();
        assert_eq!(
            decode(&d, &s, &key, "org-b", 0).unwrap_err(),
            DecodeError::BadSignature
        );
    }

    #[test]
    fn expired_payload_is_rejected() {
        let key = derive_signing_key(KEY_SECRET, "salt");
        let p = sample(10); // exp = 2_000_000_000
        let (d, s) = encode(&p, &key, "default").unwrap();
        assert_eq!(
            decode(&d, &s, &key, "default", 2_000_000_001).unwrap_err(),
            DecodeError::Expired
        );
    }

    #[test]
    fn wrong_key_is_rejected() {
        let p = sample(10);
        let (d, s) = encode(&p, &derive_signing_key("secret-a", "salt"), "default").unwrap();
        assert_eq!(
            decode(
                &d,
                &s,
                &derive_signing_key("secret-b", "salt"),
                "default",
                0
            )
            .unwrap_err(),
            DecodeError::BadSignature
        );
    }

    #[test]
    fn downsample_caps_and_keeps_endpoints() {
        let pts: Vec<(u64, f64)> = (0..1000u64).map(|i| (i, i as f64)).collect();
        let out = downsample(&pts);
        assert_eq!(out.len(), MAX_POINTS);
        assert_eq!(out.first(), Some(&(0, 0.0)));
        assert_eq!(out.last(), Some(&(999, 999.0)));
        let short: Vec<(u64, f64)> = (0..50u64).map(|i| (i, i as f64)).collect();
        assert_eq!(downsample(&short).len(), 50);
    }
}
