import { Trans } from '@lingui/react/macro';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';

import { Progress } from '@documenso/ui/primitives/progress';

import type { Sign8FlowState, Sign8FlowStep } from './sign8-flow-types';
import { STEP_MESSAGES } from './sign8-flow-types';

export type Sign8CompletionOverlayProps = {
  state: Sign8FlowState;
};

const StepIcon = ({ step }: { step: Sign8FlowStep }) => {
  if (step === 'success') {
    return <CheckCircle2Icon className="h-16 w-16 text-green-500" />;
  }

  if (step === 'error') {
    return <XCircleIcon className="h-16 w-16 text-destructive" />;
  }

  return <Loader2Icon className="h-16 w-16 animate-spin text-primary" />;
};

export const Sign8CompletionOverlay = ({ state }: Sign8CompletionOverlayProps) => {
  const { step, progress, fieldsCompleted, fieldsTotal, error } = state;

  if (step === 'idle') {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="mx-4 w-full max-w-md rounded-xl border bg-card p-8 shadow-lg"
        >
          <div className="flex flex-col items-center space-y-6">
            <StepIcon step={step} />

            <div className="w-full space-y-4 text-center">
              <h2 className="text-xl font-semibold">
                {step === 'verifying' && <Trans>Verifying Signature</Trans>}
                {step === 'applying' && <Trans>Applying Signature</Trans>}
                {step === 'completing' && <Trans>Completing Document</Trans>}
                {step === 'success' && <Trans>Success!</Trans>}
                {step === 'error' && <Trans>Error</Trans>}
              </h2>

              <p className="text-sm text-muted-foreground">{STEP_MESSAGES[step]}</p>

              {error && step === 'error' && (
                <p className="mt-2 text-sm text-destructive">{error}</p>
              )}

              {step !== 'error' && step !== 'success' && (
                <div className="space-y-2">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {step === 'applying' && fieldsTotal > 0 ? (
                      <Trans>
                        Signing field {fieldsCompleted + 1} of {fieldsTotal}
                      </Trans>
                    ) : (
                      `${Math.round(progress)}%`
                    )}
                  </p>
                </div>
              )}

              {step === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-sm text-muted-foreground"
                >
                  <Trans>Redirecting...</Trans>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
