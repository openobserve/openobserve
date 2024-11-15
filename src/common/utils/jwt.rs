#[cfg(feature = "enterprise")]
use {
    jsonwebtoken::{
        decode, decode_header,
        jwk::{self, AlgorithmParameters},
        Algorithm, DecodingKey, TokenData, Validation,
    },
    serde_json::Value,
    std::{collections::HashMap, str::FromStr},
};

#[cfg(feature = "enterprise")]
use crate::common::meta::user::TokenValidationResponse;

#[cfg(feature = "enterprise")]
pub(crate) async fn verify_decode_token(
    token: &str,
    jwks: &str,
    aud: &str,
    get_decode_token: bool,
) -> Result<
    (
        TokenValidationResponse,
        Option<TokenData<HashMap<String, Value>>>,
    ),
    anyhow::Error,
> {
    use infra::errors::JwtError;

    let jwks: jwk::JwkSet = serde_json::from_str(jwks).unwrap();
    let header = decode_header(token)?;
    let kid = match header.kid {
        Some(k) => k,
        None => return Err(JwtError::MissingAttribute("`kid` header".to_owned()).into()),
    };

    if let Some(j) = jwks.find(&kid) {
        match &j.algorithm {
            AlgorithmParameters::RSA(rsa) => {
                let decoding_key = DecodingKey::from_rsa_components(&rsa.n, &rsa.e).unwrap();

                let mut validation = Validation::new(
                    Algorithm::from_str(j.common.key_algorithm.unwrap().to_string().as_str())
                        .unwrap(),
                );
                validation.validate_exp = true;
                validation.set_audience(&[aud]);
                let decoded_token = decode::<HashMap<String, serde_json::Value>>(
                    token,
                    &decoding_key,
                    &validation,
                )?;

                let user_email = if let Some(email) = decoded_token.claims.get("email") {
                    email.as_str().unwrap().to_lowercase()
                } else {
                    "".to_string()
                };

                let user_name = if let Some(name) = decoded_token.claims.get("name") {
                    name.as_str().unwrap()
                } else {
                    ""
                };

                let family_name = if let Some(family_name) = decoded_token.claims.get("family_name")
                {
                    family_name.as_str().unwrap()
                } else {
                    ""
                };

                let given_name = if let Some(given_name) = decoded_token.claims.get("given_name") {
                    given_name.as_str().unwrap()
                } else {
                    ""
                };

                Ok((
                    TokenValidationResponse {
                        is_valid: true,
                        user_email,
                        user_name: user_name.to_owned(),
                        family_name: family_name.to_owned(),
                        given_name: given_name.to_owned(),
                        is_internal_user: false,
                        user_role: None,
                    },
                    if get_decode_token {
                        Some(decoded_token)
                    } else {
                        None
                    },
                ))
            }
            _ => Err(JwtError::ValidationFailed().into()),
        }
    } else {
        Err(JwtError::KeyNotExists().into())
    }
}
