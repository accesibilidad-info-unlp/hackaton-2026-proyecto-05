# Mapa accesible de la Facultad de Informática presentado como trabajo final de la materia de Seminario de lenguajes JavaScript

## Descripción

Prototipo web de mapa inteligente para la planta baja de la Facultad de Informática. Permite encontrar un aula, una oficina, un baño o un trámite, y trazar automáticamente la ruta a pie (o accesible en silla de ruedas) sobre el plano de la facultad.

El plano SVG (externo e interno) está calcado sobre el plano a escala real de la planta baja de la facultad, por lo que las posiciones de aulas, pasillos y puertas se corresponden con la distribución física del edificio. No es una imagen estática de un solo bloque: la posición de cada sala, pasillo y nodo de ruta vive en data/map.json, y sobre eso se dibuja un SVG interactivo donde cada aula, oficina o servicio es un elemento clickeable, y la ruta se calcula con un algoritmo de grafos (Dijkstra) sobre esa red de nodos y pasillos.

## Grupo 5

- Abi Sequeiros
- Brenda Morinigo
- Lizbeth Sanchez
- Matias Miyawaki
- Walter Lin

## Tecnologías utilizadas

- HTML, CSS y JavaScript nativo (sin frameworks) para la interfaz.
- SVG para dibujar el mapa y superponer la ruta calculada.
- JSON (`data/map.json`) como fuente única de verdad: salas, nodos, aristas y servicios.
- Node.js (`http` nativo, sin frameworks web) para servir la app, resolver búsquedas y calcular rutas.
- Dijkstra sobre un grafo dirigido para el cálculo de rutas (`src/graph.js` / lógica equivalente en `server.js`).
- Coincidencia de texto local (bigramas + tokens) como motor de búsqueda por defecto, con soporte opcional para Chroma como backend de búsqueda semántica.

## Cómo funciona el mapa: dos SVG, un mismo plano

El proyecto usa **dos versiones del mismo plano en SVG**, superpuestas en las mismas coordenadas (`viewBox="0 0 476 398"`), cada una con un propósito distinto:

### 1. SVG externo (`public/assets/svg/svg-externo.svg`)

Es el plano "visual" del edificio: aulas, baños, oficinas administrativas, biblioteca, buffet, escaleras/rampa y zonas verdes, dibujados como `path`/`rect` con relleno de color. Se usa como imagen de fondo del mapa (`backgroundImage` en `map.json`) y, sobre él, `app.js` superpone formas SVG interactivas (una por cada `room` de `map.json`) para que el usuario pueda:

- Ver el edificio con su forma y colores reales.
- Hacer clic sobre cualquier bloque (aula, baño, oficina, etc.) para pedir la ruta hacia ese lugar.

### 2. SVG interno (`public/assets/svg/svg-interno.svg`)

Es un plano "invisible" para el usuario: un conjunto de puntos (`circle`/`path` pequeños) ubicados sobre los pasillos, puertas, cruces, la rampa y las gradas de entrada. Cada punto tiene un `id` (por ejemplo `right-3`, `left-0`, `central-1`, `entrada`, `rampa-0`, `gradas-0`) que coincide exactamente con el `id` de un nodo en la sección `nodes` de `data/map.json`.

Este SVG interno **no se muestra al usuario**: sirve como referencia de coordenadas para construir el grafo de navegación. Cada nodo de `nodes` en `map.json` fue calibrado contra este SVG para que la ruta calculada por Dijkstra coincida exactamente con los pasillos reales del edificio y nunca atraviese una pared, un aula o una zona verde.

En resumen:

```text
SVG externo  -> lo que el usuario VE y con lo que interactúa (bloques clickeables)

SVG interno  -> los nodos ocultos que alimentan el grafo y permiten calcular la ruta 

data/map.json -> conecta ambos: cada room apunta a un entranceNodeId, y cada nodo de "nodes" tiene las coordenadas del SVG interno
```

Un toggle en el menú de accesibilidad ("Ver nodos y pasillos ocultos") permite mostrar sobre el mapa los nodos y aristas del grafo (capa `debug-layer` en `app.js`), útil para depurar rutas.

## Tres formas de trazar una ruta

La aplicación ofrece tres caminos distintos para llegar al mismo resultado (una ruta dibujada sobre el mapa), todos terminando en el mismo endpoint `/api/chat` o `/api/route`:

1. **Clic directo sobre el mapa**: al hacer clic sobre cualquier bloque del SVG externo, se envía el `roomId` exacto de esa sala y se traza la ruta sin pasar por ningún matching de texto. También se puede apuntar un bloque partiendo desde Aula 1 con TAB y para seleccionarlo como destino presiono Enter/Space.
2. **Asistente de chat**: el panel lateral permite escribir una consulta en lenguaje natural ("quiero ir al baño de hombres", "aula 5", "tengo que entregar papeles"). El servidor intenta resolverla primero contra nombres/alias/código de sala y, si no hay coincidencia clara, contra la base de `services` mediante el motor de búsqueda local (o Chroma si está configurado).
3. **Directorio de lugares**: un listado de todas las aulas y oficinas (ordenado por código) en la parte inferior de la página. Al hacer clic en un ítem se dispara la misma ruta que el clic directo sobre el mapa.

Las tres vías construyen la ruta con el mismo criterio: desde el punto de entrada (rampa o gradas, según el modo de accesibilidad) hasta la puerta (`entranceNodeId`) de la sala destino, recorriendo únicamente la red de pasillos definida en `edges`.

## Accesibilidad y punto de partida de la ruta

El origen de cualquier ruta ya no lo elige el usuario manualmente: se define con el checkbox **"Activar rutas accesibles (sin gradas)"** del panel lateral.

- Checkbox **desmarcado** → el recorrido arranca en `gradas-0` (entrada por gradas).
- Checkbox **marcado** → el recorrido arranca en `rampa-0` (entrada por rampa) y el cálculo de ruta filtra las aristas marcadas como `accesible: false`, garantizando un camino apto para silla de ruedas.

El grafo de `edges` es **dirigido** (cada arista tiene un único sentido `from → to`); las conexiones que deben transitarse en ambos sentidos están declaradas dos veces, una por cada dirección.

## Estructura principal

```text
data/map.json              Fuente de datos: escala, rooms, nodes, edges, services y rutas predefinidas
public/index.html          Estructura de la página, mapa SVG y panel del asistente
public/app.js               Dibuja el SVG, gestiona clics, chat y trazado de rutas
public/styles.css           Estilos del mapa, temas de accesibilidad y panel lateral
public/assets/svg/svg-externo.svg   Plano visual del edificio (fondo del mapa)
public/assets/svg/svg-interno.svg   Plano de referencia con los nodos ocultos del grafo
server.js                   Servidor Node.js: API, búsqueda de destinos y cálculo de rutas (Dijkstra)
src/graph.js                 Implementación auxiliar de Dijkstra
src/semantic-search.js       Motor de búsqueda local (con soporte opcional para Chroma)
templates/                   Formato de issues del equipo (bloqueo, error, tarea)
```

## Cómo funciona el mapa (detalle de datos)

La información principal está en `data/map.json`:

- `escala`: calibración de la escala del plano (unidades SVG ↔ metros reales), usada para expresar distancias en metros.
- `accesos_entrada_principal`: caminos de nodos predefinidos para ingresar por rampa o por gradas.
- `rooms`: aulas, oficinas y destinos visibles, con su `id`, `name`, `code`, `aliases`, `entranceNodeId` y forma SVG (`shape`).
- `nodes`: puntos ocultos del pasillo (coinciden con el SVG interno) usados por el algoritmo de rutas.
- `edges`: conexiones dirigidas y transitables entre nodos, cada una con su flag `accesible`.
- `services`: relación entre consultas típicas del usuario (palabras clave, ejemplos) y una sala destino.
- `rutas`: pasos en lenguaje natural predefinidos para algunos recorridos frecuentes (estándar y accesible).

Ejemplo simplificado de una sala:

```json
{
  "id": "aula_5",
  "svgId": "room-aula-5",
  "name": "Aula 5",
  "code": "5",
  "aliases": ["aula cinco", "fortran"],
  "entranceNodeId": "right-2",
  "shape": { "type": "path", "d": "..." },
  "label": { "x": 241.5, "y": 171.7 }
}
```

Ejemplo de nodo (coincide con un punto del SVG interno) y arista dirigida:

```json
{ "id": "right-2", "label": "Pasillo aula 4", "x": 290.5, "y": 135.5 }
```

```json
{ "from": "right-1", "to": "right-2", "accesible": true }
```

La ruta se calcula con Dijkstra sobre esa red, nunca desde el centro de una sala hacia el centro de otra:

```text
punto de acceso (rampa/gradas) -> ... red de pasillos ... -> puerta de la sala destino
```

Si una ruta cruza una pared o un aula, normalmente el problema está en:

- un nodo colocado fuera del pasillo (coordenadas que no coinciden con el SVG interno);
- una arista que conecta puntos que no deberían conectarse, o que falta en el sentido correcto (el grafo es dirigido);
- una sala con `entranceNodeId` apuntando al nodo equivocado;
- falta de nodos intermedios en un tramo de pasillo.

## Búsqueda de destinos

El usuario puede escribir consultas como:

```text
aula 5
quiero ir al baño de hombres
quiero ir a biblioteca
tengo que entregar papeles
```

El servidor intenta resolver la consulta en este orden:

1. Coincidencia directa con el nombre, alias o código de una sala.
2. Coincidencia con la base de `services` mediante el motor de búsqueda (local o Chroma).
3. Cálculo de la ruta desde el punto de acceso (rampa/gradas) hasta la sala encontrada.

Ejemplo de servicio:

```json
{
  "id": "service_entry",
  "name": "Mesa de Entradas",
  "roomId": "mesa_entradas",
  "description": "Para presentar notas, entregar documentación o iniciar expedientes, ve a Mesa de Entradas.",
  "keywords": ["mesa de entradas", "documentacion", "expediente", "entregar papeles"],
  "examples": ["tengo que entregar papeles"]
}
```

Para agregar nuevos trámites o servicios, se debe agregar una entrada en `services` y vincularla con el `roomId` correcto.

## Accesibilidad de la interfaz

Además de las rutas accesibles en silla de ruedas, el mapa incluye soporte de accesibilidad para la interfaz:

- Menú lateral con control de tamaño de texto, contraste y modos de color (oscuro, daltonismo, alta legibilidad).
- Lector de voz (Text-to-Speech) para leer el último mensaje del asistente.
- El SVG tiene `role="img"` y `aria-label`.
- Cada sala se comporta como botón (`role="button"`, navegable con teclado mediante `Enter` o espacio).
- Cada sala tiene `aria-label` propio para lectores de pantalla.
- Los elementos decorativos usan `aria-hidden`.
- La zona de mensajes del asistente usa `aria-live="polite"`.

## Instalación y ejecución

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

Si el puerto 3000 ya está ocupado, se puede usar otro puerto:

```bash
$env:PORT="3001"
npm start
```
El proyecto no tiene dependencias externas: package.json no declara ninguna en dependencies, y package-lock.json está vacío por eso mismo. Todo corre con módulos nativos de Node (node:http, node:fs). npm install no baja nada salvo que después instales Chroma manualmente (ver más abajo). Los scripts (`start`, `check`, `self-test`) ejecutan directamente `server.js` con distintas variables de entorno (CHECK_ONLY, SELF_TEST) en vez de depender de un framework de testing.

## Comandos útiles

```bash
npm run check
```

Valida que los archivos principales puedan cargarse correctamente.

```bash
npm run self-test
```

Levanta el servidor temporalmente y prueba casos básicos de ruta y búsqueda (por ejemplo Aula 5, baños, Mesa de Entradas), tanto por chat de texto como por clic directo, y validando el filtro de accesibilidad.

## Cómo reportar bloqueos, errores o tareas

El repositorio incluye una carpeta `templates/` en la raíz del proyecto con el formato de issues que usa el equipo:

- **Bloqueo** (`bloqueo.md`): para cuando alguien queda trabado y necesita ayuda técnica, conceptual u organizativa para seguir avanzando. Pide describir el problema, qué se intentó y qué tipo de ayuda se necesita, con una prioridad (baja/media/alta).
- **Error** (`error.md`): para reportar un bug del prototipo. Pide el problema, los pasos para reproducirlo y el resultado esperado vs. el obtenido.
- **Tarea** (`tarea.md`): para crear una tarea de trabajo nueva. Pide el objetivo, una descripción breve, el responsable, si depende de otra tarea y el criterio de finalización.

Al crear un issue nuevo en GitHub, copiar el contenido del template correspondiente según si es algo que te frena (bloqueo), algo que está roto (error) o trabajo nuevo por hacer (tarea).

> Nota: como `templates/` está en la raíz del repo y no en `.github/ISSUE_TEMPLATE/`, GitHub no la va a mostrar automáticamente como selector al crear un issue; hay que copiar el formato a mano. Si en algún momento quieren que aparezca como picker nativo, alcanza con mover la carpeta a `.github/ISSUE_TEMPLATE`.

## Chroma y búsqueda semántica

El proyecto puede intentar usar Chroma si está instalado y configurado, pero no depende de él para funcionar: si Chroma no está disponible, usa automáticamente un motor de búsqueda local (bigramas de caracteres + coincidencia de tokens) para que la demo siga funcionando.

Configuración opcional:

```bash
npm install chromadb
$env:CHROMA_URL="http://localhost:8000"
npm start
```

## Dónde editar la información

- Habitaciones, nombres y alias: `data/map.json`, sección `rooms`.
- Servicios o trámites: `data/map.json`, sección `services`.
- Puntos de pasillo (deben coincidir con `public/assets/svg/svg-interno.svg`): `data/map.json`, sección `nodes`.
- Conexiones de recorrido (grafo dirigido): `data/map.json`, sección `edges`.
- Aspecto visual del edificio: `public/assets/svg/svg-externo.svg`.
- Aspecto visual de la interfaz (colores, temas, paneles): `public/styles.css`.

Para agregar información nueva, lo más importante es indicar a qué sala pertenece y cuál es su punto de entrada (`entranceNodeId`) al pasillo. Ejemplo: un trámite como "entregar papeles" debe apuntar a una sala concreta, como Mesa de Entradas.

## Cómo seguir ajustando el mapa

Para mejorar la precisión:

1. Revisar que cada sala esté visualmente fuera del pasillo gris en `svg-externo.svg`.
2. Confirmar la puerta real de cada sala contra `svg-interno.svg`.
3. Ajustar `entranceNodeId` en `map.json` si no coincide.
4. Agregar nodos en cruces o cambios de dirección del pasillo, siempre con las mismas coordenadas que el SVG interno.
5. Conectar solo caminos transitables en `edges`, respetando el sentido de circulación (grafo dirigido) y el flag `accesible`.
6. Probar rutas críticas: Aula 4 a Fotocopiadora, Aula 5 a Baños, Entrada a Biblioteca, Entrada a Mesa de Entradas, tanto en modo estándar como accesible.

La regla principal es: las rutas solo deben moverse por la red de pasillos, nunca atravesar salas, paredes, espacios verdes o áreas externas.

## Estado actual

El prototipo cubre la planta baja completa con aulas, biblioteca, baños, buffet, CEFI, Mesa de Entradas y oficinas administrativas. La precisión final depende de mantener sincronizadas las coordenadas de data/map.json con ambos SVG ante cualquier cambio en el plano.