import { z } from 'zod'
import { validateWord } from '../shared/model.js'
import { languageSchema } from './languages.js'

export const wordInputSchema = z.object({
  text: z.string().refine(value => validateWord(value) === null, 'Enter a word with 1–80 characters and no line breaks or control characters.').transform(value => value.trim()),
  language: languageSchema,
}).strict()

export const mistakeReportSchema = z.object({
  reportId: z.uuid().describe('Fresh UUID for this report. Reuse it with the same words and spellings when retrying.'),
  language: languageSchema.describe('Enabled practice language shared by all words in this report.'),
  words: z.array(z.object({
    correctWord: wordInputSchema.shape.text.describe('Correct word to practice. Matching words are reused; missing words are added.'),
    wrongSpelling: z.string().trim().min(1).max(1000).optional().describe('Optional actual incorrect spelling. Omit if unknown.'),
  }).strict()).min(1).max(100).refine(words => new Set(words.map(word => word.correctWord.toLowerCase())).size === words.length,
    'Include each correct word only once per report.').describe('All confirmed incorrect words from one report, saved together in one history entry.'),
}).strict()