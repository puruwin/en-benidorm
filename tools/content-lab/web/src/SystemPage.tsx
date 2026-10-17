import {useEffect, useState} from 'react'
import type {DeploymentStatus} from '../../shared/system-types'
import {api} from './api'
import {message} from './ui'

export function SystemPage() {
  const [status, setStatus] = useState<DeploymentStatus>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const refresh = async () => {
    setLoading(true); setError('')
    try {setStatus(await api.system())} catch (cause) {setError(message(cause))}
    finally {setLoading(false)}
  }
  useEffect(() => {void refresh()}, [])
  return <div className="stack">
    <header className="page-header"><div><span className="eyebrow">INSTALACIÓN PRIVADA</span><h1>Estado de instalación</h1><p>Comprueba el despliegue, los datos y la presencia de configuración.</p></div><button className="secondary" disabled={loading} onClick={() => void refresh()}>{loading ? 'Comprobando…' : 'Volver a comprobar'}</button></header>
    {error && <div role="alert" className="error-banner">{error}</div>}
    {!status && !error && <p role="status">Comprobando instalación…</p>}
    {status && <>
      <section className="panel"><h2>{status.ready ? 'Instalación verificada' : 'Instalación pendiente de completar'}</h2><p>Modo: {status.mode === 'private' ? 'Privado' : 'Desarrollo local'} · Node {status.nodeVersion}</p><p>Frontend: {status.frontend.status === 'built' ? 'Compilado' : status.frontend.status === 'development' ? 'Desarrollo' : 'Pendiente de compilar'}</p>{status.issues.length > 0 && <ul>{status.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</section>
      <section className="panel"><h2>Snapshot de contenido</h2><table><tbody>
        <tr><th>Negocios disponibles</th><td>{status.content.businesses}</td></tr>
        <tr><th>Registros Discovery</th><td>{status.content.discoveredRecords}</td></tr>
        <tr><th>Entradas del manifiesto</th><td>{status.content.manifestEntries ?? 'No disponible'}</td></tr>
        <tr><th>Correspondencia de IDs</th><td>{status.content.matchesManifest ? 'Coinciden' : 'Revisar snapshot'}</td></tr>
        <tr><th>Lectura y escritura</th><td>{status.content.writable ? 'Disponibles' : 'Revisar permisos'}</td></tr>
      </tbody></table></section>
      <section className="panel"><h2>Configuración de integraciones</h2>{status.integrations.map(integration => <div className="fact" key={integration.name}><strong>{integration.name}</strong><div><span>{integration.configured ? 'Variables presentes; conexión sin comprobar' : 'Configuración incompleta'}</span>{integration.missingVariables.length > 0 && <small className="block">Faltan: {integration.missingVariables.join(', ')}</small>}</div></div>)}<p className="footnote">Esta comprobación no llama a OpenAI ni a Sanity, no consume cuota y no muestra valores de las credenciales. Una variable presente no acredita que la clave funcione.</p></section>
      <p className="footnote">Última comprobación: {new Date(status.checkedAt).toLocaleString('es-ES')}. La conservación de estos datos entre releases depende del almacenamiento persistente del proveedor.</p>
    </>}
  </div>
}
