const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const mapPath = path.join(rootDir, "data", "map.json");
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function characterBigrams(value) {
  const compact = normalizeText(value).replace(/\s+/g, "");
  if (compact.length < 2) {
    return compact ? [compact] : [];
  }

  const grams = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.push(compact.slice(index, index + 2));
  }
  return grams;
}

function diceScore(a, b) {
  const aGrams = characterBigrams(a);
  const bGrams = characterBigrams(b);
  if (!aGrams.length || !bGrams.length) {
    return 0;
  }

  const counts = new Map();
  for (const gram of aGrams) {
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }

  let overlap = 0;
  for (const gram of bGrams) {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }

  return (2 * overlap) / (aGrams.length + bGrams.length);
}

function tokenScore(a, b) {
  const queryTokens = normalizeText(a).split(/\s+/).filter(Boolean);
  const docTokens = new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  if (!queryTokens.length || !docTokens.size) {
    return 0;
  }

  let hits = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

function localScore(query, document) {
  const normalizedQuery = normalizeText(query);
  const normalizedDocument = normalizeText(document);
  if (!normalizedQuery || !normalizedDocument) {
    return 0;
  }

  const exactBoost =
    normalizedDocument.includes(normalizedQuery) || normalizedQuery.includes(normalizedDocument)
      ? 0.35
      : 0;

  return Math.min(1, exactBoost + tokenScore(query, document) * 0.35 + diceScore(query, document) * 0.3);
}

class SemanticSearch {
  constructor(mapData) {
    this.mapData = mapData;
    this.documents = this.buildDocuments();
    this.collection = null;
    this.mode = "local-fallback";
    this.detail = "Chroma client not loaded";
  }

  buildDocuments() {
    return this.mapData.services.map((service) => {
      const room = this.mapData.rooms.find((candidate) => candidate.id === service.roomId);
      const textParts = [
        service.name,
        service.description,
        ...(service.examples || []),
        ...(service.keywords || []),
        room?.name,
        room?.code,
        ...(room?.aliases || [])
      ].filter(Boolean);

      return {
        id: service.id,
        roomId: service.roomId,
        serviceName: service.name,
        text: textParts.join("。"),
        metadata: {
          serviceId: service.id,
          roomId: service.roomId,
          roomName: room?.name || "",
          roomCode: room?.code || ""
        }
      };
    });
  }

  async init() {
    if (process.env.CHROMA_DISABLED === "1") {
      this.detail = "CHROMA_DISABLED=1";
      return;
    }

    try {
      const chroma = await import("chromadb");
      const client = new chroma.ChromaClient({
        path: process.env.CHROMA_URL || "http://localhost:8000"
      });
      this.collection = await client.getOrCreateCollection({
        name: process.env.CHROMA_COLLECTION || "campus_services"
      });
      await this.collection.upsert({
        ids: this.documents.map((doc) => doc.id),
        documents: this.documents.map((doc) => doc.text),
        metadatas: this.documents.map((doc) => doc.metadata)
      });
      this.mode = "chroma";
      this.detail = process.env.CHROMA_URL || "http://localhost:8000";
    } catch (error) {
      this.collection = null;
      this.mode = "local-fallback";
      this.detail = `Using built-in matcher because Chroma is unavailable: ${error.message}`;
    }
  }

  status() {
    return {
      mode: this.mode,
      detail: this.detail,
      documents: this.documents.length
    };
  }

  async search(query) {
    if (this.collection) {
      try {
        const result = await this.collection.query({
          queryTexts: [query],
          nResults: 1
        });
        const metadata = result.metadatas?.[0]?.[0];
        const distance = result.distances?.[0]?.[0] ?? 1;
        if (metadata?.roomId) {
          return {
            serviceId: metadata.serviceId,
            roomId: metadata.roomId,
            serviceName: this.documents.find((doc) => doc.id === metadata.serviceId)?.serviceName || "",
            score: Math.max(0, Math.min(1, 1 - distance)),
            source: "chroma"
          };
        }
      } catch (error) {
        this.mode = "local-fallback";
        this.detail = `Chroma query failed, switched to built-in matcher: ${error.message}`;
        this.collection = null;
      }
    }

    const ranked = this.documents
      .map((document) => ({
        ...document,
        score: localScore(query, document.text)
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.18) {
      return null;
    }

    return {
      serviceId: best.id,
      roomId: best.roomId,
      serviceName: best.serviceName,
      score: best.score,
      source: "local-fallback"
    };
  }
}

function euclidean(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function findShortestPath(nodes, edges, startNodeId, targetNodeId, accessibleOnly = false) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(startNodeId) || !nodeById.has(targetNodeId)) {
    return null;
  }

  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (accessibleOnly && edge.accesible === false) continue;

    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;

    const weight = Number(edge.weight || euclidean(from, to));
    adjacency.get(edge.from).push({ nodeId: edge.to, weight });
    adjacency.get(edge.to).push({ nodeId: edge.from, weight });
  }

  const distances = new Map(nodes.map((node) => [node.id, Infinity]));
  const previous = new Map();
  const unvisited = new Set(nodes.map((node) => node.id));
  distances.set(startNodeId, 0);

  while (unvisited.size) {
    let current = null;
    let currentDistance = Infinity;

    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId);
      if (distance < currentDistance) {
        current = nodeId;
        currentDistance = distance;
      }
    }

    if (current === null || currentDistance === Infinity) {
      break;
    }

    if (current === targetNodeId) {
      break;
    }

    unvisited.delete(current);

    for (const next of adjacency.get(current)) {
      if (!unvisited.has(next.nodeId)) continue;

      const candidate = currentDistance + next.weight;
      if (candidate < distances.get(next.nodeId)) {
        distances.set(next.nodeId, candidate);
        previous.set(next.nodeId, current);
      }
    }
  }

  if (distances.get(targetNodeId) === Infinity) {
    return null;
  }

  const nodeIds = [];
  let current = targetNodeId;
  while (current) {
    nodeIds.unshift(current);
    current = previous.get(current);
  }

  return {
    distance: distances.get(targetNodeId),
    nodeIds
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sharedTokenScore(a, b) {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size);
}

async function main() {
  const mapData = JSON.parse(await readFile(mapPath, "utf8"));
  const semanticSearch = new SemanticSearch(mapData);
  await semanticSearch.init();

  function findRoom(roomId) {
    return mapData.rooms.find((room) => room.id === roomId);
  }

  function findNode(nodeId) {
    return mapData.nodes.find((node) => node.id === nodeId);
  }

  function roomPoint(room) {
    if (room?.label) {
      return {
        id: `${room.id}_label`,
        x: room.label.x,
        y: room.label.y,
        label: `${room.name} ${room.code}`,
        type: "room-label"
      };
    }

    if (room?.shape?.type === "rect") {
      return {
        id: `${room.id}_label`,
        x: room.shape.x + room.shape.width / 2,
        y: room.shape.y + room.shape.height / 2,
        label: `${room.name} ${room.code}`,
        type: "room-label"
      };
    }

    return null;
  }

  function nodeForLocationId(locationId) {
    const room = findRoom(locationId);
    if (room) {
      return room.entranceNodeId;
    }

    const node = findNode(locationId);
    if (node) {
      return node.id;
    }

    return null;
  }

  function resolveLocation(message) {
    const query = normalizeText(message);
    let best = null;

    for (const room of mapData.rooms) {
      const names = [room.name, ...(room.aliases || [])].filter(Boolean);
      let score = names.reduce((current, name) => {
        const normalized = normalizeText(name);
        if (!normalized) return current;
        if (query.includes(normalized) || normalized.includes(query)) return Math.max(current, 1.2);
        return Math.max(current, sharedTokenScore(query, normalized));
      }, 0);

      const code = normalizeText(room.code);
      if (code) {
        if (query === code) {
          score = Math.max(score, 0.95);
        } else if (query.includes(code)) {
          score = Math.max(score, 0.35);
        }
      }

      if (!best || score > best.score) {
        best = { type: "room", id: room.id, label: `${room.name} ${room.code}`, score };
      }
    }

    for (const node of mapData.nodes) {
      const names = [node.label, ...(node.aliases || [])].filter(Boolean);
      const score = names.reduce((current, name) => {
        const normalized = normalizeText(name);
        if (!normalized) return current;
        if (query.includes(normalized) || normalized.includes(query)) return Math.max(current, 1);
        return Math.max(current, sharedTokenScore(query, normalized));
      }, 0);

      if (!best || score > best.score) {
        best = { type: "node", id: node.id, label: node.label, score };
      }
    }

    return best && best.score >= 0.25 ? best : null;
  }

  function buildRoute(startLocationId, targetRoomId, accessibleOnly = false) {
    const startNodeId = nodeForLocationId(startLocationId);
    const targetRoom = findRoom(targetRoomId);

    if (!startNodeId || !targetRoom) {
      return null;
    }

    const result = findShortestPath(
      mapData.nodes,
      mapData.edges,
      startNodeId,
      targetRoom.entranceNodeId,
      accessibleOnly
    );
    if (!result) {
      return null;
    }

    const points = result.nodeIds.map((nodeId) => {
      const node = findNode(nodeId);
      return { id: node.id, x: node.x, y: node.y, label: node.label, type: "corridor-node" };
    });

    return {
      targetRoom,
      distance: result.distance,
      nodeIds: result.nodeIds,
      points
    };
  }

  // El origen del recorrido ya no lo elige el usuario a mano: siempre es la
  // entrada del edificio, y el único parámetro es si necesita rampa o gradas.
  function startLocationForAccess(necesitaRampa) {
    return necesitaRampa ? "rampa-0" : "gradas-0";
  }

  function buildChatReply(targetRoom, match, necesitaRampa) {
    const servicioObj = mapData.services.find((s) => s.id === match.serviceId);
    let textoRespuesta = servicioObj
      ? `${servicioObj.description}\n\n`
      : `Encontré ${targetRoom.name} ${targetRoom.code}.\n\n`;

    const rutaPredefinida = mapData.rutas?.find(
      (r) => r.roomId === targetRoom.id || r.destino === targetRoom.id
    );

    if (rutaPredefinida) {
      let pasos = [];
      if (necesitaRampa && rutaPredefinida.ruta_accesible_silla_ruedas?.disponible) {
        pasos = rutaPredefinida.ruta_accesible_silla_ruedas.pasos;
      } else if (rutaPredefinida.ruta_estandar?.pasos) {
        pasos = rutaPredefinida.ruta_estandar.pasos;
      }

      if (pasos.length > 0) {
        textoRespuesta += "Sigue estas instrucciones:\n";
        pasos.forEach((paso, index) => {
          textoRespuesta += `${index + 1}. ${paso}\n`;
        });
      }
    } else {
      textoRespuesta += "La ruta ya está dibujada en el mapa.";
    }

    return textoRespuesta;
  }

  async function handleChat(req, res) {
    const body = await readJsonBody(req);
    const necesitaRampa = body.necesitaRampa === true;
    const startLocationId = startLocationForAccess(necesitaRampa);

    let targetRoom = null;
    let match = null;

    // Click directo en un bloque del mapa / lista de lugares: viene con el id exacto.
    if (body.targetRoomId) {
      targetRoom = findRoom(body.targetRoomId);
      if (targetRoom) {
        match = {
          serviceId: "direct_room_match",
          roomId: targetRoom.id,
          serviceName: targetRoom.name,
          score: 1,
          source: "room-click"
        };
      }
    } else {
      const message = String(body.message || "").trim();
      if (!message) {
        sendJson(res, 400, { error: "message is required" });
        return;
      }

      const directTarget = resolveLocation(message);
      if (directTarget?.type === "room" && directTarget.score >= 0.55) {
        targetRoom = findRoom(directTarget.id);
        match = {
          serviceId: "direct_room_match",
          roomId: targetRoom.id,
          serviceName: targetRoom.name,
          score: directTarget.score,
          source: "room-alias"
        };
      } else {
        const searchResult = await semanticSearch.search(message);
        if (searchResult) {
          targetRoom = findRoom(searchResult.roomId);
          match = searchResult;
        }
      }
    }

    if (!targetRoom) {
      sendJson(res, 200, {
        reply: "No encontré un destino relacionado. Puedes probar con “quiero ir al baño”, “aula 5”, “biblioteca” o “tengo que entregar papeles”.",
        action: { type: "show_message" }
      });
      return;
    }

    const route = buildRoute(startLocationId, targetRoom.id, necesitaRampa);
    if (!route) {
      sendJson(res, 200, {
        reply: necesitaRampa
          ? "Encontré el destino, pero todavía no hay una ruta accesible en silla de ruedas para ese tramo."
          : "Encontré el destino, pero todavía no hay una ruta disponible entre los nodos del mapa.",
        match,
        action: { type: "show_message" }
      });
      return;
    }

    sendJson(res, 200, {
      reply: buildChatReply(targetRoom, match, necesitaRampa),
      match,
      action: {
        type: "highlight_route",
        route,
        targetRoomId: targetRoom.id,
        targetSvgId: targetRoom.svgId
      }
    });
  }

  async function handleRoute(req, res) {
    const body = await readJsonBody(req);
    const startLocationId = body.startLocationId || body.startNodeId;
    const targetRoomId = body.targetRoomId;
    const accessibleOnly = body.accessibleOnly === true;
    const route = buildRoute(startLocationId, targetRoomId, accessibleOnly);

    if (!route) {
      sendJson(res, 404, { error: "route not found" });
      return;
    }

    sendJson(res, 200, { route });
  }

  async function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(publicDir, safePath);

    if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/api/map") {
        sendJson(res, 200, {
          ...mapData,
          semanticSearch: semanticSearch.status()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        await handleChat(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/route") {
        await handleRoute(req, res);
        return;
      }

      if (req.method === "GET") {
        await serveStatic(req, res);
        return;
      }

      sendJson(res, 405, { error: "method not allowed" });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });

  if (process.env.CHECK_ONLY !== "1") {
    server.listen(port, async () => {
      console.log(`Smart campus map running at http://localhost:${port}`);
      console.log(`Semantic search mode: ${semanticSearch.status().mode}`);

      if (process.env.SELF_TEST === "1") {
        try {
          const baseUrl = `http://localhost:${port}`;
          const mapResponse = await fetch(`${baseUrl}/api/map`);
          const mapPayload = await mapResponse.json();

          // Chat por texto, arrancando por gradas (checkbox sin marcar)
          const chatResponse = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              message: "tengo que entregar papeles",
              necesitaRampa: false
            })
          });
          const chatPayload = await chatResponse.json();

          // Ruta directa desde el nodo real de entrada (antes se probaba con
          // "entrada_principal", que no existe como nodo/sala y siempre daba vacío)
          const routeResponse = await fetch(`${baseUrl}/api/route`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              startLocationId: "entrada",
              targetRoomId: "banios_hombres"
            })
          });
          const routePayload = await routeResponse.json();

          // Recorrido completo arrancando desde gradas-0, sin filtro de accesibilidad
          const gradasRouteResponse = await fetch(`${baseUrl}/api/route`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              startLocationId: "gradas-0",
              targetRoomId: "banios_hombres"
            })
          });
          const gradasRoutePayload = await gradasRouteResponse.json();

          // Mismo recorrido pero exigiendo ruta accesible en silla de ruedas desde rampa-0
          const rampaRouteResponse = await fetch(`${baseUrl}/api/route`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              startLocationId: "rampa-0",
              targetRoomId: "banios_hombres",
              accessibleOnly: true
            })
          });
          const rampaRoutePayload = await rampaRouteResponse.json();

          // Chat por texto "aula 5", con necesitaRampa true (debe arrancar en rampa-0)
          const aula5ChatResponse = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              message: "aula 5",
              necesitaRampa: true
            })
          });
          const aula5ChatPayload = await aula5ChatResponse.json();

          // Click directo en un bloque del mapa (sin pasar por matching de texto)
          const clickChatResponse = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              targetRoomId: "fotocopiadora",
              necesitaRampa: false
            })
          });
          const clickChatPayload = await clickChatResponse.json();

          console.log(
            JSON.stringify({
              semanticMode: mapPayload.semanticSearch.mode,
              chatAction: chatPayload.action?.type,
              chatTarget: chatPayload.action?.targetRoomId,
              routeNodes: routePayload.route?.nodeIds || [],
              gradasToBanios: gradasRoutePayload.route?.nodeIds || [],
              rampaAccesibleToBanios: rampaRoutePayload.route?.nodeIds || rampaRoutePayload.error,
              aula5ChatTarget: aula5ChatPayload.action?.targetRoomId,
              aula5ChatStartsAccessible: aula5ChatPayload.action?.route?.nodeIds?.[0],
              clickChatTarget: clickChatPayload.action?.targetRoomId
            })
          );
        } finally {
          server.close();
        }
      }
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
