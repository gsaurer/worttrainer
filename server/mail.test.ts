// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import nodemailer from 'nodemailer'
import { passwordResetMailer } from './mail.js'

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({ accepted: ['parent@example.test'] }))
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }))
const config = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'mailer', SMTP_PASSWORD: 'test-only-secret', SMTP_FROM: 'words@example.test' }
beforeEach(() => { vi.clearAllMocks() })

describe('password reset email', () => {
  it('is disabled without configuration and rejects incomplete or invalid settings', () => {
    expect(passwordResetMailer({})).toBeUndefined()
    for (const settings of [{ SMTP_HOST: 'smtp.example.test' }, { ...config, SMTP_PORT: 'wrong' }, { ...config, SMTP_FROM: 'invalid' }, { ...config, SMTP_SECURE: 'yes' }]) {
      expect(() => passwordResetMailer(settings)).toThrow('Configure valid SMTP_')
    }
    expect(nodemailer.createTransport).not.toHaveBeenCalled()
  })

  it('requires STARTTLS or implicit TLS without allowing remote attachments', () => {
    passwordResetMailer(config)
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true, disableFileAccess: true, disableUrlAccess: true }))
    passwordResetMailer({ ...config, SMTP_PORT: '465' })
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 465, secure: true }))
  })

  it.each(['en', 'de'] as const)('sends a private %s reset link with expiry and no login password', async language => {
    const send = passwordResetMailer(config)
    const url = 'https://words.example.test/#reset=test-only-reset-token'
    await send!({ to: 'parent@example.test', url, language })
    expect(sendMail).toHaveBeenCalledOnce()
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'parent@example.test', from: { name: 'Worttrainer', address: 'words@example.test' }, text: expect.stringContaining(url), subject: expect.stringContaining(language === 'de' ? 'Passwort' : 'password') }))
    expect(sendMail.mock.calls[0][0].text).toContain('30')
    expect(sendMail.mock.calls[0][0].text).not.toContain(config.SMTP_PASSWORD)
  })
})