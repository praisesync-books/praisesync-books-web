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
- **Libros:** crea y edita libros con foto, ajusta el stock con − / + o escribiendo el número, oculta un libro sin borrarlo
  (desmarca "Visible en la tienda").
- **Categorías:** crea, renombra (actualiza todos sus libros), ordena con ↑ ↓ y elimina.

### Importar muchos libros a la vez
Usa `plantilla-catalogo.csv` como modelo (ábrela en Excel o Google Sheets). Columnas:
**Nombre, Autor, Categoría, Precio, Stock, Descripción**. Guárdala como CSV y en el panel toca **Libros → Importar CSV**.
Si un libro ya existe (mismo nombre y autor), se actualiza en vez de duplicarse. Las categorías nuevas se crean solas.
Las fotos se agregan después, editando cada libro.

## Notas

- Las fotos se reducen automáticamente y se guardan en la base de datos (no hace falta Firebase Storage).
- El precio que el cliente ve en WhatsApp es el del catálogo en ese momento; confírmalo siempre en el chat antes de cobrar.
- Para cambiar el número de WhatsApp o el nombre de la tienda: `config.js`.
- **Dominio propio:** compra el dominio, configura su DNS para GitHub Pages, escríbelo en Settings → Pages → Custom domain,
  y agrégalo en Firebase → Authentication → Configuración → Dominios autorizados.
