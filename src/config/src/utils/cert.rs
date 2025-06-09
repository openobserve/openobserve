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

use rustls::{
    DigitallySignedStruct, SignatureScheme,
    client::danger,
    crypto::{verify_tls12_signature, verify_tls13_signature},
    pki_types::{CertificateDer, ServerName, UnixTime},
};

/// A custom certificate verifier that accepts certificates
/// only if they are in the list of trusted certificates
#[derive(Debug)]
pub struct SelfSignedCertVerifier<'a> {
    allowed_certs: Vec<CertificateDer<'a>>,
}

impl<'a> SelfSignedCertVerifier<'a> {
    pub fn new(allowed_certs: Vec<CertificateDer<'a>>) -> Self {
        Self { allowed_certs }
    }
}

impl<'a> danger::ServerCertVerifier for SelfSignedCertVerifier<'a> {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<danger::ServerCertVerified, rustls::Error> {
        // Check if the server's certificate matches our trusted certificate
        if self
            .allowed_certs
            .iter()
            .any(|cert| cert.as_ref() == _end_entity.as_ref())
        {
            Ok(danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "Server certificate not trusted".into(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<danger::HandshakeSignatureValid, rustls::Error> {
        let provider = rustls::crypto::ring::default_provider();
        verify_tls12_signature(
            message,
            cert,
            dss,
            &provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<danger::HandshakeSignatureValid, rustls::Error> {
        let provider = rustls::crypto::ring::default_provider();
        verify_tls13_signature(
            message,
            cert,
            dss,
            &provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        let provider = rustls::crypto::ring::default_provider();
        provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use rustls::client::danger::ServerCertVerifier;

    use super::*;

    #[test]
    fn test_verifies_self_signed_cert() {
        // Create a test certificate
        let cert_data = b"-----MOCK CERTIFICATE DATA-----";
        let cert = CertificateDer::from(cert_data.to_vec());

        // Create a verifier with this certificate as allowed
        let verifier = SelfSignedCertVerifier::new(vec![cert.clone()]);

        // Test the verification
        let result = verifier.verify_server_cert(
            &cert,
            &[],
            &ServerName::try_from("example.com").unwrap(),
            &[],
            UnixTime::now(),
        );

        assert!(result.is_ok(), "Certificate verification should succeed");
    }

    #[test]
    fn test_fails_on_invalid_cert() {
        // Create a trusted certificate
        let trusted_cert_data = b"-----TRUSTED CERTIFICATE DATA-----";
        let trusted_cert = CertificateDer::from(trusted_cert_data.to_vec());

        // Create a different, untrusted certificate
        let untrusted_cert_data = b"-----UNTRUSTED CERTIFICATE DATA-----";
        let untrusted_cert = CertificateDer::from(untrusted_cert_data.to_vec());

        // Create a verifier that only trusts the first certificate
        let verifier = SelfSignedCertVerifier::new(vec![trusted_cert]);

        // Test verification with the untrusted certificate
        let result = verifier.verify_server_cert(
            &untrusted_cert,
            &[],
            &ServerName::try_from("example.com").unwrap(),
            &[],
            UnixTime::now(),
        );

        assert!(result.is_err(), "Certificate verification should fail");
        match result {
            Err(rustls::Error::General(msg)) => {
                assert_eq!(msg, "Server certificate not trusted");
            }
            _ => panic!("Expected General error with 'Server certificate not trusted' message"),
        }
    }
}
