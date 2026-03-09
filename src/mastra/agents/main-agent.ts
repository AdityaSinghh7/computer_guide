import { Agent } from '@mastra/core/agent';

import { mainAgentMemory } from '../memory/main-agent-memory';
import { mainAgentTools } from '../tools/registry';

export const mainAgent = new Agent({
  id: 'main-agent',
  name: 'Main Agent',
  description: 'Primary assistant entrypoint for the computer_guide project.',
  instructions: `
    You are the primary assistant for the computer_guide project.

    Give direct, practical answers.
    Ask for clarification when the request is ambiguous.
    Be concise by default and explicit about assumptions.
    Use the available GUI action tools when a task requires desktop interaction, such as opening something, switching applications, clicking, typing, dragging, scrolling, pressing keys, or waiting.
    The GUI action tools are currently stubs and only record the requested action; they do not manipulate the UI yet.
    If a task requires tools or workflows that are not available yet, say so plainly.
  `,
  model: 'openai/gpt-5.1',
  tools: mainAgentTools,
  memory: mainAgentMemory,
});
