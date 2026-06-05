// Copyright 2026 OpenObserve Inc.
//
// Manual verification script for trace tooltip functionality
// Run this in browser console on a TraceDetails page

// Test data
const mockPatternData = [
  {
    id: 'pattern-1',
    name: 'frontend → backend → database',
    value: 100,
    metadata: {
      pathSignature: 'frontend → backend → database',
      count: 5,
      avg: 125.5,
      min: 50.2,
      max: 200.8,
      p75: 145.3,
      p95: 185.1,
      p99: 195.7,
      errorRate: 10.0
    }
  },
  {
    id: 'pattern-2',
    name: 'backend → cache',
    value: 25,
    metadata: {
      pathSignature: 'backend → cache',
      count: 15,
      avg: 25.0,
      min: 10.5,
      max: 45.0,
      p75: 30.0,
      p95: 40.0,
      p99: 44.0,
      errorRate: 0.0
    }
  }
]

// Test the tooltip content generation
function testTooltipGeneration() {
  console.log('🧪 Testing Tooltip Generation')

  // Import the tooltip helper function
  import('/src/utils/traces/treeTooltipHelpers.js').then(module => {
    const { generateTracePatternTooltipContent } = module

    console.log('✅ Tooltip helper loaded successfully')

    // Test each pattern
    mockPatternData.forEach((pattern, index) => {
      console.log(`\n📊 Testing pattern ${index + 1}: ${pattern.name}`)
      const content = generateTracePatternTooltipContent(pattern.metadata)
      console.log('Generated content:', content)

      // Validate content contains required fields
      const checks = [
        { field: 'Pattern name', test: content.includes(pattern.metadata.pathSignature) },
        { field: 'Call count', test: content.includes(`Calls: ${pattern.metadata.count}`) },
        { field: 'Average duration', test: content.includes(`Average: ${pattern.metadata.avg.toFixed(1)}ms`) },
        { field: 'Percentiles', test: content.includes(`P95: ${pattern.metadata.p95.toFixed(1)}ms`) },
        { field: 'Error rate', test: content.includes(`Error Rate: ${pattern.metadata.errorRate.toFixed(1)}%`) }
      ]

      checks.forEach(check => {
        console.log(`  ${check.test ? '✅' : '❌'} ${check.field}`)
      })
    })

    // Test edge cases
    console.log('\n🔍 Testing edge cases')

    // Test null metadata
    const nullResult = generateTracePatternTooltipContent(null)
    console.log('Null metadata result:', nullResult.includes('Unknown Pattern') ? '✅' : '❌')

    // Test empty metadata
    const emptyResult = generateTracePatternTooltipContent({})
    console.log('Empty metadata result:', emptyResult.includes('Unknown Pattern') ? '✅' : '❌')

  }).catch(error => {
    console.error('❌ Failed to import tooltip helpers:', error)
  })
}

// Test tooltip setup integration
function testTooltipIntegration() {
  console.log('\n🔧 Testing Tooltip Integration')

  // Check if we're on a trace details page
  const traceDetailsComponent = document.querySelector('[data-test*="trace-details"]')
  if (!traceDetailsComponent) {
    console.warn('⚠️  Not on a trace details page. Navigate to a trace to test integration.')
    return
  }

  console.log('✅ Trace details page detected')

  // Check for pattern view elements
  const mapTab = document.querySelector('[data-test*="map"]')
  const patternToggle = document.querySelector('[data-test*="pattern"]')

  if (mapTab && patternToggle) {
    console.log('✅ Map tab and pattern controls found')

    // Try to switch to pattern view (if not already active)
    if (!patternToggle.classList.contains('active')) {
      console.log('🔄 Switching to pattern view...')
      patternToggle.click()

      // Wait for view to load and check for tooltip setup
      setTimeout(() => {
        const chartCanvas = document.querySelector('canvas')
        if (chartCanvas) {
          console.log('✅ Chart canvas found - tooltips should be active')
          console.log('💡 Hover over pattern nodes to test tooltip display')
        } else {
          console.warn('⚠️  No chart canvas found')
        }
      }, 1000)
    } else {
      console.log('✅ Pattern view already active')
    }
  } else {
    console.warn('⚠️  Map tab or pattern controls not found')
  }
}

// Test accessibility
function testTooltipAccessibility() {
  console.log('\n♿ Testing Tooltip Accessibility')

  import('/src/utils/traces/treeTooltipHelpers.js').then(module => {
    const { generateTracePatternTooltipContent } = module

    const content = generateTracePatternTooltipContent(mockPatternData[0].metadata)

    // Check for screen reader friendly content
    const checks = [
      { test: 'No script tags', passed: !content.includes('<script') },
      { test: 'No style tags', passed: !content.includes('<style') },
      { test: 'Structured content', passed: content.includes('Calls:') && content.includes('Average:') },
      { test: 'Clear labels', passed: content.includes('Error Rate:') && content.includes('P95:') }
    ]

    checks.forEach(check => {
      console.log(`  ${check.passed ? '✅' : '❌'} ${check.test}`)
    })
  })
}

// Main test runner
function runTooltipVerification() {
  console.log('🚀 Starting Trace Tooltip Manual Verification')
  console.log('=' .repeat(50))

  testTooltipGeneration()
  setTimeout(() => {
    testTooltipIntegration()
    setTimeout(() => {
      testTooltipAccessibility()
      console.log('\n' + '='.repeat(50))
      console.log('✅ Manual verification complete!')
      console.log('💡 Remember to manually test:')
      console.log('  - Hover interactions in pattern view')
      console.log('  - Tooltip positioning accuracy')
      console.log('  - Tooltip cleanup on view switch')
      console.log('  - Performance with large datasets')
    }, 1000)
  }, 2000)
}

// Export for manual execution
window.runTooltipVerification = runTooltipVerification

console.log('🔧 Tooltip verification script loaded')
console.log('📋 Run: runTooltipVerification() to start testing')