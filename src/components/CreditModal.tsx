import React, { useState } from 'react';
import { CheckCircle2, CreditCard, ShieldCheck, X } from 'lucide-react';
import { CREDIT_PACKAGES } from '../utils/studioLogic';
import type { PaymentMethod } from '../types/studio';

interface CreditModalProps {
  isOpen: boolean;
  currentCredits: number;
  onClose: () => void;
  onSuccessAddCredits: (added: number, messageMy: string) => void;
}

export const CreditModal: React.FC<CreditModalProps> = ({
  isOpen,
  currentCredits,
  onClose,
  onSuccessAddCredits,
}) => {
  const [selectedPkgId, setSelectedPkgId] = useState<string>('creator');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kbzpay');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMy, setErrorMy] = useState<string>('');

  if (!isOpen) return null;

  const selectedPkg = CREDIT_PACKAGES.find((p) => p.id === selectedPkgId) || CREDIT_PACKAGES[1];

  const handleConfirmPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMy('');

    if (referenceNo.trim().length < 6) {
      setErrorMy('ငွေလွှဲပြေစာ နံပါတ် (Transaction ID) အနည်းဆုံး ၆ လုံး ထည့်သွင်းပါ');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: selectedPkg.id,
          paymentMethod,
          referenceNo: referenceNo.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMy(data.errorMy || 'ငွေပေးချေမှု အတည်ပြုရာတွင် အမှားဖြစ်ပွားပါသည်');
        return;
      }
      setReferenceNo('');
      onSuccessAddCredits(data.addedCredits, data.messageMy);
      onClose();
    } catch {
      setErrorMy('ဆာဗာနှင့် ချိတ်ဆက်၍ မရပါ — ပြန်လည်ကြိုးစားပါ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-modal-title"
    >
      <div className="glass-panel relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl p-6 sm:p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 id="credit-modal-title" className="font-display text-xl font-bold text-slate-100">
              ခရက်ဒစ် ဝယ်ယူဖြည့်သွင်းရန်
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              တစ်ကြိမ်တည်း ဝယ်ယူရုံဖြင့် သက်တမ်းကုန်ဆုံးခြင်း မရှိပါ · လစဉ်ကြေး မရှိပါ · လက်ရှိလက်ကျန်{' '}
              <span className="font-mono-tabular font-semibold text-blue-400">{currentCredits}</span> Credits
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

        {/* Package selection */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {CREDIT_PACKAGES.map((pkg) => {
            const active = pkg.id === selectedPkgId;
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelectedPkgId(pkg.id)}
                className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  active
                    ? 'border-blue-500/80 bg-blue-500/12 blue-glow-ring'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <div>
                  <div className="text-xs font-medium text-slate-400">{pkg.nameMy}</div>
                  <div className="mt-1.5 font-mono-tabular text-2xl font-bold text-slate-100">
                    {pkg.credits} <span className="text-xs font-normal text-slate-400">Credits</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">{pkg.descriptionMy}</p>
                </div>
                <div className="mt-4 border-t border-white/10 pt-3 font-mono-tabular text-sm font-semibold text-blue-400">
                  {paymentMethod === 'kbzpay'
                    ? `${pkg.priceMmk.toLocaleString()} MMK`
                    : `${pkg.priceThb.toLocaleString()} THB`}
                </div>
              </button>
            );
          })}
        </div>

        {/* Payment method toggle */}
        <div className="mt-6">
          <span className="block text-sm font-medium text-slate-300">ငွေပေးချေမှုနည်းလမ်း ရွေးချယ်ပါ</span>
          <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-1 border border-white/10">
            <button
              type="button"
              onClick={() => setPaymentMethod('kbzpay')}
              className={`rounded-lg py-2.5 px-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                paymentMethod === 'kbzpay'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              KBZPay (MMK)
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('promptpay')}
              className={`rounded-lg py-2.5 px-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                paymentMethod === 'promptpay'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              PromptPay (THB)
            </button>
          </div>
        </div>

        {/* Payment Details */}
        <div className="mt-5 flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          {/* Clean SVG QR representation */}
          <div className="shrink-0 rounded-xl bg-white p-2.5">
            <svg width="96" height="96" viewBox="0 0 96 96" aria-label="Payment QR Code">
              <rect width="96" height="96" fill="#ffffff" />
              <rect x="8" y="8" width="24" height="24" fill="#0f172a" />
              <rect x="12" y="12" width="16" height="16" fill="#ffffff" />
              <rect x="16" y="16" width="8" height="8" fill="#0f172a" />
              <rect x="64" y="8" width="24" height="24" fill="#0f172a" />
              <rect x="68" y="12" width="16" height="16" fill="#ffffff" />
              <rect x="72" y="16" width="8" height="8" fill="#0f172a" />
              <rect x="8" y="64" width="24" height="24" fill="#0f172a" />
              <rect x="12" y="68" width="16" height="16" fill="#ffffff" />
              <rect x="16" y="72" width="8" height="8" fill="#0f172a" />
              <rect x="40" y="12" width="8" height="8" fill="#0f172a" />
              <rect x="48" y="20" width="8" height="8" fill="#0f172a" />
              <rect x="38" y="38" width="20" height="20" fill="#2563eb" />
              <rect x="44" y="44" width="8" height="8" fill="#ffffff" />
              <rect x="12" y="42" width="12" height="8" fill="#0f172a" />
              <rect x="66" y="44" width="16" height="8" fill="#0f172a" />
              <rect x="42" y="68" width="12" height="16" fill="#0f172a" />
              <rect x="64" y="66" width="20" height="8" fill="#0f172a" />
              <rect x="72" y="78" width="12" height="8" fill="#0f172a" />
            </svg>
          </div>
          <div className="flex-1 text-sm">
            <div className="font-semibold text-slate-100">
              {paymentMethod === 'kbzpay' ? 'KBZPay ဖြင့် ငွေလွှဲရန်' : 'PromptPay ဖြင့် ငွေလွှဲရန်'}
            </div>
            <div className="mt-1.5 space-y-1 text-xs text-slate-300">
              <div>
                အကောင့်အမည် · <span className="font-semibold text-slate-100">AlphaRecap Studio</span>
              </div>
              <div>
                {paymentMethod === 'kbzpay' ? 'KBZPay ဖုန်းနံပါတ်' : 'PromptPay ID'} ·{' '}
                <span className="font-mono-tabular font-semibold text-blue-400">
                  {paymentMethod === 'kbzpay' ? '09-770-442-810' : '096-884-1290'}
                </span>
              </div>
              <div>
                ပေးချေရမည့်ပမာဏ ·{' '}
                <span className="font-mono-tabular font-bold text-slate-100">
                  {paymentMethod === 'kbzpay'
                    ? `${selectedPkg.priceMmk.toLocaleString()} MMK`
                    : `${selectedPkg.priceThb.toLocaleString()} THB`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction verification form */}
        <form onSubmit={handleConfirmPurchase} className="mt-5 space-y-4">
          <div>
            <label htmlFor="tx-ref-input" className="block text-sm font-medium text-slate-300">
              ငွေလွှဲပြေစာ နံပါတ် (Transaction Reference ID)
            </label>
            <input
              id="tx-ref-input"
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="ဥပမာ - KBZ94820184 သို့မဟုတ် PP20261115"
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-[#090B10] px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {errorMy && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
              {errorMy}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0" />
              <span>အကောင့်ဖွင့်စရာမလို · သက်တမ်းကုန်ဆုံးခြင်းမရှိ</span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white blue-glow-cta hover:bg-blue-500 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <CreditCard className="h-4 w-4" />
              <span>{submitting ? 'အတည်ပြုနေပါသည်...' : 'ငွေပေးချေမှု အတည်ပြုမည်'}</span>
              <CheckCircle2 className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
