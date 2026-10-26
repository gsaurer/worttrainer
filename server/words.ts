import { z } from 'zod'
import { validateWord } from '../shared/model.js'
import { languageSchema } from './languages.js'

export const wordInputSchema = z.object({
  text: z.string().refine(value => validateWord(value) === null, 'Enter a word with 1–80 characters and no line breaks or control characters.').transform(value => value.trim()),
  language: languageSchema,
}).strict()