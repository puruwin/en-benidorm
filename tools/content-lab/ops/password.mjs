import {scrypt as callback, randomBytes} from 'node:crypto'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'

let password = ''
if (process.stdin.isTTY) {
  process.stderr.write('Contraseña de Content Lab (mínimo 12 caracteres; entrada oculta): ')
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  try {
    password = await new Promise((resolve, reject) => {
      let value = ''
      const onData = chunk => {
        for (const char of chunk) {
          if (char === '\u0003') {process.stdin.off('data', onData); reject(Error('Cancelado.')); return}
          if (char === '\r' || char === '\n') {process.stdin.off('data', onData); resolve(value); return}
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
          else if (value.length < 1025) value += char
        }
      }
      process.stdin.on('data', onData)
    })
  } finally {process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n')}
} else password = (await readFile('/dev/stdin', 'utf8')).replace(/\r?\n$/, '')
if (password.length < 12 || password.length > 1024) throw Error('La contraseña debe tener entre 12 y 1024 caracteres.')
const salt = randomBytes(16).toString('base64url')
const key = await promisify(callback)(password, salt, 32)
process.stdout.write(`scrypt$${salt}$${key.toString('base64url')}\n`)
