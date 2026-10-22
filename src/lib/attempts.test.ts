import { expect, it } from 'vitest'
import { createAttemptId } from './attempts'

it('generates distinct valid UUIDv4 retry identifiers without randomUUID', () => {
  const ids = Array.from({ length: 100 }, createAttemptId)
  expect(new Set(ids).size).toBe(100)
  ids.forEach(id => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/))
})
