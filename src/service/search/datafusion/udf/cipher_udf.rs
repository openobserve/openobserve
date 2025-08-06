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

// base64 characters contain a-zA-Z0-9 , + , / and = for padding
const BASE64_CHARS: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+=/";

use std::sync::Arc;

use arrow::array::{ArrayRef, StringArray};
use config::utils::str;
use datafusion::{
    arrow::datatypes::DataType,
    common::cast::as_string_array,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarFunctionImplementation, ScalarUDF, Volatility},
    prelude::create_udf,
    scalar::ScalarValue,
    sql::sqlparser::parser::ParserError,
};
use o2_enterprise::enterprise::cipher::Cipher;
use once_cell::sync::Lazy;
use serde_json::Value;

use crate::cipher::registry::REGISTRY;

/// The name of the decrypt UDF given to DataFusion.
pub(crate) const DECRYPT_UDF_NAME: &str = "decrypt_path";
/// The name of the decrypt UDF given to DataFusion.
pub(crate) const ENCRYPT_UDF_NAME: &str = "encrypt";
/// The name of the decrypt_slow UDF given to DataFusion.
pub(crate) const DECRYPT_SLOW_UDF_NAME: &str = "decrypt";

/// implementation of decrypt
pub(crate) static DECRYPT_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        DECRYPT_UDF_NAME,
        // expects three arguments : field, key_name and path
        vec![DataType::Utf8, DataType::Utf8, DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Stable,
        decrypt(),
    )
});

/// implementation of encrypt
pub(crate) static ENCRYPT_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ENCRYPT_UDF_NAME,
        // expects three arguments : field, key_name and path
        vec![DataType::Utf8, DataType::Utf8, DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Stable,
        encrypt(),
    )
});

/// implementation of decrypt_slow
pub(crate) static DECRYPT_SLOW_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        DECRYPT_SLOW_UDF_NAME,
        // expects three arguments : field, key_name and path
        vec![DataType::Utf8, DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Stable,
        decrypt_slow(),
    )
});

/// decrypt function
fn decrypt() -> ScalarFunctionImplementation {
    Arc::new(move |args: &[ColumnarValue]| {
        if args.len() != 3 {
            return Err(DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "decrypt requires three params : decrypt(field_name, key_name, path)"
                        .to_string(),
                )),
                None,
            ));
        }

        let key = match &args[1] {
            ColumnarValue::Scalar(ScalarValue::Utf8(Some(s))) => s.to_owned(),
            _ => {
                return Err(DataFusionError::SQL(
                    Box::new(ParserError::ParserError(
                        "second argument to decrypt must be a key-name string".to_string(),
                    )),
                    None,
                ));
            }
        };
        let path = match &args[2] {
            ColumnarValue::Scalar(ScalarValue::Utf8(Some(s))) => s.to_owned(),
            _ => {
                return Err(DataFusionError::SQL(
                    Box::new(ParserError::ParserError(
                        "third argument to decrypt must be a path string".to_string(),
                    )),
                    None,
                ));
            }
        };

        let args = ColumnarValue::values_to_arrays(args)?;

        let values = as_string_array(&args[0]).map_err(|_| {
            DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "first argument to decrypt must be a string type column".to_string(),
                )),
                None,
            )
        })?;

        // NOTE!!! : the {} block is important as it will drop read lock
        // if we take a read lock outside of block scope, it might not be dropped
        let mut cipher = {
            match REGISTRY.read().get_key(&key) {
                None => {
                    let key_name = match key.split_once(":") {
                        Some((_, n)) => n,
                        None => &key,
                    };
                    return Err(DataFusionError::Execution(format!(
                        "key with name {key_name} not found"
                    )));
                }
                Some(k) => k,
            }
        };

        let mut err_count = 0;
        let mut last_error = None;
        let ret = values
            .iter()
            .map(|v| {
                v.map(|original_str| {
                    // if path is just '.', it means we simply have to decrypt
                    // the given value, so we directly do that
                    if path == "." {
                        match cipher.decrypt(original_str) {
                            Ok(v) => v,
                            Err(e) => {
                                err_count += 1;
                                last_error = Some(e);
                                original_str.to_owned()
                            }
                        }
                    } else {
                        // first try to parse json, if fails, return original value
                        let v: Value = match serde_json::from_str(original_str) {
                            Ok(v) => v,
                            Err(_) => {
                                return original_str.to_owned();
                            }
                        };
                        // try to get the path given from parsed json, if fails, return original
                        // value
                        let v = match config::utils::json::get_value_from_path(&v, &path) {
                            Some(v) => v,
                            None => {
                                // technically this is not error, simply the given path is not
                                // present
                                return original_str.to_owned();
                            }
                        };
                        // given path must either be a string, in which case directly decrypt it
                        // or is must be an array of string, in which case we basically .map() it
                        // and re-stringify
                        match v {
                            Value::String(s) => match cipher.decrypt(&s) {
                                Ok(v) => v,
                                Err(e) => {
                                    err_count += 1;
                                    last_error = Some(e);
                                    s.to_owned()
                                }
                            },
                            Value::Array(arr) => {
                                let mut ret = Vec::with_capacity(arr.len());
                                // we only consider the string values from the array,
                                // anything else gets silently ignored
                                arr.into_iter().for_each(|v| {
                                    if let Value::String(s) = v {
                                        let t = match cipher.decrypt(&s) {
                                            Ok(v) => v,
                                            Err(e) => {
                                                err_count += 1;
                                                last_error = Some(e);
                                                s.to_owned()
                                            }
                                        };
                                        ret.push(t);
                                    }
                                });
                                // if there is not a single string value in given array,
                                // user probably has given incorrect path, we we return original
                                // value
                                if ret.is_empty() {
                                    original_str.to_owned()
                                } else {
                                    // we can unwrap because vec of strings should be serializable
                                    serde_json::to_string(&ret).unwrap()
                                }
                            }
                            _ => original_str.to_owned(),
                        }
                    }
                })
            })
            .collect::<StringArray>();

        if let Some(e) = last_error {
            log::info!(
                "encountered some errors while decrypting, total count {err_count}, last error : {e}"
            );
        }

        Ok(ColumnarValue::from(Arc::new(ret) as ArrayRef))
    })
}

/// decrypt function
fn encrypt() -> ScalarFunctionImplementation {
    Arc::new(move |args: &[ColumnarValue]| {
        if args.len() != 3 {
            return Err(DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "encrypt requires three params : encrypt(field_name, key_name, path)"
                        .to_string(),
                )),
                None,
            ));
        }

        let key = match &args[1] {
            ColumnarValue::Scalar(ScalarValue::Utf8(Some(s))) => s.to_owned(),
            _ => {
                return Err(DataFusionError::SQL(
                    Box::new(ParserError::ParserError(
                        "second argument to encrypt must be a key-name string".to_string(),
                    )),
                    None,
                ));
            }
        };

        let path = match &args[2] {
            ColumnarValue::Scalar(ScalarValue::Utf8(Some(s))) => s.to_owned(),
            _ => {
                return Err(DataFusionError::SQL(
                    Box::new(ParserError::ParserError(
                        "third argument to encrypt must be a path string".to_string(),
                    )),
                    None,
                ));
            }
        };

        let args = ColumnarValue::values_to_arrays(args)?;

        let values = as_string_array(&args[0]).map_err(|_| {
            DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "first argument to encrypt must be a string type column".to_string(),
                )),
                None,
            )
        })?;

        // NOTE!!! : the {} block is important as it will drop read lock
        // if we take a read lock outside of block scope, it might not be dropped
        let mut cipher = {
            match REGISTRY.read().get_key(&key) {
                None => {
                    let key_name = match key.split_once(":") {
                        Some((_, n)) => n,
                        None => &key,
                    };
                    return Err(DataFusionError::Execution(format!(
                        "key with name {key_name} not found"
                    )));
                }
                Some(k) => k,
            }
        };

        let mut err_count = 0;
        let mut last_error = None;
        let ret = values
            .iter()
            .map(|v| {
                v.map(|original_str| {
                    // if path is just '.', it means we simply have to decrypt
                    // the given value, so we directly do that
                    if path == "." {
                        match cipher.encrypt(original_str) {
                            Ok(v) => v,
                            Err(e) => {
                                err_count += 1;
                                last_error = Some(e);
                                original_str.to_owned()
                            }
                        }
                    } else {
                        // first try to parse json, if fails, return original value
                        let v: Value = match serde_json::from_str(original_str) {
                            Ok(v) => v,
                            Err(_) => {
                                return original_str.to_owned();
                            }
                        };
                        // try to get the path given from parsed json, if fails, return original
                        // value
                        let v = match config::utils::json::get_value_from_path(&v, &path) {
                            Some(v) => v,
                            None => {
                                // technically this is not error, simply the given path is not
                                // present
                                return original_str.to_owned();
                            }
                        };
                        // given path must either be a string, in which case directly encrypt it
                        // or is must be an array of string, in which case we basically .map() it
                        // and re-stringify
                        match v {
                            Value::String(s) => match cipher.encrypt(&s) {
                                Ok(v) => v,
                                Err(e) => {
                                    err_count += 1;
                                    last_error = Some(e);
                                    s.to_owned()
                                }
                            },
                            Value::Array(arr) => {
                                let mut ret = Vec::with_capacity(arr.len());
                                // we only consider the string values from the array,
                                // anything else gets silently ignored
                                arr.into_iter().for_each(|v| {
                                    if let Value::String(s) = v {
                                        let t = match cipher.encrypt(&s) {
                                            Ok(v) => v,
                                            Err(e) => {
                                                err_count += 1;
                                                last_error = Some(e);
                                                s.to_owned()
                                            }
                                        };
                                        ret.push(t);
                                    }
                                });
                                // if there is not a single string value in given array,
                                // user probably has given incorrect path, we we return original
                                // value
                                if ret.is_empty() {
                                    original_str.to_owned()
                                } else {
                                    // we can unwrap because vec of strings should be serializable
                                    serde_json::to_string(&ret).unwrap()
                                }
                            }
                            _ => original_str.to_owned(),
                        }
                    }
                })
            })
            .collect::<StringArray>();

        if let Some(e) = last_error {
            log::info!(
                "encountered some errors while encrypting, total count {err_count}, last error : {e}"
            );
        }

        Ok(ColumnarValue::from(Arc::new(ret) as ArrayRef))
    })
}

fn _decrypt_brute_force(cipher: &mut Box<dyn Cipher>, original_str: &str) -> String {
    // the o/p string will be at most the length of original
    let mut output = String::with_capacity(original_str.len());
    let mut start = 0;
    let mut end = 0;
    let mut in_base64 = false;
    // we go through the characters one by one
    for c in original_str.chars() {
        if BASE64_CHARS.contains(c) {
            // if the current character is base64
            if in_base64 {
                // if we are already in a base64 string, simply extend the end
                end += 1;
            } else {
                // otherwise we have reached end of a non-base64 string,
                // so copy it as-is, set the start of the base64 string to current
                // and set in_base64 to true
                output.push_str(&original_str[start..end]);
                start = end;
                end += 1;
                in_base64 = true;
            }
        } else {
            // if the character is not base64
            if in_base64 {
                // and we were in a base 64 string, then we have reached
                // the end of it try to decrypt it, and copy over the data
                // set the start of non-base64 to current position
                // and set in_base64 to false
                match cipher.decrypt(&original_str[start..end]) {
                    Ok(v) => {
                        output.push_str(&v);
                    }
                    Err(_) => {
                        output.push_str(&original_str[start..end]);
                    }
                }
                start = end;
                end += 1;
                in_base64 = false;
            } else {
                // if already part of non-base64 string, increment the end
                end += 1
            }
        }
    }
    if start != end {
        if in_base64 {
            match cipher.decrypt(&original_str[start..end]) {
                Ok(v) => {
                    output.push_str(&v);
                }
                Err(_) => {
                    output.push_str(&original_str[start..end]);
                }
            }
        } else {
            output.push_str(&original_str[start..end]);
        }
    }
    output
}

/// decrypt function
fn decrypt_slow() -> ScalarFunctionImplementation {
    Arc::new(move |args: &[ColumnarValue]| {
        if args.len() != 2 {
            return Err(DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "decrypt_slow requires two params : decrypt(field_name, key_name)".to_string(),
                )),
                None,
            ));
        }

        let key = match &args[1] {
            ColumnarValue::Scalar(ScalarValue::Utf8(Some(s))) => s.to_owned(),
            _ => {
                return Err(DataFusionError::SQL(
                    Box::new(ParserError::ParserError(
                        "second argument to decrypt must be a key-name string".to_string(),
                    )),
                    None,
                ));
            }
        };

        let args = ColumnarValue::values_to_arrays(args)?;

        let values = as_string_array(&args[0]).map_err(|_| {
            DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "first argument to decrypt_slow must be a string type column".to_string(),
                )),
                None,
            )
        })?;

        // NOTE!!! : the {} block is important as it will drop read lock
        // if we take a read lock outside of block scope, it might not be dropped
        let mut cipher = {
            match REGISTRY.read().get_key(&key) {
                None => {
                    let key_name = match key.split_once(":") {
                        Some((_, n)) => n,
                        None => &key,
                    };
                    return Err(DataFusionError::Execution(format!(
                        "key with name {key_name} not found"
                    )));
                }
                Some(k) => k,
            }
        };

        let ret = values
            .iter()
            .map(|v| v.map(|original_str| _decrypt_brute_force(&mut cipher, original_str)))
            .collect::<StringArray>();

        Ok(ColumnarValue::from(Arc::new(ret) as ArrayRef))
    })
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::cipher::{
        Cipher, Key, algorithm::Algorithm, tink::decode_tink_key,
    };

    use super::_decrypt_brute_force;
    // This is majorly to test the brute force function for out-of-bounds errors.
    // because we are manually managing the start and end points of the substring and not
    // using iterators, there is a possibility of out of bounds access

    fn get_cipher() -> Box<dyn Cipher> {
        let key = decode_tink_key(r#"{"primaryKeyId":2236997873,"key":[{"keyData":{"typeUrl":"type.googleapis.com/google.crypto.tink.AesSivKey","value":"EkC8wD9q/ef/s5n9mlRcUbkNITa9fPplxmZ3ARGn8RTJOJn49bneUIurtC+VJezLgt8bE6uI6QlFRcr3EsZzU/mP","keyMaterialType":"SYMMETRIC"},"status":"ENABLED","keyId":2236997873,"outputPrefixType":"TINK"}]}"#).unwrap();
        let cipher = Key::try_new(key, Algorithm::TInkDaead256Siv { key_id: 2236997873 }).unwrap();
        Box::new(cipher)
    }

    #[test]
    fn test_brute_force_decrypt() {
        let mut cipher = get_cipher();
        let cases = vec![
            // simple string
            (
                "AYVV4PEGot7xTIzS87lKYbqllAC6LdfIIAys1TC3ERY3cidVHhkYt9SZUI7GqajL/Lqzk0jz2qQEpMfztkxEN9OiRl78x1NtpjQrH+7YXMESKz2nYg==",
                "Fund summer hundred threat scientist find join to toward should.",
            ),
            // incomplete encrypted string
            (
                "AYVV4PEGot7xTIzS87lKYbqllAC6LdfIIAys1TC3ERY3cidVHhkYt9SZUI7GqajL/",
                "AYVV4PEGot7xTIzS87lKYbqllAC6LdfIIAys1TC3ERY3cidVHhkYt9SZUI7GqajL/",
            ),
            // object as a string
            (
                r#"{"arr": ["AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO", "AYVV4PG+/3+/9zIbmIO9h4JGH/ajw2T7kxxjBpYUQw==", "AYVV4PHxUxLDQuqdkcDwJVXHetIT5pTaEw=="], 
            "value": "AYVV4PGp2ZnR1+SsbSMBFkMHsKhOm6hNeG6+eCCF8nC6hiGtOCYYh1YZ4KK3YRoCljo09HtdBkHM3Us1vyPivIEBPZMDaX4cuGcGlCvQSiJXKkeNPOQzVpbmC1tgsO8nNn29BS5r+QR59bBZqzzlpJiIe5R3ahsZDMppmHU3DUl6YlGO2QqGmcR7VBo8ssxvPNkIIYAXvFjZ38H3XxHKjDH7O8YOPV5/o/4/iVV8vjFDxJG6ugEtq6bvz/yT8Ul3ZYtEOlL0ecC+K/OBmSk8wka3/1IDX/riE9j9IShz7edxHbvSJgAdUQKjcRCinRlWRKsH0NDJr7KYrCOqsU4Gsmf36IPmou0/NnCTDUPTJJaPmmxIM1lEhIx0k7T5izD88vdWHmoHmYKXMBUGBntKGr2AQzu5s8vuYjQv1Xv9xlUUhfL9JiAIMXhBb3gjV3FiLM3D3Du/t+nUTf8F30I4"
            }"#,
                r#"{"arr": ["Above.", "Operation.", "Lay."], 
            "value": "Court next then style measure including section speak financial start mouth one majority fall put still team lay perform outside consumer anyone around medical like generation true house human dinner well red agree line for term break issue style seek class better seem rate image him him large catch land state beautiful western."
            }"#,
            ),
            // incomplete object as a string
            (
                r#"{"arr": ["AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO",
            "value": "AYVV4PGp2ZnR1+SsbSMBFkMHsKhOm6hNeG6+eCCF8nC6hiGtOCYYh1YZ4KK3YRoCljo09HtdBkHM3Us1vyPivIEBPZMDaX4cuGcGlCvQSiJXKkeNPOQzVpbmC1tgsO8nNn29BS5r+QR59bBZqzzlpJiIe5R3ahsZDMppmHU3DUl6YlGO2QqGmcR7VBo8ssxvPNkIIYAXvFjZ38H3XxHKjDH7O8YOPV5/o/4/iVV8vjFDxJG6ugEtq6bvz/yT8Ul3ZYtEOlL0ecC+K/OBmSk8wka3/1IDX/riE9j9IShz7edxHbvSJgAdUQKjcRCinRlWRKsH0NDJr7KYrCOqsU4Gsmf36IPmou0/NnCTDUPTJJaPmmxIM1lEhIx0k7T5izD88vdWHmoHmYKXMBUGBntKGr2AQzu5s8vuYjQv1Xv9xlUUhfL9JiAIMXhBb3gjV3FiLM3D3Du/t+nUTf8F30I4"
            }"#,
                r#"{"arr": ["Above.",
            "value": "Court next then style measure including section speak financial start mouth one majority fall put still team lay perform outside consumer anyone around medical like generation true house human dinner well red agree line for term break issue style seek class better seem rate image him him large catch land state beautiful western."
            }"#,
            ),
            (
                r#"{"arr": ["AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO",
            "value": "AYVV4PGp2ZnR1+SsbSMBFkMHsKhOm6hNeG6"
            }"#,
                r#"{"arr": ["Above.",
            "value": "AYVV4PGp2ZnR1+SsbSMBFkMHsKhOm6hNeG6"
            }"#,
            ),
            // some weird cases
            ("a_b_c", "a_b_c"),
            ("_b_c", "_b_c"),
            ("b_c_", "b_c_"),
            (" abc", " abc"),
            ("abc ", "abc "),
            ("_AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO", "_Above."),
            (" AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO", " Above."),
            (" AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO_", " Above._"),
            ("AYVV4PGUXJb1DS32vbwN/oAPUbk1jlAwgXyO ", "Above. "),
        ];

        for (input, expected) in cases {
            let dec = _decrypt_brute_force(&mut cipher, input);
            assert_eq!(dec, expected);
        }
    }
}
