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
