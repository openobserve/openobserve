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

use argon2::{Algorithm, Argon2, Params, PasswordHasher, Version, password_hash::SaltString};

pub mod cityhash;
pub mod fnv;
pub mod gxhash;
pub mod murmur3;

pub trait Sum64 {
    fn sum64(&mut self, key: &str) -> u64;
}

pub fn get_passcode_hash(pass: &str, salt: &str) -> String {
    let t_cost = 4;
    let m_cost = 2048;
    let p_cost = 2;
    let params = Params::new(m_cost, t_cost, p_cost, None).unwrap();
    let ctx = Argon2::new(Algorithm::Argon2d, Version::V0x10, params);
    let password = pass.as_bytes();
    let salt_string = SaltString::encode_b64(salt.as_bytes()).unwrap();
    ctx.hash_password(password, &salt_string)
        .unwrap()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_passcode_hash_basic_properties() {
        let password = "test_password";
        let salt = "test_salt";

        let hash = get_passcode_hash(password, salt);

        // Verify the hash is not empty and is different from the input
        assert!(!hash.is_empty(), "Hash should not be empty");
        assert_ne!(
            hash, password,
            "Hash should not equal the original password"
        );
        assert_ne!(hash, salt, "Hash should not equal the salt");
    }

    #[test]
    fn test_get_passcode_hash_deterministic_and_unique() {
        let password = "same_password";
        let salt = "same_salt";

        // Test deterministic behavior
        let hash1 = get_passcode_hash(password, salt);
        let hash2 = get_passcode_hash(password, salt);
        assert_eq!(
            hash1, hash2,
            "Same password and salt should produce identical hashes"
        );

        // Test different salts produce different hashes
        let salt2 = "different_salt";
        let hash3 = get_passcode_hash(password, salt2);
        assert_ne!(
            hash1, hash3,
            "Different salts should produce different hashes"
        );

        // Test different passwords produce different hashes
        let password2 = "different_password";
        let hash4 = get_passcode_hash(password2, salt);
        assert_ne!(
            hash1, hash4,
            "Different passwords should produce different hashes"
        );
    }

    #[test]
    fn test_get_passcode_hash_edge_cases() {
        // Test empty inputs
        let empty_password = "";
        let salt = "test-salt";
        let hash = get_passcode_hash(empty_password, salt);
        assert!(!hash.is_empty(), "Empty inputs should still produce a hash");

        // Test special characters
        let special_password = "p@ssw0rd!@#$%^&*()";
        let special_salt = "s@lt!@#$%^&*()";
        let special_hash = get_passcode_hash(special_password, special_salt);
        assert!(
            !special_hash.is_empty(),
            "Special characters should produce a valid hash"
        );
        assert_ne!(
            special_hash, special_password,
            "Hash should not equal the original password"
        );

        // Test Unicode characters
        let unicode_password = "password_with_unicode_🚀";
        let unicode_salt = "salt_with_unicode_🌟";
        let unicode_hash = get_passcode_hash(unicode_password, unicode_salt);
        assert!(
            !unicode_hash.is_empty(),
            "Unicode characters should produce a valid hash"
        );
        assert_ne!(
            unicode_hash, unicode_password,
            "Hash should not equal the original password"
        );
    }
}
