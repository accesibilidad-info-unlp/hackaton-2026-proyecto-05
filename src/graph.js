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

module.exports = { findShortestPath };
