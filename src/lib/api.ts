import type { AuthState, Language, Word } from '../../shared/model'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function request<T>(path: string, method = 'GET', body?: unknown, protectedRequest = false): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.headers.get('content-type')?.includes('application/json') && response.status !== 204) {
    throw new Error('The app backend is not responding correctly. Check that the Worttrainer server is running.')
  }
  if (!response.ok) {
    const error: { error?: string } = await response.json()
    if (response.status === 401 && protectedRequest) window.dispatchEvent(new Event('auth-expired'))
    throw new ApiError(response.status, error.error ?? `Request failed (${response.status}).`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const api = {
  session: () => request<AuthState>('/session'),
  login: (username: string, password: string) => request<AuthState>('/login', 'POST', { username, password }),
  setup: (username: string, password: string, setupToken: string) => request<AuthState>('/setup', 'POST', { username, password, setupToken }),
  logout: () => request<void>('/logout', 'POST', {}),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/password', 'POST', { currentPassword, newPassword }),
  words: () => request<Word[]>('/words', 'GET', undefined, true),
  addWord: (text: string, language: Language) => request<Word>('/words', 'POST', { text, language }, true),
  deleteWord: (id: string) => request<void>(`/words/${encodeURIComponent(id)}`, 'DELETE', {}, true),
  mark: (wordId: string, correct: boolean, attemptId: string) => request<Word>('/practice', 'POST', { wordId, correct, attemptId }, true),
}
