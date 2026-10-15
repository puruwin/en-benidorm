import {spawn} from 'node:child_process'

const children = [
  spawn('npm', ['run', 'content-lab:api'], {stdio: 'inherit', detached: process.platform !== 'win32'}),
  spawn('npm', ['run', 'content-lab:web'], {stdio: 'inherit', detached: process.platform !== 'win32'}),
]

console.log('\nenBenidorm Content Lab\n')
console.log('Web: http://127.0.0.1:4173')
console.log('API: http://127.0.0.1:4174\n')

let stopping = false
function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.killed || !child.pid) continue
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch { child.kill(signal) }
  }
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
for (const child of children) child.on('exit', (code) => {
  if (!stopping) {
    if (code && code !== 0) process.exitCode = code
    stop()
  }
})
