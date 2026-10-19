const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");

const { findShortestPath } = require("./src/graph");
const { SemanticSearch, normalizeText } = require("./src/semantic-search");

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

    // Buscar en aulas (rooms)
    for (const room of mapData.rooms) {
      const names = [room.name, ...(room.aliases || [])].filter(Boolean);
      let score = names.reduce((current, name) => {
        const normalized = normalizeText(name);
        if (!normalized) return current;

        // 1. Coincidencia exacta 
        if (query === normalized) return Math.max(current, 2.0);

        // 2. Coincidencia de palabra completa (Evita que "aula 1" pise a "aula 10")
        const regex = new RegExp(`\\b${normalized}\\b`);
        if (regex.test(query)) return Math.max(current, 1.2);

        // 3. Coincidencia parcial (por tokens)
        return Math.max(current, sharedTokenScore(query, normalized));
      }, 0);

      const code = normalizeText(room.code);
      if (code) {
        if (query === code) {
          score = Math.max(score, 1.5);
        } else {
          // Evitamos que el código "1" tambien entre con el código "10"
          const codeRegex = new RegExp(`\\b${code}\\b`);
          if (codeRegex.test(query)) {
            score = Math.max(score, 0.8);
          }
        }
      }

      if (!best || score > best.score) {
        best = { type: "room", id: room.id, label: `${room.name} ${room.code}`, score };
      }
    }

    // Buscar en nodos
    for (const node of mapData.nodes) {
      const names = [node.label, ...(node.aliases || [])].filter(Boolean);
      const score = names.reduce((current, name) => {
        const normalized = normalizeText(name);
        if (!normalized) return current;

        if (query === normalized) return Math.max(current, 2.0);

        const regex = new RegExp(`\\b${normalized}\\b`);
        if (regex.test(query)) return Math.max(current, 1.2);

        return Math.max(current, sharedTokenScore(query, normalized));
      }, 0);

      if (!best || score > best.score) {
        best = { type: "node", id: node.id, label: node.label, score };
      }
    }

    return best && best.score >= 0.25 ? best : null;
  }

  // Consultas demasiado vagas: en vez de adivinar, pedimos precisión.
    const palabrasRelleno = new Set([
      "quiero", "quisiera", "ir", "al", "a", "la", "el", "un", "una", "los", "las", "de", "del",
      "donde", "esta", "queda", "hay", "necesito", "busco", "buscar", "llevame", "en",
      "tengo", "que", "puedo", "me", "mi", "para", "por", "favor", "ver"
    ]);

    const gruposAmbiguos = [
      {
        terminos: ["aula", "aulas", "clase", "salon"],
        titulo: "Hay muchas aulas. ¿A cuál querés ir?",
        filtro: (room) => room.id.startsWith("aula_")
      },
      {
        terminos: ["bano", "banos", "banio", "banios", "sanitario", "sanitarios", "wc", "toilet", "toilette"],
        titulo: "Hay varios baños. ¿A cuál querés ir?",
        filtro: (room) => room.id.startsWith("banio")
      },
      {
        terminos: ["oficina", "oficinas"],
        titulo: "Hay varias oficinas. ¿A cuál querés ir?",
        filtro: (room) => [
          "mantenimiento", "area_rendiciones", "sala_profesores_grado", "despacho", "personal",
          "secretaria_administrativa", "compras_inventario", "contable", "economico_financiera",
          "alumnos", "mesa_entradas", "intendencia"
        ].includes(room.id)
      }
    ];

    function resolverConsultaAmbigua(message) {
      const consulta = normalizeText(message)
        .split(/\s+/)
        .filter((token) => token && !palabrasRelleno.has(token))
        .join(" ");
      if (!consulta) return null;

      const armar = (titulo, rooms) => ({
        reply: `${titulo}\n${rooms.map((room) => `• ${room.name}`).join("\n")}\n\nTocá una opción o escribí el nombre completo, por ejemplo "${rooms[0].name}".`,
        options: rooms.map((room) => ({ id: room.id, name: room.name }))
      });

      // Grupos genéricos: "aula", "baño", "oficina"
      for (const grupo of gruposAmbiguos) {
        if (grupo.terminos.includes(consulta)) {
          return armar(grupo.titulo, mapData.rooms.filter(grupo.filtro));
        }
      }

      // Solo un número: "1", "10", "11"
      if (/^\d+[ab]?$/.test(consulta)) {
        const candidatos = mapData.rooms.filter((room) => {
          const m = normalizeText(room.name).match(/^aula (\d+[ab]?)$/);
          return m && (m[1] === consulta || m[1].replace(/[ab]$/, "") === consulta);
        });
        if (candidatos.length) {
          return armar(`Con "${consulta}" no me queda claro qué lugar buscás.`, candidatos);
        }
        return {
          reply: `No encontré un lugar con el número "${consulta}". Probá con "aula 5", "biblioteca" o "baño de mujeres".`,
          options: []
        };
      }

      return null;
    }

  function resolverServicio(message) {
    const query = normalizeText(message);
    let mejor = null;

    for (const servicio of mapData.services) {
      const nombres = [
        servicio.name,
        ...(servicio.keywords || []),
        ...(servicio.examples || [])
      ].filter(Boolean);

      const score = nombres.reduce((actual, nombre) => {
        const normalizado = normalizeText(nombre);
        if (!normalizado) return actual;

        if (query === normalizado) return Math.max(actual, 2.0);

        const regex = new RegExp(`\\b${normalizado}\\b`);
        if (regex.test(query)) return Math.max(actual, 1.4);

        return Math.max(actual, sharedTokenScore(query, normalizado));
      }, 0);

      if (!mejor || score > mejor.score) {
        mejor = {
          serviceId: servicio.id,
          roomId: servicio.roomId || null,
          serviceName: servicio.name,
          score,
          source: "service-alias"
        };
      }
    }

    return mejor && mejor.score >= 0.55 ? mejor : null;
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
  // entrada del edificio, y el único parámetro es si necesita entrar por la rampa o usar las gradas.
  function startLocationForAccess(necesitaRampa) {
    return necesitaRampa ? "rampa-0" : "gradas-0";
  }

  function buildChatReply(targetRoom, match, necesitaRampa) {
    // 1. Buscamos el servicio por su ID, pero si fue un clic directo, lo buscamos por el roomId
    let servicioObj = mapData.services.find((s) => s.id === match.serviceId);
    if (!servicioObj && targetRoom) {
      servicioObj = mapData.services.find((s) => s.roomId === targetRoom.id);
    }

    let textoRespuesta = servicioObj
      ? `${servicioObj.description}\n\n`
      : `Para llegar a ${targetRoom.name} sigue la ruta trazada en el mapa.\n\n`;

    const detalleServicio = armarDetalleServicio(servicioObj);
    if (detalleServicio) {
      textoRespuesta += `${detalleServicio}\n\n`;
    }

    if (!targetRoom) {
      textoRespuesta += "Este servicio es principalmente online y no tiene un punto físico marcado en el mapa.";
      return textoRespuesta.trim();
    }

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
      if (servicioObj) {
        textoRespuesta += "La ruta ya está trazada en el mapa.";
      }
    }

    return textoRespuesta.trim();
  }

  function textoLista(valor) {
    if (!valor) {
      return "";
    }

    const valores = Array.isArray(valor) ? valor : [valor];
    return valores.filter(Boolean).join("\n");
  }

  function armarContacto(contacto) {
    if (!contacto) {
      return "";
    }

    if (typeof contacto === "string") {
      return contacto;
    }

    return [
      contacto.area,
      contacto.email ? `Mail: ${contacto.email}` : "",
      contacto.telefono ? `Teléfono: ${contacto.telefono}` : ""
    ].filter(Boolean).join("\n");
  }

  function armarDetalleServicio(servicio) {
    if (!servicio) {
      return "";
    }

    const secciones = [];
    if (servicio.horario) secciones.push(`Horario:\n${servicio.horario}`);
    if (servicio.formaAcceso) secciones.push(`Forma de acceso:\n${textoLista(servicio.formaAcceso)}`);
    if (servicio.requisitos) secciones.push(`Requisitos:\n${textoLista(servicio.requisitos)}`);

    const datosContacto = armarContacto(servicio.contacto);
    if (datosContacto) secciones.push(`Contacto:\n${datosContacto}`);

    if (servicio.fuenteTitulo || servicio.fuenteUrl) {
      secciones.push(`Fuente:\n${[servicio.fuenteTitulo, servicio.fuenteUrl].filter(Boolean).join(" - ")}`);
    }

    return secciones.join("\n\n");
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

      const aclaracion = resolverConsultaAmbigua(message);
      if (aclaracion) {
        sendJson(res, 200, {
          reply: aclaracion.reply,
          action: { type: "disambiguate", options: aclaracion.options }
        });
        return;
      }

      const directTarget = resolveLocation(message);
      const servicioEncontrado = resolverServicio(message);

      if (servicioEncontrado && (!directTarget || servicioEncontrado.score > directTarget.score)) {
        if (servicioEncontrado.roomId) {
          targetRoom = findRoom(servicioEncontrado.roomId);
        }
        match = servicioEncontrado;
      } else if (directTarget?.type === "room" && directTarget.score >= 0.55) {
        targetRoom = findRoom(directTarget.id);
        match = {
          serviceId: "direct_room_match",
          roomId: targetRoom.id,
          serviceName: targetRoom.name,
          score: directTarget.score,
          source: "room-alias"
        };
      } else {
        const searchResult = servicioEncontrado || await semanticSearch.search(message);
        if (searchResult) {
          if (searchResult.roomId) {
            targetRoom = findRoom(searchResult.roomId);
          }
          match = searchResult;
        }
      }
    }

    if (!targetRoom) {
      const servicioSinLugar = match ? mapData.services.find((servicio) => servicio.id === match.serviceId) : null;
      if (servicioSinLugar) {
        sendJson(res, 200, {
          reply: buildChatReply(null, match, necesitaRampa),
          match,
          action: { type: "show_message" }
        });
        return;
      }

      sendJson(res, 200, {
        reply: "No encontré un destino relacionado. Puedes probar con “quiero ir al baño”, “aula 5”, “biblioteca”, “SIU Guaraní” o “certificado de alumno regular”.",
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
