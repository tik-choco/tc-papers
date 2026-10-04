import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoomConsumers, decode, encode, type MistNodeLike, type ProtocolMessage } from '@tik-choco/mistai'
import { emptyLlmConfig, saveLlmConfig } from '@tik-choco/mistai/llm-config'
import { aiConfigured, chat, loadAiPreferences, ocrPage, parseReview, resolveAiRoute, reviewPaper, saveAiPreferences, sharedConfig, streamingField } from './ai'

const mocks = vi.hoisted(() => ({ requestChat: vi.fn(), requestOpenAi: vi.fn(), stream: vi.fn() }))
vi.mock('@tik-choco/mistai', async importOriginal => ({
  ...await importOriginal<typeof import('@tik-choco/mistai')>(),
  streamChatCompletion: mocks.stream,
}))
vi.mock('./mist', () => ({ rooms: { requestRoomChat: mocks.requestChat, requestRoomOpenAi: mocks.requestOpenAi } }))
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
  it('routes a chosen room ref to its own room using the raw model id', async () => {
    configured()
    const prefs = loadAiPreferences()
    prefs.tasks.review.ref = { providerId: 'network', model: 'raw-remote-model' }
    saveAiPreferences(prefs)
    mocks.requestChat.mockResolvedValue(RESPONSE)
    await reviewPaper('Paper text', 'ja')
    expect(mocks.requestChat).toHaveBeenCalledWith('paper-room', expect.any(Array), { model: 'raw-remote-model', reasoningEffort: 'none', onDelta: undefined })
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)('sends room effort %s on llm_request and streams deltas before completion', async reasoningEffort => {
    configured()
    const prefs = loadAiPreferences()
    prefs.tasks.review = { ref: { providerId: 'network', model: 'raw-remote-model' }, reasoningEffort }
    saveAiPreferences(prefs)
    const sent: ProtocolMessage[] = [], seen: string[] = []
    let event: Parameters<MistNodeLike['onEvent']>[0] = () => {}
    const receive = (message: ProtocolMessage) => event(0, 'provider', encode(message))
    const node: MistNodeLike = {
      init: async () => {}, onEvent: handler => { event = handler }, joinRoom: () => {}, leaveRoom: () => {},
      sendMessage(toId, payload) {
        const message = decode(payload)
        if (!message) return
        sent.push(message)
        if (message.type === 'consumer_hello' && toId === null) {
          receive({ v: 1, type: 'provider_hello', models: ['raw-remote-model'], services: ['chat'] })
        } else if (message.type === 'llm_request') {
          receive({ v: 1, type: 'llm_response_chunk', id: message.id, delta: 'First', seq: 0 })
          expect(seen).toEqual(['First'])
          receive({ v: 1, type: 'llm_response_chunk', id: message.id, delta: ' second', seq: 1 })
          expect(seen).toEqual(['First', 'First second'])
          receive({ v: 1, type: 'llm_response_done', id: message.id })
        }
      },
    }
    const consumers = createRoomConsumers(() => node, { providerWaitTimeoutMs: 100, requestTimeoutMs: 100 })
    mocks.requestChat.mockImplementationOnce(consumers.requestRoomChat)
    try {
      const messages = [{ role: 'user' as const, content: 'review' }]
      await expect(chat('review', messages, full => seen.push(full))).resolves.toEqual({ text: 'First second', model: 'raw-remote-model' })
      expect(mocks.requestChat).toHaveBeenCalledWith('paper-room', messages, { model: 'raw-remote-model', reasoningEffort, onDelta: expect.any(Function) })
      expect(sent.find(message => message.type === 'llm_request')).toEqual({ v: 1, type: 'llm_request', id: expect.any(String), messages, model: 'raw-remote-model', reasoning_effort: reasoningEffort })
      expect(mocks.requestOpenAi).not.toHaveBeenCalled()
      expect(mocks.stream).not.toHaveBeenCalled()
    } finally { consumers.disconnectRoom('paper-room') }
  })
  it('keeps text content parts on streaming room chat', async () => {
    configured()
    const prefs = loadAiPreferences()
    prefs.tasks.study = { ref: { providerId: 'network', model: 'study-model' }, reasoningEffort: 'low' }
    saveAiPreferences(prefs)
    mocks.requestChat.mockResolvedValueOnce('answer')
    await chat('study', [{ role: 'user', content: [{ type: 'text', text: 'one' }, { type: 'text', text: ' two' }] }])
    expect(mocks.requestChat).toHaveBeenCalledWith('paper-room', [{ role: 'user', content: 'one two' }], { model: 'study-model', reasoningEffort: 'low', onDelta: undefined })
    expect(mocks.requestOpenAi).not.toHaveBeenCalled()
  })
  it('uses the room tunnel for OCR image parts with the OCR task effort', async () => {
    configured()
    const prefs = loadAiPreferences()
    prefs.tasks.ocr = { ref: { providerId: 'network', model: 'vision-model' }, reasoningEffort: 'none' }
    prefs.tasks.review.reasoningEffort = 'high'
    saveAiPreferences(prefs)
    mocks.requestOpenAi.mockResolvedValueOnce({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OCR text' } }] }) })
    await expect(ocrPage('data:image/png;base64,a', 2)).resolves.toBe('OCR text')
    expect(mocks.requestOpenAi).toHaveBeenCalledWith('paper-room', { path: '/chat/completions', method: 'POST', contentType: 'application/json', body: expect.any(String) })
    const body = JSON.parse(mocks.requestOpenAi.mock.calls[0][1].body)
    expect(body).toEqual({ model: 'vision-model', reasoning_effort: 'none', stream: false, messages: [{ role: 'user', content: [
      { type: 'text', text: expect.stringContaining('page 2') },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,a', detail: 'high' } },
    ] }] })
    expect(mocks.requestChat).not.toHaveBeenCalled()
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it.each([
    { status: 503, body: 'unavailable', code: 'UPSTREAM_HTTP_ERROR' },
    { status: 200, body: 'invalid JSON', code: 'UPSTREAM_BAD_RESPONSE' },
    { status: 200, body: '{"choices":[]}', code: 'UPSTREAM_BAD_RESPONSE' },
  ])('rejects unusable room vision responses: $status / $body', async ({ status, body, code }) => {
    configured()
    const prefs = loadAiPreferences()
    prefs.tasks.ocr.ref = { providerId: 'network', model: 'vision-model' }
    saveAiPreferences(prefs)
    mocks.requestOpenAi.mockResolvedValueOnce({ status, body, contentType: 'application/json' })
    await expect(ocrPage('data:image/png;base64,a', 1)).rejects.toMatchObject({ code })
    expect(mocks.requestChat).not.toHaveBeenCalled()
  })
  it('resolves disabled or missing refs only through the default and leaves the ref intact', () => {
    configured()
    const config = sharedConfig(), prefs = loadAiPreferences()
    prefs.tasks.review.ref = { providerId: 'missing', model: 'unavailable' }
    expect(resolveAiRoute(config, prefs, 'review')).toMatchObject({ kind: 'api', target: { model: 'upstream-model' } })
    config.providers[0].enabled = false
    expect(resolveAiRoute(config, prefs, 'review')).toEqual({ kind: 'api', target: null })
    expect(prefs.tasks.review.ref).toEqual({ providerId: 'missing', model: 'unavailable' })
  })
  it('reports configuration state and rejects empty text', async () => {
    expect(aiConfigured('review')).toBe(false)
    await expect(reviewPaper('text', 'en')).rejects.toThrow('AI_NOT_CONFIGURED')
    configured()
    expect(aiConfigured('review')).toBe(true)
    await expect(reviewPaper('[Page 1]\n', 'en')).rejects.toThrow('AI_NO_TEXT')
  })
  it('uses independent reasoning efforts for chat and vision without temperature', async () => {
    configured()
    const prefs = loadAiPreferences()
    prefs.tasks.review.reasoningEffort = 'high'
    prefs.tasks.ocr.reasoningEffort = 'none'
    saveAiPreferences(prefs)
    await chat('review', [{ role: 'user', content: 'review' }])
    await chat('ocr', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,a', detail: 'high' } }] }])
    expect(mocks.stream.mock.calls[0][0].reasoningEffort).toBe('high')
    expect(mocks.stream.mock.calls[1][0].reasoningEffort).toBe('none')
    expect(mocks.stream.mock.calls.every(call => !('temperature' in call[0]))).toBe(true)
  })
  it('routes tasks to different rooms without a single-room singleton', async () => {
    const config = configured()
    config.providers.push({ id: 'other-room', label: 'Other room', baseUrl: 'mist-network://second-room', apiKey: '' })
    saveLlmConfig(config)
    const prefs = loadAiPreferences()
    prefs.tasks.review.ref = { providerId: 'network', model: 'first' }
    prefs.tasks.study.ref = { providerId: 'other-room', model: 'second' }
    saveAiPreferences(prefs)
    await chat('review', [])
    await chat('study', [])
    expect(mocks.requestChat.mock.calls.map(call => [call[0], call[2].model])).toEqual([['paper-room', 'first'], ['second-room', 'second']])
  })
})
