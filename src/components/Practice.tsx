import { useRef, useState } from 'react'
import type { Category, Language, Word } from '../../shared/model'
import { categories, errorMessage, languages, shuffled } from '../lib/words'
import { useDictation } from '../hooks/useDictation'
import { createAttemptId } from '../lib/attempts'
import { api } from '../lib/api'
import { ArrowIcon, SpeakerIcon } from './Icons'

export function Practice({ words, onUpdated, loading }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading: boolean
}) {
  const [language, setLanguage] = useState<Language>('de')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [queue, setQueue] = useState<Word[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState<Word | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingAnswer, setPendingAnswer] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [correctCount, setCorrectCount] = useState(0)
  const attemptId = useRef('')
  const saving = useRef(false)
  const speech = useDictation()
  const candidates = words.filter(w => w.language === language && (category === 'all' || w.category === category))
  const word = queue?.[index]
  const finished = queue !== null && index >= queue.length

  function start() {
    if (!candidates.length) return
    speech.stop()
    setQueue(shuffled(candidates))
    setIndex(0)
    setRevealed(false)
    setSaved(null)
    setPendingAnswer(null)
    setCorrectCount(0)
    setError('')
    attemptId.current = createAttemptId()
  }

  async function mark(correct: boolean) {
    if (!word || !revealed || saving.current || saved) return
    saving.current = true
    setBusy(true)
    setPendingAnswer(correct)
    setError('')
    try {
      const data = await api.mark(word.id, correct, attemptId.current)
      if (!data) throw new Error('No progress was returned. Please retry saving this answer.')
      setSaved(data)
      if (correct) setCorrectCount(count => count + 1)
      void onUpdated()
    } catch (error) {
      setError(`This answer has not been confirmed as saved: ${errorMessage(error)} Retry to confirm it without counting it twice. If the word was deleted on another device, end this session and sync.`)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  function next() {
    speech.stop()
    setIndex(index + 1)
    setRevealed(false)
    setSaved(null)
    setPendingAnswer(null)
    setError('')
    attemptId.current = createAttemptId()
  }

  function end() {
    speech.stop()
    setQueue(null)
    setError('')
    void onUpdated()
  }

  if (finished && queue) return <section className="session-summary">
    <span className="summary-flower" aria-hidden="true">✳</span><p className="eyebrow">THAT’S A LITTLE MORE CONFIDENCE</p><h2>Practice, not perfection.</h2><p>You gave {queue.length} {queue.length === 1 ? 'word' : 'words'} some attention. That’s how progress happens.</p><div className="summary-stats"><div><strong>{correctCount}</strong><span>Correct this time</span></div><div><strong>{queue.length - correctCount}</strong><span>Keep practicing</span></div></div><p className="fine-print">All marked answers have been saved to your account.</p><button className="button primary" onClick={end}>Back to practice<ArrowIcon /></button>
  </section>

  if (queue && word) return <section className="active-practice" aria-label="Dictation practice">
    <div className="practice-topline"><span>{languages[word.language].name} <span aria-hidden="true">/</span> Word {index + 1} of {queue.length}</span><button className="text-button" onClick={end} disabled={busy}>End session</button></div>
    <progress className="session-progress" max={queue.length} value={index} aria-label="Words completed" />
    <div className="dictation-card">
      <p className="eyebrow">{revealed ? 'FOR THE PARENT TO CHECK' : 'LISTEN CLOSELY. TAKE YOUR TIME.'}</p>
      {revealed ? <h2 className="revealed-word" lang={word.language}>{word.text}</h2> : <><button className={`listen-button ${speech.speaking ? 'speaking' : ''}`} onClick={() => speech.speak(word.text, word.language)} aria-label="Listen to the hidden word"><SpeakerIcon /></button><h2>Your next little word.</h2><p>Listen to the word, then write it on paper.<br />You can listen as many times as you like.</p><span className="speech-status" role="status">{speech.speaking ? 'Speaking…' : 'The word stays hidden until you reveal it.'}</span></>}
      {speech.error && !revealed && <p className="error" role="alert">{speech.error}</p>}
      {!revealed ? <button className="button secondary" onClick={() => { speech.stop(); setRevealed(true) }}>Ready? Reveal for checking</button> : !saved ? <div className="answer-area"><p>Compare the spelling on paper, then mark the answer.</p>{pendingAnswer === null ? <div className="answer-buttons"><button className="button secondary" disabled={busy} onClick={() => void mark(false)}>Not quite yet</button><button className="button primary" disabled={busy} onClick={() => void mark(true)}>✓ Spelled correctly</button></div> : <button className="button primary" disabled={busy} onClick={() => void mark(pendingAnswer)}>{busy ? 'Saving progress…' : 'Retry saving this answer'}</button>}</div> : <div className="answer-area"><p role="status">Saved. <span className={`badge ${saved.category}`}>{categories[saved.category].label}</span> {saved.category === 'minus' ? 'We’ll give this word a little more practice.' : saved.category === 'plus' ? 'A little stronger, one word at a time.' : 'One mistake is just part of learning.'}</p><button className="button primary" onClick={next}>{index + 1 === queue.length ? 'Finish practice' : 'Next word'}<ArrowIcon /></button></div>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    <p className="practice-footer">No timer. No pressure. Just a pencil and a little patience.</p>
  </section>

  return <div className="practice-setup">
    <section className="practice-intro"><p className="eyebrow">A QUIET MOMENT TO GROW</p><h2>Listen.<br />Write.<br /><em>Try again.</em></h2><p>Pick a language and a set of words. Your child listens and writes on paper; you reveal the word and mark the spelling.</p><div className="practice-checklist"><span>01 <strong>A pencil & paper</strong></span><span>02 <strong>Your device’s sound on</strong></span><span>03 <strong>A little encouragement</strong></span></div></section>
    <section className="practice-options" aria-labelledby="practice-options-title"><p className="eyebrow">MAKE IT A SMALL, HAPPY HABIT</p><h2 id="practice-options-title">Today’s little practice.</h2><label htmlFor="practice-language">Which language?</label><select id="practice-language" value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="de">Deutsch</option><option value="en">English</option></select><label htmlFor="practice-category">Which words?</label><select id="practice-category" value={category} onChange={e => setCategory(e.target.value as Category | 'all')}><option value="all">All categories</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categories[key].label} · {categories[key].description}</option>)}</select><div className="available-count"><strong>{candidates.length}</strong><span>{candidates.length === 1 ? 'word is' : 'words are'} ready for a little attention.<small>One shuffled round. Stop whenever you like.</small></span></div>
      {!speech.supported && <p className="error" role="alert">This browser does not support spoken dictation. Use a current Chrome, Edge, or Safari browser.</p>}
      {!candidates.length && <p className="notice">{loading ? 'Syncing your collection…' : 'Add words in this language or choose another category first.'}</p>}
      <button className="button primary wide" onClick={start} disabled={loading || !candidates.length || !speech.supported}>Let’s begin<ArrowIcon /></button><p className="fine-print">Words are spoken by your browser’s speech service. A German or English voice must be installed. Some voices require internet access.</p>
    </section>
  </div>
}
