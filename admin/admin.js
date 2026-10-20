import { app, db, configurado } from "../firebase.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction,
  serverTimestamp, deleteField, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoPrecio, aNumero, sinTildes, escapar, enlaceWhatsApp, codigoPedido, leerCSV, portadaVaciaHTML } from "../util.js";

var auth = getAuth(app);
var $ = function (id) { return document.getElementById(id); };

var libros = [], categorias = [], pedidos = [];
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
function cargarTodo() {
  // Pedidos primero: solo una cuenta administradora puede leerlos.
  return cargarPedidos()
    .then(function () { return Promise.all([cargarLibros(), cargarCategorias()]); })
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
        precio: typeof l.precio === "number" ? l.precio : 0, stock: l.stock || 0,
        resumen: resumenDe(d), larga: d.length > LARGO_RESUMEN, foto: l.foto || 0
      };
    }),
    categorias: categorias.map(function (c) { return c.nombre; }),
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
  });
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
var PESTANAS = ["resumen", "pedidos", "libros", "categorias"];
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
}

// ---------- Resumen ----------
function esVenta(p) { return p.estado === "pagado" || p.estado === "entregado"; }
function fechaVenta(p) { return fecha(p.pagadoEn) || fecha(p.creado) || new Date(0); }

function pintarResumen() {
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
    return !q || sinTildes(l.nombre + " " + l.autor + " " + l.categoria).indexOf(q) !== -1;
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
        "<span>" + escapar([l.autor, l.categoria].filter(Boolean).join(" · ")) + "</span>" +
        "<span>" + formatoPrecio(l.precio) + (l.activo === false ? ' · <em>Oculto</em>' : "") + "</span>" +
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

$("select-categoria").addEventListener("change", function (e) {
  if (e.target.value !== "__nueva") return;
  var nombre = (prompt("Nombre de la nueva categoría") || "").trim().slice(0, 40);
  if (!nombre) { e.target.value = ""; return; }
  crearCategoria(nombre).then(function () { opcionesCategoria(nombre); })
    .catch(function (err) { e.target.value = ""; avisar(mensajeError(err), true); });
});

function pintarFoto() {
  $("vista-foto").innerHTML = fotoEditando ? '<img src="' + fotoEditando + '" alt="">' : portadaVaciaHTML("Sin foto");
  $("quitar-foto").hidden = !fotoEditando;
}

var fotoOriginal = "";
function abrirEditor(id) {
  var l = id ? libros.find(function (x) { return x.id === id; }) : null;
  libroEditando = l ? l.id : null;
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
  $form.precio.value = l && typeof l.precio === "number" ? l.precio : "";
  $form.stock.value = l ? (l.stock || 0) : 0;
  $form.descripcion.value = l ? l.descripcion || "" : "";
  $form.activo.checked = l ? l.activo !== false : true;
  opcionesCategoria(l ? l.categoria || "" : "");
  $("borrar-libro").hidden = !l;
  $("error-libro").hidden = true;
  pintarFoto();
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
function comprimirFoto(archivo) {
  return new Promise(function (resolver, rechazar) {
    var lector = new FileReader();
    lector.onerror = rechazar;
    lector.onload = function () {
      var img = new Image();
      img.onerror = rechazar;
      img.onload = function () {
        var lado = 640;
        var escala = Math.min(1, lado / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var calidad = 0.82, url = c.toDataURL("image/jpeg", calidad);
        while (url.length > 270000 && calidad > 0.4) { calidad -= 0.1; url = c.toDataURL("image/jpeg", calidad); }
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

$form.addEventListener("submit", function (e) {
  e.preventDefault();
  var $err = $("error-libro"), $btn = $("guardar-libro");
  var precio = aNumero($form.precio.value);
  var datos = {
    nombre: $form.nombre.value.trim(),
    autor: $form.autor.value.trim(),
    categoria: $form.categoria.value === "__nueva" ? "" : $form.categoria.value,
    precio: precio,
    stock: Math.max(0, parseInt($form.stock.value, 10) || 0),
    descripcion: $form.descripcion.value.trim(),
    activo: $form.activo.checked,
    actualizado: serverTimestamp()
  };
  var cambioFoto = fotoEditando !== fotoOriginal;
  if (!datos.nombre) { $err.hidden = false; $err.textContent = "El nombre es obligatorio."; return; }
  if (precio === null) { $err.hidden = false; $err.textContent = "Escribe el precio, solo números. Ej: 85000"; return; }
  $err.hidden = true; $btn.disabled = true; $btn.textContent = "Guardando…";
  var ref = libroEditando ? doc(db, "libros", libroEditando) : doc(collection(db, "libros"));
  var id = ref.id, esNuevo = !libroEditando;
  var local = libros.find(function (x) { return x.id === id; });
  datos.foto = cambioFoto ? (fotoEditando ? Date.now() : 0) : ((local && local.foto) || 0);
  var b = writeBatch(db);
  if (esNuevo) b.set(ref, Object.assign({ creado: serverTimestamp() }, datos));
  else b.update(ref, datos);
  if (cambioFoto) {
    if (fotoEditando) b.set(doc(db, "portadas", id), { imagen: fotoEditando });
    else b.delete(doc(db, "portadas", id));
  }
  b.commit().then(function () {
    var copia = Object.assign({}, datos, { id: id });
    delete copia.actualizado;
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
    libros.forEach(function (l) { existentes[sinTildes(l.nombre + "|" + (l.autor || ""))] = l.id; });
    var nuevos = 0, actualizados = 0;
    var cats = {};
    var operaciones = filas.map(function (f) {
      var datos = {
        nombre: f.nombre, autor: f.autor || "", categoria: f.categoria || "",
        precio: aNumero(f.precio) || 0, stock: aNumero(f.stock) || 0,
        descripcion: f.descripcion || "", actualizado: serverTimestamp()
      };
      if (datos.categoria) cats[datos.categoria] = true;
      var id = existentes[sinTildes(f.nombre + "|" + (f.autor || ""))];
      if (id) { actualizados++; return { id: id, datos: datos }; }
      nuevos++;
      return { id: null, datos: Object.assign({ activo: true, foto: 0, creado: serverTimestamp() }, datos) };
    });
    var msg = "Se van a importar " + filas.length + " libros:\n• " + nuevos + " nuevos\n• " + actualizados +
      " ya existían (se actualizan precio, stock y datos; la foto se conserva)\n\n¿Continuar?";
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
        operaciones.forEach(function (op) {
          var copia = Object.assign({}, op.datos, { id: op.id });
          delete copia.actualizado; delete copia.creado;
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
    usados.forEach(function (l) { lote2.update(doc(db, "libros", l.id), { categoria: "" }); });
    lote2.commit().then(function () {
        usados.forEach(function (l) { l.categoria = ""; });
        return cargarCategorias();
      })
      .then(function () { pintarCategorias(); avisar("Categoría eliminada"); publicarCatalogo(); })
      .catch(function (err) { avisar(mensajeError(err), true); });
  }
});
