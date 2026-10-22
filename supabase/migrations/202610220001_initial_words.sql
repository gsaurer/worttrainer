create table public.words (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (
    char_length(text) between 1 and 80
    and text = btrim(text)
    and text !~ '[[:cntrl:]]'
    and text !~ '^[[:space:]]|[[:space:]]$'
  ),
  language text not null check (language in ('de', 'en')),
  category text not null default 'new' check (category in ('new', 'plus', 'minus')),
  consecutive_mistakes integer not null default 0 check (consecutive_mistakes between 0 and 2),
  created_at timestamptz not null default now(),
  last_practiced_at timestamptz,
  constraint consistent_progress check ((category = 'minus') = (consecutive_mistakes = 2))
);

create unique index words_owner_language_text on public.words (owner_id, language, lower(text));
create index words_owner_created on public.words (owner_id, created_at desc);

create table public.practice_attempts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null references public.words(id) on delete cascade,
  correct boolean not null,
  created_at timestamptz not null default now()
);

create index practice_attempts_owner on public.practice_attempts (owner_id);
create index practice_attempts_word on public.practice_attempts (word_id);

alter table public.words enable row level security;
alter table public.practice_attempts enable row level security;

create policy "Read own words" on public.words for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Add own words" on public.words for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Delete own words" on public.words for delete to authenticated
  using (owner_id = (select auth.uid()));
create policy "Read own attempts" on public.practice_attempts for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.words, public.practice_attempts from anon, authenticated;
grant select, delete on public.words to authenticated;
grant insert (text, language) on public.words to authenticated;
grant select on public.practice_attempts to authenticated;

-- The only progress write path. Locking serializes devices; attempt IDs make retries safe.
create function public.record_practice(p_word_id uuid, p_correct boolean, p_attempt_id uuid)
returns public.words
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_word public.words;
  v_attempt public.practice_attempts;
  v_mistakes integer;
begin
  if v_owner is null then
    raise exception 'Sign in before recording practice.' using errcode = '28000';
  end if;
  if p_word_id is null or p_correct is null or p_attempt_id is null then
    raise exception 'A word, answer, and attempt ID are required.' using errcode = '22004';
  end if;

  select * into v_word from public.words
    where id = p_word_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Word not found in your collection. Sync and try again.' using errcode = 'P0002';
  end if;

  select * into v_attempt from public.practice_attempts
    where id = p_attempt_id and owner_id = v_owner;
  if found then
    if v_attempt.word_id <> p_word_id or v_attempt.correct <> p_correct then
      raise exception 'This attempt ID already belongs to another answer.' using errcode = '22023';
    end if;
    return v_word;
  end if;

  v_mistakes := case when p_correct then 0 else least(v_word.consecutive_mistakes + 1, 2) end;
  insert into public.practice_attempts (id, owner_id, word_id, correct)
    values (p_attempt_id, v_owner, p_word_id, p_correct);
  update public.words
    set category = case when p_correct then 'plus' when v_mistakes = 2 then 'minus' else category end,
        consecutive_mistakes = v_mistakes,
        last_practiced_at = clock_timestamp()
    where id = p_word_id
    returning * into v_word;
  return v_word;
end;
$$;

revoke all on function public.record_practice(uuid, boolean, uuid) from public, anon;
grant execute on function public.record_practice(uuid, boolean, uuid) to authenticated;
