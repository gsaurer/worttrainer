import type { AccountDataExport, AuthState, Language, LanguagePreferences, PhotoRound, PhotoStatus, Word } from '../../shared/model'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function request<T>(path: string, method = 'GET', body?: unknown, protectedRequest = false): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return readResponse<T>(response, protectedRequest)
}

async function readResponse<T>(response: Response, protectedRequest: boolean): Promise<T> {
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
  login: (email: string, password: string) => request<AuthState>('/login', 'POST', { email, password }),
  signup: (email: string, password: string) => request<AuthState>('/signup', 'POST', { email, password }),
  logout: () => request<void>('/logout', 'POST', {}),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/password', 'POST', { currentPassword, newPassword }),
  words: () => request<Word[]>('/words', 'GET', undefined, true),
  languagePreferences: () => request<LanguagePreferences>('/languages', 'GET', undefined, true),
  saveLanguagePreferences: (preferences: LanguagePreferences) => request<LanguagePreferences>('/languages', 'POST', preferences, true),
  exportData: () => request<AccountDataExport>('/export', 'GET', undefined, true),
  addWord: (text: string, language: Language) => request<Word>('/words', 'POST', { text, language }, true),
  deleteWord: (id: string) => request<void>(`/words/${encodeURIComponent(id)}`, 'DELETE', {}, true),
  mark: (wordId: string, correct: boolean, attemptId: string) => request<Word>('/practice', 'POST', { wordId, correct, attemptId }, true),
  photoStatus: () => request<PhotoStatus>('/photo-rounds', 'GET', undefined, true),
  createPhotoRound: (wordIds: string[]) => request<PhotoRound>('/photo-rounds', 'POST', { wordIds }, true),
  advancePhotoRound: (id: string, nextIndex: number) => request<PhotoRound>(`/photo-rounds/${encodeURIComponent(id)}/advance`, 'POST', { nextIndex }, true),
  readPhoto: async (id: string, photo: File) => readResponse<PhotoRound>(await fetch(`/api/photo-rounds/${encodeURIComponent(id)}/photo`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': photo.type }, body: photo,
  }), true),
  reviewPhotoRound: (id: string, results: boolean[]) => request<PhotoRound>(`/photo-rounds/${encodeURIComponent(id)}/review`, 'POST', { results }, true),
  deletePhotoRound: (id: string) => request<void>(`/photo-rounds/${encodeURIComponent(id)}`, 'DELETE', {}, true),
}
