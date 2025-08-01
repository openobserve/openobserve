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

use std::collections::{BTreeMap, BTreeSet};

use clap::{Arg, Command};
use ingester::{Entry, errors::Result};
use wal::Reader;

#[derive(Debug, Clone)]
struct SchemaField {
    name: String,
    field_type: String,
    nullable: bool,
}

#[derive(Debug, Clone)]
struct EntrySchema {
    fields: Vec<SchemaField>,
    total_fields: usize,
}

fn main() -> Result<()> {
    let matches = Command::new("wal-reader")
        .version("1.0")
        .author("OpenObserve Inc.")
        .about("Read and inspect WAL (Write-Ahead Log) files")
        .arg(
            Arg::new("path")
                .help("Path to the WAL file")
                .required(true)
                .index(1),
        )
        .arg(
            Arg::new("schema")
                .short('s')
                .long("schema")
                .help("Print schema information for each record")
                .action(clap::ArgAction::SetTrue),
        )
        .arg(
            Arg::new("verbose")
                .short('v')
                .long("verbose")
                .help("Print verbose output including raw data preview")
                .action(clap::ArgAction::SetTrue),
        )
        .arg(
            Arg::new("limit")
                .short('l')
                .long("limit")
                .help("Limit number of entries to read")
                .value_name("NUMBER")
                .value_parser(clap::value_parser!(usize)),
        )
        .get_matches();

    let path = matches.get_one::<String>("path").unwrap();
    let print_schema = matches.get_flag("schema");
    let verbose = matches.get_flag("verbose");
    let limit = matches.get_one::<usize>("limit");

    let mut reader = Reader::from_path(path).map_err(|e| {
        eprintln!("Failed to open WAL file '{}': {}", path, e);
        std::process::exit(1);
    })?;

    let mut total = 0;
    let mut i = 0;
    let mut schemas_seen: BTreeMap<String, EntrySchema> = BTreeMap::new();

    println!("Reading WAL file: {}", path);
    if let Some(limit_count) = limit {
        println!("Limiting to {} entries", limit_count);
    }
    println!();

    loop {
        // Check limit
        if let Some(limit_count) = limit {
            if i >= *limit_count {
                break;
            }
        }

        let entry = match reader.read_entry() {
            Ok(entry) => entry,
            Err(wal::Error::UnableToReadData { source }) => {
                eprintln!("Unable to read entry from: {}, skip the entry", source);
                continue;
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                break;
            }
        };

        let Some(entry) = entry else {
            break;
        };

        let entry = Entry::from_bytes(&entry)?;
        i += 1;

        // Extract and analyze schema
        let schema_info = if print_schema {
            extract_schema_from_entry(&entry)
        } else {
            None
        };

        // Track unique schemas
        if let Some(ref schema) = schema_info {
            let schema_key = format!("{}/{}", entry.stream, entry.schema_key);
            schemas_seen.insert(schema_key, schema.clone());
        }

        // Print entry information
        if verbose {
            println!("Entry {:05}:", i);
            println!("  Stream: {}", entry.stream);
            println!("  Schema Key: {}", entry.schema_key);
            println!("  Partition Key: {}", entry.partition_key);
            println!("  Data Size: {} bytes", entry.data.len());
            
            if print_schema {
                if let Some(ref schema) = schema_info {
                    println!("  Schema Fields ({}):", schema.total_fields);
                    for field in &schema.fields {
                        println!("    {} : {} {}", 
                            field.name, 
                            field.field_type,
                            if field.nullable { "(nullable)" } else { "(required)" }
                        );
                    }
                }
            }

            // Print first few records as preview
            if !entry.data.is_empty() {
                println!("  Sample Data:");
                for (idx, record) in entry.data.iter().take(2).enumerate() {
                    println!("    Record {}: {}", idx + 1, 
                        serde_json::to_string_pretty(record).unwrap_or_else(|_| "Invalid JSON".to_string())
                    );
                }
                if entry.data.len() > 2 {
                    println!("    ... and {} more records", entry.data.len() - 2);
                }
            }
            println!();
        } else {
            // Compact format
            if print_schema {
                if let Some(ref schema) = schema_info {
                    println!(
                        "{:05}\t{}/{}/{}\t{} records\t{} fields",
                        i,
                        entry.stream,
                        entry.schema_key,
                        entry.partition_key,
                        entry.data.len(),
                        schema.total_fields
                    );
                } else {
                    println!(
                        "{:05}\t{}/{}/{}\t{} records\tNo schema",
                        i,
                        entry.stream,
                        entry.schema_key,
                        entry.partition_key,
                        entry.data.len()
                    );
                }
            } else {
                println!(
                    "{:05}\t{}/{}/{}\t{} records",
                    i,
                    entry.stream,
                    entry.schema_key,
                    entry.partition_key,
                    entry.data.len()
                );
            }
        }

        total += entry.data.len();
    }

    println!();
    println!("Summary:");
    println!("  Total entries: {}", i);
    println!("  Total records: {}", total);

    if print_schema && !schemas_seen.is_empty() {
        println!("  Unique schemas found: {}", schemas_seen.len());
        println!();
        println!("Schema Details:");
        for (schema_key, schema) in schemas_seen {
            println!("  {}:", schema_key);
            println!("    Fields: {}", schema.total_fields);
            for field in &schema.fields {
                println!("      {} : {} {}", 
                    field.name, 
                    field.field_type,
                    if field.nullable { "(nullable)" } else { "(required)" }
                );
            }
            println!();
        }
    }

    Ok(())
}

fn extract_schema_from_entry(entry: &Entry) -> Option<EntrySchema> {
    if entry.data.is_empty() {
        return None;
    }

    let mut field_types: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut field_nullability: BTreeMap<String, bool> = BTreeMap::new();

    // Analyze all records to determine field types
    for record in &entry.data {
        if let Some(obj) = record.as_object() {
            for (key, value) in obj {
                let type_name = get_json_type_name(value);
                field_types.entry(key.clone()).or_default().insert(type_name);
                
                // Track if field can be null
                if value.is_null() {
                    field_nullability.insert(key.clone(), true);
                } else {
                    field_nullability.entry(key.clone()).or_insert(false);
                }
            }
        }
    }

    if field_types.is_empty() {
        return None;
    }

    let mut fields = Vec::new();
    for (field_name, types) in field_types {
        let field_type = if types.len() == 1 {
            types.into_iter().next().unwrap()
        } else {
            format!("Union[{}]", types.into_iter().collect::<Vec<_>>().join(", "))
        };
        
        let nullable = field_nullability.get(&field_name).copied().unwrap_or(false);
        
        fields.push(SchemaField {
            name: field_name,
            field_type,
            nullable,
        });
    }

    fields.sort_by(|a, b| a.name.cmp(&b.name));
    let total_fields = fields.len();

    Some(EntrySchema {
        fields,
        total_fields,
    })
}

fn get_json_type_name(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(_) => "bool".to_string(),
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                "int64".to_string()
            } else if n.is_u64() {
                "uint64".to_string()
            } else {
                "float64".to_string()
            }
        }
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "object".to_string(),
    }
}
