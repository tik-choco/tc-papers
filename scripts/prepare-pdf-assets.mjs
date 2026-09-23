import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await mkdir(join(root, 'public/pdfjs', folder), { recursive: true })
  await cp(join(root, 'node_modules/pdfjs-dist', folder), join(root, 'public/pdfjs', folder), { recursive: true })
}
