use std::{error::Error, fs::File, io::Write, path::Path};

use rsa::{
    pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
    RsaPrivateKey, RsaPublicKey,
};

use crate::common::infra::config::CONFIG;

/// Write to file if it doesn't exist.
fn write_to_file(path: &str, data: &str) -> Result<(), Box<dyn Error>> {
    let path = Path::new(path);
    if !path.exists() {
        let mut file = File::create(path)?;
        file.write_all(data.as_bytes())?;
        Ok(())
    } else {
        Err(From::from(format!("File {:?} already exists", path)))
    }
}

/// Generate a private key and certificate and write them to disk.
pub fn generate_pem_certificate_and_write(base_path: &str) -> Result<(), Box<dyn Error>> {
    std::fs::create_dir_all(&CONFIG.common.certs_base_dir)?;

    let mut rng = rand::thread_rng();
    let bits = 2048;
    let priv_key = RsaPrivateKey::new(&mut rng, bits).expect("failed to generate a key");
    let pub_key = RsaPublicKey::from(&priv_key);

    let private_key = priv_key
        .to_pkcs8_pem(LineEnding::LF)
        .expect("failed to encode private key");

    let certificate = pub_key
        .to_public_key_pem(LineEnding::LF)
        .expect("failed to encode public key");

    let private_key_path = format!("{}/private.pem", base_path);
    let certificate_path = format!("{}/public.pem", base_path);

    if let Err(e) = write_to_file(&private_key_path, &private_key) {
        log::debug!("File already exists, not overwriting: {}", e);
    }

    if let Err(e) = write_to_file(&certificate_path, &certificate) {
        log::debug!("File already exists, not overwriting: {}", e);
    }

    log::info!("Successfully generated pem certificate");
    Ok(())
}
