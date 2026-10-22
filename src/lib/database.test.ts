// @vitest-environment node
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
let wordId: string

async function user(id: string) {
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${id}';`)
}

async function mark(correct: boolean, attempt = randomUUID(), id = wordId) {
  const result = await db.query<{ category: string; consecutive_mistakes: number }>(
    'select (public.record_practice($1::uuid, $2::boolean, $3::uuid)).*',
    [id, correct, attempt],
  )
  return result.rows[0]
}

beforeAll(async () => {
  // Only tests provide auth scaffolding; production uses Supabase Auth.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${alice}'), ('${bob}');
  `)
  await db.exec(readFileSync(new URL('../../supabase/migrations/202610220001_initial_words.sql', import.meta.url), 'utf8'))
  await user(alice)
  const result = await db.query<{ id: string }>("insert into public.words (text, language) values ('Schmetterling', 'de') returning id")
  wordId = result.rows[0].id
}, 30_000)

afterAll(async () => { await db.close() })

describe('real PostgreSQL category rules and ownership', () => {
  it('starts in New with no recorded practice attempt', async () => {
    const { rows } = await db.query('select category, consecutive_mistakes from public.words')
    expect(rows).toEqual([{ category: 'new', consecutive_mistakes: 0 }])
    expect((await db.query('select * from public.practice_attempts')).rows).toHaveLength(0)
  })

  it('keeps New on the first mistake, moves to minus on the second, and caps the counter', async () => {
    expect(await mark(false)).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    expect(await mark(false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    expect(await mark(false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
  })

  it('moves any correct answer to plus and resets mistakes', async () => {
    expect(await mark(true)).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
  })

  it('keeps plus after the first mistake, and resets a one-mistake streak on correct', async () => {
    expect(await mark(false)).toMatchObject({ category: 'plus', consecutive_mistakes: 1 })
    expect(await mark(true)).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
    expect(await mark(false)).toMatchObject({ category: 'plus', consecutive_mistakes: 1 })
    expect(await mark(false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
  })

  it('does not apply a retried attempt twice, even after newer answers', async () => {
    const attempt = randomUUID()
    await mark(true)
    await mark(false, attempt)
    expect(await mark(false, attempt)).toMatchObject({ category: 'plus', consecutive_mistakes: 1 })
    await mark(true)
    expect(await mark(false, attempt)).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
    expect((await db.query('select * from public.practice_attempts where id = $1', [attempt])).rows).toHaveLength(1)
    await expect(mark(true, attempt)).rejects.toThrow('already belongs to another answer')
  })

  it('rejects direct progress writes and forged ownership, including insert overrides', async () => {
    await expect(db.exec("update public.words set category = 'plus'")).rejects.toThrow(/permission denied/)
    await expect(db.exec(`insert into public.words (text, language, owner_id) values ('other', 'de', '${bob}')`)).rejects.toThrow(/permission denied/)
    await expect(db.exec("insert into public.words (text, language, category) values ('other', 'de', 'plus')")).rejects.toThrow(/permission denied/)
    await expect(db.exec(`insert into public.practice_attempts (id, owner_id, word_id, correct) values ('${randomUUID()}', '${alice}', '${wordId}', true)`)).rejects.toThrow(/permission denied/)
  })

  it('isolates accounts for reads, marks and deletion', async () => {
    await user(bob)
    expect((await db.query('select * from public.words')).rows).toHaveLength(0)
    expect((await db.query('select * from public.practice_attempts')).rows).toHaveLength(0)
    await expect(mark(true)).rejects.toThrow('Word not found in your collection')
    expect((await db.query('delete from public.words where id = $1 returning id', [wordId])).rows).toHaveLength(0)
    await db.exec("insert into public.words (text, language) values ('Schmetterling', 'de')")
    expect((await db.query('select * from public.words')).rows).toHaveLength(1)
    await user(alice)
  })

  it('validates language, length, whitespace, controls, and same-language duplicates server-side', async () => {
    await expect(db.exec("insert into public.words (text, language) values ('schmetterling', 'de')")).rejects.toThrow(/unique constraint/)
    await expect(db.exec("insert into public.words (text, language) values ('bonjour', 'fr')")).rejects.toThrow(/check constraint/)
    for (const text of ['', ' ', ' leading', 'trailing ', 'a\nb', 'a'.repeat(81)]) {
      await expect(db.query('insert into public.words (text, language) values ($1, $2)', [text, 'en'])).rejects.toThrow(/check constraint/)
    }
    await db.exec("insert into public.words (text, language) values ('Schmetterling', 'en')")
    expect((await db.query('select * from public.words')).rows).toHaveLength(2)
  })

  it('denies anonymous access and practice execution', async () => {
    await db.exec("reset role; set role anon; set request.jwt.claim.sub = '';")
    await expect(db.exec('select * from public.words')).rejects.toThrow(/permission denied/)
    await expect(mark(true)).rejects.toThrow(/permission denied/)
    await user(alice)
  })

  it('deletes attempts together with an owned word', async () => {
    expect((await db.query('select * from public.practice_attempts')).rows.length).toBeGreaterThan(0)
    await db.query('delete from public.words where id = $1', [wordId])
    expect((await db.query('select * from public.practice_attempts')).rows).toHaveLength(0)
    await expect(mark(true)).rejects.toThrow('Word not found in your collection')
  })
})
