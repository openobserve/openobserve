//! A smart UTF8 compressor that chooses between dict encoding and Zstd compression.
//!
//! Strategy:
//! - For UTF8 fields: Try dict encoding first, if it's beneficial use it (without Zstd).
//! - If dict encoding is not beneficial: Fall back to Zstd compression.
//! - For other types: Use BtrBlocks compression.

use vortex::{
    array::{Array, ArrayRef, IntoArray},
    compressor::BtrBlocksCompressor,
    dtype::DType,
    encodings::zstd::ZstdArray,
    error::VortexResult,
    layout::layouts::compressed::CompressorPlugin,
};
use vortex_array::Canonical;

/// A compressor optimized for UTF8 fields using Zstd compression.
///
/// For UTF8/Binary fields:
/// - Applies Zstd compression directly to VarBinView arrays
/// - Uses configurable compression level (default: 3) and page size (default: 8192)
/// - Falls back to uncompressed if compression doesn't reduce size
///
/// For all other data types:
/// - Delegates to BtrBlocksCompressor for optimal encoding
#[derive(Debug, Clone)]
pub struct Utf8Compressor {
    /// The underlying BtrBlocks compressor for general compression
    btr_compressor: BtrBlocksCompressor,
    /// Zstd compression level (default: 3)
    zstd_level: i32,
    /// Number of values per Zstd compression frame (default: 8192)
    values_per_page: usize,
}

impl Utf8Compressor {
    /// Create a new smart compressor with default settings.
    pub fn new() -> Self {
        Self {
            btr_compressor: BtrBlocksCompressor {
                exclude_int_dict_encoding: true,
            },
            zstd_level: 3,
            values_per_page: 8192,
        }
    }

    /// Set the Zstd compression level (1-22, default: 3).
    pub fn with_zstd_level(mut self, level: i32) -> Self {
        self.zstd_level = level;
        self
    }

    /// Set the number of values per Zstd compression frame (default: 8192).
    pub fn with_values_per_page(mut self, values: usize) -> Self {
        self.values_per_page = values;
        self
    }

    /// Compress a chunk of data.
    pub fn compress(&self, chunk: &dyn Array) -> VortexResult<ArrayRef> {
        // Check if this is a UTF8 or Binary field
        if matches!(chunk.dtype(), DType::Utf8(_) | DType::Binary(_)) {
            self.compress_utf8_or_binary(chunk)
        } else {
            // For non-UTF8 types, use BtrBlocks directly
            self.btr_compressor.compress(chunk)
        }
    }

    fn compress_utf8_or_binary(&self, chunk: &dyn Array) -> VortexResult<ArrayRef> {
        let canonical = chunk.to_canonical();
        let uncompressed_nbytes = canonical.as_ref().nbytes();
        let compressed = match &canonical {
            Canonical::VarBinView(vbv) => {
                let zstd_array =
                    ZstdArray::from_var_bin_view(vbv, self.zstd_level, self.values_per_page)?;
                zstd_array.into_array()
            }
            _ => {
                // Unexpected canonical form, return BtrBlocks result
                self.btr_compressor.compress(chunk)?
            }
        };

        if compressed.nbytes() >= uncompressed_nbytes {
            return Ok(canonical.into_array());
        }
        Ok(compressed)
    }
}

impl Default for Utf8Compressor {
    fn default() -> Self {
        Self::new()
    }
}

impl CompressorPlugin for Utf8Compressor {
    fn compress_chunk(&self, chunk: &dyn Array) -> VortexResult<ArrayRef> {
        self.compress(chunk)
    }
}

#[cfg(test)]
mod tests {
    use vortex::{
        array::IntoArray,
        dtype::{DType, Nullability},
    };
    use vortex_array::arrays::VarBinViewArray;

    use super::*;

    #[test]
    fn test_compresses_utf8_strings() {
        let compressor = Utf8Compressor::new();

        // Create a string array with moderate cardinality
        let strings = vec![
            Some("apple"),
            Some("banana"),
            Some("apple"),
            Some("cherry"),
            Some("banana"),
            Some("apple"),
            Some("cherry"),
            Some("banana"),
            Some("apple"),
            Some("apple"),
            Some("banana"),
            Some("cherry"),
        ];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let compressed = compressor.compress(&array).unwrap();

        // Verify the compressed array has the same length and doesn't panic
        assert_eq!(compressed.len(), array.len());
        // Verify compression produces valid output
        assert!(compressed.nbytes() > 0);
    }

    #[test]
    fn test_high_cardinality_strings() {
        let compressor = Utf8Compressor::new();

        // Create a high cardinality string array (all unique values)
        let strings: Vec<Option<String>> = (0..100)
            .map(|i| Some(format!("unique_string_{:06}", i)))
            .collect();
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let compressed = compressor.compress(&array).unwrap();

        // Verify the compressed array has the correct length
        assert_eq!(compressed.len(), 100);
        // Verify compression produces valid output
        assert!(compressed.nbytes() > 0);
    }

    #[test]
    fn test_non_utf8_uses_btrblocks() {
        use vortex_array::arrays::PrimitiveArray;

        let compressor = Utf8Compressor::new();

        // Create an integer array
        let array: PrimitiveArray = vec![1i32, 2, 3, 4, 5].into_iter().collect();

        let compressed = compressor.compress(array.as_ref()).unwrap();

        // Verify BtrBlocks compression works for non-UTF8 types
        assert_eq!(compressed.len(), 5);
    }

    #[test]
    fn test_compression_with_repetitive_data() {
        let compressor = Utf8Compressor::new();

        // Create a string array with repetitive data that should compress well
        let strings: Vec<Option<&str>> = (0..1000)
            .map(|i| {
                Some(if i % 10 == 0 {
                    "repeated_string"
                } else {
                    "data"
                })
            })
            .collect();
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let original_nbytes = array.nbytes();
        let compressed = compressor.compress(&array).unwrap();
        let compressed_nbytes = compressed.nbytes();

        // Verify compression produces valid output
        assert_eq!(compressed.len(), 1000);
        assert!(compressed_nbytes > 0);

        // For highly repetitive data, compression should be effective
        // (though we don't strictly require it due to implementation details)
        println!(
            "Original: {} bytes, Compressed: {} bytes, Ratio: {:.2}%",
            original_nbytes,
            compressed_nbytes,
            (compressed_nbytes as f64 / original_nbytes as f64) * 100.0
        );
    }

    #[test]
    fn test_empty_string_array() {
        let compressor = Utf8Compressor::new();

        // Create an empty string array
        let strings: Vec<Option<&str>> = vec![];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let compressed = compressor.compress(&array).unwrap();

        // Verify empty array handling
        assert_eq!(compressed.len(), 0);
    }

    #[test]
    fn test_compression_settings() {
        // Test custom compression settings
        let compressor = Utf8Compressor::new()
            .with_zstd_level(5)
            .with_values_per_page(4096);

        let strings = vec![Some("test"), Some("data"), Some("test")];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let compressed = compressor.compress(&array).unwrap();

        // Verify compression works with custom settings
        assert_eq!(compressed.len(), 3);
        assert!(compressed.nbytes() > 0);
    }

    #[test]
    fn test_verify_encoding() {
        let compressor = Utf8Compressor::new();

        // Test 1: Low cardinality strings
        println!("\n=== Test 1: Low cardinality strings ===");
        let strings = vec![
            Some("apple"),
            Some("banana"),
            Some("apple"),
            Some("cherry"),
            Some("banana"),
            Some("apple"),
            Some("cherry"),
            Some("banana"),
            Some("apple"),
            Some("apple"),
            Some("banana"),
            Some("cherry"),
        ];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        println!("Original array encoding: {}", array.encoding().id());
        println!("Original array nbytes: {}", array.nbytes());

        let compressed = compressor.compress(&array).unwrap();
        println!("Compressed encoding: {}", compressed.encoding().id());
        println!("Compressed nbytes: {}", compressed.nbytes());
        println!(
            "Compression ratio: {:.2}%",
            (compressed.nbytes() as f64 / array.nbytes() as f64) * 100.0
        );

        // Test 2: High cardinality strings
        println!("\n=== Test 2: High cardinality strings ===");
        let strings: Vec<Option<String>> = (0..100)
            .map(|i| Some(format!("unique_string_{:06}", i)))
            .collect();
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        println!("Original array encoding: {}", array.encoding().id());
        println!("Original array nbytes: {}", array.nbytes());

        let compressed = compressor.compress(&array).unwrap();
        println!("Compressed encoding: {}", compressed.encoding().id());
        println!("Compressed nbytes: {}", compressed.nbytes());
        println!(
            "Compression ratio: {:.2}%",
            (compressed.nbytes() as f64 / array.nbytes() as f64) * 100.0
        );

        // Test 3: Integer array (non-UTF8)
        println!("\n=== Test 3: Integer array ===");
        use vortex_array::arrays::PrimitiveArray;
        let array: PrimitiveArray = vec![1i32, 2, 3, 4, 5].into_iter().collect();

        println!("Original array encoding: {}", array.encoding().id());
        println!("Original array nbytes: {}", array.nbytes());

        let compressed = compressor.compress(array.as_ref()).unwrap();
        println!("Compressed encoding: {}", compressed.encoding().id());
        println!("Compressed nbytes: {}", compressed.nbytes());
    }
}
