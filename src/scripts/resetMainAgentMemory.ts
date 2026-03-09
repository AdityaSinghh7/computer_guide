import { parseArgs } from 'node:util';

import { readEnv } from '../mastra/env';
import { mastra } from '../mastra';

const { values } = parseArgs({
  options: {
    thread: { type: 'string' },
    resource: { type: 'string' },
  },
  allowPositionals: false,
});

const defaultThread = readEnv('MAIN_AGENT_DEFAULT_THREAD') ?? 'terminal-chat';
const defaultResource = readEnv('MAIN_AGENT_DEFAULT_RESOURCE') ?? 'local-user';

const threadId = values.thread ?? defaultThread;
const resourceId = values.resource ?? defaultResource;

const main = async () => {
  const agent = mastra.getAgent('mainAgent');
  const memory = await agent.getMemory();

  if (!memory) {
    throw new Error('Main Agent does not have memory configured.');
  }

  await memory.deleteThread(threadId);
  await memory.updateWorkingMemory({
    threadId,
    resourceId,
    workingMemory: '',
  });

  console.log(`Cleared memory for thread=${threadId} resource=${resourceId}`);
};

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
