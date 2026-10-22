export function SpeakerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
    <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" strokeLinecap="round" />
  </svg>
}

export function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M4 12h15m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true">w<span>+</span></span><span>worttrainer<span className="brand-dot">.</span></span></div>
}
