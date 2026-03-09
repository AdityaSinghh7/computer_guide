import { LibSQLStore } from '@mastra/libsql';

import { readEnvOrDefault } from '../env';

const defaultDbUrl = 'file:./mastra.db';

// Keep storage wiring isolated so we can move between instance, agent, or composite
// storage later without rewriting the rest of the project.
export const libsqlStorage = new LibSQLStore({
  id: 'main-storage',
  url: readEnvOrDefault('MASTRA_DB_URL', defaultDbUrl),
});
