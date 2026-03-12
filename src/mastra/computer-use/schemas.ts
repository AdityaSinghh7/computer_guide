import { z } from 'zod';

import { desktopActionArtifactSchema } from '../tools/desktopActionClient';

const parseJsonLike = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
};

const todoItemLikeSchema = z.union([
  z.object({
    id: z.string().trim().min(1),
    content: z.string().trim().min(1),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
    note: z.string().trim().min(1).optional(),
  }),
  z.string().trim().min(1),
]);

const inferTodoStatus = (
  value: string,
): 'pending' | 'in_progress' | 'completed' | 'blocked' => {
  if (/^(completed|done):/i.test(value)) {
    return 'completed';
  }

  if (/^(blocked):/i.test(value)) {
    return 'blocked';
  }

  if (/^(in_progress|active|doing):/i.test(value)) {
    return 'in_progress';
  }

  return 'pending';
};

const todoArraySchema = z
  .preprocess(
    parseJsonLike,
    z.array(todoItemLikeSchema).transform(items =>
      items.map((item, index) =>
        typeof item === 'string'
          ? {
              id: `todo-${index + 1}`,
              content: item.replace(/^[a-z_]+:\s*/i, '').trim() || item,
              status: inferTodoStatus(item),
            }
          : item,
      ),
    ),
  )
  .default([]);

const scratchpadArraySchema = z
  .preprocess(value => {
    const parsed = parseJsonLike(value);
    return typeof parsed === 'string' ? [parsed] : parsed;
  }, z.array(z.string().trim().min(1)))
  .default([]);

export const computerUseActionToolIds = [
  'click',
  'switch_applications',
  'open',
  'type',
  'drag_and_drop',
  'scroll',
  'hotkey',
  'hold_and_press',
  'wait',
] as const;

export const computerUseActionToolNameSchema = z.enum(computerUseActionToolIds);
export const computerUseTodoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'blocked',
]);
export const computerUseRecoveryActionSchema = z.enum([
  'continue',
  'retry',
  'wait',
  'replan',
  'handoff',
  'abort',
]);
export const computerUseWorkerStatusSchema = z.enum([
  'continue',
  'done',
  'cannot_complete',
  'handoff',
]);

export const computerUseRequestSchema = z.object({
  request: z.string().trim().min(1),
  app: z.string().trim().min(1).optional(),
  maxIterations: z.number().int().min(1).max(12).default(6),
  maxRecoveryAttempts: z.number().int().min(0).max(3).default(1),
  threadId: z.string().trim().min(1).optional(),
  resourceId: z.string().trim().min(1).optional(),
});

export const computerUseResumeRequestSchema = z.object({
  runId: z.string().trim().min(1),
  suspendedPath: z.array(z.string().trim().min(1)).min(1).optional(),
  userResponse: z.string().trim().min(1),
  action: z.enum(['continue', 'abort']).default('continue'),
});

export const computerUseResumePayloadSchema = z.object({
  userResponse: z.string().trim().min(1),
  action: z.enum(['continue', 'abort']).default('continue'),
});

export const computerUseLoopControlSchema = z.object({
  request: z.string(),
  app: z.string().optional(),
  maxIterations: z.number().int().min(1),
  maxRecoveryAttempts: z.number().int().min(0),
  continueLoop: z.boolean(),
});

export const computerUseControlSchema = computerUseLoopControlSchema;

export const computerUseTodoItemSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  status: computerUseTodoStatusSchema,
  note: z.string().trim().min(1).optional(),
});

export const computerUseHandoffSchema = z.object({
  summary: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  userAction: z.string().trim().min(1),
  question: z.string().trim().min(1),
});

export const computerUseWorkerControlSchema = z.object({
  status: computerUseWorkerStatusSchema,
  summary: z.string().trim().min(1),
  userMessage: z.string().trim().min(1).optional(),
  targetApp: z.string().trim().min(1).optional(),
  todoItems: todoArraySchema,
  scratchpad: scratchpadArraySchema,
  handoff: computerUseHandoffSchema.nullable().optional(),
});

export const computerUseObservationSchema = z.object({
  screenshotRawPath: z.string(),
  applicationName: z.string().optional(),
  windowTitle: z.string().optional(),
  captureMode: z.string(),
  captureSpace: z
    .object({
      displayId: z.number().int().nonnegative().optional(),
      displayIndex: z.number().int().nonnegative().optional(),
      bounds: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
      imageWidth: z.number().int().positive(),
      imageHeight: z.number().int().positive(),
    })
    .optional(),
});

export const computerUseGroundingArtifactSchema = z.object({
  description: z.string(),
  application: z.string().nullable().optional(),
  window: z.string().nullable().optional(),
  bounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable()
    .optional(),
});

export const computerUseExecutionResultSchema = z.object({
  actionId: z.string(),
  message: z.string(),
  durationMs: z.number().nonnegative(),
  artifact: desktopActionArtifactSchema,
  raw: z.record(z.string(), z.unknown()),
});

export const computerUseWorkerToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

export const computerUseWorkerToolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  result: z.unknown(),
});

export const computerUseExecutedActionSchema = z.object({
  toolCallId: z.string(),
  toolName: computerUseActionToolNameSchema,
  toolArgs: z.record(z.string(), z.unknown()).default({}),
  executionResult: computerUseExecutionResultSchema,
  grounding: computerUseGroundingArtifactSchema.nullable(),
});

export const computerUseWorkerTurnSchema = z.object({
  text: z.string(),
  control: computerUseWorkerControlSchema,
  toolCalls: z.array(computerUseWorkerToolCallSchema),
  toolResults: z.array(computerUseWorkerToolResultSchema),
  executedAction: computerUseExecutedActionSchema.nullable(),
});

export const computerUseWorkerArtifactsSchema = z.object({
  text: z.string(),
  control: computerUseWorkerControlSchema,
  toolCalls: z.array(computerUseWorkerToolCallSchema),
  toolResults: z.array(computerUseWorkerToolResultSchema),
  executedAction: computerUseExecutedActionSchema.nullable(),
  executionResult: computerUseExecutionResultSchema.nullable(),
  grounding: computerUseGroundingArtifactSchema.nullable(),
});

export const computerUseVerificationSchema = z.object({
  verdict: z.enum(['success', 'uncertain', 'failed']),
  summary: z.string(),
  shouldContinue: z.boolean(),
  recoveryAction: computerUseRecoveryActionSchema.default('continue'),
  recoveryReason: z.string().optional(),
  nextHint: z.string().optional(),
  handoff: computerUseHandoffSchema.nullable().optional(),
});

export const computerUseStepArtifactSchema = z.object({
  stepIndex: z.number().int().positive(),
  beforeObservation: computerUseObservationSchema,
  latestWorkerObservation: computerUseObservationSchema,
  workerTurn: computerUseWorkerTurnSchema,
  grounding: computerUseGroundingArtifactSchema.nullable(),
  executionResult: computerUseExecutionResultSchema.nullable(),
  afterObservation: computerUseObservationSchema,
  verification: computerUseVerificationSchema.nullable(),
  taskTodo: z.array(computerUseTodoItemSchema),
  scratchpad: z.array(z.string()),
  terminationSignal: z.enum(['continue', 'done', 'failed', 'max_iterations', 'handoff']),
});

export const computerUseTurnContextSchema = z.object({
  request: z.string(),
  app: z.string().optional(),
  maxIterations: z.number().int().min(1),
  maxRecoveryAttempts: z.number().int().min(0),
  stepIndex: z.number().int().positive(),
  beforeObservation: computerUseObservationSchema,
  workerTurn: computerUseWorkerTurnSchema.nullable(),
  grounding: computerUseGroundingArtifactSchema.nullable(),
  executionResult: computerUseExecutionResultSchema.nullable(),
  afterObservation: computerUseObservationSchema.nullable(),
  verification: computerUseVerificationSchema.nullable(),
  taskTodo: z.array(computerUseTodoItemSchema),
  scratchpad: z.array(z.string()),
  recoveryCount: z.number().int().nonnegative(),
  recoveryHint: z.string().optional(),
  resumeContext: z.string().optional(),
});

export const computerUseWorkflowStateSchema = z.object({
  workflowRunId: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'suspended']),
  stepIndex: z.number().int().nonnegative(),
  maxIterations: z.number().int().positive(),
  maxRecoveryAttempts: z.number().int().nonnegative(),
  currentObservation: computerUseObservationSchema.nullable(),
  pendingBeforeObservation: computerUseObservationSchema.nullable(),
  pendingLatestWorkerObservation: computerUseObservationSchema.nullable(),
  pendingWorkerArtifacts: computerUseWorkerArtifactsSchema.nullable(),
  pendingWorkerTurn: computerUseWorkerTurnSchema.nullable(),
  pendingGrounding: computerUseGroundingArtifactSchema.nullable(),
  pendingExecutionResult: computerUseExecutionResultSchema.nullable(),
  pendingAfterObservation: computerUseObservationSchema.nullable(),
  pendingVerification: computerUseVerificationSchema.nullable(),
  taskTodo: z.array(computerUseTodoItemSchema),
  scratchpad: z.array(z.string()),
  recoveryCount: z.number().int().nonnegative(),
  recoveryHint: z.string().optional(),
  resumeContext: z.string().optional(),
  pendingHandoff: computerUseHandoffSchema.nullable(),
  latestWorkerObservation: computerUseObservationSchema.nullable(),
  latestWorkerArtifacts: computerUseWorkerArtifactsSchema.nullable(),
  latestWorkerTurn: computerUseWorkerTurnSchema.nullable(),
  latestExecutionResult: computerUseExecutionResultSchema.nullable(),
  latestVerification: computerUseVerificationSchema.nullable(),
  finalResponse: z.string().optional(),
  steps: z.array(computerUseStepArtifactSchema),
});

export const computerUseWorkflowOutputSchema = z.object({
  workflowRunId: z.string().optional(),
  status: z.enum(['completed', 'failed', 'suspended']),
  finalResponse: z.string(),
  totalSteps: z.number().int().nonnegative(),
  taskTodo: z.array(computerUseTodoItemSchema),
  scratchpad: z.array(z.string()),
  handoff: computerUseHandoffSchema.nullable().optional(),
  suspendedPath: z.array(z.string()).optional(),
  steps: z.array(computerUseStepArtifactSchema),
});

export type ComputerUseControl = z.infer<typeof computerUseLoopControlSchema>;
export type ComputerUseExecutedAction = z.infer<typeof computerUseExecutedActionSchema>;
export type ComputerUseExecutionResult = z.infer<typeof computerUseExecutionResultSchema>;
export type ComputerUseObservation = z.infer<typeof computerUseObservationSchema>;
export type ComputerUseStepArtifact = z.infer<typeof computerUseStepArtifactSchema>;
export type ComputerUseTurnContext = z.infer<typeof computerUseTurnContextSchema>;
export type ComputerUseVerification = z.infer<typeof computerUseVerificationSchema>;
export type ComputerUseHandoff = z.infer<typeof computerUseHandoffSchema>;
export type ComputerUseTodoItem = z.infer<typeof computerUseTodoItemSchema>;
export type ComputerUseWorkerControl = z.infer<typeof computerUseWorkerControlSchema>;
export type ComputerUseWorkerToolCall = z.infer<typeof computerUseWorkerToolCallSchema>;
export type ComputerUseWorkerToolResult = z.infer<typeof computerUseWorkerToolResultSchema>;
export type ComputerUseWorkerTurn = z.infer<typeof computerUseWorkerTurnSchema>;
export type ComputerUseWorkerArtifacts = z.infer<typeof computerUseWorkerArtifactsSchema>;
export type ComputerUseWorkflowInput = z.infer<typeof computerUseRequestSchema>;
export type ComputerUseWorkflowOutput = z.infer<typeof computerUseWorkflowOutputSchema>;
export type ComputerUseWorkflowState = z.infer<typeof computerUseWorkflowStateSchema>;
export type ComputerUseResumeRequest = z.infer<typeof computerUseResumeRequestSchema>;
export type ComputerUseResumePayload = z.infer<typeof computerUseResumePayloadSchema>;

export const createInitialComputerUseState = (
  maxIterations: number,
  maxRecoveryAttempts = 1,
): ComputerUseWorkflowState => ({
  status: 'running',
  stepIndex: 0,
  maxIterations,
  maxRecoveryAttempts,
  currentObservation: null,
  pendingBeforeObservation: null,
  pendingLatestWorkerObservation: null,
  pendingWorkerArtifacts: null,
  pendingWorkerTurn: null,
  pendingGrounding: null,
  pendingExecutionResult: null,
  pendingAfterObservation: null,
  pendingVerification: null,
  taskTodo: [],
  scratchpad: [],
  recoveryCount: 0,
  recoveryHint: undefined,
  resumeContext: undefined,
  pendingHandoff: null,
  latestWorkerObservation: null,
  latestWorkerArtifacts: null,
  latestWorkerTurn: null,
  latestExecutionResult: null,
  latestVerification: null,
  finalResponse: undefined,
  steps: [],
});
