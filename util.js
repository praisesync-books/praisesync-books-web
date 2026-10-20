// Utilidades compartidas por la tienda y el panel.

export function formatoPrecio(n) {
  if (n === null || n === undefined || isNaN(n)) return "";
  return "$" + Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

export function aNumero(valor) {
  if (typeof valor === "number") return isFinite(valor) ? Math.round(valor) : null;
  var limpio = String(valor || "").replace(/[^\d]/g, "");
  return limpio === "" ? null : parseInt(limpio, 10);
}

export function sinTildes(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function escapar(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

export function enlaceWhatsApp(numero, texto) {
  return "https://wa.me/" + numero + "?text=" + encodeURIComponent(texto);
}

export function codigoPedido(id) {
  return "#" + String(id || "").slice(0, 6).toUpperCase();
}

// Lee CSV con comas o punto y coma (Excel en español guarda con ;) y textos entre comillas.
export function leerCSV(texto) {
  texto = String(texto || "").replace(/^﻿/, "");
  var primeraLinea = texto.split(/\r?\n/)[0];
  var sep = (primeraLinea.split(";").length > primeraLinea.split(",").length) ? ";" : ",";
  var filas = [], fila = [], campo = "", comillas = false;

  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  if (!filas.length) return [];

  var encabezados = filas.shift().map(function (h) { return sinTildes(h.trim()); });
  return filas
    .filter(function (f) { return f.some(function (v) { return v.trim() !== ""; }); })
    .map(function (f) {
      var o = {};
      encabezados.forEach(function (h, idx) { o[h] = (f[idx] || "").trim(); });
      return o;
    });
}

// Portada simple cuando el libro no tiene foto.
export function portadaVaciaHTML(titulo) {
  return '<div class="sin-foto">' +
    '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5Z"/><path d="M12 7v6M9 10h6"/></svg>' +
    "<span>" + escapar(titulo) + "</span></div>";
}

// ---------- Enlace propio de cada libro ----------
// Formato: ?libro=nombre-del-libro-abc123 (las últimas letras son el inicio del id, así el enlace
// sigue funcionando aunque después se cambie el nombre del libro).
var LARGO_ID_ENLACE = 6;
export function slugLibro(l) {
  var base = sinTildes(l.nombre || "libro").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return (base ? base + "-" : "") + String(l.id || "").slice(0, LARGO_ID_ENLACE);
}
export function buscarPorSlug(lista, valor) {
  valor = String(valor || "").trim();
  if (!valor) return null;
  var exacto = lista.find(function (l) { return l.id === valor || slugLibro(l) === valor; });
  if (exacto) return exacto;
  var corto = valor.slice(valor.lastIndexOf("-") + 1);
  if (corto.length < 4) return null;
  var coinciden = lista.filter(function (l) { return String(l.id).indexOf(corto) === 0; });
  return coinciden.length === 1 ? coinciden[0] : null;
}
export function enlaceLibro(baseTienda, l) {
  return baseTienda.replace(/[?#].*$/, "") + "?libro=" + encodeURIComponent(slugLibro(l));
}
