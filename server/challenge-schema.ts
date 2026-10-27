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

export const challengeSchema = z.object({
  check: z.object({
    method: z.enum(['manual', 'photo']),
    spellings: z.array(z.string().trim().max(1000).nullable()).min(1).max(100),
    evaluatedAt: z.string().datetime(),
  }).strict().nullable(),
  photo: z.object({
    dataUrl: z.string().max(5600000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
    uploadedAt: z.string().datetime(),
    evaluatedAt: z.string().datetime(),
  }).strict().nullable(),
  id: z.uuid(),
  deletedAt: z.string().datetime().optional(),
  startedAt: z.string().datetime(),
  writtenAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  nextIndex: z.number().int().min(0),
  words: z.array(z.object({
    id: z.uuid(), text: z.string().min(1).max(160), language: languageSchema, attemptId: z.uuid(),
  }).strict()).min(1).max(100),
  recognition: recognitionSchema.nullable(),
  results: z.array(z.boolean()).nullable(),
  telemetry: z.array(z.object({
    fromIndex: z.number().int().min(0).max(99),
    toIndex: z.number().int().min(0).max(100),
    recordedAt: z.string().datetime(),
    elapsedMs: z.number().int().min(0).max(604800000),
    intervalSeconds: z.number().int().min(1).max(120),
    automatic: z.boolean(),
    action: z.enum(['next', 'previous', 'stop', 'play', 'listen']),
  }).strict()).max(10000),
}).strict().refine(challenge =>
  challenge.nextIndex <= challenge.words.length &&
  (challenge.writtenAt !== null) === (challenge.nextIndex === challenge.words.length) &&
  (challenge.results !== null) === (challenge.reviewedAt !== null) &&
  (challenge.check !== null) === (challenge.reviewedAt !== null) &&
  (challenge.recognition !== null) === (challenge.photo !== null) &&
  (!challenge.results || (challenge.writtenAt !== null && challenge.results.length === challenge.words.length)) &&
  (!challenge.check || (challenge.reviewedAt === challenge.check.evaluatedAt && challenge.check.spellings.length === challenge.words.length && (challenge.check.method !== 'photo' || challenge.recognition !== null))) &&
  (!challenge.photo || (challenge.writtenAt !== null && challenge.recognition !== null)) &&
  new Set(challenge.words.map(word => word.id)).size === challenge.words.length &&
  new Set(challenge.words.map(word => word.language)).size === 1 &&
  (!challenge.recognition || (
    challenge.writtenAt !== null &&
    challenge.recognition.answers.length === challenge.words.length &&
    challenge.recognition.answers.every((answer, index) => answer.number === index + 1)
  )),
)
