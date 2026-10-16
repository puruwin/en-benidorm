export function Badge({value}: {value: string}) {const normalized = String(value).toLowerCase().replaceAll('_', '-'); return <span className={`badge badge-${normalized}`}>{value}</span>}
export function List({items}: {items?: string[]}) {return <ul>{items?.map(item => <li key={item}>{item}</li>)}</ul>}
export function message(cause: unknown) {return cause instanceof Error ? cause.message : String(cause)}

export function date(value?: string) {return value ? new Date(value).toLocaleString('es-ES', {dateStyle: 'medium', timeStyle: 'short'}) : '—'}
