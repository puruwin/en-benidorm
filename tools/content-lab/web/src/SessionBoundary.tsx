import {useEffect, useState, type ReactNode} from 'react'
import {api, type Session} from './api'
import {message} from './ui'

export function SessionBoundary({children}: {children: ReactNode}) {
  const [session, setSession] = useState<Session>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    try {setSession(await api.session()); setError('')} catch (cause) {setError(message(cause))}
  }
  useEffect(() => {
    void refresh()
    const expired = () => {setSession({authenticationRequired: true, authenticated: false, actor: null}); setPassword('')}
    addEventListener('content-lab-session-expired', expired)
    return () => removeEventListener('content-lab-session-expired', expired)
  }, [])
  const login = async () => {
    setBusy(true); setError('')
    try {setSession(await api.login(username, password)); setPassword('')}
    catch (cause) {setError(message(cause)); setPassword('')}
    finally {setBusy(false)}
  }
  const logout = async () => {
    if (!dispatchEvent(new Event('business-before-navigate', {cancelable: true}))) return
    setBusy(true)
    try {await api.logout(); setSession({authenticationRequired: true, authenticated: false, actor: null})}
    catch (cause) {setError(message(cause))}
    finally {setBusy(false)}
  }
  if (!session) return <main className="login-page"><section className="panel"><h1>Content Lab</h1>{error ? <><p role="alert">{error}</p><button onClick={() => void refresh()}>Reintentar conexión</button></> : <p role="status">Comprobando acceso…</p>}</section></main>
  if (!session.authenticated) return <main className="login-page"><form className="panel login-card" onSubmit={event => {event.preventDefault(); void login()}}><span className="eyebrow">enBenidorm · acceso privado</span><h1>Content Lab</h1><label className="field">Usuario<input autoComplete="username" required maxLength={100} value={username} onChange={event => setUsername(event.target.value)}/></label><label className="field">Contraseña<input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <p role="alert" className="error-text">{error}</p>}<button disabled={busy}>{busy ? 'Accediendo…' : 'Entrar'}</button></form></main>
  return <>{session.authenticationRequired && <div className="session-bar"><span>Content Lab · sesión privada</span>{error && <span role="alert">{error}</span>}<button className="secondary" disabled={busy} onClick={() => void logout()}>Cerrar sesión</button></div>}{children}</>
}
