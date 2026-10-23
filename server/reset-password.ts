import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { resolve } from 'node:path'
import { FileStore } from './store.js'
import { hashPassword } from './passwords.js'

async function recover() {
  if (!process.stdin.isTTY) throw new Error('Run password recovery in an interactive terminal, with the app stopped.')
  const store = await FileStore.open(resolve(process.env.DATA_FILE ?? 'data/store.json'))
  let muted = false
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding)
      callback()
    },
  })
  const terminal = createInterface({ input: process.stdin, output, terminal: true })
  async function secret(prompt: string) {
    process.stdout.write(prompt)
    muted = true
    try { return await terminal.question('') }
    finally { muted = false; process.stdout.write('\n') }
  }
  console.log('The app MUST be stopped before recovery. Back up its index and account data directory first.')
  try {
    const confirm = await terminal.question('Type RESET to continue: ')
    if (confirm !== 'RESET') throw new Error('Recovery canceled; nothing was changed.')
    const identity = (await terminal.question('Account email (or old username): ')).trim()
    const legacy = store.legacyAccount
    const target = store.findAccount(identity.toLowerCase()) ??
      (legacy && 'username' in legacy.account && legacy.account.username.toLowerCase() === identity.toLowerCase() ? legacy : null)
    if (!target) throw new Error('No account matches that email or old username. Nothing was changed.')
    const password = await secret('New password (12–128 characters): ')
    if (password.length < 12 || password.length > 128) throw new Error('Use a password with 12–128 characters.')
    if (password !== await secret('Confirm new password: ')) throw new Error('Passwords do not match; nothing was changed.')
    await store.recoverPassword(target.id, await hashPassword(password))
    console.log('Password reset. Only this account’s sessions were revoked; all collections and progress were preserved.')
  } finally {
    terminal.close()
  }
}

try { await recover() }
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
