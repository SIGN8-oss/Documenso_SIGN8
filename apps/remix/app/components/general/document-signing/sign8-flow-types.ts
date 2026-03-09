export type Sign8FlowStep = 'idle' | 'verifying' | 'applying' | 'completing' | 'success' | 'error';

export type Sign8FlowState = {
  step: Sign8FlowStep;
  progress: number;
  fieldsCompleted: number;
  fieldsTotal: number;
  error: string | null;
};

export const INITIAL_SIGN8_FLOW_STATE: Sign8FlowState = {
  step: 'idle',
  progress: 0,
  fieldsCompleted: 0,
  fieldsTotal: 0,
  error: null,
};

export const STEP_MESSAGES: Record<Sign8FlowStep, string> = {
  idle: '',
  verifying: 'Verifying your signature...',
  applying: 'Applying signature to document...',
  completing: 'Completing document...',
  success: 'Document signed successfully!',
  error: 'An error occurred',
};
