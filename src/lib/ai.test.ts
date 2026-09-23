import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyLlmConfig, saveLlmConfig } from '@tik-choco/mistai/llm-config'
import { aiConfigured, consumer, loadAiPreferences, parseReview, provideChat, resolveAiRoute, reviewPaper, saveAiPreferences, sharedTargets, streamingField } from './ai'

const mocks = vi.hoisted(() => ({ requestChat: vi.fn(), stream: vi.fn() }))
vi.mock('@tik-choco/mistai', () => ({
  ConsumerClient: class { requestChat(...args: unknown[]) { return mocks.requestChat(...args) } connect() {} disconnect() {} },
  createSharedNodeScope: (fn: unknown) => fn,
  streamChatCompletion: mocks.stream,
}))
const RESPONSE = JSON.stringify({
  title: 'Sparse attention', summary: 's', strengths: ['a'], weaknesses: ['b'], questions: [], fatalFlaws: [],
  criteria: { soundness: { score: 4, confidence: 2, rationale: 'r', evidence: [{ page: 1, quote: 'q' }] }, novelty: { score: 9 } },
})
beforeEach(() => { localStorage.clear(); mocks.stream.mockResolvedValue(RESPONSE) })
afterEach(() => vi.clearAllMocks())
function configured() {
  const config = emptyLlmConfig()
  config.providers = [{ id: 'api', label: 'Test API', baseUrl: 'https://example.test/v1', apiKey: 'test-key' }, { id: 'network', label: 'AI Network', baseUrl: 'mist-network://paper-room', apiKey: '' }]
  config.presets = [{ id: 'direct', label: 'Direct', providerId: 'api', model: 'upstream-model' }, { id: 'remote', label: 'Remote label', providerId: 'network', model: 'Advertised model name' }]
  config.defaultPresetId = 'direct'
  config.network.roomId = 'shared-room'
  saveLlmConfig(config)
  return config
}

describe('parseReview', () => {
  it('clamps scores, defaults missing criteria to neutral, and tolerates code fences', () => {
    const r = parseReview('```json\n' + RESPONSE + '\n```', 'm')
    expect(r.criteria.soundness).toEqual({ score: 4, confidence: 2, rationale: 'r', evidence: [{ page: 1, quote: 'q' }] })
    expect(r.criteria.novelty.score).toBe(5)
    expect(r.criteria.clarity).toMatchObject({ score: 3, confidence: 1, evidence: [] })
    expect(r.title).toBe('Sparse attention')
  })
  it('parses constructive comments and the path to acceptance', () => {
    const raw = JSON.parse(RESPONSE)
    raw.overall = ' Worth saving. '
    raw.pathToAcceptance = ['Add ablations', 7]
    raw.comments = [{ page: '2', section: 'Method', severity: 'major', comment: 'c', suggestion: 's' }, { severity: 'odd', comment: 'x' }, { page: 1 }, 'bad']
    const r = parseReview(JSON.stringify(raw), 'm')
    expect(r.overall).toBe('Worth saving.')
    expect(r.pathToAcceptance).toEqual(['Add ablations'])
    expect(r.comments).toEqual([
      { page: 2, section: 'Method', severity: 'major', comment: 'c', suggestion: 's' },
      { page: null, section: '', severity: 'minor', comment: 'x', suggestion: '' },
    ])
  })
  it('detects which field the model is streaming', () => {
    expect(streamingField('{"title":"t","summary":"s","criteria":{"soundness":{"score":4},"novelty":{')).toBe('novelty')
    expect(streamingField('{"title":"t"')).toBeUndefined()
    expect(streamingField('... "comments": [{"page": 1')).toBe('comments')
  })
  it('rejects non-JSON and responses without any criterion score', () => {
    expect(() => parseReview('not JSON', 'm')).toThrow('AI_INVALID_RESPONSE')
    expect(() => parseReview('{"summary":"x"}', 'm')).toThrow('AI_INVALID_RESPONSE')
  })
})

describe('AI routing', () => {
  it('reviews through the shared direct target', async () => {
    configured()
    const r = await reviewPaper('[Page 1]\nPaper text', 'en')
    expect(r.model).toBe('upstream-model')
    expect(mocks.stream.mock.calls[0][0]).toMatchObject({ model: 'upstream-model', apiKey: 'test-key' })
    expect(mocks.stream.mock.calls[0][1][0].content).toContain('soundness')
  })
  it('reports streaming progress', async () => {
    configured()
    mocks.stream.mockImplementation(async (_config: unknown, _messages: unknown, onDelta?: (d: string) => void) => {
      onDelta?.('{"summary":"s","criteria":{"soundness"'); onDelta?.(':{}}')
      return RESPONSE
    })
    const seen: [number, string | undefined][] = []
    await reviewPaper('[Page 1]\nPaper text', 'en', (chars, field) => seen.push([chars, field]))
    expect(seen).toEqual([[38, 'soundness'], [42, 'soundness']])
  })
  it('routes a network preset to its own room with the advertised model', async () => {
    const config = configured(); config.defaultPresetId = 'remote'; saveLlmConfig(config)
    mocks.requestChat.mockResolvedValue(RESPONSE)
    await reviewPaper('Paper text', 'ja')
    expect(consumer.roomId).toBe('paper-room')
    expect(mocks.requestChat).toHaveBeenCalledWith('paper-room', expect.any(Array), { model: 'Advertised model name' })
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it('uses the shared room in network auto mode', () => {
    const config = configured()
    expect(resolveAiRoute(config, { ...loadAiPreferences(), mode: 'network' }, 'review')).toEqual({ kind: 'network', roomId: 'shared-room', model: undefined })
  })
  it('reports configuration state and rejects empty text', async () => {
    expect(aiConfigured('review')).toBe(false)
    await expect(reviewPaper('text', 'en')).rejects.toThrow('AI_NOT_CONFIGURED')
    configured()
    expect(aiConfigured('review')).toBe(true)
    await expect(reviewPaper('[Page 1]\n', 'en')).rejects.toThrow('AI_NO_TEXT')
  })
  it('never exposes unselected or network presets as a provider', async () => {
    const config = configured()
    const prefs = { ...loadAiPreferences(), providerEnabled: true, sharedPresetIds: ['missing', 'remote'] }
    expect(sharedTargets(config, prefs)).toEqual([])
    saveAiPreferences(prefs)
    await expect(provideChat([], 'Direct', () => {})).rejects.toThrow('not shared')
  })
})
