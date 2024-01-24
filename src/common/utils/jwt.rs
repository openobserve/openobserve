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
use crate::common::{infra::errors::JwtError, meta::user::TokenValidationResponse};

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

                let user_email = decoded_token.claims.get("email").unwrap().as_str().unwrap();

                Ok((
                    TokenValidationResponse {
                        is_valid: true,
                        user_email: user_email.to_owned(),
                        is_internal_user: false,
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
