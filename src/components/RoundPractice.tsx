import { useEffect, useRef, useState, type ReactNode } from 'react'
import { roundStatistics, suggestedResult, type PracticeRound, type RoundStatus, type Word } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage, languages, shuffled } from '../lib/words'
import { useDictation } from '../hooks/useDictation'
import { SpeakerIcon } from './Icons'

function RoundStatistics({ rounds }: { rounds: PracticeRound[] }) {
  const stats = roundStatistics(rounds)
  return <section className="round-statistics" aria-label="Round statistics">
    <h3>Results</h3>
    <div className="round-stats-grid">
      <div><strong>{stats.completed}<small> / {stats.started}</small></strong><span>Rounds reviewed</span></div>
      <div className="round-stat-correct"><strong>{stats.correct}</strong><span>Correct answers</span></div>
      <div className="round-stat-incorrect"><strong>{stats.incorrect}</strong><span>Incorrect answers</span></div>
      <div><strong>{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</strong><span>Accuracy · {stats.reviewed} reviewed</span></div>
    </div>
    {stats.reviewed > 0 && <div className="round-result-bar" role="img" aria-label={`${stats.correct} correct and ${stats.incorrect} incorrect answers`}><span style={{ width: `${stats.correct / stats.reviewed * 100}%` }} /></div>}
    <p className="fine-print">{stats.pending} unfinished {stats.pending === 1 ? 'round' : 'rounds'} · {stats.unmarked} unmarked {stats.unmarked === 1 ? 'word' : 'words'}. Only checked answers count.</p>
  </section>
}

export function RoundPractice({ words, onUpdated, loading = false, filters, selectionLabel, onActiveChange }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading?: boolean
  filters?: ReactNode
  selectionLabel?: string
  onActiveChange?: (active: boolean) => void
}) {
  const [status, setStatus] = useState<RoundStatus | null>(null)
  const [round, setRound] = useState<PracticeRound | null>(null)
  const [answers, setAnswers] = useState<(boolean | null)[]>([])
  const [pendingResults, setPendingResults] = useState<boolean[] | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const working = useRef(false)
  const speech = useDictation()

  useEffect(() => {
    let active = true
    const refresh = () => api.photoStatus().then(data => { if (active) setStatus(data) }).catch(error => { if (active) setError(errorMessage(error)) })
    void refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  async function run(operation: () => Promise<void>) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try { await operation() }
    catch (error) { setError(errorMessage(error)) }
    finally { working.current = false; setBusy(false) }
  }

  function openRound(data: PracticeRound, keepPhoto = false) {
    speech.stop()
    setRound(data)
    onActiveChange?.(true)
    setAnswers(data.results ?? data.words.map((word, index) => {
      const answer = data.recognition?.answers[index]
      return suggestedResult(word.text, answer?.text ?? null, answer?.confidence ?? null)
    }))
    setReviewing(!!data.recognition || !!data.results)
    setPendingResults(null)
    if (!keepPhoto) {
      setPhoto(null)
      setPhotoUrl('')
    }
    setError('')
  }

  function back() {
    speech.stop()
    void run(async () => {
      setStatus(await api.photoStatus())
      setRound(null)
      onActiveChange?.(false)
      setPhoto(null)
      setPhotoUrl('')
      setPendingResults(null)
    })
  }

  async function save() {
    if (!round || answers.some(answer => answer === null)) return
    const results = pendingResults ?? answers.map(answer => answer === true)
    setPendingResults(results)
    await run(async () => {
      setRound(await api.reviewPhotoRound(round.id, results))
      void onUpdated()
    })
  }

  const word = round?.words[round.nextIndex]
  const roundSizes = [10, 15, 20]
  const shortRound = !loading && words.length > 0 && words.length < 20
  return <section className="photo-practice" aria-label="Practice rounds">
    {round && <div className="practice-topline">
      <span>Round <span className="round-id" title={round.id}>#{round.id.slice(0, 8)}</span></span>
      <button className="text-button" disabled={busy} onClick={back}>{round.reviewedAt ? 'Back to rounds' : 'Pause'}</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {!round ? <>
      <div className="photo-intro">
        <h2>Start a round</h2>
        <p className="round-instruction">Listen. Write numbered answers on paper. Check them at the end.</p>
        <p className="selection-summary">{selectionLabel && <>{selectionLabel} · </>}{loading ? 'Syncing…' : `${words.length} available`}</p>
        <div className="round-starts" role="group" aria-label="Start a practice round">
          {roundSizes.map((size, index) => <button key={size} className={`button ${index === 0 ? 'primary' : 'secondary'}`} aria-label={size === 20 ? 'Start 20-word challenge' : `Start ${size} words`} aria-describedby={shortRound ? 'round-size-note' : undefined} disabled={busy || loading || !status || !words.length || !speech.supported} onClick={() => void run(async () => { openRound(await api.createPhotoRound(shuffled(words).slice(0, size).map(word => word.id))) })}><strong>{size}</strong><span>{size === 20 ? 'Challenge' : 'words'}</span></button>)}
        </div>
        {shortRound && <p className="round-size-note" id="round-size-note">Uses up to {words.length} available {words.length === 1 ? 'word' : 'words'}, without repeats.</p>}
        {filters && <details className="round-options"><summary>Change words</summary><fieldset className="round-filters" disabled={busy || loading}>{filters}</fieldset></details>}
        {!loading && !words.length && <p className="notice">No matching words. Add a word or change the filters.</p>}
        {!speech.supported && <p className="error">This browser does not support dictation. Use a current Chrome, Edge, or Safari browser.</p>}
        <details className="round-options"><summary>Instructions &amp; photo info</summary>
          <p>Number each paper answer 1, 2, 3… After writing, mark the answers manually or upload one photo. Check every photo suggestion before saving.</p>
          <p>Photograph answers only, without names or faces. Photos are not stored by the app.</p>
          {status && <p>{status.ocr.enabled ? `Photo reading: ${status.ocr.used} of ${status.ocr.limit} shared readings used in ${status.ocr.month} (UTC).` : 'Automatic reading is not configured. You can still check answers manually.'}</p>}
        </details>
        {!status && <button className="text-button" disabled={busy} onClick={() => void run(async () => { setStatus(await api.photoStatus()) })}>Reload saved rounds</button>}
      </div>
      {status && status.rounds.length > 0 && <RoundStatistics rounds={status.rounds} />}
      {status && status.rounds.length > 0 && <div className="photo-history"><div className="round-history-heading"><h3>Round history</h3><button className="text-button" disabled={busy} onClick={() => void run(async () => { setStatus(await api.photoStatus()) })}>Refresh</button></div>
        {status.rounds.map(item => {
          const stats = roundStatistics([item])
          return <div className="photo-history-row" key={item.id}>
          <div><strong>{languages[item.words[0].language].name} · {item.words.length} {item.words.length === 1 ? 'word' : 'words'}</strong><small><span className="round-id" title={item.id}>Round #{item.id.slice(0, 8)}</span> · Started {new Date(item.startedAt).toLocaleString()}<br />{item.reviewedAt ? `Reviewed ${new Date(item.reviewedAt).toLocaleString()} · ${stats.correct} correct · ${stats.incorrect} incorrect · ${stats.accuracy}%` : item.writtenAt ? 'Written · awaiting parent review · no results recorded yet' : `${item.nextIndex} of ${item.words.length} written · in progress`}</small></div>
          <button className="button secondary" disabled={busy} onClick={() => openRound(item)}>{item.reviewedAt ? 'View results' : 'Continue round'}</button>
          {deleteId === item.id ? <div><span>Remove this round and its statistics? Word progress stays.</span><button className="text-button danger" disabled={busy} onClick={() => void run(async () => { await api.deletePhotoRound(item.id); setStatus(await api.photoStatus()); setDeleteId(null) })}>Confirm removal</button><button className="text-button" onClick={() => setDeleteId(null)}>Cancel</button></div> : <button className="text-button" disabled={busy} onClick={() => setDeleteId(item.id)}>Remove round</button>}
        </div>})}
      </div>}
    </> : word ? <div className="active-practice">
      <progress className="session-progress" value={round.nextIndex} max={round.words.length} aria-label="Numbered answers written" />
      <div className="dictation-card">
        <p className="eyebrow">{languages[word.language].name.toUpperCase()} · WORD {round.nextIndex + 1} OF {round.words.length}</p>
        <h2>Write answer number {round.nextIndex + 1}.</h2>
        <button className={`listen-button ${speech.speaking ? 'speaking' : ''}`} onClick={() => speech.speak(word.text, word.language)} aria-label="Listen to the hidden word"><SpeakerIcon /><span>Listen</span></button>
        {speech.error && <p className="error" role="alert">{speech.error}</p>}
        <button className="button primary" disabled={busy} onClick={() => { speech.stop(); void run(async () => { setRound(await api.advancePhotoRound(round.id, round.nextIndex + 1)) }) }}>{busy ? 'Saving…' : round.nextIndex + 1 === round.words.length ? 'Check answers' : 'Next word'}</button>
      </div>
    </div> : <>
      <div className="photo-intro">
        <p className="eyebrow">{round.reviewedAt ? 'PARENT-CONFIRMED RESULTS' : 'FOR THE PARENT TO CHECK'}</p>
        <h2>{round.reviewedAt ? 'Another little step forward.' : 'Let’s check the whole sheet.'}</h2>
        <p>Started {new Date(round.startedAt).toLocaleString()}<br />Writing finished {new Date(round.writtenAt!).toLocaleString()}{round.reviewedAt && <><br />Reviewed and saved {new Date(round.reviewedAt).toLocaleString()}</>}</p>
        {round.reviewedAt && <RoundStatistics rounds={[round]} />}
        {!round.reviewedAt && <>
          <label htmlFor="answer-photo">One photo of the numbered answers (JPEG or PNG, up to 4 MB)</label>
          <input id="answer-photo" type="file" accept="image/jpeg,image/png" capture="environment" disabled={busy || !!pendingResults} onChange={event => {
            const file = event.target.files?.[0]
            setError('')
            setPhoto(null)
            setPhotoUrl('')
            if (!file) return
            if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 4 * 1024 * 1024) {
              setError('Choose one JPEG or PNG photo up to 4 MB. Reduce the camera resolution if needed.')
              return
            }

            setPhoto(file)
            setPhotoUrl(URL.createObjectURL(file))
          }} />
          <p className="fine-print">Sending the photo shares handwriting with Microsoft Azure in your configured region. The server strips image metadata and does not store the photo. Recognized text is saved with this round. Azure temporarily retains input/results for up to 24 hours; the app also requests early deletion. Crop out names and faces.</p>
          {!status?.ocr.enabled && <p className="notice">Automatic reading needs an Azure Free/F0 endpoint and key. Review the paper manually until these are configured.</p>}
          <div className="answer-buttons">
            <button className="button primary" disabled={busy || !photo || !status?.ocr.enabled || !!pendingResults || status.ocr.used >= status.ocr.limit} onClick={() => void run(async () => {
              const data = await api.readPhoto(round.id, photo!)
              openRound(data, true)
              setStatus(await api.photoStatus())
            })}>{busy ? 'Working…' : 'Send photo to Azure for reading'}</button>
            <button className="button secondary" disabled={busy || !!pendingResults} onClick={() => { setReviewing(true); setError('') }}>Review the sheet manually</button>
          </div>
          {status?.ocr.enabled && status.ocr.used >= status.ocr.limit && <p className="notice">The monthly photo budget is exhausted. Use manual review; there is no paid fallback.</p>}
        </>}
      </div>
      {photoUrl && <img className="answer-sheet-preview" src={photoUrl} alt="Selected numbered answer sheet for parent checking" />}
      {(reviewing || round.reviewedAt) && <div className="photo-review">
        {!round.reviewedAt && <p className="notice">These are suggestions, not saved results. Compare every answer with the actual paper/photo. Handwriting recognition can misread or accidentally correct a spelling mistake. Capitalization, accents, and umlauts count; override any mistaken suggestion.</p>}
        {round.recognition?.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
        <ol className="photo-answer-list">{round.words.map((item, index) => {
          const recognized = round.recognition?.answers[index]
          return <li key={item.id}>
            <div className="photo-answer-spelling"><span className="eyebrow">EXPECTED SPELLING</span><strong lang={item.language}>{item.text}</strong><span>Read: <span lang={item.language}>{recognized?.text ?? 'Not recognized — check the paper'}</span></span>{recognized?.text && <small>{recognized.confidence === null ? 'Confidence unavailable — mark manually' : `Recognition confidence: ${Math.round(recognized.confidence * 100)}%${recognized.confidence < 0.8 ? ' — mark manually' : ''}`}</small>}</div>
            {round.reviewedAt ? <span className={`badge ${round.results?.[index] ? 'plus' : 'minus'}`}>{round.results?.[index] ? 'Correct' : 'Keep practicing'}</span> : <label htmlFor={`answer-${index}`}>Parent’s result<select id={`answer-${index}`} value={answers[index] === null ? '' : answers[index] ? 'correct' : 'incorrect'} disabled={busy || !!pendingResults} onChange={event => setAnswers(previous => previous.map((answer, position) => position === index ? event.target.value === '' ? null : event.target.value === 'correct' : answer))}><option value="">Choose after checking</option><option value="correct">Spelled correctly</option><option value="incorrect">Not quite yet</option></select></label>}
          </li>
        })}</ol>
        {!round.reviewedAt && <><p className="fine-print">Only your confirmation records attempts and changes categories. All answers save together; retrying cannot count them twice.</p><button className="button primary wide" disabled={busy || answers.some(answer => answer === null)} onClick={() => void save()}>{busy ? 'Saving all results…' : pendingResults ? 'Retry confirming these same results' : `Confirm all ${round.words.length} results`}</button></>}
        {round.reviewedAt && <p className="notice" role="status">All {round.words.length} parent-confirmed results are saved to your account.</p>}
      </div>}
    </>}
  </section>
}
