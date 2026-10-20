// Conexión con Firebase, compartida por la tienda y el panel.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

var cfg = (window.TIENDA && window.TIENDA.firebase) || {};
export var configurado = !!cfg.apiKey && cfg.apiKey.indexOf("PEGAR") === -1;
export var app = initializeApp(configurado ? cfg : { apiKey: "x", projectId: "sin-configurar", appId: "x" });
export var db = getFirestore(app);
