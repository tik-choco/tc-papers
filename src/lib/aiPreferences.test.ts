import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyLlmConfig, migrateSharedLlmConfig, saveLlmConfig } from '@tik-choco/mistai/llm-config'
import { AI_PREFERENCES_KEY, loadAiPreferences, migrateAiPreferences, saveAiPreferences } from './aiPreferences'

beforeEach(() => localStorage.clear())
function legacy() {
  const config = emptyLlmConfig()
  config.providers = [
    { id: 'http', label: 'Local', baseUrl: 'https://example.test/v1', apiKey: '', models: Array.from({ length: 300 }, (_, i) => `model-${i}`) },
    { id: 'disabled', label: 'Disabled', baseUrl: 'https://disabled.test/v1', apiKey: '', enabled: false },
    { id: 'mirror', label: 'Room', baseUrl: 'mist-network://old-room', apiKey: '' },
  ]
  config.presets = [
    { id: 'review-id', providerId: 'http', label: 'Old review', model: 'manual-model', reasoningEffort: 'high', temperature: 0.7 },
    { id: 'disabled-id', providerId: 'disabled', label: 'Old disabled', model: 'disabled-model' },
    { id: 'mirror-id', providerId: 'mirror', label: 'Old mirror', model: 'room-model' },
  ]
  config.defaultPresetId = 'review-id'
  config.network.roomId = 'old-room'
  return config
}
describe('AI preferences migration', () => {
  it('preserves legacy shared fields, migrates caches/default, and is idempotent', () => {
    const config = legacy(), original = structuredClone(config)
    expect(migrateSharedLlmConfig(config).changed).toBe(true)
    expect(config.defaultModel).toEqual({ providerId: 'http', model: 'manual-model' })
    expect(config.providers[0].models).toHaveLength(301)
    expect(config.presets).toEqual(original.presets)
    expect(config.defaultPresetId).toBe(original.defaultPresetId)
    expect(config.network).toEqual(original.network)
    expect(migrateSharedLlmConfig(config).changed).toBe(false)
    saveLlmConfig(config)
  })
  it('migrates task ids, inherited study and sharing to refs exactly once', () => {
    const config = legacy()
    migrateSharedLlmConfig(config)
    localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify({
      tasks: { review: 'review-id', study: '', ocr: 'disabled-id' },
      providerEnabled: true, sharedPresetIds: ['review-id', 'review-id', 'mirror-id', 'missing'],
    }))
    const next = loadAiPreferences(config)
    expect(next.tasks.review).toEqual({ ref: { providerId: 'http', model: 'manual-model' }, reasoningEffort: 'high' })
    expect(next.tasks.study).toEqual(next.tasks.review)
    expect(next.tasks.ocr.ref).toEqual({ providerId: 'disabled', model: 'disabled-model' })
    expect(next.roomProvide.mirror).toEqual({ enabled: true, shared: [{ providerId: 'http', model: 'manual-model' }] })
    const written = localStorage.getItem(AI_PREFERENCES_KEY)
    config.presets[0].model = 'later-legacy-edit'
    expect(loadAiPreferences(config)).toEqual(next)
    expect(localStorage.getItem(AI_PREFERENCES_KEY)).toBe(written)
  })
  it('keeps explicit effort, skips retired room mirrors and never invents missing refs', () => {
    const next = migrateAiPreferences({ reasoning: 'none', tasks: { review: 'review-id', study: 'mirror-id', ocr: 'missing' } }, legacy())
    expect(next.tasks.review.reasoningEffort).toBe('none')
    expect(next.tasks.study.ref).toBeUndefined()
    expect(next.tasks.ocr.ref).toBeUndefined()
  })
  it('does not rewrite new refs, per-task efforts or room sharing on subsequent loads', () => {
    const config = legacy(), next = migrateAiPreferences({}, config)
    next.tasks.ocr = { ref: { providerId: 'deleted', model: 'kept' }, reasoningEffort: 'max' }
    next.roomProvide.second = { enabled: false, shared: [{ providerId: 'disabled', model: 'kept' }] }
    saveAiPreferences(next)
    const changed = vi.fn()
    window.addEventListener('tc-papers:ai-changed', changed)
    expect(loadAiPreferences(config)).toEqual(next)
    expect(changed).not.toHaveBeenCalled()
    window.removeEventListener('tc-papers:ai-changed', changed)
  })
})
