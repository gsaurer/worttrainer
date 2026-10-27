import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, X } from 'lucide-react'
import { useI18n } from '../i18n/context'

export function AnswerCamera({ disabled, onCapture, onUpload, onCancel }: { disabled: boolean; onCapture: (photo: File) => void; onUpload: () => void; onCancel: () => void }) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const generation = useRef(0)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [retry, setRetry] = useState(0)
  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function'

  useEffect(() => {
    const request = ++generation.current
    let stream: MediaStream | null = null
    if (supported && !failed) void navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } }).then(result => {
      if (generation.current !== request) { result.getTracks().forEach(track => track.stop()); return }
      stream = result
      if (video.current) video.current.srcObject = result
    }).catch(() => { if (generation.current === request) setFailed(true) })
    return () => { generation.current = request + 1; stream?.getTracks().forEach(track => track.stop()) }
  }, [supported, retry, failed])

  function capture() {
    const preview = video.current
    if (!preview?.videoWidth || !preview.videoHeight || capturing || disabled) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 2048 / Math.max(preview.videoWidth, preview.videoHeight))
    canvas.width = Math.round(preview.videoWidth * scale)
    canvas.height = Math.round(preview.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) { setFailed(true); return }
    const request = generation.current
    try {
      context.drawImage(preview, 0, 0, canvas.width, canvas.height)
      setCapturing(true)
      canvas.toBlob(blob => {
        if (generation.current !== request) return
        setCapturing(false)
        if (blob) onCapture(new File([blob], 'answers.jpg', { type: 'image/jpeg' }))
        else setFailed(true)
      }, 'image/jpeg', 0.9)
    } catch { setCapturing(false); setFailed(true) }
  }

  return <div className="answer-camera">
    {supported && !failed && <><video ref={video} autoPlay playsInline muted aria-label={t('Camera preview')} onLoadedData={() => setReady(true)} />{!ready && <p role="status">{t('Opening camera...')}</p>}</>}
    {failed && <p className="notice" role="status">{t('Camera unavailable. Allow camera access or upload a photo.')}</p>}
    <div className="camera-actions">
      <button className="button primary challenge-icon-button" title={t(failed ? 'Try camera again' : 'Take a photo')} aria-label={t(failed ? 'Try camera again' : 'Take a photo')} disabled={disabled || capturing || supported && !failed && !ready} onClick={() => {
        if (!supported) onUpload()
        else if (failed) { setFailed(false); setReady(false); setRetry(previous => previous + 1) }
        else capture()
      }}><Camera size={22} aria-hidden="true" /></button>
      <button className="button secondary challenge-icon-button" title={t('Upload a photo')} aria-label={t('Upload a photo')} disabled={disabled || capturing} onClick={onUpload}><Upload size={18} aria-hidden="true" /></button>
      <button className="button secondary challenge-icon-button" title={t('Cancel')} aria-label={t('Cancel')} disabled={disabled} onClick={onCancel}><X size={20} aria-hidden="true" /></button>
    </div>
  </div>
}