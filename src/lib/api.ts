import type { AccountDataExport, AuthState, Language, LanguagePreferences, NavigationTiming, Challenge, ChallengeStatus, ChallengeCheckInput, WebsiteLanguage, Word } from '../../shared/model'
import type { DocumentCheck, PracticeWordList, ResourceImport, WordResource } from '../../shared/model'
import type { DevicePushSubscription, ReminderSchedule, ReminderSettings } from '../../shared/reminders'

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
  signup: (email: string, password: string, websiteLanguage: WebsiteLanguage = 'en') => request<AuthState>('/signup', 'POST', { email, password, websiteLanguage }),
  saveWebsiteLanguage: (websiteLanguage: WebsiteLanguage) => request<{ websiteLanguage: WebsiteLanguage }>('/website-language', 'POST', { websiteLanguage }, true),
  logout: () => request<void>('/logout', 'POST', {}),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/password', 'POST', { currentPassword, newPassword }),
  words: () => request<Word[]>('/words', 'GET', undefined, true),
  addedWordLists: () => request<PracticeWordList[]>('/word-lists', 'GET', undefined, true),
  languagePreferences: () => request<LanguagePreferences>('/languages', 'GET', undefined, true),
  reminderSettings: (device?: string) => request<ReminderSettings>(`/reminders${device ? `?device=${encodeURIComponent(device)}` : ''}`, 'GET', undefined, true),
  saveReminder: (schedule: ReminderSchedule & { subscription: DevicePushSubscription }) => request<ReminderSettings>('/reminders', 'POST', schedule, true),
  removeReminder: (endpoint: string) => request<void>('/reminders', 'DELETE', { endpoint }, true),
  saveLanguagePreferences: (preferences: LanguagePreferences) => request<LanguagePreferences>('/languages', 'POST', preferences, true),
  exportData: () => request<AccountDataExport>('/export', 'GET', undefined, true),
  addWord: (text: string, language: Language) => request<Word>('/words', 'POST', { text, language }, true),
  wordResources: () => request<WordResource[]>('/word-resources', 'GET', undefined, true),
  importWordResource: (resourceId: string, sectionIds: string[], enableLanguage: boolean) => request<ResourceImport>('/word-resources/import', 'POST', { resourceId, sectionIds, enableLanguage }, true),
  deleteWord: (id: string) => request<void>(`/words/${encodeURIComponent(id)}`, 'DELETE', {}, true),
  mark: (wordId: string, correct: boolean, attemptId: string) => request<Word>('/practice', 'POST', { wordId, correct, attemptId }, true),
  challengeStatus: () => request<ChallengeStatus>('/challenges', 'GET', undefined, true),
  createChallenge: (wordIds: string[]) => request<Challenge>('/challenges', 'POST', { wordIds }, true),
  advanceChallenge: (id: string, nextIndex: number, timing: NavigationTiming) => request<Challenge>(`/challenges/${encodeURIComponent(id)}/advance`, 'POST', { nextIndex, ...timing }, true),
  readPhoto: async (id: string, photo: File) => readResponse<Challenge>(await fetch(`/api/challenges/${encodeURIComponent(id)}/photo`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': photo.type }, body: photo,
  }), true),
  checkDocument: async (language: DocumentCheck['language'], photo: File) => readResponse<DocumentCheck>(await fetch(`/api/documents/photo?language=${language}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': photo.type }, body: photo,
  }), true),
  addDocumentWords: (language: DocumentCheck['language'], words: string[]) => request<ResourceImport>('/documents/words', 'POST', { language, words }, true),
  reviewChallenge: (id: string, results: boolean[], check: ChallengeCheckInput) => request<Challenge>(`/challenges/${encodeURIComponent(id)}/review`, 'POST', { results, check }, true),
  deleteChallenge: (id: string) => request<void>(`/challenges/${encodeURIComponent(id)}`, 'DELETE', {}, true),
}
