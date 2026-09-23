import { useEffect, useState } from 'preact/hooks'
import { LlmSettings, useConsumerConnection, useConsumerStatus, useNetworkProvider } from '@tik-choco/mistai/preact'
import { LLM_CONFIG_KEY, advertisedModelName, ensurePreset, ensureProvider, isNetworkProviderBaseUrl, networkProviderBaseUrl, saveLlmConfig, subscribeLlmConfig } from '@tik-choco/mistai/llm-config'
import { consumer, createNetworkNode, loadAiPreferences, provideChat, saveAiPreferences, sharedConfig, sharedTargets, type AiPreferences } from '../lib/ai'
import { COPY, type Locale } from '../copy'
import '@tik-choco/mistai/ui.css'

export function useAiNetwork() {
  const [config, setConfig] = useState(sharedConfig)
  const [preferences, setPreferences] = useState(loadAiPreferences)
  const [error, setError] = useState(false)
  useEffect(() => {
    const refresh = () => {
      const latest = sharedConfig()
      setConfig(current => JSON.stringify(current) === JSON.stringify(latest) ? current : latest)
    }
    const unsubscribe = subscribeLlmConfig(refresh)
    // The shared settings component owns its writes and has no onChange callback.
    const timer = window.setInterval(refresh, 500)
    return () => { unsubscribe(); clearInterval(timer); consumer.disconnect() }
  }, [])
  const defaultPreset = config.presets.find(p => p.id === config.defaultPresetId)
  const defaultProvider = config.providers.find(p => p.id === defaultPreset?.providerId)
  const networkDefault = defaultProvider && isNetworkProviderBaseUrl(defaultProvider.baseUrl)
  const roomId = networkDefault ? defaultProvider.baseUrl.slice('mist-network://'.length) : config.network.roomId
  useConsumerConnection(consumer, { enabled: preferences.mode === 'network' || Boolean(networkDefault), roomId })
  const status = useConsumerStatus(consumer)
  const activeRoomId = consumer.roomId
  const targets = sharedTargets(config, preferences)
  const provider = useNetworkProvider({
    enabled: preferences.providerEnabled && targets.length > 0,
    roomId: config.network.roomId, createNode: createNetworkNode,
    nodeIdStorageKey: 'tc-papers:network-node-v1', callLlm: provideChat, advertisedModels: targets.map(advertisedModelName),
  })
  useEffect(() => {
    if (status.phase !== 'connected' || !activeRoomId) return
    const models = [...new Set(status.providers.filter(p => p.services.includes('chat')).flatMap(p => p.models || []))]
    if (!models.length) return
    const latest = sharedConfig(), before = JSON.stringify(latest)
    const id = ensureProvider(latest, { label: 'AI Network', baseUrl: networkProviderBaseUrl(activeRoomId), apiKey: '' })
    for (const model of models) ensurePreset(latest, { providerId: id, model, label: model })
    if (before !== JSON.stringify(latest)) { saveLlmConfig(latest); setConfig(latest); window.dispatchEvent(new StorageEvent('storage', { key: LLM_CONFIG_KEY })) }
  }, [status, activeRoomId])
  function update(patch: Partial<AiPreferences>) {
    const next = { ...preferences, ...patch }
    try { saveAiPreferences(next); setPreferences(next); setError(false) } catch { setError(true) }
  }
  return { config, preferences, update, status, provider, error }
}

export function AiSettings({ locale, network }: { locale: Locale; network: ReturnType<typeof useAiNetwork> }) {
  const { preferences, update, status, provider, error } = network
  const t = COPY[locale]
  return <section class="ai-settings">
    <p class="muted">{t.aiNote}</p>
    {error && <p role="alert" class="error-text">{t.errors.PDF_STORAGE}</p>}
    <LlmSettings lang={locale}
      connection={{ mode: preferences.mode, onModeChange: mode => update({ mode }) }}
      consumerStatus={status}
      provider={{ enabled: preferences.providerEnabled, onEnabledChange: providerEnabled => update({ providerEnabled }), sharedPresetIds: preferences.sharedPresetIds, onSharedPresetIdsChange: sharedPresetIds => update({ sharedPresetIds }), status: provider }}
      defaultReasoningEffort={preferences.reasoning} onDefaultReasoningEffortChange={reasoning => update({ reasoning })}
      tasks={(['review', 'study', 'ocr'] as const).map(key => ({ key, label: t.tasks[key], presetId: preferences.tasks[key], reasoningEffort: preferences.reasoning, onPresetChange: id => update({ tasks: { ...preferences.tasks, [key]: id } }), onReasoningEffortChange: reasoning => update({ reasoning }) }))} />
  </section>
}
