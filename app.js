import { db, configurado } from "./firebase.js";
import { collection, doc, query, where, getDoc, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoPrecio, sinTildes, escapar, enlaceWhatsApp, codigoPedido, portadaVaciaHTML, enlaceLibro, buscarPorSlug, precioEfectivo, vigente, fechaCorta } from "./util.js";

var T = window.TIENDA;
var libros = [];          // [{id, nombre, autor, categoria, precio, stock, descripcion, imagen}]
var ordenCategorias = []; // nombres en el orden definido en el panel
var categoriaActiva = "Todas";
var subcategoriaActiva = "";
var subsPorCategoria = {};  // { categoría: [subcategorías en orden] }
var vendidos = {};          // { idLibro: unidades vendidas (90 días) }
var campanas = [];          // campañas de descuento (por categoría)
var OFERTAS = "__ofertas";  // categoría especial para ver solo las ofertas
function precioDe(l) { return precioEfectivo(l, campanas); }
function enOferta(l) { return precioDe(l).descuento > 0; }
function precioHTML(l, clase) {
  var p = precioDe(l);
  if (!p.descuento) return '<span class="' + clase + '">' + formatoPrecio(p.precio) + "</span>";
  return '<span class="' + clase + ' precio--oferta">' +
    '<span class="precio__antes">' + formatoPrecio(p.original) + "</span>" +
    '<span class="precio__ahora">' + formatoPrecio(p.precio) + "</span></span>";
}
function etiquetaOfertaHTML(l) {
  var p = precioDe(l);
  return p.descuento ? '<span class="etiqueta-oferta">-' + p.descuento + "%</span>" : "";
}
var ajustesSecciones = {};  // qué carruseles mostrar (lo decide el panel)
var carrito = cargarCarrito(); // { idLibro: cantidad }

var $ = function (id) { return document.getElementById(id); };
var $grilla = $("grilla"), $estado = $("estado"), $buscar = $("buscar"), $categorias = $("categorias");
var $cajon = $("cajon");

$("anio").textContent = new Date().getFullYear();
$("nombre-tienda").textContent = T.nombre;
$("whatsapp-general").href = enlaceWhatsApp(T.whatsapp, T.mensajeGeneral);

// ---------- Carrito en el navegador ----------
function cargarCarrito() {
  try { return JSON.parse(localStorage.getItem("psb-carrito") || "{}") || {}; } catch (e) { return {}; }
}
function guardarCarrito() {
  try { localStorage.setItem("psb-carrito", JSON.stringify(carrito)); } catch (e) {}
}
function libroPorId(id) { return libros.find(function (l) { return l.id === id; }); }
function itemsCarrito() {
  return Object.keys(carrito).map(function (id) {
    var l = libroPorId(id);
    return l ? { libro: l, cantidad: carrito[id] } : null;
  }).filter(Boolean);
}
function limpiarCarrito() {
  // Quita libros que ya no existen y ajusta cantidades al stock disponible.
  Object.keys(carrito).forEach(function (id) {
    var l = libroPorId(id);
    if (!l || l.stock <= 0) delete carrito[id];
    else if (carrito[id] > l.stock) carrito[id] = l.stock;
  });
  guardarCarrito();
}
function cantidadTotal() {
  return itemsCarrito().reduce(function (s, it) { return s + it.cantidad; }, 0);
}
function totalCarrito() {
  return itemsCarrito().reduce(function (s, it) { return s + it.cantidad * precioDe(it.libro).precio; }, 0);
}

function cambiarCantidad(id, delta) {
  fijarCantidad(id, (carrito[id] || 0) + delta, delta > 0);
}

// Pone una cantidad exacta de un libro en el pedido (0 lo quita). Nunca pasa del stock disponible.
function fijarCantidad(id, cantidad, sumando) {
  var l = libroPorId(id);
  if (!l) return;
  var nueva = Math.max(0, Math.floor(Number(cantidad) || 0));
  if (nueva > l.stock) {
    avisar("Solo hay " + l.stock + " disponible" + (l.stock === 1 ? "" : "s"));
    if (sumando && (carrito[id] || 0) >= l.stock) return;
    nueva = l.stock;
  }
  if (nueva === 0) delete carrito[id];
  else carrito[id] = nueva;
  guardarCarrito();
  pintarContador();
  actualizarAcciones(id);
  pintarCarrito();
  if (libroEnDetalle && $detalle.open) pintarDetalle();
}

// Cambia solo los botones de "Agregar" de un libro (o de todos), sin redibujar la página,
// para que los carruseles no pierdan su posición.
function actualizarAcciones(id) {
  document.querySelectorAll(id ? '[data-accion="' + id + '"]' : "[data-accion]").forEach(function (el) {
    var l = libroPorId(el.dataset.accion);
    if (l) el.innerHTML = accionHTML(l, false);
  });
}

function avisar(texto) {
  var a = $("aviso");
  a.textContent = texto;
  a.classList.add("aviso--visible");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(function () { a.classList.remove("aviso--visible"); }, 2200);
}

// ---------- Fotos: se cargan solo cuando el libro aparece en pantalla ----------
var fotos = {}, pidiendoFoto = {};
function cargarFoto(id) {
  var l = libroPorId(id);
  if (l && l.imagen) return Promise.resolve(l.imagen);           // formato anterior
  if (!l || !l.foto) return Promise.resolve("");
  if (fotos[id] !== undefined) return Promise.resolve(fotos[id]);
  if (!pidiendoFoto[id]) {
    pidiendoFoto[id] = getDoc(doc(db, "portadas", id)).then(function (s) {
      fotos[id] = s.exists() ? (s.data().imagen || "") : "";
      delete pidiendoFoto[id];
      return fotos[id];
    }).catch(function () { delete pidiendoFoto[id]; return ""; });
  }
  return pidiendoFoto[id];
}
function fotoHTML(l, alt) {
  var url = l.imagen || fotos[l.id];
  if (url) return '<img src="' + escapar(url) + '" alt="' + escapar(alt || "") + '">';
  if (l.foto) return '<span class="foto-perezosa" data-portada="' + l.id + '" data-alt="' + escapar(alt || "") + '">' + portadaVaciaHTML(l.nombre) + "</span>";
  return portadaVaciaHTML(l.nombre);
}
function ponerFoto(el) {
  cargarFoto(el.dataset.portada).then(function (url) {
    if (url) el.innerHTML = '<img src="' + escapar(url) + '" alt="' + escapar(el.dataset.alt || "") + '">';
  });
}
var observadorFotos = "IntersectionObserver" in window ? new IntersectionObserver(function (entradas) {
  entradas.forEach(function (en) {
    if (!en.isIntersecting) return;
    observadorFotos.unobserve(en.target);
    ponerFoto(en.target);
  });
}, { rootMargin: "400px" }) : null;
function observarFotos(contenedor) {
  contenedor.querySelectorAll("[data-portada]").forEach(function (el) {
    if (observadorFotos) observadorFotos.observe(el); else ponerFoto(el);
  });
}

// ---------- Pintar catálogo ----------
function pintarContador() {
  var n = cantidadTotal();
  $("contador").textContent = n;
  $("contador").hidden = n === 0;
}

function pintarCategorias() {
  var cats = ["Todas"];
  ordenCategorias.forEach(function (c) {
    if (libros.some(function (l) { return l.categoria === c; })) cats.push(c);
  });
  libros.forEach(function (l) { if (l.categoria && cats.indexOf(l.categoria) === -1) cats.push(l.categoria); });
  if (libros.some(enOferta)) cats.splice(1, 0, OFERTAS);
  else if (categoriaActiva === OFERTAS) categoriaActiva = "Todas";
  $categorias.innerHTML = "";
  if (cats.length <= 1) return;
  cats.forEach(function (c) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (c === categoriaActiva ? " chip--activa" : "") + (c === OFERTAS ? " chip--oferta" : "");
    b.setAttribute("aria-pressed", c === categoriaActiva);
    b.textContent = c === OFERTAS ? "🏷️ Ofertas" : c;
    b.addEventListener("click", function () { elegirCategoria(c); });
    $categorias.appendChild(b);
  });
  pintarSubcategorias();
}

var verTodo = false;        // true = lista completa sin carruseles
var FILAS_INICIO = 3;      // filas de "Todos los libros" en la página principal

function elegirCategoria(c, desplazar) {
  categoriaActiva = c; subcategoriaActiva = ""; verTodo = false;
  pintarCategorias(); pintarLibros();
  if (desplazar) document.querySelector(".controles").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Segunda fila de botones con las subcategorías de la categoría elegida.
function pintarSubcategorias() {
  var $s = $("subcategorias");
  $s.innerHTML = "";
  if (categoriaActiva === "Todas") { $s.hidden = true; return; }
  var enUso = libros.filter(function (l) { return l.categoria === categoriaActiva && l.subcategoria; })
    .map(function (l) { return l.subcategoria; });
  var subs = (subsPorCategoria[categoriaActiva] || []).filter(function (s) { return enUso.indexOf(s) !== -1; });
  enUso.forEach(function (s) { if (subs.indexOf(s) === -1) subs.push(s); });
  if (!subs.length) { $s.hidden = true; return; }
  $s.hidden = false;
  [""].concat(subs).forEach(function (s) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip chip--sub" + (s === subcategoriaActiva ? " chip--activa" : "");
    b.setAttribute("aria-pressed", s === subcategoriaActiva);
    b.textContent = s || "Todo en " + categoriaActiva;
    b.addEventListener("click", function () { subcategoriaActiva = s; pintarSubcategorias(); pintarLibros(); });
    $s.appendChild(b);
  });
}

function selectorHTML(id, valor, max, attrs) {
  return '<div class="cantidad cantidad--editable" role="group" aria-label="Cantidad">' +
    '<button type="button" ' + attrs.menos + ' aria-label="Quitar uno">−</button>' +
    '<input type="number" inputmode="numeric" min="1" max="' + max + '" value="' + valor + '" ' + attrs.input + ' aria-label="Cantidad">' +
    '<button type="button" ' + attrs.mas + ' aria-label="Agregar uno">+</button>' +
    "</div>";
}
function accionHTML(l, grande) {
  var enPedido = carrito[l.id] || 0;
  if (l.stock <= 0) return '<span class="boton boton--deshabilitado">Agotado</span>';
  if (grande) {
    // En la ficha: se puede escribir la cantidad.
    if (enPedido) return '<div class="ficha-cantidad">' +
      selectorHTML(l.id, enPedido, l.stock, { menos: 'data-menos="' + l.id + '"', mas: 'data-mas="' + l.id + '"', input: 'data-cantidad="' + l.id + '"' }) +
      '<p class="ficha-cantidad__nota">En tu pedido · ' + formatoPrecio(enPedido * precioDe(l).precio) + "</p></div>";
    return '<div class="ficha-cantidad ficha-cantidad--nueva">' +
      selectorHTML(l.id, 1, l.stock, { menos: 'data-sel="-1"', mas: 'data-sel="1"', input: 'id="cantidad-ficha"' }) +
      '<button type="button" class="boton boton--acento" data-agregar-n="' + l.id + '">Agregar al pedido</button></div>';
  }
  if (enPedido) return '<div class="cantidad" role="group" aria-label="Cantidad en el pedido">' +
    '<button type="button" data-menos="' + l.id + '" aria-label="Quitar uno">−</button>' +
    "<span>" + enPedido + " en pedido</span>" +
    '<button type="button" data-mas="' + l.id + '" aria-label="Agregar uno">+</button>' +
    "</div>";
  return '<button type="button" class="boton boton--acento" data-mas="' + l.id + '">' +
    (grande ? "Agregar al pedido" : '<span>Agregar<span class="solo-escritorio"> al pedido</span></span>') + "</button>";
}

// ---------- Ficha del libro ----------
var $detalle = $("detalle"), libroEnDetalle = null;
function pintarDetalle() {
  var l = libroPorId(libroEnDetalle);
  if (!l) return;
  var agotado = l.stock <= 0;
  $("detalle-contenido").innerHTML =
    '<div class="detalle__lado">' +
      galeriaHTML(l, agotado) +
      datosHTML(l, "detalle__datos--lado") +
    "</div>" +
    '<div class="detalle__info">' +
      (l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria + (l.subcategoria ? " › " + l.subcategoria : "")) + "</p>" : "") +
      '<h2 class="detalle__titulo">' + escapar(l.nombre) + "</h2>" +
      (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
      '<p class="detalle__precio">' + precioHTML(l, "detalle__monto") + etiquetaOfertaHTML(l) +
        (!agotado && l.stock <= 3 ? ' <span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "") + "</p>" +
      (function () {
        var p = precioDe(l);
        if (!p.descuento) return "";
        return '<p class="detalle__oferta">Ahorras ' + formatoPrecio(p.original - p.precio) +
          (p.campana ? " · " + escapar(p.campana) : "") + (p.hasta ? " · Hasta el " + fechaCorta(p.hasta) : "") + "</p>";
      })() +
      (l.descripcion ? '<p class="detalle__descripcion">' + escapar(l.descripcionCompleta || l.descripcion) + "</p>" : "") +
      datosHTML(l, "detalle__datos--info") +
      '<div class="detalle__accion">' + accionHTML(l, true) +
        '<button type="button" class="boton boton--contorno boton--compartir" data-compartir="' + l.id + '">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>' +
          "Compartir</button>" +
      "</div>" +
    "</div>";
  observarFotos($("detalle-contenido"));
  prepararGaleria(l);
  // Si la descripción es larga, se trae completa solo al abrir la ficha.
  if (l.larga && !l.descripcionCompleta && !l.pidiendoDescripcion) {
    l.pidiendoDescripcion = true;
    getDoc(doc(db, "libros", l.id)).then(function (s) {
      if (s.exists()) l.descripcionCompleta = s.data().descripcion || l.descripcion;
      if (libroEnDetalle === l.id && $detalle.open) pintarDetalle();
    }).catch(function () {}).finally(function () { l.pidiendoDescripcion = false; });
  }
}
var TITULO_BASE = document.title;
var BASE_TIENDA = location.href.replace(/[?#].*$/, "");
// ---------- Galería de la ficha: portada + fotos del interior ----------
var fotosInteriores = {};   // "idLibro_n" -> dataURL
var galeriaIndice = 0, galeriaLibro = null;
function galeriaHTML(l, agotado) {
  var n = l.interiores || 0;
  var slides = ['<div class="galeria__slide galeria__slide--portada">' + fotoHTML(l, l.nombre) + "</div>"];
  for (var k = 1; k <= n; k++) {
    var clave = l.id + "_" + k, url = fotosInteriores[clave];
    slides.push('<div class="galeria__slide galeria__slide--interior" data-interior="' + clave + '">' +
      (url ? '<img src="' + url + '" alt="Interior ' + k + ' de ' + escapar(l.nombre) + '">' : '<span class="galeria__cargando">Cargando…</span>') + "</div>");
  }
  var html = '<div class="detalle__foto galeria' + (n ? " galeria--varias" : "") + '">' +
    '<div class="galeria__pista">' + slides.join("") + "</div>" +
    (agotado ? '<span class="etiqueta">Agotado</span>' : "") +
    (n ? '<button type="button" class="galeria__flecha galeria__flecha--izq" data-galeria="-1" aria-label="Foto anterior">‹</button>' +
         '<button type="button" class="galeria__flecha galeria__flecha--der" data-galeria="1" aria-label="Foto siguiente">›</button>' +
         '<button type="button" class="galeria__ampliar" data-ampliar aria-label="Ver foto en grande">' +
           '<svg class="icono-ampliar" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6M10.5 7.8v5.4M7.8 10.5h5.4"/></svg>' +
           '<svg class="icono-cerrar" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
         "</button>" : "") +
    "</div>";
  if (n) {
    html += '<div class="galeria__miniaturas">' +
      '<button type="button" class="miniatura" data-ir="0" aria-label="Portada">' + fotoHTML(l, "") + "</button>";
    for (var j = 1; j <= n; j++) {
      var c2 = l.id + "_" + j;
      html += '<button type="button" class="miniatura" data-ir="' + j + '" aria-label="Interior ' + j + '">' +
        (fotosInteriores[c2] ? '<img src="' + fotosInteriores[c2] + '" alt="">' : "") + "</button>";
    }
    html += '<span class="miniaturas__ayuda">Fotos del interior</span></div>';
  }
  return html;
}
function prepararGaleria(l) {
  if (galeriaLibro !== l.id) { galeriaLibro = l.id; galeriaIndice = 0; }
  var pista = document.querySelector("#detalle-contenido .galeria__pista");
  if (!pista) return;
  // Volver a la foto que el cliente estaba viendo (por si la ficha se redibujó).
  pista.scrollLeft = galeriaIndice * pista.clientWidth;
  marcarMiniatura();
  pista.addEventListener("scroll", function () {
    var i = Math.round(pista.scrollLeft / Math.max(1, pista.clientWidth));
    if (i !== galeriaIndice) { galeriaIndice = i; marcarMiniatura(); }
  }, { passive: true });
  // Las fotos del interior se descargan solo al abrir la ficha.
  for (var k = 1; k <= (l.interiores || 0); k++) cargarInterior(l, l.id + "_" + k);
}
function cargarInterior(l, clave) {
  if (fotosInteriores[clave]) return;
  getDoc(doc(db, "interiores", clave)).then(function (s) {
    if (!s.exists()) return;
    fotosInteriores[clave] = s.data().imagen;
    document.querySelectorAll('#detalle-contenido [data-interior="' + clave + '"]').forEach(function (el) {
      el.innerHTML = '<img src="' + fotosInteriores[clave] + '" alt="Interior de ' + escapar(l.nombre) + '">';
    });
    var k = clave.slice(clave.lastIndexOf("_") + 1);
    var mini = document.querySelector('#detalle-contenido .miniatura[data-ir="' + k + '"]');
    if (mini) mini.innerHTML = '<img src="' + fotosInteriores[clave] + '" alt="">';
  }).catch(function () {});
}
function marcarMiniatura() {
  document.querySelectorAll("#detalle-contenido .miniatura").forEach(function (m) {
    m.classList.toggle("miniatura--activa", Number(m.dataset.ir) === galeriaIndice);
  });
  var g = document.querySelector("#detalle-contenido .galeria");
  if (!g) return;
  var total = g.querySelectorAll(".galeria__slide").length;
  var izq = g.querySelector('[data-galeria="-1"]'), der = g.querySelector('[data-galeria="1"]');
  if (izq) izq.disabled = galeriaIndice <= 0;
  if (der) der.disabled = galeriaIndice >= total - 1;
}
function irAFoto(i) {
  var pista = document.querySelector("#detalle-contenido .galeria__pista");
  if (!pista) return;
  var total = pista.children.length;
  galeriaIndice = Math.max(0, Math.min(total - 1, i));
  pista.scrollTo({ left: galeriaIndice * pista.clientWidth, behavior: "smooth" });
  marcarMiniatura();
}

// Ficha técnica del libro: solo se muestran los datos que tenga.
function textoPeso(g) {
  if (!g) return "";
  return g >= 1000 ? (g / 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 }) + " kg" : g + " g";
}
function datosHTML(l, clase) {
  var filas = [
    ["Editorial", l.editorial],
    ["ISBN", l.isbn],
    ["Páginas", l.paginas ? Number(l.paginas).toLocaleString("es-CO") : ""],
    ["Cubierta", l.cubierta],
    ["Dimensiones", l.dimensiones ? l.dimensiones + " cm" : ""],
    ["Peso", textoPeso(l.peso)]
  ].filter(function (f) { return f[1]; });
  if (!filas.length) return "";
  return '<dl class="detalle__datos ' + clase + '">' + filas.map(function (f) {
    return "<div><dt>" + f[0] + "</dt><dd>" + escapar(f[1]) + "</dd></div>";
  }).join("") + "</dl>";
}

function abrirDetalle(id) {
  libroEnDetalle = id;
  pintarDetalle();
  if (!$detalle.open) { if ($detalle.showModal) $detalle.showModal(); else $detalle.setAttribute("open", ""); }
  var l = libroPorId(id);
  // La dirección del navegador muestra el enlace propio del libro mientras la ficha está abierta.
  if (l) {
    try { history.replaceState(null, "", enlaceLibro(BASE_TIENDA, l)); } catch (e) {}
    document.title = l.nombre + " · " + TITULO_BASE;
  }
}
$detalle.addEventListener("close", function () {
  libroEnDetalle = null;
  try { history.replaceState(null, "", BASE_TIENDA); } catch (e) {}
  document.title = TITULO_BASE;
});

function compartirLibro(l) {
  var url = enlaceLibro(BASE_TIENDA, l);
  var texto = l.nombre + (l.autor ? " — " + l.autor : "") + (l.precio ? " · " + formatoPrecio(precioDe(l).precio) + (enOferta(l) ? " (oferta -" + precioDe(l).descuento + "%)" : "") : "");
  if (navigator.share) {
    navigator.share({ title: l.nombre, text: texto, url: url }).catch(function () {});
    return;
  }
  copiarTexto(url).then(function () { avisar("Enlace copiado. Pégalo en WhatsApp o en tus redes."); })
    .catch(function () { window.prompt("Copia este enlace:", url); });
}
function copiarTexto(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  return new Promise(function (ok, mal) {
    var a = document.createElement("textarea");
    a.value = t; a.style.position = "fixed"; a.style.opacity = "0";
    document.body.appendChild(a); a.select();
    try { document.execCommand("copy") ? ok() : mal(); } catch (e) { mal(e); }
    a.remove();
  });
}
$detalle.addEventListener("click", function (e) {
  if (e.target.closest("[data-cerrar]") || e.target === $detalle) { $detalle.close(); return; }
  var ir = e.target.closest("[data-ir]");
  if (ir) { irAFoto(Number(ir.dataset.ir)); return; }
  var gf = e.target.closest("[data-galeria]");
  if (gf) { irAFoto(galeriaIndice + Number(gf.dataset.galeria)); return; }
  var g = e.target.closest(".galeria");
  if (g && (e.target.closest("[data-ampliar]") || (g.classList.contains("galeria--ampliada") && !e.target.closest("button")) ||
      (e.target.closest(".galeria__slide--interior img")))) {
    g.classList.toggle("galeria--ampliada");
    requestAnimationFrame(function () { irAFoto(galeriaIndice); });
    return;
  }
  var sel = e.target.closest("[data-sel]");
  if (sel) {
    var campo = $("cantidad-ficha"), lb = libroPorId(libroEnDetalle);
    var v = Math.max(1, (Number(campo.value) || 1) + Number(sel.dataset.sel));
    if (lb && v > lb.stock) { v = lb.stock; avisar("Solo hay " + lb.stock + " disponible" + (lb.stock === 1 ? "" : "s")); }
    campo.value = v;
    return;
  }
  var agregarN = e.target.closest("[data-agregar-n]");
  if (agregarN) {
    var cuantos = Math.max(1, Math.floor(Number($("cantidad-ficha").value) || 1));
    fijarCantidad(agregarN.dataset.agregarN, cuantos);
    if (carrito[agregarN.dataset.agregarN]) avisar(carrito[agregarN.dataset.agregarN] === 1 ? "Agregado a tu pedido" : carrito[agregarN.dataset.agregarN] + " agregados a tu pedido");
    return;
  }
  var comp = e.target.closest("[data-compartir]");
  if (comp) { var lc = libroPorId(comp.dataset.compartir); if (lc) compartirLibro(lc); return; }
  var mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
  if (mas) {
    var nuevo = !carrito[mas.dataset.mas];
    cambiarCantidad(mas.dataset.mas, 1);
    if (nuevo && carrito[mas.dataset.mas]) avisar("Agregado a tu pedido");
  }
  if (menos) cambiarCantidad(menos.dataset.menos, -1);
});

function pintarLibros() {
  var q = sinTildes($buscar.value.trim());
  var visibles = libros.filter(function (l) {
    var okCat = (categoriaActiva === "Todas" || l.categoria === categoriaActiva || (categoriaActiva === OFERTAS && enOferta(l))) &&
      (!subcategoriaActiva || l.subcategoria === subcategoriaActiva);
    var texto = sinTildes([l.nombre, l.autor, l.categoria, l.subcategoria, l.editorial, l.isbn, String(l.isbn).replace(/[^0-9Xx]/g, "")].join(" "));
    var qISBN = /^[\d\s-]{6,}x?$/.test(q) ? q.replace(/[\s-]/g, "") : "";
    var okBusqueda = !q || texto.indexOf(q) !== -1 || (qISBN && texto.indexOf(qISBN) !== -1);
    return okCat && okBusqueda;
  });

  var inicio = categoriaActiva === "Todas" && !q && !verTodo;
  pintarSecciones(inicio);
  // En la página principal (con carruseles) se muestran solo unas filas de "Todos los libros".
  var recortar = inicio && libros.length >= 6;
  var mostrar = recortar ? visibles.slice(0, FILAS_INICIO * columnasGrilla()) : visibles;
  $("ver-todo").hidden = !(recortar && mostrar.length < visibles.length);
  $("ver-todo").textContent = "Ver todos los libros (" + visibles.length + ") →";
  $("volver-inicio").hidden = !(verTodo && categoriaActiva === "Todas" && !q);
  $("titulo-grilla").hidden = !libros.length;
  $("titulo-grilla-texto").textContent = q ? "Resultados de la búsqueda"
    : inicio ? "Todos los libros"
    : categoriaActiva === OFERTAS ? "Ofertas"
    : categoriaActiva + (subcategoriaActiva ? " › " + subcategoriaActiva : "");
  $("titulo-grilla-cuenta").textContent = visibles.length + " libro" + (visibles.length === 1 ? "" : "s");

  $estado.textContent = visibles.length ? "" : (libros.length ? "No encontramos libros con esa búsqueda." : "Pronto agregaremos libros al catálogo.");
  $grilla.innerHTML = mostrar.map(function (l) { return tarjetaHTML(l, false); }).join("");
  $grilla.dataset.columnas = columnasGrilla();
  observarFotos($grilla);
}

// Cuántos libros caben por fila en la cuadrícula según el ancho de la pantalla.
function columnasGrilla() {
  var cols = getComputedStyle($grilla).gridTemplateColumns.split(" ").filter(Boolean).length;
  return cols || 4;
}
window.addEventListener("resize", function () {
  if (!$("ver-todo").hidden && String(columnasGrilla()) !== $grilla.dataset.columnas) pintarLibros();
});

$("ver-todo").addEventListener("click", function () {
  verTodo = true;
  pintarLibros();
  document.querySelector(".controles").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("volver-inicio").addEventListener("click", function () {
  verTodo = false;
  pintarLibros();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function tarjetaHTML(l, compacta) {
  var agotado = l.stock <= 0;
  var stockTexto = (!agotado && l.stock <= 3) ? '<span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "";
  return '<article class="tarjeta' + (agotado ? " tarjeta--agotada" : "") + (compacta ? " tarjeta--compacta" : "") + '">' +
    '<button type="button" class="tarjeta__foto" data-ver="' + l.id + '" aria-label="Ver detalles de ' + escapar(l.nombre) + '">' + fotoHTML(l, l.nombre) + (agotado ? '<span class="etiqueta">Agotado</span>' : "") + etiquetaOfertaHTML(l) + "</button>" +
    '<div class="tarjeta__cuerpo">' +
      (!compacta && l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria) + "</p>" : "") +
      '<h3 class="tarjeta__titulo"><button type="button" class="enlace-titulo" data-ver="' + l.id + '">' + escapar(l.nombre) + "</button></h3>" +
      (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
      (!compacta && l.descripcion ? '<p class="tarjeta__descripcion">' + escapar(l.descripcion) + "</p>" +
        '<button type="button" class="ver-mas" data-ver="' + l.id + '">Ver más</button>' : "") +
      '<div class="tarjeta__pie">' + precioHTML(l, "tarjeta__precio") + stockTexto + "</div>" +
      '<div class="tarjeta__accion" data-accion="' + l.id + '">' + accionHTML(l, false) + "</div>" +
    "</div></article>";
}

// ---------- Secciones con carrusel (solo en la página de inicio) ----------
var MAX_CARRUSEL = 12;
var seccionesPintadas = false;
function disponiblesPrimero(lista) {
  return lista.slice().sort(function (a, b) { return (a.stock <= 0) - (b.stock <= 0); });
}
function activa(clave) { return ajustesSecciones[clave] !== false; }
function armarSecciones() {
  var s = [];
  var destacados = disponiblesPrimero(libros.filter(function (l) { return l.destacado; }));
  if (activa("destacados") && destacados.length) s.push({ titulo: "Destacados", libros: destacados });
  var ofertas = libros.filter(enOferta).sort(function (a, b) { return precioDe(b).descuento - precioDe(a).descuento; });
  if (activa("ofertas") && ofertas.length) s.push({ titulo: "🏷️ Ofertas", categoria: OFERTAS, libros: disponiblesPrimero(ofertas) });
  var masVendidos = libros.filter(function (l) { return vendidos[l.id]; })
    .sort(function (a, b) { return vendidos[b.id] - vendidos[a.id]; });
  if (activa("vendidos") && masVendidos.length >= 3) s.push({ titulo: "Más vendidos", libros: disponiblesPrimero(masVendidos) });
  var conFecha = libros.filter(function (l) { return l.creado; });
  if (activa("novedades") && conFecha.length >= 4) {
    s.push({ titulo: "Novedades", libros: conFecha.slice().sort(function (a, b) { return b.creado - a.creado; }) });
  }
  var cats = ordenCategorias.slice();
  libros.forEach(function (l) { if (l.categoria && cats.indexOf(l.categoria) === -1) cats.push(l.categoria); });
  var porCat = (ajustesSecciones.categorias || {});
  cats.forEach(function (c) {
    if (porCat[c] === false) return;
    var deCat = disponiblesPrimero(libros.filter(function (l) { return l.categoria === c; }));
    if (deCat.length >= 2) s.push({ titulo: c, categoria: c, libros: deCat });
  });
  return s;
}
function pintarSecciones(mostrar) {
  var $s = $("secciones");
  $s.hidden = !mostrar;
  if (!mostrar || seccionesPintadas) return;
  seccionesPintadas = true;
  var secciones = armarSecciones();
  // Con muy pocos libros no vale la pena: se ve solo la cuadrícula.
  if (libros.length < 6) { $s.innerHTML = ""; return; }
  $s.innerHTML = secciones.map(function (sec, i) {
    var lista = sec.libros.slice(0, MAX_CARRUSEL);
    var hayMas = sec.categoria && sec.libros.length > 0;
    return '<section class="seccion" aria-labelledby="sec-' + i + '">' +
      '<div class="seccion__cabecera">' +
        '<h2 id="sec-' + i + '">' + escapar(sec.titulo) + "</h2>" +
        (hayMas ? '<button type="button" class="seccion__ver" data-ver-categoria="' + escapar(sec.categoria) + '">Ver todos (' + sec.libros.length + ") →</button>" : "") +
        '<div class="seccion__flechas">' +
          '<button type="button" class="flecha" data-flecha="-1" aria-label="Anteriores">‹</button>' +
          '<button type="button" class="flecha" data-flecha="1" aria-label="Siguientes">›</button>' +
        "</div>" +
      "</div>" +
      '<div class="carrusel" tabindex="0">' + lista.map(function (l) { return tarjetaHTML(l, true); }).join("") + "</div>" +
    "</section>";
  }).join("");
  $s.querySelectorAll(".carrusel").forEach(function (c) {
    actualizarFlechas(c);
    c.addEventListener("scroll", function () { actualizarFlechas(c); }, { passive: true });
  });
  observarFotos($s);
}
function actualizarFlechas(c) {
  var sec = c.closest(".seccion");
  var fin = c.scrollWidth - c.clientWidth - 4;
  sec.querySelector('[data-flecha="-1"]').disabled = c.scrollLeft <= 4;
  sec.querySelector('[data-flecha="1"]').disabled = c.scrollLeft >= fin;
  sec.classList.toggle("seccion--sin-flechas", fin <= 4);
}
window.addEventListener("resize", function () { document.querySelectorAll(".carrusel").forEach(actualizarFlechas); });

$("secciones").addEventListener("click", function (e) {
  var f = e.target.closest("[data-flecha]");
  if (f) {
    var c = f.closest(".seccion").querySelector(".carrusel");
    c.scrollBy({ left: parseInt(f.dataset.flecha, 10) * c.clientWidth * 0.9, behavior: "smooth" });
    return;
  }
  var vc = e.target.closest("[data-ver-categoria]");
  if (vc) { elegirCategoria(vc.dataset.verCategoria, true); return; }
  manejarClicTarjeta(e);
});

$grilla.addEventListener("click", manejarClicTarjeta);
function manejarClicTarjeta(e) {
  var ver = e.target.closest("[data-ver]");
  if (ver) { abrirDetalle(ver.dataset.ver); return; }
  var mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
  if (mas) {
    var nuevo = !carrito[mas.dataset.mas];
    cambiarCantidad(mas.dataset.mas, 1);
    if (nuevo && carrito[mas.dataset.mas]) avisar("Agregado a tu pedido");
  }
  if (menos) cambiarCantidad(menos.dataset.menos, -1);
}
$buscar.addEventListener("input", pintarLibros);

// ---------- Pedido ----------
function pintarCarrito() {
  var items = itemsCarrito();
  $("pedido-vacio").hidden = items.length > 0;
  $("form-pedido").hidden = items.length === 0;
  $("total-pedido").textContent = formatoPrecio(totalCarrito());
  $("lista-pedido").innerHTML = items.map(function (it) {
    var l = it.libro;
    return '<li class="item-pedido">' +
      '<div class="item-pedido__foto">' + ((l.imagen || fotos[l.id]) ? '<img src="' + escapar(l.imagen || fotos[l.id]) + '" alt="">' : "") + "</div>" +
      '<div class="item-pedido__info"><strong>' + escapar(l.nombre) + "</strong>" +
        (l.autor ? "<span>" + escapar(l.autor) + "</span>" : "") +
        "<span>" + formatoPrecio(precioDe(l).precio) + " c/u" + (enOferta(l) ? ' <em class="item-pedido__oferta">oferta</em>' : "") + "</span></div>" +
      selectorHTML(l.id, it.cantidad, l.stock, { menos: 'data-menos="' + l.id + '"', mas: 'data-mas="' + l.id + '"', input: 'data-cantidad="' + l.id + '"' })
        .replace("cantidad cantidad--editable", "cantidad cantidad--chica cantidad--editable") +
      "</li>";
  }).join("");
}

// Cantidades escritas a mano (en la ficha y en "Mi pedido").
function alCambiarCantidad(e) {
  var i = e.target.closest("[data-cantidad]");
  if (i) fijarCantidad(i.dataset.cantidad, i.value === "" ? (carrito[i.dataset.cantidad] || 1) : i.value);
}
function alPresionarEnter(e) {
  if (e.key === "Enter" && e.target.matches('input[type="number"]')) { e.preventDefault(); e.target.blur(); }
}
$("lista-pedido").addEventListener("change", alCambiarCantidad);
$("lista-pedido").addEventListener("keydown", alPresionarEnter);
$detalle.addEventListener("change", function (e) {
  if (e.target.id === "cantidad-ficha") {
    var l = libroPorId(libroEnDetalle);
    var n = Math.max(1, Math.floor(Number(e.target.value) || 1));
    if (l && n > l.stock) { n = l.stock; avisar("Solo hay " + l.stock + " disponible" + (l.stock === 1 ? "" : "s")); }
    e.target.value = n;
    return;
  }
  alCambiarCantidad(e);
});
$detalle.addEventListener("keydown", alPresionarEnter);

$("lista-pedido").addEventListener("click", function (e) {
  var mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
  if (mas) cambiarCantidad(mas.dataset.mas, 1);
  if (menos) cambiarCantidad(menos.dataset.menos, -1);
});

function abrirCajon() {
  $("vista-carrito").hidden = false;
  $("vista-confirmacion").hidden = true;
  pintarCarrito();
  if ($cajon.showModal) $cajon.showModal(); else $cajon.setAttribute("open", "");
}
function cerrarCajon() { if ($cajon.close) $cajon.close(); else $cajon.removeAttribute("open"); }

$("abrir-pedido").addEventListener("click", abrirCajon);
$cajon.addEventListener("click", function (e) {
  if (e.target.closest("[data-cerrar]") || e.target === $cajon) cerrarCajon();
});

function mensajeWhatsApp(codigo, items, total, cliente) {
  var lineas = ["Hola, quiero hacer este pedido" + (codigo ? " (" + codigo + ")" : "") + ":", ""];
  items.forEach(function (it) {
    lineas.push("• " + it.cantidad + " × " + it.nombre + (it.autor ? " (" + it.autor + ")" : "") + " — " + formatoPrecio(it.precio * it.cantidad));
  });
  lineas.push("", "Total: " + formatoPrecio(total), "", "Nombre: " + cliente.nombre, "Teléfono: " + cliente.telefono);
  if (cliente.notas) lineas.push("Notas: " + cliente.notas);
  return lineas.join("\n");
}

$("form-pedido").addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target;
  var $btn = $("enviar-pedido"), $err = $("error-pedido");
  limpiarCarrito();
  var items = itemsCarrito().map(function (it) {
    return { id: it.libro.id, nombre: it.libro.nombre, autor: it.libro.autor || "", precio: precioDe(it.libro).precio, cantidad: it.cantidad };
  });
  if (!items.length) { pintarCarrito(); return; }
  var cliente = {
    nombre: f.nombre.value.trim().slice(0, 80),
    telefono: f.telefono.value.trim().slice(0, 20),
    notas: f.notas.value.trim().slice(0, 300)
  };
  var total = items.reduce(function (s, it) { return s + it.precio * it.cantidad; }, 0);

  $btn.disabled = true; $btn.textContent = "Guardando pedido…"; $err.hidden = true;

  addDoc(collection(db, "pedidos"), {
    cliente: cliente, items: items, total: total,
    estado: "pendiente", stockDescontado: false, creado: serverTimestamp()
  }).then(function (ref) {
    avisarPedido(ref.id);
    mostrarConfirmacion(codigoPedido(ref.id), items, total, cliente);
  }).catch(function () {
    // Si no se pudo guardar, igual dejamos enviar el pedido por WhatsApp.
    mostrarConfirmacion("", items, total, cliente);
  }).finally(function () {
    $btn.disabled = false; $btn.textContent = "Continuar a WhatsApp";
  });
});

function mostrarConfirmacion(codigo, items, total, cliente) {
  $("codigo-pedido").textContent = codigo;
  $("link-whatsapp").href = enlaceWhatsApp(T.whatsapp, mensajeWhatsApp(codigo, items, total, cliente));
  $("vista-carrito").hidden = true;
  $("vista-confirmacion").hidden = false;
  carrito = {}; guardarCarrito(); pintarContador(); actualizarAcciones();
  $("form-pedido").reset();
}

// ---------- Cargar catálogo ----------
// Se lee un solo documento (tienda/catalogo) que el panel mantiene al día.
// Se recuerda unos minutos en el navegador para no gastar lecturas si el cliente vuelve a entrar.
var CLAVE_CACHE = "psb-catalogo", MINUTOS_CACHE = 3;

function leerCache() {
  try {
    var c = JSON.parse(localStorage.getItem(CLAVE_CACHE) || "null");
    if (c && Date.now() - c.t < MINUTOS_CACHE * 60000) return c.datos;
  } catch (e) {}
  return null;
}
function guardarCache(datos) {
  try { localStorage.setItem(CLAVE_CACHE, JSON.stringify({ t: Date.now(), datos: datos })); } catch (e) {}
}

function normalizar(x, id) {
  return {
    id: id || x.id, nombre: x.nombre || "", autor: x.autor || "", categoria: x.categoria || "",
    subcategoria: x.subcategoria || "", editorial: x.editorial || "", isbn: x.isbn || "",
    paginas: x.paginas || 0, peso: x.peso || 0, dimensiones: x.dimensiones || "", cubierta: x.cubierta || "",
    precio: typeof x.precio === "number" ? x.precio : null,
    stock: typeof x.stock === "number" ? x.stock : 0,
    descripcion: x.resumen !== undefined ? x.resumen : (x.descripcion || ""),
    larga: !!x.larga, foto: x.foto || 0, destacado: !!x.destacado, precioOferta: x.precioOferta || 0, ofertaHasta: x.ofertaHasta || "", interiores: x.interiores || 0, creado: typeof x.creado === "number" ? x.creado : (x.creado && x.creado.toMillis ? x.creado.toMillis() : 0), imagen: x.imagen || ""
  };
}

function traerCatalogo() {
  var enCache = leerCache();
  if (enCache) return Promise.resolve(enCache);
  return getDoc(doc(db, "tienda", "catalogo")).then(function (s) {
    if (s.exists()) {
      var d = s.data();
      var datos = { libros: (d.libros || []).map(function (x) { return normalizar(x); }), categorias: d.categorias || [], subcategorias: d.subcategorias || {},
        vendidos: d.vendidos || {}, secciones: d.secciones || {}, campanas: d.campanas || [], anuncio: d.anuncio || null, banners: d.banners || [] };
      guardarCache(datos);
      return datos;
    }
    // Respaldo: si el catálogo aún no se ha publicado, se leen los libros uno por uno.
    return Promise.all([
      getDocs(query(collection(db, "libros"), where("activo", "==", true))),
      getDocs(collection(db, "categorias")).catch(function () { return null; })
    ]).then(function (res) {
      return {
        libros: res[0].docs.map(function (d) { return normalizar(d.data(), d.id); }),
        categorias: res[1] ? res[1].docs.map(function (d) { return d.data(); })
          .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); })
          .map(function (c) { return c.nombre; }) : []
      };
    });
  });
}

if (!configurado) {
  $estado.textContent = "La tienda se está configurando. Vuelve pronto.";
} else {
  traerCatalogo().then(function (datos) {
    libros = datos.libros.slice().sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
    ordenCategorias = datos.categorias || [];
    subsPorCategoria = datos.subcategorias || {};
    vendidos = datos.vendidos || {};
    campanas = datos.campanas || [];
    pintarAnuncio(datos.anuncio);
    pintarBanners(datos.banners || []);
    ajustesSecciones = datos.secciones || {};
    limpiarCarrito();
    pintarContador();
    pintarCategorias();
    pintarLibros();
    abrirDesdeEnlace();
  }).catch(function () {
    $estado.textContent = "No se pudo cargar el catálogo. Intenta recargar la página.";
  });
}

// Si la dirección trae ?libro=…, se abre directamente la ficha de ese libro.
function abrirDesdeEnlace() {
  var valor = new URLSearchParams(location.search).get("libro");
  if (!valor) return;
  var l = buscarPorSlug(libros, valor);
  if (l) abrirDetalle(l.id);
  else {
    try { history.replaceState(null, "", BASE_TIENDA); } catch (e) {}
    avisar("Ese libro ya no está disponible. Mira el resto del catálogo.");
  }
}

// ---------- Barra de anuncio (la escribe la tienda desde el panel) ----------
function pintarAnuncio(a) {
  var $a = $("anuncio");
  var cerrado = false;
  try { cerrado = sessionStorage.getItem("psb-anuncio-cerrado") === (a && a.texto); } catch (e) {}
  if (!a || !a.activo || !a.texto || !vigente(a.hasta) || cerrado) { $a.hidden = true; return; }
  $("anuncio-texto").textContent = a.texto;
  $a.hidden = false;
  $("anuncio-ver").hidden = !libros.some(enOferta);
  $("anuncio-cerrar").onclick = function () {
    $a.hidden = true;
    try { sessionStorage.setItem("psb-anuncio-cerrado", a.texto); } catch (e) {}
  };
  $("anuncio-ver").onclick = function () { elegirCategoria(OFERTAS, true); };
}

// Aviso instantáneo a Telegram (si está configurado en config.js). Solo se envía el número
// interno del pedido: el programa de avisos lo comprueba en Firebase antes de avisar.
function avisarPedido(id) {
  if (!T.avisoPedidos) return;
  try {
    fetch(T.avisoPedidos, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ id: id }), keepalive: true })
      .catch(function () {});
  } catch (e) {}
}

// ---------- Banners principales (carrusel de portada) ----------
var SEGUNDOS_BANNER = 6;
var bannerIndice = 0, bannerTimer = null, bannerPausa = false, bannersActivos = [];
var esCelular = window.matchMedia("(max-width: 640px)");

function pintarBanners(lista) {
  bannersActivos = (lista || []).filter(function (b) { return b && b.activo !== false && vigente(b.hasta, b.desde); });
  var $b = $("banners");
  if (!bannersActivos.length) { $b.hidden = true; $("portada").hidden = false; return; }
  $("portada").hidden = true;
  $b.hidden = false;
  $b.classList.toggle("banners--uno", bannersActivos.length === 1);
  $("banners-pista").innerHTML = bannersActivos.map(function (b, i) {
    var conTexto = b.titulo || b.subtitulo || b.boton;
    var accion = b.destinoTipo ? ' data-banner-ir="' + i + '"' : "";
    return '<div class="banner' + (conTexto ? "" : " banner--solo-imagen") + (b.cel ? "" : " banner--sin-cel") + (b.destinoTipo && !b.boton ? " banner--clic" : "") + '"' +
      (b.destinoTipo && !b.boton ? accion : "") + ' role="group" aria-roledescription="diapositiva" aria-label="' + (i + 1) + " de " + bannersActivos.length + '">' +
      '<div class="banner__fondo" data-banner-img="' + i + '"></div>' +
      (conTexto ? '<div class="contenedor banner__contenido">' +
        (b.titulo ? '<h2 class="banner__titulo">' + escapar(b.titulo) + "</h2>" : "") +
        (b.subtitulo ? '<p class="banner__subtitulo"><span>' + escapar(b.subtitulo) + "</span></p>" : "") +
        (b.boton && b.destinoTipo ? '<button type="button" class="banner__boton"' + accion + ">" + escapar(b.boton) + "</button>" : "") +
      "</div>" : "") +
    "</div>";
  }).join("");
  $("banners-puntos").innerHTML = bannersActivos.length > 1 ? bannersActivos.map(function (b, i) {
    return '<button type="button" class="banners__punto" data-banner-punto="' + i + '" aria-label="Ir al banner ' + (i + 1) + '"></button>';
  }).join("") : "";
  // La primera foto se carga de inmediato; las demás justo después.
  cargarFotoBanner(0).then(function () { for (var i = 1; i < bannersActivos.length; i++) cargarFotoBanner(i); });
  var pista = $("banners-pista");
  pista.addEventListener("scroll", function () {
    var i = Math.round(pista.scrollLeft / Math.max(1, pista.clientWidth));
    if (i !== bannerIndice) { bannerIndice = i; marcarPuntoBanner(); }
  }, { passive: true });
  bannerIndice = 0; marcarPuntoBanner(); programarBanner();
}

var fotosBanner = {};
function cargarFotoBanner(i) {
  var b = bannersActivos[i];
  if (!b) return Promise.resolve();
  var cel = esCelular.matches && b.cel;
  var clave = b.id + (cel ? "_cel" : "");
  var listo = fotosBanner[clave] ? Promise.resolve(fotosBanner[clave])
    : getDoc(doc(db, "banners", clave)).then(function (s) { fotosBanner[clave] = s.exists() ? s.data().imagen : ""; return fotosBanner[clave]; })
      .catch(function () { return ""; });
  return listo.then(function (url) {
    var el = document.querySelector('[data-banner-img="' + i + '"]');
    if (el && url) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add("banner__fondo--listo"); }
  });
}
esCelular.addEventListener && esCelular.addEventListener("change", function () {
  bannersActivos.forEach(function (b, i) { if (b.cel) cargarFotoBanner(i); });
});

function marcarPuntoBanner() {
  document.querySelectorAll("[data-banner-punto]").forEach(function (p) {
    var activo = Number(p.dataset.bannerPunto) === bannerIndice;
    p.classList.toggle("banners__punto--activo", activo);
    if (activo) p.setAttribute("aria-current", "true"); else p.removeAttribute("aria-current");
  });
}
function irABanner(i, suave) {
  var pista = $("banners-pista"), n = bannersActivos.length;
  if (!n) return;
  bannerIndice = (i + n) % n;
  pista.scrollTo({ left: bannerIndice * pista.clientWidth, behavior: suave === false ? "auto" : "smooth" });
  marcarPuntoBanner();
}
function programarBanner() {
  clearTimeout(bannerTimer);
  var sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (bannersActivos.length < 2 || sinMovimiento) return;
  bannerTimer = setTimeout(function () {
    if (!bannerPausa && !document.hidden) irABanner(bannerIndice + 1);
    programarBanner();
  }, SEGUNDOS_BANNER * 1000);
}
(function () {
  var $b = $("banners");
  $b.addEventListener("mouseenter", function () { bannerPausa = true; });
  $b.addEventListener("mouseleave", function () { bannerPausa = false; });
  $b.addEventListener("focusin", function () { bannerPausa = true; });
  $b.addEventListener("focusout", function () { bannerPausa = false; });
  $b.addEventListener("touchstart", function () { bannerPausa = true; programarBanner(); }, { passive: true });
  $b.addEventListener("touchend", function () { setTimeout(function () { bannerPausa = false; }, 4000); }, { passive: true });
  window.addEventListener("resize", function () { if (bannersActivos.length) irABanner(bannerIndice, false); });
  $b.addEventListener("click", function (e) {
    var f = e.target.closest("[data-banner-flecha]");
    if (f) { irABanner(bannerIndice + Number(f.dataset.bannerFlecha)); programarBanner(); return; }
    var p = e.target.closest("[data-banner-punto]");
    if (p) { irABanner(Number(p.dataset.bannerPunto)); programarBanner(); return; }
    var ir = e.target.closest("[data-banner-ir]");
    if (ir) abrirDestinoBanner(bannersActivos[Number(ir.dataset.bannerIr)]);
  });
})();

function abrirDestinoBanner(b) {
  if (!b) return;
  if (b.destinoTipo === "libro") {
    var l = libroPorId(b.destino);
    if (l) abrirDetalle(l.id); else avisar("Ese libro ya no está disponible.");
  } else if (b.destinoTipo === "categoria") {
    if (libros.some(function (l) { return l.categoria === b.destino; })) elegirCategoria(b.destino, true);
    else avisar("Pronto tendremos libros en esa categoría.");
  } else if (b.destinoTipo === "ofertas") {
    if (libros.some(enOferta)) elegirCategoria(OFERTAS, true); else avisar("No hay ofertas en este momento.");
  } else if (b.destinoTipo === "enlace" && /^https?:\/\//i.test(b.destino || "")) {
    window.open(b.destino, "_blank", "noopener");
  }
}
