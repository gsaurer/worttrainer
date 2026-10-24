export type ReminderSchedule = { time: string; timeZone: string }

export type DevicePushSubscription = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

export type ReminderSettings = ReminderSchedule & {
  configured: boolean
  publicKey: string | null
  deviceEnabled: boolean
  enabled: boolean
}