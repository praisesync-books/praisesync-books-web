// ============================================================
//  Buscador de libros en CLC Colombia por ISBN (Cloudflare Worker)
//  El panel le pregunta por un ISBN y este programa lee la ficha del libro en
//  clccolombia.com y devuelve los datos (nombre, autor, editorial, páginas,
//  cubierta, dimensiones, reseña, portada, precio y disponibilidad).
//
//  Uso:  GET /?isbn=9781680439939          → datos del libro (JSON)
//        GET /imagen?u=<url de la portada>  → la portada (solo imágenes de CLC)
//
//  Variable opcional: ORIGENES = direcciones que pueden usarlo, separadas por coma.
//  Si no se pone, solo responde a la tienda en GitHub Pages (y a pruebas locales).
// ============================================================

const CLC = "https://www.clccolombia.com";
const ORIGENES_BASE = ["https://praisesync-books.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const HORAS_CACHE = 12;
const NAVEGADOR = "Mozilla/5.0 (compatible; PraiseSyncBooks/1.0; +https://praisesync-books.github.io/praisesync-books-web/)";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origen = request.headers.get("Origin") || "";
    const permitidos = env && env.ORIGENES ? String(env.ORIGENES).split(",").map((s) => s.trim()).filter(Boolean) : ORIGENES_BASE;
    const cors = {
      "Access-Control-Allow-Origin": permitidos.includes(origen) ? origen : permitidos[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return responder({ error: "Método no permitido" }, 405, cors);
    // Desde un navegador, solo la tienda puede usarlo (abrirlo directo en la barra de direcciones sí funciona, para probar).
    if (origen && !permitidos.includes(origen)) return responder({ error: "Origen no permitido" }, 403, cors);

    if (url.pathname === "/imagen") return imagen(url.searchParams.get("u"), cors);

    const isbn = normalizarISBN(url.searchParams.get("isbn"));
    if (!url.searchParams.has("isbn")) return new Response("OK · Buscador CLC listo. Prueba: /?isbn=9781680439939", { headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors) });
    if (!isbn) return responder({ encontrado: false, error: "ISBN no válido" }, 400, cors);

    // Se guarda en la caché de Cloudflare unas horas: si se busca el mismo libro otra vez, no se le pregunta a CLC.
    const claveCache = new Request("https://cache.buscador-clc/" + isbn);
    const cache = caches.default;
    const enCache = await cache.match(claveCache);
    if (enCache) return new Response(enCache.body, { headers: Object.assign({}, Object.fromEntries(enCache.headers), cors) });

    let datos;
    try {
      datos = await buscarEnCLC(isbn);
    } catch (e) {
      return responder({ encontrado: false, error: "No se pudo consultar CLC: " + (e && e.message || e) }, 502, cors);
    }
    if (datos.encontrado) {
      datos.portadas = (datos.portadas || []).map((p) => url.origin + "/imagen?u=" + encodeURIComponent(p));
      datos.portada = datos.portadas[0] || "";
    }
    const resp = responder(datos, 200, cors);
    ctx.waitUntil(cache.put(claveCache, new Response(JSON.stringify(datos), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=" + (datos.encontrado ? HORAS_CACHE * 3600 : 3600) }
    })));
    return resp;
  }
};

function responder(obj, estado, cors) {
  return new Response(JSON.stringify(obj), { status: estado, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cors) });
}

async function imagen(u, cors) {
  let destino;
  try { destino = new URL(u); } catch (e) { return new Response("Dirección no válida", { status: 400, headers: cors }); }
  if (destino.protocol !== "https:" || !/(^|\.)clccolombia\.com$/.test(destino.hostname)) return new Response("Solo imágenes de CLC", { status: 403, headers: cors });
  const r = await fetch(destino.toString(), { headers: { "User-Agent": NAVEGADOR }, cf: { cacheTtl: 86400, cacheEverything: true } });
  const tipo = r.headers.get("Content-Type") || "";
  if (!r.ok || tipo.indexOf("image") !== 0) return new Response("Sin imagen", { status: 404, headers: cors });
  return new Response(r.body, { headers: Object.assign({ "Content-Type": tipo, "Cache-Control": "max-age=86400" }, cors) });
}

async function pedir(direccion) {
  return fetch(direccion, { headers: { "User-Agent": NAVEGADOR, "Accept-Language": "es-CO,es;q=0.9" }, redirect: "follow" });
}

// Busca el ISBN en el buscador de CLC. Cuando el ISBN es exacto, CLC lleva directo a la ficha;
// si muestra una lista de resultados, se toma el producto cuyo enlace termina en ese ISBN.
export async function buscarEnCLC(isbn) {
  const intentos = [
    CLC + "/search/product-search?q=" + isbn,
    CLC + "/search/product-search?sq=" + isbn
  ];
  for (const dir of intentos) {
    const r = await pedir(dir);
    if (!r.ok) continue;
    const html = await r.text();
    if (/id="productJSON"/.test(html)) {
      const d = leerFicha(html, r.url);
      if (d.encontrado && (!d.isbn || d.isbn === isbn)) return d;
    }
    const enlace = enlaceProducto(html, isbn);
    if (enlace) {
      const r2 = await pedir(enlace);
      if (r2.ok) {
        const d = leerFicha(await r2.text(), r2.url);
        if (d.encontrado) return d;
      }
    }
  }
  return { encontrado: false };
}

export function enlaceProducto(html, isbn) {
  const re = /href="([^"]*\/product\/[^"?#]*?-(\d{13})(?:[?#][^"]*)?)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2] === isbn) return m[1].startsWith("http") ? m[1] : CLC + (m[1].startsWith("/") ? "" : "/") + m[1];
  }
  return "";
}

// ---------- Lectura de la ficha del producto ----------
export function leerFicha(html, direccion) {
  const ld = jsonLD(html);
  if (!ld) return { encontrado: false };
  const sistema = propiedades(html);            // ISBN, Título original, Cubierta, Idioma…
  const panel = bloqueDescripcion(html);         // reseña + "Ficha técnica"
  const ficha = panel.ficha;

  const autores = Array.isArray(ld.author) ? ld.author.map((a) => a && a.name).filter(Boolean).join(", ") : (ld.author && ld.author.name) || "";
  const oferta = ld.offers || {};
  const disponibilidad = String(oferta.availability || "");
  let unidades = null;
  const solo = html.match(/S[óo]lo\s+(\d+)\s+por el momento/i);
  if (solo) unidades = Number(solo[1]);

  let nombre = sistema["título original"] || ld.name || "";
  nombre = limpiarTexto(nombre).replace(/\s*\[[^\]]*\]\s*$/, "");

  return {
    encontrado: true,
    fuente: "CLC Colombia",
    url: ld.url || direccion || "",
    isbn: String(ld.isbn || ld.gtin13 || sistema.isbn || "").replace(/\D/g, ""),
    nombre: nombre,
    autor: limpiarTexto(ficha["autor"] || ficha["autores"] || autores),
    editorial: limpiarTexto(ficha["editorial"] || ""),
    paginas: parseInt(String(ficha["número de páginas"] || ficha["páginas"] || ficha["numero de paginas"] || "").replace(/\D/g, ""), 10) || 0,
    cubierta: limpiarTexto(sistema["cubierta"] || ficha["formato"] || ficha["encuadernación"] || ""),
    dimensiones: dimensiones(ficha["dimensiones"] || ""),
    idioma: limpiarTexto(sistema["idioma"] || ficha["idioma"] || ""),
    descripcion: panel.resena.slice(0, 3000),
    portadas: versionesPortada((Array.isArray(ld.image) ? ld.image[0] : ld.image) || metaOG(html, "og:image") || ""),
    precio: Math.round(parseFloat(oferta.price) || 0),
    disponible: /InStock|LimitedAvailability|PreOrder/i.test(disponibilidad),
    unidades: unidades,
    categoriaCLC: String(ld.category || "").replace(/^Productos\s*>\s*/, "")
  };
}

function jsonLD(html) {
  const m = html.match(/<script[^>]*id="productJSON"[^>]*>([\s\S]*?)<\/script>/i) ||
            html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?"@type"\s*:\s*\[?\s*"(?:Product|Book)"[\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
function metaOG(html, prop) {
  const m = html.match(new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', "i"));
  return m ? entidades(m[1]) : "";
}
// CLC guarda cada portada en varios tamaños: se prueba primero la original (la más grande) y luego la "large".
function versionesPortada(u) {
  if (!u) return [];
  const m = String(u).match(/^(.*\/images\/products\/)[a-z]+(\/.+)$/i);
  if (!m) return [u];
  return [m[1] + "original" + m[2], m[1] + "large" + m[2]];
}

// "<strong>Cubierta</strong>: Rústica<br />" dentro de .system-properties
function propiedades(html) {
  const o = {};
  const m = html.match(/class="ProductDetailGroup system-properties"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return o;
  const re = /<strong>\s*([^<:]+?)\s*:?\s*<\/strong>\s*:?\s*([^<]*)/gi;
  let x;
  while ((x = re.exec(m[1]))) o[minus(entidades(x[1]))] = entidades(x[2]).trim();
  return o;
}

// Texto de la pestaña "Descripción": separa la reseña de la "Ficha técnica".
function bloqueDescripcion(html) {
  const ini = html.search(/<div class="tabs-panel" id="description"/i);
  if (ini < 0) return { resena: "", ficha: {} };
  let fin = html.indexOf('class="tabs-panel"', ini + 30);
  if (fin < 0) fin = ini + 60000;
  const texto = aTexto(html.slice(ini, fin));
  let lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const iFicha = lineas.findIndex((l) => /^ficha t[ée]cnica\b/i.test(l));
  const ficha = {};
  const resto = iFicha >= 0 ? lineas.slice(iFicha + 1) : [];
  if (iFicha >= 0) lineas = lineas.slice(0, iFicha);
  // Campos "Etiqueta: valor" (los de la ficha y los que a veces vienen sueltos en la reseña)
  resto.forEach((l) => {
    const m = l.match(/^([A-Za-zÁÉÍÓÚáéíóúÑñ0-9 .\-]{2,30}):\s*(.+)$/);
    if (m) ficha[minus(m[1])] = m[2].trim();
  });
  // Quita el título repetido arriba, el encabezado "Reseña del libro" y lo que es de otras pestañas.
  lineas = lineas.filter((l, i) => !(i < 3 && /^rese[ñn]a del libro:?$/i.test(l)));
  if (lineas.length > 1 && !/[.!?:]$/.test(lineas[0]) && lineas[0].length < 120) lineas.shift();
  lineas = lineas.filter((l) => !/^rese[ñn]a del libro:?$/i.test(l) && !/^(isbn|especialidad|referencia de producto|fecha de lanzamiento|idioma|cubierta|título original)\s*:/i.test(l));
  return { resena: lineas.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(), ficha: ficha };
}

function aTexto(h) {
  return entidades(
    h.replace(/<!--[\s\S]*?-->/g, "")
     .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
     .replace(/<br\s*\/?>/gi, "\n")
     .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, "\n")
     .replace(/<li[^>]*>/gi, "\n")
     .replace(/<[^>]+>/g, "")
  ).replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n");
}
function entidades(s) {
  const mapa = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", iquest: "¿", iexcl: "¡",
    laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", ndash: "–", mdash: "—", deg: "°", ordm: "º", ordf: "ª" };
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (t, c) => {
    if (c[0] === "#") { const n = c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : t; }
    return mapa[c] !== undefined ? mapa[c] : t;
  });
}
function minus(s) { return String(s || "").trim().toLowerCase(); }
function limpiarTexto(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
// Siempre en centímetros: "10.5 cm x 15.8 cm" → "10,5 x 15,8" · "150 x 228 x 25 mm" → "15 x 22,8 x 2,5".
// Si dice "mm", o los números son demasiado grandes para ser centímetros (más de 60), se dividen entre 10.
function dimensiones(s) {
  const texto = String(s || "");
  const nums = texto.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 2) return "";
  let valores = nums.slice(0, 3).map((n) => parseFloat(n.replace(",", ".")));
  const enMm = /mm|mil[ií]metro/i.test(texto) || (!/cm|cent[ií]metro/i.test(texto) && Math.max(...valores) > 60);
  if (enMm) valores = valores.map((v) => v / 10);
  return valores.map((v) => String(Math.round(v * 10) / 10).replace(".", ",")).join(" x ");
}

export function normalizarISBN(valor) {
  let s = String(valor || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (s.length === 14 && s[0] === "0") s = s.slice(1);
  if (s.length === 10) {
    const base = "978" + s.slice(0, 9);
    let suma = 0;
    for (let i = 0; i < 12; i++) suma += Number(base[i]) * (i % 2 ? 3 : 1);
    return base + String((10 - (suma % 10)) % 10);
  }
  return /^\d{13}$/.test(s) ? s : "";
}
