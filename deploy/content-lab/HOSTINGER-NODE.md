# Content Lab en hosting Node.js: lab.enbenidorm.es

Este es el destino elegido para Content Lab: hosting Node.js gestionado, con origen
`https://lab.enbenidorm.es`. No requiere Docker ni Caddy. El proveedor termina HTTPS
y asigna el puerto interno. La web pública enBenidorm conserva su despliegue separado.

## Condición previa: almacenamiento realmente persistente

Confirma en el plan o con soporte de Hostinger una ruta privada, escribible por el
proceso Node, que **sobreviva a redeploys y esté fuera del directorio del release**.
No se ha verificado esa capacidad en la cuenta del usuario: este repositorio no
dispone de acceso a su panel o servidor.

Configura esa ruta como `CONTENT_LAB_CONTENT_PATH`. No uses `/tmp`, `node_modules`,
`tools/content-lab/web/dist` ni el `content/` interno del checkout como almacenamiento
persistente. La entrada gestionada rechaza datos dentro del release, pero una ruta
externa por sí sola no prueba la política de conservación del proveedor.

Si el plan sólo ofrece un filesystem efímero o sustituye también esa ruta al desplegar,
no es suficiente para la arquitectura actual. Haría falta almacenamiento externo
compatible o un VPS; cambiar las variables no soluciona la pérdida de archivos.
Tampoco debe ejecutar réplicas/escritores simultáneos sobre este contenido. Se necesita
un único proceso que permita `child_process` y trabajos más largos que la petición HTTP,
y un proxy que soporte SSE.

## Configuración de la aplicación

Los nombres de los campos pueden variar por panel; los valores que necesita la
aplicación son los siguientes. Si el plan no permite un backend Node con archivo de
entrada o comando de arranque propio, confirmar esa limitación antes de desplegar.

| Ajuste | Valor |
|---|---|
| Tipo | Backend Node.js personalizado; no un despliegue estático Astro |
| Repositorio | `puruwin/en-benidorm` |
| Directorio del proyecto | Raíz del repositorio |
| Rama | `work`, o la rama que integre estos cambios |
| Node | 24.x |
| Build | `npm ci --include=dev && npm run content-lab:build` |
| Entrada Node | `content-lab.server.mjs` |
| Si admite comando de arranque | `npm run content-lab:hostinger` |
| Dominio | `lab.enbenidorm.es` con HTTPS |
| Puerto | El `PORT` que inyecte el proveedor |

La aplicación necesita conservar el código backend (`scripts/`, `tools/`, package.json)
y las dependencias durante la ejecución. No publicar únicamente
`tools/content-lab/web/dist`: esa carpeta es el frontend que sirve el proceso Node.
No configurar el build público `npm run build` como build de Content Lab. `tsx` se usa
en runtime y requiere instalar devDependencies con `--include=dev`.

## Variables privadas

Configura en el proceso Node las variables del ejemplo
[`hostinger.env.example`](hostinger.env.example). Las cuatro de despliegue son:

- `CONTENT_LAB_ORIGIN=https://lab.enbenidorm.es`.
- `CONTENT_LAB_AUTH_USER`: usuario de acceso a Content Lab.
- `CONTENT_LAB_PASSWORD_HASH`: salida de `npm run content-lab:password`.
- `CONTENT_LAB_CONTENT_PATH`: ruta persistente confirmada por el proveedor.

En un campo de variables del panel pega el hash íntegro `scrypt$...$...`, **sin
comillas**. Las comillas del ejemplo para Docker Compose no forman parte del valor.
El arranque configura modo privado y escucha en `0.0.0.0`, respetando `PORT`.
No fijes `CONTENT_LAB_PORT` ni un puerto público 443 dentro de Node.

OpenAI y Sanity son integraciones opcionales hasta que se ejecuten operaciones que
las necesiten. Configura sus variables server-side en esa misma aplicación Node.
Una clave configurada en otro ordenador o entorno no se transfiere a Hostinger ni
se incorpora a Git. No uses prefijos `VITE_` o `PUBLIC_` para secretos ni los añadas a
los assets del frontend.

El proxy debe preservar `Host: lab.enbenidorm.es`; no se confía en un `X-Forwarded-Host`
arbitrario. Las peticiones JSON de escritura deben llegar con
`Origin: https://lab.enbenidorm.es`. Un error 403 de Host/origen debe resolverse en la
configuración del proxy/dominio, sin desactivar las comprobaciones.

## Restaurar el contenido

Antes de arrancar, restaura un snapshot completo de `content/` en la ruta persistente.
Incluye los registros ignorados por Git, manifest, seed, generated, manual, reports,
verification, enriched y artefactos de Comparison. Clonar el repositorio no restaura
el catálogo de 3.103 negocios.

Si se tiene terminal con Node y ambas rutas accesibles, la utilidad conservadora
copia a un destino vacío y no elimina el origen:

```bash
npm run content-lab:storage -- --source=/ruta/snapshot/content --target=/ruta/persistente/content
```

Sustituye las rutas ilustrativas por las rutas reales. El usuario del proceso Node
necesita permisos de lectura/escritura sobre los directorios y registros existentes.
No se realiza migración automática ni se mezclan snapshots al arrancar.

## Qué hace la entrada gestionada

`node content-lab.server.mjs` prepara un directorio temporal de ejecución con enlaces
al código/dependencias del release y al `content/` externo. Ejecuta el servidor privado
y las pipelines con ese directorio como working directory. No reescribe el checkout,
no copia claves y no sustituye el contenido externo. Al salir, elimina sólo ese
workspace temporal. Después de un cierre abrupto podría quedar un workspace temporal
con enlaces; no contiene la copia canónica de los datos.

Esto permite cambiar el código del release sin mover los datos. El propietario del
hosting debe garantizar que la ruta externa persiste y que sólo hay un escritor.
La lógica de Selection, Comparison, Verification y Opportunity Analysis no cambia.

## Comprobar instalación y redeploy

Con las variables de la aplicación disponibles en una terminal de su misma cuenta:

```bash
npm run content-lab:doctor
```

El diagnóstico termina con código 1 si faltan configuración privada, build o snapshot
coherente. No escribe contenido, no llama a servicios externos y no imprime valores
de credenciales. La ausencia de OpenAI/Sanity se informa por separado y no impide
consultar el catálogo. Variables presentes no equivalen a claves válidas.

Después del arranque, inicia sesión en el subdominio y abre **Estado de instalación**.
Comprueba:

1. Frontend compilado, modo privado y sin problemas de instalación.
2. 3.103 negocios, 3.176 registros Discovery y 3.176 entradas del manifiesto para el
   snapshot P3A.5a actual; IDs coincidentes. Si el catálogo evoluciona, usa sus nuevos
   totales esperados, no una cuota fija en código.
3. Variables de las integraciones presentes, con conexión aún sin comprobar.
4. Una ficha, un guardado manual de prueba y el funcionamiento del stream de logs.

Antes de actualizar con trabajos activos, espera a que terminen. Conserva un backup
coherente del contenido fuera del hosting. Para verificar persistencia real, realiza
un redeploy controlado después del backup y confirma que la nota de prueba sigue
allí. Una prueba local de cambio de release no sustituye esta comprobación del plan.

Un reinicio cierra la sesión y requiere nuevo login; no debe borrar notas, reviews ni
artefactos. Las ejecuciones en memoria no se reanudan automáticamente. No se ha
configurado ni publicado contenido en Sanity por preparar este despliegue.

## Validación de esta preparación

Se han validado 206 pruebas automatizadas, `npm run check` y
`npm run content-lab:build`. En una copia temporal del snapshot se ha probado la
entrada Node real detrás de HTTPS local: puerto asignado mediante `PORT`, login,
diagnóstico protegido, lectura de los 3.103 negocios, guardado externo de una nota,
ejecución de Selection en dry-run y recepción de logs por SSE. Tras reiniciar,
la sesión anterior deja de ser válida y la nota se conserva. Las pruebas también
simulan sustituir un release sin eliminar los datos externos.

Estas comprobaciones son locales. No acreditan el filesystem, proxy ni las
restricciones del plan de Hostinger; el primer despliegue debe validarlos allí.
No se ha ejecutado análisis comercial, generación de contenido ni publicación.
