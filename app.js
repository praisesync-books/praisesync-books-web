import { db, configurado } from "./firebase.js";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoPrecio, sinTildes, escapar, enlaceWhatsApp, codigoPedido, portadaVaciaHTML } from "./util.js";

var T = window.TIENDA;
var libros = [];          // [{id, nombre, autor, categoria, precio, stock, descripcion, imagen}]
var ordenCategorias = []; // nombres en el orden definido en el panel
var categoriaActiva = "Todas";
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
  pintarLibros();
  pintarCarrito();
  if (libroEnDetalle && $detalle.open) pintarDetalle();
}

function avisar(texto) {
  var a = $("aviso");
  a.textContent = texto;
  a.classList.add("aviso--visible");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(function () { a.classList.remove("aviso--visible"); }, 2200);
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
    b.addEventListener("click", function () { categoriaActiva = c; pintarCategorias(); pintarLibros(); });
    $categorias.appendChild(b);
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
    '<div class="detalle__foto">' + (l.imagen ? '<img src="' + escapar(l.imagen) + '" alt="' + escapar(l.nombre) + '">' : portadaVaciaHTML(l.nombre)) +
      (agotado ? '<span class="etiqueta">Agotado</span>' : "") + "</div>" +
    '<div class="detalle__info">' +
      (l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria) + "</p>" : "") +
      '<h2 class="detalle__titulo">' + escapar(l.nombre) + "</h2>" +
      (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
      '<p class="detalle__precio">' + formatoPrecio(l.precio) +
        (!agotado && l.stock <= 3 ? ' <span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "") + "</p>" +
      (l.descripcion ? '<p class="detalle__descripcion">' + escapar(l.descripcion) + "</p>" : "") +
      '<div class="detalle__accion">' + accionHTML(l, true) + "</div>" +
    "</div>";
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
    var okCat = categoriaActiva === "Todas" || l.categoria === categoriaActiva;
    var okBusqueda = !q || sinTildes(l.nombre + " " + l.autor + " " + l.categoria).indexOf(q) !== -1;
    return okCat && okBusqueda;
  });

  $estado.textContent = visibles.length ? "" : (libros.length ? "No encontramos libros con esa búsqueda." : "Pronto agregaremos libros al catálogo.");
  $grilla.innerHTML = visibles.map(function (l) {
    var agotado = l.stock <= 0;
    var enPedido = carrito[l.id] || 0;
    var foto = l.imagen
      ? '<img src="' + escapar(l.imagen) + '" alt="' + escapar(l.nombre) + '" loading="lazy">'
      : portadaVaciaHTML(l.nombre);
    var stockTexto = (!agotado && l.stock <= 3) ? '<span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "";
    var accion = accionHTML(l, false);

    return '<article class="tarjeta' + (agotado ? " tarjeta--agotada" : "") + '">' +
      '<button type="button" class="tarjeta__foto" data-ver="' + l.id + '" aria-label="Ver detalles de ' + escapar(l.nombre) + '">' + foto + (agotado ? '<span class="etiqueta">Agotado</span>' : "") + "</button>" +
      '<div class="tarjeta__cuerpo">' +
        (l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria) + "</p>" : "") +
        '<h2 class="tarjeta__titulo"><button type="button" class="enlace-titulo" data-ver="' + l.id + '">' + escapar(l.nombre) + "</button></h2>" +
        (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
        (l.descripcion ? '<p class="tarjeta__descripcion">' + escapar(l.descripcion) + "</p>" +
          '<button type="button" class="ver-mas" data-ver="' + l.id + '">Ver más</button>' : "") +
        '<div class="tarjeta__pie"><span class="tarjeta__precio">' + formatoPrecio(l.precio) + "</span>" + stockTexto + "</div>" +
        accion +
      "</div></article>";
  }).join("");
}

$grilla.addEventListener("click", function (e) {
  var ver = e.target.closest("[data-ver]");
  if (ver) { abrirDetalle(ver.dataset.ver); return; }
  var mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
  if (mas) {
    var nuevo = !carrito[mas.dataset.mas];
    cambiarCantidad(mas.dataset.mas, 1);
    if (nuevo && carrito[mas.dataset.mas]) avisar("Agregado a tu pedido");
  }
  if (menos) cambiarCantidad(menos.dataset.menos, -1);
});
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
      '<div class="item-pedido__foto">' + (l.imagen ? '<img src="' + escapar(l.imagen) + '" alt="">' : "") + "</div>" +
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
  carrito = {}; guardarCarrito(); pintarContador(); pintarLibros();
  $("form-pedido").reset();
}

// ---------- Cargar catálogo ----------
if (!configurado) {
  $estado.textContent = "La tienda se está configurando. Vuelve pronto.";
} else {
  Promise.all([
    getDocs(query(collection(db, "libros"), where("activo", "==", true))),
    getDocs(collection(db, "categorias")).catch(function () { return null; })
  ]).then(function (res) {
    libros = res[0].docs.map(function (d) {
      var x = d.data();
      return {
        id: d.id, nombre: x.nombre || "", autor: x.autor || "", categoria: x.categoria || "",
        precio: typeof x.precio === "number" ? x.precio : null,
        stock: typeof x.stock === "number" ? x.stock : 0,
        descripcion: x.descripcion || "", imagen: x.imagen || ""
      };
    }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
    if (res[1]) {
      ordenCategorias = res[1].docs.map(function (d) { return d.data(); })
        .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(b.nombre, "es"); })
        .map(function (c) { return c.nombre; });
    }
    limpiarCarrito();
    pintarContador();
    pintarCategorias();
    pintarLibros();
  }).catch(function () {
    $estado.textContent = "No se pudo cargar el catálogo. Intenta recargar la página.";
  });
}
