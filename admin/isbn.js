// ============================================================
//  Autocompletar libros por ISBN
//  Fuentes gratuitas: Google Books y Open Library (no necesitan clave).
//  Todo se consulta desde el navegador del panel.
// ============================================================

// Deja el ISBN en 13 dígitos. Acepta guiones, espacios, ISBN-10 y el código de 14 dígitos
// que traen algunos inventarios (un 0 adelante). Devuelve "" si no es un ISBN válido.
export function normalizarISBN(valor) {
  var s = String(valor || "").toUpperCase().replace(/^ISBN[:\s-]*/, "").replace(/[^0-9X]/g, "");
  if (s.length === 14 && s[0] === "0") s = s.slice(1);
  if (s.length === 10) {
    if (!isbn10Valido(s)) return "";
    var base = "978" + s.slice(0, 9);
    return base + digitoISBN13(base);
  }
  if (s.length === 13 && /^\d{13}$/.test(s) && digitoISBN13(s.slice(0, 12)) === s[12]) return s;
  return "";
}
function digitoISBN13(doce) {
  var suma = 0;
  for (var i = 0; i < 12; i++) suma += Number(doce[i]) * (i % 2 ? 3 : 1);
  return String((10 - (suma % 10)) % 10);
}
function isbn10Valido(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  var suma = 0;
  for (var i = 0; i < 10; i++) suma += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return suma % 11 === 0;
}

function traerJSON(url) {
  var control = new AbortController();
  var t = setTimeout(function () { control.abort(); }, 12000);
  return fetch(url, { signal: control.signal })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .finally(function () { clearTimeout(t); });
}

// Quita etiquetas HTML de las descripciones de Google Books y respeta los párrafos.
function textoPlano(html) {
  if (!html) return "";
  var conSaltos = String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*/gi, "\n\n").replace(/<li[^>]*>/gi, "\n- ");
  var d = new DOMParser().parseFromString(conSaltos, "text/html");
  return (d.body.textContent || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function aHttps(u) { return u ? String(u).replace(/^http:/, "https:").replace(/&edge=curl/g, "") : ""; }

function desdeGoogle(isbn) {
  return traerJSON("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn + "&maxResults=1")
    .then(function (r) {
      var item = r && r.items && r.items[0];
      if (!item) return null;
      // La ficha completa trae mejor descripción y portadas más grandes.
      return traerJSON("https://www.googleapis.com/books/v1/volumes/" + item.id)
        .catch(function () { return item; })
        .then(function (det) {
          var v = Object.assign({}, item.volumeInfo || {}, (det && det.volumeInfo) || {});
          var img = v.imageLinks || {};
          var portadas = [];
          if (img.thumbnail || img.smallThumbnail) portadas.push("https://books.google.com/books/publisher/content/images/frontcover/" + item.id + "?fife=w600-h900&source=gbs_api");
          ["extraLarge", "large", "medium", "small", "thumbnail"].forEach(function (k) { if (img[k]) portadas.push(aHttps(img[k])); });
          var dim = v.dimensions || {};
          return {
            fuente: "Google Books",
            nombre: (v.title || "") + (v.subtitle && (v.title + v.subtitle).length < 90 ? ": " + v.subtitle : ""),
            autor: (v.authors || []).join(", "),
            editorial: v.publisher || "",
            paginas: v.pageCount || v.printedPageCount || 0,
            descripcion: textoPlano(v.description),
            dimensiones: [dim.width, dim.height, dim.thickness].filter(Boolean).map(function (x) { return String(parseFloat(x)).replace(".", ","); }).join(" x "),
            portadas: portadas
          };
        });
    })
    .catch(function () { return null; });
}

function desdeOpenLibrary(isbn) {
  return traerJSON("https://openlibrary.org/api/books?bibkeys=ISBN:" + isbn + "&format=json&jscmd=data")
    .then(function (r) {
      var v = r && r["ISBN:" + isbn];
      var portadas = [];
      if (v && v.cover) ["large", "medium"].forEach(function (k) { if (v.cover[k]) portadas.push(aHttps(v.cover[k])); });
      portadas.push("https://covers.openlibrary.org/b/isbn/" + isbn + "-L.jpg?default=false");
      if (!v) return { fuente: "", nombre: "", autor: "", editorial: "", paginas: 0, descripcion: "", dimensiones: "", portadas: portadas, vacio: true };
      return {
        fuente: "Open Library",
        nombre: (v.title || "") + (v.subtitle && (v.title + v.subtitle).length < 90 ? ": " + v.subtitle : ""),
        autor: (v.authors || []).map(function (a) { return a.name; }).join(", "),
        editorial: ((v.publishers || [])[0] || {}).name || "",
        paginas: v.number_of_pages || 0,
        descripcion: textoPlano(typeof v.description === "string" ? v.description : (v.description && v.description.value) || ""),
        dimensiones: "",
        portadas: portadas
      };
    })
    .catch(function () { return null; });
}

// Busca en las dos fuentes y junta lo mejor: Google primero, lo que falte lo completa Open Library.
export function buscarLibroPorISBN(isbn) {
  return Promise.all([desdeGoogle(isbn), desdeOpenLibrary(isbn)]).then(function (r) {
    var g = r[0], o = r[1];
    if (!g && (!o || o.vacio)) {
      return { encontrado: false, portadas: o ? o.portadas : [] };
    }
    var a = g || {}, b = (o && !o.vacio) ? o : {};
    var datos = { encontrado: true, fuentes: [] };
    ["nombre", "autor", "editorial", "paginas", "descripcion", "dimensiones"].forEach(function (k) { datos[k] = a[k] || b[k] || (k === "paginas" ? 0 : ""); });
    datos.descripcion = String(datos.descripcion).slice(0, 3000);
    datos.portadas = (a.portadas || []).concat(o ? o.portadas : []);
    if (g) datos.fuentes.push("Google Books");
    if (o && !o.vacio) datos.fuentes.push("Open Library");
    return datos;
  });
}

// Prueba las portadas en orden y devuelve la primera que se pueda descargar (como Blob).
// Las imágenes muy pequeñas (menos de 150 px de ancho) solo se usan si no hay otra mejor.
export function traerPortada(urls) {
  var pequena = null;
  var lista = (urls || []).filter(function (u, i, arr) { return u && arr.indexOf(u) === i; });
  return lista.reduce(function (p, url) {
    return p.then(function (hallada) {
      if (hallada) return hallada;
      return descargarImagen(url).then(function (r) {
        if (!r) return null;
        if (r.ancho >= 150) return r.blob;
        if (r.ancho >= 80 && !pequena) pequena = r.blob;
        return null;
      });
    });
  }, Promise.resolve(null)).then(function (b) { return b || pequena; });
}
function descargarImagen(url) {
  var control = new AbortController();
  var t = setTimeout(function () { control.abort(); }, 15000);
  return fetch(url, { signal: control.signal })
    .then(function (r) {
      if (!r.ok) return null;
      var tipo = r.headers.get("content-type") || "";
      if (tipo && tipo.indexOf("image") !== 0) return null;
      return r.blob();
    })
    .then(function (blob) {
      if (!blob || blob.size < 1500) return null;   // los "sin portada" suelen ser imágenes diminutas
      return medir(blob).then(function (m) {
        if (!m) return null;
        // Google a veces devuelve una imagen gris de "imagen no disponible" (horizontal): se descarta.
        if (m.ancho > m.alto * 1.15) return null;
        return { blob: blob, ancho: m.ancho };
      });
    })
    .catch(function () { return null; })
    .finally(function () { clearTimeout(t); });
}
function medir(blob) {
  return new Promise(function (ok) {
    var url = URL.createObjectURL(blob), img = new Image();
    img.onload = function () { ok({ ancho: img.naturalWidth, alto: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = function () { ok(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
