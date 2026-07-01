# Mapa inteligente - Planta Baja

Este proyecto es un prototipo web de mapa inteligente para la planta baja de la Facultad de Informatica. Permite seleccionar una ubicacion actual, buscar un aula, un servicio o un tramite, y marcar una ruta sobre el plano.

El foco del proyecto no es solamente dibujar un mapa, sino representar correctamente la relacion entre salas, puertas y pasillos. Las salas se muestran como areas blancas; los pasillos transitables se representan como areas grises; la ruta debe seguir la red de pasillos y no atravesar aulas, paredes, espacios verdes o zonas externas.

## Como ejecutar

Desde la carpeta del proyecto:

```bash
npm start
```

Luego abrir:

```text
http://localhost:3000
```

Si el puerto 3000 ya esta ocupado, se puede usar otro puerto:

```bash
$env:PORT="3001"
npm start
```

## Comandos utiles

```bash
npm run check
```

Valida que los archivos principales puedan cargarse correctamente.

```bash
npm run self-test
```

Levanta el servidor temporalmente y prueba casos basicos de ruta y busqueda, por ejemplo Aula 5, banos y Mesa de Entradas.

## Estructura del proyecto

```text
data/map.json        Datos del mapa, salas, nodos, aristas y servicios
public/index.html    Estructura visual de la pagina
public/app.js        Render del SVG, interaccion y dibujo de rutas
public/styles.css    Estilos del mapa, salas, pasillos y ruta
server.js            Servidor Node.js, API, busqueda y calculo de ruta
src/graph.js         Implementacion auxiliar de Dijkstra
src/semantic-search.js Busqueda semantica/fallback local
```

## Como funciona el mapa

El mapa se renderiza con SVG. No es una imagen estatica: cada sala, pasillo, nodo oculto y ruta es un elemento SVG controlado por JavaScript.

La informacion principal esta en `data/map.json`:

- `backgroundPaths`: formas base del edificio y los pasillos.
- `rooms`: aulas, oficinas y destinos visibles.
- `nodes`: puntos ocultos usados por el algoritmo de rutas.
- `edges`: conexiones transitables entre nodos.
- `services`: relacion entre consultas del usuario y destinos del mapa.

## Salas y aulas

Cada sala se define en `rooms`. Ejemplo simplificado:

```json
{
  "id": "aula_5",
  "svgId": "room-aula-5",
  "name": "Aula 5",
  "code": "16",
  "aliases": ["aula cinco", "classroom 5"],
  "entranceNodeId": "n_aula_5_door",
  "shape": { "type": "path", "d": "..." },
  "label": { "x": 368, "y": 263 }
}
```

Campos importantes:

- `id`: identificador interno.
- `name`: nombre mostrado.
- `code`: numero que aparece en el plano.
- `aliases`: formas en que una persona podria escribir ese lugar.
- `entranceNodeId`: nodo de puerta o entrada de esa sala.
- `shape`: forma SVG de la sala (`rect`, `polygon` o `path`).
- `label`: posicion del numero o texto dentro del mapa.

## Nodos ocultos y rutas

La ruta no se calcula desde el centro de una sala hacia el centro de otra. La logica correcta es:

```text
sala actual -> puerta de sala -> red de pasillos -> puerta destino -> sala destino
```

Los nodos ocultos estan en `nodes`. Representan puertas, cruces y puntos centrales de pasillos. Las conexiones validas estan en `edges`.

Ejemplo:

```json
{ "id": "n_aula_4_door", "label": "Puerta Aula 4", "x": 448, "y": 236 }
```

```json
{ "from": "n_aula_4_door", "to": "n_corredor_aula_4" }
```

La ruta se calcula con Dijkstra sobre esa red. Por eso, si una ruta cruza una pared o un aula, normalmente el problema esta en:

- un nodo colocado fuera del pasillo;
- una arista que conecta puntos que no deberian conectarse;
- una sala con `entranceNodeId` apuntando al nodo equivocado;
- falta de nodos intermedios en un pasillo.

## Busqueda de destinos

El usuario puede escribir consultas como:

```text
aula 5
quiero ir al bano de hombres
quiero ir a biblioteca
tengo que entregar papeles
```

El servidor intenta resolver la consulta en este orden:

1. Coincidencia directa con una sala o alias.
2. Coincidencia con servicios definidos en `services`.
3. Calculo de ruta desde la ubicacion actual hasta el destino encontrado.

Ejemplo de servicio:

```json
{
  "id": "service_entry",
  "name": "Mesa de Entradas",
  "roomId": "mesa_entradas",
  "description": "Para presentar notas, entregar documentacion o iniciar expedientes, ve a Mesa de Entradas.",
  "keywords": ["mesa de entradas", "documentacion", "expediente", "entregar papeles"],
  "examples": ["tengo que entregar papeles"]
}
```

Para agregar nuevos tramites, se debe agregar una entrada en `services` y vincularla con el `roomId` correcto.

## Accesibilidad

El mapa incluye soporte basico de accesibilidad:

- El SVG tiene `role="img"` y `aria-label`.
- Cada sala se comporta como boton con `role="button"`.
- Cada sala tiene `aria-label` para lectores de pantalla.
- Las salas pueden seleccionarse con teclado usando `Enter` o espacio.
- Los elementos decorativos usan `aria-hidden`.
- La zona de mensajes usa `aria-live="polite"`.

## Chroma y busqueda semantica

El proyecto puede intentar usar Chroma si esta instalado y configurado, pero no depende de Chroma para funcionar. Si Chroma no esta disponible, usa un fallback local para que la demo siga funcionando.

Configuracion opcional:

```bash
npm install chromadb
$env:CHROMA_URL="http://localhost:8000"
npm start
```

## Como seguir ajustando el mapa

Para mejorar precision:

1. Revisar que cada sala este visualmente fuera del pasillo gris.
2. Confirmar la puerta real de cada sala.
3. Ajustar `entranceNodeId`.
4. Agregar nodos en cruces o cambios de direccion del pasillo.
5. Conectar solo caminos transitables en `edges`.
6. Probar rutas criticas: Aula 4 a Fotocopiadora, Aula 5 a Banos, Entrada a Biblioteca, Entrada a Mesa de Entradas.

La regla principal es: las rutas solo deben moverse por la red de pasillos, nunca atravesar salas, paredes, espacios verdes o areas externas.
