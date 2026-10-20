import { db, configurado } from "./firebase.js";
import { collection, doc, query, where, getDoc, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoPrecio, sinTildes, escapar, enlaceWhatsApp, codigoPedido, portadaVaciaHTML } from "./util.js";

var T = window.TIENDA;
var libros = [];          // [{id, nombre, autor, categoria, precio, stock, descripcion, imagen}]
var ordenCategorias = []; // nombres en el orden definido en el panel
var categoriaActiva = "Todas";
var subcategoriaActiva = "";
var subsPorCategoria = {};  // { categoría: [subcategorías en orden] }
var vendidos = {};          // { idLibro: unidades vendidas (90 días) }
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
  return itemsCarrito().reduce(function (s, it) { return s + it.cantidad * (it.libro.precio || 0); }, 0);
}

function cambiarCantidad(id, delta) {
  var l = libroPorId(id);
  if (!l) return;
  var nueva = (carrito[id] || 0) + delta;
  if (nueva <= 0) delete carrito[id];
  else if (nueva > l.stock) { avisar("Solo hay " + l.stock + " disponible" + (l.stock === 1 ? "" : "s")); return; }
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
  $categorias.innerHTML = "";
  if (cats.length <= 1) return;
  cats.forEach(function (c) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (c === categoriaActiva ? " chip--activa" : "");
    b.setAttribute("aria-pressed", c === categoriaActiva);
    b.textContent = c;
    b.addEventListener("click", function () { elegirCategoria(c); });
    $categorias.appendChild(b);
  });
  pintarSubcategorias();
}

function elegirCategoria(c, desplazar) {
  categoriaActiva = c; subcategoriaActiva = "";
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

function accionHTML(l, grande) {
  var enPedido = carrito[l.id] || 0;
  if (l.stock <= 0) return '<span class="boton boton--deshabilitado">Agotado</span>';
  if (enPedido) return '<div class="cantidad" role="group" aria-label="Cantidad en el pedido">' +
    '<button type="button" data-menos="' + l.id + '" aria-label="Quitar uno">−</button>' +
    "<span>" + enPedido + " en pedido</span>" +
    '<button type="button" data-mas="' + l.id + '" aria-label="Agregar uno">+</button>' +
    "</div>";
  return '<button type="button" class="boton boton--acento" data-mas="' + l.id + '">' +
    (grande ? "Agregar al pedido" : 'Agregar<span class="solo-escritorio"> al pedido</span>') + "</button>";
}

// ---------- Ficha del libro ----------
var $detalle = $("detalle"), libroEnDetalle = null;
function pintarDetalle() {
  var l = libroPorId(libroEnDetalle);
  if (!l) return;
  var agotado = l.stock <= 0;
  $("detalle-contenido").innerHTML =
    '<div class="detalle__foto">' + fotoHTML(l, l.nombre) +
      (agotado ? '<span class="etiqueta">Agotado</span>' : "") + "</div>" +
    '<div class="detalle__info">' +
      (l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria + (l.subcategoria ? " › " + l.subcategoria : "")) + "</p>" : "") +
      '<h2 class="detalle__titulo">' + escapar(l.nombre) + "</h2>" +
      (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
      '<p class="detalle__precio">' + formatoPrecio(l.precio) +
        (!agotado && l.stock <= 3 ? ' <span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "") + "</p>" +
      (l.descripcion ? '<p class="detalle__descripcion">' + escapar(l.descripcionCompleta || l.descripcion) + "</p>" : "") +
      ((l.editorial || l.isbn) ? '<dl class="detalle__datos">' +
        (l.editorial ? "<div><dt>Editorial</dt><dd>" + escapar(l.editorial) + "</dd></div>" : "") +
        (l.isbn ? "<div><dt>ISBN</dt><dd>" + escapar(l.isbn) + "</dd></div>" : "") +
        "</dl>" : "") +
      '<div class="detalle__accion">' + accionHTML(l, true) + "</div>" +
    "</div>";
  observarFotos($("detalle-contenido"));
  // Si la descripción es larga, se trae completa solo al abrir la ficha.
  if (l.larga && !l.descripcionCompleta && !l.pidiendoDescripcion) {
    l.pidiendoDescripcion = true;
    getDoc(doc(db, "libros", l.id)).then(function (s) {
      if (s.exists()) l.descripcionCompleta = s.data().descripcion || l.descripcion;
      if (libroEnDetalle === l.id && $detalle.open) pintarDetalle();
    }).catch(function () {}).finally(function () { l.pidiendoDescripcion = false; });
  }
}
function abrirDetalle(id) {
  libroEnDetalle = id;
  pintarDetalle();
  if ($detalle.showModal) $detalle.showModal(); else $detalle.setAttribute("open", "");
}
$detalle.addEventListener("click", function (e) {
  if (e.target.closest("[data-cerrar]") || e.target === $detalle) { $detalle.close(); return; }
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
    var okCat = (categoriaActiva === "Todas" || l.categoria === categoriaActiva) &&
      (!subcategoriaActiva || l.subcategoria === subcategoriaActiva);
    var texto = sinTildes([l.nombre, l.autor, l.categoria, l.subcategoria, l.editorial, l.isbn, String(l.isbn).replace(/[^0-9Xx]/g, "")].join(" "));
    var qISBN = /^[\d\s-]{6,}x?$/.test(q) ? q.replace(/[\s-]/g, "") : "";
    var okBusqueda = !q || texto.indexOf(q) !== -1 || (qISBN && texto.indexOf(qISBN) !== -1);
    return okCat && okBusqueda;
  });

  var inicio = categoriaActiva === "Todas" && !q;
  pintarSecciones(inicio);
  $("titulo-grilla").hidden = !libros.length;
  $("titulo-grilla-texto").textContent = q ? "Resultados de la búsqueda"
    : inicio ? "Todos los libros"
    : categoriaActiva + (subcategoriaActiva ? " › " + subcategoriaActiva : "");
  $("titulo-grilla-cuenta").textContent = visibles.length + " libro" + (visibles.length === 1 ? "" : "s");

  $estado.textContent = visibles.length ? "" : (libros.length ? "No encontramos libros con esa búsqueda." : "Pronto agregaremos libros al catálogo.");
  $grilla.innerHTML = visibles.map(function (l) { return tarjetaHTML(l, false); }).join("");
  observarFotos($grilla);
}

function tarjetaHTML(l, compacta) {
  var agotado = l.stock <= 0;
  var stockTexto = (!agotado && l.stock <= 3) ? '<span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "";
  return '<article class="tarjeta' + (agotado ? " tarjeta--agotada" : "") + (compacta ? " tarjeta--compacta" : "") + '">' +
    '<button type="button" class="tarjeta__foto" data-ver="' + l.id + '" aria-label="Ver detalles de ' + escapar(l.nombre) + '">' + fotoHTML(l, l.nombre) + (agotado ? '<span class="etiqueta">Agotado</span>' : "") + "</button>" +
    '<div class="tarjeta__cuerpo">' +
      (!compacta && l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria + (l.subcategoria ? " › " + l.subcategoria : "")) + "</p>" : "") +
      '<h3 class="tarjeta__titulo"><button type="button" class="enlace-titulo" data-ver="' + l.id + '">' + escapar(l.nombre) + "</button></h3>" +
      (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
      (!compacta && l.descripcion ? '<p class="tarjeta__descripcion">' + escapar(l.descripcion) + "</p>" +
        '<button type="button" class="ver-mas" data-ver="' + l.id + '">Ver más</button>' : "") +
      '<div class="tarjeta__pie"><span class="tarjeta__precio">' + formatoPrecio(l.precio) + "</span>" + stockTexto + "</div>" +
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
        "<span>" + formatoPrecio(l.precio) + " c/u</span></div>" +
      '<div class="cantidad cantidad--chica">' +
        '<button type="button" data-menos="' + l.id + '" aria-label="Quitar uno">−</button>' +
        "<span>" + it.cantidad + "</span>" +
        '<button type="button" data-mas="' + l.id + '" aria-label="Agregar uno">+</button>' +
      "</div></li>";
  }).join("");
}

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
    return { id: it.libro.id, nombre: it.libro.nombre, autor: it.libro.autor || "", precio: it.libro.precio || 0, cantidad: it.cantidad };
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
    precio: typeof x.precio === "number" ? x.precio : null,
    stock: typeof x.stock === "number" ? x.stock : 0,
    descripcion: x.resumen !== undefined ? x.resumen : (x.descripcion || ""),
    larga: !!x.larga, foto: x.foto || 0, destacado: !!x.destacado, creado: typeof x.creado === "number" ? x.creado : (x.creado && x.creado.toMillis ? x.creado.toMillis() : 0), imagen: x.imagen || ""
  };
}

function traerCatalogo() {
  var enCache = leerCache();
  if (enCache) return Promise.resolve(enCache);
  return getDoc(doc(db, "tienda", "catalogo")).then(function (s) {
    if (s.exists()) {
      var d = s.data();
      var datos = { libros: (d.libros || []).map(function (x) { return normalizar(x); }), categorias: d.categorias || [], subcategorias: d.subcategorias || {},
        vendidos: d.vendidos || {}, secciones: d.secciones || {} };
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
    ajustesSecciones = datos.secciones || {};
    limpiarCarrito();
    pintarContador();
    pintarCategorias();
    pintarLibros();
  }).catch(function () {
    $estado.textContent = "No se pudo cargar el catálogo. Intenta recargar la página.";
  });
}
