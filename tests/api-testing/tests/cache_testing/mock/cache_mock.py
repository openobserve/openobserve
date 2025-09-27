"""
Cache Mock System - DRY Mock Implementation
Centralized mock system for reliable cache testing in CI/CD environments.
"""
import time
import random
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass


@dataclass
class MockCacheConfig:
    """Configuration for mock cache behavior."""
    result_cache_enabled: bool = True
    file_cache_enabled: bool = True
    result_cache_progression: List[int] = None  # [0, 50, 90, 95]
    file_cache_progression: List[int] = None   # [0, 80, 100, 100]
    response_time_progression: List[int] = None  # [1500, 800, 200, 150]
    enable_randomization: bool = True
    randomization_factor: float = 0.1  # ±10% variance


class CacheMock:
    """Unified mock system for cache testing."""
    
    def __init__(self, config: MockCacheConfig = None):
        self.config = config or MockCacheConfig()
        self.query_count = {}  # Track queries for progression
        self.mock_streams = {
            "mock_cache_test_stream": {
                "total_records": 15000,
                "time_range_hours": 24,
                "has_sufficient_data": True,
                "supports_result_cache": True,  # Enable result cache for this stream
                "cache_friendly_queries": True
            },
            "mock_small_stream": {
                "total_records": 500,
                "time_range_hours": 2,
                "has_sufficient_data": False,
                "supports_result_cache": False,
                "cache_friendly_queries": False
            },
            "mock_production_like": {
                "total_records": 1000000,
                "time_range_hours": 168,  # 1 week
                "has_sufficient_data": True,
                "supports_result_cache": True,
                "cache_friendly_queries": True
            }
        }
        self._setup_default_progressions()
    
    def _setup_default_progressions(self):
        """Setup default cache progression patterns."""
        if self.config.result_cache_progression is None:
            self.config.result_cache_progression = [0, 25, 60, 85, 95]  # Better result cache progression
        
        if self.config.file_cache_progression is None:
            self.config.file_cache_progression = [0, 70, 95, 100, 100]  # Faster to warm up
        
        if self.config.response_time_progression is None:
            self.config.response_time_progression = [2000, 1200, 400, 250, 200]  # Improving performance
    
    def mock_cache_response(self, stream: str, sql: str, start_time: int, end_time: int, 
                          use_cache: bool = True, iteration: int = None) -> Dict[str, Any]:
        """
        Generate mock cache response based on realistic patterns.
        
        Args:
            stream: Stream name
            sql: SQL query
            start_time: Start time in microseconds
            end_time: End time in microseconds
            use_cache: Whether caching is enabled
            iteration: Query iteration number (for progression)
            
        Returns:
            Mock response with realistic cache behavior
        """
        # Generate query key for tracking
        query_key = f"{stream}_{sql[:50]}_{start_time}_{end_time}"
        
        # Track query count for progression
        if query_key not in self.query_count:
            self.query_count[query_key] = 0
        self.query_count[query_key] += 1
        
        # Use explicit iteration if provided, otherwise use query count
        query_iteration = iteration if iteration is not None else self.query_count[query_key]
        
        # Get stream characteristics
        stream_info = self.mock_streams.get(stream, {
            "total_records": 1000,
            "time_range_hours": 4,
            "has_sufficient_data": False
        })
        
        # Determine cache behavior based on stream and iteration
        if not use_cache:
            return self._create_no_cache_response(stream_info)
        
        # Generate cache ratios based on progression and stream characteristics
        supports_result_cache = stream_info.get("supports_result_cache", False)
        result_cache_ratio = self._get_progression_value(
            self.config.result_cache_progression, 
            query_iteration, 
            stream_info["has_sufficient_data"] and supports_result_cache
        )
        
        file_cache_ratio = self._get_progression_value(
            self.config.file_cache_progression, 
            query_iteration, 
            stream_info["has_sufficient_data"]
        )
        
        # Get response time with cache improvement
        base_time = self._get_progression_value(
            self.config.response_time_progression,
            query_iteration,
            True  # Time always improves with cache
        )
        
        # Apply randomization if enabled
        if self.config.enable_randomization:
            result_cache_ratio = self._add_randomization(result_cache_ratio, 5)  # ±5%
            file_cache_ratio = self._add_randomization(file_cache_ratio, 3)    # ±3%
            base_time = self._add_randomization(base_time, int(base_time * self.config.randomization_factor))
        
        # Create realistic response
        return self._create_realistic_response(
            result_cache_ratio=result_cache_ratio,
            file_cache_ratio=file_cache_ratio,
            response_time=base_time,
            stream_info=stream_info,
            query_iteration=query_iteration,
            stream=stream,
            sql=sql,
            start_time=start_time,
            end_time=end_time
        )
    
    def mock_production_cache_response(self, stream: str = "otlp-production") -> Dict[str, Any]:
        """
        Mock production-like cache response with high cache effectiveness.
        Based on real production behavior we observed.
        """
        return {
            'status_code': 200,
            'success': True,
            'result_cache_ratio': 0,  # Production typically shows 0% for result cache
            'cached_ratio': 100,      # But 100% for file cache
            'took': 89,              # Fast response due to cache
            'total': 1847639,        # Large dataset
            'hits': [],
            'scan_size': 0,          # No scanning due to cache
            'scan_records': 0,       # No records scanned
            'took_detail': {
                'total': 89,
                'wait_queue': 0,
                'cluster_search': 89,
                'result_cache_read': 0,
                'result_cache_write': 0
            },
            'client_time_ms': 150,
            'endpoint_type': 'production_mock',
            'stream_name': stream
        }
    
    def _get_progression_value(self, progression: List[int], iteration: int, 
                             has_sufficient_data: bool) -> int:
        """Get value from progression based on iteration."""
        if not has_sufficient_data:
            return 0  # No cache for insufficient data
        
        if iteration <= 0:
            return 0
        
        # Clamp iteration to progression length
        index = min(iteration - 1, len(progression) - 1)
        return progression[index]
    
    def _add_randomization(self, value: int, variance: int) -> int:
        """Add randomization to a value within variance bounds."""
        if variance == 0:
            return value
        
        min_variance = max(-variance, -value)  # Don't go negative
        max_variance = variance
        
        random_offset = random.randint(min_variance, max_variance)
        return max(0, min(100, value + random_offset))  # Keep in valid range
    
    def _create_realistic_response(self, result_cache_ratio: int, file_cache_ratio: int,
                                 response_time: int, stream_info: Dict[str, Any],
                                 query_iteration: int, stream: str, sql: str, 
                                 start_time: int, end_time: int) -> Dict[str, Any]:
        """Create realistic mock response with consistent data."""
        
        # Calculate scan metrics based on cache effectiveness
        base_scan_size = stream_info["total_records"] * 100  # Approximate bytes per record
        base_scan_records = stream_info["total_records"]
        
        # Reduce scanning based on cache effectiveness
        cache_effectiveness = max(result_cache_ratio, file_cache_ratio) / 100
        actual_scan_size = int(base_scan_size * (1 - cache_effectiveness))
        actual_scan_records = int(base_scan_records * (1 - cache_effectiveness))
        
        # Generate took_detail based on cache behavior
        took_detail = {
            'total': response_time,
            'wait_queue': random.randint(0, 5),
            'cluster_search': response_time - random.randint(0, 10),
            'result_cache_read': result_cache_ratio * 2 if result_cache_ratio > 0 else 0,
            'result_cache_write': 5 if result_cache_ratio == 0 and query_iteration == 1 else 0
        }
        
        return {
            'status_code': 200,
            'success': True,
            'result_cache_ratio': result_cache_ratio,
            'cached_ratio': file_cache_ratio,
            'took': response_time,
            'total': stream_info["total_records"],
            'hits': self._generate_mock_hits(
                count=min(10, stream_info["total_records"]),
                stream_name=stream,
                query_key=f"{sql}_{start_time}_{end_time}"
            ),
            'scan_size': actual_scan_size,
            'scan_records': actual_scan_records,
            'took_detail': took_detail,
            'client_time_ms': response_time + random.randint(10, 50),
            'endpoint_type': 'mock',
            'query_iteration': query_iteration,
            'stream_name': stream_info.get('name', 'mock_stream'),
            'cache_effectiveness': f"{max(result_cache_ratio, file_cache_ratio)}%"
        }
    
    def _create_no_cache_response(self, stream_info: Dict[str, Any]) -> Dict[str, Any]:
        """Create response when caching is disabled."""
        response_time = random.randint(1000, 3000)  # Slower without cache
        
        return {
            'status_code': 200,
            'success': True,
            'result_cache_ratio': 0,
            'cached_ratio': 0,
            'took': response_time,
            'total': stream_info["total_records"],
            'hits': self._generate_mock_hits(
                count=min(10, stream_info["total_records"]),
                stream_name="no_cache_stream",
                query_key="no_cache_query"
            ),
            'scan_size': stream_info["total_records"] * 100,
            'scan_records': stream_info["total_records"],
            'took_detail': {
                'total': response_time,
                'wait_queue': random.randint(0, 10),
                'cluster_search': response_time - random.randint(0, 20)
            },
            'client_time_ms': response_time + random.randint(20, 100),
            'endpoint_type': 'no_cache_mock'
        }
    
    def _generate_mock_hits(self, count: int, stream_name: str = "mock", query_key: str = "") -> List[Dict[str, Any]]:
        """Generate consistent mock log hits for response."""
        hits = []
        
        # Use query_key to ensure consistent data across cache states
        seed_value = hash(f"{stream_name}_{query_key}") % 10000
        original_state = random.getstate()  # Save random state
        random.seed(seed_value)  # Consistent random data
        
        base_time = int(time.time() * 1000000) - (2 * 24 * 3600 * 1000000)  # 2 days ago
        
        for i in range(count):
            hit_time = base_time + (i * 60 * 1000000)  # 1 minute apart
            hits.append({
                '_timestamp': hit_time,
                'level': random.choice(['INFO', 'DEBUG', 'WARN', 'ERROR']),
                'message': f'Mock log message {i + 1} from {stream_name}',
                'source': 'cache_test',
                'record_id': f'cache_record_{seed_value}_{i}',
                'query_context': query_key[:16] if query_key else 'default'
            })
        
        # Restore random state to avoid affecting other tests
        random.setstate(original_state)
        
        return hits
    
    def get_mock_stream_info(self, stream_name: str) -> Dict[str, Any]:
        """Get information about a mock stream."""
        return self.mock_streams.get(stream_name, {
            "error": f"Mock stream '{stream_name}' not found",
            "available_streams": list(self.mock_streams.keys())
        })
    
    def add_mock_stream(self, stream_name: str, total_records: int, 
                       time_range_hours: int, has_sufficient_data: bool = None):
        """Add a new mock stream configuration."""
        if has_sufficient_data is None:
            has_sufficient_data = total_records > 5000  # Auto-determine based on volume
        
        self.mock_streams[stream_name] = {
            "total_records": total_records,
            "time_range_hours": time_range_hours,
            "has_sufficient_data": has_sufficient_data,
            "name": stream_name
        }
    
    def reset_query_tracking(self):
        """Reset query tracking for fresh test runs."""
        self.query_count.clear()


def create_cache_mock(config: MockCacheConfig = None) -> CacheMock:
    """Factory function to create cache mock."""
    return CacheMock(config)