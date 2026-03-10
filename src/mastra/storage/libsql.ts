import { LibSQLStore } from '@mastra/libsql';

import { readEnvOrDefault } from '../env';

export const defaultMastraDbUrl = 'file:./mastra.db';
export const mastraDbUrl = readEnvOrDefault('MASTRA_DB_URL', defaultMastraDbUrl);

// Keep storage wiring isolated so we can move between instance, agent, or composite
// storage later without rewriting the rest of the project.
export const libsqlStorage = new LibSQLStore({
  id: 'main-storage',
  url: mastraDbUrl,
});
