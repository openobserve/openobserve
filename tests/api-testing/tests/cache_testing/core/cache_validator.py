"""
Cache Validator - DRY Validation Logic
Centralized validation for all cache testing scenarios.
"""
import time
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class CacheValidationResult:
    """Standardized cache validation result."""
    passed: bool
    score: float  # 0.0 to 1.0
    details: Dict[str, Any]
    errors: List[str]
    warnings: List[str]


class CacheValidator:
    """Unified cache validation logic."""
    
    def __init__(self, strict_mode: bool = False):
        self.strict_mode = strict_mode
        self.validation_rules = {
            'field_presence': True,
            'field_types': True, 
            'field_ranges': True,
            'cache_progression': not strict_mode,  # Lenient in non-strict mode
            'performance_improvement': not strict_mode,
            'data_consistency': True
        }
    
    def validate_response_structure(self, response: Dict[str, Any]) -> CacheValidationResult:
        """Validate basic response structure."""
        errors = []
        warnings = []
        score = 1.0
        
        # Required fields
        required_fields = {
            'result_cache_ratio': int,
            'cached_ratio': int,
            'took': int,
            'success': bool,
            'status_code': int
        }
        
        for field, expected_type in required_fields.items():
            if field not in response:
                errors.append(f"Missing required field: {field}")
                score -= 0.2
            elif not isinstance(response[field], expected_type):
                errors.append(f"Field {field} has wrong type: expected {expected_type.__name__}, got {type(response[field]).__name__}")
                score -= 0.1
        
        # Field range validation
        if 'result_cache_ratio' in response:
            ratio = response['result_cache_ratio']
            if not (0 <= ratio <= 100):
                errors.append(f"result_cache_ratio out of range: {ratio} (should be 0-100)")
                score -= 0.2
        
        if 'cached_ratio' in response:
            ratio = response['cached_ratio']
            if not (0 <= ratio <= 100):
                errors.append(f"cached_ratio out of range: {ratio} (should be 0-100)")
                score -= 0.2
        
        # Success validation
        if not response.get('success', False):
            if response.get('status_code', 0) != 200:
                errors.append(f"Query failed with status: {response.get('status_code')}")
                score -= 0.5
        
        return CacheValidationResult(
            passed=len(errors) == 0,
            score=max(0.0, score),
            details={
                'required_fields_present': len([f for f in required_fields.keys() if f in response]),
                'total_required_fields': len(required_fields),
                'response_size': len(response),
                'has_cache_data': response.get('result_cache_ratio', 0) > 0 or response.get('cached_ratio', 0) > 0
            },
            errors=errors,
            warnings=warnings
        )
    
    def validate_cache_progression(self, responses: List[Dict[str, Any]]) -> CacheValidationResult:
        """Validate cache progression across multiple queries."""
        if len(responses) < 2:
            return CacheValidationResult(
                passed=False,
                score=0.0,
                details={},
                errors=["Need at least 2 responses for progression analysis"],
                warnings=[]
            )
        
        errors = []
        warnings = []
        score = 1.0
        
        # Extract cache ratios
        result_ratios = [r.get('result_cache_ratio', 0) for r in responses]
        file_ratios = [r.get('cached_ratio', 0) for r in responses]
        response_times = [r.get('took', 0) for r in responses]
        
        # Analyze progression
        result_improved = result_ratios[-1] > result_ratios[0]
        file_improved = file_ratios[-1] > file_ratios[0]
        time_improved = response_times[-1] < response_times[0]
        
        # Cache activity detection
        max_result_cache = max(result_ratios)
        max_file_cache = max(file_ratios)
        
        if max_result_cache == 0 and max_file_cache == 0:
            if self.strict_mode:
                errors.append("No cache activity detected in any query")
                score -= 0.5
            else:
                warnings.append("No cache activity detected - may be expected with test data")
        
        # Progression analysis
        if max_result_cache > 0 or max_file_cache > 0:
            if result_improved or file_improved:
                score += 0.2  # Bonus for cache improvement
            if time_improved and (result_improved or file_improved):
                score += 0.3  # Bonus for performance + cache correlation
        
        # Consistency check
        if len(set(result_ratios[1:])) > 3:  # High variance in cache ratios
            warnings.append("High variance in cache ratios after first query")
        
        return CacheValidationResult(
            passed=len(errors) == 0,
            score=min(1.0, score),
            details={
                'result_cache_progression': result_ratios,
                'file_cache_progression': file_ratios,
                'response_time_progression': response_times,
                'result_cache_improved': result_improved,
                'file_cache_improved': file_improved,
                'performance_improved': time_improved,
                'max_result_cache': max_result_cache,
                'max_file_cache': max_file_cache,
                'queries_analyzed': len(responses)
            },
            errors=errors,
            warnings=warnings
        )
    
    def validate_cache_types(self, response: Dict[str, Any]) -> CacheValidationResult:
        """Validate both result cache and file cache behavior."""
        errors = []
        warnings = []
        score = 1.0
        
        result_cache = response.get('result_cache_ratio', 0)
        file_cache = response.get('cached_ratio', 0)
        took = response.get('took', 0)
        scan_size = response.get('scan_size', 0)
        scan_records = response.get('scan_records', 0)
        
        details = {
            'result_cache_active': result_cache > 0,
            'file_cache_active': file_cache > 0,
            'any_cache_active': result_cache > 0 or file_cache > 0,
            'result_cache_ratio': result_cache,
            'file_cache_ratio': file_cache,
            'cache_efficiency': 'none'
        }
        
        # Determine cache efficiency
        if result_cache >= 90:
            details['cache_efficiency'] = 'excellent_result_cache'
        elif file_cache >= 90:
            details['cache_efficiency'] = 'excellent_file_cache'
        elif result_cache >= 50:
            details['cache_efficiency'] = 'good_result_cache'
        elif file_cache >= 50:
            details['cache_efficiency'] = 'good_file_cache'
        elif result_cache > 0 or file_cache > 0:
            details['cache_efficiency'] = 'partial_cache'
        
        # Validate cache performance correlation
        if file_cache > 80 and scan_size == 0:
            score += 0.2  # File cache is working properly
        elif file_cache > 80 and scan_size > 0:
            warnings.append("High file cache but still scanning data - unexpected")
        
        if result_cache > 80 and scan_records == 0:
            score += 0.3  # Result cache is working properly
        elif result_cache > 80 and scan_records > 0:
            warnings.append("High result cache but still scanning records - unexpected")
        
        # Performance expectations
        if file_cache > 50 and took > 1000:  # > 1 second with cache
            warnings.append("Slow response despite file cache - may indicate issues")
        
        if result_cache > 50 and took > 500:  # > 500ms with result cache
            warnings.append("Slow response despite result cache - may indicate issues")
        
        return CacheValidationResult(
            passed=len(errors) == 0,
            score=min(1.0, score),
            details=details,
            errors=errors,
            warnings=warnings
        )
    
    def validate_production_cache(self, responses: List[Dict[str, Any]], 
                                stream_name: str) -> CacheValidationResult:
        """Comprehensive validation for production cache scenarios."""
        if not responses:
            return CacheValidationResult(
                passed=False, score=0.0, details={}, 
                errors=["No responses to validate"], warnings=[]
            )
        
        # Run individual validations
        structure_results = [self.validate_response_structure(r) for r in responses]
        progression_result = self.validate_cache_progression(responses)
        cache_type_results = [self.validate_cache_types(r) for r in responses]
        
        # Aggregate results
        errors = []
        warnings = []
        
        for i, result in enumerate(structure_results):
            if not result.passed:
                errors.extend([f"Response {i+1}: {e}" for e in result.errors])
            warnings.extend([f"Response {i+1}: {w}" for w in result.warnings])
        
        errors.extend(progression_result.errors)
        warnings.extend(progression_result.warnings)
        
        for i, result in enumerate(cache_type_results):
            warnings.extend([f"Response {i+1}: {w}" for w in result.warnings])
        
        # Calculate overall score
        structure_score = sum(r.score for r in structure_results) / len(structure_results)
        progression_score = progression_result.score
        cache_type_score = sum(r.score for r in cache_type_results) / len(cache_type_results)
        
        overall_score = (structure_score + progression_score + cache_type_score) / 3
        
        # Determine if production cache is working
        max_file_cache = max(r.get('cached_ratio', 0) for r in responses)
        max_result_cache = max(r.get('result_cache_ratio', 0) for r in responses)
        
        cache_working = max_file_cache > 50 or max_result_cache > 10
        
        return CacheValidationResult(
            passed=len(errors) == 0 and cache_working,
            score=overall_score,
            details={
                'stream_name': stream_name,
                'total_queries': len(responses),
                'structure_score': structure_score,
                'progression_score': progression_score,
                'cache_type_score': cache_type_score,
                'max_result_cache': max_result_cache,
                'max_file_cache': max_file_cache,
                'cache_working': cache_working,
                'primary_cache_type': 'result' if max_result_cache > max_file_cache else 'file'
            },
            errors=errors,
            warnings=warnings
        )


def create_cache_validator(strict_mode: bool = False) -> CacheValidator:
    """Factory function to create cache validator."""
    return CacheValidator(strict_mode)