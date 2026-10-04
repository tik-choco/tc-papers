import { Sparkles } from 'lucide-preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { LlmSettings, useLlmConfig, useRoomProviders, type LlmLocalSettings } from '@tik-choco/mistai/preact'
import { loadAiPreferences } from '../lib/ai'
import { saveAiPreferences, subscribeAiPreferences } from '../lib/aiPreferences'
import { rooms } from '../lib/mist'
import { AI_COPY, settingsLocale } from '../aiCopy'
import type { Locale } from '../copy'
import '@tik-choco/mistai/ui.css'

export function useAiNetwork(settingsOpen: boolean) {
  const { config } = useLlmConfig()
  const [preferences, setPreferences] = useState(loadAiPreferences)
  const [error, setError] = useState(false)
  useEffect(() => subscribeAiPreferences(() => setPreferences(loadAiPreferences())), [])
  useRoomProviders({
    config, roomProvide: preferences.roomProvide, consumers: rooms,
    taskRefs: Object.values(preferences.tasks).map(task => task.ref), settingsOpen,
  })
  const localSettings = useMemo(() => ({
    get: loadAiPreferences,
    set(next: LlmLocalSettings) {
      try { saveAiPreferences(next); setError(false) } catch { setError(true) }
    },
    subscribe: subscribeAiPreferences,
  }), [])
  return { config, preferences, localSettings, error }
}

export function AiSettings({ locale, network, onClose, onSetup }: {
  locale: Locale; network: ReturnType<typeof useAiNetwork>; onClose: () => void; onSetup: () => void;
}) {
  const lang = settingsLocale(locale), t = AI_COPY[lang]
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.model-picker-overlay:not([inert])')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return <LlmSettings locale={lang} title={t.title} onClose={onClose}
    localSettings={network.localSettings}
    headerSection={<><p class="muted">{t.note}</p>{network.error && <p role="alert" class="error-text">{t.storageError}</p>}</>}
    extraSections={<div class="modal-foot"><button class="ghost" onClick={onSetup}><Sparkles size={15} />{t.reopen}</button></div>}
    tasks={(['review', 'study', 'ocr'] as const).map(id => ({ id, label: t[id], reasoning: true }))} />
}
