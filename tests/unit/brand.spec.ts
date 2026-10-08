import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '@/utils/brand'

// index.html and the manifest are served before any code runs, so they
// spell the name out themselves: these keep them in step with brand.ts.
function publicFile(path: string): string {
  return readFileSync(resolve(__dirname, '../..', path), 'utf-8')
}

describe('the app name', () => {
  test('is Bridge4U, B4U for short', () => {
    expect(APP_NAME).toBe('Bridge4U')
    expect(APP_SHORT_NAME).toBe('B4U')
    expect(APP_TAGLINE).toBe('Bridge for you')
  })

  test("is the browser tab's title, with the icons and manifest linked", () => {
    const html = publicFile('index.html')

    expect(html).toContain(`<title>${APP_NAME}</title>`)
    expect(html).toContain(`content="${APP_NAME}: play duplicate bridge with friends or robots."`)
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
  })

  test('is what installing the site offers', () => {
    const manifest = JSON.parse(publicFile('public/manifest.webmanifest'))

    expect(manifest.name).toBe(APP_NAME)
    expect(manifest.short_name).toBe(APP_SHORT_NAME)
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', 'any'])
  })
})
