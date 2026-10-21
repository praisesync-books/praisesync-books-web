// =====================================================================
//  Avisos de pedidos por Telegram · PraiseSync Books Web
//  Programa para Cloudflare Workers (gratis). Se pega completo en el
//  editor de Cloudflare. Los datos privados van en "Variables y secretos".
// =====================================================================
//
//  Variables que hay que crear en Cloudflare (Settings → Variables and Secrets):
//    TELEGRAM_TOKEN    (Secreto)  el token que te da @BotFather
//    TELEGRAM_CHAT_ID  (Texto)    tu número de chat (o varios separados por coma)
//    BOT_EMAIL         (Texto)    correo de la cuenta "bot" creada en Firebase
//    BOT_PASSWORD      (Secreto)  contraseña de esa cuenta
//    FIREBASE_API_KEY  (Texto)    el apiKey de config.js
//    FIREBASE_PROJECT  (Texto)    praisesync-books
//    PANEL_URL         (Texto)    https://praisesync-books.github.io/praisesync-books-web/admin/#pedidos
//
//  Cómo funciona: la tienda manda solo el número interno del pedido. Este programa
//  entra a Firebase con la cuenta "bot" (que solo puede LEER pedidos), comprueba que el
//  pedido exista y sea reciente, y recién ahí envía el aviso. Así nadie puede mandarte
//  avisos falsos aunque conozca la dirección de este programa.

const MINUTOS_VALIDO = 10;        // solo se avisa de pedidos creados hace menos de esto
const avisados = new Map();       // evita avisar dos veces del mismo pedido
let sesion = null;                // { token, vence }

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);

    try {
      // Revisión de la configuración: abre la dirección del programa en el navegador.
      if (request.method === "GET" && url.pathname === "/") {
        const faltan = ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "BOT_EMAIL", "BOT_PASSWORD", "FIREBASE_API_KEY", "FIREBASE_PROJECT"]
          .filter((k) => !env[k]);
        return texto(faltan.length ? "Faltan estas variables: " + faltan.join(", ") : "OK · Avisos de pedidos listos.", cors);
      }

      // Mensaje de prueba: /prueba?clave=<BOT_PASSWORD>
      if (request.method === "GET" && url.pathname === "/prueba") {
        if (!env.BOT_PASSWORD || url.searchParams.get("clave") !== env.BOT_PASSWORD) return texto("Clave incorrecta.", cors, 403);
        await entrar(env);   // comprueba también que la cuenta bot funcione
        await enviarTelegram(env, "✅ <b>Avisos de PraiseSync Books Web funcionando.</b>\nTe llegará un mensaje aquí cada vez que entre un pedido.");
        return texto("Mensaje de prueba enviado a Telegram.", cors);
      }

      if (request.method !== "POST") return texto("No encontrado.", cors, 404);

      // Aviso de pedido nuevo: la tienda envía {"id": "<id del pedido>"}
      let id = "";
      try { id = String((JSON.parse(await request.text()) || {}).id || ""); } catch (e) {}
      if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return texto("Pedido no válido.", cors, 400);

      limpiarAvisados();
      if (avisados.has(id)) return texto("Ya avisado.", cors);

      const pedido = await leerPedido(env, id);
      if (!pedido) return texto("Pedido no encontrado.", cors, 404);
      const creado = pedido.creado ? new Date(pedido.creado).getTime() : 0;
      if (!creado || Date.now() - creado > MINUTOS_VALIDO * 60000) return texto("Pedido antiguo.", cors, 409);

      avisados.set(id, Date.now());
      await enviarTelegram(env, mensajePedido(id, pedido, env), botones(pedido, env));
      return texto("Aviso enviado.", cors);
    } catch (err) {
      return texto("Error: " + (err && err.message ? err.message : err), cors, 500);
    }
  }
};

function texto(t, cors, status = 200) {
  return new Response(t, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
}
function limpiarAvisados() {
  const limite = Date.now() - 24 * 3600000;
  for (const [k, t] of avisados) if (t < limite) avisados.delete(k);
}

// ---------- Firebase ----------
async function entrar(env) {
  if (sesion && sesion.vence > Date.now() + 60000) return sesion.token;
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + env.FIREBASE_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.BOT_EMAIL, password: env.BOT_PASSWORD, returnSecureToken: true })
  });
  const d = await r.json();
  if (!r.ok) throw new Error("No se pudo entrar a Firebase con la cuenta bot (" + ((d.error && d.error.message) || r.status) + ")");
  sesion = { token: d.idToken, vence: Date.now() + Number(d.expiresIn || 3600) * 1000 };
  return sesion.token;
}

async function leerPedido(env, id) {
  const token = await entrar(env);
  const r = await fetch("https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT +
    "/databases/(default)/documents/pedidos/" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + token } });
  if (r.status === 404) return null;
  if (r.status === 403) throw new Error("La cuenta bot no tiene permiso para leer pedidos. Revisa las reglas de Firestore.");
  if (!r.ok) throw new Error("Firestore respondió " + r.status);
  const d = await r.json();
  return valor({ mapValue: { fields: d.fields || {} } });
}

// Convierte el formato de Firestore ({stringValue: "…"}, {mapValue: …}) en datos normales.
function valor(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valor);
  if ("mapValue" in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = valor(x);
    return o;
  }
  return null;
}

// ---------- Telegram ----------
function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function pesos(n) { return "$" + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }

function mensajePedido(id, p, env) {
  const c = p.cliente || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const unidades = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
  const lineas = [
    "🛒 <b>Nuevo pedido #" + esc(id.slice(0, 6).toUpperCase()) + "</b>",
    "",
    "👤 " + esc(c.nombre) + (c.telefono ? " · " + esc(c.telefono) : ""),
    ""
  ];
  items.slice(0, 20).forEach((it) => {
    lineas.push("📚 " + (Number(it.cantidad) || 0) + " × " + esc(it.nombre) + " — " + pesos((Number(it.precio) || 0) * (Number(it.cantidad) || 0)));
  });
  if (items.length > 20) lineas.push("… y " + (items.length - 20) + " libros más");
  lineas.push("", "💰 <b>Total: " + pesos(p.total) + "</b>" + (unidades > 1 ? " (" + unidades + " unidades)" : ""));
  if (c.notas) lineas.push("📝 " + esc(c.notas));
  return lineas.join("\n");
}

function botones(p, env) {
  const fila = [];
  let tel = String((p.cliente || {}).telefono || "").replace(/\D/g, "");
  if (tel.length === 10) tel = "57" + tel;
  if (tel.length >= 10) fila.push({ text: "💬 WhatsApp del cliente", url: "https://wa.me/" + tel });
  if (env.PANEL_URL) fila.push({ text: "📋 Abrir panel", url: env.PANEL_URL });
  return fila.length ? { inline_keyboard: [fila] } : undefined;
}

async function enviarTelegram(env, texto, teclado) {
  const chats = String(env.TELEGRAM_CHAT_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!chats.length) throw new Error("Falta TELEGRAM_CHAT_ID");
  for (const chat of chats) {
    const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: teclado })
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error("Telegram no aceptó el mensaje (" + (d.description || r.status) + ")");
    }
  }
}
