# Despliegue en la VPS (Hostinger)

Sustituye al auto-despliegue del «website» de Hostinger. La web pública y Content Lab
viven en la misma VPS, detrás de Caddy.

```text
PR ──► GitHub Actions: check · test · build demo · seo:audit       (no despliega)
merge a main ──► check · test · build Sanity · seo:audit
                 ├─► web: tar de dist/ por SSH → release nueva → enlace current   (siempre)
                 └─► Content Lab: compara la release activa con main; si cambian tools/,
                     scripts/, src/lib/, src/types/, content/, package*.json, tsconfig.json
                     o content-lab.server.mjs → git archive por SSH → npm ci + build
                     → backup → reinicio
publicación en Sanity ──► webhook → repository_dispatch → web (y Content Lab si quedó pendiente)
```

| Ruta en la VPS | Qué es | Propietario |
|---|---|---|
| `/srv/enbenidorm/site/releases/<fecha>-<sha>` | `dist/` de cada despliegue (se guardan 5) | deploy |
| `/srv/enbenidorm/site/current` | enlace a la release servida por Caddy | deploy |
| `/srv/content-lab/app/releases/<fecha>-<sha>` | código + `node_modules` (se guardan 3) | deploy |
| `/srv/content-lab/app/current` | enlace a la release que arranca systemd | deploy |
| `/srv/content-lab/content` | catálogo, manifest, revisiones: **datos persistentes** | contentlab |
| `/srv/content-lab/backups` | backup de `content/` antes de cada despliegue (se guardan 10) | root |
| `/etc/content-lab/app.env` | credenciales de Content Lab | root:contentlab 640 |

Garantías:

- Si `check`, `test`, `build` o `seo:audit` (contra `scripts/seo/baseline.json`) fallan, no se despliega nada.
- Las releases se activan cambiando un enlace simbólico: no hay estado intermedio servido.
- Solo se despliega desde `main`, aunque lances *Run workflow* sobre otra rama.
- Content Lab no se reinicia si tiene una pipeline en curso: el job avisa (warning) y no toca nada.
  Como cada despliegue compara con la release activa, el siguiente lo recoge. Para forzarlo antes:
  Actions → *Validar y desplegar* → *Run workflow* → `lab`.
- Antes de cambiar Content Lab se detiene el servicio y se hace backup de `content/`.
  Si la release nueva no responde en 60 s, vuelve sola a la anterior y la nueva se aparta como
  `.failed-*` para que `rollback-lab` no la elija.
- La web **no** se revierte sola si falla la comprobación HTTPS posterior: usa `rollback-site`.
- La clave SSH de Actions solo puede ejecutar `/usr/local/bin/enbenidorm-deploy`: sin shell, sin reenvíos.
- Un corte de la sesión SSH durante la activación no deja Content Lab a medias: el script ignora
  la desconexión y termina. El registro queda en `/srv/enbenidorm/deploy.log`.

Límites conocidos:

- Entre la comprobación de pipelines activas y la parada hay unos segundos. Si lanzas una pipeline
  justo en ese momento, el reinicio la cancela. No lances pipelines mientras se despliega.
- Los backups están en la misma VPS. Necesitas además una copia fuera (snapshot de Hostinger o
  descarga periódica de `/srv/content-lab/backups`).
- `npm ci` en la VPS necesita salida a registry.npmjs.org.
- Detrás de Caddy, Content Lab ve todas las peticiones desde 127.0.0.1: el límite de intentos de
  login es global. Corregirlo requiere `trustProxy` en Fastify (issue aparte).

## Instalación (una vez)

Requisitos: Ubuntu 22.04+/Debian 12 (cgroup v2), Caddy ya instalado como servicio, 2 vCPU y 4 GB de RAM.

### 1. Node 24 y usuarios

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs curl
node --version   # v24.x

sudo useradd --system --create-home --shell /bin/bash deploy
sudo useradd --system --no-create-home --shell /usr/sbin/nologin contentlab
# useradd --system bloquea la contraseña; con UsePAM no, sshd rechazaría la clave:
sudo sshd -T | grep -i usepam   # si dice "no": sudo usermod -p '*' deploy
```

### 2. Directorios

```bash
sudo install -d -o deploy -g deploy -m 755 /srv/enbenidorm /srv/enbenidorm/site /srv/enbenidorm/site/releases
sudo install -o deploy -g deploy -m 644 /dev/null /srv/enbenidorm/deploy.log
sudo install -d -o root -g root -m 755 /srv/content-lab
sudo install -d -o deploy -g deploy -m 755 /srv/content-lab/app /srv/content-lab/app/releases
sudo install -d -o root -g root -m 700 /srv/content-lab/backups
```

`deploy` solo escribe en `/srv/content-lab/app` (releases y enlace `current`, que crea el primer
despliegue); `content` y `backups` quedan fuera de su alcance.

### 3. Datos de Content Lab

Restaura el snapshot completo de `content/` (incluye lo ignorado por Git: manifest, discovered,
enriched, reports…), como indica `deploy/content-lab/README.md` → *Preparar los datos*:

```bash
test ! -e /srv/content-lab/content
sudo tar -xzf /tmp/content-lab-content.tar.gz -C /srv/content-lab
sudo chown -R contentlab:contentlab /srv/content-lab/content
sudo chmod 750 /srv/content-lab/content
# Un lock de sincronización copiado en el snapshot impediría arrancar:
test ! -e /srv/content-lab/content/.release-artifacts/sync.lock
```

Si Content Lab corre hoy en el hosting Node gestionado, detenlo antes de sacar el snapshot y no lo
vuelvas a arrancar allí: dos copias activas divergen.

### 4. Configuración privada

```bash
sudo install -d -o root -g contentlab -m 750 /etc/content-lab
sudo install -o root -g contentlab -m 640 /dev/null /etc/content-lab/app.env
sudo nano /etc/content-lab/app.env
```

Contenido: las variables de `deploy/content-lab/app.env.example` con
`CONTENT_LAB_ORIGIN=https://lab.enbenidorm.es`. El hash va **sin comillas** (systemd no es Compose).
No pongas `CONTENT_LAB_HOST`, `CONTENT_LAB_PORT` ni `CONTENT_LAB_CONTENT_PATH`: los fija la unidad.
Rota `SANITY_IMAGES_TOKEN` al cambiar de servidor.

### 5. Scripts, sudoers y systemd

Desde un checkout del repo en la VPS (o copiando los ficheros de `deploy/vps/`):

```bash
sudo install -o root -g root -m 755 deploy/vps/bin/enbenidorm-deploy /usr/local/bin/enbenidorm-deploy
sudo install -o root -g root -m 755 deploy/vps/bin/content-lab-backup /usr/local/sbin/content-lab-backup
sudo install -o root -g root -m 440 deploy/vps/sudoers-enbenidorm-deploy /etc/sudoers.d/enbenidorm-deploy
sudo visudo -cf /etc/sudoers.d/enbenidorm-deploy
sudo install -o root -g root -m 644 deploy/vps/content-lab.service /etc/systemd/system/content-lab.service
sudo systemctl daemon-reload
sudo systemctl enable content-lab.service   # no arranca hasta que exista /srv/content-lab/app/current
```

### 6. Caddy

```bash
sudo install -d -m 755 /etc/caddy/sites
sudo install -m 644 deploy/vps/enbenidorm.caddy /etc/caddy/sites/enbenidorm.caddy
# Añade en /etc/caddy/Caddyfile, si no está:  import /etc/caddy/sites/*.caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy necesita leer `/srv/enbenidorm/site` (permisos 755, ya lo están).

### 7. Clave SSH de despliegue

En tu ordenador, una clave **solo** para esto:

```bash
ssh-keygen -t ed25519 -N '' -C github-actions-enbenidorm -f enbenidorm_deploy
```

En la VPS, en `/home/deploy/.ssh/authorized_keys` (700 / 600, propietario deploy), **una línea**:

```text
restrict,command="/usr/local/bin/enbenidorm-deploy" ssh-ed25519 AAAA…contenido de enbenidorm_deploy.pub… github-actions-enbenidorm
```

Huella del servidor para `known_hosts` (compruébala contra la consola de Hostinger, no a ciegas):

```bash
ssh-keyscan -p 22 <ip-o-host-de-la-vps>
```

### 8. GitHub

En *Settings → Environments*, crea `production` y `production-lab`. En los dos, *Deployment branches
and tags* → *Selected branches* → `main`, para que sus secrets no lleguen a otra rama. Opcional: exige
tu aprobación en `production-lab`.

En *Settings → Branches* (o *Rules*), protege `main`: PR obligatorio y sin push directo. En *Settings → Secrets and variables → Actions*:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | contenido de `enbenidorm_deploy` (privada) |
| Secret | `DEPLOY_KNOWN_HOSTS` | salida de `ssh-keyscan` verificada |
| Variable | `DEPLOY_HOST` | IP o nombre de la VPS |
| Variable | `DEPLOY_PORT` | `22` u otro |
| Variable | `DEPLOY_USER` | `deploy` |
| Variable | `PUBLIC_SANITY_PROJECT_ID` | id del proyecto Sanity |
| Variable | `PUBLIC_SANITY_DATASET` | `production` |

El dataset es público: el build no necesita token de Sanity. No añadas `SANITY_API_TOKEN` a GitHub.

Borra la clave privada de tu ordenador cuando esté en GitHub.

### 9. Corte

1. Desactiva el despliegue Git del «website» de Hostinger (hPanel) para que no compita.
2. Lanza Actions → *Run workflow* → `all`. Las comprobaciones HTTPS fallarán si el DNS aún no apunta
   a la VPS; los ficheros sí quedan en su sitio. Comprueba en la VPS: `sudo -u deploy SSH_ORIGINAL_COMMAND=status /usr/local/bin/enbenidorm-deploy`.
3. Baja el TTL y apunta `A`/`AAAA` de `enbenidorm.es`, `www` y `lab` a la VPS.
4. Cuando Caddy tenga certificados, vuelve a lanzar `all` y comprueba que todo sale en verde.
5. Inicia sesión en Content Lab → *Estado de instalación*: totales del catálogo, una ficha, una nota de prueba.
6. Cuando todo funcione, retira el «website» y el hosting Node gestionado de Hostinger.

### 10. Webhook de Sanity (opcional)

Para reconstruir la web al publicar en Sanity:

1. GitHub → token *fine-grained* limitado a `puruwin/en-benidorm` con permiso *Contents: Read and write*
   (GitHub lo exige para `dispatches`) y caducidad corta. Ese permiso también permite hacer push: la
   protección de `main` del paso 8 es la que impide que un token filtrado despliegue código.
2. Sanity → API → Webhooks: URL `https://api.github.com/repos/puruwin/en-benidorm/dispatches`,
   método POST, solo documentos publicados, cabeceras
   `Authorization: Bearer <token>` y `Accept: application/vnd.github+json`,
   proyección `{"event_type": "sanity-publish"}`.

Cada publicación lanza un build. Si se publican varias seguidas, GitHub deja en cola solo la última.
Sin el webhook, el contenido publicado en Sanity no llega a la web hasta el siguiente merge o
*Run workflow* → `site`.
Si el contenido nuevo genera un error de `seo:audit`, no se despliega: es intencionado.

## Operación

Desde la VPS (los mismos comandos que usa Actions):

```bash
sudo -u deploy SSH_ORIGINAL_COMMAND=status /usr/local/bin/enbenidorm-deploy
sudo -u deploy SSH_ORIGINAL_COMMAND=rollback-site /usr/local/bin/enbenidorm-deploy
sudo -u deploy SSH_ORIGINAL_COMMAND=rollback-lab /usr/local/bin/enbenidorm-deploy
journalctl -u content-lab -n 200
tail -n 100 /srv/enbenidorm/deploy.log
```

Si Content Lab no arranca con «Sincronización bloqueada»: un cierre abrupto dejó el lock. Con el
servicio parado y sin otro despliegue en curso, borra solo
`/srv/content-lab/content/.release-artifacts/sync.lock` y arranca (ver `deploy/content-lab/HOSTINGER-NODE.md`).

La caché de npm del usuario `deploy` crece con cada despliegue; límpiala de vez en cuando con
`sudo -u deploy npm cache clean --force`.

Un rollback no revierte `main`: el siguiente merge vuelve a desplegar. Corrige con un PR.
Restaurar un backup de `content/`: con el servicio detenido, extrae en un directorio nuevo y sigue
`deploy/content-lab/README.md` → *Actualizaciones, backup y recuperación*.
