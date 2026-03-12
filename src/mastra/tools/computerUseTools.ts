import { createTool } from '@mastra/core/tools';

import { computerUseWorkflow } from '../computer-use/workflow';
import {
  appendRunTimelineEvent,
  initializeRunTimeline,
  withObservabilityRun,
} from '../observability/runTimeline';
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

const recordWorkflowLifecycleEvent = async (
  workflowRunId: string,
  phase: 'started' | 'resumed' | 'completed' | 'failed' | 'suspended',
  details: Record<string, unknown>,
) => {
  const description =
    phase === 'started'
      ? {
          title: 'Workflow run created',
          summary: 'Started a new computer-use workflow run.',
        }
      : phase === 'resumed'
        ? {
            title: 'Workflow run resumed',
            summary: 'Resumed the existing workflow run after a handoff. This is not a new run.',
          }
        : phase === 'suspended'
          ? {
              title: 'Workflow run suspended',
              summary: 'Paused the existing workflow run and is waiting for user input.',
            }
          : phase === 'completed'
            ? {
                title: 'Workflow run completed',
                summary: 'Finished the existing workflow run successfully.',
              }
            : {
                title: 'Workflow run failed',
                summary: 'Stopped the existing workflow run because it could not continue.',
              };

  await appendRunTimelineEvent(workflowRunId, {
    type: 'run',
    title: description.title,
    outcome:
      phase === 'failed' ? 'error' : phase === 'completed' ? 'success' : 'info',
    summary: description.summary,
    details: {
      phase,
      ...details,
    },
  });
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
    await initializeRunTimeline(run.runId, {
      title: `Computer Use Run ${run.runId}`,
      metadata: {
        kind: 'computer-use',
        phase: 'start',
        resourceId: input.resourceId ?? null,
      },
    });
    await recordWorkflowLifecycleEvent(run.runId, 'started', {
      input,
    });

    const result = await withObservabilityRun(run.runId, async () =>
      (await run.start({
        inputData: input,
        initialState: createInitialComputerUseState(input.maxIterations, input.maxRecoveryAttempts),
        requestContext: context?.requestContext,
        outputOptions: {
          includeState: true,
        },
      })) as ComputerUseRunResult,
    );

    const mapped = mapWorkflowResult(run.runId, result);
    await recordWorkflowLifecycleEvent(run.runId, mapped.status, {
      finalResponse: mapped.finalResponse,
      totalSteps: mapped.totalSteps,
      handoff: mapped.handoff,
    });

    return mapped;
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
    await initializeRunTimeline(run.runId, {
      title: `Computer Use Run ${run.runId}`,
      metadata: {
        kind: 'computer-use',
        phase: 'resume',
      },
    });

    const result = await withObservabilityRun(run.runId, async () =>
      (await run.resume({
        ...(input.suspendedPath ? { step: input.suspendedPath } : {}),
        resumeData: {
          action: input.action,
          userResponse: input.userResponse,
        },
        requestContext: context?.requestContext,
        outputOptions: {
          includeState: true,
        },
      })) as ComputerUseRunResult,
    );

    await recordWorkflowLifecycleEvent(run.runId, 'resumed', {
      action: input.action,
      suspendedPath: input.suspendedPath ?? null,
    });

    const mapped = mapWorkflowResult(run.runId, result);
    await recordWorkflowLifecycleEvent(run.runId, mapped.status, {
      finalResponse: mapped.finalResponse,
      totalSteps: mapped.totalSteps,
      handoff: mapped.handoff,
    });

    return mapped;
  },
});
