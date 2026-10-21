import { app, db, configurado } from "../firebase.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction,
  serverTimestamp, deleteField, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoPrecio, aNumero, sinTildes, escapar, enlaceWhatsApp, codigoPedido, leerCSV, portadaVaciaHTML, enlaceLibro, hoyISO, vigente, fechaCorta, precioEfectivo } from "../util.js";

var auth = getAuth(app);
var $ = function (id) { return document.getElementById(id); };

var libros = [], categorias = [], pedidos = [];
var ajustes = { destacados: true, ofertas: true, vendidos: true, novedades: true, categorias: {} };
var campanas = [];     // [{id, nombre, categoria, subcategoria, porcentaje, desde, hasta, activa}]
var anuncio = { activo: false, texto: "", hasta: "" };
var ultimoRespaldo = "";
var bannerAltura = "baja"; // "baja" (como la franja azul), "media" o "alta"
function datosAjustes() {
  return { secciones: ajustes, campanas: campanas, anuncio: anuncio, ultimoRespaldo: ultimoRespaldo, banners: banners, bannerAltura: bannerAltura };
}
var banners = [];          // [{id, titulo, subtitulo, boton, destinoTipo, destino, desde, hasta, activo, cel}]   // fecha ISO del último respaldo descargado
// Guarda todo el documento de ajustes de la tienda (secciones, campañas y anuncio) de una vez.
function guardarDocAjustes() {
  return setDoc(doc(db, "tienda", "ajustes"), datosAjustes());
}
var filtroPedidos = "pendiente";
var libroEditando = null;   // id o null
var fotoEditando = "";      // dataURL

var MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

var ESTADOS = {
  pendiente: { nombre: "Pendiente", clase: "pendiente" },
  pagado:    { nombre: "Pagado",    clase: "pagado" },
  entregado: { nombre: "Entregado", clase: "entregado" },
  cancelado: { nombre: "Cancelado", clase: "cancelado" }
};

// ---------- Utilidades ----------
// "15x22x3", "15 X 22 cm" → "15 x 22 x 3" (sin "cm": la tienda lo agrega).
function limpiarDimensiones(v) {
  return String(v || "").replace(/cm\.?/gi, "").replace(/\s*[x×*]\s*/gi, " x ").replace(/\s+/g, " ").trim().slice(0, 40);
}
// En el CSV el peso puede venir como "450", "450 g" o "1,2 kg".
function pesoEnGramos(v) {
  var t = String(v || "").toLowerCase().replace(",", ".");
  var n = parseFloat(t.replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(/kg/.test(t) ? n * 1000 : n);
}
function soloDigitos(isbn) { return String(isbn || "").toUpperCase().replace(/[^0-9X]/g, ""); }
// Deja el ISBN tal como lo escriben (con o sin guiones), sin espacios sobrantes.
function limpiarISBN(v) { return String(v || "").trim().replace(/\s+/g, "").replace(/^ISBN:?/i, "").slice(0, 20); }
function avisar(texto, esError) {
  var a = $("aviso");
  a.textContent = texto;
  a.classList.toggle("aviso--error", !!esError);
  a.classList.add("aviso--visible");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(function () { a.classList.remove("aviso--visible"); }, 2600);
}
function fecha(ts) {
  if (!ts || !ts.toDate) return null;
  return ts.toDate();
}
function textoFecha(d) {
  if (!d) return "";
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" }) + " · " +
    d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}
function mensajeError(err) {
  var c = (err && err.code) || "";
  if (c.indexOf("permission-denied") !== -1) return "Esta cuenta no tiene permiso para hacer cambios.";
  if (c.indexOf("unavailable") !== -1) return "Sin conexión. Revisa el internet e intenta de nuevo.";
  return "No se pudo completar. Intenta de nuevo.";
}

// ---------- Sesión ----------
if (!configurado) {
  $("vista-login").hidden = false;
  $("error-login").hidden = false;
  $("error-login").textContent = "Falta pegar los datos de Firebase en config.js.";
  $("boton-login").disabled = true;
}

onAuthStateChanged(auth, function (usuario) {
  if (!usuario) {
    $("vista-panel").hidden = true;
    $("vista-login").hidden = false;
    return;
  }
  $("usuario").textContent = usuario.email || "";
  cargarTodo().then(function () {
    $("vista-login").hidden = true;
    $("vista-panel").hidden = false;
    mostrarPestana();
  }).catch(function (err) {
    var e = $("error-login");
    e.hidden = false;
    e.textContent = (err && err.code && err.code.indexOf("permission-denied") !== -1)
      ? "La cuenta " + usuario.email + " no está autorizada como administradora. Revisa las reglas de Firestore."
      : "No se pudieron cargar los datos. Intenta de nuevo.";
    signOut(auth);
  });
});

$("form-login").addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target, $err = $("error-login"), $btn = $("boton-login");
  $err.hidden = true; $btn.disabled = true; $btn.textContent = "Entrando…";
  signInWithEmailAndPassword(auth, f.correo.value.trim(), f.clave.value)
    .catch(function (err) {
      var c = (err && err.code) || "";
      $err.hidden = false;
      $err.textContent = c.indexOf("too-many-requests") !== -1
        ? "Demasiados intentos. Espera unos minutos e intenta de nuevo."
        : "Correo o contraseña incorrectos.";
    })
    .finally(function () { $btn.disabled = false; $btn.textContent = "Entrar"; });
});

$("salir").addEventListener("click", function () { signOut(auth); });

// ---------- Datos ----------
function cargarLibros() {
  return getDocs(collection(db, "libros")).then(function (s) {
    libros = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; })
      .sort(function (a, b) { return String(a.nombre).localeCompare(b.nombre, "es"); });
  });
}
function cargarCategorias() {
  return getDocs(collection(db, "categorias")).then(function (s) {
    categorias = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; })
      .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(b.nombre, "es"); });
  });
}
// Solo se cargan los pedidos de los últimos ~6 meses, para no gastar lecturas.
function cargarPedidos() {
  var desde = new Date();
  desde.setMonth(desde.getMonth() - 6, 1);
  desde.setHours(0, 0, 0, 0);
  return getDocs(query(collection(db, "pedidos"), where("creado", ">=", desde))).then(function (s) {
    pedidos = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; })
      .sort(function (a, b) { return ((fecha(b.creado) || 0) - (fecha(a.creado) || 0)); });
  });
}
function cargarAjustes() {
  return getDoc(doc(db, "tienda", "ajustes")).then(function (s) {
    var datos = s.exists() ? s.data() : {};
    var a = datos.secciones || {};
    ajustes = { destacados: a.destacados !== false, ofertas: a.ofertas !== false, vendidos: a.vendidos !== false, novedades: a.novedades !== false, categorias: a.categorias || {} };
    campanas = Array.isArray(datos.campanas) ? datos.campanas : [];
    anuncio = datos.anuncio || { activo: false, texto: "", hasta: "" };
    ultimoRespaldo = datos.ultimoRespaldo || "";
    banners = Array.isArray(datos.banners) ? datos.banners : [];
    bannerAltura = datos.bannerAltura || "baja";
  });
}
function cargarTodo() {
  // Pedidos primero: solo una cuenta administradora puede leerlos.
  return cargarPedidos()
    .then(function () { return Promise.all([cargarLibros(), cargarCategorias(), cargarAjustes()]); })
    .then(migrarFotos)
    .then(revisarCatalogo);
}

// "Actualizar" solo vuelve a leer los pedidos (los libros ya están al día en este panel).
document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-recargar]");
  if (!b) return;
  b.disabled = true;
  cargarPedidos().then(function () { pintarTodo(); avisar("Actualizado"); })
    .catch(function (err) { avisar(mensajeError(err), true); })
    .finally(function () { b.disabled = false; });
});

// ---------- Catálogo publicado ----------
// La tienda lee un solo documento (tienda/catalogo) con el resumen de todos los libros visibles:
// 1 lectura por visita en vez de una por libro. Se vuelve a publicar después de cada cambio.
var LARGO_RESUMEN = 240;
function msDe(ts) { return ts && ts.toMillis ? ts.toMillis() : (typeof ts === "number" ? ts : 0); }
function resumenDe(texto) {
  texto = String(texto || "");
  if (texto.length <= LARGO_RESUMEN) return texto;
  var corte = texto.slice(0, LARGO_RESUMEN);
  var espacio = corte.lastIndexOf(" ");
  return (espacio > 160 ? corte.slice(0, espacio) : corte).replace(/[\s.,;:]+$/, "") + "…";
}
function armarCatalogo() {
  return {
    libros: libros.filter(function (l) { return l.activo !== false; }).map(function (l) {
      var d = String(l.descripcion || "");
      return {
        id: l.id, nombre: l.nombre || "", autor: l.autor || "", categoria: l.categoria || "",
        subcategoria: l.subcategoria || "", editorial: l.editorial || "", isbn: l.isbn || "",
        paginas: l.paginas || 0, peso: l.peso || 0, dimensiones: l.dimensiones || "", cubierta: l.cubierta || "",
        precio: typeof l.precio === "number" ? l.precio : 0, stock: l.stock || 0,
        resumen: resumenDe(d), larga: d.length > LARGO_RESUMEN, foto: l.foto || 0,
        destacado: !!l.destacado, interiores: l.interiores || 0,
        precioOferta: (l.precioOferta > 0 && vigente(l.ofertaHasta)) ? l.precioOferta : 0, ofertaHasta: l.ofertaHasta || "", creado: msDe(l.creado) || l.creadoMs || 0
      };
    }),
    categorias: categorias.map(function (c) { return c.nombre; }),
    vendidos: calcularVendidos(),
    secciones: ajustes,
    campanas: campanas.filter(function (c) { return c.activa !== false && vigente(c.hasta); }),
    anuncio: (anuncio.activo && anuncio.texto && vigente(anuncio.hasta)) ? anuncio : null,
    banners: banners.filter(function (b) { return b.activo !== false && vigente(b.hasta); }),
    bannerAltura: bannerAltura,
    subcategorias: categorias.reduce(function (m, c) { if (subsDe(c).length) m[c.nombre] = subsDe(c); return m; }, {}),
    actualizado: serverTimestamp()
  };
}
var publicando = Promise.resolve(), temporizadorPublicar = null;
function publicarCatalogo() {
  clearTimeout(temporizadorPublicar);
  publicando = publicando.catch(function () {}).then(function () {
    return setDoc(doc(db, "tienda", "catalogo"), armarCatalogo());
  });
  publicando.catch(function (err) { avisar("No se pudo actualizar la tienda: " + mensajeError(err), true); });
  return publicando;
}
// Para cambios seguidos (como tocar + varias veces), publica una sola vez al final.
function programarPublicacion() {
  clearTimeout(temporizadorPublicar);
  temporizadorPublicar = setTimeout(publicarCatalogo, 1200);
}
window.addEventListener("beforeunload", function (e) {
  if (temporizadorPublicar) { publicarCatalogo(); }
});
function revisarCatalogo() {
  return getDoc(doc(db, "tienda", "catalogo")).then(function (s) {
    if (!s.exists()) return publicarCatalogo();
    // El ranking de "Más vendidos" cambia con el tiempo (ventana de 90 días): se actualiza al entrar.
    var d = s.data();
    if (JSON.stringify(d.vendidos || {}) !== JSON.stringify(calcularVendidos()) || !d.secciones || !("campanas" in d) || !("banners" in d) || !("bannerAltura" in d)) return publicarCatalogo();
  });
}

// Unidades vendidas por libro en los últimos 90 días (pedidos pagados o entregados). Solo los 12 primeros.
var DIAS_VENDIDOS = 90;
function calcularVendidos() {
  var desde = Date.now() - DIAS_VENDIDOS * 864e5;
  var c = {};
  pedidos.forEach(function (p) {
    if (p.estado !== "pagado" && p.estado !== "entregado") return;
    var f = fecha(p.pagadoEn) || fecha(p.creado);
    if (!f || f.getTime() < desde) return;
    (p.items || []).forEach(function (it) { if (it.id) c[it.id] = (c[it.id] || 0) + (it.cantidad || 0); });
  });
  var top = Object.keys(c).filter(function (id) { return libros.some(function (l) { return l.id === id && l.activo !== false; }); })
    .sort(function (a, b) { return c[b] - c[a]; }).slice(0, 12);
  var r = {};
  top.forEach(function (id) { r[id] = c[id]; });
  return r;
}

// Las fotos viven en portadas/{idLibro}; el panel y la tienda las cargan solo cuando se ven.
var fotos = {};          // id -> dataURL ya cargada
var pidiendoFoto = {};   // id -> promesa en curso
function cargarFoto(id) {
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
var observadorFotos = "IntersectionObserver" in window ? new IntersectionObserver(function (entradas) {
  entradas.forEach(function (en) {
    if (!en.isIntersecting) return;
    observadorFotos.unobserve(en.target);
    ponerFoto(en.target);
  });
}, { rootMargin: "300px" }) : null;
function ponerFoto(el) {
  var id = el.dataset.portada;
  cargarFoto(id).then(function (url) {
    if (url) el.innerHTML = '<img src="' + url + '" alt="">';
  });
}
function observarFotos(contenedor) {
  contenedor.querySelectorAll("[data-portada]").forEach(function (el) {
    if (fotos[el.dataset.portada]) { el.innerHTML = '<img src="' + fotos[el.dataset.portada] + '" alt="">'; return; }
    if (observadorFotos) observadorFotos.observe(el); else ponerFoto(el);
  });
}

// Pasa las fotos que estaban guardadas dentro del libro (versión anterior) a portadas/.
function migrarFotos() {
  var conFoto = libros.filter(function (l) { return typeof l.imagen === "string" && l.imagen; });
  var sinCampo = libros.filter(function (l) { return l.imagen === ""; });
  if (!conFoto.length && !sinCampo.length) return Promise.resolve();
  var cadena = Promise.resolve();
  conFoto.forEach(function (l) {
    cadena = cadena.then(function () {
      var version = Date.now();
      var b = writeBatch(db);
      b.set(doc(db, "portadas", l.id), { imagen: l.imagen });
      b.update(doc(db, "libros", l.id), { imagen: deleteField(), foto: version });
      return b.commit().then(function () { fotos[l.id] = l.imagen; delete l.imagen; l.foto = version; });
    });
  });
  if (sinCampo.length) cadena = cadena.then(function () {
    var b = writeBatch(db);
    sinCampo.forEach(function (l) { b.update(doc(db, "libros", l.id), { imagen: deleteField() }); delete l.imagen; });
    return b.commit();
  });
  return cadena.then(publicarCatalogo);
}

// ---------- Pestañas ----------
var PESTANAS = ["resumen", "pedidos", "libros", "categorias", "inicio", "ofertas", "banners", "respaldo"];
function pestanaActual() {
  var h = location.hash.replace("#", "");
  return PESTANAS.indexOf(h) !== -1 ? h : "resumen";
}
function mostrarPestana() {
  var p = pestanaActual();
  document.querySelectorAll("[data-seccion]").forEach(function (s) { s.hidden = s.dataset.seccion !== p; });
  document.querySelectorAll("[data-pestana]").forEach(function (a) {
    a.classList.toggle("activa", a.dataset.pestana === p);
    if (a.dataset.pestana === p) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  pintarTodo();
}
window.addEventListener("hashchange", mostrarPestana);

function pintarTodo() {
  var n = pedidos.filter(function (p) { return p.estado === "pendiente"; }).length;
  $("globo-pendientes").hidden = n === 0;
  $("globo-pendientes").textContent = n;
  var p = pestanaActual();
  if (p === "resumen") pintarResumen();
  if (p === "pedidos") pintarPedidos();
  if (p === "libros") pintarLibros();
  if (p === "categorias") pintarCategorias();
  if (p === "inicio") pintarInicio();
  if (p === "ofertas") pintarOfertas();
  if (p === "respaldo") pintarRespaldo();
  if (p === "banners") pintarBannersPanel();
}

// ---------- Resumen ----------
function esVenta(p) { return p.estado === "pagado" || p.estado === "entregado"; }
function fechaVenta(p) { return fecha(p.pagadoEn) || fecha(p.creado) || new Date(0); }

function pintarResumen() {
  pintarRecordatorioRespaldo();
  var ahora = new Date();
  var inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  var inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  var hace30 = new Date(ahora.getTime() - 30 * 864e5);
  var ventas = pedidos.filter(esVenta);

  var suma = function (lista) { return lista.reduce(function (s, p) { return s + (p.total || 0); }, 0); };
  var hoy = ventas.filter(function (p) { return fechaVenta(p) >= inicioHoy; });
  var mes = ventas.filter(function (p) { return fechaVenta(p) >= inicioMes; });
  var pendientes = pedidos.filter(function (p) { return p.estado === "pendiente"; });
  var porEntregar = pedidos.filter(function (p) { return p.estado === "pagado"; });

  $("metricas").innerHTML = [
    ["Ventas de hoy", formatoPrecio(suma(hoy)), hoy.length + " pedido" + (hoy.length === 1 ? "" : "s")],
    ["Ventas del mes", formatoPrecio(suma(mes)), mes.length + " pedido" + (mes.length === 1 ? "" : "s")],
    ["Pedidos pendientes", String(pendientes.length), formatoPrecio(suma(pendientes)) + " por confirmar"],
    ["Pagados por entregar", String(porEntregar.length), ""]
  ].map(function (m) {
    return '<div class="metrica"><span>' + m[0] + "</span><strong>" + m[1] + "</strong><small>" + m[2] + "</small></div>";
  }).join("");

  // Ventas de los últimos 6 meses
  var meses = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    var hasta = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    var enMes = ventas.filter(function (p) { var f = fechaVenta(p); return f >= d && f < hasta; });
    meses.push({ etiqueta: MESES[d.getMonth()] + " " + String(d.getFullYear()).slice(2), total: suma(enMes), n: enMes.length });
  }
  var max = Math.max.apply(null, meses.map(function (m) { return m.total; }).concat([1]));
  $("ventas-mes").innerHTML = '<div class="barras">' + meses.map(function (m) {
    return '<div class="barra-fila"><span class="barra-fila__etiqueta">' + m.etiqueta + "</span>" +
      '<div class="barra"><div class="barra__relleno" style="width:' + (m.total / max * 100).toFixed(1) + '%"></div></div>' +
      '<span class="barra-fila__valor">' + formatoPrecio(m.total) + "</span></div>";
  }).join("") + "</div>";

  // Más vendidos en 30 días
  var conteo = {};
  ventas.filter(function (p) { return fechaVenta(p) >= hace30; }).forEach(function (p) {
    (p.items || []).forEach(function (it) {
      var k = it.id || it.nombre;
      conteo[k] = conteo[k] || { nombre: it.nombre, cantidad: 0, total: 0 };
      conteo[k].cantidad += it.cantidad || 0;
      conteo[k].total += (it.cantidad || 0) * (it.precio || 0);
    });
  });
  var top = Object.keys(conteo).map(function (k) { return conteo[k]; })
    .sort(function (a, b) { return b.cantidad - a.cantidad; }).slice(0, 5);
  $("mas-vendidos").innerHTML = top.length
    ? '<ol class="ranking">' + top.map(function (t) {
        return "<li><span>" + escapar(t.nombre) + "</span><strong>" + t.cantidad + " und.</strong></li>";
      }).join("") + "</ol>"
    : '<p class="estado">Aún no hay ventas en los últimos 30 días.</p>';

  var bajos = libros.filter(function (l) { return l.activo !== false && (l.stock || 0) <= 3; })
    .sort(function (a, b) { return (a.stock || 0) - (b.stock || 0); });
  $("stock-bajo").innerHTML = bajos.length
    ? '<ul class="ranking ranking--simple">' + bajos.map(function (l) {
        return '<li><span>' + escapar(l.nombre) + '</span><strong class="' + ((l.stock || 0) <= 0 ? "texto-error" : "") + '">' +
          ((l.stock || 0) <= 0 ? "Agotado" : l.stock + " und.") + "</strong></li>";
      }).join("") + "</ul>"
    : '<p class="estado">Todo el catálogo tiene buen stock.</p>';
}

// ---------- Pedidos ----------
function pintarPedidos() {
  var filtros = [["pendiente", "Pendientes"], ["pagado", "Pagados"], ["entregado", "Entregados"], ["cancelado", "Cancelados"], ["todos", "Todos"]];
  $("filtro-pedidos").innerHTML = filtros.map(function (f) {
    var n = f[0] === "todos" ? pedidos.length : pedidos.filter(function (p) { return p.estado === f[0]; }).length;
    return '<button type="button" class="chip' + (filtroPedidos === f[0] ? " chip--activa" : "") + '" data-filtro="' + f[0] + '">' +
      f[1] + " · " + n + "</button>";
  }).join("");

  var lista = pedidos.filter(function (p) { return filtroPedidos === "todos" || p.estado === filtroPedidos; });
  if (!lista.length) {
    $("lista-pedidos").innerHTML = '<p class="estado">No hay pedidos aquí.</p>';
    return;
  }
  $("lista-pedidos").innerHTML = lista.map(function (p) {
    var est = ESTADOS[p.estado] || ESTADOS.pendiente;
    var c = p.cliente || {};
    var tel = String(c.telefono || "").replace(/[^\d]/g, "");
    if (tel.length === 10) tel = "57" + tel;
    var acciones = [];
    if (p.estado === "pendiente") {
      acciones.push(boton(p.id, "pagado", "Marcar pagado", "acento"));
      acciones.push(boton(p.id, "cancelado", "Cancelar", "contorno"));
    } else if (p.estado === "pagado") {
      acciones.push(boton(p.id, "entregado", "Marcar entregado", "acento"));
      acciones.push(boton(p.id, "pendiente", "Volver a pendiente", "contorno"));
      acciones.push(boton(p.id, "cancelado", "Cancelar", "contorno"));
    } else if (p.estado === "entregado") {
      acciones.push(boton(p.id, "pagado", "Volver a pagado", "contorno"));
    } else if (p.estado === "cancelado") {
      acciones.push(boton(p.id, "pendiente", "Reabrir", "contorno"));
      acciones.push('<button type="button" class="boton boton--texto texto-error" data-eliminar-pedido="' + p.id + '">Eliminar</button>');
    }
    return '<article class="pedido">' +
      '<div class="pedido__cabecera">' +
        '<div><strong class="pedido__codigo">' + codigoPedido(p.id) + "</strong>" +
        '<span class="pedido__fecha">' + textoFecha(fecha(p.creado)) + "</span></div>" +
        '<span class="estado-pedido estado-pedido--' + est.clase + '">' + est.nombre + "</span>" +
      "</div>" +
      '<div class="pedido__cliente">' +
        "<strong>" + escapar(c.nombre) + "</strong>" +
        (tel ? '<a href="' + enlaceWhatsApp(tel, "Hola " + (c.nombre || "") + ", te escribimos por tu pedido " + codigoPedido(p.id) + ".") +
          '" target="_blank" rel="noopener">' + escapar(c.telefono) + " · WhatsApp</a>" : "") +
        (c.notas ? '<p class="pedido__notas">' + escapar(c.notas) + "</p>" : "") +
      "</div>" +
      '<ul class="pedido__items">' + (p.items || []).map(function (it) {
        return "<li><span>" + (it.cantidad || 0) + " × " + escapar(it.nombre) + "</span><span>" + formatoPrecio((it.precio || 0) * (it.cantidad || 0)) + "</span></li>";
      }).join("") + '<li class="pedido__total"><span>Total</span><strong>' + formatoPrecio(p.total) + "</strong></li></ul>" +
      '<div class="pedido__acciones">' + acciones.join("") + "</div>" +
    "</article>";
  }).join("");

  function boton(id, estado, texto, tipo) {
    return '<button type="button" class="boton boton--' + tipo + '" data-pedido="' + id + '" data-estado="' + estado + '">' + texto + "</button>";
  }
}

$("filtro-pedidos").addEventListener("click", function (e) {
  var b = e.target.closest("[data-filtro]");
  if (!b) return;
  filtroPedidos = b.dataset.filtro;
  pintarPedidos();
});

$("lista-pedidos").addEventListener("click", function (e) {
  var b = e.target.closest("[data-pedido]");
  if (b) {
    if (b.dataset.estado === "cancelado" && !confirm("¿Cancelar este pedido?" + "\n\nSi ya estaba pagado, el stock se devuelve.")) return;
    b.disabled = true;
    var pedido = pedidos.find(function (x) { return x.id === b.dataset.pedido; });
    cambiarEstado(b.dataset.pedido, b.dataset.estado)
      .then(function (aviso) {
        var ids = [];
        if (aviso) ((pedido && pedido.items) || []).forEach(function (it) { if (it.id && ids.indexOf(it.id) === -1) ids.push(it.id); });
        return Promise.all([cargarPedidos(), refrescarLibros(ids)]).then(function () {
          if (ids.length) publicarCatalogo();
          pintarTodo();
          avisar(aviso || "Pedido actualizado");
        });
      })
      .catch(function (err) { b.disabled = false; avisar(mensajeError(err), true); });
    return;
  }
  var del = e.target.closest("[data-eliminar-pedido]");
  if (del && confirm("¿Eliminar este pedido para siempre? Esto no se puede deshacer.")) {
    deleteDoc(doc(db, "pedidos", del.dataset.eliminarPedido))
      .then(cargarPedidos).then(function () { pintarTodo(); avisar("Pedido eliminado"); })
      .catch(function (err) { avisar(mensajeError(err), true); });
  }
});

// Vuelve a leer solo algunos libros (por ejemplo, los de un pedido al que cambió el stock).
function refrescarLibros(ids) {
  return Promise.all(ids.map(function (id) {
    return getDoc(doc(db, "libros", id)).then(function (s) {
      var i = libros.findIndex(function (l) { return l.id === id; });
      if (!s.exists()) { if (i !== -1) libros.splice(i, 1); return; }
      var x = s.data(); x.id = id;
      if (i === -1) libros.push(x); else libros[i] = x;
    });
  }));
}

// El stock se descuenta cuando el pedido pasa a Pagado o Entregado,
// y se devuelve si vuelve a Pendiente o se cancela.
function cambiarEstado(pedidoId, nuevo) {
  var refPedido = doc(db, "pedidos", pedidoId);
  return runTransaction(db, function (tx) {
    return tx.get(refPedido).then(function (snap) {
      if (!snap.exists()) throw new Error("no-existe");
      var p = snap.data();
      var items = p.items || [];
      var debeDescontar = nuevo === "pagado" || nuevo === "entregado";
      var yaDescontado = !!p.stockDescontado;
      var cambios = { estado: nuevo, actualizado: serverTimestamp() };
      if (nuevo === "pagado" && !p.pagadoEn) cambios.pagadoEn = serverTimestamp();
      if (nuevo === "pendiente" || nuevo === "cancelado") cambios.pagadoEn = null;

      if (debeDescontar === yaDescontado) {
        tx.update(refPedido, cambios);
        return null;
      }

      var ids = [];
      items.forEach(function (it) { if (it.id && ids.indexOf(it.id) === -1) ids.push(it.id); });
      return Promise.all(ids.map(function (id) { return tx.get(doc(db, "libros", id)); })).then(function (snaps) {
        var faltantes = [];
        var descontado = {};
        snaps.forEach(function (s, i) {
          if (!s.exists()) return;
          var id = ids[i];
          var stock = s.data().stock || 0;
          var cantidad = items.filter(function (it) { return it.id === id; })
            .reduce(function (t, it) { return t + (it.cantidad || 0); }, 0);
          if (debeDescontar) {
            var quitar = Math.min(stock, cantidad);
            if (quitar < cantidad) faltantes.push(s.data().nombre);
            descontado[id] = quitar;
            tx.update(s.ref, { stock: stock - quitar });
          } else {
            var devolver = (p.descontado && typeof p.descontado[id] === "number") ? p.descontado[id] : cantidad;
            tx.update(s.ref, { stock: stock + devolver });
          }
        });
        cambios.stockDescontado = debeDescontar;
        cambios.descontado = debeDescontar ? descontado : {};
        tx.update(refPedido, cambios);
        if (faltantes.length) return "Ojo: no había stock suficiente de " + faltantes.join(", ") + ". Quedó en 0.";
        return debeDescontar ? "Pedido pagado. Stock descontado." : "Pedido actualizado. Stock devuelto.";
      });
    });
  });
}

// ---------- Libros ----------
function pintarLibros() {
  var q = sinTildes($("buscar-libros").value.trim());
  var lista = libros.filter(function (l) {
    var texto = sinTildes([l.nombre, l.autor, l.categoria, l.subcategoria, l.editorial, l.isbn, soloDigitos(l.isbn)].join(" "));
    var qISBN = /^[\d\s-]{6,}x?$/.test(q) ? q.replace(/[\s-]/g, "") : "";
    return !q || texto.indexOf(q) !== -1 || (qISBN && texto.indexOf(qISBN) !== -1);
  });
  $("estado-libros").textContent = libros.length
    ? (lista.length ? libros.length + " libro" + (libros.length === 1 ? "" : "s") + " en total" : "Ningún libro coincide con la búsqueda.")
    : "Todavía no hay libros. Crea el primero o importa un CSV.";
  $("tabla-libros").innerHTML = lista.map(function (l) {
    var stock = l.stock || 0;
    return '<div class="fila-libro' + (l.activo === false ? " fila-libro--oculta" : "") + '">' +
      '<button type="button" class="fila-libro__foto" data-editar="' + l.id + '" aria-label="Editar ' + escapar(l.nombre) + '">' +
        (l.foto ? '<span class="foto-perezosa" data-portada="' + l.id + '">' + portadaVaciaHTML("") + "</span>" : portadaVaciaHTML("")) + "</button>" +
      '<button type="button" class="fila-libro__info" data-editar="' + l.id + '">' +
        "<strong>" + escapar(l.nombre) + "</strong>" +
        "<span>" + escapar([l.autor, l.editorial, [l.categoria, l.subcategoria].filter(Boolean).join(" › ")].filter(Boolean).join(" · ")) + "</span>" +
        "<span>" + formatoPrecio(l.precio) + etiquetaOfertaPanel(l) + (l.interiores ? " · 📖 " + l.interiores + " foto(s) interior" : "") + (l.destacado ? " · ⭐ Destacado" : "") + (l.activo === false ? ' · <em>Oculto</em>' : "") + "</span>" +
      "</button>" +
      '<div class="fila-libro__stock">' +
        '<span class="fila-libro__etiqueta">Stock</span>' +
        '<div class="cantidad cantidad--chica' + (stock <= 0 ? " cantidad--agotado" : "") + '">' +
          '<button type="button" data-stock="' + l.id + '" data-delta="-1" aria-label="Restar uno">−</button>' +
          '<input type="number" min="0" value="' + stock + '" data-stock-input="' + l.id + '" aria-label="Stock de ' + escapar(l.nombre) + '">' +
          '<button type="button" data-stock="' + l.id + '" data-delta="1" aria-label="Sumar uno">+</button>' +
        "</div>" +
      "</div>" +
    "</div>";
  }).join("");
  observarFotos($("tabla-libros"));
}

$("buscar-libros").addEventListener("input", pintarLibros);

function guardarStock(id, valor) {
  var l = libros.find(function (x) { return x.id === id; });
  if (!l) return;
  valor = Math.max(0, parseInt(valor, 10) || 0);
  if (valor === (l.stock || 0)) return;
  var anterior = l.stock;
  l.stock = valor;
  pintarLibros();
  updateDoc(doc(db, "libros", id), { stock: valor, actualizado: serverTimestamp() })
    .then(function () { avisar("Stock de " + l.nombre + ": " + valor); programarPublicacion(); })
    .catch(function (err) { l.stock = anterior; pintarLibros(); avisar(mensajeError(err), true); });
}

$("tabla-libros").addEventListener("click", function (e) {
  var s = e.target.closest("[data-stock]");
  if (s) {
    var l = libros.find(function (x) { return x.id === s.dataset.stock; });
    if (l) guardarStock(l.id, (l.stock || 0) + parseInt(s.dataset.delta, 10));
    return;
  }
  var ed = e.target.closest("[data-editar]");
  if (ed) abrirEditor(ed.dataset.editar);
});
$("tabla-libros").addEventListener("change", function (e) {
  var i = e.target.closest("[data-stock-input]");
  if (i) guardarStock(i.dataset.stockInput, i.value);
});
$("tabla-libros").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && e.target.matches("[data-stock-input]")) e.target.blur();
});

// Editor
var $modal = $("modal-libro"), $form = $("form-libro");

function opcionesCategoria(actual) {
  var nombres = categorias.map(function (c) { return c.nombre; });
  if (actual && nombres.indexOf(actual) === -1) nombres.push(actual);
  $("select-categoria").innerHTML = '<option value="">Sin categoría</option>' +
    nombres.map(function (n) { return '<option' + (n === actual ? " selected" : "") + ">" + escapar(n) + "</option>"; }).join("") +
    '<option value="__nueva">+ Nueva categoría…</option>';
}

function opcionesSubcategoria(actual) {
  var $s = $("select-subcategoria");
  var cat = categoriaPorNombre($("select-categoria").value);
  var nombres = cat ? subsDe(cat).slice() : [];
  if (actual && nombres.indexOf(actual) === -1) nombres.push(actual);
  $s.disabled = !cat;
  $s.innerHTML = '<option value="">' + (cat ? "Sin subcategoría" : "Elige primero una categoría") + "</option>" +
    nombres.map(function (n) { return "<option" + (n === actual ? " selected" : "") + ">" + escapar(n) + "</option>"; }).join("") +
    (cat ? '<option value="__nueva">+ Nueva subcategoría…</option>' : "");
}

$("select-categoria").addEventListener("change", function (e) {
  if (e.target.value !== "__nueva") { opcionesSubcategoria(""); return; }
  var nombre = (prompt("Nombre de la nueva categoría") || "").trim().slice(0, 40);
  if (!nombre) { e.target.value = ""; opcionesSubcategoria(""); return; }
  crearCategoria(nombre).then(function () { opcionesCategoria(nombre); opcionesSubcategoria(""); })
    .catch(function (err) { e.target.value = ""; avisar(mensajeError(err), true); });
});

$("select-subcategoria").addEventListener("change", function (e) {
  if (e.target.value !== "__nueva") return;
  var cat = categoriaPorNombre($("select-categoria").value);
  var nombre = (prompt("Nueva subcategoría dentro de \"" + (cat ? cat.nombre : "") + "\"") || "").trim().slice(0, 40);
  if (!nombre || !cat) { e.target.value = ""; return; }
  crearSubcategoria(cat, nombre).then(function (final) { opcionesSubcategoria(final); })
    .catch(function (err) { e.target.value = ""; avisar(mensajeError(err), true); });
});

function pintarFoto() {
  $("vista-foto").innerHTML = fotoEditando ? '<img src="' + fotoEditando + '" alt="">' : portadaVaciaHTML("Sin foto");
  $("quitar-foto").hidden = !fotoEditando;
}

var fotoOriginal = "";
// Fotos del interior: hasta 3, guardadas en interiores/{idLibro}_1 … _3.
var MAX_INTERIORES = 3;
var interioresEditando = [], interioresOriginal = [], cargandoInteriores = false;
var cacheInteriores = {};   // idLibro -> [dataURL…]
function pintarInteriores() {
  var html = interioresEditando.map(function (url, i) {
    return '<div class="interior"><img src="' + url + '" alt="Interior ' + (i + 1) + '">' +
      '<button type="button" class="interior__quitar" data-quitar-interior="' + i + '" aria-label="Quitar foto ' + (i + 1) + '">×</button></div>';
  }).join("");
  if (cargandoInteriores) html += '<div class="interior interior--cargando">Cargando…</div>';
  else if (interioresEditando.length < MAX_INTERIORES) {
    html += '<button type="button" class="interior interior--agregar" id="agregar-interior">+<span>Agregar</span></button>';
  }
  $("lista-interiores").innerHTML = html;
}
function abrirEditor(id) {
  var l = id ? libros.find(function (x) { return x.id === id; }) : null;
  libroEditando = l ? l.id : null;
  interioresEditando = []; interioresOriginal = []; cargandoInteriores = false;
  if (l && l.interiores) {
    if (cacheInteriores[l.id]) { interioresEditando = cacheInteriores[l.id].slice(); interioresOriginal = cacheInteriores[l.id].slice(); }
    else {
      cargandoInteriores = true;
      var pedidas = [];
      for (var k = 1; k <= l.interiores; k++) pedidas.push(getDoc(doc(db, "interiores", l.id + "_" + k)));
      Promise.all(pedidas).then(function (snaps) {
        var urls = snaps.filter(function (s) { return s.exists(); }).map(function (s) { return s.data().imagen; });
        cacheInteriores[l.id] = urls;
        if (libroEditando === l.id && cargandoInteriores) {
          interioresEditando = urls.slice(); interioresOriginal = urls.slice();
          cargandoInteriores = false; pintarInteriores();
        }
      }).catch(function () { cargandoInteriores = false; pintarInteriores(); avisar("No se pudieron cargar las fotos del interior", true); });
    }
  }
  fotoEditando = fotoOriginal = "";
  if (l && l.foto) {
    if (fotos[l.id] !== undefined) fotoEditando = fotoOriginal = fotos[l.id];
    else cargarFoto(l.id).then(function (url) {
      if (libroEditando === l.id && fotoEditando === fotoOriginal) { fotoEditando = fotoOriginal = url; pintarFoto(); }
    });
  }
  $form.reset();
  $("titulo-modal-libro").textContent = l ? "Editar libro" : "Nuevo libro";
  $form.nombre.value = l ? l.nombre || "" : "";
  $form.autor.value = l ? l.autor || "" : "";
  $form.editorial.value = l ? l.editorial || "" : "";
  $form.isbn.value = l ? l.isbn || "" : "";
  $form.paginas.value = l && l.paginas ? l.paginas : "";
  $form.peso.value = l && l.peso ? l.peso : "";
  $form.dimensiones.value = l ? l.dimensiones || "" : "";
  $form.cubierta.value = l ? l.cubierta || "" : "";
  var eds = [];
  libros.forEach(function (x) { if (x.editorial && eds.indexOf(x.editorial) === -1) eds.push(x.editorial); });
  $("lista-editoriales").innerHTML = eds.sort().map(function (n) { return '<option value="' + escapar(n) + '">'; }).join("");
  $form.precio.value = l && typeof l.precio === "number" ? l.precio : "";
  $form.precioOferta.value = l && l.precioOferta ? l.precioOferta : "";
  $form.ofertaHasta.value = l ? l.ofertaHasta || "" : "";
  $form.stock.value = l ? (l.stock || 0) : 0;
  $form.descripcion.value = l ? l.descripcion || "" : "";
  $form.activo.checked = l ? l.activo !== false : true;
  $form.destacado.checked = l ? !!l.destacado : false;
  opcionesCategoria(l ? l.categoria || "" : "");
  opcionesSubcategoria(l ? l.subcategoria || "" : "");
  $("borrar-libro").hidden = !l;
  $("copiar-enlace").hidden = !l || l.activo === false;
  $("error-libro").hidden = true;
  pintarFoto();
  pintarInteriores();
  $modal.showModal();
  ajustarDescripcion();
}

$("nuevo-libro").addEventListener("click", function () { abrirEditor(null); });

// La descripción crece mientras se escribe y muestra cuántos caracteres lleva.
function ajustarDescripcion() {
  var t = $form.descripcion;
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + 2, 420) + "px";
  $("contador-descripcion").textContent = t.value.length + " / 3000";
}
$form.descripcion.addEventListener("input", ajustarDescripcion);
$modal.addEventListener("click", function (e) {
  if (e.target.closest("[data-cerrar]") || e.target === $modal) $modal.close();
});

// Reduce la foto en el navegador para guardarla en la base de datos (máx. ~200 KB).
function comprimirFoto(archivo, lado, maximo) {
  lado = lado || 640; maximo = maximo || 270000;
  return new Promise(function (resolver, rechazar) {
    var lector = new FileReader();
    lector.onerror = rechazar;
    lector.onload = function () {
      var img = new Image();
      img.onerror = rechazar;
      img.onload = function () {
        var escala = Math.min(1, lado / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var calidad = 0.82, url = c.toDataURL("image/jpeg", calidad);
        while (url.length > maximo && calidad > 0.4) { calidad -= 0.1; url = c.toDataURL("image/jpeg", calidad); }
        resolver(url);
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

$("input-foto").addEventListener("change", function (e) {
  var archivo = e.target.files && e.target.files[0];
  if (!archivo) return;
  $("vista-foto").innerHTML = '<p class="estado">Procesando…</p>';
  comprimirFoto(archivo).then(function (url) { fotoEditando = url; pintarFoto(); })
    .catch(function () { pintarFoto(); avisar("No se pudo leer esa imagen", true); });
  e.target.value = "";
});
$("quitar-foto").addEventListener("click", function () { fotoEditando = ""; pintarFoto(); });

// Fotos del interior: se guardan con más resolución que la portada para que se pueda leer la letra.
$("lista-interiores").addEventListener("click", function (e) {
  if (e.target.closest("#agregar-interior")) { $("input-interior").click(); return; }
  var q = e.target.closest("[data-quitar-interior]");
  if (q) { interioresEditando.splice(parseInt(q.dataset.quitarInterior, 10), 1); pintarInteriores(); }
});
$("input-interior").addEventListener("change", function (e) {
  var archivos = Array.prototype.slice.call(e.target.files || []);
  e.target.value = "";
  var libres = MAX_INTERIORES - interioresEditando.length;
  if (archivos.length > libres) avisar("Solo caben " + MAX_INTERIORES + " fotos del interior; se agregan las primeras " + libres + ".");
  archivos = archivos.slice(0, Math.max(0, libres));
  if (!archivos.length) return;
  cargandoInteriores = true; pintarInteriores();
  Promise.all(archivos.map(function (a) { return comprimirFoto(a, 1100, 420000); }))
    .then(function (urls) { interioresEditando = interioresEditando.concat(urls).slice(0, MAX_INTERIORES); })
    .catch(function () { avisar("No se pudo leer alguna de las imágenes", true); })
    .finally(function () { cargandoInteriores = false; pintarInteriores(); });
});

$form.addEventListener("submit", function (e) {
  e.preventDefault();
  var $err = $("error-libro"), $btn = $("guardar-libro");
  var precio = aNumero($form.precio.value);
  var datos = {
    nombre: $form.nombre.value.trim(),
    autor: $form.autor.value.trim(),
    editorial: $form.editorial.value.trim(),
    isbn: limpiarISBN($form.isbn.value),
    paginas: aNumero($form.paginas.value) || 0,
    peso: aNumero($form.peso.value) || 0,
    dimensiones: limpiarDimensiones($form.dimensiones.value),
    cubierta: $form.cubierta.value.trim().slice(0, 40),
    categoria: $form.categoria.value === "__nueva" ? "" : $form.categoria.value,
    subcategoria: ($form.categoria.value && $form.subcategoria.value !== "__nueva") ? $form.subcategoria.value : "",
    precio: precio,
    stock: Math.max(0, parseInt($form.stock.value, 10) || 0),
    precioOferta: aNumero($form.precioOferta.value) || 0,
    ofertaHasta: $form.ofertaHasta.value || "",
    descripcion: $form.descripcion.value.trim(),
    activo: $form.activo.checked,
    destacado: $form.destacado.checked,
    actualizado: serverTimestamp()
  };
  var cambioFoto = fotoEditando !== fotoOriginal;
  var cambioInteriores = !cargandoInteriores && JSON.stringify(interioresEditando) !== JSON.stringify(interioresOriginal);
  if (cargandoInteriores) { $err.hidden = false; $err.textContent = "Espera a que terminen de cargar las fotos del interior."; return; }
  if (!datos.nombre) { $err.hidden = false; $err.textContent = "El nombre es obligatorio."; return; }
  if (precio === null) { $err.hidden = false; $err.textContent = "Escribe el precio, solo números. Ej: 85000"; return; }
  if (datos.precioOferta && datos.precioOferta >= precio) { $err.hidden = false; $err.textContent = "El precio de oferta debe ser menor que el precio normal."; return; }
  if (!datos.precioOferta) datos.ofertaHasta = "";
  $err.hidden = true; $btn.disabled = true; $btn.textContent = "Guardando…";
  var ref = libroEditando ? doc(db, "libros", libroEditando) : doc(collection(db, "libros"));
  var id = ref.id, esNuevo = !libroEditando;
  var local = libros.find(function (x) { return x.id === id; });
  datos.foto = cambioFoto ? (fotoEditando ? Date.now() : 0) : ((local && local.foto) || 0);
  datos.interiores = cambioInteriores ? interioresEditando.length : ((local && local.interiores) || 0);
  var b = writeBatch(db);
  if (esNuevo) b.set(ref, Object.assign({ creado: serverTimestamp() }, datos));
  else b.update(ref, datos);
  if (cambioFoto) {
    if (fotoEditando) b.set(doc(db, "portadas", id), { imagen: fotoEditando });
    else b.delete(doc(db, "portadas", id));
  }
  if (cambioInteriores) {
    for (var k = 1; k <= MAX_INTERIORES; k++) {
      var refInt = doc(db, "interiores", id + "_" + k);
      if (k <= interioresEditando.length) b.set(refInt, { imagen: interioresEditando[k - 1] });
      else b.delete(refInt);
    }
  }
  b.commit().then(function () {
    if (cambioInteriores) cacheInteriores[id] = interioresEditando.slice();
    var copia = Object.assign({}, datos, { id: id });
    delete copia.actualizado;
    if (esNuevo) copia.creadoMs = Date.now();
    if (local) Object.assign(local, copia); else libros.push(copia);
    libros.sort(function (a, c) { return String(a.nombre).localeCompare(c.nombre, "es"); });
    if (cambioFoto) fotos[id] = fotoEditando;
    $modal.close();
    pintarTodo();
    avisar(esNuevo ? "Libro creado" : "Libro actualizado");
    publicarCatalogo();
  }).catch(function (err) {
    $err.hidden = false; $err.textContent = mensajeError(err);
  }).finally(function () { $btn.disabled = false; $btn.textContent = "Guardar"; });
});

$("borrar-libro").addEventListener("click", function () {
  if (!libroEditando) return;
  var l = libros.find(function (x) { return x.id === libroEditando; });
  if (!confirm("¿Eliminar \"" + (l ? l.nombre : "") + "\"? Esto no se puede deshacer.\n\nSi solo quieres esconderlo, desmarca \"Visible en la tienda\".")) return;
  var id = libroEditando;
  var b = writeBatch(db);
  b.delete(doc(db, "libros", id));
  b.delete(doc(db, "portadas", id));
  for (var k = 1; k <= MAX_INTERIORES; k++) b.delete(doc(db, "interiores", id + "_" + k));
  b.commit().then(function () {
    libros = libros.filter(function (x) { return x.id !== id; });
    delete fotos[id];
    $modal.close(); pintarTodo(); avisar("Libro eliminado");
    publicarCatalogo();
  }).catch(function (err) { avisar(mensajeError(err), true); });
});

// Importar CSV (columnas: Nombre, Autor, Categoría, Precio, Stock, Descripción)
$("importar").addEventListener("click", function () { $("archivo-csv").click(); });
$("archivo-csv").addEventListener("change", function (e) {
  var archivo = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  archivo.text().then(function (texto) {
    var filas = leerCSV(texto).filter(function (f) { return f.nombre; });
    if (!filas.length) { avisar("El archivo no tiene libros. Revisa que la primera fila tenga los títulos de columna.", true); return; }
    var existentes = {};
    var porISBN = {};
    libros.forEach(function (l) {
      existentes[sinTildes(l.nombre + "|" + (l.autor || ""))] = l.id;
      if (soloDigitos(l.isbn)) porISBN[soloDigitos(l.isbn)] = l.id;
    });
    var isbnDanados = [];
    var nuevos = 0, actualizados = 0;
    var cats = {};
    var operaciones = filas.map(function (f) {
      var datos = {
        nombre: f.nombre, autor: f.autor || "", categoria: f.categoria || "",
        precio: aNumero(f.precio) || 0, stock: aNumero(f.stock) || 0,
        descripcion: f.descripcion || "", actualizado: serverTimestamp()
      };
      // Editorial, ISBN y detalles solo se cambian si el archivo trae esas columnas.
      if (f.editorial !== undefined) datos.editorial = f.editorial;
      if (f.paginas !== undefined) datos.paginas = aNumero(f.paginas) || 0;
      if (f.peso !== undefined) datos.peso = pesoEnGramos(f.peso);
      if (f.dimensiones !== undefined) datos.dimensiones = limpiarDimensiones(f.dimensiones);
      if (f.cubierta !== undefined) datos.cubierta = String(f.cubierta).trim().slice(0, 40);
      if (f["precio oferta"] !== undefined) datos.precioOferta = (aNumero(f["precio oferta"]) || 0) < datos.precio ? (aNumero(f["precio oferta"]) || 0) : 0;
      if (f["oferta hasta"] !== undefined) datos.ofertaHasta = fechaDeCSV(f["oferta hasta"]);
      // Columnas que trae el respaldo de libros
      if (f.visible !== undefined && f.visible !== "") datos.activo = !/^no$/i.test(f.visible.trim());
      if (f.destacado !== undefined && f.destacado !== "") datos.destacado = /^s/i.test(f.destacado.trim());
      if (f.isbn !== undefined) {
        if (/e\+/i.test(f.isbn)) isbnDanados.push(f.nombre);
        else datos.isbn = limpiarISBN(f.isbn);
      }
      if (f.subcategoria !== undefined) datos.subcategoria = datos.categoria ? f.subcategoria : "";
      if (datos.categoria) {
        cats[datos.categoria] = cats[datos.categoria] || {};
        if (datos.subcategoria) cats[datos.categoria][datos.subcategoria] = true;
      }
      var id = (datos.isbn && porISBN[soloDigitos(datos.isbn)]) || existentes[sinTildes(f.nombre + "|" + (f.autor || ""))];
      if (id) { actualizados++; return { id: id, datos: datos }; }
      nuevos++;
      return { id: null, datos: Object.assign({ activo: true, foto: 0, creado: serverTimestamp() }, datos) };
    });
    var msg = "Se van a importar " + filas.length + " libros:\n• " + nuevos + " nuevos\n• " + actualizados +
      " ya existían (se actualizan precio, stock y datos; la foto se conserva)" +
      (isbnDanados.length ? "\n\nOjo: Excel dañó el ISBN de " + isbnDanados.length + " libro(s) (aparece como 9,78E+12). " +
        "Esos ISBN no se importan. En Excel, pon la columna ISBN en formato Texto y vuelve a escribirlos." : "") +
      "\n\n¿Continuar?";
    if (!confirm(msg)) return;

    avisar("Importando…");
    var lotes = [];
    for (var i = 0; i < operaciones.length; i += 400) lotes.push(operaciones.slice(i, i + 400));
    var cadena = Promise.resolve();
    lotes.forEach(function (lote) {
      cadena = cadena.then(function () {
        var b = writeBatch(db);
        lote.forEach(function (op) {
          if (op.id) b.update(doc(db, "libros", op.id), op.datos);
          else { var r = doc(collection(db, "libros")); op.id = r.id; op.nuevo = true; b.set(r, op.datos); }
        });
        return b.commit();
      });
    });
    var faltan = Object.keys(cats).filter(function (n) { return !categorias.some(function (c) { return c.nombre === n; }); });
    cadena.then(function () { return faltan.reduce(function (p, n) { return p.then(function () { return crearCategoria(n); }); }, Promise.resolve()); })
      .then(function () {
        // Subcategorías nuevas que trae el archivo
        return Object.keys(cats).reduce(function (p, n) {
          return p.then(function () {
            var cat = categoriaPorNombre(n);
            var nuevas = Object.keys(cats[n]).filter(function (s) { return cat && subsDe(cat).indexOf(s) === -1; });
            if (!nuevas.length) return;
            return updateDoc(doc(db, "categorias", cat.id), { subcategorias: subsDe(cat).concat(nuevas) })
              .then(function () { cat.subcategorias = subsDe(cat).concat(nuevas); });
          });
        }, Promise.resolve());
      })
      .then(function () {
        operaciones.forEach(function (op) {
          var copia = Object.assign({}, op.datos, { id: op.id });
          delete copia.actualizado; delete copia.creado;
          if (op.nuevo) copia.creadoMs = Date.now();
          var local = libros.find(function (x) { return x.id === op.id; });
          if (local) Object.assign(local, copia); else libros.push(copia);
        });
        libros.sort(function (a, c) { return String(a.nombre).localeCompare(c.nombre, "es"); });
        pintarTodo();
        avisar(nuevos + " creados, " + actualizados + " actualizados");
        return publicarCatalogo();
      }).catch(function (err) { cargarLibros().then(function () { pintarTodo(); publicarCatalogo(); }); avisar(mensajeError(err), true); });
  });
});

// ---------- Categorías ----------
function subsDe(c) { return (c && Array.isArray(c.subcategorias)) ? c.subcategorias : []; }
function categoriaPorNombre(n) { return categorias.find(function (c) { return c.nombre === n; }); }

// Crea una subcategoría (si ya existe con otro uso de mayúsculas o tildes, devuelve la existente).
function crearSubcategoria(cat, nombre) {
  var igual = subsDe(cat).find(function (s) { return sinTildes(s) === sinTildes(nombre); });
  if (igual) return Promise.resolve(igual);
  var lista = subsDe(cat).concat([nombre]);
  return updateDoc(doc(db, "categorias", cat.id), { subcategorias: lista }).then(function () {
    cat.subcategorias = lista;
    programarPublicacion();
    return nombre;
  });
}

function crearCategoria(nombre) {
  if (categorias.some(function (c) { return sinTildes(c.nombre) === sinTildes(nombre); })) return Promise.resolve();
  var orden = categorias.reduce(function (m, c) { return Math.max(m, c.orden || 0); }, 0) + 1;
  return addDoc(collection(db, "categorias"), { nombre: nombre, orden: orden }).then(cargarCategorias).then(programarPublicacion);
}

function pintarCategorias() {
  if (!categorias.length) {
    $("lista-categorias").innerHTML = '<li class="estado">Todavía no hay categorías.</li>';
    return;
  }
  $("lista-categorias").innerHTML = categorias.map(function (c, i) {
    var n = libros.filter(function (l) { return l.categoria === c.nombre; }).length;
    return '<li class="categoria-fila">' +
      '<div class="categoria-fila__orden">' +
        '<button type="button" class="icono-boton icono-boton--chico" data-mover="' + i + '" data-dir="-1" aria-label="Subir"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button type="button" class="icono-boton icono-boton--chico" data-mover="' + i + '" data-dir="1" aria-label="Bajar"' + (i === categorias.length - 1 ? " disabled" : "") + ">↓</button>" +
      "</div>" +
      '<div class="categoria-fila__nombre"><strong>' + escapar(c.nombre) + "</strong><span>" + n + " libro" + (n === 1 ? "" : "s") + "</span></div>" +
      '<button type="button" class="boton boton--texto" data-renombrar="' + c.id + '">Renombrar</button>' +
      '<button type="button" class="boton boton--texto texto-error" data-borrar-cat="' + c.id + '">Eliminar</button>' +
      '<div class="subcategorias">' +
        subsDe(c).map(function (s, k) {
          var ns = libros.filter(function (l) { return l.categoria === c.nombre && l.subcategoria === s; }).length;
          return '<div class="subcategoria">' +
            '<span class="subcategoria__nombre">' + escapar(s) + " <small>" + ns + "</small></span>" +
            '<button type="button" class="icono-boton icono-boton--mini" data-sub-mover="' + c.id + '" data-k="' + k + '" data-dir="-1" aria-label="Subir"' + (k === 0 ? " disabled" : "") + ">↑</button>" +
            '<button type="button" class="icono-boton icono-boton--mini" data-sub-mover="' + c.id + '" data-k="' + k + '" data-dir="1" aria-label="Bajar"' + (k === subsDe(c).length - 1 ? " disabled" : "") + ">↓</button>" +
            '<button type="button" class="boton boton--texto boton--mini" data-sub-renombrar="' + c.id + '" data-k="' + k + '">Renombrar</button>' +
            '<button type="button" class="boton boton--texto boton--mini texto-error" data-sub-borrar="' + c.id + '" data-k="' + k + '">Eliminar</button>' +
          "</div>";
        }).join("") +
        '<button type="button" class="boton boton--texto boton--mini" data-sub-nueva="' + c.id + '">+ Subcategoría</button>' +
      "</div>" +
    "</li>";
  }).join("");
}

$("form-categoria").addEventListener("submit", function (e) {
  e.preventDefault();
  var nombre = e.target.nombre.value.trim().slice(0, 40);
  if (!nombre) return;
  crearCategoria(nombre).then(function () { e.target.reset(); pintarCategorias(); avisar("Categoría creada"); })
    .catch(function (err) { avisar(mensajeError(err), true); });
});

$("lista-categorias").addEventListener("click", function (e) {
  var catDe = function (el, attr) { return categorias.find(function (x) { return x.id === el.dataset[attr]; }); };
  var nueva = e.target.closest("[data-sub-nueva]");
  if (nueva) {
    var cn = catDe(nueva, "subNueva");
    var nom = (prompt("Nueva subcategoría dentro de \"" + cn.nombre + "\"") || "").trim().slice(0, 40);
    if (!nom) return;
    crearSubcategoria(cn, nom).then(function () { pintarCategorias(); avisar("Subcategoría creada"); })
      .catch(function (err) { avisar(mensajeError(err), true); });
    return;
  }
  var smv = e.target.closest("[data-sub-mover]");
  if (smv) {
    var cm = catDe(smv, "subMover"), k = parseInt(smv.dataset.k, 10), j2 = k + parseInt(smv.dataset.dir, 10);
    var lista = subsDe(cm).slice();
    if (j2 < 0 || j2 >= lista.length) return;
    var tmp = lista[k]; lista[k] = lista[j2]; lista[j2] = tmp;
    updateDoc(doc(db, "categorias", cm.id), { subcategorias: lista })
      .then(function () { cm.subcategorias = lista; pintarCategorias(); programarPublicacion(); })
      .catch(function (err) { avisar(mensajeError(err), true); });
    return;
  }
  var srn = e.target.closest("[data-sub-renombrar]");
  if (srn) {
    var cr = catDe(srn, "subRenombrar"), kr = parseInt(srn.dataset.k, 10), viejo = subsDe(cr)[kr];
    var nv = (prompt("Nuevo nombre para \"" + viejo + "\"", viejo) || "").trim().slice(0, 40);
    if (!nv || nv === viejo) return;
    if (subsDe(cr).some(function (s, i) { return i !== kr && sinTildes(s) === sinTildes(nv); })) { avisar("Ya existe esa subcategoría", true); return; }
    var listaR = subsDe(cr).slice(); listaR[kr] = nv;
    var afectados = libros.filter(function (l) { return l.categoria === cr.nombre && l.subcategoria === viejo; });
    var lr = writeBatch(db);
    lr.update(doc(db, "categorias", cr.id), { subcategorias: listaR });
    afectados.forEach(function (l) { lr.update(doc(db, "libros", l.id), { subcategoria: nv }); });
    lr.commit().then(function () {
      cr.subcategorias = listaR;
      afectados.forEach(function (l) { l.subcategoria = nv; });
      pintarCategorias(); avisar("Subcategoría renombrada"); publicarCatalogo();
    }).catch(function (err) { avisar(mensajeError(err), true); });
    return;
  }
  var sdel = e.target.closest("[data-sub-borrar]");
  if (sdel) {
    var cd = catDe(sdel, "subBorrar"), kd = parseInt(sdel.dataset.k, 10), nomD = subsDe(cd)[kd];
    var conSub = libros.filter(function (l) { return l.categoria === cd.nombre && l.subcategoria === nomD; });
    if (!confirm(conSub.length
      ? "\"" + nomD + "\" tiene " + conSub.length + " libro(s). Si la eliminas, siguen en \"" + cd.nombre + "\" pero sin subcategoría. ¿Continuar?"
      : "¿Eliminar la subcategoría \"" + nomD + "\"?")) return;
    var listaD = subsDe(cd).filter(function (s, i) { return i !== kd; });
    var ld = writeBatch(db);
    ld.update(doc(db, "categorias", cd.id), { subcategorias: listaD });
    conSub.forEach(function (l) { ld.update(doc(db, "libros", l.id), { subcategoria: "" }); });
    ld.commit().then(function () {
      cd.subcategorias = listaD;
      conSub.forEach(function (l) { l.subcategoria = ""; });
      pintarCategorias(); avisar("Subcategoría eliminada"); publicarCatalogo();
    }).catch(function (err) { avisar(mensajeError(err), true); });
    return;
  }
  var mv = e.target.closest("[data-mover]");
  if (mv) {
    var i = parseInt(mv.dataset.mover, 10), j = i + parseInt(mv.dataset.dir, 10);
    if (j < 0 || j >= categorias.length) return;
    var copia = categorias.slice();
    var t = copia[i]; copia[i] = copia[j]; copia[j] = t;
    var b = writeBatch(db);
    copia.forEach(function (c, k) { b.update(doc(db, "categorias", c.id), { orden: k + 1 }); });
    b.commit().then(cargarCategorias).then(function () { pintarCategorias(); publicarCatalogo(); }).catch(function (err) { avisar(mensajeError(err), true); });
    return;
  }
  var rn = e.target.closest("[data-renombrar]");
  if (rn) {
    var c = categorias.find(function (x) { return x.id === rn.dataset.renombrar; });
    var nuevo = (prompt("Nuevo nombre para \"" + c.nombre + "\"", c.nombre) || "").trim().slice(0, 40);
    if (!nuevo || nuevo === c.nombre) return;
    var lote = writeBatch(db);
    lote.update(doc(db, "categorias", c.id), { nombre: nuevo });
    libros.filter(function (l) { return l.categoria === c.nombre; })
      .forEach(function (l) { lote.update(doc(db, "libros", l.id), { categoria: nuevo }); });
    lote.commit().then(function () {
        libros.forEach(function (l) { if (l.categoria === c.nombre) l.categoria = nuevo; });
        if (ajustes.categorias[c.nombre] !== undefined) {
          ajustes.categorias[nuevo] = ajustes.categorias[c.nombre];
          delete ajustes.categorias[c.nombre];
          campanas.forEach(function (cp) { if (cp.categoria === c.nombre) cp.categoria = nuevo; });
          guardarDocAjustes().catch(function () {});
        }
        return cargarCategorias();
      })
      .then(function () { pintarCategorias(); avisar("Categoría renombrada"); publicarCatalogo(); })
      .catch(function (err) { avisar(mensajeError(err), true); });
    return;
  }
  var del = e.target.closest("[data-borrar-cat]");
  if (del) {
    var cat = categorias.find(function (x) { return x.id === del.dataset.borrarCat; });
    var usados = libros.filter(function (l) { return l.categoria === cat.nombre; });
    var aviso = usados.length
      ? "\"" + cat.nombre + "\" tiene " + usados.length + " libro(s). Si la eliminas, esos libros quedan sin categoría. ¿Continuar?"
      : "¿Eliminar la categoría \"" + cat.nombre + "\"?";
    if (!confirm(aviso)) return;
    var lote2 = writeBatch(db);
    lote2.delete(doc(db, "categorias", cat.id));
    usados.forEach(function (l) { lote2.update(doc(db, "libros", l.id), { categoria: "", subcategoria: "" }); });
    lote2.commit().then(function () {
        usados.forEach(function (l) { l.categoria = ""; l.subcategoria = ""; });
        return cargarCategorias();
      })
      .then(function () { pintarCategorias(); avisar("Categoría eliminada"); publicarCatalogo(); })
      .catch(function (err) { avisar(mensajeError(err), true); });
  }
});


// ---------- Página principal: qué carruseles se muestran ----------
function interruptorHTML(clave, titulo, detalle, activo) {
  return '<label class="interruptor-fila">' +
    '<span class="interruptor-fila__texto"><strong>' + escapar(titulo) + "</strong><small>" + escapar(detalle) + "</small></span>" +
    '<input type="checkbox" class="switch" data-ajuste="' + escapar(clave) + '"' + (activo ? " checked" : "") + ">" +
    "</label>";
}
function pintarInicio() {
  var visibles = libros.filter(function (l) { return l.activo !== false; });
  var nDest = visibles.filter(function (l) { return l.destacado; }).length;
  var nVend = Object.keys(calcularVendidos()).length;
  var nNov = visibles.filter(function (l) { return l.creado || l.creadoMs; }).length;
  $("interruptores-especiales").innerHTML =
    interruptorHTML("destacados", "⭐ Destacados", nDest ? nDest + " libro(s) marcados como destacados" : "Aún no hay libros marcados. Márcalos al editar cada libro.", ajustes.destacados) +
    interruptorHTML("ofertas", "🏷️ Ofertas", (function () {
      var n = visibles.filter(function (l) { return precioEfectivo(l, campanas).descuento > 0; }).length;
      return n ? n + " libro(s) en oferta hoy" : "Aparece cuando haya libros en oferta (precio de oferta o campaña activa).";
    })(), ajustes.ofertas) +
    interruptorHTML("vendidos", "🔥 Más vendidos", nVend >= 3 ? nVend + " libro(s) con ventas en los últimos " + DIAS_VENDIDOS + " días"
      : "Aparece cuando haya al menos 3 libros vendidos (pedidos pagados o entregados, últimos " + DIAS_VENDIDOS + " días). Hoy: " + nVend + ".", ajustes.vendidos) +
    interruptorHTML("novedades", "🆕 Novedades", nNov >= 4 ? "Los últimos libros que cargaste" : "Aparece cuando haya al menos 4 libros creados con esta versión del panel. Hoy: " + nNov + ".", ajustes.novedades);
  $("interruptores-categorias").innerHTML = categorias.length ? categorias.map(function (c) {
    var n = visibles.filter(function (l) { return l.categoria === c.nombre; }).length;
    return interruptorHTML("cat:" + c.nombre, c.nombre, n >= 2 ? n + " libros" : "Necesita al menos 2 libros visibles (hoy: " + n + ")", ajustes.categorias[c.nombre] !== false);
  }).join("") : '<p class="estado">Todavía no hay categorías.</p>';
}
function guardarAjustes() {
  return guardarDocAjustes().then(publicarCatalogo);
}
document.addEventListener("change", function (e) {
  var i = e.target.closest("[data-ajuste]");
  if (!i) return;
  var clave = i.dataset.ajuste, anterior = JSON.stringify(ajustes);
  if (clave.indexOf("cat:") === 0) ajustes.categorias[clave.slice(4)] = i.checked;
  else ajustes[clave] = i.checked;
  guardarAjustes().then(function () { avisar(i.checked ? "Carrusel activado" : "Carrusel ocultado"); })
    .catch(function (err) { ajustes = JSON.parse(anterior); pintarInicio(); avisar(mensajeError(err), true); });
});

// ---------- Enlace propio del libro ----------
var BASE_TIENDA = new URL("../", location.href).href;
$("copiar-enlace").addEventListener("click", function () {
  var l = libros.find(function (x) { return x.id === libroEditando; });
  if (!l) return;
  var url = enlaceLibro(BASE_TIENDA, l);
  var listo = function () { avisar("Enlace copiado: pégalo en WhatsApp"); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(listo, function () { window.prompt("Copia este enlace:", url); });
  else window.prompt("Copia este enlace:", url);
});


// ---------- Ofertas y descuentos ----------
// Acepta "2026-12-24", "24/12/2026" o "24-12-2026".
function fechaDeCSV(v) {
  v = String(v || "").trim();
  var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return "";
}
function etiquetaOfertaPanel(l) {
  if (!(l.precioOferta > 0)) {
    var pc = precioEfectivo(l, campanas);
    return pc.descuento ? ' · <b class="txt-oferta">🏷️ -' + pc.descuento + "% (campaña)</b>" : "";
  }
  if (!vigente(l.ofertaHasta)) return ' · <span class="txt-vencida">oferta vencida</span>';
  return ' · <b class="txt-oferta">🏷️ ' + formatoPrecio(precioEfectivo(l, campanas).precio) + (l.ofertaHasta ? " hasta " + fechaCorta(l.ofertaHasta) : "") + "</b>";
}
function estadoCampana(c) {
  var hoy = hoyISO();
  if (c.activa === false) return ["Pausada", "pausada"];
  if (c.hasta && hoy > c.hasta) return ["Terminada", "terminada"];
  if (c.desde && hoy < c.desde) return ["Programada", "programada"];
  return ["Activa", "activa"];
}
function opcionesCampana() {
  var $c = $("campana-categoria"), actual = $c.value;
  $c.innerHTML = '<option value="">Todas las categorías</option>' + categorias.map(function (c) {
    return "<option" + (c.nombre === actual ? " selected" : "") + ">" + escapar(c.nombre) + "</option>";
  }).join("");
  opcionesCampanaSub();
}
function opcionesCampanaSub() {
  var cat = categoriaPorNombre($("campana-categoria").value);
  var subs = cat ? subsDe(cat) : [];
  $("campana-subcategoria").disabled = !subs.length;
  $("campana-subcategoria").innerHTML = '<option value="">' + (subs.length ? "Toda la categoría" : "—") + "</option>" +
    subs.map(function (s) { return "<option>" + escapar(s) + "</option>"; }).join("");
}
$("campana-categoria").addEventListener("change", opcionesCampanaSub);

function pintarOfertas() {
  // Anuncio
  var fa = $("form-anuncio");
  fa.activo.checked = !!anuncio.activo; fa.texto.value = anuncio.texto || ""; fa.hasta.value = anuncio.hasta || "";
  pintarVistaAnuncio();
  // Campañas
  opcionesCampana();
  var fc = $("form-campana");
  if (!fc.desde.value) fc.desde.value = hoyISO();
  $("lista-campanas").innerHTML = campanas.length ? campanas.slice().sort(function (a, b) { return String(b.desde).localeCompare(a.desde); }).map(function (c) {
    var est = estadoCampana(c);
    var alcance = c.categoria ? c.categoria + (c.subcategoria ? " › " + c.subcategoria : "") : "Todas las categorías";
    var n = libros.filter(function (l) { return l.activo !== false && (!c.categoria || l.categoria === c.categoria) && (!c.subcategoria || l.subcategoria === c.subcategoria); }).length;
    return '<div class="campana">' +
      '<div class="campana__info"><strong>' + escapar(c.nombre) + ' <span class="estado-campana estado-campana--' + est[1] + '">' + est[0] + "</span></strong>" +
        "<span>-" + c.porcentaje + "% · " + escapar(alcance) + " (" + n + " libros) · " + fechaCorta(c.desde) + " al " + fechaCorta(c.hasta) + "</span></div>" +
      '<div class="campana__acciones">' +
        (est[1] !== "terminada" ? '<button type="button" class="boton boton--texto" data-pausar="' + c.id + '">' + (c.activa === false ? "Reanudar" : "Pausar") + "</button>" : "") +
        '<button type="button" class="boton boton--texto texto-error" data-borrar-campana="' + c.id + '">Eliminar</button>' +
      "</div></div>";
  }).join("") : '<p class="estado">Todavía no hay campañas.</p>';
  // Libros con oferta propia
  var conOferta = libros.filter(function (l) { return l.precioOferta > 0; })
    .sort(function (a, b) { return String(a.nombre).localeCompare(b.nombre, "es"); });
  $("lista-ofertas-libros").innerHTML = conOferta.length ? '<ul class="ranking ranking--simple">' + conOferta.map(function (l) {
    var v = vigente(l.ofertaHasta);
    return "<li><span>" + escapar(l.nombre) + " — <s>" + formatoPrecio(l.precio) + "</s> " + formatoPrecio(l.precioOferta) +
      (l.ofertaHasta ? " · hasta " + fechaCorta(l.ofertaHasta) : "") + (v ? "" : ' <span class="txt-vencida">(vencida)</span>') + "</span>" +
      '<strong><button type="button" class="boton boton--texto" data-editar-oferta="' + l.id + '">Editar</button>' +
      '<button type="button" class="boton boton--texto texto-error" data-quitar-oferta="' + l.id + '">Quitar oferta</button></strong></li>';
  }).join("") + "</ul>" : '<p class="estado">Ningún libro tiene precio de oferta. Se pone al editar cada libro, en "Precio de oferta".</p>';
}

function pintarVistaAnuncio() {
  var fa = $("form-anuncio");
  var t = fa.texto.value.trim();
  $("anuncio-vista").innerHTML = t ? '<span class="anuncio-vista__etiqueta">Vista previa:</span><div class="anuncio-vista__barra">' + escapar(t) + "</div>" : "";
}
$("form-anuncio").texto.addEventListener("input", pintarVistaAnuncio);
$("form-anuncio").addEventListener("submit", function (e) {
  e.preventDefault();
  var fa = e.target, antes = JSON.stringify(anuncio);
  anuncio = { activo: fa.activo.checked, texto: fa.texto.value.trim().slice(0, 120), hasta: fa.hasta.value || "" };
  if (anuncio.activo && !anuncio.texto) { anuncio = JSON.parse(antes); avisar("Escribe el texto del anuncio", true); return; }
  guardarDocAjustes().then(publicarCatalogo).then(function () { avisar(anuncio.activo ? "Anuncio publicado" : "Anuncio guardado (oculto)"); })
    .catch(function (err) { anuncio = JSON.parse(antes); avisar(mensajeError(err), true); });
});

$("form-campana").addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target, $err = $("error-campana");
  var c = {
    id: Date.now().toString(36), nombre: f.nombre.value.trim().slice(0, 40),
    categoria: f.categoria.value, subcategoria: f.subcategoria.disabled ? "" : f.subcategoria.value,
    porcentaje: Math.round(Number(f.porcentaje.value) || 0), desde: f.desde.value, hasta: f.hasta.value, activa: true
  };
  var problema = !c.nombre ? "Ponle un nombre a la campaña."
    : !(c.porcentaje >= 1 && c.porcentaje <= 90) ? "El descuento debe estar entre 1% y 90%."
    : !c.desde || !c.hasta ? "Elige las fechas de inicio y fin."
    : c.hasta < c.desde ? "La fecha de fin debe ser después de la de inicio."
    : c.hasta < hoyISO() ? "Esa fecha de fin ya pasó." : "";
  $err.hidden = !problema; $err.textContent = problema;
  if (problema) return;
  campanas.push(c);
  guardarDocAjustes().then(publicarCatalogo).then(function () {
    f.reset(); f.desde.value = hoyISO(); pintarOfertas(); avisar("Campaña creada");
  }).catch(function (err) { campanas.pop(); avisar(mensajeError(err), true); });
});

$("lista-campanas").addEventListener("click", function (e) {
  var p = e.target.closest("[data-pausar]"), d = e.target.closest("[data-borrar-campana]");
  if (!p && !d) return;
  var id = (p || d).dataset[p ? "pausar" : "borrarCampana"];
  var antes = JSON.stringify(campanas);
  var c = campanas.find(function (x) { return x.id === id; });
  if (!c) return;
  if (d) { if (!confirm("¿Eliminar la campaña \"" + c.nombre + "\"?")) return; campanas = campanas.filter(function (x) { return x.id !== id; }); }
  else c.activa = c.activa === false;
  guardarDocAjustes().then(publicarCatalogo).then(function () { pintarOfertas(); avisar(d ? "Campaña eliminada" : (c.activa ? "Campaña reanudada" : "Campaña pausada")); })
    .catch(function (err) { campanas = JSON.parse(antes); avisar(mensajeError(err), true); });
});

$("lista-ofertas-libros").addEventListener("click", function (e) {
  var ed = e.target.closest("[data-editar-oferta]");
  if (ed) { abrirEditor(ed.dataset.editarOferta); setTimeout(function () { $form.precioOferta.focus(); }, 50); return; }
  var q = e.target.closest("[data-quitar-oferta]");
  if (!q) return;
  var l = libros.find(function (x) { return x.id === q.dataset.quitarOferta; });
  if (!l) return;
  updateDoc(doc(db, "libros", l.id), { precioOferta: 0, ofertaHasta: "", actualizado: serverTimestamp() }).then(function () {
    l.precioOferta = 0; l.ofertaHasta = "";
    pintarOfertas(); avisar("Oferta quitada"); publicarCatalogo();
  }).catch(function (err) { avisar(mensajeError(err), true); });
});


// ---------- Respaldo ----------
var DIAS_RECORDAR_RESPALDO = 30;
function diasDesde(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null; }
function textoUltimoRespaldo() {
  var d = diasDesde(ultimoRespaldo);
  if (d === null) return "Todavía no has descargado ningún respaldo.";
  var f = new Date(ultimoRespaldo).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  return "Último respaldo: " + f + (d === 0 ? " (hoy)" : d === 1 ? " (ayer)" : " (hace " + d + " días)") + ".";
}
function pintarRecordatorioRespaldo() {
  var d = diasDesde(ultimoRespaldo), $r = $("recordatorio-respaldo");
  var mostrar = libros.length > 0 && (d === null || d >= DIAS_RECORDAR_RESPALDO);
  $r.hidden = !mostrar;
  if (mostrar) $r.innerHTML = "💾 " + (d === null ? "Aún no has descargado un respaldo de la tienda." : "Hace " + d + " días que no descargas un respaldo.") +
    ' <a href="#respaldo">Hacer respaldo ahora →</a>';
}
function pintarRespaldo() {
  $("ultimo-respaldo").textContent = textoUltimoRespaldo();
  $("ultimo-respaldo").classList.toggle("ultimo-respaldo--alerta", diasDesde(ultimoRespaldo) === null || diasDesde(ultimoRespaldo) >= DIAS_RECORDAR_RESPALDO);
  var conFoto = libros.filter(function (l) { return l.foto; }).length;
  var nInt = libros.reduce(function (s, l) { return s + (l.interiores || 0); }, 0);
  $("dato-libros").textContent = libros.length + " libro" + (libros.length === 1 ? "" : "s") + " en el catálogo";
  var mb = Math.max(1, Math.round((conFoto * 0.2 + nInt * 0.33) * 1.35));
  $("peso-fotos").textContent = (conFoto + nInt) ? "(" + (conFoto + nInt) + " fotos, unos " + mb + " MB)" : "(no hay fotos)";
}

function descargar(nombre, contenido, tipo) {
  var blob = new Blob([contenido], { type: tipo });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
// CSV para Excel en español: separado por punto y coma, con BOM para que se vean bien las tildes.
function celda(v) {
  if (v === null || v === undefined) return "";
  var t = String(v);
  return /[";\n\r,]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function texto(v) { return v ? '="' + String(v).replace(/"/g, "") + '"' : ""; }   // que Excel no lo convierta en número
function aCSV(filas) { return "\uFEFF" + filas.map(function (f) { return f.map(celda).join(";"); }).join("\r\n"); }
function fechaArchivo() { return hoyISO(); }
function aISO(v) {
  if (v && typeof v.toDate === "function") return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(aISO);
  if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = aISO(v[k]); }); return o; }
  return v;
}

function csvLibros() {
  var filas = [["Nombre", "Autor", "Editorial", "ISBN", "Categoría", "Subcategoría", "Precio", "Precio oferta", "Oferta hasta",
    "Stock", "Páginas", "Peso", "Dimensiones", "Cubierta", "Descripción", "Visible", "Destacado"]];
  libros.slice().sort(function (a, b) { return String(a.nombre).localeCompare(b.nombre, "es"); }).forEach(function (l) {
    filas.push([l.nombre, l.autor, l.editorial, texto(l.isbn), l.categoria, l.subcategoria, l.precio || 0,
      l.precioOferta || "", l.ofertaHasta || "", l.stock || 0, l.paginas || "", l.peso || "", l.dimensiones || "", l.cubierta || "",
      l.descripcion || "", l.activo === false ? "No" : "Sí", l.destacado ? "Sí" : "No"]);
  });
  return aCSV(filas);
}

function todosLosPedidos() {
  return getDocs(collection(db, "pedidos")).then(function (s) {
    return s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; })
      .sort(function (a, b) { return ((fecha(b.creado) || 0) - (fecha(a.creado) || 0)); });
  });
}
function csvPedidos(lista) {
  var filas = [["Pedido", "Fecha", "Estado", "Cliente", "Teléfono", "Notas", "Libros", "Unidades", "Total"]];
  lista.forEach(function (p) {
    var c = p.cliente || {}, f = fecha(p.creado);
    var items = p.items || [];
    filas.push([codigoPedido(p.id), f ? f.toLocaleString("es-CO") : "", (ESTADOS[p.estado] || {}).nombre || p.estado,
      c.nombre || "", texto(c.telefono), c.notas || "",
      items.map(function (it) { return (it.cantidad || 0) + " x " + it.nombre + " (" + formatoPrecio(it.precio) + ")"; }).join(" | "),
      items.reduce(function (s, it) { return s + (it.cantidad || 0); }, 0), p.total || 0]);
  });
  return aCSV(filas);
}
function filtrarPedidos(lista, rango) {
  var ahora = new Date();
  return lista.filter(function (p) {
    var f = fecha(p.creado) || new Date(0);
    if (rango === "anio") return f.getFullYear() === ahora.getFullYear();
    if (rango === "mes") return f.getFullYear() === ahora.getFullYear() && f.getMonth() === ahora.getMonth();
    if (rango === "ventas") return p.estado === "pagado" || p.estado === "entregado";
    return true;
  });
}
function leerColeccion(nombre) {
  return getDocs(collection(db, nombre)).then(function (s) {
    var o = {}; s.docs.forEach(function (d) { o[d.id] = d.data().imagen || ""; }); return o;
  });
}
function respaldoCompleto(conFotos) {
  return Promise.all([todosLosPedidos(), conFotos ? leerColeccion("portadas") : null, conFotos ? leerColeccion("interiores") : null])
    .then(function (r) {
      var datos = {
        tipo: "respaldo-praisesync-books-web", version: 1, fecha: new Date().toISOString(), tienda: (window.TIENDA || {}).nombre || "",
        libros: aISO(libros), categorias: aISO(categorias),
        ajustes: { secciones: ajustes, campanas: campanas, anuncio: anuncio, banners: banners },
        pedidos: aISO(r[0])
      };
      if (conFotos) { datos.portadas = r[1]; datos.interiores = r[2]; }
      return JSON.stringify(datos, null, conFotos ? 0 : 1);
    });
}
function marcarRespaldo() {
  ultimoRespaldo = new Date().toISOString();
  guardarDocAjustes().catch(function () {});
  pintarRespaldo();
}

$("vista-panel").addEventListener("click", function (e) {
  var b = e.target.closest("[data-respaldo]");
  if (!b) return;
  var tipo = b.dataset.respaldo, textoBoton = b.textContent;
  b.disabled = true; b.textContent = "Preparando…";
  var trabajo;
  if (tipo === "libros") {
    trabajo = Promise.resolve().then(function () {
      descargar("praisesync-libros-" + fechaArchivo() + ".csv", csvLibros(), "text/csv;charset=utf-8");
      return libros.length + " libros descargados";
    });
  } else if (tipo === "pedidos") {
    var rango = $("rango-pedidos").value;
    trabajo = todosLosPedidos().then(function (lista) {
      var f = filtrarPedidos(lista, rango);
      descargar("praisesync-pedidos-" + rango + "-" + fechaArchivo() + ".csv", csvPedidos(f), "text/csv;charset=utf-8");
      return f.length + " pedidos descargados";
    });
  } else {
    var conFotos = $("incluir-fotos").checked;
    trabajo = respaldoCompleto(conFotos).then(function (json) {
      descargar("praisesync-respaldo" + (conFotos ? "-con-fotos" : "") + "-" + fechaArchivo() + ".json", json, "application/json");
      marcarRespaldo();
      return "Respaldo completo descargado";
    });
  }
  trabajo.then(function (msg) {
    if (tipo !== "completo") marcarRespaldo();
    avisar(msg);
  }).catch(function (err) { avisar(mensajeError(err), true); })
    .finally(function () { b.disabled = false; b.textContent = textoBoton; });
});


// ---------- Banners principales ----------
var MAX_BANNERS = 5;
var fotosBanners = {};   // "id" o "id_cel" -> dataURL
var bannerEditando = null, fotoBanner = "", fotoBannerCel = "", fotoBannerOrig = "", fotoBannerCelOrig = "";
function fotoDeBanner(clave) {
  if (fotosBanners[clave] !== undefined) return Promise.resolve(fotosBanners[clave]);
  return getDoc(doc(db, "banners", clave)).then(function (s) { fotosBanners[clave] = s.exists() ? s.data().imagen : ""; return fotosBanners[clave]; })
    .catch(function () { return ""; });
}
function estadoBanner(b) {
  var hoy = hoyISO();
  if (b.activo === false) return ["Oculto", "pausada"];
  if (b.hasta && hoy > b.hasta) return ["Terminado", "terminada"];
  if (b.desde && hoy < b.desde) return ["Programado", "programada"];
  return ["Visible", "activa"];
}
function textoDestino(b) {
  if (b.destinoTipo === "libro") { var l = libros.find(function (x) { return x.id === b.destino; }); return "Libro: " + (l ? l.nombre : "(ya no existe)"); }
  if (b.destinoTipo === "categoria") return "Categoría: " + b.destino;
  if (b.destinoTipo === "ofertas") return "Ofertas";
  if (b.destinoTipo === "enlace") return "Enlace: " + b.destino;
  return "Sin enlace";
}
function pintarBannersPanel() {
  pintarAltura();
  $("nuevo-banner").disabled = banners.length >= MAX_BANNERS;
  $("nuevo-banner").title = banners.length >= MAX_BANNERS ? "Máximo " + MAX_BANNERS + " banners" : "";
  $("lista-banners").innerHTML = banners.length ? banners.map(function (b, i) {
    var est = estadoBanner(b);
    var fechas = b.desde || b.hasta ? " · " + (b.desde ? "desde " + fechaCorta(b.desde) : "") + (b.hasta ? " hasta " + fechaCorta(b.hasta) : "") : "";
    return '<div class="fila-banner">' +
      '<div class="categoria-fila__orden">' +
        '<button type="button" class="icono-boton icono-boton--chico" data-mover-banner="' + i + '" data-dir="-1" aria-label="Subir"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button type="button" class="icono-boton icono-boton--chico" data-mover-banner="' + i + '" data-dir="1" aria-label="Bajar"' + (i === banners.length - 1 ? " disabled" : "") + ">↓</button>" +
      "</div>" +
      '<button type="button" class="fila-banner__mini" data-editar-banner="' + b.id + '" data-mini-banner="' + b.id + '" aria-label="Editar banner"></button>' +
      '<div class="fila-banner__info"><strong>' + escapar(b.titulo || "(Solo imagen)") + ' <span class="estado-campana estado-campana--' + est[1] + '">' + est[0] + "</span></strong>" +
        "<span>" + escapar(textoDestino(b)) + fechas + (b.cel ? " · 📱 con foto de celular" : "") + "</span></div>" +
      '<div class="campana__acciones">' +
        '<button type="button" class="boton boton--texto" data-editar-banner="' + b.id + '">Editar</button>' +
        '<button type="button" class="boton boton--texto texto-error" data-borrar-banner="' + b.id + '">Eliminar</button>' +
      "</div></div>";
  }).join("") : '<p class="estado">Todavía no hay banners. Crea el primero con "+ Nuevo banner".</p>';
  banners.forEach(function (b) {
    fotoDeBanner(b.id).then(function (url) {
      var el = document.querySelector('[data-mini-banner="' + b.id + '"]');
      if (el && url) el.style.backgroundImage = 'url("' + url + '")';
    });
  });
}

function opcionesDestino(b) {
  $("banner-libro").innerHTML = libros.filter(function (l) { return l.activo !== false; })
    .sort(function (a, c) { return String(a.nombre).localeCompare(c.nombre, "es"); })
    .map(function (l) { return '<option value="' + l.id + '"' + (b && b.destinoTipo === "libro" && b.destino === l.id ? " selected" : "") + ">" + escapar(l.nombre) + "</option>"; }).join("");
  $("banner-categoria").innerHTML = categorias.map(function (c) {
    return "<option" + (b && b.destinoTipo === "categoria" && b.destino === c.nombre ? " selected" : "") + ">" + escapar(c.nombre) + "</option>";
  }).join("");
}
function mostrarCampoDestino() {
  var t = $("banner-destino-tipo").value;
  $("campo-banner-libro").hidden = t !== "libro";
  $("campo-banner-categoria").hidden = t !== "categoria";
  $("campo-banner-enlace").hidden = t !== "enlace";
}
function pintarVistaBanner() {
  var f = $("form-banner");
  $("vista-banner-fondo").style.backgroundImage = fotoBanner ? 'url("' + fotoBanner + '")' : "";
  $("vista-banner-titulo").textContent = f.titulo.value.trim(); $("vista-banner-titulo").hidden = !f.titulo.value.trim();
  $("vista-banner-subtitulo").textContent = f.subtitulo.value.trim(); $("vista-banner-subtitulo").hidden = !f.subtitulo.value.trim();
  var conBoton = f.boton.value.trim() && f.destinoTipo.value;
  $("vista-banner-boton").textContent = f.boton.value.trim(); $("vista-banner-boton").hidden = !conBoton;
  $("mini-cel").style.backgroundImage = fotoBannerCel ? 'url("' + fotoBannerCel + '")' : "";
  $("mini-cel").hidden = !fotoBannerCel; $("quitar-banner-cel").hidden = !fotoBannerCel;
}
function abrirEditorBanner(id) {
  var b = id ? banners.find(function (x) { return x.id === id; }) : null;
  bannerEditando = b ? b.id : null;
  var f = $("form-banner");
  f.reset();
  $("titulo-modal-banner").textContent = b ? "Editar banner" : "Nuevo banner";
  f.titulo.value = b ? b.titulo || "" : ""; f.subtitulo.value = b ? b.subtitulo || "" : ""; f.boton.value = b ? b.boton || "" : "";
  f.destinoTipo.value = b ? b.destinoTipo || "" : "";
  f.enlace.value = b && b.destinoTipo === "enlace" ? b.destino || "" : "";
  f.desde.value = b ? b.desde || "" : ""; f.hasta.value = b ? b.hasta || "" : "";
  f.activo.checked = b ? b.activo !== false : true;
  opcionesDestino(b); mostrarCampoDestino();
  $("error-banner").hidden = true;
  fotoBanner = fotoBannerCel = fotoBannerOrig = fotoBannerCelOrig = "";
  pintarVistaBanner();
  if (b) {
    fotoDeBanner(b.id).then(function (u) { if (bannerEditando === b.id) { fotoBanner = fotoBannerOrig = u; pintarVistaBanner(); } });
    if (b.cel) fotoDeBanner(b.id + "_cel").then(function (u) { if (bannerEditando === b.id) { fotoBannerCel = fotoBannerCelOrig = u; pintarVistaBanner(); } });
  }
  $("modal-banner").showModal();
}

$("nuevo-banner").addEventListener("click", function () { abrirEditorBanner(null); });
$("banner-destino-tipo").addEventListener("change", function () { mostrarCampoDestino(); pintarVistaBanner(); });
["titulo", "subtitulo", "boton"].forEach(function (n) { $("form-banner")[n].addEventListener("input", pintarVistaBanner); });
$("modal-banner").addEventListener("click", function (e) {
  if (e.target.closest("[data-cerrar]") || e.target === $("modal-banner")) $("modal-banner").close();
});
$("input-banner").addEventListener("change", function (e) {
  var a = e.target.files && e.target.files[0]; e.target.value = "";
  if (!a) return;
  comprimirFoto(a, 1600, 480000).then(function (u) { fotoBanner = u; $("error-banner").hidden = true; pintarVistaBanner(); })
    .catch(function () { avisar("No se pudo leer esa imagen", true); });
});
$("input-banner-cel").addEventListener("change", function (e) {
  var a = e.target.files && e.target.files[0]; e.target.value = "";
  if (!a) return;
  comprimirFoto(a, 1000, 360000).then(function (u) { fotoBannerCel = u; pintarVistaBanner(); })
    .catch(function () { avisar("No se pudo leer esa imagen", true); });
});
$("quitar-banner-cel").addEventListener("click", function () { fotoBannerCel = ""; pintarVistaBanner(); });

$("form-banner").addEventListener("submit", function (e) {
  e.preventDefault();
  var f = e.target, $err = $("error-banner"), $btn = $("guardar-banner");
  var tipo = f.destinoTipo.value;
  var destino = tipo === "libro" ? f.libro.value : tipo === "categoria" ? f.categoria.value : tipo === "enlace" ? f.enlace.value.trim() : "";
  var problema = !fotoBanner ? "Elige la foto para computador."
    : (tipo === "libro" || tipo === "categoria") && !destino ? "Elige a qué " + (tipo === "libro" ? "libro" : "categoría") + " lleva el banner."
    : tipo === "enlace" && !/^https?:\/\/\S+\.\S+/i.test(destino) ? "Escribe un enlace completo, que empiece por https://"
    : f.desde.value && f.hasta.value && f.hasta.value < f.desde.value ? "La fecha final debe ser después de la inicial." : "";
  $err.hidden = !problema; $err.textContent = problema;
  if (problema) return;
  var id = bannerEditando || ("b" + Date.now().toString(36));
  var datos = {
    id: id, titulo: f.titulo.value.trim(), subtitulo: f.subtitulo.value.trim(), boton: f.boton.value.trim(),
    destinoTipo: tipo, destino: destino, desde: f.desde.value || "", hasta: f.hasta.value || "",
    activo: f.activo.checked, cel: !!fotoBannerCel
  };
  var antes = JSON.stringify(banners);
  var i = banners.findIndex(function (x) { return x.id === id; });
  if (i === -1) banners.push(datos); else banners[i] = datos;
  $btn.disabled = true; $btn.textContent = "Guardando…";
  var lote = writeBatch(db);
  lote.set(doc(db, "tienda", "ajustes"), datosAjustes());
  if (fotoBanner !== fotoBannerOrig) lote.set(doc(db, "banners", id), { imagen: fotoBanner });
  if (fotoBannerCel !== fotoBannerCelOrig) {
    if (fotoBannerCel) lote.set(doc(db, "banners", id + "_cel"), { imagen: fotoBannerCel });
    else lote.delete(doc(db, "banners", id + "_cel"));
  }
  lote.commit().then(function () {
    fotosBanners[id] = fotoBanner; fotosBanners[id + "_cel"] = fotoBannerCel;
    $("modal-banner").close(); pintarBannersPanel(); avisar(i === -1 ? "Banner creado" : "Banner actualizado");
    return publicarCatalogo();
  }).catch(function (err) {
    banners = JSON.parse(antes); $err.hidden = false; $err.textContent = mensajeError(err);
  }).finally(function () { $btn.disabled = false; $btn.textContent = "Guardar banner"; });
});

$("lista-banners").addEventListener("click", function (e) {
  var ed = e.target.closest("[data-editar-banner]");
  if (ed) { abrirEditorBanner(ed.dataset.editarBanner); return; }
  var mv = e.target.closest("[data-mover-banner]");
  var del = e.target.closest("[data-borrar-banner]");
  if (!mv && !del) return;
  var antes = JSON.stringify(banners);
  var lote = writeBatch(db), mensaje;
  if (mv) {
    var a = Number(mv.dataset.moverBanner), c = a + Number(mv.dataset.dir);
    if (c < 0 || c >= banners.length) return;
    var t = banners[a]; banners[a] = banners[c]; banners[c] = t;
    mensaje = "Orden actualizado";
  } else {
    var b = banners.find(function (x) { return x.id === del.dataset.borrarBanner; });
    if (!b || !confirm("¿Eliminar el banner \"" + (b.titulo || "sin título") + "\"?")) return;
    banners = banners.filter(function (x) { return x.id !== b.id; });
    lote.delete(doc(db, "banners", b.id)); lote.delete(doc(db, "banners", b.id + "_cel"));
    mensaje = "Banner eliminado";
  }
  lote.set(doc(db, "tienda", "ajustes"), datosAjustes());
  lote.commit().then(function () { pintarBannersPanel(); avisar(mensaje); return publicarCatalogo(); })
    .catch(function (err) { banners = JSON.parse(antes); pintarBannersPanel(); avisar(mensajeError(err), true); });
});

// Altura de los banners: cambia el tamaño en la tienda y las recomendaciones de foto.
var ALTURAS = {
  baja:  { nombre: "Baja", detalle: "igual que la franja azul (unos 145 px)", foto: "1600 × 180", cel: false, proporcion: "1280 / 145" },
  media: { nombre: "Media", detalle: "unos 280 px", foto: "1600 × 350", cel: false, proporcion: "1280 / 280" },
  alta:  { nombre: "Alta", detalle: "unos 460 px, como una portada grande", foto: "1600 × 600", cel: true, proporcion: "8 / 3" }
};
function pintarAltura() {
  var a = ALTURAS[bannerAltura] || ALTURAS.baja;
  $("altura-banners").value = bannerAltura;
  $("altura-ayuda").textContent = "Altura " + a.nombre.toLowerCase() + ": " + a.detalle + ". Foto recomendada: " + a.foto + " píxeles" +
    (a.cel ? "; para celular, una vertical de 800 × 1000." : ". En esta altura se usa la misma foto en el celular.");
  $("consejo-foto").innerHTML = "<b>Computador:</b> horizontal, " + a.foto + " píxeles.";
  $("consejo-cel").hidden = !a.cel;
  $("campo-foto-cel").hidden = !a.cel;
  $("vista-banner").style.aspectRatio = a.proporcion;
  $("vista-banner").className = "vista-banner vista-banner--" + bannerAltura;
}
$("altura-banners").addEventListener("change", function (e) {
  var antes = bannerAltura;
  bannerAltura = e.target.value;
  pintarAltura();
  guardarDocAjustes().then(publicarCatalogo).then(function () { avisar("Altura de los banners: " + ALTURAS[bannerAltura].nombre); })
    .catch(function (err) { bannerAltura = antes; pintarAltura(); avisar(mensajeError(err), true); });
});
