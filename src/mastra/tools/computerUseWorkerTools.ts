import { createTool } from '@mastra/core/tools';

import { computerUseWorkerControlSchema } from '../computer-use/schemas';
import { guiActionTools } from './guiActionTools';

export const computerUseControlToolId = 'computer_use_control';

export const computerUseControlTool = createTool({
  id: computerUseControlToolId,
  description:
    'Finalize the current computer-use worker turn for the workflow. Call this exactly once near the end of the turn to report whether the task should continue, is done, cannot be completed, or needs human handoff. Include concise todo and scratchpad updates.',
  inputSchema: computerUseWorkerControlSchema,
  outputSchema: computerUseWorkerControlSchema,
  execute: async input => input,
  toModelOutput: output => ({
    type: 'text',
    value: `Turn recorded: ${output.status}. ${output.summary}`,
  }),
});

export const computerUseWorkerTools = {
  ...guiActionTools,
  [computerUseControlToolId]: computerUseControlTool,
};
