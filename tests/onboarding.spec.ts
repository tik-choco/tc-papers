import { test, expect } from '@playwright/test'

test('first launch shows the setup guide, saves the AI connection and does not come back', async ({ page }) => {
  await page.goto('/')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /はじめる|Get started/ }).click()
  await dialog.locator('input[type="text"]').first().fill('http://127.0.0.1:12345/v1')
  await dialog.locator('input[list="ob-model-options"]').fill('fixture')
  await dialog.getByRole('button', { name: /保存して次へ|Save and continue/ }).click()
  await dialog.getByRole('button', { name: /完了|Done/ }).click()
  await expect(dialog).toBeHidden()

  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('tc-shared-llm-config-v1') || 'null'))
  const preset = config.presets.find((p: { id: string }) => p.id === config.defaultPresetId)
  expect(preset.model).toBe('fixture')
  expect(config.providers.find((p: { id: string }) => p.id === preset.providerId).baseUrl).toBe('http://127.0.0.1:12345/v1')

  await page.reload()
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('the setup guide can be skipped and reopened from settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('dialog').getByRole('button', { name: /閉じる|Close/ }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: /^(設定|Settings)$/ }).click()
  await page.getByRole('button', { name: /セットアップガイドを表示|Show the setup guide/ }).click()
  await expect(page.getByRole('dialog', { name: /はじめてのセットアップ|First-time setup/ })).toBeVisible()
})
