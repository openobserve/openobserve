"""
Cache Hits Consistency Validator
Validates that query results (hits) remain consistent between cached and non-cached responses.
"""
import hashlib
import json
from typing import Dict, Any, List, Set, Optional, Tuple
from dataclasses import dataclass


@dataclass
class HitsValidationResult:
    """Result of hits consistency validation."""
    consistent: bool
    total_hits_baseline: int
    total_hits_cached: int
    missing_records: List[Dict[str, Any]]
    extra_records: List[Dict[str, Any]]
    field_mismatches: List[Dict[str, str]]
    data_integrity_score: float
    errors: List[str]
    warnings: List[str]


class CacheHitsValidator:
    """Validates consistency of hits data across cache states."""
    
    def __init__(self, ignore_fields: List[str] = None):
        """
        Initialize hits validator.
        
        Args:
            ignore_fields: Fields to ignore during comparison (e.g., timestamps, internal IDs)
        """
        self.ignore_fields = ignore_fields or ['_timestamp', 'zo_sql_timestamp', '_id']
        
    def validate_hits_consistency(self, baseline_response: Dict[str, Any], 
                                cached_response: Dict[str, Any]) -> HitsValidationResult:
        """
        Validate that hits data is consistent between baseline (0% cache) and cached responses.
        
        Args:
            baseline_response: Response when result_cache_ratio = 0%
            cached_response: Response when result_cache_ratio > 0%
            
        Returns:
            HitsValidationResult with consistency analysis
        """
        baseline_hits = baseline_response.get('hits', [])
        cached_hits = cached_response.get('hits', [])
        
        errors = []
        warnings = []
        
        # Basic count validation
        if len(baseline_hits) != len(cached_hits):
            errors.append(f"Hits count mismatch: baseline={len(baseline_hits)}, cached={len(cached_hits)}")
        
        # Create normalized versions for comparison
        baseline_normalized = self._normalize_hits(baseline_hits)
        cached_normalized = self._normalize_hits(cached_hits)
        
        # Find missing and extra records
        missing_records = self._find_missing_records(baseline_normalized, cached_normalized)
        extra_records = self._find_missing_records(cached_normalized, baseline_normalized)
        
        # Field-level mismatches
        field_mismatches = self._find_field_mismatches(baseline_normalized, cached_normalized)
        
        # Calculate data integrity score
        total_records = max(len(baseline_hits), len(cached_hits), 1)
        issues_count = len(missing_records) + len(extra_records) + len(field_mismatches)
        data_integrity_score = max(0, (total_records - issues_count) / total_records)
        
        # Consistency determination
        consistent = (
            len(missing_records) == 0 and 
            len(extra_records) == 0 and 
            len(field_mismatches) == 0 and
            len(errors) == 0
        )
        
        # Generate warnings for near-misses
        if not consistent and data_integrity_score > 0.95:
            warnings.append(f"High integrity score ({data_integrity_score:.2%}) despite inconsistencies - check field differences")
        
        return HitsValidationResult(
            consistent=consistent,
            total_hits_baseline=len(baseline_hits),
            total_hits_cached=len(cached_hits),
            missing_records=missing_records,
            extra_records=extra_records,
            field_mismatches=field_mismatches,
            data_integrity_score=data_integrity_score,
            errors=errors,
            warnings=warnings
        )
    
    def validate_progression_consistency(self, responses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Validate hits consistency across a progression of cache responses.
        
        Args:
            responses: List of responses with increasing result_cache_ratio
            
        Returns:
            Analysis of consistency across the progression
        """
        if len(responses) < 2:
            return {"error": "Need at least 2 responses for progression validation"}
        
        # Use first response (should have result_cache_ratio = 0) as baseline
        baseline = responses[0]
        consistency_results = []
        
        for i, response in enumerate(responses[1:], 1):
            result = self.validate_hits_consistency(baseline, response)
            consistency_results.append({
                "iteration": i + 1,
                "result_cache_ratio": response.get('result_cache_ratio', 0),
                "consistency": result.consistent,
                "data_integrity_score": result.data_integrity_score,
                "errors": result.errors,
                "warnings": result.warnings
            })
        
        # Overall assessment
        all_consistent = all(r["consistency"] for r in consistency_results)
        avg_integrity_score = sum(r["data_integrity_score"] for r in consistency_results) / len(consistency_results)
        
        return {
            "overall_consistent": all_consistent,
            "average_integrity_score": avg_integrity_score,
            "progression_results": consistency_results,
            "baseline_hits_count": len(baseline.get('hits', [])),
            "recommendation": self._get_consistency_recommendation(all_consistent, avg_integrity_score)
        }
    
    def _normalize_hits(self, hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize hits data for comparison by removing/standardizing variable fields."""
        normalized = []
        
        for hit in hits:
            # Create a copy and remove ignored fields
            normalized_hit = {k: v for k, v in hit.items() if k not in self.ignore_fields}
            
            # Sort nested dictionaries for consistent comparison
            normalized_hit = self._sort_nested_dict(normalized_hit)
            normalized.append(normalized_hit)
        
        # Sort hits by a stable key (using hash of content)
        return sorted(normalized, key=lambda x: self._get_hit_hash(x))
    
    def _get_hit_hash(self, hit: Dict[str, Any]) -> str:
        """Generate a consistent hash for a hit record."""
        hit_str = json.dumps(hit, sort_keys=True, default=str)
        return hashlib.md5(hit_str.encode()).hexdigest()
    
    def _sort_nested_dict(self, obj: Any) -> Any:
        """Recursively sort nested dictionaries."""
        if isinstance(obj, dict):
            return {k: self._sort_nested_dict(v) for k, v in sorted(obj.items())}
        elif isinstance(obj, list):
            return [self._sort_nested_dict(item) for item in obj]
        else:
            return obj
    
    def _find_missing_records(self, reference_hits: List[Dict[str, Any]], 
                            comparison_hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Find records that exist in reference but not in comparison."""
        reference_hashes = {self._get_hit_hash(hit) for hit in reference_hits}
        comparison_hashes = {self._get_hit_hash(hit) for hit in comparison_hits}
        
        missing_hashes = reference_hashes - comparison_hashes
        
        # Return the actual records that are missing
        missing_records = []
        for hit in reference_hits:
            if self._get_hit_hash(hit) in missing_hashes:
                missing_records.append(hit)
        
        return missing_records
    
    def _find_field_mismatches(self, baseline_hits: List[Dict[str, Any]], 
                             cached_hits: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        """Find field-level mismatches between corresponding records."""
        mismatches = []
        
        # Create hash-to-record mapping for efficient lookup
        baseline_map = {self._get_hit_hash(hit): hit for hit in baseline_hits}
        cached_map = {self._get_hit_hash(hit): hit for hit in cached_hits}
        
        # Find records that exist in both but have different field values
        common_hashes = set(baseline_map.keys()) & set(cached_map.keys())
        
        for hit_hash in common_hashes:
            baseline_hit = baseline_map[hit_hash]
            cached_hit = cached_map[hit_hash]
            
            # This should rarely happen since hash is based on content
            # But check for subtle differences
            for field in set(baseline_hit.keys()) | set(cached_hit.keys()):
                if field not in self.ignore_fields:
                    baseline_val = baseline_hit.get(field)
                    cached_val = cached_hit.get(field)
                    
                    if baseline_val != cached_val:
                        mismatches.append({
                            "field": field,
                            "baseline_value": str(baseline_val),
                            "cached_value": str(cached_val),
                            "hit_identifier": hit_hash[:8]
                        })
        
        return mismatches
    
    def _get_consistency_recommendation(self, all_consistent: bool, avg_integrity_score: float) -> str:
        """Generate recommendation based on consistency analysis."""
        if all_consistent:
            return "✅ Cache hits are fully consistent across all queries"
        elif avg_integrity_score > 0.99:
            return "⚠️ Minor inconsistencies detected - investigate field mismatches"
        elif avg_integrity_score > 0.95:
            return "⚠️ Some data inconsistencies - check missing/extra records"
        elif avg_integrity_score > 0.90:
            return "❌ Significant cache inconsistencies - data integrity compromised"
        else:
            return "🚨 Critical cache inconsistency - cache may be returning wrong data"


def create_hits_validator(ignore_fields: List[str] = None) -> CacheHitsValidator:
    """Factory function to create hits validator."""
    return CacheHitsValidator(ignore_fields)