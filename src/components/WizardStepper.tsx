import React from 'react';
import { Check } from 'lucide-react';
import type { WizardStep } from '../types/studio';

interface WizardStepperProps {
  currentStep: WizardStep;
  maxReachedStep: WizardStep;
  onSelectStep: (step: WizardStep) => void;
  isProcessing: boolean;
}

const WIZARD_STEPS: Array<{ step: WizardStep; shortLabel: string }> = [
  { step: 1, shortLabel: 'ဗီဒီယို' },
  { step: 2, shortLabel: 'အသံနှုန်း' },
  { step: 3, shortLabel: 'စာတန်း/ပုံ' },
  { step: 4, shortLabel: 'Export' },
  { step: 5, shortLabel: 'ဖန်တီးနေ' },
  { step: 6, shortLabel: 'Telegram' },
];

export const WizardStepper: React.FC<WizardStepperProps> = ({
  currentStep,
  maxReachedStep,
  onSelectStep,
  isProcessing,
}) => {
  return (
    <nav aria-label="ဖန်တီးမှု အဆင့်များ" className="mb-6">
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {WIZARD_STEPS.map((item) => {
          const isCurrent = currentStep === item.step;
          const isDone = currentStep > item.step;
          const canJump =
            !isProcessing &&
            item.step !== 5 &&
            item.step <= maxReachedStep &&
            item.step !== currentStep;

          return (
            <li key={item.step}>
              <button
                type="button"
                disabled={!canJump}
                onClick={() => canJump && onSelectStep(item.step)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex w-full items-center gap-1.5 sm:gap-2 rounded-xl border px-2 sm:px-3 py-2 text-left transition-all ${
                  isCurrent
                    ? 'border-blue-500/70 bg-blue-600/20 text-white blue-glow-ring'
                    : isDone
                      ? 'border-blue-500/30 bg-[#10141D] text-slate-200 hover:border-blue-400/50 cursor-pointer'
                      : 'border-white/10 bg-[#10141D]/60 text-slate-500'
                }`}
              >
                <span
                  className={`flex h-5 w-5 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded-lg text-[11px] sm:text-xs font-bold font-mono-tabular ${
                    isCurrent
                      ? 'bg-blue-600 text-white'
                      : isDone
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-white/5 text-slate-500'
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : item.step}
                </span>
                <span className="min-w-0 truncate text-[11px] sm:text-xs font-medium">
                  {item.shortLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
