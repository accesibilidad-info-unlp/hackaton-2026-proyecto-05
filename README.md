# Mapa interactivo de la facultad

## Descripción

Mapa interactivo del primer piso de la facultad que toma en cuenta las entradas de la facultad tanto aquellas con rampa como las gradas para tener una mejor idea de la distribución de la misma.

## Integrantes

- Aby Sequeiros
- Matias Miyawaki
- Walter Lin
- Lizbeth Sanchez

## Tecnologías utilizadas

- Figma (para crear las capas, svg)
- Gemini
- Google IA Studio

## Instalación y ejecución

Requisitos previos: Node.js

Se debe instalar las dependencias:  npm install

Configurar GEMINI_API_KEY en [.env.local](.env.local) con tu clave API de Gemini.

Para ejecutar la app:  npm run dev

## Estado actual

Se tomo en cuenta el primer piso de la facultad, solo algunas zonas de importancia como biblioteca, aula 5, baños entre otros. Falta optimizar el svg para que siga una ruta mas exacta en el mapa.
