# Autocompletar libros desde CLC Colombia

Con esto, el botón **🔎 Autocompletar** del panel busca primero en **clccolombia.com** y trae:
nombre, autor, editorial, páginas, cubierta, dimensiones, reseña y portada. Además te muestra
el **precio al público de CLC** y **cuántas unidades tienen** ("En CLC: $75.000 · 6 disponibles").
Si el libro no está en CLC, sigue buscando en Google Books y Open Library como antes.

Se activa una sola vez, en unos 10 minutos. Es gratis y no pide tarjeta.

> ¿Por qué hace falta esto? Por seguridad, los navegadores no dejan que una página (tu panel)
> lea otro sitio (CLC). Este pequeño programa en Cloudflare hace la consulta por ti.
> Solo responde a tu tienda, solo trae imágenes de CLC y guarda cada resultado 12 horas
> para no consultar a CLC más de lo necesario.

---

## Paso 1 · Crear el programa en Cloudflare (7 min)

1. Entra a **dash.cloudflare.com** (si ya creaste la cuenta para el bot de Telegram, usa la misma).
2. En el menú: **Workers y Pages** (Compute → Workers & Pages) → **Crear** → **Crear Worker** (empezar con "Hello World").
3. Nombre: `praisesync-clc` → **Implementar (Deploy)**.
4. Toca **Editar código**, borra todo lo que aparece, pega **todo** el contenido de `buscador-clc/worker.js` y toca **Implementar**.
5. Copia la dirección del Worker, que se ve así: `https://praisesync-clc.TU-CUENTA.workers.dev`

No necesita variables ni contraseñas.

## Paso 2 · Probar que funciona (1 min)

1. Abre la dirección del Worker en el navegador. Debe decir **"OK · Buscador CLC listo."**
2. Agrega al final `/?isbn=9781680439939`. Ejemplo:
   `https://praisesync-clc.TU-CUENTA.workers.dev/?isbn=9781680439939`
   Debe mostrar los datos de *Permanece Fiel* (texto con `"encontrado":true`, el nombre, el autor…).
   Si dice `"encontrado":false` con un libro que sí está en CLC, avísame: puede que CLC haya cambiado su página.

## Paso 3 · Activarlo en la tienda (2 min)

1. En GitHub abre `config.js` → lápiz ✏️.
2. Pega la dirección del Worker entre las comillas de `buscadorCLC`:
   ```js
   buscadorCLC: "https://praisesync-clc.TU-CUENTA.workers.dev",
   ```
3. **Commit changes**. En 1 o 2 minutos el panel ya busca en CLC.

## Para tener en cuenta

- El precio que muestra es el **precio al público** de CLC, no tu precio de distribuidor. No se pone solo en tu libro: tú decides tu precio.
- Las unidades disponibles son las de **CLC**, no las tuyas. Te sirven para saber si te pueden despachar.
- Si CLC cambia el diseño de su página, puede dejar de encontrar datos. En ese caso el panel sigue funcionando con Google Books y solo hay que actualizar `worker.js`.
- Para apagarlo, deja `buscadorCLC: ""` en `config.js`.
