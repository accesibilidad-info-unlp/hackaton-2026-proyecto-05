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

function findShortestPath(nodes, edges, startNodeId, targetNodeId) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(startNodeId) || !nodeById.has(targetNodeId)) {
    return null;
  }

  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
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

  function buildRoute(startLocationId, targetRoomId) {
    const startNodeId = nodeForLocationId(startLocationId);
    const startRoom = findRoom(startLocationId);
    const targetRoom = findRoom(targetRoomId);

    if (!startNodeId || !targetRoom) {
      return null;
    }

    const result = findShortestPath(mapData.nodes, mapData.edges, startNodeId, targetRoom.entranceNodeId);
    if (!result) {
      return null;
    }

    const graphPoints = result.nodeIds.map((nodeId) => {
      const node = findNode(nodeId);
      return { id: node.id, x: node.x, y: node.y, label: node.label, type: "corridor-node" };
    });
    const startPoint = startRoom ? roomPoint(startRoom) : null;
    const targetPoint = roomPoint(targetRoom);
    const points = [
      ...(startPoint ? [startPoint] : []),
      ...graphPoints,
      ...(targetPoint ? [targetPoint] : [])
    ];

    return {
      targetRoom,
      distance: result.distance,
      nodeIds: result.nodeIds,
      points
    };
  }

  async function handleChat(req, res) {
    const body = await readJsonBody(req);
    const message = String(body.message || "").trim();
    const currentLocationId = body.currentLocationId || null;
    const pendingTargetRoomId = body.pendingTargetRoomId || null;

    if (!message) {
      sendJson(res, 400, { error: "message is required" });
      return;
    }

    if (pendingTargetRoomId && !currentLocationId) {
      const location = resolveLocation(message);
      if (!location) {
        sendJson(res, 200, {
          reply: "Todavía no pude identificar tu ubicación. Puedes escribir “estoy en la entrada”, “estoy en biblioteca” o seleccionar tu ubicación en la lista.",
          action: { type: "ask_location", targetRoomId: pendingTargetRoomId }
        });
        return;
      }

      const route = buildRoute(location.id, pendingTargetRoomId);
      if (!route) {
        sendJson(res, 200, {
          reply: "Encontré tu ubicación, pero todavía no hay una ruta disponible entre esos dos puntos.",
          action: { type: "show_message" }
        });
        return;
      }

      sendJson(res, 200, {
        reply: `Listo. Ya marqué la ruta desde ${location.label} hasta ${route.targetRoom.name} ${route.targetRoom.code}.`,
        currentLocationId: location.id,
        action: {
          type: "highlight_route",
          route,
          targetRoomId: route.targetRoom.id,
          targetSvgId: route.targetRoom.svgId
        }
      });
      return;
    }

    const directTarget = resolveLocation(message);
    if (directTarget?.type === "room" && directTarget.id !== currentLocationId && directTarget.score >= 0.55) {
      const targetRoom = findRoom(directTarget.id);
      if (!currentLocationId) {
        sendJson(res, 200, {
          reply: `Entiendo que quieres ir a ${targetRoom.name} ${targetRoom.code}. ¿Dónde estás ahora?`,
          match: {
            serviceId: "direct_room_match",
            roomId: targetRoom.id,
            serviceName: targetRoom.name,
            score: directTarget.score,
            source: "room-alias"
          },
          action: {
            type: "ask_location",
            targetRoomId: targetRoom.id,
            targetSvgId: targetRoom.svgId
          }
        });
        return;
      }

      const route = buildRoute(currentLocationId, targetRoom.id);
      if (route) {
        sendJson(res, 200, {
          reply: `Identifiqué ${targetRoom.name} ${targetRoom.code}. La ruta ya está marcada.`,
          match: {
            serviceId: "direct_room_match",
            roomId: targetRoom.id,
            serviceName: targetRoom.name,
            score: directTarget.score,
            source: "room-alias"
          },
          action: {
            type: "highlight_route",
            route,
            targetRoomId: targetRoom.id,
            targetSvgId: targetRoom.svgId
          }
        });
        return;
      }
    }

    const searchResult = await semanticSearch.search(message);
    if (!searchResult) {
      sendJson(res, 200, {
        reply: "No encontré un destino relacionado. Puedes probar con “quiero ir al baño”, “aula 5”, “biblioteca” o “tengo que entregar papeles”.",
        action: { type: "show_message" }
      });
      return;
    }

    const targetRoom = findRoom(searchResult.roomId);
    if (!targetRoom) {
      sendJson(res, 200, {
        reply: "Encontré el trámite, pero todavía no está vinculado a un lugar del mapa.",
        action: { type: "show_message" }
      });
      return;
    }

    if (!currentLocationId) {
      sendJson(res, 200, {
        reply: `Entiendo que quieres ir a ${targetRoom.name} ${targetRoom.code}. ¿Dónde estás ahora?`,
        match: searchResult,
        action: {
          type: "ask_location",
          targetRoomId: targetRoom.id,
          targetSvgId: targetRoom.svgId
        }
      });
      return;
    }

    const route = buildRoute(currentLocationId, targetRoom.id);
    if (!route) {
      sendJson(res, 200, {
        reply: "Encontré el destino, pero todavía no hay una ruta disponible entre los nodos del mapa.",
        match: searchResult,
        action: { type: "show_message" }
      });
      return;
    }

    sendJson(res, 200, {
      reply: `Encontré ${targetRoom.name} ${targetRoom.code}. La ruta ya está marcada.`,
      match: searchResult,
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
    const route = buildRoute(startLocationId, targetRoomId);

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
          const chatResponse = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              message: "tengo que entregar papeles",
              currentLocationId: "entrada_principal"
            })
          });
          const chatPayload = await chatResponse.json();
          const routeResponse = await fetch(`${baseUrl}/api/route`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              startLocationId: "entrada_principal",
              targetRoomId: "banios_hombres"
            })
          });
          const routePayload = await routeResponse.json();
          const aula5RouteResponse = await fetch(`${baseUrl}/api/route`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              startLocationId: "aula_5",
              targetRoomId: "banios_hombres"
            })
          });
          const aula5RoutePayload = await aula5RouteResponse.json();
          const aula5ChatResponse = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              message: "aula 5",
              currentLocationId: "entrada_principal"
            })
          });
          const aula5ChatPayload = await aula5ChatResponse.json();
          const aula4ToCopyResponse = await fetch(`${baseUrl}/api/route`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              startLocationId: "aula_4",
              targetRoomId: "fotocopiadora"
            })
          });
          const aula4ToCopyPayload = await aula4ToCopyResponse.json();

          console.log(
            JSON.stringify({
              semanticMode: mapPayload.semanticSearch.mode,
              chatAction: chatPayload.action?.type,
              chatTarget: chatPayload.action?.targetRoomId,
              routeNodes: routePayload.route?.nodeIds || [],
              aula5ToBanios: aula5RoutePayload.route?.nodeIds || [],
              aula5ChatTarget: aula5ChatPayload.action?.targetRoomId,
              aula4ToFotocopiadora: aula4ToCopyPayload.route?.nodeIds || []
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
