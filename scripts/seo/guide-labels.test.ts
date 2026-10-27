import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import test from 'node:test'
import {hasGuideFactLabel} from '../../src/lib/guide-presentation'

// Sin etiqueta, la guía pintaría el id interno del hecho (`zbe.taxis`) como rótulo de la fila.
test('cada hecho citado por una guía con ruta tiene etiqueta', () => {
  const directory = 'content/generated/articles'
  const missing = readdirSync(directory).filter((file) => file.endsWith('.json')).flatMap((file) => {
    const article = JSON.parse(readFileSync(`${directory}/${file}`, 'utf8')) as {section?: string; practicalFacts?: Array<{factId: string}>}
    if (article.section !== 'informationPractical' && article.section !== 'thingsToDo') return []
    return (article.practicalFacts ?? []).filter((fact) => !hasGuideFactLabel(fact.factId)).map((fact) => `${file}: ${fact.factId}`)
  })
  assert.deepEqual(missing, [])
})
