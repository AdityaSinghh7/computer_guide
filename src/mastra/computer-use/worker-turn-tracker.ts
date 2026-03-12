import { RequestContext } from '@mastra/core/request-context';

import {
  type ComputerUseObservation,
  type ComputerUseWorkerToolCall,
  type ComputerUseWorkerToolResult,
  computerUseWorkerToolCallSchema,
  computerUseWorkerToolResultSchema,
} from './schemas';

type RequestContextLike =
  | RequestContext<Record<string, unknown>>
  | Record<string, unknown>
  | undefined;

const observationKey = 'computerUseObservation';
const trackerKey = 'computerUseTurnTracker';

type WorkerTurnTracker = {
  toolCalls: ComputerUseWorkerToolCall[];
  toolResults: ComputerUseWorkerToolResult[];
};

const normalizeArgs = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
};

const readContextValue = (requestContext: RequestContextLike, key: string) => {
  if (requestContext instanceof RequestContext) {
    return requestContext.get(key);
  }

  if (requestContext && typeof requestContext === 'object' && key in requestContext) {
    return (requestContext as Record<string, unknown>)[key];
  }

  return undefined;
};

const writeContextValue = (requestContext: RequestContextLike, key: string, value: unknown) => {
  if (requestContext instanceof RequestContext) {
    requestContext.set(key, value);
    return;
  }

  if (requestContext && typeof requestContext === 'object') {
    (requestContext as Record<string, unknown>)[key] = value;
  }
};

export const createWorkerTurnRequestContext = (
  requestContext: RequestContextLike,
  observation: ComputerUseObservation,
): RequestContext<Record<string, unknown>> => {
  const nextContext =
    requestContext instanceof RequestContext
      ? requestContext
      : new RequestContext<Record<string, unknown>>(
          requestContext && typeof requestContext === 'object'
            ? Object.entries(requestContext)
            : undefined,
        );
  writeContextValue(nextContext, observationKey, observation);
  writeContextValue(nextContext, trackerKey, {
    toolCalls: [],
    toolResults: [],
  } satisfies WorkerTurnTracker);
  return nextContext;
};

const getWorkerTurnTracker = (requestContext: RequestContextLike): WorkerTurnTracker | null => {
  const value = readContextValue(requestContext, trackerKey);
  if (!value || typeof value !== 'object') {
    return null;
  }

  const toolCalls = Array.isArray((value as WorkerTurnTracker).toolCalls)
    ? (value as WorkerTurnTracker).toolCalls
    : [];
  const toolResults = Array.isArray((value as WorkerTurnTracker).toolResults)
    ? (value as WorkerTurnTracker).toolResults
    : [];

  return {
    toolCalls,
    toolResults,
  };
};

export const readTrackedWorkerTurn = (requestContext: RequestContextLike) => {
  const tracker = getWorkerTurnTracker(requestContext);
  if (!tracker) {
    return null;
  }

  return {
    toolCalls: tracker.toolCalls,
    toolResults: tracker.toolResults,
  };
};

export const recordWorkerToolCall = (
  requestContext: RequestContextLike,
  toolName: string,
  args: unknown,
) => {
  const tracker = getWorkerTurnTracker(requestContext);
  if (!tracker) {
    return null;
  }

  const toolCall = computerUseWorkerToolCallSchema.parse({
    toolCallId: `worker-tool-${tracker.toolCalls.length + 1}`,
    toolName,
    args: normalizeArgs(args),
  });
  tracker.toolCalls.push(toolCall);
  return toolCall;
};

export const recordWorkerToolResult = (
  requestContext: RequestContextLike,
  toolCall: ComputerUseWorkerToolCall | null,
  toolName: string,
  args: unknown,
  result: unknown,
) => {
  const tracker = getWorkerTurnTracker(requestContext);
  if (!tracker || !toolCall) {
    return;
  }

  tracker.toolResults.push(
    computerUseWorkerToolResultSchema.parse({
      toolCallId: toolCall.toolCallId,
      toolName,
      args: normalizeArgs(args),
      result,
    }),
  );
};
