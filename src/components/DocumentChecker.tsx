import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, FileCheck2, Plus, RotateCcw, Upload } from 'lucide-react'
import { validateWord, type ChallengeStatus, type DocumentCheck, type LanguagePreferences } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage, languages } from '../lib/words'
import { useI18n } from '../i18n/context'
import { AnswerCamera } from './AnswerCamera'

type Correction = { word: string; selected: boolean; saved: boolean }

export function DocumentChecker({ preferences, onUpdated, onBack }: {
  preferences: LanguagePreferences
  onUpdated: () => Promise<void>
  onBack: () => void
}) {
  const { t, message } = useI18n()
  const available = preferences.enabled.filter((language): language is DocumentCheck['language'] => language === 'en' || language === 'de')
  const [chosen, setChosen] = useState<DocumentCheck['language']>(preferences.defaultLanguage === 'en' ? 'en' : 'de')
  const language = available.includes(chosen) ? chosen : available[0]
  const [ocr, setOcr] = useState<ChallengeStatus['ocr'] | null>(null)
  const [retry, setRetry] = useState(0)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [result, setResult] = useState<DocumentCheck | null>(null)
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [busy, setBusy] = useState<'checking' | 'adding' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const active = useRef(false)

  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    let current = true
    void api.challengeStatus().then(status => { if (current) { setOcr(status.ocr); setError('') } })
      .catch(error => { if (current) setError(errorMessage(error)) })
    return () => { current = false }
  }, [retry])
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  function reset() { setResult(null); setCorrections([]); setNotice(''); setError('') }
  function selectPhoto(file?: File) {
    if (!file || working.current) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 4 * 1024 * 1024 || file.size === 0) {
      setError('Choose one JPEG or PNG photo up to 4 MB.'); return
    }
    reset()
    setPhoto(file); setPhotoUrl(URL.createObjectURL(file)); setCameraOpen(false)
  }

  async function check() {
    if (!photo || !language || working.current) return
    working.current = true; setBusy('checking'); setError(''); setNotice('')
    try {
      const checked = await api.checkDocument(language, photo)
      if (!active.current) return
      setResult(checked)
      setCorrections(checked.possibleMistakes.map(finding => ({ word: finding.suggestions[0] ?? '', selected: !!finding.suggestions.length, saved: false })))
    } catch (error) { if (active.current) setError(errorMessage(error)) }
    finally {
      if (active.current) {
        setBusy(null)
        void api.challengeStatus().then(status => { if (active.current) setOcr(status.ocr) }).catch(() => {})
      }
      working.current = false
    }
  }

  const selected = corrections.filter(correction => correction.selected && !correction.saved)
  const invalid = selected.some(correction => validateWord(correction.word) !== null)
  const selectable = corrections.filter(correction => !correction.saved && validateWord(correction.word) === null)
  async function add() {
    if (!result || !selected.length || invalid || working.current) return
    working.current = true; setBusy('adding'); setError(''); setNotice('')
    try {
      const imported = await api.addDocumentWords(result.language, selected.map(correction => correction.word.trim()))
      if (!active.current) return
      setCorrections(previous => previous.map(correction => correction.selected ? { ...correction, saved: true, selected: false } : correction))
      setNotice(t('{added} added, {existing} already in your collection.', imported))
      await onUpdated()
    } catch (error) { if (active.current) setError(errorMessage(error)) }
    finally { working.current = false; if (active.current) setBusy(null) }
  }

  return <section className="document-checker" aria-label={t('Check my document')}>
    <button className="text-button resource-command" disabled={!!busy} onClick={onBack}><ArrowLeft size={18} />{t('Back to collection')}</button>
    {!language ? <p className="notice">{t('Enable English or German in Languages to check a document.')}</p> : <>
      <div className="document-toolbar">
        <label>{t('Document language')}<select value={language} disabled={!!busy} onChange={event => {
          if (event.target.value === 'en' || event.target.value === 'de') setChosen(event.target.value)
          reset()
        }}>{available.map(value => <option key={value} value={value}>{languages[value].name}</option>)}</select></label>
        {ocr && <span className="fine-print">{t('Photo budget: {used} / {limit}', { used: ocr.used, limit: ocr.limit })}</span>}
      </div>
      <label className="visually-hidden" htmlFor="document-photo">{t('Document photo (JPEG or PNG, up to 4 MB)')}</label>
      <input ref={input} id="document-photo" type="file" hidden accept="image/jpeg,image/png" capture="environment" disabled={!!busy} onChange={event => { selectPhoto(event.target.files?.[0]); event.target.value = '' }} />
      {cameraOpen ? <AnswerCamera disabled={!!busy} onCapture={selectPhoto} onUpload={() => input.current?.click()} /> : photoUrl ? <img className="document-photo" src={photoUrl} alt={t('Selected document')} /> : null}
      <div className="document-photo-actions">
        <button className="button secondary challenge-icon-button" disabled={!!busy} title={t(photo ? 'Retake photo' : 'Take a photo')} aria-label={t(photo ? 'Retake photo' : 'Take a photo')} onClick={() => { reset(); setPhoto(null); setPhotoUrl(''); setCameraOpen(true) }}><Camera size={20} /></button>
        <button className="button secondary challenge-icon-button" disabled={!!busy} title={t('Upload a photo')} aria-label={t('Upload a photo')} onClick={() => input.current?.click()}><Upload size={20} /></button>
        {!result && <button className="button primary resource-command" disabled={!!busy || !photo || !ocr?.enabled || ocr.used >= ocr.limit} onClick={() => void check()}><FileCheck2 size={18} />{t(busy === 'checking' ? 'Checking document...' : 'Check document')}</button>}
        {result && <button className="text-button resource-command" disabled={!!busy} onClick={() => { reset(); setPhoto(null); setPhotoUrl(''); setCameraOpen(false) }}><RotateCcw size={18} />{t('Check another document')}</button>}
      </div>
      {!ocr && <button className="text-button" disabled={!!busy} onClick={() => setRetry(previous => previous + 1)}>{t('Retry loading')}</button>}
      {ocr && !ocr.enabled && <p className="notice">{t('Automatic reading needs an Azure Free/F0 endpoint and key. Review the paper manually until these are configured.')}</p>}
      {ocr?.enabled && ocr.used >= ocr.limit && <p className="notice">{t('The monthly photo budget is exhausted. Use manual review; there is no paid fallback.')}</p>}
      {!result && <p className="fine-print">{t('Only send a document you are allowed to share. The photo is sent to Microsoft Azure for reading; spelling is checked locally. The app does not save this document. Azure may retain input/results for up to 24 hours; early deletion is requested. Crop out names and faces.')}</p>}
      {result && <div className="document-review">
        <h2>{t('Possible spelling mistakes')}</h2>
        <p className="fine-print">{t('{count} words checked. Names, specialist words and photo recognition can cause false alarms. Review each correction.', { count: result.wordCount })}</p>
        {result.limited && <p className="notice">{t('Showing the first 40 possible mistakes. Check a smaller section to see the rest.')}</p>}
        {!result.possibleMistakes.length ? <p role="status" className="notice">{t('No possible spelling mistakes found. A dictionary check cannot detect every error.')}</p> : <>
          <fieldset className="document-findings" disabled={!!busy}>
            <legend className="visually-hidden">{t('Corrections')}</legend>
            <label className="resource-section-choice resource-select-all"><input type="checkbox" checked={selectable.length > 0 && selectable.every(correction => correction.selected)} onChange={event => setCorrections(previous => previous.map(correction => ({ ...correction, selected: !correction.saved && event.target.checked && validateWord(correction.word) === null })))} />{t('Select all corrections')}</label>
            {result.possibleMistakes.map((finding, index) => {
              const correction = corrections[index]
              return <div className="document-finding" key={finding.word}>
                <label className="resource-section-choice"><input type="checkbox" checked={correction.selected} disabled={correction.saved} onChange={event => setCorrections(previous => previous.map((value, position) => position === index ? { ...value, selected: event.target.checked } : value))} /><span lang={result.language}>{finding.word}</span><small>{t(finding.occurrences === 1 ? 'Found once' : 'Found {count} times', { count: finding.occurrences })}</small></label>
                <div className="document-correction">
                  <label htmlFor={`correction-${index}`}>{t('Correct spelling for {word}', { word: finding.word })}<input id={`correction-${index}`} lang={result.language} spellCheck={false} autoComplete="off" maxLength={80} list={`suggestions-${index}`} value={correction.word} disabled={correction.saved} aria-invalid={correction.selected && validateWord(correction.word) !== null} onChange={event => setCorrections(previous => previous.map((value, position) => position === index ? { ...value, word: event.target.value, selected: true } : value))} /></label>
                  <datalist id={`suggestions-${index}`}>{finding.suggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}</datalist>
                  {correction.saved ? <span className="fine-print">{t('In your collection')}</span> : !finding.suggestions.length && <span className="fine-print">{t('No suggestion. Enter a correction or leave this word unselected.')}</span>}
                </div>
              </div>
            })}
          </fieldset>
          <div className="resource-add-actions"><button className="button primary resource-command" disabled={!!busy || !selected.length || invalid} onClick={() => void add()}><Plus size={18} />{t(busy === 'adding' ? 'Adding words...' : 'Add selected words')}</button></div>
        </>}
        <details className="document-text"><summary>{t('Recognized text')}</summary><p lang={result.language}>{result.text}</p></details>
      </div>}
    </>}
    {busy === 'checking' && <p role="status">{t('Checking document...')}</p>}
    {error && <p role="alert" className="error">{message(error)}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
  </section>
}