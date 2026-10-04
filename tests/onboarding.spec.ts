import { test, expect } from '@playwright/test'

test('first launch shows the setup guide, saves the AI connection and does not come back', async ({ page }) => {
  await page.route('http://127.0.0.1:12345/v1/models', route => route.fulfill({ json: { data: [{ id: 'fixture' }] } }))
  await page.goto('/')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /はじめる|Get started/ }).click()
  await dialog.locator('.connection-add-button').click()
  const popup = page.locator('.connection-popup')
  await popup.getByRole('tab', { name: 'HTTP', exact: true }).click()
  await popup.locator('.connection-name').fill('Test endpoint')
  await popup.locator('input').nth(1).fill('http://127.0.0.1:12345/v1')
  await popup.locator('button[type=submit]').click()
  await dialog.getByRole('tab', { name: /^(タスク|Tasks)$/ }).click()
  await dialog.locator('.provider-task-row').first().locator('.model-picker-trigger').click()
  await page.locator('.model-picker-option').filter({ hasText: 'fixture' }).click()
  await dialog.getByRole('button', { name: /^(次へ|Continue)$/ }).click()
  await dialog.getByRole('button', { name: /完了|Done/ }).click()
  await expect(dialog).toBeHidden()

  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('tc-shared-llm-config-v1') || 'null'))
  expect(config.defaultModel.model).toBe('fixture')
  expect(config.providers.find((p: { id: string }) => p.id === config.defaultModel.providerId).baseUrl).toBe('http://127.0.0.1:12345/v1')

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
