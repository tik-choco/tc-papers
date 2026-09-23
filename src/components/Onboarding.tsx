// First-run wizard shown by app.tsx as a modal: welcome -> LLM connection (optional) -> feature tour.
// Every step is skippable and closing at any point counts as "done" (the caller owns the flag via
// `onClose`); the settings dialog can re-open it any time.
// Ported from tc-books' src/components/Onboarding.tsx.

import { useState } from 'preact/hooks'
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Cloud, Cpu, FileUp, Library, Plug, RefreshCw, ScanText, Sparkles, Waypoints, X } from 'lucide-preact'
import { fetchModels, formatMistaiError, MESSAGES_EN, MESSAGES_JA, streamChatCompletion } from '@tik-choco/mistai'
import { emptyLlmConfig, ensurePreset, ensureProvider, isNetworkProviderBaseUrl, loadLlmConfig, normalizeBaseUrl, resolvePreset, saveLlmConfig, LLM_CONFIG_KEY } from '@tik-choco/mistai/llm-config'
import type { Copy, Locale } from '../copy'

const STEP_COUNT = 3

interface LlmDraft { baseUrl: string; apiKey: string; model: string }
type TestState = { phase: 'idle' } | { phase: 'busy' } | { phase: 'ok' } | { phase: 'error'; message: string }

const inputValue = (e: Event) => (e.target as HTMLInputElement).value
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) })

/** Model name input; the refresh button fills a datalist via fetchModels and silently falls back to typing. */
function ModelField({ value, baseUrl, apiKey, t, onChange }: { value: string; baseUrl: string; apiKey: string; t: Copy['onboarding']; onChange: (model: string) => void }) {
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  async function refresh() {
    if (!baseUrl.trim()) return
    setLoading(true)
    try { setOptions(await fetchModels({ baseUrl: normalizeBaseUrl(baseUrl), apiKey }, timedFetch)) } catch { /* fall back to typing */ } finally { setLoading(false) }
  }
  return <div class="ob-model-row">
    <input class="ob-input" list="ob-model-options" type="text" placeholder={t.modelPlaceholder} value={value} onInput={e => onChange(inputValue(e))} />
    <datalist id="ob-model-options">{options.map(model => <option key={model} value={model} />)}</datalist>
    <button class="icon" type="button" onClick={() => void refresh()} disabled={loading || !baseUrl.trim()} title={t.fetchModels} aria-label={t.fetchModels}>
      {loading ? <span class="spinner" /> : <RefreshCw size={15} />}
    </button>
  </div>
}

export function Onboarding({ t: copy, locale, onClose }: { t: Copy; locale: Locale; onClose: () => void }) {
  const t = copy.onboarding
  const [step, setStep] = useState(0)
  // Start from the shared default preset so re-running the wizard edits the real current connection.
  const [llm, setLlm] = useState<LlmDraft>(() => {
    const target = resolvePreset(loadLlmConfig() ?? emptyLlmConfig())
    if (!target || isNetworkProviderBaseUrl(target.baseUrl)) return { baseUrl: '', apiKey: '', model: '' }
    return { baseUrl: target.baseUrl, apiKey: target.apiKey, model: target.model }
  })
  const [test, setTest] = useState<TestState>({ phase: 'idle' })

  function update(patch: Partial<LlmDraft>) {
    setLlm(prev => ({ ...prev, ...patch }))
    setTest({ phase: 'idle' }) // edited values invalidate a previous test result
  }

  /** Writes the draft into the shared default preset: edits it in place, or creates a provider + preset and makes it the default. */
  function save() {
    const config = loadLlmConfig() ?? emptyLlmConfig()
    const providerId = ensureProvider(config, { baseUrl: normalizeBaseUrl(llm.baseUrl), apiKey: llm.apiKey })
    const current = config.presets.find(p => p.id === config.defaultPresetId)
    const currentProvider = config.providers.find(p => p.id === current?.providerId)
    if (current && !(currentProvider && isNetworkProviderBaseUrl(currentProvider.baseUrl))) {
      current.providerId = providerId
      current.model = llm.model.trim()
    } else {
      config.defaultPresetId = ensurePreset(config, { providerId, model: llm.model.trim(), label: llm.model.trim() })
    }
    saveLlmConfig(config)
    window.dispatchEvent(new StorageEvent('storage', { key: LLM_CONFIG_KEY }))
  }

  async function runTest() {
    if (test.phase === 'busy') return
    setTest({ phase: 'busy' })
    try {
      await streamChatCompletion({ baseUrl: normalizeBaseUrl(llm.baseUrl), apiKey: llm.apiKey, model: llm.model.trim() }, [{ role: 'user', content: t.testPrompt }], undefined, timedFetch)
      setTest({ phase: 'ok' })
    } catch (error) {
      setTest({ phase: 'error', message: formatMistaiError(error, locale === 'ja' ? MESSAGES_JA : MESSAGES_EN, t.testFailed) })
    }
  }

  function next() {
    // Leaving the fields blank keeps the current settings untouched.
    if (llm.baseUrl.trim() && llm.model.trim()) save()
    setStep(2)
  }

  const features = [
    { icon: FileUp, ...t.features.add },
    { icon: ClipboardCheck, ...t.features.review },
    { icon: Waypoints, ...t.features.study },
    { icon: ScanText, ...t.features.ocr },
    { icon: Library, ...t.features.viewer },
    { icon: Cloud, ...t.features.backup },
  ]

  return <div class="modal-backdrop">
    <div class="ob-card" role="dialog" aria-modal="true" aria-label={t.label}>
      <button class="icon ob-close" type="button" onClick={onClose} title={copy.close} aria-label={copy.close}><X size={18} /></button>

      {step === 0 && <div class="ob-body">
        <div class="ob-hero"><Sparkles size={34} /></div>
        <h2 class="ob-title">{t.welcome}</h2>
        <p>{t.intro}</p>
        <p>{t.introSetup}</p>
      </div>}

      {step === 1 && <div class="ob-body">
        <div class="ob-step-head"><Cpu size={20} /><h2 class="ob-title">{t.llmTitle}</h2></div>
        <p>{t.llmLead}</p>
        <label class="ob-field"><span>{t.baseUrl}</span>
          <input class="ob-input" type="text" placeholder="https://api.openai.com/v1 / http://localhost:1234/v1" value={llm.baseUrl} onInput={e => update({ baseUrl: inputValue(e) })} />
        </label>
        <label class="ob-field"><span>{t.apiKey}</span>
          <input class="ob-input" type="password" placeholder="sk-..." value={llm.apiKey} onInput={e => update({ apiKey: inputValue(e) })} />
        </label>
        <div class="ob-field"><span>{t.model}</span>
          <ModelField value={llm.model} baseUrl={llm.baseUrl} apiKey={llm.apiKey} t={t} onChange={model => update({ model })} />
        </div>
        <div class="ob-test-row">
          <button class="ghost ob-outline" type="button" onClick={() => void runTest()} disabled={test.phase === 'busy' || !llm.baseUrl.trim() || !llm.model.trim()}>
            {test.phase === 'busy' ? <span class="spinner" /> : <Plug size={15} />}{test.phase === 'busy' ? t.testing : t.test}
          </button>
          {test.phase === 'ok' && <span class="ob-ok"><Check size={15} />{t.testOk}</span>}
        </div>
        {test.phase === 'error' && <p class="error-text" role="alert">{t.testFailed}: {test.message}</p>}
        <p class="muted">{t.llmNote}</p>
      </div>}

      {step === 2 && <div class="ob-body">
        <div class="ob-step-head"><Check size={20} /><h2 class="ob-title">{t.doneTitle}</h2></div>
        <ul class="ob-features">
          {features.map(({ icon: Icon, name, text }) => <li key={name}><Icon size={16} /><span><strong>{name}</strong> — {text}</span></li>)}
        </ul>
        <p class="muted">{t.doneNote}</p>
      </div>}

      <footer class="ob-footer">
        <div class="ob-dots" aria-hidden="true">
          {Array.from({ length: STEP_COUNT }, (_, i) => <span key={i} class={i === step ? 'active' : ''} />)}
        </div>
        <div class="ob-actions">
          {step > 0 && <button class="ghost" type="button" onClick={() => setStep(step - 1)}><ArrowLeft size={15} />{t.back}</button>}
          {step === 0 && <button class="primary" type="button" onClick={() => setStep(1)}>{t.start}<ArrowRight size={15} /></button>}
          {step === 1 && <button class="primary" type="button" onClick={next}>{llm.baseUrl.trim() && llm.model.trim() ? t.saveNext : t.skip}<ArrowRight size={15} /></button>}
          {step === 2 && <button class="primary" type="button" onClick={onClose}><Check size={15} />{t.finish}</button>}
        </div>
      </footer>
    </div>
  </div>
}
