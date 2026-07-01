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

module.exports = { SemanticSearch, normalizeText };
