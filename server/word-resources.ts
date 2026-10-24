import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { validateWord, type WordResource } from '../shared/model.js'
import { languageSchema } from './languages.js'

const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)
const spelling = z.string().trim().refine(value => validateWord(value) === null)
const translation = z.object({ language: languageSchema, word: spelling }).strict()
const entry = z.object({
  id: identifier,
  word: spelling,
  sentence: z.string().trim().min(1).max(2000),
  translations: z.array(translation).max(26).refine(items => new Set(items.map(item => item.language)).size === items.length),
}).strict()
const section = z.object({
  id: identifier,
  title: z.string().trim().min(1).max(200),
  entries: z.array(entry).min(1).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict()
export const resourceCatalogSchema = z.array(z.object({
  id: identifier,
  title: z.string().trim().min(1).max(200),
  language: languageSchema,
  sections: z.array(section).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict().refine(resource => resource.sections.every(item => item.entries.every(word => word.translations.every(item => item.language !== resource.language))))).max(1000)
  .refine(resources => new Set(resources.map(resource => resource.id)).size === resources.length)

const resourceDirectory = fileURLToPath(new URL('./word-lists/', import.meta.url))
const resourceFiles = readdirSync(resourceDirectory, { withFileTypes: true })
  .filter(file => file.isFile() && file.name.endsWith('.json'))
  .map(file => file.name)
  .sort()

export const wordResources: WordResource[] = resourceCatalogSchema.parse(
  resourceFiles.map(file => JSON.parse(readFileSync(join(resourceDirectory, file), 'utf8'))),
)