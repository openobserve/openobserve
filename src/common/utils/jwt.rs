use std::{collections::HashMap, str::FromStr};

use base64::{self, engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use jsonwebtoken::{
    decode, decode_header,
    jwk::{self, AlgorithmParameters},
    Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use rsa::{pkcs8::DecodePublicKey, traits::PublicKeyParts, BigUint, RsaPublicKey};
use serde::Serialize;
use tokio::sync::OnceCell;

use crate::common::{
    infra::{config::CONFIG, errors::JwtError},
    meta::user::TokenValidationResponse,
    utils::json,
};

static JWKS: OnceCell<String> = OnceCell::const_new();

static PVT_KEY: OnceCell<EncodingKey> = OnceCell::const_new();

#[derive(Serialize)]
struct Claims {
    user: String,
    exp: i64,
    iat: i64,
}

pub async fn get_jwks() -> String {
    JWKS.get_or_init(generate_jwks).await.to_string()
}

pub async fn get_pvt_key() -> EncodingKey {
    PVT_KEY.get_or_init(read_pvt_key).await.clone()
}

// called only once server is started
async fn generate_jwks() -> String {
    let certificate_path = format!("{}/public.pem", &CONFIG.common.certs_base_dir);
    // Read the contents of the PEM-encoded RSA public key file
    let pem_data = std::fs::read_to_string(certificate_path).expect("Failed to read PEM file");

    let rsa_key = RsaPublicKey::from_public_key_pem(&pem_data).unwrap();

    // Get the modulus and exponent of the public key
    let n = BigUint::from_bytes_be(&rsa_key.n().to_bytes_be());
    let e = BigUint::from_bytes_be(&rsa_key.e().to_bytes_be());

    let jwk = json::json!({
        "kty": "RSA",
        "n": URL_SAFE_NO_PAD.encode(n.to_bytes_be()),
        "e": URL_SAFE_NO_PAD.encode(e.to_bytes_be()),
        "kid": "abc123", // TODO change key id
        "alg":"RS256",
        "use":"sig"
    });

    // Serialize JWKS
    json::json!({ "keys": [jwk] }).to_string()
}

pub(crate) async fn generate_token(user: &str) -> String {
    let iat = Utc::now().timestamp();
    let exp = (Utc::now() + Duration::minutes(CONFIG.common.token_ttl)).timestamp();

    // Create claims
    let my_claims = Claims {
        user: user.to_owned(),
        exp,
        iat,
    };

    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("abc123".to_owned());

    // Encode the token
    jsonwebtoken::encode(&header, &my_claims, &get_pvt_key().await).unwrap()
}

pub(crate) async fn verify_token(token: &str) -> Result<TokenValidationResponse, anyhow::Error> {
    let jwks = get_jwks().await;
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
                let decoded_token =
                    decode::<HashMap<String, serde_json::Value>>(token, &decoding_key, &validation)
                        .unwrap();
                let user_email = decoded_token.claims.get("user").unwrap().as_str().unwrap();
                Ok(TokenValidationResponse {
                    is_valid: true,
                    user_email: user_email.to_owned(),
                })
            }
            _ => Err(JwtError::ValidationFailed().into()),
        }
    } else {
        Err(JwtError::KeyNotExists().into())
    }
}

async fn read_pvt_key() -> EncodingKey {
    let private_key_path = format!("{}/private.pem", &CONFIG.common.certs_base_dir);
    let pem_data = std::fs::read_to_string(private_key_path).expect("Failed to read PEM file");
    EncodingKey::from_rsa_pem(pem_data.as_bytes()).unwrap()
}
