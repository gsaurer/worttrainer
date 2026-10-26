import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { z } from 'zod'
import type { Language, PhotoRecognition } from '../shared/model.js'
import { HttpError } from './errors.js'

export type OcrOptions = { endpoint: string; key: string; monthlyLimit: number }

export function ocrConfiguration(env: NodeJS.ProcessEnv): OcrOptions | undefined {
  const endpoint = env.OCR_AZURE_ENDPOINT?.trim()
  const key = env.OCR_AZURE_KEY?.trim()
  if (!endpoint && !key) return undefined
  if (!endpoint || !key) throw new Error('Set both OCR_AZURE_ENDPOINT and OCR_AZURE_KEY, using a Free/F0 resource only.')
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('OCR_AZURE_ENDPOINT must be the HTTPS root endpoint of your Azure Document Intelligence resource.')
  }
  const monthlyLimit = Number(env.OCR_MONTHLY_LIMIT ?? 450)
  if (!Number.isInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 450) throw new Error('OCR_MONTHLY_LIMIT must be between 1 and 450, below the F0 500-page allowance.')
  return { endpoint: url.origin, key, monthlyLimit }
}

const span = z.object({ offset: z.number().int().min(0), length: z.number().int().min(0) })
const analysisSchema = z.object({
  status: z.enum(['notStarted', 'running', 'succeeded', 'failed']),
  analyzeResult: z.object({
    content: z.string().max(100_000),
    pages: z.array(z.object({
      words: z.array(z.object({ confidence: z.number().min(0).max(1), span })).max(20_000),
    })).max(1),
  }).optional(),
})
type Analysis = NonNullable<z.infer<typeof analysisSchema>['analyzeResult']>

export function numberedAnswers(analysis: Analysis, count: number): PhotoRecognition {
  const answers: PhotoRecognition['answers'] = Array.from({ length: count }, (_, index) => ({ number: index + 1, text: null, confidence: null }))
  const warnings = new Set<string>()
  const seen = new Set<number>()
  const words = analysis.pages.flatMap(page => page.words)
  const numberedLine = /^\s*(\d{1,3})[.)\]:-]?\s+(.+?)\s*$/
  const content = analysis.content.trim()
  const ordered = content.split(/[,;:]/.test(content) ? /[,;:]/ : /\r?\n/).map(text => text.trim())
  if (!analysis.content.split('\n').some(line => numberedLine.test(line)) && ordered.length === count && ordered.every(text => text && !/[\r\n]/.test(text))) {
    let offset = 0
    return {
      answers: ordered.map((text, index) => {
        const start = analysis.content.indexOf(text, offset)
        offset = start + text.length
        const confidences = words.filter(word => word.span.offset < start + text.length && word.span.offset + word.span.length > start).map(word => word.confidence)
        return { number: index + 1, text: text.slice(0, 1000), confidence: confidences.length ? Math.min(...confidences) : null }
      }),
      warnings: ['Check the answer order before saving.'],
    }
  }
  let offset = 0
  for (const line of analysis.content.split('\n')) {
    const match = numberedLine.exec(line)
    if (match) {
      const number = Number(match[1])
      if (number < 1 || number > count) warnings.add('Some numbers are outside this challenge. Check the whole sheet for missing or shifted answers.')
      else if (seen.has(number)) {
        answers[number - 1] = { number, text: null, confidence: null }
        warnings.add(`Number ${number} appeared more than once. Mark it yourself.`)
      } else {
        const text = match[2]
        const start = offset + line.indexOf(text, match[0].indexOf(match[1]) + match[1].length)
        const confidences = words.filter(word => word.span.offset < start + text.length && word.span.offset + word.span.length > start).map(word => word.confidence)
        answers[number - 1] = { number, text: text.slice(0, 1000), confidence: confidences.length ? Math.min(...confidences) : null }
      }
      seen.add(number)
    } else if (line.trim()) warnings.add('Some text could not be matched to a number. Never assume unnumbered answers are in order.')
    offset += line.length + 1
  }
  if (answers.some(answer => answer.text === null)) warnings.add('Some answers could not be read reliably. Compare them with the paper and mark them yourself.')
  return { answers, warnings: [...warnings] }
}

export async function normalizePhoto(input: Buffer) {
  try {
    const image = sharp(input, { limitInputPixels: 24_000_000, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported photo format.')
    // Re-encoding strips EXIF/GPS and other metadata before anything leaves the server.
    const normalized = await image.rotate().resize({ width: 2600, height: 3600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
    if (normalized.length > 4 * 1024 * 1024) throw new Error('Normalized photo is too large.')
    return normalized
  } catch {
    throw new HttpError(400, 'Use a readable, single JPEG or PNG photo under 4 MB and 24 megapixels.')
  }
}

export async function readAzurePhoto(image: Buffer, language: Language, count: number, config: OcrOptions, pause = (ms: number) => delay(ms)): Promise<PhotoRecognition> {
  return numberedAnswers(await readAzureAnalysis(image, language, config, pause), count)
}

export async function readAzureDocument(image: Buffer, language: Language, config: OcrOptions, pause = (ms: number) => delay(ms)): Promise<string> {
  return (await readAzureAnalysis(image, language, config, pause)).content
}

async function readAzureAnalysis(image: Buffer, language: Language, config: OcrOptions, pause: (ms: number) => Promise<unknown>): Promise<Analysis> {
  const headers = { 'Ocp-Apim-Subscription-Key': config.key }
  const signal = AbortSignal.timeout(75_000)
  let operation: URL | undefined
  try {
    const response = await fetch(`${config.endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&pages=1&locale=${language}&stringIndexType=utf16CodeUnit`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Source: image.toString('base64') }), signal, redirect: 'error',
    })
    if (response.status === 429) throw new HttpError(429, 'Azure’s free quota or request limit was reached. Wait or review manually; no paid fallback is used.')
    if (response.status === 401 || response.status === 403) throw new HttpError(503, 'Azure rejected the OCR credentials. Check the Free/F0 resource configuration.')
    if (response.status !== 202) throw new HttpError(502, 'Azure could not read this photo. No practice results were saved. Try another photo or review manually.')
    const location = response.headers.get('Operation-Location')
    if (!location) throw new HttpError(502, 'Azure did not return a photo-reading operation.')
    operation = new URL(location)
    if (operation.origin !== config.endpoint || !/^\/documentintelligence\/documentModels\/prebuilt-read\/analyzeResults\/[a-zA-Z0-9-]+$/.test(operation.pathname) || operation.username || operation.password) {
      operation = undefined
      throw new HttpError(502, 'Azure returned an unexpected operation address.')
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      await pause(2000)
      const poll = await fetch(operation, { headers, signal, redirect: 'error' })
      if (poll.status === 429) throw new HttpError(429, 'Azure is busy or the free quota is exhausted. Review manually or try again later.')
      if (!poll.ok) throw new HttpError(502, 'Could not retrieve the photo reading from Azure. No practice results were saved.')
      const result = analysisSchema.safeParse(await poll.json())
      if (!result.success) throw new HttpError(502, 'Azure returned an unreadable result. Please review the sheet manually.')
      if (result.data.status === 'failed') throw new HttpError(422, 'Azure could not recognize this sheet. Retake the photo or review manually.')
      if (result.data.status === 'succeeded') {
        if (!result.data.analyzeResult) throw new HttpError(502, 'Azure returned no recognized text.')
        return result.data.analyzeResult
      }
    }
    throw new HttpError(504, 'Photo reading took too long. Review manually or try again later; no results were saved.')
  } catch (error) {
    if (error instanceof HttpError) throw error
    // Do not log provider bodies, photos, or credentials.
    console.error('Azure photo reading failed:', error instanceof Error ? error.name : 'unknown error')
    throw new HttpError(502, 'The photo-reading service is unreachable. No results were saved. Review manually or try later.')
  } finally {
    if (operation) {
      try {
        const deleted = await fetch(operation, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000), redirect: 'error' })
        if (!deleted.ok && deleted.status !== 404) console.error('Azure photo cleanup failed:', deleted.status)
      } catch { console.error('Azure photo cleanup could not be confirmed; Azure’s temporary retention policy applies.') }
    }
  }
}
