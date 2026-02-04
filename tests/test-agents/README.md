# Test Agents

Collection of automated agents for repository maintenance and testing tasks.

## Available Agents

| Agent | Description | Schedule |
|-------|-------------|----------|
| [bug-checker](./bug-checker/) | Identifies open bugs that may have been fixed by merged PRs | Weekly (Mon 9AM UTC) |

## Adding a New Agent

1. Create a new directory under `test-agents/` with your agent name
2. Add a `README.md` documenting the agent's purpose and usage
3. Create the GitHub Action workflow in `.github/workflows/`
4. Update this README to include your agent in the table above

## Design Principles

- **Non-destructive**: Agents should suggest actions, not auto-close/delete
- **Rate-limited**: Include checks to avoid spamming (e.g., skip if commented recently)
- **Configurable**: Support dry-run mode and customizable thresholds
- **Documented**: Each agent should have clear documentation
