import { test, expect, type Page } from '@playwright/test'
import { BODY, pdfFixture } from './pdf-fixture'

const API = 'http://127.0.0.1:12345/v1'
const CRITERIA = ['soundness', 'evidence', 'novelty', 'significance', 'clarity', 'reproducibility']

function reviewJson(quote: string) {
  return JSON.stringify({
    title: 'Sparse attention for long documents', summary: 'Proposes LSH-based sparse attention.',
    strengths: ['Clear memory savings'], weaknesses: ['English only'], questions: ['Other languages?'], fatalFlaws: [],
    overall: 'A promising idea worth polishing.', pathToAcceptance: ['Add a multilingual benchmark'],
    comments: [{ page: 3, section: 'Experiments', severity: 'major', comment: 'Only English corpora.', suggestion: 'Evaluate on a multilingual corpus.' }],
    criteria: Object.fromEntries(CRITERIA.map(id => [id, { score: 4, confidence: 3, rationale: id + ' rationale', evidence: [{ page: 1, quote }] }])),
  })
}

async function configureAi(page: Page) {
  await page.addInitScript(api => localStorage.setItem('tc-shared-llm-config-v1', JSON.stringify({
    v: 1, providers: [{ id: 'test', label: 'Test', baseUrl: api, apiKey: 'test' }],
    presets: [{ id: 'model', label: 'Test model', providerId: 'test', model: 'fixture' }], defaultPresetId: 'model',
    network: { roomId: '' }, updatedAt: new Date().toISOString(),
  })), API)
}

async function drop(page: Page, files: { name: string; buffer: Buffer }[]) {
  await page.locator('input[type=file]').setInputFiles(files.map(file => ({ ...file, mimeType: 'application/pdf' })))
}

test('minimal UI on desktop and mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.brand')).toHaveText('TC Papers')
  await expect(page.locator('.dropzone')).toBeVisible()
  await expect(page.locator('button:visible, a:visible')).toHaveCount(5) // brand, theme, settings, dropzone, tc-pdf-viewer picker
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('AI Network', { exact: true })).toBeVisible()
  await page.screenshot({ path: '.test-output/settings.png', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('dropping a PDF scans and reviews it automatically with a locally computed score', async ({ page }) => {
  await configureAi(page)
  const bodies: { messages: { role: string; content: string }[] }[] = []
  await page.route(API + '/chat/completions', async route => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ json: { choices: [{ message: { content: reviewJson('reduces memory by 43% on long documents') } }] } })
  })
  await page.goto('/')
  await drop(page, [{ name: 'sparse.pdf', buffer: pdfFixture() }])
  await expect(page.locator('.verdict .score-badge')).toHaveText(/\d+/, { timeout: 20_000 })
  // 4/5 on every criterion with verified evidence → base 75; 5/6 structure checks (no code link) → 0.9·75 + 8.33 = 75.8 → 76
  await expect(page.locator('.verdict .score-badge')).toHaveText('76')
  await expect(page.locator('.verdict')).toContainText('Accept')
  expect(bodies).toHaveLength(1)
  expect(bodies[0]!.messages[1]!.content).toContain(BODY[1])
  await expect(page.locator('.criteria details').first().locator('.evidence li.ok')).toHaveCount(1)
  // Decision grounds: per-criterion points, subtotal and the band that produced the decision.
  await expect(page.locator('.grounds tbody tr')).toHaveCount(7)
  await expect(page.locator('.grounds tfoot')).toContainText('75.8')
  await expect(page.locator('.grounds')).toContainText('76 falls in the 65–79 band → Accept')
  await expect(page.locator('.comments li.major')).toContainText('Evaluate on a multilingual corpus.')
  await expect(page.locator('.overall')).toContainText('A promising idea')
  await page.screenshot({ path: '.test-output/review.png', fullPage: true })

  await page.reload()
  await page.getByRole('button', { name: 'All papers' }).click()
  await expect(page.locator('.papers .score-badge')).toHaveText('76')
  await drop(page, [{ name: 'copy.pdf', buffer: pdfFixture() }, { name: 'broken.pdf', buffer: Buffer.from('not a PDF') }])
  await expect(page.getByRole('alert')).toContainText('Already added')
  await expect(page.getByRole('alert')).toContainText('Not a valid PDF')
  await expect(page.locator('.papers li')).toHaveCount(1)
  expect(bodies).toHaveLength(1)

  // Re-reviewing keeps the earlier result as history.
  await page.locator('.papers li button').click()
  await page.getByRole('button', { name: 'Review again' }).click()
  await expect(page.locator('.history select option')).toHaveCount(2, { timeout: 20_000 })
  expect(bodies).toHaveLength(2)
})

test('shows what is being analysed while the AI is working', async ({ page }) => {
  await configureAi(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(API + '/chat/completions', async route => {
    await gate
    await route.fulfill({ json: { choices: [{ message: { content: reviewJson('reduces memory by 43% on long documents') } }] } })
  })
  await page.goto('/')
  await drop(page, [{ name: 'sparse.pdf', buffer: pdfFixture() }])
  await expect(page.locator('.progress .steps .done')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('.progress-detail')).toContainText('characters to the AI')
  await expect(page.locator('.progress-detail')).toContainText('elapsed')
  release()
  await expect(page.locator('.verdict .score-badge')).toHaveText('76', { timeout: 20_000 })
  await expect(page.locator('.progress')).toHaveCount(0)
})

test('hallucinated evidence lowers the score', async ({ page }) => {
  await configureAi(page)
  await page.route(API + '/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: reviewJson('a sentence the paper never contains anywhere') } }] } }))
  await page.goto('/')
  await drop(page, [{ name: 'sparse.pdf', buffer: pdfFixture() }])
  // unverified → 4 pulled to 3.5 → base 62.5 → 0.9·62.5 + 8.33 = 64.6 → 65 (vs 76 when verified)
  await expect(page.locator('.verdict .score-badge')).toHaveText('65', { timeout: 20_000 })
})

test('an unparseable review is sent back once to be fixed instead of failing', async ({ page }) => {
  await configureAi(page)
  const systems: string[] = []
  await page.route(API + '/chat/completions', async route => {
    const messages = route.request().postDataJSON().messages
    systems.push(messages[0].content)
    // First reply: prose with a broken object; the repair request gets the broken reply, not the paper.
    if (systems.length === 1) return route.fulfill({ json: { choices: [{ message: { content: 'Here is my review: {"title": "x", "criteria": {"soundness": {"score": four}}' } }] } })
    expect(messages[1].content).toContain('"score": four')
    expect(messages[1].content).not.toContain('locality-sensitive')
    await route.fulfill({ json: { choices: [{ message: { content: reviewJson('reduces memory by 43% on long documents') } }] } })
  })
  await page.goto('/')
  await drop(page, [{ name: 'sparse.pdf', buffer: pdfFixture() }])
  await expect(page.locator('.verdict .score-badge')).toHaveText('76', { timeout: 20_000 })
  expect(systems).toHaveLength(2)
  expect(systems[1]).toContain('could not be used')
  expect(systems[1]).toContain('"criteria": {"<criterion id>"')
})

test('reviews are backed up to tc-storage through the real mistlib CID store', async ({ page }) => {
  await configureAi(page)
  const warnings: string[] = []
  page.on('console', message => { if (message.type() === 'warning' && message.text().includes('papersBackupPublisher')) warnings.push(message.text()) })
  await page.route(API + '/chat/completions', route => route.fulfill({ json: { choices: [{ message: { content: reviewJson('reduces memory by 43% on long documents') } }] } }))
  await page.goto('/')
  await drop(page, [{ name: 'sparse.pdf', buffer: pdfFixture() }])
  await expect(page.locator('.verdict .score-badge')).toHaveText('76', { timeout: 20_000 })
  // Published after the startup delay / debounce: a shared record whose CID resolves in the store.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tc-shared-papers-backup-v1')), { timeout: 15_000 }).toContain('"cid"')
  const size = await page.evaluate(async () => {
    const record = JSON.parse(localStorage.getItem('tc-shared-papers-backup-v1')!)
    const lib = await import('/src/vendor/mistlib/index.js')
    return (await lib.storage_get(record.meta.item.cid)).byteLength
  })
  expect(size).toBeGreaterThan(100)
  expect(warnings).toEqual([])
})

test('image-only pages are rendered and sent to the OCR model', async ({ page }) => {
  await configureAi(page)
  let ocrCalls = 0
  await page.route(API + '/chat/completions', async route => {
    const body = route.request().postDataJSON()
    const content = body.messages[0].content
    if (Array.isArray(content)) {
      ocrCalls++
      expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
      return route.fulfill({ json: { choices: [{ message: { content: BODY.join('\n') } }] } })
    }
    expect(body.messages[1].content).toContain('locality-sensitive hashing')
    await route.fulfill({ json: { choices: [{ message: { content: reviewJson('replaces dense attention with locality-sensitive hashing buckets') } }] } })
  })
  await page.goto('/')
  await drop(page, [{ name: 'scan.pdf', buffer: pdfFixture('Scanned', [[]]) }])
  await expect(page.locator('.verdict .score-badge')).toHaveText(/\d+/, { timeout: 30_000 })
  await expect(page.locator('.review .muted').first()).toContainText('OCR 1')
  expect(ocrCalls).toBe(1)
})

test('waits for an AI connection instead of failing', async ({ page }) => {
  await page.goto('/')
  await drop(page, [{ name: 'sparse.pdf', buffer: pdfFixture() }])
  await expect(page.getByRole('alert')).toContainText('No AI connection')
})

test('retry resumes from the failed step instead of rescanning finished pages', async ({ page }) => {
  await configureAi(page)
  const ocrPages: number[] = []
  let reviews = 0
  await page.route(API + '/chat/completions', async route => {
    const content = route.request().postDataJSON().messages[0].content
    if (Array.isArray(content)) {
      const n = Number(/page (\d+) of a PDF/.exec(content[0].text)![1])
      ocrPages.push(n)
      // Page 3's OCR fails the first time only.
      if (n === 3 && ocrPages.filter(p => p === 3).length === 1) return route.fulfill({ status: 500, body: 'fail' })
      return route.fulfill({ json: { choices: [{ message: { content: 'Scanned page ' + n + ' with enough visible characters to count as text.' } }] } })
    }
    // The first review fails, as if the connection dropped.
    if (++reviews === 1) return route.fulfill({ status: 500, body: 'fail' })
    await route.fulfill({ json: { choices: [{ message: { content: reviewJson('reduces memory by 43% on long documents') } }] } })
  })
  await page.goto('/')
  await drop(page, [{ name: 'mixed.pdf', buffer: pdfFixture('Mixed', [BODY, [], []]) }])
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 })
  expect(ocrPages).toEqual([2, 3])
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.verdict .score-badge')).toHaveText(/\d+/, { timeout: 30_000 })
  // Only the page whose OCR failed is sent again; page 2 comes from the checkpoint.
  expect(ocrPages).toEqual([2, 3, 3])
  expect(reviews).toBe(2)
  await expect(page.locator('.review .muted').first()).toContainText('OCR 2')
})

test('retry after a review failure does not scan again', async ({ page }) => {
  await configureAi(page)
  let ocrCalls = 0, reviews = 0
  await page.route(API + '/chat/completions', async route => {
    const content = route.request().postDataJSON().messages[0].content
    if (Array.isArray(content)) { ocrCalls++; return route.fulfill({ json: { choices: [{ message: { content: BODY.join('\n') } }] } }) }
    if (++reviews === 1) return route.fulfill({ status: 500, body: 'fail' })
    await route.fulfill({ json: { choices: [{ message: { content: reviewJson('replaces dense attention with locality-sensitive hashing buckets') } }] } })
  })
  await page.goto('/')
  await drop(page, [{ name: 'scan.pdf', buffer: pdfFixture('Scanned', [[]]) }])
  await page.getByRole('button', { name: 'Retry' }).click({ timeout: 30_000 })
  await expect(page.locator('.verdict .score-badge')).toHaveText(/\d+/, { timeout: 30_000 })
  expect(ocrCalls).toBe(1)
  expect(reviews).toBe(2)
})
