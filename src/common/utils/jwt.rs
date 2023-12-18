use std::{collections::HashMap, str::FromStr};

use base64::{self, engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use jsonwebtoken::{
    decode, decode_header,
    jwk::{self, AlgorithmParameters},
    Algorithm, DecodingKey, EncodingKey, Header, TokenData, Validation,
};
use rsa::{pkcs8::DecodePublicKey, traits::PublicKeyParts, BigUint, RsaPublicKey};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::OnceCell;

use crate::common::{
    infra::{config::CONFIG, errors::JwtError},
    meta::user::TokenValidationResponse,
    utils::json,
};

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
    let jwks: jwk::JwkSet = serde_json::from_str(&jwks).unwrap();
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
                let decoded_token =
                    decode::<HashMap<String, serde_json::Value>>(token, &decoding_key, &validation)
                        .unwrap();
                let user_email = decoded_token.claims.get("email").unwrap().as_str().unwrap();
                Ok((
                    TokenValidationResponse {
                        is_valid: true,
                        user_email: user_email.to_owned(),
                    },
                    Some(decoded_token),
                ))
            }
            _ => Err(JwtError::ValidationFailed().into()),
        }
    } else {
        Err(JwtError::KeyNotExists().into())
    }
}
