# Mapa interactivo de la facultad

## Descripcion

Prototipo de mapa interactivo para la planta baja de la Facultad de Informatica. El sitio permite elegir una ubicacion actual, escribir una consulta como aula, lugar o tramite, identificar el destino y marcar una ruta sobre el mapa.

La version actual no usa una imagen SVG externa como mapa principal. El plano visible se dibuja dentro de `public/index.html` con un elemento `<svg id="campusMap">`, y `public/app.js` genera las habitaciones, pasillos, nodos ocultos y rutas a partir de `data/map.json`.

## Integrantes

- Aby Sequeiros
- Matias Miyawaki
- Walter Lin
- Lizbeth Sanchez

## Tecnologias utilizadas

- HTML, CSS y JavaScript nativo para la interfaz.
- SVG generado desde JavaScript para mostrar el mapa.
- JSON para guardar habitaciones, servicios, nodos, pasillos y conexiones.
- Node.js para servir la pagina y resolver consultas/rutas.
- Algoritmo de grafo para calcular rutas entre puntos de entrada y destino.

## Estructura principal

- `public/index.html`: estructura de la pagina y contenedor del mapa.
- `public/app.js`: renderiza el SVG, pinta habitaciones, muestra rutas y gestiona la interaccion.
- `public/styles.css`: estilos visuales del mapa y del panel lateral.
- `data/map.json`: fuente principal de datos del mapa.
- `server.js`: servidor local, busqueda de destinos y calculo de rutas.
- `scripts/export-full-map-svg.js`: exporta el mapa JSON actual como un SVG estatico.
- `public/assets/svg/full-map.svg`: mapa completo exportado desde `data/map.json`.
- `public/assets/svg/plano-v3.svg`: plano SVG completo usado como fondo visual del mapa.
- `public/assets/svg/plano-v2.svg`: recurso convertido desde `plano v2.txt`.

## Como funciona el mapa

Las habitaciones no son imagenes fijas. Cada aula o oficina se define en `data/map.json` con un identificador, nombre, alias, forma SVG y punto de entrada. El navegador lee esos datos y dibuja rectangulos, poligonos o paths dentro del SVG principal.

La ruta no conecta habitaciones por el centro. La logica esperada es:

1. salir desde el punto de la habitacion actual;
2. conectar con el ancla de puerta o entrada;
3. recorrer la red de nodos del pasillo;
4. llegar al ancla del destino;
5. marcar la habitacion final.

Los pasillos y puntos ocultos tambien estan en `data/map.json`. Por eso las correcciones de ubicacion, puertas y recorridos deben hacerse en ese archivo, no solo en CSS.

## Plano V2

`public/assets/svg/plano-v2.svg` queda dentro del proyecto como recurso de consulta. Proviene de un archivo de trabajo que contenia fragmentos SVG separados, por eso no se usa como mapa principal.

Si mas adelante se recibe un SVG completo y correctamente posicionado de toda la planta, se puede integrar como fondo visual del mapa manteniendo encima las capas interactivas generadas desde JSON.

## Plano V3

Se agrego `public/assets/svg/plano-v3.svg` como fondo visual del mapa. La aplicacion mantiene las habitaciones, etiquetas, nodos y rutas desde `data/map.json`; el SVG V3 reemplaza la capa base visual sin eliminar la logica interactiva.

## Instalacion y ejecucion

Requisitos previos: Node.js.

Instalar dependencias:

```bash
npm install
```

Ejecutar el servidor:

```bash
npm start
```

Abrir en el navegador:

```text
http://localhost:3000
```

Verificar sintaxis basica del proyecto:

```bash
npm run check
```

Exportar una version estatica del mapa:

```bash
npm run export:svg
```

## Donde editar la informacion

- Habitaciones y nombres: `data/map.json`, seccion `rooms`.
- Alias de busqueda: `data/map.json`, campo `aliases` de cada habitacion.
- Servicios o tramites: `data/map.json`, seccion `services`.
- Puntos de pasillo: `data/map.json`, seccion `nodes`.
- Conexiones de recorrido: `data/map.json`, seccion `edges`.
- Aspecto visual: `public/styles.css`.

Para agregar informacion nueva, lo mas importante es indicar a que habitacion pertenece y cual es su punto de entrada al pasillo. Ejemplo: un tramite como "entregar papeles" debe apuntar a una sala concreta, como Mesa de Entradas.

## Estado actual

El prototipo cubre una sola planta y algunas zonas principales como aulas, biblioteca, banos, Mesa de Entradas y oficinas administrativas. La precision final depende de ajustar manualmente las posiciones de habitaciones, puertas y nodos de pasillo en `data/map.json`.
