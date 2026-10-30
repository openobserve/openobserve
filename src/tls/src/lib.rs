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

//! TLS configuration and certificate utilities.

use std::io::BufReader;

use itertools::Itertools;
use rustls::pki_types::{CertificateDer, pem::PemObject};

pub fn client_tls_config() -> Result<rustls::ClientConfig, anyhow::Error> {
    let cfg = config::get_config();
    let cert_store = match cfg.http.tls_root_certificates {
        config::TlsRootCertificates::Native => {
            let mut cert_store = rustls::RootCertStore::empty();
            let native_certs = rustls_native_certs::load_native_certs();
            for cert in native_certs.certs {
                cert_store.add(cert)?;
            }
            if let Some(err) = native_certs.errors.first() {
                log::warn!("Failed to load some native certificates: {}", err);
            }
            cert_store
        }
        config::TlsRootCertificates::Webpki => {
            let mut cert_store = rustls::RootCertStore::empty();
            cert_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            if !cfg.http.tls_cert_path.is_empty() {
                let cert_file = &mut BufReader::new(
                    std::fs::File::open(&cfg.http.tls_cert_path).map_err(|e| {
                        anyhow::anyhow!(
                            "Failed to open TLS certificate file {}: {}",
                            cfg.http.tls_cert_path,
                            e
                        )
                    })?,
                );
                let cert_chain = CertificateDer::pem_reader_iter(cert_file);
                cert_store.add_parsable_certificates(cert_chain.try_collect::<_, Vec<_>, _>()?);
            }
            cert_store
        }
    };

    let mut config = rustls::ClientConfig::builder()
        .with_root_certificates(cert_store)
        .with_no_client_auth();

    let protos = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config.alpn_protocols = protos;

    Ok(config)
}

pub fn reqwest_client_tls_config() -> Result<reqwest::Client, anyhow::Error> {
    let cfg = config::get_config();
    let mut client_builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(cfg.route.timeout))
        .pool_max_idle_per_host(cfg.route.max_connections)
        .redirect(reqwest::redirect::Policy::none());

    if cfg.http.tls_enabled {
        let tls_config = client_tls_config()?;
        client_builder = client_builder.use_preconfigured_tls(tls_config);
    }
    if cfg.http.tls_skip_verify {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }

    Ok(client_builder.build()?)
}
