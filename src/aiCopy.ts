import type { LlmSettingsLocale } from '@tik-choco/mistai/preact'
import type { Locale } from './copy'

export const AI_COPY = {
  en: {
    title: 'AI settings', note: 'Choose models for Review, Understanding and OCR. OCR needs an image-capable model. PDF text is sent to the selected AI.',
    review: 'Review', study: 'Understanding mode', ocr: 'OCR (image-only pages)', storageError: 'Could not save settings in this browser.', continue: 'Continue', reopen: 'Show the setup guide',
  },
  ja: {
    title: 'AI 設定', note: 'レビュー・理解モード・OCR に使うモデルを選べます。OCR には画像入力に対応したモデルが必要です。PDF 本文は選択した AI に送信されます。',
    review: 'レビュー', study: '理解モード', ocr: 'OCR（画像のみのページ）', storageError: 'ブラウザーに設定を保存できませんでした。', continue: '次へ', reopen: 'セットアップガイドを表示',
  },
  'zh-CN': {
    title: 'AI 设置', note: '选择用于评审、理解模式和 OCR 的模型。OCR 需要支持图像输入的模型。PDF 正文将发送给所选 AI。',
    review: '评审', study: '理解模式', ocr: 'OCR（仅含图像的页面）', storageError: '无法在此浏览器中保存设置。', continue: '继续', reopen: '显示设置指南',
  },
  'zh-TW': {
    title: 'AI 設定', note: '選擇用於審閱、理解模式和 OCR 的模型。OCR 需要支援圖像輸入的模型。PDF 內文將傳送給所選 AI。',
    review: '審閱', study: '理解模式', ocr: 'OCR（僅含圖像的頁面）', storageError: '無法在此瀏覽器中儲存設定。', continue: '繼續', reopen: '顯示設定指南',
  },
} satisfies Record<LlmSettingsLocale, Record<string, string>>

/** The rest of the app currently supports ja/en; AI settings also support both Chinese locales. */
export function settingsLocale(locale: Locale): LlmSettingsLocale {
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('zh') ? /tw|hk|hant/.test(lang) ? 'zh-TW' : 'zh-CN' : locale
}
