// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use tokio_rustls::TlsAcceptor;
use std::io::{BufReader, Error as IOError, ErrorKind};
use tokio_rustls::rustls::{Certificate, PrivateKey, ServerConfig};
use rustls_pemfile::{certs, pkcs8_private_keys};
use std::fs::File;
use std::sync::Arc;
use crate::common::infra::config::{CONFIG};


pub fn setup_tls() -> Result<TlsAcceptor, IOError> {
    let cert: Vec<Certificate> = certs(&mut BufReader::new(File::open(CONFIG.postgres.cert_path.to_string())?))
        .map_err(|_| IOError::new(ErrorKind::InvalidInput, "invalid cert"))
        .map(|mut certs| certs.drain(..).map(Certificate).collect())?;
    let key = pkcs8_private_keys(&mut BufReader::new(File::open(CONFIG.postgres.key_path.to_string())?))
        .map_err(|_| IOError::new(ErrorKind::InvalidInput, "invalid key"))
        .map(|mut keys| keys.drain(..).map(PrivateKey).next().unwrap())?;

    let config = ServerConfig::builder()
        .with_safe_defaults()
        .with_no_client_auth()
        .with_single_cert(cert, key)
        .map_err(|err| IOError::new(ErrorKind::InvalidInput, err))?;

    Ok(TlsAcceptor::from(Arc::new(config)))
}