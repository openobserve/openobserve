"""
Response Builder - DRY Response Construction
Centralized response building for consistent mock responses.
"""
import time
import json
import random
from typing import Dict, Any, List, Optional, Union


class ResponseBuilder:
    """Unified response builder for cache testing."""
    
    def __init__(self):
        self.default_headers = {
            'content-type': 'application/json',
            'x-cache-status': 'mock'
        }
        self.response_templates = self._initialize_templates()
    
    def _initialize_templates(self) -> Dict[str, Dict[str, Any]]:
        """Initialize response templates for different scenarios."""
        return {
            'success_with_cache': {
                'status_code': 200,
                'success': True,
                'result_cache_ratio': 75,
                'cached_ratio': 90,
                'took': 250,
                'total': 10000,
                'hits': [],
                'scan_size': 1000,
                'scan_records': 100,
                'took_detail': {
                    'total': 250,
                    'wait_queue': 2,
                    'cluster_search': 245,
                    'result_cache_read': 150,
                    'result_cache_write': 0
                }
            },
            'success_no_cache': {
                'status_code': 200,
                'success': True,
                'result_cache_ratio': 0,
                'cached_ratio': 0,
                'took': 1500,
                'total': 10000,
                'hits': [],
                'scan_size': 100000,
                'scan_records': 10000,
                'took_detail': {
                    'total': 1500,
                    'wait_queue': 5,
                    'cluster_search': 1490,
                    'result_cache_read': 0,
                    'result_cache_write': 20
                }
            },
            'file_cache_only': {
                'status_code': 200,
                'success': True,
                'result_cache_ratio': 0,
                'cached_ratio': 100,
                'took': 89,
                'total': 1000000,
                'hits': [],
                'scan_size': 0,
                'scan_records': 0,
                'took_detail': {
                    'total': 89,
                    'wait_queue': 0,
                    'cluster_search': 89,
                    'result_cache_read': 0,
                    'result_cache_write': 0
                }
            },
            'error_response': {
                'status_code': 500,
                'success': False,
                'error': 'Mock error for testing',
                'result_cache_ratio': 0,
                'cached_ratio': 0,
                'took': 0,
                'total': 0,
                'hits': []
            }
        }
    
    def build_cache_response(self, template: str = 'success_with_cache', 
                           overrides: Dict[str, Any] = None,
                           add_randomization: bool = True) -> Dict[str, Any]:
        """
        Build a cache response using template and overrides.
        
        Args:
            template: Template name to use as base
            overrides: Dictionary of values to override in template
            add_randomization: Whether to add realistic randomization
            
        Returns:
            Complete response dictionary
        """
        if template not in self.response_templates:
            template = 'success_with_cache'  # Default fallback
        
        # Start with template
        response = self.response_templates[template].copy()
        
        # Apply overrides
        if overrides:
            response.update(overrides)
        
        # Add randomization for realism
        if add_randomization and response.get('success', True):
            response = self._add_realistic_randomization(response)
        
        # Add standard fields
        response.update({
            'client_time_ms': response.get('took', 0) + random.randint(10, 50),
            'endpoint_type': 'mock_response',
            'timestamp': int(time.time() * 1000000),
            'mock_template': template
        })
        
        return response
    
    def build_streaming_response(self, data: Dict[str, Any]) -> str:
        """
        Build streaming response format (Server-Sent Events).
        
        Args:
            data: Response data to format as streaming
            
        Returns:
            SSE formatted string
        """
        sse_response = f"data: {json.dumps(data)}\\n\\n"
        return sse_response
    
    def build_progression_responses(self, iterations: int = 5, 
                                  progression_type: str = 'cache_warming') -> List[Dict[str, Any]]:
        """
        Build a series of responses showing cache progression.
        
        Args:
            iterations: Number of responses to generate
            progression_type: Type of progression ('cache_warming', 'performance_improvement', 'stable_cache')
            
        Returns:
            List of responses showing progression
        """
        responses = []
        
        if progression_type == 'cache_warming':
            # Simulate cache warming up over time
            for i in range(iterations):
                result_cache = min(85, i * 20)  # 0, 20, 40, 60, 80
                file_cache = min(100, (i + 1) * 25)  # 25, 50, 75, 100, 100
                response_time = max(150, 2000 - (i * 400))  # 2000, 1600, 1200, 800, 400
                
                response = self.build_cache_response('success_with_cache', {
                    'result_cache_ratio': result_cache,
                    'cached_ratio': file_cache,
                    'took': response_time,
                    'iteration': i + 1
                })
                responses.append(response)
        
        elif progression_type == 'performance_improvement':
            # Focus on response time improvement
            base_time = 1800
            for i in range(iterations):
                improvement_factor = 0.6 ** i  # Exponential improvement
                response_time = int(base_time * improvement_factor)
                cache_ratio = min(95, i * 25)
                
                response = self.build_cache_response('success_with_cache', {
                    'result_cache_ratio': cache_ratio,
                    'cached_ratio': min(100, cache_ratio + 10),
                    'took': response_time,
                    'iteration': i + 1
                })
                responses.append(response)
        
        elif progression_type == 'stable_cache':
            # Simulate stable cache after warmup
            for i in range(iterations):
                # Stable high cache ratios with minor variations
                result_cache = 80 + random.randint(-5, 5)
                file_cache = 95 + random.randint(-3, 5)
                response_time = 200 + random.randint(-50, 50)
                
                response = self.build_cache_response('success_with_cache', {
                    'result_cache_ratio': max(0, result_cache),
                    'cached_ratio': min(100, file_cache),
                    'took': max(100, response_time),
                    'iteration': i + 1
                })
                responses.append(response)
        
        return responses
    
    def build_error_response(self, status_code: int = 500, 
                           error_message: str = "Internal server error",
                           include_cache_fields: bool = True) -> Dict[str, Any]:
        """
        Build error response for testing error scenarios.
        
        Args:
            status_code: HTTP status code
            error_message: Error message to include
            include_cache_fields: Whether to include cache fields (set to 0)
            
        Returns:
            Error response dictionary
        """
        response = {
            'status_code': status_code,
            'success': False,
            'error': error_message,
            'client_time_ms': random.randint(50, 200),
            'endpoint_type': 'error_mock'
        }
        
        if include_cache_fields:
            response.update({
                'result_cache_ratio': 0,
                'cached_ratio': 0,
                'took': 0,
                'total': 0,
                'hits': [],
                'scan_size': 0,
                'scan_records': 0
            })
        
        return response
    
    def build_production_like_response(self, stream_name: str = "otlp-production",
                                     cache_scenario: str = "high_file_cache") -> Dict[str, Any]:
        """
        Build production-like response based on real observations.
        
        Args:
            stream_name: Name of the production stream
            cache_scenario: Scenario to simulate
            
        Returns:
            Production-like response
        """
        scenarios = {
            'high_file_cache': {
                'result_cache_ratio': 0,
                'cached_ratio': 100,
                'took': 89,
                'total': 1847639,
                'scan_size': 0,
                'scan_records': 0
            },
            'partial_file_cache': {
                'result_cache_ratio': 0,
                'cached_ratio': 65,
                'took': 456,
                'total': 892341,
                'scan_size': 35000000,
                'scan_records': 350000
            },
            'no_cache_production': {
                'result_cache_ratio': 0,
                'cached_ratio': 0,
                'took': 2145,
                'total': 2341567,
                'scan_size': 234000000,
                'scan_records': 2341567
            }
        }
        
        scenario_data = scenarios.get(cache_scenario, scenarios['high_file_cache'])
        
        return self.build_cache_response('file_cache_only', {
            **scenario_data,
            'stream_name': stream_name,
            'production_scenario': cache_scenario,
            'endpoint_type': 'production_mock'
        })
    
    def _add_realistic_randomization(self, response: Dict[str, Any]) -> Dict[str, Any]:
        """Add realistic randomization to response values."""
        # Add small variance to timing
        if 'took' in response and response['took'] > 0:
            variance = max(5, int(response['took'] * 0.1))  # ±10%
            response['took'] += random.randint(-variance, variance)
            response['took'] = max(1, response['took'])  # Minimum 1ms
        
        # Add variance to cache ratios
        if 'result_cache_ratio' in response and response['result_cache_ratio'] > 0:
            response['result_cache_ratio'] += random.randint(-3, 3)
            response['result_cache_ratio'] = max(0, min(100, response['result_cache_ratio']))
        
        if 'cached_ratio' in response and response['cached_ratio'] > 0:
            response['cached_ratio'] += random.randint(-2, 2)
            response['cached_ratio'] = max(0, min(100, response['cached_ratio']))
        
        # Adjust scan metrics based on cache effectiveness
        cache_effectiveness = max(
            response.get('result_cache_ratio', 0),
            response.get('cached_ratio', 0)
        ) / 100
        
        if cache_effectiveness > 0.8:  # High cache effectiveness
            response['scan_size'] = random.randint(0, 1000)
            response['scan_records'] = random.randint(0, 10)
        elif cache_effectiveness > 0.5:  # Medium cache effectiveness
            base_scan = response.get('scan_size', 50000)
            response['scan_size'] = int(base_scan * (1 - cache_effectiveness))
            response['scan_records'] = int(response.get('scan_records', 500) * (1 - cache_effectiveness))
        
        return response


def create_response_builder() -> ResponseBuilder:
    """Factory function to create response builder."""
    return ResponseBuilder()