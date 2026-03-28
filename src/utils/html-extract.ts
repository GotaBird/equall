// Extract scannable HTML from various file types
export function extractHtml(content: string, type: string): string {
  if (type === 'html') return content

  if (type === 'vue') {
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)
    return templateMatch?.[1] ?? ''
  }

  // For JSX/TSX: extract return statement content (simplified)
  // This is a best-effort extraction — complex JSX may not parse perfectly
  if (type === 'jsx' || type === 'tsx') {
    const returnMatch = content.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*[;\n}]/)
    if (returnMatch) return returnMatch[1]
    // Try single-line return
    const singleReturn = content.match(/return\s+(<[\s\S]*?>[\s\S]*?<\/[\s\S]*?>)/)
    return singleReturn?.[1] ?? ''
  }

  return content
}

// Wrap fragment in a basic HTML document if needed for parsers
export function wrapFragment(html: string): string {
  if (html.includes('<html')) return html
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head><title>Scan</title></head>
      <body>${html}</body>
    </html>
  `
}
