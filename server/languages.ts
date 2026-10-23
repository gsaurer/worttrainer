import { z } from 'zod'
import { languageCodes } from '../shared/languages.js'

export const languageSchema = z.enum(languageCodes, { error: 'Choose a supported language.' })
export const languagePreferencesSchema = z.object({
  enabled: z.array(languageSchema).min(1, 'Keep at least one language enabled.').max(languageCodes.length)
    .refine(values => new Set(values).size === values.length, 'Choose each language only once.'),
  defaultLanguage: languageSchema,
}).strict().refine(value => value.enabled.includes(value.defaultLanguage), 'The default language must be enabled.')
