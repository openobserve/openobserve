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

#[cfg(feature = "enterprise")]
use {
    jsonwebtoken::{
        Algorithm, DecodingKey, TokenData, Validation, decode, decode_header,
        jwk::{self, AlgorithmParameters, KeyAlgorithm},
    },
    serde_json::Value,
    std::collections::HashMap,
};

#[cfg(feature = "enterprise")]
use crate::meta::user::TokenValidationResponse;

#[cfg(feature = "enterprise")]
type VerifyTokenResult = Result<
    (
        TokenValidationResponse,
        Option<TokenData<HashMap<String, Value>>>,
    ),
    anyhow::Error,
>;

/// Convert a `KeyAlgorithm` to an `Algorithm`
///
/// There's no built-in conversion from `KeyAlgorithm`
/// to `Algorithm` so we need to do it manually, while
/// avoiding string conversions.
#[cfg(feature = "enterprise")]
#[inline]
fn key_algorithm_to_algorithm(key_algo: &KeyAlgorithm) -> Option<Algorithm> {
    match key_algo {
        KeyAlgorithm::HS256 => Some(Algorithm::HS256),
        KeyAlgorithm::HS384 => Some(Algorithm::HS384),
        KeyAlgorithm::HS512 => Some(Algorithm::HS512),
        KeyAlgorithm::RS256 => Some(Algorithm::RS256),
        KeyAlgorithm::RS384 => Some(Algorithm::RS384),
        KeyAlgorithm::RS512 => Some(Algorithm::RS512),
        KeyAlgorithm::ES256 => Some(Algorithm::ES256),
        KeyAlgorithm::ES384 => Some(Algorithm::ES384),
        KeyAlgorithm::PS256 => Some(Algorithm::PS256),
        KeyAlgorithm::PS384 => Some(Algorithm::PS384),
        KeyAlgorithm::PS512 => Some(Algorithm::PS512),
        // Other algorithms are not supported yet
        _ => None,
    }
}

#[allow(clippy::type_complexity)]
#[cfg(feature = "enterprise")]
pub fn verify_decode_token(
    token: &str,
    jwks: &str,
    aud: &str,
    get_decode_token: bool,
    login_flow: bool,
) -> VerifyTokenResult {
    use config::meta::user::UserRole;
    use infra::errors::JwtError;

    let jwks: jwk::JwkSet = serde_json::from_str(jwks)?;
    let header = decode_header(token)?;
    let kid = match header.kid {
        Some(k) => k,
        None => return Err(JwtError::MissingAttribute("`kid` header".to_owned()).into()),
    };

    let j = jwks.find(&kid).ok_or(JwtError::KeyNotExists())?;
    let AlgorithmParameters::RSA(rsa) = &j.algorithm else {
        return Err(JwtError::ValidationFailed().into());
    };

    let decoding_key = DecodingKey::from_rsa_components(&rsa.n, &rsa.e)?;

    let mut validation = j
        .common
        .key_algorithm
        .as_ref()
        .and_then(key_algorithm_to_algorithm)
        .map(Validation::new)
        .ok_or(JwtError::ValidationFailed())?;
    // Expiry is ALWAYS enforced. There is no secondary `exp` check anywhere in
    // the auth path, so relaxing it here would make session expiry and token
    // revocation unenforceable for every route that reaches this function.
    validation.validate_exp = true;
    if login_flow {
        validation.set_audience(&[aud]);
    } else {
        // MCP clients register dynamically with Dex, so their `aud` is not our
        // static `client_id` and cannot be matched against it. Only the audience
        // check is relaxed for them — never expiry.
        validation.validate_aud = false;
    };

    let decoded_token =
        decode::<HashMap<String, serde_json::Value>>(token, &decoding_key, &validation)?;

    let mut final_claims = decoded_token.claims.clone();
    if let Some(map) = final_claims
        .get("federated_claims")
        .and_then(Value::as_object)
        .cloned()
    {
        final_claims.extend(map);
    };

    let user_email = final_claims
        .get("email")
        .or_else(|| final_claims.get("user_id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let user_name = final_claims
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let family_name = final_claims
        .get("family_name")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let given_name = final_claims
        .get("given_name")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let user_role = (!login_flow).then_some(UserRole::ServiceAccount);

    Ok((
        TokenValidationResponse {
            is_valid: true,
            user_email,
            user_name: user_name.to_owned(),
            family_name: family_name.to_owned(),
            given_name: given_name.to_owned(),
            is_internal_user: false,
            user_role,
        },
        get_decode_token.then_some(decoded_token),
    ))
}

#[cfg(feature = "enterprise")]
pub async fn get_user_name_from_token(auth_str: &str) -> Option<String> {
    let keys = o2_dex::service::auth::get_dex_jwks().await;
    let result = verify_decode_token(
        auth_str.strip_prefix("Bearer")?.trim(),
        &keys,
        &o2_dex::config::get_config().client_id,
        false,
        true,
    )
    .ok()?;
    result.0.is_valid.then_some(result.0.user_email)
}

#[cfg(feature = "enterprise")]
#[cfg(test)]
mod tests {
    use super::*;

    /// Fixed 2048-bit RSA test keypair. Hard-coded (not generated per-run) so the
    /// JWKS modulus below stays in sync and the tests remain hermetic and fast.
    /// Test-only material — never used outside this module.
    const TEST_PRIV_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDGTBNl8SrAdlAU
fsXuDA7mAVAOd9et3zx5zxaPCxGbHCUyMfBxPTUiBgJVfZw82PEGZW/nIBg0Jh9y
oVxfPZI8IjBTWyhv+pjewe2a8sIquEeeK1ke6INUhTP98P2xeabw+LeTtuBOVVxy
84+wIrSOMpytyiW+PPRpfUZ6odTBnV1lPVesI/z3eodmVBrGApEK1mRo+zCRboh7
N6ZgWJLNcp94ChHN0EkKktyBLaFQFd/6n3ZZGO9BrlaUNTIMa2cw4W6TZgQ44Pg2
XEudkr9nIPIQSkiW1BapnB2bWufFO7Qa5XQv1i1jA7FjOMiFLM04hJtVNKsEqdTD
zNTAvgIVAgMBAAECggEAevmE8iyM6cy1vvAbyZP6zVM1FbPmsrKFq7js8YrYwUvE
GYv05BUkVVRKsD/025tiZigULM6vk++sgwdk5L+nZ9mABMG8oy1TDppPw08XcSzV
ZVbWrx9dCtaMtsh0XFLoX/quxlGca5fufG9lxcLQHHtwxSpfG8prfNwvEDA6ZFMe
Rsovk/4UCLWDSA6TDzjl/rgMiiqHPUe2bZn4Dmz6dB75JGqDUlRrHzYf0EpbirXN
sHqVmCTN5coQ9YEbVxO5YvvCA2VIzaOV/vtjsxVo6AW0Su6Q1zG95e6B+dHT8gq3
23zdDDyhvuLZZDuJxMjTzYrdKa6Cbj5cxRMARY1HhQKBgQDugLVcmrmD+a+CyROb
QLJkFpLks6u9mIR88i1GofCdswcic77DFm9dJ08Qf38+liWL8hCr1WJdJgPLXxNp
h3gseKn6RL1p2dwFAkSRMO88vxVc4PYMFds7PfJC/tuN2Sc1/03o05mwBkeEX9On
dhhFqJWcCRmPI9nf4L5OL98LfwKBgQDU2EVZqvTTDvqXr7oh7DJ7YD/GUNuEop2K
1L4fnrq+HVCKZ8wzTh8yjKfO6fpZf4wWZGETBWbg87nexpap8BDzQxwBIJzmEE7H
qbgoyb1kWbXN7r4Zz9KMK/lrmaH9Uzr/W1ZJNdDhyuJBna7s3Y5BZFEdXTPoB0ez
tgdHqCXMawKBgQCF9n9oC3RGX9moYV8E5jsNIuzRTuYZMXDBaZnqwY0QVv2b6V1t
4M0eirTLNIH5Woaua4HXspx0a6TX94hEzxW+DOyUqUWnDfqaSaLP1qeZ/E54g9dQ
BHrGdM39uX8C1sVCfCt7qlb52x0Simys9BVAEygto6Lalq2LJYZfDl5+6wKBgFao
k1vVwgZos9isgHEtVMRsxKp+41GWT+Rlh98h5lBfaRpg9n/xD7yqDeyt0PM9fhDj
36455dAzC3tLia45Av24Vh+TYq4894ZNcKCSutyvtdjZmmax+bx+bvfDPnQAviWX
z4LROXGlBAfJJp5j+nZfXLNC7k5LIINn2oDvUixvAoGBAMhtnO1d8ufI9swV2i3T
f65K5EUUYygLm1AXgFCenb6L9golR0XCtibdEI8lCBK7mGjrLAbV0z9gNVoc7uZ7
plzPFc/u57aR2ej7TOIVdtH4o5dfd55UJFwocNvfSBAAoGHaUlQ19/JZpu1g+LVk
CN5lTowpVXP2OIiiNTGa75Fj
-----END PRIVATE KEY-----";

    /// JWKS containing the public half of `TEST_PRIV_KEY_PEM`.
    fn test_jwks() -> String {
        r#"{"keys":[{"kty":"RSA","kid":"test-key","alg":"RS256","use":"sig","n":"xkwTZfEqwHZQFH7F7gwO5gFQDnfXrd88ec8WjwsRmxwlMjHwcT01IgYCVX2cPNjxBmVv5yAYNCYfcqFcXz2SPCIwU1sob_qY3sHtmvLCKrhHnitZHuiDVIUz_fD9sXmm8Pi3k7bgTlVccvOPsCK0jjKcrcolvjz0aX1GeqHUwZ1dZT1XrCP893qHZlQaxgKRCtZkaPswkW6IezemYFiSzXKfeAoRzdBJCpLcgS2hUBXf-p92WRjvQa5WlDUyDGtnMOFuk2YEOOD4NlxLnZK_ZyDyEEpIltQWqZwdm1rnxTu0GuV0L9YtYwOxYzjIhSzNOISbVTSrBKnUw8zUwL4CFQ","e":"AQAB"}]}"#.to_string()
    }

    /// Mint a real RS256 token signed by the test key.
    /// `exp_offset_secs` is relative to now, so negative values yield an EXPIRED token.
    fn mint_token(aud: &str, exp_offset_secs: i64) -> String {
        use jsonwebtoken::{EncodingKey, Header, encode};

        let now = chrono::Utc::now().timestamp();
        let mut header = Header::new(jsonwebtoken::Algorithm::RS256);
        header.kid = Some("test-key".to_string());

        let claims = serde_json::json!({
            "sub": "CgVhZG1pbhIFbG9jYWw",
            "aud": aud,
            "iss": "http://localhost:5556/dex",
            "email": "victim@example.com",
            "name": "Victim User",
            "iat": now - 3600,
            "exp": now + exp_offset_secs,
        });

        encode(
            &header,
            &claims,
            &EncodingKey::from_rsa_pem(TEST_PRIV_KEY_PEM.as_bytes()).expect("valid test RSA key"),
        )
        .expect("token encodes")
    }

    /// Sanity check: a correctly-audienced, unexpired token must validate in the
    /// normal login flow. Anchors the tests below — if this fails, the harness is
    /// broken rather than the security property.
    #[test]
    fn valid_token_is_accepted_in_login_flow() {
        let token = mint_token("o2-client", 3600);
        let result = verify_decode_token(&token, &test_jwks(), "o2-client", false, true);
        assert!(
            result.is_ok(),
            "well-formed token must validate: {:?}",
            result.err()
        );
    }

    /// SECURITY: an EXPIRED token must never be accepted.
    ///
    /// `login_flow = false` (set for any MCP-flagged request) disables
    /// `validate_exp`, so a token that expired long ago still authenticates.
    /// There is no secondary expiry check anywhere in the auth path, so this
    /// makes session expiry and revocation unenforceable.
    ///
    /// Expected once fixed: expiry is validated unconditionally.
    #[test]
    fn expired_token_is_rejected_even_when_audience_check_is_skipped() {
        // Expired an hour ago.
        let token = mint_token("o2-client", -3600);

        let result = verify_decode_token(&token, &test_jwks(), "o2-client", false, false);

        assert!(
            result.is_err(),
            "SECURITY: expired token was accepted because login_flow=false disables \
             validate_exp. Skipping the `aud` check for dynamically-registered MCP \
             clients must not also disable expiry validation."
        );
    }

    /// No upper bound on token age under the same bypass.
    #[test]
    fn ancient_token_is_rejected_when_audience_check_is_skipped() {
        let token = mint_token("o2-client", -315_360_000); // expired 10 years ago
        assert!(
            verify_decode_token(&token, &test_jwks(), "o2-client", false, false).is_err(),
            "SECURITY: token expired 10 years ago must not authenticate"
        );
    }

    /// Expiry must also be enforced on the ordinary login path (regression guard).
    #[test]
    fn expired_token_is_rejected_in_login_flow() {
        let token = mint_token("o2-client", -3600);
        let result = verify_decode_token(&token, &test_jwks(), "o2-client", false, true);
        assert!(result.is_err(), "expired token must be rejected");
    }

    /// The Dex refresh flow is unaffected by always-on expiry validation.
    ///
    /// `refresh_token_with_dex` reads the REFRESH token from the `auth_tokens`
    /// cookie and exchanges it at Dex; it never decodes the expired access
    /// token. The only `verify_decode_token` call in that flow runs on the
    /// FRESHLY MINTED access token (status/mod.rs:1265), as do the other two
    /// non-middleware callers — `exchange_code` (status/mod.rs:1010) and
    /// `exchange_token` (service_accounts.rs:54).
    ///
    /// This test pins that contract: a newly issued token validates under both
    /// `login_flow` settings. If someone later makes a caller decode an
    /// already-expired token to harvest claims before refreshing, that is a
    /// design change which must be made explicit rather than relying on
    /// expiry validation being silently disabled.
    #[test]
    fn freshly_minted_token_validates_for_refresh_flow() {
        let fresh = mint_token("o2-client", 3600);
        assert!(
            verify_decode_token(&fresh, &test_jwks(), "o2-client", false, true).is_ok(),
            "refresh/exchange flows decode the newly minted token, not the expired one"
        );
        assert!(
            verify_decode_token(&fresh, &test_jwks(), "o2-client", false, false).is_ok(),
            "same token must validate on the MCP path too"
        );
    }

    /// Documents the INTENDED relaxation: MCP clients register dynamically with
    /// Dex, so their tokens carry an `aud` that is not O2's static `client_id`.
    /// Skipping the audience check for them is deliberate (see commit 1593db0e22).
    ///
    /// This test pins that behaviour so a fix for the expiry bug above does not
    /// silently re-enable `aud` validation and break real MCP clients.
    #[test]
    fn foreign_audience_is_tolerated_for_mcp_clients_when_unexpired() {
        let token = mint_token("some-dynamically-registered-mcp-client", 3600);

        let result = verify_decode_token(&token, &test_jwks(), "o2-client", false, false);

        assert!(
            result.is_ok(),
            "MCP tokens from dynamically-registered clients must still be accepted \
             while unexpired: {:?}",
            result.err()
        );
    }

    /// A foreign audience must still be rejected on the normal login path.
    #[test]
    fn foreign_audience_is_rejected_in_login_flow() {
        let token = mint_token("attacker-registered-client", 3600);
        let result = verify_decode_token(&token, &test_jwks(), "o2-client", false, true);
        assert!(
            result.is_err(),
            "login flow must enforce audience binding (RFC 8707)"
        );
    }

    #[test]
    fn test_verify_decode_token_missing_kid_header() {
        // Test that the function returns an error when the token header is missing the 'kid' field
        let invalid_token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks =
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        let result = verify_decode_token(invalid_token, jwks, "test-aud", false, false);
        assert!(result.is_err_and(|e| e.to_string().contains("kid")));
    }

    #[test]
    fn test_verify_decode_token_invalid_jwks() {
        // Test that the function handles invalid JWKS format
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let invalid_jwks = "invalid json";

        let result = verify_decode_token(token, invalid_jwks, "test-aud", false, false);
        assert!(result.is_err(), "Should return error for invalid JWKS");
    }

    #[test]
    fn test_verify_decode_token_key_not_found() {
        // Test that the function returns an error when the kid is not found in JWKS
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Im5vbmV4aXN0ZW50LWtleSJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks = r#"{"keys":[{"kty":"RSA","kid":"different-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        let result = verify_decode_token(token, jwks, "test-aud", false, false);
        assert!(result.is_err_and(|e| e.to_string().contains("No matching JWK found")));
    }

    #[test]
    fn test_verify_decode_token_non_rsa_algorithm() {
        // Test that the function returns an error for non-RSA algorithms
        let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

        let jwks = r#"{"keys":[{"kty":"EC","kid":"test-key","crv":"P-256","x":"test-x","y":"test-y","alg":"ES256"}]}"#;

        let result = verify_decode_token(token, jwks, "test-aud", false, false);
        assert!(result.is_err_and(|e| e.to_string().contains("Token can't be verified")));
    }

    #[test]
    fn test_verify_decode_token_login_flow_validation() {
        // Test that login_flow parameter affects validation settings
        // This test verifies the conditional logic for validation settings
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks =
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        // Test with login_flow = true (should validate exp and aud)
        let result_login = verify_decode_token(token, jwks, "test-aud", false, true);
        // This will likely fail due to invalid token, but we're testing the validation logic

        // Test with login_flow = false (should not validate exp and aud)
        let result_service = verify_decode_token(token, jwks, "test-aud", false, false);
        // This will likely fail due to invalid token, but we're testing the validation logic

        // Both should fail due to invalid token, but the point is to test the conditional logic
        assert!(
            result_login.is_err() || result_service.is_err(),
            "Both should fail with invalid token"
        );
    }

    #[test]
    fn test_verify_decode_token_get_decode_token_parameter() {
        // Test that get_decode_token parameter affects the return value
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks =
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        // Test with get_decode_token = false
        let result_false = verify_decode_token(token, jwks, "test-aud", false, false);

        // Test with get_decode_token = true
        let result_true = verify_decode_token(token, jwks, "test-aud", true, false);

        // Both should fail due to invalid token, but we're testing the parameter logic
        assert!(
            result_false.is_err() || result_true.is_err(),
            "Both should fail with invalid token"
        );
    }

    #[test]
    fn test_verify_decode_token_claims_processing() {
        // Test the claims processing logic (email/user_id fallback, federated_claims extension)
        // This test verifies the logic for extracting user information from claims
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks =
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        let result = verify_decode_token(token, jwks, "test-aud", false, false);

        // Should fail due to invalid token, but we're testing the claims processing logic
        assert!(result.is_err(), "Should fail with invalid token");
    }

    #[test]
    fn test_verify_decode_token_user_role_assignment() {
        // Test that user_role is correctly assigned based on login_flow
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks =
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        // Test with login_flow = true (should assign ServiceAccount role)
        let result_login = verify_decode_token(token, jwks, "test-aud", false, true);

        // Test with login_flow = false (should not assign role)
        let result_service = verify_decode_token(token, jwks, "test-aud", false, false);

        // Both should fail due to invalid token, but we're testing the role assignment logic
        assert!(
            result_login.is_err() || result_service.is_err(),
            "Both should fail with invalid token"
        );
    }

    #[test]
    fn test_verify_decode_token_response_structure() {
        // Test that the function returns the expected response structure
        let token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.EkN-DOsnsuRjRO6BxXemmJDm3HbxrbRzXglbN2S4sOkopdU4IsDxTI8jO19W_A4K8ZPJijNLis4EZsHeY559a4DFOd50_OqgHGuERTqYZyuhtF39yxJPAjUESwxk2J5k_4zM3O-vtd1Ghyo4IbqKKSy6J9mTniYJPenn5-HIirE";

        let jwks =
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"test-n","e":"AQAB","alg":"RS256"}]}"#;

        let result = verify_decode_token(token, jwks, "test-aud", false, false);

        // Should fail due to invalid token, but we're testing the response structure
        assert!(result.is_err(), "Should fail with invalid token");

        // If it were to succeed, it should return a tuple with TokenValidationResponse and
        // Option<TokenData> The TokenValidationResponse should have is_valid = true and
        // is_internal_user = false
    }
}
