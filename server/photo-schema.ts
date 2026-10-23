import { z } from 'zod'
import { languageSchema } from './languages.js'

export const recognitionSchema = z.object({
  answers: z.array(z.object({
    number: z.number().int().positive(),
    text: z.string().max(1000).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  }).strict()).max(100),
  warnings: z.array(z.string().max(500)).max(100),
}).strict()

export const photoRoundSchema = z.object({
  id: z.uuid(),
  startedAt: z.string().datetime(),
  writtenAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  nextIndex: z.number().int().min(0),
  words: z.array(z.object({
    id: z.uuid(), text: z.string().min(1).max(160), language: languageSchema, attemptId: z.uuid(),
  }).strict()).min(1).max(100),
  recognition: recognitionSchema.nullable(),
  results: z.array(z.boolean()).nullable(),
}).strict().refine(round =>
  round.nextIndex <= round.words.length &&
  (round.writtenAt !== null) === (round.nextIndex === round.words.length) &&
  (round.results !== null) === (round.reviewedAt !== null) &&
  (!round.results || (round.writtenAt !== null && round.results.length === round.words.length)) &&
  new Set(round.words.map(word => word.id)).size === round.words.length &&
  new Set(round.words.map(word => word.language)).size === 1 &&
  (!round.recognition || (
    round.writtenAt !== null &&
    round.recognition.answers.length === round.words.length &&
    round.recognition.answers.every((answer, index) => answer.number === index + 1)
  )),
)
