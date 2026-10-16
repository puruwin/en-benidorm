# Content Lab privado en un VPS

Esta configuración mantiene Content Lab en el repositorio de enBenidorm, con un
proceso de producción que sirve frontend compilado y API. No usa Vite en el servidor.
Está pensada para un operador y una instancia; no es una aplicación multiusuario ni
un servicio con varias réplicas. El sitio público puede desplegarse por separado.

## Requisitos

- VPS Linux con Docker Engine y Compose v2.30 o posterior. Como punto de partida,
  2 vCPU y 4 GB de RAM para construir dependencias y ejecutar las pipelines; no es
  una medición de capacidad para generación masiva.
- Subdominio cuyo DNS A (y AAAA, si se utiliza) apunte al VPS.
- Puertos 80 y 443 disponibles para Caddy. Si otro proxy ya los ocupa, integrar su
  configuración en lugar de arrancar un segundo proxy sobre esos puertos.
- Snapshot completo del directorio `content/`, incluido el catálogo y manifest
  ignorados por Git. Clonar el repositorio no restaura esos datos.

No se ha desplegado este proyecto en una cuenta de Hostinger. Los ficheros preparan
un despliegue en VPS; un hosting Node gestionado requiere comprobar almacenamiento
persistente, procesos hijos, timeouts, soporte SSE y las condiciones de su proxy.

## Datos y configuración

Tres piezas independientes:

| Pieza | Ubicación | Actualización |
|---|---|---|
| Código y frontend | Imagen construida desde este repositorio | Rebuild/recreación |
| Catálogo, contenido, notas y revisiones | Bind mount de `/srv/content-lab/content` a `/app/content` | Persisten fuera de la imagen |
| Configuración privada | `deploy/content-lab/app.env`, sólo en el servidor | Se aplica al recrear el proceso |

La imagen excluye `.env`, catálogo, manifiesto, revisiones y credenciales. No
inicializa el volumen con una copia antigua del contenido. El arranque privado
rechaza un directorio no escribible o sin `manifest.json` válido.

## Preparar los datos

Detén cualquier escritor antes de tomar la copia. Copia **todo `content/`**, no sólo
los archivos versionados: incluye seed, generated, manual, discovered, enriched,
verification, manifest, reports y los artefactos de Comparison que existan.

Desde la máquina que conserva esos datos, se puede preparar un snapshot:

```bash
tar -czf /tmp/content-lab-content.tar.gz content
```

Transfiérelo por SSH/SFTP al VPS. Restaura en un directorio nuevo, sin sobrescribir
una instalación existente. Por ejemplo, en una primera instalación:

```bash
set -eu
test ! -e /srv/content-lab/content
sudo mkdir -p /srv/content-lab
sudo tar -xzf /tmp/content-lab-content.tar.gz -C /srv/content-lab
sudo chown -R 1000:1000 /srv/content-lab/content
```

Revisa el listado del archivo antes de extraerlo; este procedimiento supone un
snapshot creado por ti, no un archivo de origen desconocido. No incluyas claves ni
archivos `.env` dentro de `content/`.

Si ambas rutas están disponibles en una máquina con Node, existe una copia
conservadora que rechaza destinos no vacíos, enlaces y locks/temporales:

```bash
npm run content-lab:storage -- --source=/ruta/original/content --target=/srv/content-lab/content
```

No elimina el origen ni mezcla una copia nueva con datos de un servidor en uso.
Si se interrumpe la copia, verifica el destino parcial y utiliza un destino vacío
para repetirla. No borres locks sin comprobar que no hay escritores activos.

## Configurar el acceso y las API keys

Desde la raíz del checkout en el VPS:

```bash
cp deploy/content-lab/.env.example deploy/content-lab/.env
cp deploy/content-lab/app.env.example deploy/content-lab/app.env
chmod 600 deploy/content-lab/.env deploy/content-lab/app.env
```

Edita `.env` con el dominio y la ruta absoluta del contenido. Edita `app.env` con el
mismo origen, por ejemplo `CONTENT_LAB_ORIGIN=https://lab.example.com`, el usuario y
el hash de contraseña. No añadas paths ni barra final al origen.

Genera el hash en tu máquina con Node, introduciendo la contraseña de forma oculta:

```bash
npm run content-lab:password
```

Copia **el hash** al campo `CONTENT_LAB_PASSWORD_HASH` de `app.env`. La contraseña
requiere 12–1024 caracteres. Conserva las comillas simples del ejemplo alrededor del
hash para que Compose no interprete sus `$`. No pases la contraseña como argumento
de consola ni la añadas al código. También es posible ejecutar la utilidad dentro
de una imagen ya construida, con los datos montados y la configuración preparada:

```bash
docker compose --env-file deploy/content-lab/.env -f deploy/content-lab/compose.yaml run --rm --no-deps app npm run content-lab:password
```

El login es independiente de las claves de OpenAI y Sanity. Para consultar datos y
guardar seguimiento no hacen falta estas API keys. Cuando se necesiten, configúralas
sólo en `app.env`:

- `OPENAI_API_KEY`, `OPENAI_CONTENT_MODEL`, `OPENAI_COMPARISON_MODEL`.
- `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_TOKEN`.

Los procesos hijos heredan esas variables. No se pasan al build ni al navegador.
No uses prefijos `VITE_` o `PUBLIC_` para credenciales. Nunca incluyas `app.env` en
Git; los ejemplos vacíos sí se versionan. No ejecutes `docker compose config` sin
`--quiet` en logs compartidos: su salida completa puede expandir las credenciales.

## Construir y arrancar

Con los datos restaurados y el dominio/configuración preparados:

```bash
docker compose --env-file deploy/content-lab/.env -f deploy/content-lab/compose.yaml config --quiet
docker compose --env-file deploy/content-lab/.env -f deploy/content-lab/compose.yaml build app
docker compose --env-file deploy/content-lab/.env -f deploy/content-lab/compose.yaml up -d
```

Caddy gestiona certificados y redirección HTTP → HTTPS. La API no publica un puerto
directo al host; sólo el proxy es accesible desde Internet. Se conserva el Host
original y se desactiva el buffering del stream SSE. El contenedor de la aplicación
usa UID 1000, sin capacidades adicionales.

Abre el subdominio e inicia sesión. Comprueba el total del catálogo, una ficha y los
filtros. La API privada, incluido health, requiere sesión; el healthcheck interno
consulta únicamente el estado público mínimo de `/api/session`.

La interfaz muestra sólo las operaciones implementadas. Desplegarla no añade una
importación/publicación de Sanity ni ejecuta el piloto editorial. Los enlaces al
preview de Astro local se omiten en builds de producción; una integración de preview
remoto debe configurarse como funcionalidad independiente.

## Sesiones y límites

- Cookie aleatoria, HttpOnly, Secure, SameSite=Strict y prefijo `__Host-`.
- Sesión de 12 horas; logout revoca la sesión. Reiniciar exige volver a entrar.
- Acciones de escritura y login exigen JSON y el origen exacto configurado. No hay
  CORS abierto, autenticación por query string ni confianza en cabeceras de identidad
  del cliente.
- Los intentos de login están limitados; al no confiar en IPs reenviadas, los clientes
  detrás del mismo proxy comparten el límite. Es un acceso privado de un operador.
- Sólo una pipeline activa por proceso. No ejecutes varias réplicas ni pipelines CLI
  simultáneas sobre el mismo directorio de datos.
- Historial/logs de ejecución y sesiones están en memoria. Los informes y artefactos
  en `content/` persisten; no existe una cola durable ni reanudación automática.
- Los logs retenidos están acotados y se enmascaran valores de variables sensibles.
  Evita añadir comandos que impriman credenciales; esto no convierte los logs en un
  almacén seguro de secretos.
- SIGTERM cierra los streams y cancela procesos hijos propios antes de terminar.
  Espera a que acaben los trabajos antes de una actualización o backup ordinarios.

## Actualizaciones, backup y recuperación

Antes de actualizar, toma una copia coherente y espera a que no haya ejecuciones
activas. Después reconstruye/recrea `app` con la versión de código revisada. El bind
mount mantiene los datos y `app.env` mantiene las variables del servidor.

Para una copia coherente, detener el servicio impide nuevas escrituras:

```bash
docker compose --env-file deploy/content-lab/.env -f deploy/content-lab/compose.yaml stop app
sudo mkdir -p /srv/content-lab-backups
sudo tar -czf /srv/content-lab-backups/content-before-update.tar.gz -C /srv/content-lab content
docker compose --env-file deploy/content-lab/.env -f deploy/content-lab/compose.yaml start app
```

Usa un nombre nuevo para cada backup y guárdalo también fuera del VPS. Conserva por
separado y de forma segura `app.env` y la configuración de despliegue. Prueba una
restauración en un directorio nuevo; cambia `CONTENT_LAB_CONTENT_PATH`, ajusta el
propietario a UID 1000 y recrea el servicio. No extraigas un backup sobre datos activos.
Los volúmenes de Caddy conservan los certificados; no elimines sus volúmenes en una
actualización normal.

## Alternativa sin Docker

El mismo servidor funciona con Node 24 y un supervisor de un único proceso. Requiere
un checkout con todas las dependencias (`npm ci --include=dev`), `content/` persistente
y escribible y el frontend construido con `npm run content-lab:build`. `tsx` y otras
devDependencies también se usan al ejecutar pipelines; `--omit=dev` no es válido.

Carga las variables desde un archivo privado mediante Node, sin copiarlas al frontend:

```bash
node --env-file=/etc/content-lab/app.env --import tsx tools/content-lab/api/src/production.ts
```

Escucha por defecto en `127.0.0.1:3000`; el proxy HTTPS debe apuntar ahí, preservar Host
y permitir SSE sin buffering y con timeout suficiente. Mantén `content/` en una ruta
persistente fuera de los releases, montada/enlazada en el checkout de ejecución, y
preserva sus datos al sustituir código. El supervisor debe enviar SIGTERM y dar al
proceso al menos 20 segundos. No uses `npm run content-lab` ni `vite preview` como
servidor de producción.

## Validación realizada

Se ha construido y arrancado la imagen; funciona con UID 1000 y no incorpora datos
privados. Sobre una copia temporal del catálogo, Chromium ha comprobado login HTTPS,
cookie segura, rechazo sin sesión, rutas directas, guardado, logout, una Selection
en dry-run con proceso hijo y SSE, y persistencia tras reinicio con nueva sesión.
Las pruebas no usan API keys reales ni publican datos. El certificado del proxy
local de prueba es autofirmado; los certificados públicos de Hostinger/Caddy y su
DNS deben comprobarse después en el servidor de destino.
