import { test, expect, type Page } from '@playwright/test'
import { pdfFixture } from './pdf-fixture'

const API = 'http://127.0.0.1:12345/v1'
const CRITERIA = ['soundness', 'evidence', 'novelty', 'significance', 'clarity', 'reproducibility']
const review = JSON.stringify({
  title: 'Sparse attention', summary: 's', strengths: [], weaknesses: [], questions: [], fatalFlaws: [],
  criteria: Object.fromEntries(CRITERIA.map(id => [id, { score: 4, confidence: 3, rationale: 'r', evidence: [{ page: 1, quote: 'reduces memory by 43% on long documents' }] }])),
})
const story = JSON.stringify({
  thesis: 'Hashing tokens into buckets makes attention on long documents cheap.',
  nodes: [
    { id: 'p', kind: 'problem', label: 'Attention is quadratic', summary: 'Memory grows with the square of the length.', pages: [1], points: [{ text: 'Dense attention compares every pair', page: 1 }] },
    { id: 'm', kind: 'method', label: 'LSH buckets', summary: 'Similar tokens share a bucket, so cost drops to $O(n \\log n)$.', pages: [1], points: [{ text: 'Replaces dense attention', page: 1 }, { text: 'Score $$\\frac{q^\\top k}{\\sqrt{d}}$$ per bucket', page: 1 }] },
    { id: 'r', kind: 'result', label: '43% less memory', summary: 'Consistent gains on three benchmarks.', pages: [1], points: [] },
    { id: 'l', kind: 'limitation', label: 'English only', summary: 'Other languages untested.', pages: [1], points: [] },
  ],
  edges: [{ from: 'p', to: 'm', label: 'addressed by' }, { from: 'm', to: 'r', label: 'shows' }, { from: 'r', to: 'l', label: 'limited by' }],
  followUps: ['Why does hashing keep quality?'],
})

async function setup(page: Page) {
  const asks: string[] = []
  await page.addInitScript(api => localStorage.setItem('tc-shared-llm-config-v1', JSON.stringify({
    v: 1, providers: [{ id: 'test', label: 'Test', baseUrl: api, apiKey: 'test' }],
    presets: [{ id: 'model', label: 'Test model', providerId: 'test', model: 'fixture' }], defaultPresetId: 'model',
    network: { roomId: '' }, updatedAt: new Date().toISOString(),
  })), API)
  await page.route(API + '/chat/completions', async route => {
    const messages = route.request().postDataJSON().messages
    const system = String(messages[0].content)
    if (system.includes('patient tutor')) {
      asks.push(messages[1].content)
      const parent = /\[#(\w+)\] Replaces dense attention/.exec(messages[1].content)?.[1]
      const content = asks.length === 1
        ? { nodeId: 'n2', parentId: parent, points: [{ text: 'Tokens are hashed so neighbours collide', page: 1, children: [{ text: 'Only same-bucket pairs are compared' }] }], followUps: ['What is a bucket?'] }
        : { nodeId: null, newNode: { kind: 'concept', label: 'Hash bucket', summary: 'A group of similar tokens.', from: 'n2', edgeLabel: 'uses' }, points: [{ text: 'A bucket groups similar vectors', page: 1 }], followUps: [] }
      return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(content) } }] } })
    }
    await route.fulfill({ json: { choices: [{ message: { content: system.includes('story') ? story : review } }] } })
  })
  return asks
}

test('understanding mode maps the story and grows the tree with every question', async ({ page }) => {
  const asks = await setup(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'sparse.pdf', mimeType: 'application/pdf', buffer: pdfFixture() })
  // Adding a PDF only scans it; understanding mode never needs a review.
  await expect(page.locator('.not-reviewed')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('tab', { name: 'Understand' }).click()
  await expect(page).toHaveURL(/mode=study/)
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.textLayer span').first()).toBeAttached()
  await page.getByRole('button', { name: 'Map the story' }).click()
  await expect(page.locator('.story-node')).toHaveCount(4, { timeout: 20_000 })
  await expect(page.locator('.edge')).toHaveCount(3)
  await expect(page.locator('.thesis')).toContainText('Hashing tokens')

  // Every panel fits on one screen: the page never scrolls, and choosing a node only moves the tree panel.
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  for (const name of ['PDF', 'Story', 'Selected node', 'Ask']) await expect(page.getByRole('region', { name, exact: true })).toBeInViewport()
  await page.locator('.story-node', { hasText: 'LSH buckets' }).click()
  await expect(page.locator('.focus')).toContainText('Similar tokens share a bucket')
  await expect(page.locator('.focus-points')).toContainText('Replaces dense attention')
  // TeX from the model is typeset by KaTeX, inline and displayed, instead of shown as raw source.
  await expect(page.locator('.focus > p .math .katex')).toBeVisible()
  await expect(page.locator('.focus-points .math.display .katex-display')).toBeVisible()
  await expect(page.locator('.focus')).not.toContainText('$')
  await page.locator('.focus').screenshot({ path: '.test-output/study-math.png' })
  await expect(page.locator('.tree li.current')).toContainText('LSH buckets')
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await expect(page.locator('.to-graph')).toBeHidden()

  // A question nests its answer under the bullet the model points at.
  await page.locator('.story-node', { hasText: 'LSH buckets' }).click()
  await page.getByRole('textbox', { name: 'Ask' }).fill('How does hashing help?')
  await page.keyboard.press('Enter')
  const answer = page.locator('.tree li.fresh', { hasText: 'Tokens are hashed so neighbours collide' })
  await expect(answer).toBeVisible({ timeout: 20_000 })
  await expect(answer.locator('.q-badge')).toHaveText('Q1')
  await expect(page.locator('.tree .q-badge')).toHaveCount(1)
  await expect(answer.locator('li')).toHaveText('Only same-bucket pairs are compared')
  await expect(page.locator('.tree li:has(> ul > li.fresh) > .pt')).toContainText('Replaces dense attention')
  expect(asks[0]).toContain('The reader is looking at node [n2] LSH buckets')
  expect(asks[0]).toContain('Question: How does hashing help?')

  // A follow-up about something new adds a concept node to the graph.
  await page.getByRole('button', { name: 'What is a bucket?' }).click()
  await expect(page.locator('.story-node')).toHaveCount(5, { timeout: 20_000 })
  await expect(page.locator('.story-node.selected')).toContainText('Hash bucket')
  await expect(page.locator('.tree .q-badge')).toHaveCount(2)

  // Selecting text in the PDF attaches it to the next question.
  await page.locator('.textLayer span').first().selectText()
  await page.locator('.pdf-scroll').dispatchEvent('mouseup')
  await expect(page.locator('.selection-chip')).toBeVisible()
  await page.screenshot({ path: '.test-output/study.png', fullPage: true })

  await page.reload()
  await expect(page.locator('.story-node')).toHaveCount(5)
  await expect(page.locator('.tree .q-badge')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  // On a phone the page scrolls as a whole, so a node click must not move it; its bullets show under the graph.
  await page.locator('.story-node', { hasText: 'LSH buckets' }).scrollIntoViewIfNeeded()
  const mobileScroll = await page.evaluate(() => scrollY)
  await page.locator('.story-node', { hasText: 'LSH buckets' }).click()
  await expect(page.locator('.focus-points')).toContainText('Tokens are hashed so neighbours collide')
  await page.waitForTimeout(400) // any smooth scroll would have started by now
  expect(await page.evaluate(() => scrollY)).toBe(mobileScroll)
  await page.screenshot({ path: '.test-output/study-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('panels can be dragged, split, resized, hidden and are remembered', async ({ page }) => {
  await setup(page)
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'sparse.pdf', mimeType: 'application/pdf', buffer: pdfFixture() })
  // Adding a PDF only scans it; understanding mode never needs a review.
  await expect(page.locator('.not-reviewed')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('tab', { name: 'Understand' }).click()
  await page.getByRole('button', { name: 'Map the story' }).click()
  await expect(page.locator('.story-node')).toHaveCount(4, { timeout: 20_000 })

  const columns = () => page.locator('.ws-col').evaluateAll(cols => cols.map(col => [...col.querySelectorAll('[data-panel]')].map(p => (p as HTMLElement).dataset.panel)))
  expect(await columns()).toEqual([['pdf'], ['graph', 'focus'], ['tree', 'ask']])
  const head = (id: string) => page.locator(`[data-panel="${id}"] .panel-head h2`)
  async function dragTo(id: string, target: string, fx: number, fy: number) {
    const from = (await head(id).boundingBox())!, box = (await page.locator(`[data-panel="${target}"]`).boundingBox())!
    await page.mouse.move(from.x + 20, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 8 })
    await expect(page.locator('.drop-preview')).toBeVisible()
    await page.mouse.up()
  }

  // Upper half of another panel: stack above it.
  await dragTo('ask', 'graph', 0.5, 0.3)
  expect(await columns()).toEqual([['pdf'], ['ask', 'graph', 'focus'], ['tree']])
  // Right edge: split into a new column.
  await dragTo('focus', 'tree', 0.95, 0.5)
  expect(await columns()).toEqual([['pdf'], ['ask', 'graph'], ['tree'], ['focus']])
  await expect(page.locator('.drop-preview')).toHaveCount(0)

  // Dragging the gap between the first two columns resizes them.
  const pdfWidth = async () => (await page.locator('[data-panel="pdf"]').boundingBox())!.width
  const before = await pdfWidth()
  const gap = (await page.locator('.gap-x').first().boundingBox())!
  await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2)
  await page.mouse.down()
  await page.mouse.move(gap.x + gap.width / 2 - 120, gap.y + gap.height / 2, { steps: 6 })
  await page.mouse.up()
  expect(Math.abs(await pdfWidth() - (before - 120))).toBeLessThan(3)

  // Maximize is temporary: one panel fills the workspace, the others keep their state, Esc or the button restores.
  await page.getByRole('textbox', { name: 'Ask' }).fill('half-typed question')
  const workspaceWidth = (await page.locator('.workspace').boundingBox())!.width
  const columnsBefore = await page.locator('[data-panel="graph"]').boundingBox()
  await page.locator('[data-panel="pdf"]').getByRole('button', { name: /^Maximize/ }).click()
  // It grows out of its slot with an eased clip animation; the other panels do not move meanwhile.
  expect(await page.locator('.panel.maximized').evaluate(el => el.getAnimations().map(a => (a.effect as KeyframeEffect).getKeyframes()[0]!.clipPath))).toEqual([expect.stringMatching(/^inset\(/)])
  expect(await page.locator('[data-panel="graph"]').boundingBox()).toEqual(columnsBefore)
  await expect(page.locator('[data-panel="graph"]')).toBeHidden()
  await expect(page.locator('.panel.maximized .esc-hint')).toHaveText('Escto restore')
  await page.locator('.panel.maximized .panel-head').screenshot({ path: '.test-output/maximized-head.png' })
  expect(Math.abs((await page.locator('[data-panel="pdf"]').boundingBox())!.width - workspaceWidth)).toBeLessThan(2)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-panel="graph"]')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Ask' })).toHaveValue('half-typed question')
  await expect(page.locator('.panel.maximized')).toHaveCount(0) // after the closing animation
  await expect(page.locator('.panel-placeholder')).toHaveCount(0)
  await head('tree').dblclick()
  await expect(page.locator('[data-panel="tree"].maximized')).toBeVisible()
  await expect(page.locator('[data-panel="pdf"]')).toBeHidden()
  await page.locator('[data-panel="tree"]').getByRole('button', { name: /^Restore/ }).click()
  await expect(page.locator('.panel.maximized')).toHaveCount(0)
  expect(await columns()).toEqual([['pdf'], ['ask', 'graph'], ['tree'], ['focus']])

  // Collapse, hide and bring back.
  await page.locator('[data-panel="tree"]').getByRole('button', { name: 'Collapse' }).click()
  await expect(page.locator('[data-panel="tree"] .panel-body')).toHaveCount(0)
  await page.locator('[data-panel="pdf"]').getByRole('button', { name: 'Hide panel' }).click()
  await expect(page.locator('[data-panel="pdf"]')).toHaveCount(0)
  // A page reference brings the hidden PDF back.
  await page.locator('.focus .page-ref').first().click()
  await expect(page.locator('[data-panel="pdf"] .pdf-page canvas').first()).toBeVisible({ timeout: 20_000 })

  // The arrangement survives a reload; reset restores the default.
  await page.reload()
  expect(await columns()).toEqual([['pdf'], ['ask', 'graph'], ['tree'], ['focus']])
  await expect(page.locator('[data-panel="tree"] .panel-body')).toHaveCount(0)
  await page.screenshot({ path: '.test-output/study-layout.png' })
  await page.getByRole('button', { name: 'Reset layout' }).click()
  expect(await columns()).toEqual([['pdf'], ['graph', 'focus'], ['tree', 'ask']])
})

test('a reply in its own schema is converted to the story graph instead of failing', async ({ page }) => {
  await setup(page)
  const requests: { system: string; user: string }[] = []
  // Registered after setup's route, so it is tried first; review requests fall through to setup's handler.
  await page.route(API + '/chat/completions', async route => {
    const messages = route.request().postDataJSON().messages
    const system = String(messages[0].content)
    if (!system.includes('story') && !system.includes('could not be used')) return route.fallback()
    requests.push({ system, user: messages[1].content })
    // Like a real model that ignored the format: valid JSON, its own keys.
    const content = requests.length === 1
      ? JSON.stringify({ research_findings: { network_performance_metrics: [{ metric: 'Latency', papers_count: 25 }], challenges: ['Lack of user studies'] } })
      : story
    await route.fulfill({ json: { choices: [{ message: { content } }] } })
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'sparse.pdf', mimeType: 'application/pdf', buffer: pdfFixture() })
  // Adding a PDF only scans it; understanding mode never needs a review.
  await expect(page.locator('.not-reviewed')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('tab', { name: 'Understand' }).click()
  await page.getByRole('button', { name: 'Map the story' }).click()
  await expect(page.locator('.story-node')).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(requests).toHaveLength(2)
  // The format is repeated after the paper, and the repair gets the target schema plus only the bad reply.
  expect(requests[0]!.user.trimEnd()).toMatch(/"followUps": string\[\]\}$/)
  expect(requests[1]!.system).toContain('"nodes": [{"id": string')
  expect(requests[1]!.user).toContain('research_findings')
  expect(requests[1]!.user).not.toContain('locality-sensitive')
})

test('the output language is chosen independently of the paper and existing notes can be translated', async ({ page }) => {
  await setup(page)
  const requests: { system: string; user: string }[] = []
  await page.route(API + '/chat/completions', async route => {
    const messages = route.request().postDataJSON().messages
    const system = String(messages[0].content)
    if (system.includes('story')) requests.push({ system, user: messages[1].content })
    if (!system.startsWith('Translate every value')) return route.fallback()
    requests.push({ system, user: messages[1].content })
    const texts = JSON.parse(messages[1].content) as Record<string, string>
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, 'JA ' + v]))) } }] } })
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'sparse.pdf', mimeType: 'application/pdf', buffer: pdfFixture() })
  // Adding a PDF only scans it; understanding mode never needs a review.
  await expect(page.locator('.not-reviewed')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('tab', { name: 'Understand' }).click()

  // An English paper, story requested in English.
  await page.getByRole('combobox', { name: 'Output language' }).selectOption('en')
  await page.getByRole('button', { name: 'Map the story' }).click()
  await expect(page.locator('.story-node')).toHaveCount(4, { timeout: 20_000 })
  expect(requests[0]!.system).toContain('in English, even when the paper')
  expect(requests[0]!.user).toMatch(/in English, even when the paper[\s\S]*"followUps": string\[\]\}$/)
  await expect(page.locator('.lang-note')).toHaveCount(0)

  // Switching to Japanese offers to translate the existing notes instead of rebuilding them.
  await page.getByRole('combobox', { name: 'Output language' }).selectOption('ja')
  await expect(page.locator('.lang-note')).toContainText('These notes are in English. New answers will be added in 日本語.')
  await page.getByRole('button', { name: 'Translate to 日本語 (keeps the tree)' }).click()
  await expect(page.locator('.story-node').first()).toContainText('JA Attention is quadratic', { timeout: 20_000 })
  await expect(page.locator('.tree')).toContainText('JA Replaces dense attention')
  await expect(page.locator('.thesis')).toContainText('JA Hashing tokens')
  await expect(page.locator('.lang-note')).toHaveCount(0)
  expect(requests.at(-1)!.system).toContain('into Japanese')

  // The choice is remembered.
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Output language' })).toHaveValue('ja')
})

test('PDFs from tc-pdf-viewer can be picked and open in understanding mode', async ({ page }) => {
  await setup(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Pick from tc-pdf-viewer' }).click()
  await expect(page.getByRole('dialog')).toContainText('tc-pdf-viewer has not been used on this site yet')
  await page.keyboard.press('Escape')

  // Seed the library the way tc-pdf-viewer's savePdf does: bytes in the mistlib CID store, pointer in mist_files_index.
  const bytes = [...pdfFixture('From the viewer')]
  await page.evaluate(async data => {
    const mist = await import('/src/lib/mist.ts')
    const lib = await import('/src/vendor/mistlib/index.js')
    await mist.ensureMistStorage()
    const cid = await lib.storage_add('viewer.pdf', new Uint8Array(data))
    localStorage.setItem('mist_files_index', JSON.stringify([{ name: 'viewer.pdf', cid, folder: 'Research', createdAt: 1, updatedAt: 2 }, { broken: true }]))
  }, bytes)
  await page.getByRole('button', { name: 'Pick from tc-pdf-viewer' }).click()
  await expect(page.locator('.picker-list li')).toHaveCount(1)
  await page.locator('.picker-list button', { hasText: 'viewer.pdf' }).click()
  await expect(page).toHaveURL(/mode=study/, { timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Map the story' })).toBeVisible({ timeout: 20_000 })
  // Picking it again opens the existing paper instead of adding a duplicate.
  await page.getByRole('button', { name: 'All papers' }).click()
  await page.getByRole('button', { name: 'Pick from tc-pdf-viewer' }).click()
  await page.locator('.picker-list button', { hasText: 'viewer.pdf' }).click()
  await expect(page).toHaveURL(/mode=study/)
  await page.getByRole('button', { name: 'All papers' }).click()
  await expect(page.locator('.papers li')).toHaveCount(1)
})
