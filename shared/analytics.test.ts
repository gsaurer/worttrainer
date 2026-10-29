import { expect, it } from 'vitest'
import { umamiConfiguration } from './analytics'

const websiteId = 'c3fea621-d611-41f0-98a7-a648659b4cc7'

it('disables analytics by default and for empty settings', () => {
  expect(umamiConfiguration({})).toBeUndefined()
  expect(umamiConfiguration({ UMAMI_SCRIPT_URL: ' ', UMAMI_WEBSITE_ID: '' })).toBeUndefined()
})

it('accepts an explicitly configured tracker without deployment-specific defaults', () => {
  expect(umamiConfiguration({ UMAMI_SCRIPT_URL: ' https://stats.example.com/custom-script.js ', UMAMI_WEBSITE_ID: websiteId })).toEqual({ scriptUrl: 'https://stats.example.com/custom-script.js', websiteId })
})

it('rejects partial, malformed and unsafe tracker settings', () => {
  for (const settings of [
    { UMAMI_SCRIPT_URL: 'https://stats.example.com/script.js' },
    { UMAMI_WEBSITE_ID: websiteId },
    { UMAMI_SCRIPT_URL: 'https://stats.example.com/script.js', UMAMI_WEBSITE_ID: 'not-a-uuid' },
    ...['http://stats.example.com/script.js', 'javascript:alert(1)', 'https://user:password@stats.example.com/script.js', 'https://stats.example.com/script.js?secret=value', 'https://stats.example.com/script.js#fragment'].map(UMAMI_SCRIPT_URL => ({ UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID: websiteId })),
  ]) expect(() => umamiConfiguration(settings)).toThrow('Configure both UMAMI_SCRIPT_URL')
})