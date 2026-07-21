/* ==========================================
   1. CONTROLES Y ACCESIBILIDAD
   ========================================== */
const botonAbrir = document.getElementById("miBoton");
const botonCerrar = document.getElementById("btnCerrar");
const menu = document.getElementById("miMenu");

// Control de apertura y cierre del menú
if (botonAbrir && menu) {
  botonAbrir.addEventListener("click", () => menu.classList.remove("oculto"));
}
if (botonCerrar && menu) {
  botonCerrar.addEventListener("click", () => menu.classList.add("oculto"));
}

/* --- Control de Tamaño de Letra --- */
const btnAgrandar = document.getElementById("agrandar");
const btnAchicar = document.getElementById("achicar");
let escalaTexto = 100;

function ajustarTamaño(cambio) {
  const nuevaEscala = escalaTexto + cambio;
  if (nuevaEscala >= 80 && nuevaEscala <= 160) {
    escalaTexto = nuevaEscala;
    document.body.style.fontSize = escalaTexto + "%";
  }
}

if (btnAgrandar) btnAgrandar.addEventListener("click", () => ajustarTamaño(10));
if (btnAchicar) btnAchicar.addEventListener("click", () => ajustarTamaño(-10));

/* --- Selector de Modos de Color --- */
const selectorColor = document.getElementById("selectorColor");

if (selectorColor) {
  selectorColor.addEventListener("change", (event) => {
    const temaSeleccionado = event.target.value;
    if (temaSeleccionado === "defecto") {
      document.documentElement.removeAttribute("data-theme");
      document.body.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", temaSeleccionado);
      document.body.setAttribute("data-theme", temaSeleccionado);
    }
  });
}

/* --- Control de Contraste --- */
const btnSubirContraste = document.getElementById("subirContraste");
const btnBajarContraste = document.getElementById("bajarContraste");
let nivelContraste = 100;

function ajustarContraste(cambio) {
  const nuevoContraste = nivelContraste + cambio;
  if (nuevoContraste >= 60 && nuevoContraste <= 200) {
    nivelContraste = nuevoContraste;
    document.documentElement.style.filter = `contrast(${nivelContraste}%)`;
  }
}

if (btnSubirContraste) btnSubirContraste.addEventListener("click", () => ajustarContraste(20));
if (btnBajarContraste) btnBajarContraste.addEventListener("click", () => ajustarContraste(-20));

/* --- Lector de Voz (Text-to-Speech) - Solo Asistente --- */
let lectura = null;
const btnLeer = document.getElementById("btnLeer");
const btnPausar = document.getElementById("btnPausar");
const btnReanudar = document.getElementById("btnReanudar");
const btnDetener = document.getElementById("btnDetener");

if (btnLeer) {
  btnLeer.addEventListener("click", () => {
    speechSynthesis.cancel();

    // 1. Buscamos el último mensaje devuelto por el asistente
    const mensajesAI = document.querySelectorAll("#messages .message.ai");
    const ultimoMensajeAI = mensajesAI.length > 0 ? mensajesAI[mensajesAI.length - 1].innerText : "";

    // 2. Si todavía no hay mensajes, toma el placeholder del campo de texto
    const inputMensaje = document.getElementById("messageInput");
    const textoInput = inputMensaje ? inputMensaje.placeholder : "";

    // Construimos la frase omitiendo totalmente el mapa y los encabezados
    let textoAEnviar = ultimoMensajeAI;
    if (!textoAEnviar) {
      textoAEnviar = `Asistente de mapa listo. ${textoInput}`;
    }

    // 3. Reproducimos únicamente ese texto
    lectura = new SpeechSynthesisUtterance(textoAEnviar);
    lectura.lang = "es-ES";
    lectura.rate = 0.95;
    lectura.pitch = 1.0;
    lectura.volume = 1.0;

    speechSynthesis.speak(lectura);
  });
}

if (btnPausar) {
  btnPausar.addEventListener("click", () => {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
    }
  });
}

if (btnReanudar) {
  btnReanudar.addEventListener("click", () => {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }
  });
}

if (btnDetener) {
  btnDetener.addEventListener("click", () => {
    speechSynthesis.cancel();
  });
}

const svgNs = "http://www.w3.org/2000/svg";

const state = {
  map: null,
  currentLocationId: "entrada_principal",
  pendingTargetRoomId: null,
  routeLayer: null,
  debugLayer: null,
  roomElements: new Map()
};

const mapSvg = document.querySelector("#campusMap");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const locationSelect = document.querySelector("#locationSelect");
const matchInfo = document.querySelector("#matchInfo");
const searchMode = document.querySelector("#searchMode");
const debugToggle = document.querySelector("#debugToggle");
const clearRoute = document.querySelector("#clearRoute");

function svgElement(name, attrs = {}) {
  const element = document.createElementNS(svgNs, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      element.setAttribute(key, value);
    }
  }
  return element;
}

function addMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function parsePoints(points) {
  return String(points)
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function shapeCenter(room) {
  if (room.label) {
    return room.label;
  }

  if (room.shape.type === "rect") {
    return {
      x: room.shape.x + room.shape.width / 2,
      y: room.shape.y + room.shape.height / 2
    };
  }

  if (room.shape.type === "polygon") {
    const points = parsePoints(room.shape.points);
    const sum = points.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  return { x: 0, y: 0 };
}

function createRoomShape(room) {
  const common = {
    id: room.svgId,
    class: "room",
    "data-room-id": room.id,
    role: "button",
    tabindex: "0",
    "aria-label": `${room.code} - ${room.name}. Seleccionar como ubicacion actual.`
  };

  if (room.shape.type === "path") {
    return svgElement("path", { ...common, d: room.shape.d });
  }

  if (room.shape.type === "polygon") {
    return svgElement("polygon", { ...common, points: room.shape.points });
  }

  return svgElement("rect", {
    ...common,
    x: room.shape.x,
    y: room.shape.y,
    width: room.shape.width,
    height: room.shape.height,
    rx: 2
  });
}

function selectCurrentLocation(room) {
  locationSelect.value = room.id;
  state.currentLocationId = room.id;
  state.pendingTargetRoomId = null;
  matchInfo.textContent = `Ubicacion actual: ${room.name} (${room.code})`;
}

function drawMap(map) {
  mapSvg.innerHTML = "";
  mapSvg.setAttribute("viewBox", map.viewBox);
  mapSvg.classList.toggle("uses-background-image", Boolean(map.backgroundImage));
  state.roomElements.clear();

  const [, , viewBoxWidth, viewBoxHeight] = String(map.viewBox)
    .split(/\s+/)
    .map(Number);

  const background = svgElement("rect", {
    x: 0,
    y: 0,
    width: viewBoxWidth || 637,
    height: viewBoxHeight || 424,
    fill: "#f6f7f3",
    "aria-hidden": "true"
  });
  mapSvg.appendChild(background);

  const baseLayer = svgElement("g", { class: "base-layer", "aria-hidden": "true" });
  mapSvg.appendChild(baseLayer);

  if (map.backgroundImage) {
    baseLayer.appendChild(svgElement("image", {
      href: map.backgroundImage.href,
      x: 0,
      y: 0,
      width: viewBoxWidth || 637,
      height: viewBoxHeight || 424,
      preserveAspectRatio: map.backgroundImage.preserveAspectRatio || "xMidYMid meet"
    }));
  } else {
    for (const item of map.backgroundPaths || []) {
      baseLayer.appendChild(svgElement("path", {
        id: item.id,
        class: item.className || "map-base",
        d: item.d
      }));
    }
  }

  const roomLayer = svgElement("g", { class: "room-layer" });
  mapSvg.appendChild(roomLayer);

  for (const room of map.rooms) {
    const shape = createRoomShape(room);
    const title = svgElement("title");
    title.textContent = `${room.code} - ${room.name}`;
    shape.appendChild(title);
    shape.addEventListener("click", () => {
      selectCurrentLocation(room);
    });
    shape.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCurrentLocation(room);
      }
    });
    roomLayer.appendChild(shape);
    state.roomElements.set(room.id, shape);

    const center = shapeCenter(room);
    const code = svgElement("text", {
      class: "room-code",
      x: center.x,
      y: center.y + 4,
      "aria-hidden": "true"
    });
    code.textContent = room.code;
    roomLayer.appendChild(code);
  }

  state.debugLayer = svgElement("g", { class: "debug-layer", "aria-hidden": "true" });
  mapSvg.appendChild(state.debugLayer);

  for (const edge of map.edges) {
    const from = map.nodes.find((node) => node.id === edge.from);
    const to = map.nodes.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    state.debugLayer.appendChild(svgElement("line", {
      class: "debug-edge",
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y
    }));
  }

  for (const node of map.nodes) {
    const point = svgElement("circle", {
      class: "debug-node",
      cx: node.x,
      cy: node.y,
      r: 4
    });
    state.debugLayer.appendChild(point);
  }

  state.routeLayer = svgElement("g", { class: "route-layer" });
  mapSvg.appendChild(state.routeLayer);
}

function fillLocationSelect(map) {
  locationSelect.innerHTML = "";
  for (const room of map.rooms) {
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = `${room.code} - ${room.name}`;
    locationSelect.appendChild(option);
  }
  locationSelect.value = state.currentLocationId;
}
/////
function fillPlacesList(map) {
  const list = document.getElementById("placesList");
  list.innerHTML = "";

  map.rooms
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(room => {
      const li = document.createElement("li");
      li.textContent = `${room.code} - ${room.name}`;

      li.addEventListener("click", () => {
        selectCurrentLocation(room);
        showPlaceDetails(room);
      });

      list.appendChild(li);
    });
}
function showPlaceDetails(room) {
  const details = document.getElementById("placeDetails");

  const aliases = room.aliases?.length
    ? `<ul>${room.aliases.map(alias => `<li>${alias}</li>`).join("")}</ul>`
    : "<p>Este lugar no posee aliases.</p>";

  details.innerHTML = `
        <h4>${room.code} - ${room.name}</h4>
        <strong>Aliases:</strong>
        ${aliases}
    `;
}
//////
function clearRouteDisplay() {
  state.routeLayer.innerHTML = "";
  for (const element of state.roomElements.values()) {
    element.classList.remove("active");
  }
  matchInfo.textContent = "Ruta limpiada";
}

function drawRoute(route, targetRoomId) {
  clearRouteDisplay();
  const points = route.points.map((point) => `${point.x},${point.y}`).join(" ");
  state.routeLayer.appendChild(svgElement("polyline", {
    class: "route-glow",
    points,
    "aria-hidden": "true"
  }));
  state.routeLayer.appendChild(svgElement("polyline", {
    class: "route-line",
    points,
    role: "img",
    "aria-label": `Ruta marcada con ${route.points.length} puntos.`
  }));

  for (const point of route.points) {
    state.routeLayer.appendChild(svgElement("circle", {
      class: "route-point",
      cx: point.x,
      cy: point.y,
      r: 4,
      "aria-hidden": "true"
    }));
  }

  const target = state.roomElements.get(targetRoomId);
  if (target) {
    target.classList.add("active");
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

async function sendMessage(message) {
  addMessage("user", message);
  messageInput.value = "";

  const payload = {
    message,
    currentLocationId: state.pendingTargetRoomId ? null : state.currentLocationId,
    pendingTargetRoomId: state.pendingTargetRoomId
  };

  const result = await postJson("/api/chat", payload);
  addMessage("ai", result.reply);

  if (result.currentLocationId) {
    state.currentLocationId = result.currentLocationId;
    locationSelect.value = result.currentLocationId;
  }

  if (result.action?.type === "ask_location") {
    state.pendingTargetRoomId = result.action.targetRoomId;
    matchInfo.textContent = result.match ? `Destino: ${result.match.serviceName}` : "Esperando ubicacion actual";
    return;
  }

  state.pendingTargetRoomId = null;

  if (result.action?.type === "highlight_route") {
    drawRoute(result.action.route, result.action.targetRoomId);
    const distance = Math.round(result.action.route.distance);
    const matchText = result.match ? `Destino: ${result.match.serviceName}. ` : "";
    matchInfo.textContent = `${matchText}Longitud aproximada: ${distance} unidades del mapa.`;
  } else {
    matchInfo.textContent = "Sin cambios de ruta";
  }
}

async function init() {
  const response = await fetch("/api/map");
  state.map = await response.json();
  drawMap(state.map);
  fillLocationSelect(state.map);
  fillPlacesList(state.map);
  searchMode.textContent = "Planta Baja - Facultad de Informatica";
  addMessage("ai", "Hola. Puedes escribir \"quiero ir al bano\", \"quiero ir a biblioteca\", \"tengo que entregar papeles\" o \"aula 5\".");
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;

  try {
    await sendMessage(message);
  } catch (error) {
    addMessage("ai", `Error en la consulta: ${error.message}`);
  }
});

locationSelect.addEventListener("change", () => {
  state.currentLocationId = locationSelect.value;
  state.pendingTargetRoomId = null;
  const label = locationSelect.options[locationSelect.selectedIndex].textContent;
  matchInfo.textContent = `Ubicacion actual: ${label}`;
});

debugToggle.addEventListener("change", () => {
  mapSvg.classList.toggle("show-debug", debugToggle.checked);
});

clearRoute.addEventListener("click", () => {
  state.pendingTargetRoomId = null;
  clearRouteDisplay();
});

for (const button of document.querySelectorAll("[data-example]")) {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.example).catch((error) => {
      addMessage("ai", `Error en la consulta: ${error.message}`);
    });
  });
}

init().catch((error) => {
  searchMode.textContent = "Error al cargar";
  addMessage("ai", `No se pudo cargar el mapa: ${error.message}`);
});
