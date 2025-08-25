/**
 * Basic Slack Reporter for Playwright Test Results
 * Sends final test summary to Slack channel
 */
class SlackReporter {
  constructor(options = {}) {
    this.webhookUrl = options.webhookUrl || process.env.SLACK_WEBHOOK_URL;
    this.channel = options.channel || process.env.SLACK_CHANNEL || '#test-results';
    this.username = options.username || 'Playwright Test Bot';
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0,
      failedTests: []
    };
  }

  onTestEnd(test, result) {
    this.results.total++;
    
    switch (result.status) {
      case 'passed':
        this.results.passed++;
        break;
      case 'failed':
        this.results.failed++;
        this.results.failedTests.push({
          title: test.title,
          file: test.location?.file || 'Unknown',
          error: result.error?.message || 'No error message'
        });
        break;
      case 'skipped':
        this.results.skipped++;
        break;
    }
  }

  onEnd(result) {
    this.results.duration = result.duration;
    
    if (this.webhookUrl) {
      this.sendSlackMessage();
    } else {
      console.log('⚠️  Slack webhook URL not configured. Skipping Slack notification.');
      this.logResults();
    }
  }

  async sendSlackMessage() {
    const message = this.buildSlackMessage();
    
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message)
      });

      if (response.ok) {
        console.log('✅ Slack notification sent successfully');
      } else {
        console.error('❌ Failed to send Slack notification:', response.statusText);
      }
    } catch (error) {
      console.error('❌ Error sending Slack notification:', error);
    }
  }

  buildSlackMessage() {
    const { passed, failed, skipped, total, duration, failedTests } = this.results;
    const durationMinutes = Math.round(duration / 1000 / 60 * 100) / 100;
    
    const statusEmoji = failed > 0 ? '❌' : '✅';
    const statusText = failed > 0 ? 'FAILED' : 'PASSED';
    const color = failed > 0 ? 'danger' : 'good';

    let fields = [
      {
        title: 'Total Tests',
        value: total.toString(),
        short: true
      },
      {
        title: 'Passed',
        value: `✅ ${passed}`,
        short: true
      },
      {
        title: 'Failed',
        value: `❌ ${failed}`,
        short: true
      },
      {
        title: 'Skipped',
        value: `⏭️ ${skipped}`,
        short: true
      },
      {
        title: 'Duration',
        value: `${durationMinutes}m`,
        short: true
      }
    ];

    let attachment = {
      color: color,
      title: `${statusEmoji} Playwright Test Results - ${statusText}`,
      fields: fields,
      footer: 'OpenObserve E2E Tests',
      ts: Math.floor(Date.now() / 1000)
    };

    // Add failed tests details if any
    if (failedTests.length > 0 && failedTests.length <= 5) {
      const failedDetails = failedTests.map(test => 
        `• ${test.title}\n  _File: ${test.file.split('/').pop()}_\n  _Error: ${test.error.substring(0, 100)}${test.error.length > 100 ? '...' : ''}_`
      ).join('\n\n');
      
      attachment.fields.push({
        title: 'Failed Tests',
        value: failedDetails,
        short: false
      });
    } else if (failedTests.length > 5) {
      attachment.fields.push({
        title: 'Failed Tests',
        value: `${failedTests.length} tests failed. Check the detailed report for more information.`,
        short: false
      });
    }

    return {
      channel: this.channel,
      username: this.username,
      text: `${statusEmoji} Test Run Complete`,
      attachments: [attachment]
    };
  }

  logResults() {
    console.log('\n📊 Test Results Summary:');
    console.log(`   Total: ${this.results.total}`);
    console.log(`   ✅ Passed: ${this.results.passed}`);
    console.log(`   ❌ Failed: ${this.results.failed}`);
    console.log(`   ⏭️  Skipped: ${this.results.skipped}`);
    console.log(`   ⏱️  Duration: ${Math.round(this.results.duration / 1000 / 60 * 100) / 100}m`);
    
    if (this.results.failedTests.length > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.failedTests.forEach(test => {
        console.log(`   • ${test.title} (${test.file.split('/').pop()})`);
      });
    }
  }
}

module.exports = SlackReporter;