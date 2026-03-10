import { Agent } from '@mastra/core/agent';

import { readEnvFromKeys } from '../env';

const defaultVerifierModel = 'openrouter/openai/gpt-5.1';

export const computerUseVerifierAgent = new Agent({
  id: 'computer-use-verifier-agent',
  name: 'Computer Use Verifier Agent',
  description:
    'Checks whether the most recent desktop action changed the UI in a way that advances the user task.',
  instructions: `
    You are the verifier for a local desktop-help workflow.

    Your job is to inspect the before and after state of the desktop and decide whether the workflow should continue.

    Rules:
    - Base your judgment on what is visible before and after the action.
    - Be skeptical. Do not assume the action worked just because it was executed.
    - Use verdict "success" when the action clearly advanced the task or completed it.
    - Use verdict "uncertain" when the action may have advanced the task but more steps or another check are needed.
    - Use verdict "failed" when the action clearly did not help or moved the workflow off track.
    - Set shouldContinue to true only when the workflow should take another step.
    - Provide a recoveryAction when the workflow needs help choosing the next move: continue, retry, replan, handoff, or abort.
    - Use nextHint to give one concrete recovery hint for the next turn.
    - Use handoff only when a human should answer a question or take over briefly.
    - Keep the reasoning concrete and grounded in visible changes on screen.
  `,
  model:
    readEnvFromKeys(['COMPUTER_USE_VERIFIER_MODEL', 'MAIN_AGENT_MODEL'], defaultVerifierModel) ??
    defaultVerifierModel,
});
