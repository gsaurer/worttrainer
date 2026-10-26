import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FeaturesProvider, noFeatures, useFeature } from './features'

function Probe() { return <p>{useFeature('beta') ? 'beta on' : 'beta off'}</p> }

describe('feature flags in the interface', () => {
  it('is off by default and on only for an enabled flag', () => {
    const { rerender } = render(<Probe />)
    expect(screen.getByText('beta off')).toBeVisible()
    rerender(<FeaturesProvider value={['other']}><Probe /></FeaturesProvider>)
    expect(screen.getByText('beta off')).toBeVisible()
    rerender(<FeaturesProvider value={['beta']}><Probe /></FeaturesProvider>)
    expect(screen.getByText('beta on')).toBeVisible()
    rerender(<FeaturesProvider value={noFeatures}><Probe /></FeaturesProvider>)
    expect(screen.getByText('beta off')).toBeVisible()
  })
})
