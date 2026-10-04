import { isModelRef, presetIdToRef, providerKind, roomIdFromBaseUrl, type SharedLlmConfigV1 } from '@tik-choco/mistai/llm-config'
import type { LlmLocalSettings, ReasoningEffort, TaskModelV1 } from '@tik-choco/mistai/preact'

export type AiTask = 'review' | 'study' | 'ocr'
export type AiPreferences = LlmLocalSettings & { v: 2; tasks: Record<AiTask, TaskModelV1> }
export const AI_PREFERENCES_KEY = 'tc-papers:ai-v1'
const CHANGE_EVENT = 'tc-papers:ai-changed'
const TASKS: AiTask[] = ['review', 'study', 'ocr']
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const effort = (value: unknown): ReasoningEffort | undefined => EFFORTS.includes(value as string) ? value as ReasoningEffort : undefined

/** Keep migration independent of transport so it can run before settings or any AI call. */
export function migrateAiPreferences(raw: Record<string, unknown>, config: SharedLlmConfigV1): AiPreferences {
  const previous = raw.tasks && typeof raw.tasks === 'object' ? raw.tasks as Record<string, unknown> : {}
  const tasks = {} as AiPreferences['tasks']
  for (const key of TASKS) {
    const value = previous[key]
    if (raw.v === 2) {
      const task = value && typeof value === 'object' ? value as Partial<TaskModelV1> : {}
      tasks[key] = { ...(isModelRef(task.ref) ? { ref: task.ref } : {}), reasoningEffort: effort(task.reasoningEffort) ?? 'none' }
    } else {
      // Understanding mode used the review assignment when it had no assignment of its own.
      const id = typeof value === 'string' && value ? value : key === 'study' && typeof previous.review === 'string' ? previous.review : ''
      const preset = config.presets.find(p => p.id === (id || config.defaultPresetId))
      tasks[key] = { ref: presetIdToRef(config, id), reasoningEffort: effort(raw.reasoning) ?? effort(preset?.reasoningEffort) ?? 'none' }
    }
  }
  const roomProvide: LlmLocalSettings['roomProvide'] = raw.v === 2 && raw.roomProvide && typeof raw.roomProvide === 'object'
    ? raw.roomProvide as LlmLocalSettings['roomProvide'] : {}
  if (raw.v !== 2) {
    const room = config.providers.find(p => providerKind(p) === 'room' && roomIdFromBaseUrl(p.baseUrl) === config.network.roomId.trim())
    if (room) {
      const ids = Array.isArray(raw.sharedPresetIds) ? raw.sharedPresetIds : []
      const shared = ids.flatMap(id => {
        const ref = typeof id === 'string' ? presetIdToRef(config, id) : undefined
        return ref && config.providers.some(p => p.id === ref.providerId && providerKind(p) === 'http') ? [ref] : []
      }).filter((ref, i, refs) => refs.findIndex(r => r.providerId === ref.providerId && r.model === ref.model) === i)
      roomProvide[room.id] = { enabled: raw.providerEnabled === true || raw.networkProviderEnabled === true, shared }
    }
  }
  const recentModels = Array.isArray(raw.recentModels) ? raw.recentModels.filter(isModelRef)
    .filter((ref, i, refs) => refs.findIndex(r => r.providerId === ref.providerId && r.model === ref.model) === i).slice(0, 8) : []
  return { v: 2, tasks, roomProvide, recentModels }
}

export function loadAiPreferences(config: SharedLlmConfigV1): AiPreferences {
  let raw: Record<string, unknown> = {}
  try { raw = JSON.parse(localStorage.getItem(AI_PREFERENCES_KEY) || '{}') || {} } catch { /* use defaults */ }
  const next = migrateAiPreferences(raw, config)
  if (raw.v !== 2) saveAiPreferences(next)
  return next
}

export function saveAiPreferences(value: LlmLocalSettings) {
  localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify({ ...value, v: 2 }))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeAiPreferences(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === AI_PREFERENCES_KEY || event.key === null) callback() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE_EVENT, callback) }
}
