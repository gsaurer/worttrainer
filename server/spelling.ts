import nspell from 'nspell'
import type { DocumentCheck } from '../shared/model.js'
import { HttpError } from './errors.js'

const dictionaries = new Map<string, Promise<ReturnType<typeof nspell>[]>>()

function spellings(language: DocumentCheck['language']) {
  let pending = dictionaries.get(language)
  if (!pending) {
    pending = (language === 'en'
      ? Promise.all([import('dictionary-en'), import('dictionary-en-gb')])
      : Promise.all([import('dictionary-de')]))
      .then(modules => modules.map(({ default: dictionary }) => nspell({
        aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic),
      })))
    dictionaries.set(language, pending)
    void pending.catch(() => dictionaries.delete(language))
  }
  return pending
}

export async function checkSpelling(text: string, language: string): Promise<DocumentCheck> {
  if (language !== 'en' && language !== 'de') throw new HttpError(400, 'Document checks currently support English and German.')
  if (text.length > 20_000) throw new HttpError(413, 'Use a shorter document (up to 20,000 characters).')
  const normalized = text.normalize('NFC')
  const tokens = normalized.match(/\p{L}[\p{L}\p{M}]*(?:['’\u002d][\p{L}\p{M}]+)*/gu) ?? []
  if (!tokens.length) throw new HttpError(422, 'No readable words were found. Try a clearer photo.')
  if (tokens.length > 2000) throw new HttpError(413, 'Use a shorter document (up to 2,000 words).')
  const checkers = await spellings(language)
  const counts = new Map<string, { word: string; occurrences: number }>()
  for (const word of tokens) {
    const key = word.replaceAll('’', "'")
    const entry = counts.get(key)
    if (entry) entry.occurrences++
    else counts.set(key, { word, occurrences: 1 })
  }
  const possibleMistakes: DocumentCheck['possibleMistakes'] = []
  let limited = false
  let processed = 0
  for (const { word, occurrences } of counts.values()) {
    if (++processed % 10 === 0) await new Promise<void>(resolve => setImmediate(resolve))
    const candidate = word.replaceAll('’', "'")
    const correct = (value: string) => value.length <= 64 && checkers.some(checker => checker.correct(value))
    if (correct(candidate) || (candidate.includes('-') && candidate.split('-').every(correct))) continue
    if (possibleMistakes.length === 40) { limited = true; continue }
    const suggestions = possibleMistakes.length < 15 && candidate.length <= 24
      ? [...new Set(checkers.flatMap(checker => checker.suggest(candidate).slice(0, 5)))].slice(0, 5)
      : []
    possibleMistakes.push({ word, occurrences, suggestions })
  }
  return { language, text: normalized, wordCount: tokens.length, possibleMistakes, limited }
}