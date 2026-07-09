/** RFC-4180-ish CSV: quoted fields, "" escapes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let quoted = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      if (c === '"') {
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      quoted = true
      i++
      continue
    }
    if (c === ',') {
      pushField()
      i++
      continue
    }
    if (c === '\r') {
      // \r\n → one row break; a lone \r (old Mac) is also a row break.
      pushRow()
      i += text[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (c === '\n') {
      pushRow()
      i++
      continue
    }
    field += c
    i++
  }
  // Flush a trailing field/row unless the input ended exactly on a newline.
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

export function stringifyCsv(rows: string[][]): string {
  const cell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return rows.map((r) => r.map(cell).join(',')).join('\n')
}
