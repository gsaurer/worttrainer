import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { createHash } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/server'
import { hostHeaderValidation, NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { z } from 'zod'
import { HttpError } from './errors.js'
import { languageSchema } from './languages.js'
import type { FileStore } from './store.js'
import { mistakeReportSchema, wordInputSchema } from './words.js'
import type { OAuthService } from './oauth.js'

export const mcpTokenPrefix = 'wtr_mcp_'
export const mcpTokenSchema = z.string().regex(/^wtr_mcp_[A-Za-z0-9_-]{43}$/, 'Enter a valid MCP access token.')

const wordSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  language: languageSchema,
  category: z.enum(['new', 'plus', 'minus']),
  consecutive_mistakes: z.number().int().nonnegative(),
  created_at: z.string(),
  last_practiced_at: z.string().nullable(),
})

function createWordServer(store: FileStore, accountId: string, scopes: string[], origin: string) {
  const server = new McpServer({ name: 'worttrainer-mcp-server', version: '0.1.0' })
  const scopeError = (scope: string) => scopes.includes(scope) ? null : {
    isError: true,
    content: [{ type: 'text' as const, text: 'This connection does not have the required permission. Connect again to approve it.' }],
    _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", error="insufficient_scope", error_description="Approve the required Worttrainer permission", scope="${scope}"`] },
  }
  server.registerTool('worttrainer_get_words', {
    title: 'Get Worttrainer words',
    description: 'List words in the authenticated account only, including their current progress. Filter by language, category or a case-insensitive text search. Use offset and limit for pagination. Also returns enabled languages for adding words. This does not change progress.',
    inputSchema: z.object({
      language: languageSchema.optional().describe('Optional practice-language code, for example en or de.'),
      category: z.enum(['new', 'plus', 'minus']).optional().describe('Optional progress category: new means Default.'),
      query: z.string().trim().max(80).optional().describe('Optional case-insensitive substring of the word.'),
      offset: z.number().int().min(0).max(1_000_000).default(0).describe('Number of matching words to skip.'),
      limit: z.number().int().min(1).max(100).default(50).describe('Maximum words returned, from 1 to 100.'),
    }).strict(),
    outputSchema: z.object({
      words: z.array(wordSchema),
      total: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      hasMore: z.boolean(),
      nextOffset: z.number().int().nonnegative().nullable(),
      enabledLanguages: z.array(languageSchema),
      defaultLanguage: languageSchema,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['words:read'] }] },
  }, async ({ language, category, query, offset, limit }) => {
    const denied = scopeError('words:read')
    if (denied) return denied
    const matching = store.words(accountId).filter(word =>
      (!language || word.language === language) && (!category || word.category === category) &&
      (!query || word.text.toLowerCase().includes(query.toLowerCase())))
    const words = matching.slice(offset, offset + limit)
    const hasMore = offset + words.length < matching.length
    const preferences = store.languagePreferences(accountId)
    const output = {
      words, total: matching.length, offset, limit, hasMore,
      nextOffset: hasMore ? offset + words.length : null,
      enabledLanguages: preferences.enabled, defaultLanguage: preferences.defaultLanguage,
    }
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
  })
  server.registerTool('worttrainer_add_word', {
    title: 'Add a Worttrainer word',
    description: 'Add one word to the authenticated account in an enabled practice language. Requires text (1–80 characters, no line breaks) and a language code. Rejects case-insensitive duplicates in that language. New words start in Default; existing words, attempts and progress are never changed.',
    inputSchema: wordInputSchema,
    outputSchema: z.object({ word: wordSchema }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['words:write'] }] },
  }, async ({ text, language }) => {
    const denied = scopeError('words:write')
    if (denied) return denied
    try {
      const output = { word: await store.addWord(accountId, text, language) }
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof HttpError ? error.message : 'The word could not be saved. Please retry.' }] }
    }
  })
  server.registerTool('worttrainer_move_word', {
    title: 'Move a Worttrainer word',
    description: 'Move an existing word in the authenticated account to new (Default), plus or minus. This explicitly overrides its category without recording a practice attempt or changing its last-practiced time. Changing category resets the consecutive-mistake counter; previous attempts and correct-result history are preserved. Moving to the current category does nothing. Use worttrainer_get_words to find the word ID.',
    inputSchema: z.object({
      wordId: z.uuid().describe('ID of an existing word in this account.'),
      category: z.enum(['new', 'plus', 'minus']).describe('Target category: new means Default, plus means learned, minus means needs practice.'),
    }).strict(),
    outputSchema: z.object({ word: wordSchema }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['words:write'] }] },
  }, async ({ wordId, category }) => {
    const denied = scopeError('words:write')
    if (denied) return denied
    try {
      const output = { word: await store.moveWord(accountId, wordId, category) }
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof HttpError ? error.message : 'The word could not be moved. Please retry.' }] }
    }
  })
  server.registerTool('worttrainer_record_mistake', {
    title: 'Record a Worttrainer spelling mistake',
    description: 'Record one confirmed incorrect practice result for an existing word in the authenticated account. Optionally include spelling with exactly what was written incorrectly; the correct word text is never replaced. Applies normal progress rules: plus returns to Default on a mistake and two consecutive mistakes lead to minus. Requires a fresh UUID attemptId for each real attempt; reuse that same ID and spelling on retries to avoid counting twice. Do not use for unconfirmed recognition or a category-only move. Use worttrainer_get_words to find the word ID. For a grouped report using correct word text, use worttrainer_record_mistakes instead.',
    inputSchema: z.object({
      wordId: z.uuid().describe('ID of the existing correct word in this account.'),
      attemptId: z.uuid().describe('Unique UUID for this confirmed attempt. Reuse unchanged when retrying this same attempt.'),
      spelling: z.string().trim().min(1).max(1000).optional().describe('Optional actual incorrect spelling, not a correction or explanation. Omit if unknown.'),
    }).strict(),
    outputSchema: z.object({ word: wordSchema, attemptId: z.uuid() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['words:write'] }] },
  }, async ({ wordId, attemptId, spelling }) => {
    const denied = scopeError('words:write')
    if (denied) return denied
    try {
      const output = { word: await store.mark(accountId, wordId, false, attemptId, spelling), attemptId }
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof HttpError ? error.message : 'The mistake could not be saved. Retry with the same attempt ID and spelling.' }] }
    }
  })
  server.registerTool('worttrainer_record_mistakes', {
    title: 'Record a Worttrainer mistake report',
    description: 'Save all confirmed spelling mistakes from one report as a single completed challenge in the authenticated account history. Supply the correctWord and optionally wrongSpelling for each word, and one enabled language for the whole report. Existing words are matched case-insensitively in that language; missing correct words are added. Every word receives one incorrect practice result under normal rating rules: plus returns to Default, two consecutive mistakes lead to minus. Include each correct word once. Use a fresh UUID reportId for a new report and reuse the same ID and payload on retries to avoid counting twice. Do not use for unconfirmed recognition or invented mistakes. Returns the report ID and updated word ratings.',
    inputSchema: mistakeReportSchema,
    outputSchema: z.object({ reportId: z.uuid(), words: z.array(wordSchema) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['words:write'] }] },
  }, async input => {
    const denied = scopeError('words:write')
    if (denied) return denied
    try {
      const output = await store.recordMistakes(accountId, input)
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof HttpError ? error.message : 'The report could not be saved. Retry with the same report ID, words and spellings.' }] }
    }
  })
  return server
}

export function mcpHandler(store: FileStore, origin: string, oauth: OAuthService) {
  const router = express.Router()
  const validateHost = hostHeaderValidation([new URL(origin).hostname])
  const accountFromRequest = (req: express.Request) => {
    const token = req.headers.authorization?.match(/^Bearer (wtr_(?:mcp|access)_[A-Za-z0-9_-]{43})$/i)?.[1]
    if (!token) return null
    if (token.startsWith('wtr_access_')) return oauth.access(token)
    const accountId = store.sessionAccount(createHash('sha256').update(token).digest('hex'))
    return accountId ? { accountId, scopes: ['words:read', 'words:write'] } : null
  }
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!validateHost(req, res)) return
    if (req.headers.origin && req.headers.origin !== origin) {
      res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Request origin is not allowed.' }, id: null })
      return
    }
    if (!accountFromRequest(req)) {
      res.setHeader('WWW-Authenticate', `Bearer realm="worttrainer", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`)
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Connect your Worttrainer account using OAuth, or use an unexpired MCP access token.' }, id: null })
      return
    }
    next()
  })
  router.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))
  router.use(express.json({ limit: '16kb', strict: true, inflate: false }))
  router.use(async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST for stateless MCP requests.' }, id: null })
      return
    }
    const account = accountFromRequest(req)
    if (!account) throw new HttpError(401, 'The connection expired or was revoked. Connect your account again.')
    const server = createWordServer(store, account.accountId, account.scopes, origin)
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.once('close', () => { void server.close().catch(() => { console.error('MCP connection cleanup failed.') }) })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })
  return router
}