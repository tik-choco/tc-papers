import { expect, it } from 'vitest'
import { AI_COPY } from './aiCopy'
import { LLM_SETTINGS_MESSAGES } from '@tik-choco/mistai/preact'

it('has complete, nonempty en/ja/zh-CN/zh-TW AI catalogs with matching placeholders', () => {
  const placeholders = (text: string) => text.match(/\{[^}]+\}/g)?.sort() ?? []
  for (const catalog of [AI_COPY, LLM_SETTINGS_MESSAGES]) {
    const reference = catalog.en
    for (const locale of ['ja', 'en', 'zh-CN', 'zh-TW'] as const) {
      const messages: Record<string, string> = catalog[locale]
      expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort())
      for (const [key, text] of Object.entries(reference)) {
        expect(messages[key].trim(), `${locale}.${key}`).not.toBe('')
        expect(placeholders(messages[key]), `${locale}.${key}`).toEqual(placeholders(text))
      }
    }
  }
})
