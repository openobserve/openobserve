// Agent Graph and Agent Behavior: the agent / env cascade that scopes both views.
export class AiAgentScopePage {
    constructor(page) {
        this.page = page;
    }

    async gotoView(view, { org, agent, env, type } = {}) {
        const params = new URLSearchParams({ org_identifier: org });
        if (type) params.set('type', type);
        if (agent) params.set('agent', agent);
        if (env) params.set('env', env);
        await this.page.goto(`${process.env.ZO_BASE_URL.replace(/\/$/, '')}/web/ai/${view}?${params.toString()}`);
    }

    agentSelection(view = 'agent-graph') {
        return this.page.locator(`[data-test="${view}-cascade-agent"] [data-test-selected-value]`).first();
    }

    envSelection(view = 'agent-graph') {
        return this.page.locator(`[data-test="${view}-cascade-env"] [data-test-selected-value]`).first();
    }
}

export default AiAgentScopePage;
