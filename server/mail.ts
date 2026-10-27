import nodemailer from 'nodemailer'
import { z } from 'zod'
import { parentEmailSchema } from './store.js'
import type { AppOptions } from './app.js'

export function passwordResetMailer(env: NodeJS.ProcessEnv): AppOptions['sendPasswordReset'] {
  if (![env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER, env.SMTP_PASSWORD, env.SMTP_FROM].some(Boolean)) return undefined
  const parsed = z.object({
    host: z.string().trim().min(1), port: z.coerce.number().int().min(1).max(65535),
    secure: z.enum(['true', 'false']).optional(),
    user: z.string().min(1), password: z.string().min(1), from: parentEmailSchema,
  }).safeParse({ host: env.SMTP_HOST, port: env.SMTP_PORT || '587', secure: env.SMTP_SECURE || undefined, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.SMTP_FROM })
  if (!parsed.success) throw new Error('Configure valid SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD and SMTP_FROM settings for password reset email.')
  const config = parsed.data
  const secure = config.secure === 'true' || (config.secure === undefined && config.port === 465)
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure, requireTLS: !secure,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
  })
  return async ({ to, url, language }) => {
    const german = language === 'de'
    await transport.sendMail({
      from: { name: 'Worttrainer', address: config.from }, to,
      subject: german ? 'Worttrainer: Passwort zurücksetzen' : 'Worttrainer: Reset your password',
      text: german
        ? `Du hast einen Link zum Zurücksetzen deines Worttrainer-Passworts angefordert.\n\n${url}\n\nDer Link ist 30 Minuten gültig und kann nur einmal verwendet werden. Dein bisheriges Passwort bleibt gültig, bis du ein neues speicherst. Falls du dies nicht angefordert hast, kannst du diese E-Mail ignorieren.\n`
        : `You requested a link to reset your Worttrainer password.\n\n${url}\n\nThis link expires in 30 minutes and can only be used once. Your current password stays valid until you save a new one. If you did not request this, you can ignore this email.\n`,
    })
  }
}