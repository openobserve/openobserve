use std::{error::Error, fs::OpenOptions, io::Write, os::unix::fs::OpenOptionsExt, path::Path};

use rsa::{
    pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
    RsaPrivateKey, RsaPublicKey,
};

use crate::common::infra::config::CONFIG;

/// Write to file if it doesn't exist.
fn write_to_file(path: &str, data: &str, perms: u32) -> Result<(), Box<dyn Error>> {
    let path = Path::new(path);
    if !path.exists() {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .mode(perms)
            .open(path)?;
        file.write_all(data.as_bytes())?;

        if cfg!(windows) {
            let mut perms = file.metadata()?.permissions();
            perms.set_readonly(true);
            file.set_permissions(perms)?;
        } else {
            let perms = Permissions::from_mode(permissions);
            fs::set_permissions(path, perms)?;
        }
        Ok(())
    } else {
        Err("File already exists , skipping key generation".to_string().into())
    }
}

/// Generate a private key and certificate and write them to disk.
pub fn generate_pem_certificate_and_write(base_path: &str) -> Result<(), Box<dyn Error>> {
    std::fs::create_dir_all(&CONFIG.common.certs_base_dir)?;
    let private_key_path = format!("{}/private.pem", base_path);
    let certificate_path = format!("{}/public.pem", base_path);

    let path = Path::new(&private_key_path);

    if path.exists() {
        return Ok(());
    };

    let mut rng = rand::thread_rng();

    let priv_key =
        RsaPrivateKey::new(&mut rng, CONFIG.common.key_bits).expect("failed to generate a key");
    let pub_key = RsaPublicKey::from(&priv_key);

    let private_key = priv_key
        .to_pkcs8_pem(LineEnding::LF)
        .expect("failed to encode private key");

    let public_key = pub_key
        .to_public_key_pem(LineEnding::LF)
        .expect("failed to encode public key");

    if let Err(e) = write_to_file(&private_key_path, &private_key, 0o600) {
        log::debug!("File already exists, not overwriting: {}", e);
    }

    if let Err(e) = write_to_file(&certificate_path, &certificate, 0o644) {
        log::debug!("File already exists, not overwriting: {}", e);
    }

    log::info!("Successfully generated pem keys");
    Ok(())
}
