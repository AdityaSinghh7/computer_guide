
import { Mastra } from '@mastra/core/mastra';

import { mainAgent } from './agents/main-agent';
import { libsqlStorage } from './storage/libsql';

export const mastra = new Mastra({
  agents: { mainAgent },
  storage: libsqlStorage,
});
