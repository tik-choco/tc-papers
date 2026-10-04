// First-run guide: welcome -> shared AI settings (optional) -> feature tour.
import { useState } from 'preact/hooks'
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Cloud, Cpu, FileUp, Library, ScanText, Sparkles, Waypoints, X } from 'lucide-preact'
import { LlmSettings } from '@tik-choco/mistai/preact'
import { loadAiPreferences } from '../lib/ai'
import { saveAiPreferences, subscribeAiPreferences } from '../lib/aiPreferences'
import { AI_COPY, settingsLocale } from '../aiCopy'
import type { Copy, Locale } from '../copy'

const STEP_COUNT = 3
const localSettings = { get: loadAiPreferences, set: saveAiPreferences, subscribe: subscribeAiPreferences }

export function Onboarding({ t: copy, locale, onClose }: { t: Copy; locale: Locale; onClose: () => void }) {
  const t = copy.onboarding
  const lang = settingsLocale(locale), ai = AI_COPY[lang]
  const [step, setStep] = useState(0)
  const features = [
    { icon: FileUp, ...t.features.add },
    { icon: ClipboardCheck, ...t.features.review },
    { icon: Waypoints, ...t.features.study },
    { icon: ScanText, ...t.features.ocr },
    { icon: Library, ...t.features.viewer },
    { icon: Cloud, ...t.features.backup },
  ]
  return <div class="modal-backdrop">
    <div class={`ob-card ${step === 1 ? 'ob-setup' : ''}`} role="dialog" aria-modal="true" aria-label={t.label}>
      <button class="icon ob-close" type="button" onClick={onClose} title={copy.close} aria-label={copy.close}><X size={18} /></button>
      {step === 0 && <div class="ob-body">
        <div class="ob-hero"><Sparkles size={34} /></div>
        <h2 class="ob-title">{t.welcome}</h2><p>{t.intro}</p><p>{t.introSetup}</p>
      </div>}
      {step === 1 && <div class="ob-body">
        <div class="ob-step-head"><Cpu size={20} /><h2 class="ob-title">{t.llmTitle}</h2></div>
        <p class="muted">{ai.note}</p>
        <LlmSettings locale={lang} localSettings={localSettings}
          tasks={(['review', 'study', 'ocr'] as const).map(id => ({ id, label: ai[id], reasoning: true }))} />
      </div>}
      {step === 2 && <div class="ob-body">
        <div class="ob-step-head"><Check size={20} /><h2 class="ob-title">{t.doneTitle}</h2></div>
        <ul class="ob-features">{features.map(({ icon: Icon, name, text }) => <li key={name}><Icon size={16} /><span><strong>{name}</strong> - {text}</span></li>)}</ul>
        <p class="muted">{t.doneNote}</p>
      </div>}
      <footer class="ob-footer">
        <div class="ob-dots" aria-hidden="true">{Array.from({ length: STEP_COUNT }, (_, i) => <span key={i} class={i === step ? 'active' : ''} />)}</div>
        <div class="ob-actions">
          {step > 0 && <button class="ghost" type="button" onClick={() => setStep(step - 1)}><ArrowLeft size={15} />{t.back}</button>}
          {step === 0 && <button class="primary" type="button" onClick={() => setStep(1)}>{t.start}<ArrowRight size={15} /></button>}
          {step === 1 && <button class="primary" type="button" onClick={() => setStep(2)}>{ai.continue}<ArrowRight size={15} /></button>}
          {step === 2 && <button class="primary" type="button" onClick={onClose}><Check size={15} />{t.finish}</button>}
        </div>
      </footer>
    </div>
  </div>
}
