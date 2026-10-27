import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, PencilLine } from 'lucide-react'
import { validateWord, type WebsiteLanguage, type Word, type WordResource } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { useI18n } from '../i18n/context'

export function FirstRun({ onComplete }: { onComplete: (words: Word[]) => Promise<void> }) {
  const { t, message, language } = useI18n()
  const [step, setStep] = useState<'language' | 'words'>('language')
  const [selectedLanguage, setLanguage] = useState<WebsiteLanguage>(language)
  const [source, setSource] = useState<'custom' | 'demo'>('demo')
  const [words, setWords] = useState(() => Array<string>(10).fill(''))
  const [catalog, setCatalog] = useState<WordResource[] | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    void api.wordResources().then(resources => { if (active) setCatalog(resources) })
      .catch(error => { if (active) setCatalogError(errorMessage(error)) })
    return () => { active = false }
  }, [retry])
  useEffect(() => { heading.current?.focus() }, [step])

  const entries = words.map(word => word.trim())
  const filled = entries.filter(Boolean)
  const invalid = filled.map(validateWord).find(Boolean)
  const duplicate = new Set(filled.map(word => word.toLowerCase())).size !== filled.length
  const validation = invalid || (duplicate ? 'Enter ten different words.' : '')
  const demoId = selectedLanguage === 'de' ? 'demo-deutsche-stolperwoerter' : 'demo-english-spelling-traps'
  const demo = catalog?.find(resource => resource.id === demoId)?.sections.flatMap(section => section.entries.map(entry => entry.word)).slice(0, 10) ?? []
  const ready = source === 'custom' ? filled.length === 10 && !validation : demo.length === 10

  async function save() {
    if (!ready || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const saved = await api.completeFirstRun(source === 'custom'
        ? { language: selectedLanguage, source, words: entries }
        : { language: selectedLanguage, source })
      await onComplete(saved)
    } catch (error) { setError(errorMessage(error)) }
    finally { saving.current = false; setBusy(false) }
  }

  return <section className="first-run" aria-labelledby="first-run-title">
    <p className="first-run-step">{t('Step {step} of 2', { step: step === 'language' ? 1 : 2 })}</p>
    <h1 id="first-run-title">{t('Your first ten words')}</h1>
    <form onSubmit={event => { event.preventDefault(); if (step === 'language') setStep('words'); else void save() }}>
      <h2 ref={heading} tabIndex={-1}>{t(step === 'language' ? 'Which language?' : 'Words your child finds tricky')}</h2>
      {step === 'language' ? <fieldset className="first-run-choices" disabled={busy}>
        <legend className="visually-hidden">{t('Practice language')}</legend>
        <div className="segmented">
          {(['de', 'en'] as const).map(value => <button key={value} type="button" aria-pressed={selectedLanguage === value} className={selectedLanguage === value ? 'selected' : ''} onClick={() => setLanguage(value)}>{selectedLanguage === value && <Check size={18} aria-hidden="true" />}{value === 'de' ? 'Deutsch' : 'English'}</button>)}
        </div>
      </fieldset> : <>
        <fieldset className="first-run-choices" disabled={busy}>
          <legend className="visually-hidden">{t('Word choice')}</legend>
          <div className="segmented">
            <button type="button" aria-pressed={source === 'demo'} className={source === 'demo' ? 'selected' : ''} onClick={() => { setSource('demo'); setError('') }}><BookOpen size={18} aria-hidden="true" />{t('Starter words')}</button>
            <button type="button" aria-pressed={source === 'custom'} className={source === 'custom' ? 'selected' : ''} onClick={() => { setSource('custom'); setError('') }}><PencilLine size={18} aria-hidden="true" />{t('Your own words')}</button>
          </div>
        </fieldset>
        {source === 'custom' ? <>
          <ol className="first-run-words">
            {words.map((word, index) => <li key={index}><label htmlFor={`first-word-${index}`}>{t('Word {number}', { number: index + 1 })}</label><input id={`first-word-${index}`} value={word} required disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={validation ? 'first-run-validation' : undefined} onChange={event => setWords(current => current.map((entry, position) => position === index ? event.target.value : entry))} /></li>)}
          </ol>
          <p className="first-run-count" role="status">{t('{count} of 10 words', { count: filled.length })}</p>
          {validation && <p id="first-run-validation" className="error" role="alert">{message(validation)}</p>}
        </> : catalogError ? <p className="error" role="alert">{message(catalogError)} <button type="button" className="text-button" onClick={() => { setCatalogError(''); setCatalog(null); setRetry(current => current + 1) }}>{t('Retry loading')}</button></p>
          : !catalog ? <p role="status">{t('Loading starter words...')}</p>
            : demo.length !== 10 ? <p className="error" role="alert">{t('Starter words are not available. Please try again.')}</p>
              : <ol className="first-run-preview">{demo.map(word => <li key={word}>{word}</li>)}</ol>}
      </>}
      {error && <p className="error" role="alert">{message(error)}</p>}
      <div className="first-run-actions">
        {step === 'words' && <button type="button" className="button secondary" disabled={busy} onClick={() => { setStep('language'); setError('') }}><ArrowLeft size={18} aria-hidden="true" />{t('Back')}</button>}
        <button type="submit" className="button primary" disabled={busy || (step === 'words' && !ready)}>{t(step === 'language' ? 'Continue' : busy ? 'Saving...' : 'Save and practice')}<ArrowRight size={18} aria-hidden="true" /></button>
      </div>
    </form>
  </section>
}