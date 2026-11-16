import React from 'react';
import { Server, Globe, KeyRound, X } from 'lucide-react';

interface DeployGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeployGuideModal: React.FC<DeployGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deploy-modal-title"
    >
      <div className="glass-panel relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 sm:p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 id="deploy-modal-title" className="font-display text-xl font-bold text-slate-100">
              Render (Backend) နှင့် GitHub Pages (Frontend) Deploy လမ်းညွှန်
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              ကိုယ်ပိုင် Server တွင် 4K FFmpeg၊ Groq Whisper၊ Gemini API နှင့် Telegram Bot ကို တိုက်ရိုက်ချိတ်ဆက်အသုံးပြုပုံ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ပိတ်ရန်"
            className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5 text-sm text-slate-300">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 font-semibold text-slate-100">
              <KeyRound className="h-4 w-4 text-blue-400" />
              <span>၁။ လိုအပ်သော Environment Variables များ</span>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-[#090B10] p-3 font-mono-tabular text-xs text-blue-300 border border-white/10">
{`GEMINI_API_KEY="သင့် Gemini API Key"
GROQ_API_KEY="သင့် Groq API Key"
TELEGRAM_BOT_TOKEN="BotFather မှရသော Bot Token"`}
            </pre>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 font-semibold text-slate-100">
              <Server className="h-4 w-4 text-blue-400" />
              <span>၂။ Render.com တွင် Backend Deploy တင်နည်း</span>
            </div>
            <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-300">
              <li>GitHub Repository အသစ်တစ်ခုထဲသို့ ဖိုင်များကို Push တင်ပါ။</li>
              <li>Render Dashboard တွင် New Web Service ရွေးချယ်ပြီး GitHub Repo ကို ချိတ်ဆက်ပါ။</li>
              <li>Build Command တွင် <code className="text-blue-300">npm install &amp;&amp; npm run build</code> နှင့် Start Command တွင် <code className="text-blue-300">npm start</code> ထည့်ပါ (FFmpeg ပါဝင်သော Docker Runtime ကို အကြံပြုပါသည်)။</li>
              <li>Environment tab တွင် <code className="text-blue-300">GEMINI_API_KEY</code>, <code className="text-blue-300">GROQ_API_KEY</code>, <code className="text-blue-300">TELEGRAM_BOT_TOKEN</code> တို့ကို ထည့်သွင်းပြီး Deploy နှိပ်ပါ။</li>
            </ol>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 font-semibold text-slate-100">
              <Globe className="h-4 w-4 text-blue-400" />
              <span>၃။ GitHub Pages တွင် Frontend တင်နည်း</span>
            </div>
            <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-300">
              <li>Repository Settings &gt; Pages မှ Source ကို GitHub Actions (သို့မဟုတ် <code className="text-blue-300">dist/</code> build output) ရွေးချယ်ပါ။</li>
              <li>API Base URL ကို သင့် Render Backend URL သို့ ညွှန်းပေးပြီး <code className="text-blue-300">npm run build</code> ဖြင့် Static Publish ပြုလုပ်ပါ။</li>
              <li>ပြီးဆုံးပါက ဖိုင်များကို Server ပေါ်တွင် မသိမ်းဆည်းဘဲ Browser ပိတ်သည်နှင့် အလိုအလျောက် ဖျက်ပေးမည်ဖြစ်ပါသည်။</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
