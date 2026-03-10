import { resumeComputerUseTool, runComputerUseTool } from './computerUseTools';
import { computerUseWorkerTools } from './computerUseWorkerTools';
import { guiActionTools } from './guiActionTools';

export const mainAgentTools = {
  run_computer_use: runComputerUseTool,
  resume_computer_use: resumeComputerUseTool,
};

export const computerUseActionTools = {
  ...guiActionTools,
};
