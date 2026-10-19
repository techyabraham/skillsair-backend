/**
 * Writes every email template, rendered with its sample data, to tmp/email-previews/:
 * <id>.html, <id>.txt and an index.html listing subjects and preheaders.
 *
 * Usage: npm run emails:preview
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emailTemplates } from '../src/emails/index.js'
import { escapeHtml } from '../src/emails/layout.js'

const outDir = path.resolve('tmp/email-previews')
await mkdir(outDir, { recursive: true })
const rows: string[] = []
for (const template of Object.values(emailTemplates)) {
  const rendered = template.renderSample()
  await writeFile(path.join(outDir, `${template.id}.html`), rendered.html, 'utf8')
  await writeFile(path.join(outDir, `${template.id}.txt`), `Subject: ${rendered.subject}\nPreheader: ${rendered.preheader}\n\n${rendered.text}\n`, 'utf8')
  rows.push(
    `<tr><td><a href="${template.id}.html">${escapeHtml(template.id)}</a> · <a href="${template.id}.txt">text</a></td><td>${template.kind}</td><td>${escapeHtml(template.stepId)}</td><td><strong>${escapeHtml(rendered.subject)}</strong><br />${escapeHtml(rendered.preheader)}</td></tr>`,
  )
}
await writeFile(
  path.join(outDir, 'index.html'),
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SkillsAir email previews</title><style>body{font-family:system-ui;margin:24px}td{padding:8px;border-bottom:1px solid #ddd;vertical-align:top}</style></head><body><h1>SkillsAir email previews</h1><table>${rows.join('')}</table></body></html>`,
  'utf8',
)
console.log(`Wrote ${rows.length} templates to ${outDir}`)
