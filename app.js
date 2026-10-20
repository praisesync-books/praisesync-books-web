(function () {
  "use strict";

  var T = window.TIENDA;
  var libros = [];
  var categoriaActiva = "Todas";

  var $grilla = document.getElementById("grilla");
  var $estado = document.getElementById("estado");
  var $buscar = document.getElementById("buscar");
  var $categorias = document.getElementById("categorias");

  document.getElementById("anio").textContent = new Date().getFullYear();
  document.getElementById("nombre-tienda").textContent = T.nombre;
  document.getElementById("whatsapp-general").href = enlaceWhatsApp(T.mensajeGeneral);

  // ---------- Utilidades ----------
  function enlaceWhatsApp(texto) {
    return "https://wa.me/" + T.whatsapp + "?text=" + encodeURIComponent(texto);
  }

  function formatoPrecio(n) {
    if (n === null) return "";
    return "$" + n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
  }

  function aNumero(valor) {
    var limpio = String(valor || "").replace(/[^\d]/g, "");
    return limpio === "" ? null : parseInt(limpio, 10);
  }

  function sinTildes(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function escapar(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Lee CSV con comas o punto y coma (Excel en español guarda con ;), y textos entre comillas.
  function leerCSV(texto) {
    texto = texto.replace(/^\uFEFF/, "");
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

    var encabezados = filas.shift().map(function (h) { return sinTildes(h.trim()); });
    return filas
      .filter(function (f) { return f.some(function (v) { return v.trim() !== ""; }); })
      .map(function (f) {
        var o = {};
        encabezados.forEach(function (h, idx) { o[h] = (f[idx] || "").trim(); });
        return o;
      });
  }

  // ---------- Portada de respaldo cuando no hay foto ----------
  function portadaVacia(titulo) {
    var div = document.createElement("div");
    div.className = "tarjeta__sin-foto";
    div.innerHTML =
      '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5Z"/><path d="M12 7v6M9 10h6"/></svg>' +
      "<span>" + escapar(titulo) + "</span>";
    return div;
  }

  // ---------- Pintar ----------
  function pintarCategorias() {
    var cats = ["Todas"];
    libros.forEach(function (l) { if (l.categoria && cats.indexOf(l.categoria) === -1) cats.push(l.categoria); });
    $categorias.innerHTML = "";
    if (cats.length <= 2) return;
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

  function pintarLibros() {
    var q = sinTildes($buscar.value.trim());
    var visibles = libros.filter(function (l) {
      var okCat = categoriaActiva === "Todas" || l.categoria === categoriaActiva;
      var okBusqueda = !q || sinTildes(l.nombre + " " + l.autor + " " + l.categoria).indexOf(q) !== -1;
      return okCat && okBusqueda;
    });

    $grilla.innerHTML = "";
    $estado.textContent = visibles.length ? "" : (libros.length ? "No encontramos libros con esa búsqueda." : "Pronto agregaremos libros al catálogo.");

    visibles.forEach(function (l) {
      var agotado = l.stock !== null && l.stock <= 0;
      var art = document.createElement("article");
      art.className = "tarjeta" + (agotado ? " tarjeta--agotada" : "");

      var foto = document.createElement("div");
      foto.className = "tarjeta__foto";
      if (l.imagen) {
        var img = document.createElement("img");
        img.src = T.carpetaImagenes + encodeURI(l.imagen);
        img.alt = l.nombre;
        img.loading = "lazy";
        img.onerror = function () { foto.innerHTML = ""; foto.appendChild(portadaVacia(l.nombre)); };
        foto.appendChild(img);
      } else {
        foto.appendChild(portadaVacia(l.nombre));
      }
      if (agotado) {
        var et = document.createElement("span");
        et.className = "etiqueta";
        et.textContent = "Agotado";
        foto.appendChild(et);
      }
      art.appendChild(foto);

      var cuerpo = document.createElement("div");
      cuerpo.className = "tarjeta__cuerpo";
      var stockTexto = (!agotado && l.stock !== null && l.stock <= 3) ? '<span class="tarjeta__stock">Quedan ' + l.stock + "</span>" : "";
      cuerpo.innerHTML =
        (l.categoria ? '<p class="tarjeta__categoria">' + escapar(l.categoria) + "</p>" : "") +
        '<h2 class="tarjeta__titulo">' + escapar(l.nombre) + "</h2>" +
        (l.autor ? '<p class="tarjeta__autor">' + escapar(l.autor) + "</p>" : "") +
        (l.descripcion ? '<p class="tarjeta__descripcion">' + escapar(l.descripcion) + "</p>" : "") +
        '<div class="tarjeta__pie"><span class="tarjeta__precio">' + formatoPrecio(l.precio) + "</span>" + stockTexto + "</div>";

      var btn = document.createElement(agotado ? "span" : "a");
      btn.className = "boton boton--whatsapp" + (agotado ? " boton--deshabilitado" : "");
      if (agotado) {
        btn.textContent = "Agotado";
      } else {
        var msg = T.mensajeCompra
          .replace("{libro}", l.nombre)
          .replace(" de {autor}", l.autor ? " de " + l.autor : "")
          .replace("{autor}", l.autor)
          .replace(" ({precio})", l.precio !== null ? " (" + formatoPrecio(l.precio) + ")" : "")
          .replace("{precio}", formatoPrecio(l.precio));
        btn.href = enlaceWhatsApp(msg);
        btn.target = "_blank";
        btn.rel = "noopener";
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.4-.3Z"/></svg> Comprar';
      }
      cuerpo.appendChild(btn);
      art.appendChild(cuerpo);
      $grilla.appendChild(art);
    });
  }

  // ---------- Cargar ----------
  $buscar.addEventListener("input", pintarLibros);

  fetch(T.catalogo + "?v=" + Date.now())
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(function (texto) {
      libros = leerCSV(texto).map(function (f) {
        return {
          nombre: f.nombre,
          autor: f.autor,
          categoria: f.categoria,
          precio: aNumero(f.precio),
          stock: aNumero(f.stock),
          descripcion: f.descripcion,
          imagen: f.imagen
        };
      }).filter(function (l) { return l.nombre; });
      pintarCategorias();
      pintarLibros();
    })
    .catch(function () {
      $estado.textContent = "No se pudo cargar el catálogo. Intenta recargar la página.";
    });
})();
