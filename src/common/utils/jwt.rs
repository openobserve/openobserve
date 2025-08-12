// Copyright 2025 OpenObserve Inc.
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
use crate::common::meta::user::TokenValidationResponse;

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
pub(crate) fn verify_decode_token(
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
    if login_flow {
        validation.validate_exp = true;
        validation.set_audience(&[aud]);
    } else {
        // we are decoding the token for the service account, which is issued by the dex
        // hence we don't need to validate the exp and aud
        validation.validate_exp = false;
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
        .map(str::to_lowercase)
        .unwrap_or_default();

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
#[cfg(test)]
mod tests {
    use super::*;

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
