import React from 'react';
import { Coins } from 'lucide-react';

interface HeaderBarProps {
  credits: number;
  onOpenCredits: () => void;
  onOpenDeployGuide: () => void;
  onGoHome: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  credits,
  onOpenCredits,
  onOpenDeployGuide,
  onGoHome,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#090B10]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onGoHome}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 hover:text-blue-400 transition-colors cursor-pointer"
        >
          AlphaRecap Studio
        </button>

        <nav
          aria-label="အဓိက လမ်းညွှန်"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400"
        >
          <button
            type="button"
            onClick={onGoHome}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            စတူဒီယို
          </button>
          <button
            type="button"
            onClick={onOpenCredits}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            KBZPay / PromptPay ခရက်ဒစ်
          </button>
          <button
            type="button"
            onClick={onOpenDeployGuide}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Deploy လမ်းညွှန်
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenCredits}
            aria-label={`ခရက်ဒစ် ဝယ်ယူရန် (${credits} Credits)`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white blue-glow-cta hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Coins className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="font-mono-tabular">{credits}</span>
            <span>ခရက်ဒစ် ဝယ်ယူရန်</span>
          </button>
        </div>
      </div>
    </header>
  );
};
