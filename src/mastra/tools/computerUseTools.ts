import { createTool } from '@mastra/core/tools';

import { computerUseWorkflow } from '../computer-use/workflow';
import {
  createInitialComputerUseState,
  computerUseRequestSchema,
  computerUseResumeRequestSchema,
  computerUseWorkflowOutputSchema,
  type ComputerUseWorkflowOutput,
  type ComputerUseWorkflowState,
} from '../computer-use/schemas';

type ComputerUseRunResult = {
  status: 'success';
  result: ComputerUseWorkflowOutput;
} | {
  status: 'failed';
  error: Error;
  state?: ComputerUseWorkflowState;
} | {
  status: 'suspended';
  suspendPayload: unknown;
  suspended: string[][];
  state?: ComputerUseWorkflowState;
};

const normalizeWorkflowState = (state?: ComputerUseWorkflowState) => ({
  finalResponse:
    state?.finalResponse ??
    (state?.status === 'completed'
      ? 'The computer-use task completed.'
      : 'The computer-use task stopped without a final response.'),
  totalSteps: state?.steps.length ?? 0,
  taskTodo: state?.taskTodo ?? [],
  scratchpad: state?.scratchpad ?? [],
  handoff: state?.pendingHandoff ?? null,
  steps: state?.steps ?? [],
});

const mapWorkflowResult = (
  workflowRunId: string,
  result: ComputerUseRunResult,
): ComputerUseWorkflowOutput => {
  if (result.status === 'success') {
    return result.result;
  }

  const normalized = normalizeWorkflowState(result.state);

  if (result.status === 'suspended') {
    return {
      workflowRunId,
      status: 'suspended',
      finalResponse:
        normalized.handoff?.question ??
        normalized.handoff?.summary ??
        'The computer-use workflow is waiting for user input before it can continue.',
      totalSteps: normalized.totalSteps,
      taskTodo: normalized.taskTodo,
      scratchpad: normalized.scratchpad,
      handoff: normalized.handoff,
      suspendedPath: result.suspended[0],
      steps: normalized.steps,
    };
  }

  return {
    workflowRunId,
    status: 'failed',
    finalResponse: normalized.finalResponse || result.error.message,
    totalSteps: normalized.totalSteps,
    taskTodo: normalized.taskTodo,
    scratchpad: normalized.scratchpad,
    handoff: normalized.handoff,
    steps: normalized.steps,
  };
};

export const runComputerUseTool = createTool({
  id: 'run_computer_use',
  description:
    'Run the structured local computer-use workflow for a desktop task. Use this when the user wants the assistant to interact with the computer on their behalf instead of only answering a question.',
  inputSchema: computerUseRequestSchema,
  outputSchema: computerUseWorkflowOutputSchema,
  execute: async (input, context) => {
    const run = await computerUseWorkflow.createRun(
      input.resourceId ? { resourceId: input.resourceId } : undefined,
    );
    const result = (await run.start({
      inputData: input,
      initialState: createInitialComputerUseState(input.maxIterations, input.maxRecoveryAttempts),
      requestContext: context?.requestContext,
      outputOptions: {
        includeState: true,
      },
    })) as ComputerUseRunResult;

    return mapWorkflowResult(run.runId, result);
  },
});

export const resumeComputerUseTool = createTool({
  id: 'resume_computer_use',
  description:
    'Resume a suspended computer-use workflow after the user provides the requested clarification or chooses to abort the handoff.',
  inputSchema: computerUseResumeRequestSchema,
  outputSchema: computerUseWorkflowOutputSchema,
  execute: async (input, context) => {
    const run = await computerUseWorkflow.createRun({ runId: input.runId });
    const result = (await run.resume({
      ...(input.suspendedPath ? { step: input.suspendedPath } : {}),
      resumeData: {
        action: input.action,
        userResponse: input.userResponse,
      },
      requestContext: context?.requestContext,
      outputOptions: {
        includeState: true,
      },
    })) as ComputerUseRunResult;

    return mapWorkflowResult(run.runId, result);
  },
});
