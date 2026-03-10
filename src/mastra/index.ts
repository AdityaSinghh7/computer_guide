
import { Mastra } from '@mastra/core/mastra';

import { computerUseVerifierAgent } from './agents/computer-use-verifier-agent';
import { computerUseWorkerAgent } from './agents/computer-use-worker-agent';
import { mainAgent } from './agents/main-agent';
import { computerUseWorkflow } from './computer-use/workflow';
import { libsqlStorage } from './storage/libsql';

export const mastra = new Mastra({
  agents: {
    mainAgent,
    computerUseWorkerAgent,
    computerUseVerifierAgent,
  },
  workflows: {
    computerUseWorkflow,
  },
  storage: libsqlStorage,
});
