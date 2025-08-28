# Query Optimizer CLI Tool

## Overview

The Query Optimizer is an enterprise feature of OpenObserve that analyzes query patterns from the `_meta` organization to provide intelligent recommendations for improving query performance and stream settings. It examines queries fired from alerts, pipelines, and other automated systems across all organizations to identify optimization opportunities.

**Note:** This feature is only available in the enterprise version of OpenObserve and requires the enterprise build.

## How It Works

The Query Optimizer follows a 5-stage analysis process:

1. **Data Collection**: Retrieves query usage data from the `_meta` organization's usage stream
2. **Query Analysis**: Analyzes SQL queries to identify column usage patterns and operators
3. **Stream Settings Retrieval**: Fetches current stream configurations and settings
4. **Recommendation Generation**: Compares usage patterns against current settings to generate recommendations
5. **Ingestion**: Stores recommendations back into the `_meta` organization for consumption

## Command Usage

### Basic Syntax

```bash
./openobserve query-optimiser \
  --url <OPENOBSERVE_URL> \
  --token <AUTH_TOKEN> \
  --duration <HOURS> \
  [OPTIONS]
```

### Required Parameters

- `--url (-u)`: OpenObserve instance URL (e.g., `https://your-instance.com`)
- `--token (-t)`: Authentication token for your organization
- `--duration (-d)`: Analysis duration in hours (how far back to analyze queries)

### Optional Parameters

- `--meta-token (-m)`: Separate token for accessing `_meta` organization (defaults to `--token`)
- `--stream-name (-s)`: Focus analysis on a specific stream
- `--top-x (-x)`: Number of top streams to analyze for distinct values (default: 5)
- `--org-id (-o)`: Target organization ID (default: "default")

### Examples

#### Analyze all queries from the last 24 hours
```bash
./openobserve query-optimiser \
  --url https://your-openobserve.com \
  --token "your-auth-token" \
  --duration 24
```

#### Focus on a specific stream for the last 12 hours
```bash
./openobserve query-optimiser \
  --url https://your-openobserve.com \
  --token "your-auth-token" \
  --duration 12 \
  --stream-name "logs" \
  --top-x 10
```

#### Use separate tokens for different organizations
```bash
./openobserve query-optimiser \
  --url https://your-openobserve.com \
  --token "org-token" \
  --meta-token "meta-org-token" \
  --duration 48 \
  --org-id "production"
```

## Recommendation Types

The optimizer generates three types of recommendations:

### 1. Query Optimization (`QueryOptimisation`)
- **Use `str_match`**: When a column is configured as a secondary index but queries are not using `str_match`, `=`, or `IN` operators
- **Use `match_all`**: When a column is configured for full-text search but queries are not using `match_all`

### 2. Secondary Index Settings (`SecondaryIndexStreamSettings`)
- **Enable secondary index**: When columns frequently use `=`, `IN`, or `str_match` operators but are not configured as secondary indexes

### 3. Full-Text Search Settings (`FTSStreamSettings`)
- **Enable full-text search**: When columns frequently use `LIKE` or `REGEX` operators but are not configured for full-text search

## Prerequisites

### Access Requirements
- Access to `_meta` organization data
- Valid authentication tokens
- Network connectivity to OpenObserve instance

### Data Requirements
The optimizer analyzes data from the `usage` stream in the `_meta` organization, specifically:
- Search events (`event = 'Search'`)
- Non-UI searches (`search_type != 'ui'`)
- Query patterns from alerts, pipelines, and API calls

## Output and Results

### Console Output
The tool provides detailed logging showing:
- Number of queries analyzed
- Analysis progress through each stage
- Specific recommendations for each stream
- Success/failure status of recommendation ingestion

### Stored Recommendations
Recommendations are automatically ingested into the `_meta` organization under the `query_recommendations` stream and can be:
- Viewed through the OpenObserve UI
- Queried programmatically via API
- Used to guide manual optimizations

### Sample Recommendation Output
```json
{
  "stream_name": "application_logs",
  "column_name": "user_id",
  "recommendation": "Enable secondary index for col user_id",
  "reason": "user_id: used operators [\"=\"] , occurrences 1500 of total 2000",
  "type": "SecondaryIndexStreamSettings",
  "all_operators": ["=", "IN"],
  "total_occurrences": 2000,
  "operator": ["="],
  "occurrences": 1500,
  "num_distinct_values": 450,
  "duration_hrs": 24
}
```

## Best Practices

### Frequency
- Run weekly or monthly for regular optimization
- Run after significant changes to query patterns
- Run before major deployments or traffic increases

### Analysis Duration
- Use 24-72 hours for regular analysis
- Use 7+ days for comprehensive optimization reviews
- Consider seasonal patterns in longer analyses

### Stream Selection
- Start with high-volume streams
- Focus on critical application streams
- Use `--stream-name` for targeted optimization

### Token Management
- Use dedicated service accounts for automation
- Ensure tokens have appropriate permissions
- Consider separate tokens for enhanced security

## Troubleshooting

### Common Issues

**No recommendations found**
- Check if queries exist in the specified time range
- Verify access to `_meta` organization
- Ensure non-UI queries are being logged

**Authentication failures**
- Verify token validity and permissions
- Check network connectivity
- Confirm organization access

**HTTP errors during ingestion**
- Verify meta-token permissions
- Check `_meta` organization access
- Review network connectivity

### Debugging

Enable detailed logging by setting the log level:
```bash
RUST_LOG=debug ./openobserve query-optimiser [OPTIONS]
```

### Validation

Verify recommendations were ingested by querying:
```sql
SELECT * FROM "query_recommendations" ORDER BY _timestamp DESC LIMIT 10
```

### Monitoring
Set up alerts on recommendation generation to track optimization opportunities:
- Monitor recommendation volume
- Track implementation of suggestions
- Measure query performance improvements

## Limitations

- Enterprise feature only
- Requires access to `_meta` organization
- Analyzes only non-UI search queries
- Recommendations are suggestions, not automatic implementations
- Performance impact depends on query volume and analysis duration