# PraiseSync Books Web

Tienda de libros y Biblias con pedidos por WhatsApp y panel de administración.
El sitio se publica gratis con GitHub Pages y los datos viven en Firebase (plan gratuito).

- **Tienda:** `https://praisesync-books.github.io/praisesync-books-web/`
- **Panel:** `https://praisesync-books.github.io/praisesync-books-web/admin/`

## Cómo funciona

1. El cliente agrega libros a **Mi pedido**, escribe su nombre y teléfono y toca **Continuar a WhatsApp**.
2. El pedido se guarda en el panel como **Pendiente** y el cliente envía el resumen por WhatsApp.
3. Cuando confirman el pago, en el panel tocan **Marcar pagado**: el stock se descuenta solo.
4. Al entregarlo, **Marcar entregado**. Si un pedido pagado se cancela, el stock se devuelve solo.

## Configuración inicial (una sola vez)

### 1. Pegar los datos de Firebase
Abre `config.js` en GitHub (lápiz ✏️) y reemplaza los valores `PEGAR_AQUI` con los del bloque
`firebaseConfig` de tu proyecto (Firebase → ⚙️ Configuración del proyecto → Tus apps). Guarda con **Commit changes**.

### 2. Publicar las reglas de seguridad
1. Abre `firestore.rules` y cambia `CORREO_ADMIN@gmail.com` por el correo con el que entras al panel (en minúsculas).
   Para varias personas: `['uno@gmail.com', 'otra@gmail.com']`.
2. Copia todo el texto.
3. En Firebase → **Firestore Database → Reglas**, borra lo que hay, pega y toca **Publicar**.

Sin este paso el panel no deja entrar y la tienda no muestra libros.

### 3. Crear más personas administradoras (opcional)
Firebase → **Authentication → Usuarios → Agregar usuario**, y agrega su correo a la lista de `firestore.rules` (y vuelve a publicar).

## Uso del panel

- **Resumen:** ventas de hoy y del mes, pedidos pendientes, ventas de los últimos 6 meses, más vendidos y stock bajo.
- **Pedidos:** filtra por estado, escribe al cliente por WhatsApp con un toque y cambia el estado.
- **Libros:** crea y edita libros con foto de portada y hasta 3 fotos del interior, ajusta el stock con − / + o escribiendo el número, oculta un libro sin borrarlo
  (desmarca "Visible en la tienda").
- **Ofertas:** barra de anuncio (franja roja arriba de la tienda), campañas de descuento por categoría con fechas,
  y la lista de libros con precio de oferta propio. El precio de oferta de cada libro se pone al editarlo.
  Las ofertas y campañas se activan y se quitan solas según sus fechas.
- **Banners:** hasta 5 fotos grandes arriba de la tienda (con título, subtítulo y botón que lleva a un libro, una categoría, las ofertas o un enlace). Cambian solos cada 6 segundos y se pueden programar con fechas.
- **Información:** las páginas del pie de la tienda (Quiénes somos, Envíos y entregas, Formas de pago, Cambios y devoluciones, Contacto). Cada una trae un borrador: completa lo que está entre [corchetes], activa "Mostrar en la tienda" y guarda. Cada página tiene su enlace, ej. `…/?info=envios`.
- **Respaldo:** descarga los libros (Excel, se pueden volver a importar), los pedidos (Excel) o un respaldo completo (archivo .json, con fotos opcionales). El Resumen te recuerda si pasa un mes sin respaldo.
- **Página principal:** activa u oculta cada carrusel (Destacados, Más vendidos, Novedades y uno por categoría). "Todos los libros" siempre aparece debajo.
- **Categorías y subcategorías:** crea, renombra (actualiza todos sus libros), ordena con ↑ ↓ y elimina. Cada categoría puede tener subcategorías (ej. Biblias › Letra grande).

### Importar muchos libros a la vez
Usa `plantilla-catalogo.csv` como modelo (ábrela en Excel o Google Sheets). Columnas:
**Nombre, Autor, Editorial, ISBN, Categoría, Subcategoría, Precio, Precio oferta, Oferta hasta, Stock, Páginas, Peso, Dimensiones, Cubierta, Descripción**.
Peso en gramos (también acepta `1,2 kg`); dimensiones en centímetros, ej. `15 x 22 x 3`. Las columnas que no necesites se pueden quitar.
Ojo con el ISBN en Excel: antes de escribirlo, pon esa columna en formato **Texto**; si no, Excel lo convierte en algo como `9,78E+12`. Guárdala como CSV y en el panel toca **Libros → Importar CSV**.
Si un libro ya existe (mismo ISBN, o mismo nombre y autor), se actualiza en vez de duplicarse. Las categorías y subcategorías nuevas se crean solas.
Las fotos se agregan después, editando cada libro.

### Autocompletar por ISBN
- **Un libro:** en el editor escribe el ISBN y toca **🔎 Autocompletar** (o Enter). Se llenan nombre, autor, editorial, páginas, descripción y portada desde Google Books y Open Library (gratis). Si ya había datos escritos, pregunta antes de reemplazarlos.
- **Muchos libros:** usa `plantilla-solo-isbn.csv` (columnas **ISBN, Categoría, Precio, Stock**) e impórtala en **Libros → Importar CSV**. Los ISBN que no estén en la tienda se buscan en internet y se crean con sus datos y portada; los que ya existen solo actualizan precio, stock y categoría.
- Acepta ISBN con guiones, de 10 dígitos o de 14 dígitos con un 0 adelante (como vienen en algunos inventarios).
- Con libros en español a veces faltan la descripción o la portada: revisa cada libro y completa lo que falte.

## Compartir libros

- Cada libro tiene su propio enlace (ej. `…/?libro=biblia-devocional-macarthur-Qx7pK2`). Al abrirlo, la tienda muestra directamente ese libro.
- En la tienda: botón **Compartir** en la ficha del libro. En el panel: **Copiar enlace** al editar un libro.
- El enlace sigue funcionando aunque cambies el nombre del libro.
- Al pegar cualquier enlace de la tienda en WhatsApp o Facebook aparece la imagen `img/compartir.jpg` con el logo.
  Si cambias de dominio, actualiza la dirección en las etiquetas `og:url` y `og:image` de `index.html`.

## Avisos de pedidos por Telegram (opcional)

Te llega un mensaje a Telegram con cada pedido nuevo, al instante. Se activa siguiendo `bot-telegram/GUIA.md`
(Cloudflare Workers, gratis). Para apagarlo, deja `avisoPedidos: ""` en `config.js`.

## Notas

- Las fotos del interior se guardan con más resolución (para que se lea la letra) y solo se descargan cuando el cliente abre la ficha del libro.
- Las fotos se reducen automáticamente y se guardan en la base de datos (no hace falta Firebase Storage).
- El precio que el cliente ve en WhatsApp es el del catálogo en ese momento; confírmalo siempre en el chat antes de cobrar.
- Para cambiar el número de WhatsApp, el nombre de la tienda o el mensaje del botón flotante de WhatsApp: `config.js`.
- **Dominio propio:** compra el dominio, configura su DNS para GitHub Pages, escríbelo en Settings → Pages → Custom domain,
  y agrégalo en Firebase → Authentication → Configuración → Dominios autorizados.
