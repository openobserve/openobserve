use std::collections::HashSet;
/// Mapping of projection expression to underlying columns
#[derive(Debug, Clone)]
pub struct ProjectionColumnMapping {
    /// The output field name (alias if present, otherwise expression string)
    pub output_field: String,
    /// The projection expression as string (for context/debugging)
    pub projection_expr: String,
    /// Set of underlying column names that contribute to this projection
    pub source_columns: HashSet<String>,
}
