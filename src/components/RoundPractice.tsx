import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { BarChart3, Check, ImageUp, Play, SkipBack, SkipForward, Square, Trash2, Volume2, X } from 'lucide-react'
import { challengeStatistics, suggestedResult, type NavigationTiming, type Challenge, type ChallengeStatus, type Word } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage, languages, selectPracticeWords } from '../lib/words'
import { useDictation } from '../hooks/useDictation'
import { useI18n } from '../i18n/context'

function ChallengeStatistics({ challenges }: { challenges: Challenge[] }) {
  const { t } = useI18n()
  const stats = challengeStatistics(challenges)
  return <section className="challenge-statistics" aria-label={t('Challenge statistics')}>
    <h3>{t('Results')}</h3>
    <div className="challenge-stats-grid">
      <div><strong>{stats.completed}<small> / {stats.started}</small></strong><span>{t('Challenges reviewed')}</span></div>
      <div className="challenge-stat-correct"><strong>{stats.correct}</strong><span>{t('Correct answers')}</span></div>
      <div className="challenge-stat-incorrect"><strong>{stats.incorrect}</strong><span>{t('Incorrect answers')}</span></div>
      <div><strong>{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</strong><span>{t('Accuracy · {count} reviewed', { count: stats.reviewed })}</span></div>
    </div>
    {stats.reviewed > 0 && <div className="challenge-result-bar" role="img" aria-label={t('{correct} correct and {incorrect} incorrect answers', { correct: stats.correct, incorrect: stats.incorrect })}><span style={{ width: `${stats.correct / stats.reviewed * 100}%` }} /></div>}
    <p className="fine-print">{t(stats.pending === 1 ? '{count} unfinished challenge' : '{count} unfinished challenges', { count: stats.pending })} · {t(stats.unmarked === 1 ? '{count} unmarked word' : '{count} unmarked words', { count: stats.unmarked })}. {t('Only checked answers count.')}</p>
  </section>
}

export function ChallengePractice({ words, onUpdated, loading = false, filters, selectionLabel, onActiveChange, view = 'practice' }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading?: boolean
  filters?: ReactNode
  selectionLabel?: string
  onActiveChange?: (active: boolean) => void
  view?: 'practice' | 'statistics'
}) {
  const { t, message, date } = useI18n()
  const [status, setStatus] = useState<ChallengeStatus | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [preparedWords, setPreparedWords] = useState<Word[] | null>(null)
  const [answers, setAnswers] = useState<(boolean | null)[]>([])
  const [pendingResults, setPendingResults] = useState<boolean[] | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [checkMode, setCheckMode] = useState<'manual' | 'photo' | null>(null)
  const [spellings, setSpellings] = useState<string[]>([])
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  const [intervalInput, setIntervalInput] = useState('5')
  const [automatic, setAutomatic] = useState(false)
  const [replay, setReplay] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showStatistics, setShowStatistics] = useState(false)
  const working = useRef(false)
  const wordStartedAt = useRef(0)
  const speech = useDictation()
  const { speak, stop } = speech

  useEffect(() => {
    let active = true
    const refresh = () => api.challengeStatus().then(data => { if (active) setStatus(data) }).catch(error => { if (active) setError(errorMessage(error)) })
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
    catch (error) { setAutomatic(false); stop(); setError(errorMessage(error)) }
    finally { working.current = false; setBusy(false) }
  }

  function openChallenge(data: Challenge, mode: 'manual' | 'photo' | null = null, keepPhoto = false) {
    speech.stop()
    setAutomatic(false)
    setShowStatistics(false)
    setPreparedWords(null)
    setChallenge(data)
    wordStartedAt.current = performance.now()
    const lastTiming = data.telemetry.at(-1)
    if (lastTiming) { setIntervalSeconds(lastTiming.intervalSeconds); setIntervalInput(String(lastTiming.intervalSeconds)) }
    onActiveChange?.(true)
    setAnswers(data.results ?? data.words.map((word, index) => {
      if (mode !== 'photo') return null
      const answer = data.recognition?.answers[index]
      return suggestedResult(word.text, answer?.text ?? null, answer?.confidence ?? null)
    }))
    setSpellings(data.check?.spellings.map(value => value ?? '') ?? data.words.map((_, index) => mode === 'photo' ? data.recognition?.answers[index]?.text ?? '' : ''))
    setCheckMode(data.check ? data.check.method : mode)
    setPendingResults(null)
    if (!keepPhoto) {
      setPhoto(null)
      setPhotoUrl('')
    }
    setError('')
  }

  function back() {
    setAutomatic(false)
    speech.stop()
    void run(async () => {
      if (challenge && !challenge.writtenAt) await api.advanceChallenge(challenge.id, challenge.nextIndex, timing('stop'))
      setStatus(await api.challengeStatus())
      setChallenge(null)
      onActiveChange?.(false)
      setPhoto(null)
      setPhotoUrl('')
      setPendingResults(null)
    })
  }

  async function save() {
    if (!challenge || !checkMode || answers.some(answer => answer === null)) return
    const results = pendingResults ?? answers.map(answer => answer === true)
    setPendingResults(results)
    await run(async () => {
      setChallenge(await api.reviewChallenge(challenge.id, results, { method: checkMode, spellings: spellings.map((spelling, index) => spelling.trim() || (results[index] ? challenge.words[index].text : null)) }))
      void onUpdated()
    })
  }

  function timing(action: NavigationTiming['action'], isAutomatic = automatic): NavigationTiming {
    if (!challenge) throw new Error('No active challenge.')
    return { fromIndex: challenge.nextIndex, elapsedMs: Math.min(604800000, Math.max(0, Math.round(performance.now() - wordStartedAt.current))), intervalSeconds, automatic: isAutomatic, action }
  }

  async function navigate(direction: -1 | 1, isAutomatic = false) {
    if (!challenge || challenge.writtenAt || working.current) return
    stop()
    await run(async () => {
      const updated = await api.advanceChallenge(challenge.id, challenge.nextIndex + direction, timing(direction === 1 ? 'next' : 'previous', isAutomatic))
      wordStartedAt.current = performance.now()
      setChallenge(updated)
      if (updated.writtenAt) setAutomatic(false)
      else if (!automatic) speak(updated.words[updated.nextIndex].text, updated.words[updated.nextIndex].language)
    })
  }

  function stopProgression() {
    setAutomatic(false)
    stop()
    if (challenge && !challenge.writtenAt) void run(async () => { setChallenge(await api.advanceChallenge(challenge.id, challenge.nextIndex, timing('stop'))) })
  }

  function playProgression() {
    if (!challenge) return
    void run(async () => {
      setChallenge(await api.advanceChallenge(challenge.id, challenge.nextIndex, timing('play', true)))
      setAutomatic(true)
    })
  }

  const advanceAutomatically = useEffectEvent(() => { void navigate(1, true) })
  const currentWord = challenge?.words[challenge.nextIndex]
  const spokenText = currentWord?.text
  const spokenLanguage = currentWord?.language
  useEffect(() => {
    if (!automatic || !spokenText || !spokenLanguage) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    speak(spokenText, spokenLanguage, success => {
      if (cancelled) return
      if (!success) { setAutomatic(false); return }
      timer = setTimeout(() => { if (!cancelled) advanceAutomatically() }, intervalSeconds * 1000)
    })
    return () => { cancelled = true; clearTimeout(timer); stop() }
  }, [automatic, challenge?.id, challenge?.nextIndex, spokenText, spokenLanguage, intervalSeconds, replay, speak, stop])

  const stopWhenHidden = useEffectEvent(() => {
    if (document.hidden && automatic) stopProgression()
  })
  useEffect(() => {
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => document.removeEventListener('visibilitychange', stopWhenHidden)
  }, [])

  const intervalControl = <label className="interval-control" htmlFor="word-interval">{t('Seconds between words')}<input id="word-interval" type="number" min={1} max={120} step={1} value={intervalInput} disabled={busy} onBlur={() => setIntervalInput(String(intervalSeconds))} onChange={event => {
    setIntervalInput(event.target.value)
    const value = Number(event.target.value)
    if (Number.isInteger(value) && value >= 1 && value <= 120) setIntervalSeconds(value)
  }} /></label>

  const word = challenge?.words[challenge.nextIndex]
  const challengeSizes = [10, 15, 20]
  const shortChallenge = !loading && words.length > 0 && words.length < 20
  const reporting = view === 'statistics'
  const history = status?.challenges.filter(item => reporting || !item.reviewedAt) ?? []
  return <section className={`photo-practice${reporting ? ' statistics-challenges' : ''}`} aria-label={t(reporting ? 'Challenges' : 'Practice challenges')}>
    {challenge && <div className="practice-topline">
      <span>{t('Practice challenges')}</span>
      <button className="text-button" disabled={busy} onClick={back}>{t(challenge.writtenAt ? 'Back to challenges' : 'Pause')}</button>
    </div>}
    {error && <p className="error" role="alert">{message(error)}</p>}
    {!challenge && preparedWords ? <div className="photo-intro challenge-ready">
      <h2>{t('Ready to write?')}</h2>
      <p className="selection-summary">{preparedWords.length} {t(preparedWords.length === 1 ? 'word' : 'words')}</p>
      <p>{t('Get a pen and paper. Write your answers in order.')}</p>
      <p>{t('Listen and write each word. Use the controls to pause or change speed.')}</p>
      <div className="answer-buttons">
        <button className="button primary" disabled={busy} onClick={() => void run(async () => {
          openChallenge(await api.createChallenge(preparedWords.map(word => word.id)))
          setAutomatic(true)
        })}><Play size={18} aria-hidden="true" />{t('Start')}</button>
      </div>
    </div> : !challenge ? <>
      {!reporting && <div className="photo-intro">
        <h2>{t('Start a challenge')}</h2>
        <p className="selection-summary">{selectionLabel && <>{selectionLabel} · </>}{loading ? t('Loading…') : t('{count} available', { count: words.length })}</p>
        <div className="challenge-starts" role="group" aria-label={t('Start a practice challenge')}>
          {challengeSizes.map(size => <button key={size} className={`button ${size === 15 ? 'primary' : 'secondary'}`} aria-label={t('Start {count} words', { count: size })} aria-describedby={shortChallenge ? 'challenge-size-note' : undefined} disabled={busy || loading || !status || !words.length || !speech.supported} onClick={() => { setPreparedWords(selectPracticeWords(words, size)); onActiveChange?.(true) }}><strong>{size}</strong><span>{t('words')}</span></button>)}
        </div>
        {shortChallenge && <p className="challenge-size-note" id="challenge-size-note">{t(words.length === 1 ? 'Uses up to {count} available word, without repeats.' : 'Uses up to {count} available words, without repeats.', { count: words.length })}</p>}
        {filters && <fieldset className="challenge-filters challenge-filters" aria-label={t('Filter words')} disabled={busy || loading}>{filters}</fieldset>}
        {!loading && !words.length && <p className="notice">{t('No matching words. Add a word or change the filters.')}</p>}
        {!speech.supported && <p className="error">{t('This browser does not support dictation. Use a current Chrome, Edge, or Safari browser.')}</p>}
        {!status && error && <button className="text-button" disabled={busy} onClick={() => void run(async () => { setStatus(await api.challengeStatus()) })}>{t('Retry loading')}</button>}
      </div>}
      {reporting && <>
        <div className="challenge-history-heading"><h2>{t('Challenges')}</h2></div>
        {!status && !error && <p role="status">{t('Loading challenges…')}</p>}
        {status && <><ChallengeStatistics challenges={status.challenges} />{!history.length && <p className="search-summary">{t('No challenges yet.')}</p>}</>}
      </>}
      {history.length > 0 && <div className="photo-history"><div className="challenge-history-heading"><h3>{t(reporting ? 'Challenge history' : 'Continue learning')}</h3></div>
        {history.map(item => {
          const stats = challengeStatistics([item])
          return <div className="photo-history-row" key={item.id}>
          <div><strong>{languages[item.words[0].language].name} · {item.words.length} {t(item.words.length === 1 ? 'word' : 'words')}</strong>{reporting && <small><span className="challenge-id" title={item.id}>{t('Challenge')} #{item.id.slice(0, 8)}</span> · {t('Started')} {date(item.startedAt)}<br />{item.reviewedAt ? t('Reviewed {date} · {correct} correct · {incorrect} incorrect · {accuracy}%', { date: date(item.reviewedAt), correct: stats.correct, incorrect: stats.incorrect, accuracy: stats.accuracy ?? '—' }) : item.writtenAt ? t('Written · awaiting parent review · no results recorded yet') : t('{position} of {count} written · in progress', { position: item.nextIndex, count: item.words.length })}</small>}</div>
          <div className="history-check-actions">
            {item.writtenAt && !item.reviewedAt ? <><button className="button secondary" disabled={busy} onClick={() => openChallenge(item, 'photo')}><ImageUp size={18} />{t('Auto check')}</button><button className="button secondary" disabled={busy} onClick={() => openChallenge(item, 'manual')}><Check size={18} />{t('Manual check')}</button></> : <button className={`button secondary${item.reviewedAt ? '' : ' challenge-icon-button'}`} title={t(item.reviewedAt ? 'View results' : 'Continue challenge')} aria-label={t(item.reviewedAt ? 'View results' : 'Continue challenge')} disabled={busy} onClick={() => openChallenge(item)}>{item.reviewedAt ? t('View results') : <Play size={18} aria-hidden="true" />}</button>}
            <button className="button secondary challenge-icon-button" title={t('Remove challenge')} aria-label={t('Remove challenge')} aria-expanded={deleteId === item.id} aria-controls={`remove-challenge-${item.id}`} disabled={busy} onClick={() => setDeleteId(item.id)}><Trash2 size={18} aria-hidden="true" /></button>
          </div>
          {deleteId === item.id && <div className="challenge-delete-confirmation" id={`remove-challenge-${item.id}`}><span>{t('Remove this challenge and its statistics? Word progress stays.')}</span><button className="text-button danger" disabled={busy} onClick={() => void run(async () => { await api.deleteChallenge(item.id); setStatus(await api.challengeStatus()); setDeleteId(null) })}>{t('Confirm removal')}</button><button className="text-button" disabled={busy} onClick={() => setDeleteId(null)}>{t('Cancel')}</button></div>}
        </div>})}
      </div>}
    </> : word ? <div className="active-practice">
      <progress className="session-progress" value={challenge.nextIndex} max={challenge.words.length} aria-label={t('Answers written')} />
      <div className="dictation-card">
        <p className="eyebrow">{languages[word.language].name.toUpperCase()} · {t('WORD {position} OF {count}', { position: challenge.nextIndex + 1, count: challenge.words.length })}</p>
        <h2>{t('Write answer number {position}.', { position: challenge.nextIndex + 1 })}</h2>
        <div className="dictation-player">
          <div className="dictation-controls" role="group" aria-label={t('Dictation controls')}>
            <button className="button secondary icon-button" title={t('Previous word')} aria-label={t('Previous word')} disabled={busy || challenge.nextIndex === 0} onClick={() => void navigate(-1)}><SkipBack /></button>
            <button className="button primary icon-button playback-toggle" title={t(automatic ? 'Stop' : 'Play automatically')} aria-label={t(automatic ? 'Stop' : 'Play automatically')} disabled={busy} onClick={automatic ? stopProgression : playProgression}>{automatic ? <Square /> : <Play />}</button>
            <button className="button secondary icon-button" title={t('Listen to the hidden word')} aria-label={t('Listen to the hidden word')} disabled={busy} onClick={() => {
              if (automatic) setReplay(previous => previous + 1)
              else speech.speak(word.text, word.language)
            }}><Volume2 /></button>
            <button className="button secondary icon-button" title={t(challenge.nextIndex + 1 === challenge.words.length ? 'Finish challenge' : 'Next word')} aria-label={t(challenge.nextIndex + 1 === challenge.words.length ? 'Finish challenge' : 'Next word')} disabled={busy} onClick={() => void navigate(1)}>{challenge.nextIndex + 1 === challenge.words.length ? <Check /> : <SkipForward />}</button>
          </div>
          {intervalControl}
        </div>
        {speech.error && <p className="error" role="alert">{speech.error}</p>}
      </div>
    </div> : <>
      <div className="photo-intro">
        <h2>{t(challenge.reviewedAt ? 'Your answers' : checkMode ? 'Check your answers' : 'Challenge finished.')}</h2>
        {challenge.reviewedAt && <button className="text-button statistics-toggle" aria-expanded={showStatistics} aria-controls="challenge-statistics" onClick={() => setShowStatistics(previous => !previous)}><BarChart3 size={18} />{t('Statistics')}</button>}
        {!challenge.reviewedAt && !checkMode && <div className="answer-buttons"><button className="button primary" onClick={() => openChallenge(challenge, 'photo')}><ImageUp size={18} />{t('Auto check')}</button><button className="button secondary" onClick={() => openChallenge(challenge, 'manual')}><Check size={18} />{t('Manual check')}</button><button className="button secondary" disabled={busy} onClick={back}><X size={18} />{t('Close')}</button></div>}
        {!challenge.reviewedAt && checkMode === 'photo' && <>
          <label htmlFor="answer-photo">{t('One photo of your answers (JPEG or PNG, up to 4 MB)')}</label>
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
          <p className="fine-print">{t('Sending the photo shares handwriting with Microsoft Azure in your configured region. The server strips image metadata and stores the photo and recognized text privately with this challenge until it is removed. Azure temporarily retains input/results for up to 24 hours; the app also requests early deletion. Crop out names and faces.')}</p>
          {!status?.ocr.enabled && <p className="notice">{t('Automatic reading needs an Azure Free/F0 endpoint and key. Review the paper manually until these are configured.')}</p>}
          <div className="answer-buttons">
            <button className="button primary" disabled={busy || !photo || !status?.ocr.enabled || !!pendingResults || status.ocr.used >= status.ocr.limit} onClick={() => void run(async () => {
              const data = await api.readPhoto(challenge.id, photo!)
              openChallenge(data, 'photo', true)
              setStatus(await api.challengeStatus())
            })}>{t(busy ? 'Working…' : 'Send photo to Azure for reading')}</button>
            <button className="button secondary" disabled={busy || !!pendingResults} onClick={() => openChallenge(challenge, 'manual')}>{t('Manual check')}</button>
          </div>
          {status?.ocr.enabled && status.ocr.used >= status.ocr.limit && <p className="notice">{t('The monthly photo budget is exhausted. Use manual review; there is no paid fallback.')}</p>}
        </>}
      </div>
      {showStatistics && challenge.reviewedAt && <div id="challenge-statistics"><ChallengeStatistics challenges={[challenge]} /></div>}
      {!challenge.reviewedAt && checkMode === 'photo' && (photoUrl || challenge.photo) && <img className="answer-sheet-preview" src={photoUrl || challenge.photo!.dataUrl} alt={t('Selected answer sheet for parent checking')} />}
      {(challenge.reviewedAt || checkMode === 'manual' || (checkMode === 'photo' && challenge.recognition)) && <div className="photo-review">
        {!challenge.reviewedAt && checkMode === 'photo' && <p className="notice">{t('These are suggestions, not saved results. Compare every answer with the actual paper/photo. Handwriting recognition can misread or accidentally correct a spelling mistake. Capitalization, accents, and umlauts count; override any mistaken suggestion.')}</p>}
        {checkMode === 'photo' && challenge.recognition?.warnings.map(warning => <p className="notice" key={warning}>{message(warning)}</p>)}
        <ol className="photo-answer-list" aria-label={t('Your answers')}>{challenge.words.map((item, index) => {
          const recognized = challenge.recognition?.answers[index]
          return <li key={item.id}>
            <div className="photo-answer-spelling"><span className="eyebrow">{t('EXPECTED SPELLING')}</span><strong lang={item.language} dir="auto">{item.text}</strong>{(checkMode === 'photo' || challenge.reviewedAt && challenge.recognition) && <><span>{t('Read:')} <span lang={item.language} dir="auto">{recognized?.text ?? t('Not recognized — check the paper')}</span></span>{!challenge.reviewedAt && recognized?.text && (recognized.confidence === null || recognized.confidence < 0.8) && <small>{t('Uncertain reading')}</small>}</>}</div>
            {challenge.reviewedAt ? <><span className={`badge ${challenge.results?.[index] ? 'plus' : 'minus'}`}>{t(challenge.results?.[index] ? 'Correct' : 'Keep practicing')}</span>{challenge.check?.spellings[index] && <p>{t('Written spelling')}: <span lang={item.language} dir="auto">{challenge.check.spellings[index]}</span></p>}</> : <>
              <div className="mark-answer" role="group" aria-label={t('Result for word {position}', { position: index + 1 })}>
                <button className="button secondary" aria-pressed={answers[index] === true} disabled={busy || !!pendingResults} onClick={() => setAnswers(previous => previous.map((answer, position) => position === index ? true : answer))}><Check size={18} />{t('Correct')}</button>
                <button className="button secondary" aria-pressed={answers[index] === false} disabled={busy || !!pendingResults} onClick={() => setAnswers(previous => previous.map((answer, position) => position === index ? false : answer))}><X size={18} />{t('Incorrect')}</button>
              </div>
              {(answers[index] === false || checkMode === 'photo') && <label htmlFor={`spelling-${index}`}>{t('Written spelling (optional)')}<input id={`spelling-${index}`} lang={item.language} dir="auto" maxLength={1000} value={spellings[index] ?? ''} disabled={busy || !!pendingResults} onChange={event => setSpellings(previous => previous.map((value, position) => position === index ? event.target.value : value))} /></label>}
            </>}
          </li>
        })}</ol>
        {!challenge.reviewedAt && <button className="button primary wide" disabled={busy || answers.some(answer => answer === null)} onClick={() => void save()}>{busy ? t('Saving all results…') : pendingResults ? t('Retry confirming these same results') : t('Confirm all {count} results', { count: challenge.words.length })}</button>}
        {challenge.reviewedAt && <><p className="notice" role="status">{t('Results saved.')}</p><button className="button primary" disabled={busy} onClick={back}><Check size={18} />{t('Done')}</button></>}
      </div>}
      <details className="challenge-options challenge-details"><summary>{t('Challenge details')}</summary>
        <p><span className="challenge-id">{t('Challenge')} #{challenge.id.slice(0, 8)}</span><br />{t('Started')} {date(challenge.startedAt)}<br />{t('Writing finished')} {date(challenge.writtenAt!)}{challenge.reviewedAt && <><br />{t('Reviewed and saved')} {date(challenge.reviewedAt)}</>}</p>
        {challenge.check && <p>{t('Check method')}: {t(challenge.check.method === 'photo' ? 'Auto check' : 'Manual check')}<br />{t('Check evaluated')}: {date(challenge.check.evaluatedAt)}</p>}
        {challenge.photo && <><p>{t('Photo uploaded')}: {date(challenge.photo.uploadedAt)}<br />{t('Photo evaluated')}: {date(challenge.photo.evaluatedAt)}</p>{(challenge.reviewedAt || checkMode !== 'photo') && <img className="answer-sheet-preview" src={challenge.photo.dataUrl} alt={t('Selected answer sheet for parent checking')} />}</>}
        {challenge.recognition && <div><h3>{t('Photo recognition')}</h3><ol>{challenge.recognition.answers.map(answer => <li key={answer.number}><span dir="auto">{answer.text ?? t('Not recognized — check the paper')}</span> · {answer.confidence === null ? t('Confidence unavailable — mark manually') : t('Recognition confidence: {confidence}%', { confidence: Math.round(answer.confidence * 100) })}</li>)}</ol></div>}
        {!!challenge.telemetry.length && <div className="timing-history"><h3>{t('Challenge timing')}</h3><ol>{challenge.telemetry.map((event, index) => <li key={index}>{t('Word {position}: {seconds} s · {mode} · {interval} s interval', { position: event.fromIndex + 1, seconds: (event.elapsedMs / 1000).toFixed(1), mode: t(event.automatic ? 'Automatic' : 'Manual'), interval: event.intervalSeconds })} · {t(event.action === 'previous' ? 'Previous word' : event.action === 'stop' ? 'Stop' : event.action === 'play' ? 'Play automatically' : event.action === 'listen' ? 'Listen' : 'Next word')}</li>)}</ol></div>}
      </details>
    </>}
  </section>
}
