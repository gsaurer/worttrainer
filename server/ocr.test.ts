// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { normalizePhoto, numberedAnswers, ocrConfiguration, readAzureDocument, readAzurePhoto } from './ocr.js'
import { suggestedResult } from '../shared/model.js'

afterEach(() => { vi.unstubAllGlobals() })
const config = { endpoint: 'https://test.cognitiveservices.azure.com', key: 'test-only-key', monthlyLimit: 450 }
const operation = `${config.endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/test-id?api-version=2024-11-30`
const analysis = (content: string, confidence = 0.95) => ({
  content, pages: [{ words: [...content.matchAll(/\S+/g)].map(match => ({ confidence, span: { offset: match.index, length: match[0].length } })) }],
})

describe('safe handwriting answer recognition', () => {
  it.each([', ', '; ', ': ', '\n', ',\n'])('reads an ordered unnumbered list separated by %j without correcting spellings', separator => {
    const result = numberedAnswers(analysis(`  Straße${separator}beautifull${separator}glück\n`), 3)
    expect(result.answers.map(answer => answer.text)).toEqual(['Straße', 'beautifull', 'glück'])
    expect(result.answers.every(answer => answer.confidence === 0.95)).toBe(true)
    expect(result.warnings).toEqual(['Check the answer order before saving.'])
    expect(suggestedResult('beautiful', result.answers[1].text, result.answers[1].confidence)).toBe(false)
  })

  it.each(['apple; pear', 'apple; pear; plum; peach', 'apple; ; pear', 'Words:\napple\npear'])('does not guess answer positions for an incomplete or ambiguous list: %s', content => {
    const result = numberedAnswers(analysis(content), 3)
    expect(result.answers.every(answer => answer.text === null)).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('retains each ordered answer’s own confidence and supports a single unnumbered answer', () => {
    const data = analysis('Straße; beautifull; glück')
    data.pages[0].words[1].confidence = 0.5
    const result = numberedAnswers(data, 3)
    expect(result.answers.map(answer => answer.confidence)).toEqual([0.95, 0.5, 0.95])
    expect(suggestedResult('beautiful', result.answers[1].text, result.answers[1].confidence)).toBeNull()
    expect(numberedAnswers(analysis('Schmeterling'), 1).answers[0]).toEqual({ number: 1, text: 'Schmeterling', confidence: 0.95 })
  })

  it('keeps spelling and case verbatim, matches explicit numbers, and handles Unicode spans', () => {
    const result = numberedAnswers(analysis('2) beautifull\n1. Straße\n3. glück'), 3)
    expect(result.answers.map(answer => answer.text)).toEqual(['Straße', 'beautifull', 'glück'])
    expect(result.answers.every(answer => answer.confidence === 0.95)).toBe(true)
    expect(suggestedResult('beautiful', result.answers[1].text, 0.95)).toBe(false)
    expect(suggestedResult('Glück', result.answers[2].text, 0.95)).toBe(false)
    expect(suggestedResult('Straße', 'Straße', 0.95)).toBe(true)
    expect(suggestedResult('grün', 'gru\u0308n', 0.95)).toBe(true)
  })
  it('does not shift missing/unnumbered answers or guess duplicates and uncertain text', () => {
    const result = numberedAnswers(analysis('1. apple\n3. pear\n3. pair\nunlabelled\n99. other', 0.5), 4)
    expect(result.answers.map(answer => answer.text)).toEqual(['apple', null, null, null])
    expect(result.warnings.length).toBeGreaterThan(2)
    expect(suggestedResult('apple', 'apple', 0.5)).toBeNull()
    expect(suggestedResult('apple', 'apple', null)).toBeNull()
    expect(suggestedResult('apple', null, 1)).toBeNull()
  })
  it('requires explicit secure resource configuration and caps the monthly budget', () => {
    expect(ocrConfiguration({})).toBeUndefined()
    expect(ocrConfiguration({ OCR_AZURE_ENDPOINT: config.endpoint, OCR_AZURE_KEY: config.key })).toEqual(config)
    for (const endpoint of ['http://test.cognitiveservices.azure.com', 'https://evil.example', 'https://test.cognitiveservices.azure.com/path']) {
      expect(() => ocrConfiguration({ OCR_AZURE_ENDPOINT: endpoint, OCR_AZURE_KEY: config.key })).toThrow()
    }
    expect(() => ocrConfiguration({ OCR_AZURE_ENDPOINT: config.endpoint })).toThrow()
    expect(() => ocrConfiguration({ OCR_AZURE_ENDPOINT: config.endpoint, OCR_AZURE_KEY: config.key, OCR_MONTHLY_LIMIT: '501' })).toThrow()
  })
  it('normalizes a real image without metadata and rejects non-photos', async () => {
    const photo = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#ffffff' } }).withExif({ IFD0: { Artist: 'private test metadata' } }).png().toBuffer()
    expect((await sharp(photo).metadata()).exif).toBeDefined()
    const metadata = await sharp(await normalizePhoto(photo)).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.exif).toBeUndefined()
    await expect(normalizePhoto(Buffer.from('not an image'))).rejects.toThrow('JPEG or PNG')
    await expect(normalizePhoto(Buffer.from('<svg width="10" height="10"></svg>'))).rejects.toThrow('JPEG or PNG')
  })
  it('uses Read without expected spellings, polls safely, and requests provider deletion', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'Operation-Location': operation } }))
      .mockResolvedValueOnce(Response.json({ status: 'succeeded', analyzeResult: analysis('1. beautifull') }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', transport)
    const result = await readAzurePhoto(Buffer.from('test-image'), 'en', 1, config, async () => {})
    expect(result.answers[0].text).toBe('beautifull')
    expect(transport.mock.calls[0][0]).toContain('prebuilt-read:analyze')
    expect(transport.mock.calls[0][0]).toContain('pages=1')
    expect(transport.mock.calls[0][1]?.body).toBe(JSON.stringify({ base64Source: Buffer.from('test-image').toString('base64') }))
    expect(transport.mock.calls[2][1]?.method).toBe('DELETE')
  })
  it('reads full document text without changing spelling or requiring numbered answers', async () => {
    const text = 'A beautifull day.\nWe walked through the garden.'
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'Operation-Location': operation } }))
      .mockResolvedValueOnce(Response.json({ status: 'succeeded', analyzeResult: analysis(text) }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', transport)
    expect(await readAzureDocument(Buffer.from('test-image'), 'en', config, async () => {})).toBe(text)
    expect(transport.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })
  it('refuses unexpected operation hosts before sending credentials and reports quota errors', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'Operation-Location': 'https://untrusted.example/result' } }))
    vi.stubGlobal('fetch', transport)
    await expect(readAzurePhoto(Buffer.from('photo'), 'de', 1, config)).rejects.toThrow('unexpected operation')
    expect(transport).toHaveBeenCalledTimes(1)
    transport.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(readAzurePhoto(Buffer.from('photo'), 'de', 1, config)).rejects.toThrow('no paid fallback')
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('bounds polling and requests cleanup on a stuck operation', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') return new Response(null, { status: 202, headers: { 'Operation-Location': operation } })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return Response.json({ status: 'running' })
    })
    vi.stubGlobal('fetch', transport)
    const pause = vi.fn().mockResolvedValue(undefined)
    await expect(readAzurePhoto(Buffer.from('photo'), 'de', 1, config, pause)).rejects.toThrow('took too long')
    expect(pause).toHaveBeenCalledTimes(30)
    expect(transport).toHaveBeenCalledTimes(32)
    expect(transport.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })
})
