# TC Papers

English | [日本語](README.ja.md) | [中文](README.zh.md)

Read research papers with AI. Drop a PDF to get a reviewer-style score, or explore the paper's story as a graph by asking questions.

Live: https://tik-choco.github.io/tc-papers/

## Features

- **Review**: the AI rates six criteria (soundness, evidence, novelty, significance, clarity, reproducibility) with quotes from the paper. The final 0–100 score is computed locally, and ratings whose quotes can't be found in the text are pulled back toward neutral.
- **Understanding mode**: turns the paper into a story graph (problem → method → result → …). Every question you ask adds its answer to an understanding tree, next to the PDF. When the tree gets messy, "Tidy" merges duplicates and fixes placement and order (and can be undone).
- **OCR**: image-only pages are read by an image-capable model.
- **tc-pdf-viewer**: import PDFs you already have in tc-pdf-viewer.
- **Local first**: PDFs and results stay in the browser, and results are backed up to tc-storage automatically.

## AI

Uses the shared mistai settings of the tc apps: any OpenAI-compatible API, or AI Network (P2P). A setup guide opens on first launch. The PDF text and page images are sent to the AI you choose.

## Development

```sh
npm install
npm run dev
npm test
npm run test:e2e
npm run build   # VITE_BASE_PATH=/tc-papers/ for a subpath
```

## License

[MIT](LICENSE)
