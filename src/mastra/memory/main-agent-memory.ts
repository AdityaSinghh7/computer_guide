import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import { LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';

import { libsqlStorage, mastraDbUrl } from '../storage/libsql';

export const mainAgentMemory = new Memory({
  storage: libsqlStorage,
  vector: new LibSQLVector({
    id: 'main-memory-vector',
    url: mastraDbUrl,
  }),
  embedder: new ModelRouterEmbeddingModel({
    providerId: 'openrouter',
    modelId: 'qwen/qwen3-embedding-8b',
  }),
  options: {
    lastMessages: 20,
    semanticRecall: {
      topK: 4,
      messageRange: 1,
      scope: 'resource',
      threshold: 0.67,
    },
    workingMemory: {
      enabled: true,
    },
  },
});
