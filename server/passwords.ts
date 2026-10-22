import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return { salt, passwordHash: (await derive(password, salt)).toString('hex') }
}

export async function verifyPassword(password: string, account: { salt: string; passwordHash: string }) {
  const key = await derive(password, account.salt)
  return timingSafeEqual(key, Buffer.from(account.passwordHash, 'hex'))
}
