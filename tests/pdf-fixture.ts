export const BODY = [
  'Abstract',
  'We propose a sparse attention method that reduces memory by 43% on long documents.',
  'Method',
  'Our approach replaces dense attention with locality-sensitive hashing buckets.',
  'Experiments',
  'Results on three benchmarks show consistent gains over the baseline transformer.',
  'Limitations: we only test English corpora.',
  'References',
]

/** Builds a PDF whose pages each hold the given text lines; an empty page has no text layer (OCR path). */
export function pdfFixture(title = 'Evidence in practice', pages: string[][] = [BODY]) {
  const escape = (text: string) => text.replace(/[\()]/g, '\$&')
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const kids: number[] = []
  for (const lines of pages) {
    const content = lines.length ? 'BT /F1 11 Tf 50 760 Td 14 TL ' + lines.map(line => '(' + escape(line) + ') \'').join(' ') + ' ET' : ''
    objects.push('<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream')
    const contentId = objects.length
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentId + ' 0 R >>')
    kids.push(objects.length)
  }
  objects[1] = '<< /Type /Pages /Kids [' + kids.map(id => id + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>'
  objects.push('<< /Title (' + escape(title) + ') /Author (Research Team) >>')
  const infoId = objects.length
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n' }
  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF'
  return Buffer.from(pdf)
}
