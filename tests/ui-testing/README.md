# zinc-observe-ui-automation

## Playwright UI Testing

### Installation
```bash
npm install
```

### Running Tests

#### Using Playwright Runner UI (Recommended)
```bash
cd playwright-runner
npm start
```
Then open http://localhost:3000 to access the test runner interface.

#### Using Command Line
```bash
# Run all tests
npx playwright test

# Run specific test by tag
npx playwright test -g @alertsImportExport

# Run in headed mode
npx playwright test --headed

# Run specific test file
npx playwright test Alerts/alerts-import.spec.js
```

### Environment Configuration
Tests can be configured using:
1. **Playwright Runner UI** - Set environment variables through the web interface
2. **Environment Variables** - Set variables in terminal or .env file
