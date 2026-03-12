import { runComputerUseTool } from './computerUseTools';
import { computerUseWorkerTools } from './computerUseWorkerTools';
import { guiActionTools } from './guiActionTools';

export const mainAgentTools = {
  run_computer_use: runComputerUseTool,
};

export const computerUseActionTools = {
  ...guiActionTools,
};
