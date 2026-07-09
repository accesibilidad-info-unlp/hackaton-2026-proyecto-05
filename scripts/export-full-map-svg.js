const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const mapPath = path.join(rootDir, "data", "map.json");
const outputPath = path.join(rootDir, "public", "assets", "svg", "full-map.svg");

const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const [, , viewBoxWidth = 637, viewBoxHeight = 424] = String(map.viewBox)
  .split(/\s+/)
  .map(Number);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
}

function shapeCenter(room) {
  if (room.label) return room.label;

  if (room.shape.type === "rect") {
    return {
      x: room.shape.x + room.shape.width / 2,
      y: room.shape.y + room.shape.height / 2
    };
  }

  if (room.shape.type === "polygon") {
    const points = String(room.shape.points)
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

    const sum = points.reduce((acc, [x, y]) => {
      acc.x += x;
      acc.y += y;
      return acc;
    }, { x: 0, y: 0 });

    return {
      x: sum.x / points.length,
      y: sum.y / points.length
    };
  }

  return { x: 0, y: 0 };
}

function renderRoom(room) {
  const common = {
    id: room.svgId,
    class: "room",
    "data-room-id": room.id
  };

  if (room.shape.type === "path") {
    return `<path ${attrs({ ...common, d: room.shape.d })}><title>${escapeXml(`${room.code} - ${room.name}`)}</title></path>`;
  }

  if (room.shape.type === "polygon") {
    return `<polygon ${attrs({ ...common, points: room.shape.points })}><title>${escapeXml(`${room.code} - ${room.name}`)}</title></polygon>`;
  }

  return `<rect ${attrs({
    ...common,
    x: room.shape.x,
    y: room.shape.y,
    width: room.shape.width,
    height: room.shape.height,
    rx: 2
  })}><title>${escapeXml(`${room.code} - ${room.name}`)}</title></rect>`;
}

function renderLabel(room) {
  const center = shapeCenter(room);
  return `<text ${attrs({
    class: "room-code",
    x: center.x,
    y: center.y + 4
  })}>${escapeXml(room.code)}</text>`;
}

function exportedBackgroundHref(href) {
  if (!href) return "";
  if (href.startsWith("/assets/svg/")) return path.basename(href);
  return href.replace(/^\//, "");
}

const lines = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<svg ${attrs({
    xmlns: "http://www.w3.org/2000/svg",
    width: 1274,
    height: 848,
    viewBox: map.viewBox,
    role: "img",
    "aria-label": "Mapa completo de planta baja generado desde data/map.json"
  })}>`,
  `  <title>Mapa completo de planta baja</title>`,
  `  <desc>SVG estatico generado desde data/map.json. Las rutas interactivas siguen funcionando en la aplicacion web.</desc>`,
  `  <style>`,
  `    .canvas { fill: #f6f7f3; }`,
  `    .building-shell { fill: #e4e8c9; stroke: #20252b; stroke-width: 1.2; }`,
  `    .corridor { fill: #b0b2ad; stroke: #252b31; stroke-width: 1.1; }`,
  `    .entry-ramp { fill: #a5a7a3; stroke: #20252b; stroke-width: 1.1; }`,
  `    .room { fill: rgba(255, 255, 255, 0.78); stroke: #3f4b55; stroke-width: 1.2; }`,
  `    .room-code { fill: #1e252c; font-family: Arial, sans-serif; font-size: 10px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }`,
  `  </style>`,
  `  <rect class="canvas" x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}"/>`,
  `  <g id="base-layer">`
];

if (map.backgroundImage) {
  lines.push(`    <image ${attrs({
    href: exportedBackgroundHref(map.backgroundImage.href),
    x: 0,
    y: 0,
    width: viewBoxWidth,
    height: viewBoxHeight,
    preserveAspectRatio: map.backgroundImage.preserveAspectRatio || "xMidYMid meet"
  })}/>`);
} else {
  for (const item of map.backgroundPaths || []) {
    lines.push(`    <path ${attrs({
      id: item.id,
      class: item.className || "map-base",
      d: item.d
    })}/>`);
  }
}

lines.push(`  </g>`);
lines.push(`  <g id="room-layer">`);

for (const room of map.rooms || []) {
  lines.push(`    ${renderRoom(room)}`);
  lines.push(`    ${renderLabel(room)}`);
}

lines.push(`  </g>`);
lines.push(`</svg>`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Exported ${path.relative(rootDir, outputPath)}`);
