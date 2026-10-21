# Avisos de pedidos por Telegram

Cada vez que un cliente hace un pedido en la tienda, te llega al instante un mensaje en Telegram
con el cliente, los libros y el total, aunque el cliente no termine de enviar el WhatsApp.

Se activa una sola vez, en unos 20 minutos. Todo es gratis y no pide tarjeta.

---

## Paso 1 · Crear el bot en Telegram (5 min)

1. En Telegram busca **@BotFather** (el que tiene la palomita azul) y ábrelo.
2. Escribe `/newbot`.
3. Nombre del bot: por ejemplo `Avisos PraiseSync`.
4. Usuario del bot (debe terminar en `bot`): por ejemplo `praisesync_avisos_bot`.
5. BotFather te responde con un **token**, algo como `7412345678:AAH...`. **Cópialo y guárdalo.** No lo compartas con nadie.
6. Toca el enlace de tu bot nuevo (`t.me/praisesync_avisos_bot`) y presiona **Iniciar / Start**.
   Esto es obligatorio: sin este paso el bot no puede escribirte.
7. Busca **@userinfobot**, ábrelo y presiona **Iniciar**. Te responde con tu **Id** (un número como `123456789`). **Guárdalo.**

> ¿Quieres que lleguen a varias personas? Cada una hace los pasos 6 y 7, y luego pones sus Id separados por coma.

## Paso 2 · Crear la cuenta del bot en Firebase (3 min)

El programa de avisos entra a Firebase con su propia cuenta, que **solo puede leer pedidos**.

1. Firebase → **Authentication → Usuarios → Agregar usuario**.
2. Correo: `bot-telegram@praisesync-books.firebaseapp.com` (no tiene que ser un correo real).
3. Contraseña: inventa una larga y **guárdala**.
4. Publica las reglas nuevas: Firestore → **Reglas**, borra todo, pega el contenido de `firestore.rules` y toca **Publicar**.

## Paso 3 · Crear el programa en Cloudflare (10 min)

1. Entra a **dash.cloudflare.com** y crea una cuenta gratis (solo correo y contraseña).
2. En el menú: **Workers y Pages** (Compute → Workers & Pages) → **Crear** → **Crear Worker** (empezar con "Hello World").
3. Nombre: `praisesync-avisos` → **Implementar (Deploy)**.
4. Toca **Editar código**, borra todo lo que aparece, pega **todo** el contenido de `bot-telegram/worker.js` y toca **Implementar**.
5. Vuelve al Worker → **Configuración (Settings) → Variables y secretos → Agregar**. Crea estas 7:

| Nombre | Tipo | Valor |
|---|---|---|
| `TELEGRAM_TOKEN` | Secreto | el token de BotFather |
| `TELEGRAM_CHAT_ID` | Texto | tu Id de @userinfobot |
| `BOT_EMAIL` | Texto | `bot-telegram@praisesync-books.firebaseapp.com` |
| `BOT_PASSWORD` | Secreto | la contraseña del paso 2 |
| `FIREBASE_API_KEY` | Texto | el `apiKey` que está en `config.js` |
| `FIREBASE_PROJECT` | Texto | `praisesync-books` |
| `PANEL_URL` | Texto | `https://praisesync-books.github.io/praisesync-books-web/admin/#pedidos` |

6. Toca **Implementar** para guardar las variables.
7. Copia la dirección del Worker, que se ve así: `https://praisesync-avisos.TU-CUENTA.workers.dev`

## Paso 4 · Probar que funciona (2 min)

1. Abre la dirección del Worker en el navegador. Debe decir **"OK · Avisos de pedidos listos."**
   Si dice "Faltan estas variables…", revisa el paso 3.5.
2. Abre la misma dirección agregando al final `/prueba?clave=` y la contraseña del bot. Ejemplo:
   `https://praisesync-avisos.TU-CUENTA.workers.dev/prueba?clave=MiClaveLarga123`
   Te debe llegar a Telegram: **"✅ Avisos de PraiseSync Books Web funcionando."**

## Paso 5 · Conectar la tienda (2 min)

1. En GitHub abre `config.js` → lápiz ✏️.
2. En la línea `avisoPedidos: ""` pega la dirección del Worker entre las comillas:
   `avisoPedidos: "https://praisesync-avisos.TU-CUENTA.workers.dev/",`
3. **Commit changes**. En 1–2 minutos queda activo.
4. Haz un pedido de prueba en la tienda: te debe llegar el aviso a Telegram.

---

## Si algo no funciona

Abre la dirección del Worker con `/prueba?clave=…` y lee el mensaje que aparece:

| Mensaje | Qué revisar |
|---|---|
| Clave incorrecta | La clave de la dirección debe ser igual a `BOT_PASSWORD`. |
| No se pudo entrar a Firebase con la cuenta bot | Correo o contraseña del paso 2 distintos a `BOT_EMAIL` / `BOT_PASSWORD`. |
| La cuenta bot no tiene permiso para leer pedidos | No se publicaron las reglas nuevas, o el correo del bot en las reglas es distinto. |
| Telegram no aceptó el mensaje (chat not found) | Falta presionar **Iniciar** en tu bot (paso 1.6), o el Id está mal. |
| Telegram no aceptó el mensaje (Unauthorized) | El token está mal copiado. |

## Notas

- Solo se avisa de pedidos **reales y recientes**: el programa comprueba cada pedido en Firebase. Nadie puede mandarte avisos falsos.
- El plan gratis de Cloudflare permite 100.000 avisos al día.
- Para apagar los avisos, deja `avisoPedidos: ""` en `config.js`.
- Si cambias la contraseña del bot en Firebase, cámbiala también en `BOT_PASSWORD`.
