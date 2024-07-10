// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

//! File type abstraction

use std::{
    fmt::{self, Display},
    str::FromStr,
};

use ::datafusion::error::{DataFusionError, Result};

/// The default file extension of arrow files
pub const DEFAULT_ARROW_EXTENSION: &str = ".arrow";
/// The default file extension of avro files
pub const DEFAULT_AVRO_EXTENSION: &str = ".avro";
/// The default file extension of csv files
pub const DEFAULT_CSV_EXTENSION: &str = ".csv";
/// The default file extension of json files
pub const DEFAULT_JSON_EXTENSION: &str = ".json";
/// The default file extension of parquet files
pub const DEFAULT_PARQUET_EXTENSION: &str = ".parquet";

/// Define each `FileType`/`FileCompressionType`'s extension
pub trait GetExt {
    /// File extension getter
    fn get_ext(&self) -> String;
}

/// Readable file type
#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FileType {
    /// Apache Arrow file
    ARROW,
    /// Apache Avro file
    AVRO,
    /// Apache Parquet file
    PARQUET,
    /// CSV file
    CSV,
    /// JSON file
    JSON,
}

impl GetExt for FileType {
    fn get_ext(&self) -> String {
        match self {
            FileType::ARROW => DEFAULT_ARROW_EXTENSION.to_owned(),
            FileType::AVRO => DEFAULT_AVRO_EXTENSION.to_owned(),
            FileType::PARQUET => DEFAULT_PARQUET_EXTENSION.to_owned(),
            FileType::CSV => DEFAULT_CSV_EXTENSION.to_owned(),
            FileType::JSON => DEFAULT_JSON_EXTENSION.to_owned(),
        }
    }
}

impl Display for FileType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let out = match self {
            FileType::CSV => "csv",
            FileType::JSON => "json",
            FileType::PARQUET => "parquet",
            FileType::AVRO => "avro",
            FileType::ARROW => "arrow",
        };
        write!(f, "{}", out)
    }
}

impl FromStr for FileType {
    type Err = DataFusionError;

    fn from_str(s: &str) -> Result<Self> {
        let s = s.to_uppercase();
        match s.as_str() {
            "ARROW" => Ok(FileType::ARROW),
            "AVRO" => Ok(FileType::AVRO),
            "PARQUET" => Ok(FileType::PARQUET),
            "CSV" => Ok(FileType::CSV),
            "JSON" | "NDJSON" => Ok(FileType::JSON),
            _ => Err(DataFusionError::NotImplemented(format!(
                "Unknown FileType: {s}"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn from_str() {
        for (ext, file_type) in [
            ("csv", FileType::CSV),
            ("CSV", FileType::CSV),
            ("json", FileType::JSON),
            ("JSON", FileType::JSON),
            ("avro", FileType::AVRO),
            ("AVRO", FileType::AVRO),
            ("parquet", FileType::PARQUET),
            ("PARQUET", FileType::PARQUET),
        ] {
            assert_eq!(FileType::from_str(ext).unwrap(), file_type);
        }

        assert!(matches!(
            FileType::from_str("Unknown"),
            Err(DataFusionError::NotImplemented(_))
        ));
    }
}
