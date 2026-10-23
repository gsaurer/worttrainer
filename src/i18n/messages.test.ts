import { describe, expect, it } from 'vitest'
import { german, germanErrors, translate, translateError } from './messages'
import { translations } from './context'

describe('German and English messages', () => {
  it('has nonempty German text and identical placeholders for every English source message', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    for (const [source, target] of Object.entries(german)) {
      expect(target.trim(), source).not.toBe('')
      expect(placeholders(target), source).toEqual(placeholders(source))
    }
    for (const target of Object.values(germanErrors)) expect(target.trim()).not.toBe('')
  })

  it('substitutes message values without interpreting or translating the supplied data', () => {
    expect(translate('de', 'Already in {language} · {category}.', { language: 'English', category: 'Neu' })).toBe('Bereits in English · Neu.')
    expect(translate('en', 'Confirm all {count} results', { count: 15 })).toBe('Confirm all 15 results')
    expect(translate('de', 'Delete {word}', { word: '<Straße>' })).toBe('<Straße> löschen')
  })

  it('translates known errors, OCR warnings and validation issues without hiding unknown technical details', () => {
    expect(translateError('de', 'That word is already in this language’s collection.')).toBe('Dieses Wort ist bereits in der Sammlung dieser Sprache.')
    expect(translateError('de', 'Number 12 appeared more than once. Mark it yourself.')).toBe('Nummer 12 kommt mehrfach vor. Bewerte sie selbst.')
    expect(translateError('de', 'Unrecognized key: "accountId"')).toBe('Prüfe deine Eingaben und versuche es erneut.')
    expect(translateError('de', 'Storage unavailable: EIO')).toBe('Storage unavailable: EIO')
    expect(translateError('en', 'Failed to fetch')).toBe('Failed to fetch')
  })

  it('formats displayed dates and category names by website language, leaving data codes untouched', () => {
    const timestamp = '2026-10-23T13:45:00Z'
    expect(translations('de').date(timestamp)).toBe(new Date(timestamp).toLocaleString('de-DE'))
    expect(translations('en').date(timestamp)).toBe(new Date(timestamp).toLocaleString('en-GB'))
    expect(translations('de').categoryLabel('new')).toBe('Neu')
    expect(translations('en').categoryLabel('new')).toBe('New')
    expect(translations('de').categoryLabel('minus')).toBe('−')
  })
})
