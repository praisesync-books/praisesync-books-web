# PraiseSync Books Web

Tienda de libros y Biblias con pedidos por WhatsApp, publicada gratis con GitHub Pages.

## Cómo publicar el sitio (una sola vez)

1. Entra a github.com y crea un repositorio nuevo, **público**, por ejemplo `praisesync-books-web`.
2. En el repositorio, toca **Add file → Upload files** y arrastra todos los archivos de esta carpeta (incluida la carpeta `imagenes`). Toca **Commit changes**.
3. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)**, y toca **Save**.
4. Espera uno o dos minutos. El sitio queda en `https://TU-USUARIO.github.io/praisesync-books-web/`.

## Cómo editar el catálogo

El catálogo está en `catalogo.csv`. Cada fila es un libro, con estas columnas:

| Columna | Qué poner |
|---|---|
| Nombre | Título del libro |
| Autor | Autor o editorial |
| Categoría | Biblias, Devocionales, etc. Los botones de categoría se crean solos. |
| Precio | Solo el número, sin puntos ni $. Ej: `85000` |
| Stock | Unidades disponibles. Con `0` aparece como **Agotado**. Vacío = disponible sin mostrar cantidad. |
| Descripción | Texto corto. Si lleva comas, va entre comillas: `"Letra grande, tapa dura"` |
| Imagen | Nombre del archivo de la foto, ej: `biblia-rv60.jpg`. Vacío = portada simple con el título. |

**Desde la web de GitHub:** abre `catalogo.csv`, toca el lápiz ✏️, edita y toca **Commit changes**. En un par de minutos se ve en el sitio.

**Desde Excel o Google Sheets:** abre el archivo, edítalo y guárdalo como **CSV**. Luego en GitHub: **Add file → Upload files**, sube el `catalogo.csv` nuevo y confirma. Funciona aunque Excel lo guarde con punto y coma.

Borra las tres filas de ejemplo cuando agregues los libros reales (deja siempre la primera fila con los nombres de las columnas).

## Cómo subir fotos

1. Abre la carpeta `imagenes` en GitHub → **Add file → Upload files** → arrastra las fotos → **Commit changes**.
2. Escribe el nombre exacto del archivo en la columna **Imagen** del catálogo (respeta mayúsculas y la extensión `.jpg` / `.png`).

Recomendado: fotos verticales (proporción 3:4), de menos de 500 KB, nombres sin espacios ni tildes (ej: `biblia-letra-grande.jpg`).

## Cambiar el número de WhatsApp o el nombre

Edita `config.js` (ya tiene el número 57 313 209 2326). Ahí también se cambia el mensaje que llega al tocar **Comprar**.

## Dominio propio (más adelante)

Compra el dominio, configura su DNS para GitHub Pages y escríbelo en **Settings → Pages → Custom domain**. El sitio no necesita cambios.
