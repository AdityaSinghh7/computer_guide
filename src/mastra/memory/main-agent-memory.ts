import { Memory } from '@mastra/memory';

export const mainAgentMemory = new Memory({
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
    },
  },
});
