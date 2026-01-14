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

use std::{
    io::BufReader,
    net::{Ipv4Addr, Ipv6Addr},
    sync::Arc,
};

use itertools::Itertools;
use rustls_pemfile::{certs, private_key};
use x509_parser::prelude::*;

pub fn http_tls_config() -> Result<rustls::ServerConfig, anyhow::Error> {
    let cfg = config::get_config();
    let cert_file =
        &mut BufReader::new(std::fs::File::open(&cfg.http.tls_cert_path).map_err(|e| {
            anyhow::anyhow!(
                "Failed to open TLS certificate file {}: {}",
                &cfg.http.tls_cert_path,
                e
            )
        })?);
    let key_file =
        &mut BufReader::new(std::fs::File::open(&cfg.http.tls_key_path).map_err(|e| {
            anyhow::anyhow!(
                "Failed to open TLS key file {}: {}",
                &cfg.http.tls_key_path,
                e
            )
        })?);

    let cert_chain = certs(cert_file);
    // let mut keys = rsa_private_keys(key_file);
    let versions: &[&'_ rustls::SupportedProtocolVersion] = match cfg.http.tls_min_version.as_str()
    {
        "1.3" => &[&rustls::version::TLS13],
        "1.2" => rustls::DEFAULT_VERSIONS,
        _ => rustls::DEFAULT_VERSIONS,
    };

    let tls_config = rustls::ServerConfig::builder_with_protocol_versions(versions)
        .with_no_client_auth()
        .with_single_cert(
            cert_chain.try_collect::<_, Vec<_>, _>()?,
            private_key(key_file)?.unwrap(),
        )?;

    Ok(tls_config)
}

pub fn client_tls_config() -> Result<Arc<rustls::ClientConfig>, anyhow::Error> {
    let cfg = config::get_config();
    let cert_store = if cfg.http.tls_root_certificates.as_str().to_lowercase() == "native" {
        // Load native system certificates
        let mut cert_store = rustls::RootCertStore::empty();
        let certs = rustls_native_certs::load_native_certs();
        for cert in certs.certs {
            cert_store.add(cert)?;
        }
        if let Some(err) = certs.errors.first() {
            log::warn!("Failed to load some native certificates: {}", err);
        }
        cert_store
    } else {
        // default use webpki, and add custom ca certificates
        let mut cert_store = rustls::RootCertStore::empty();
        cert_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let cert_file =
            &mut BufReader::new(std::fs::File::open(&cfg.http.tls_cert_path).map_err(|e| {
                anyhow::anyhow!(
                    "Failed to open TLS certificate file {}: {}",
                    &cfg.http.tls_cert_path,
                    e
                )
            })?);
        let cert_chain = certs(cert_file);
        cert_store.add_parsable_certificates(cert_chain.try_collect::<_, Vec<_>, _>()?);
        cert_store
    };

    let mut config = rustls::ClientConfig::builder()
        .with_root_certificates(cert_store)
        .with_no_client_auth();

    let protos = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config.alpn_protocols = protos;

    Ok(Arc::new(config))
}

pub fn reqwest_client_tls_config() -> Result<reqwest::Client, anyhow::Error> {
    let cfg = config::get_config();
    let mut client_builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(cfg.route.timeout))
        .pool_max_idle_per_host(cfg.route.max_connections);

    if cfg.http.tls_enabled {
        let tls_config = client_tls_config()?;
        client_builder = client_builder.use_preconfigured_tls(tls_config);
    }

    Ok(client_builder.build()?)
}

pub fn get_server_url_from_cert(cert: &[u8]) -> Result<String, anyhow::Error> {
    match parse_x509_certificate(cert) {
        Ok((_, certificate)) => {
            let result = String::new();
            for ext in certificate.extensions() {
                match ext.parsed_extension() {
                    ParsedExtension::SubjectAlternativeName(san) => {
                        if let Some(GeneralName::DNSName(dns_name)) =
                            san.general_names.iter().find(|&san| {
                                if let GeneralName::DNSName(_) = san {
                                    return true;
                                }
                                false
                            })
                        {
                            return Ok(dns_name.to_string());
                        }

                        if let Some(GeneralName::IPAddress(ip_addr)) =
                            san.general_names.iter().find(|&san| {
                                if let GeneralName::IPAddress(_) = san {
                                    return true;
                                }
                                false
                            })
                        {
                            if ip_addr.len() == 4 {
                                let ip_addr = <&[u8; 4]>::try_from(*ip_addr).unwrap();
                                return Ok(Ipv4Addr::from(*ip_addr).to_string());
                            } else if ip_addr.len() == 16 {
                                let ip_addr = <&[u8; 16]>::try_from(*ip_addr).unwrap();
                                return Ok(Ipv6Addr::from(*ip_addr).to_string());
                            } else {
                                return Err(anyhow::anyhow!(
                                    "Failed to parse certificate, invalid IP address length"
                                ));
                            }
                        }
                        return Err(anyhow::anyhow!(
                            "Failed to parse certificate, could not find DNS name or IP address in SAN"
                        ));
                    }
                    _ => {
                        continue;
                    }
                }
            }
            if !result.is_empty() {
                Ok(result)
            } else {
                Err(anyhow::anyhow!(
                    "Failed to parse certificate, could not find SAN"
                ))
            }
        }
        Err(e) => Err(anyhow::anyhow!("Failed to parse certificate: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use rcgen::{CertifiedKey, generate_simple_self_signed};

    use super::*;

    #[test]
    fn test_get_server_url_from_cert_prefers_dns_name() {
        // Generate an example certificate
        let subject_alt_names = vec!["127.0.0.1".to_string(), "example.com".to_string()];
        let CertifiedKey {
            cert,
            signing_key: _,
        } = generate_simple_self_signed(subject_alt_names).unwrap();
        let result = get_server_url_from_cert(cert.der().iter().as_slice());
        assert_eq!(result.unwrap(), "example.com");
    }

    #[test]
    fn test_get_server_url_from_cert_gets_ip_addr_v4() {
        // Generate an example certificate
        let subject_alt_names = vec!["127.0.0.1".to_string()];
        let CertifiedKey {
            cert,
            signing_key: _,
        } = generate_simple_self_signed(subject_alt_names).unwrap();
        let result = get_server_url_from_cert(cert.der().iter().as_slice());
        assert_eq!(result.unwrap(), "127.0.0.1");
    }

    #[test]
    fn test_get_server_url_from_cert_gets_ip_addr_v6() {
        // Generate an example certificate
        let subject_alt_names = vec!["2001:db8:85a3::8a2e:370:7334".to_string()];
        let CertifiedKey {
            cert,
            signing_key: _,
        } = generate_simple_self_signed(subject_alt_names).unwrap();
        let result = get_server_url_from_cert(cert.der().iter().as_slice());
        assert_eq!(result.unwrap(), "2001:db8:85a3::8a2e:370:7334");
    }
}
