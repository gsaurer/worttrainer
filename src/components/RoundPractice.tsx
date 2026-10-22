import { useEffect, useRef, useState, type ReactNode } from 'react'
import { roundStatistics, suggestedResult, type PracticeRound, type RoundStatus, type Word } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage, languages, shuffled } from '../lib/words'
import { useDictation } from '../hooks/useDictation'
import { SpeakerIcon } from './Icons'

function RoundStatistics({ rounds }: { rounds: PracticeRound[] }) {
  const stats = roundStatistics(rounds)
  return <section className="round-statistics" aria-label="Round statistics">
    <p className="eyebrow">PARENT-CONFIRMED, NOT PHOTO-GUESSED</p>
    <div className="round-stats-grid">
      <div><strong>{stats.completed}<small> / {stats.started}</small></strong><span>Rounds reviewed</span></div>
      <div className="round-stat-correct"><strong>{stats.correct}</strong><span>Correct answers</span></div>
      <div className="round-stat-incorrect"><strong>{stats.incorrect}</strong><span>Incorrect answers</span></div>
      <div><strong>{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</strong><span>Accuracy · {stats.reviewed} reviewed</span></div>
    </div>
    {stats.reviewed > 0 && <div className="round-result-bar" role="img" aria-label={`${stats.correct} correct and ${stats.incorrect} incorrect answers`}><span style={{ width: `${stats.correct / stats.reviewed * 100}%` }} /></div>}
    <p className="fine-print">{stats.pending} unfinished {stats.pending === 1 ? 'round' : 'rounds'} · {stats.unmarked} unmarked {stats.unmarked === 1 ? 'word' : 'words'}. Unmarked answers never count as incorrect. Statistics use saved rounds only.</p>
  </section>
}

export function RoundPractice({ words, onUpdated, loading = false, filters }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading?: boolean
  filters?: ReactNode
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
  return <section className="photo-practice" aria-label="Practice rounds">
    {round && <div className="practice-topline">
      <span>Round <span className="round-id" title={round.id}>#{round.id.slice(0, 8)}</span></span>
      <button className="text-button" disabled={busy} onClick={back}>{round.reviewedAt ? 'Back to round history' : 'Pause and return to rounds'}</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {!round ? <>
      <div className="photo-intro">
        <p className="eyebrow">A LITTLE PRACTICE. A RECORD OF PROGRESS.</p>
        <h2>One round, one step forward.</h2>
        <p>Choose your words, then listen and write the whole round on paper. Number each answer <strong>1, 2, 3…</strong> in dictation order. At the end, mark the answers manually or upload one photo and check the suggestions.</p>
        {filters}
        <p className="fine-print">No child account or name is needed. Photograph only the answers, not names, faces, or other personal details. Unclear handwriting never automatically counts as wrong.</p>
        <button className="button primary" disabled={busy || loading || !status || !words.length || !speech.supported} onClick={() => void run(async () => { openRound(await api.createPhotoRound(shuffled(words).slice(0, 100).map(word => word.id))) })}>Start round ({Math.min(words.length, 100)} {words.length === 1 ? 'word' : 'words'})</button>
        {!words.length && <p className="notice">{loading ? 'Syncing your collection…' : 'Add words or choose another language or category before starting a round.'}</p>}
        {words.length > 100 && <p className="notice">{words.length} words match your filters. This round selects 100 at random; choose a category for a smaller round.</p>}
        {!speech.supported && <p className="error">This browser does not support dictation. Use a current Chrome, Edge, or Safari browser.</p>}
        {status && <p className="notice">{status.ocr.enabled ? `Photo reading configured. Shared server budget: ${status.ocr.used} of ${status.ocr.limit} reserved readings used in ${status.ocr.month} (UTC). Your sheets and results remain private.` : 'Automatic reading is not configured yet. Set an Azure Free/F0 endpoint and key on the server; manual end-of-sheet review already works.'}</p>}
        {!status && <button className="text-button" disabled={busy} onClick={() => void run(async () => { setStatus(await api.photoStatus()) })}>Reload saved rounds</button>}
      </div>
      {status && <RoundStatistics rounds={status.rounds} />}
      {status && <div className="photo-history"><div className="round-history-heading"><div><p className="eyebrow">YOUR PRACTICE NOTEBOOK</p><h3>Round history</h3></div><button className="text-button" disabled={busy} onClick={() => void run(async () => { setStatus(await api.photoStatus()) })}>Refresh rounds</button></div><p className="fine-print">All saved rounds, across both languages. Opening a round does not record another attempt. Earlier photo rounds are included; older individual answers cannot be reconstructed into rounds.</p>
        {!status.rounds.length && <p>No rounds yet. Start with a few words; your round and its results will be saved here.</p>}
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
        <button className={`listen-button ${speech.speaking ? 'speaking' : ''}`} onClick={() => speech.speak(word.text, word.language)} aria-label="Listen to the hidden word"><SpeakerIcon /></button>
        <h2>Write answer number {round.nextIndex + 1}.</h2>
        <p>Listen, then write the number and word on their own line.<br />The spelling stays hidden until the parent review.</p>
        {speech.error && <p className="error" role="alert">{speech.error}</p>}
        <button className="button primary" disabled={busy} onClick={() => { speech.stop(); void run(async () => { setRound(await api.advancePhotoRound(round.id, round.nextIndex + 1)) }) }}>{busy ? 'Saving place…' : round.nextIndex + 1 === round.words.length ? 'All written — check the sheet' : 'Written — next word'}</button>
        <p className="fine-print">Your place is saved after each word. No spelling result is recorded yet.</p>
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
