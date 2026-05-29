# Aldepe Forge

App web pequeña para coleccionar cartas con amigos: el admin crea sobres/colecciones con portada, mete cartas dentro, define rareza/peso y los jugadores abren sobres de 3 cartas.

La decisión práctica para coste cero es:

- Frontend estático: `index.html`, `styles.css`, `app.js`.
- Backend compartido: Supabase Free, con Auth anónimo, Postgres, Storage y RLS.
- Hosting: GitHub Pages o Cloudflare Pages.

No uso Java en esta primera versión porque desplegar un backend Java gratis suele ser más frágil: servicios dormidos, límites más raros, más configuración y necesidad de guardar imágenes aparte. Aquí todo lo que ve el jugador vive en una web normal.

## Probar en local

Desde esta carpeta:

```powershell
npx --yes http-server . -p 4173 -c-1
```

Abre:

```text
http://localhost:4173
```

Si no configuras Supabase, entra en modo demo. La contraseña de jugador por defecto es `aldepe` y la de admin demo es `aldepe-admin`. Ahora empieza con 0 fotos/cartas.

## Conectar Supabase

1. Crea un proyecto gratis en Supabase.
2. En `SQL Editor`, pega y ejecuta el contenido de `supabase-schema.sql`.
3. En `Authentication > Sign In / Providers`, activa `Anonymous sign-ins`.
4. En `Project Settings > API`, copia:
   - `Project URL`
   - `anon public` key
5. Pega esos dos valores en `config.js` y cambia las contraseñas:

```js
window.ALDEPE_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "TU_ANON_PUBLIC_KEY",
  accessPassword: "CONTRASEÑA_PARA_TUS_AMIGOS",
  adminPassword: "CONTRASEÑA_ADMIN_SOLO_PARA_DEMO",
};
```

6. Abre la app y entra con tu nombre de jugador.
7. Vuelve al SQL Editor y promuévete a admin:

```sql
update public.profiles set is_admin = true where username = 'TU_NOMBRE';
```

8. Recarga la app. La pestaña `Admin` ya te dejará crear sobres y subir cartas dentro de cada sobre.

Importante: no pegues nunca la `service_role key` en la app. La `anon public key` sí está pensada para usarse en frontend; la seguridad real de cartas/admin/cooldown está en las políticas RLS y funciones del SQL.

La contraseña de acceso de `config.js` es una puerta sencilla para tu grupo, no seguridad bancaria: en una web estática un usuario técnico podría inspeccionar el código. Para un grupo de amigos va bien; para algo público grande habría que usar login real con email o un backend.

## Reglas actuales

- Solo el admin puede ver la pestaña `Admin`.
- El admin puede borrar sobres completos o cartas sueltas.
- El admin puede monitorizar jugadores: copias totales, cartas únicas y cooldown del siguiente sobre.
- La app arranca con 0 sobres y 0 fotos.
- Cada sobre tiene nombre y portada.
- El admin puede escoger el color del sobre.
- Cada carta pertenece a un sobre.
- Cada portada y foto subida se procesa en el navegador con un filtro de estilo común y un borde antes de guardarse.
- Una carta puede salir en versión `HOLO`; es mucho más raro que una copia normal.
- Cada jugador puede abrir 1 sobre cada 8 horas.
- Hay logout y botón de sonido.
- La colección se agrupa por sobres y muestra el jugador encima del nombre del sobre.
- Los jugadores pueden proponer intercambios de cartas entre ellos.

## Importar Sobres

Desde `Admin > Importar sobre` puedes subir un JSON:

```json
{
  "name": "Viernes Turbio",
  "color": "#ff6f61",
  "coverImage": "data:image/png;base64,...",
  "cards": [
    {
      "name": "Carta 1",
      "description": "Texto corto",
      "rarity": "comun",
      "weight": 60,
      "image": "data:image/png;base64,..."
    }
  ]
}
```

Si falta una imagen, la app genera una provisional con el nombre.
Tienes una plantilla lista en `sample-pack.json`.

## Rarezas y probabilidades

Cada carta tiene un `weight`:

- Más peso = sale más.
- Menos peso = sale menos.

Valores iniciales recomendados:

- Común: `60`
- Rara: `24`
- Épica: `9`
- Legendaria: `2`

La probabilidad real se calcula sumando los pesos de las cartas activas dentro del sobre elegido. Si un sobre tiene diez cartas comunes con peso 60, todas juntas dominan ese sobre.

## Publicarlo gratis

Opción simple:

1. Sube estos archivos a un repositorio de GitHub.
2. Activa `Settings > Pages`.
3. Elige la rama principal y la carpeta raíz.
4. Comparte la URL con tus amigos.

Opción con despliegues más cómodos:

1. Crea una cuenta en Cloudflare.
2. Usa Cloudflare Pages.
3. Conecta el repositorio.
4. Deploy automático en cada cambio.

Consejo: comprime las imágenes de cartas a WebP/JPG antes de subirlas. Para un grupo de amigos, imágenes por debajo de 1 MB suelen sobrar y ayudan a no gastar ancho de banda gratuito.

## Siguientes mejoras naturales

- Sobres diarios o energía por jugador.
- Intercambios entre amigos.
- Álbum público por jugador.
- Cartas secretas que no muestran la imagen hasta tocarlas.
- Eventos temporales con probabilidades especiales.
- Panel admin para editar o desactivar cartas.
