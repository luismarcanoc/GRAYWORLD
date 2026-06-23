# GRAYWORLD

Juego de plataformas cooperativo local para dos jugadores. Yin y Yang deben llegar juntos a sus puertas mientras resuelven placas, campos de polaridad y trampas que reaccionan a sus movimientos.

## Contenido actual

- 7 mundos con 5 niveles cada uno (35 niveles).
- Movimiento y animación independiente para Yin y Yang.
- Trampas emergentes, pisos que caen, prensas y muros laterales.
- Placas normales, placas con memoria y puertas por polaridad.
- Mapa de niveles con progreso persistente en `localStorage`.
- Pantalla completa, volumen general/música/efectos y controles reasignables.
- Arte pixelado dibujado en canvas, sin recursos externos.
- Mascotas temporales que desbloquean poderes durante un nivel.
- Ocho poderes cooperativos: atravesar/luz, doble salto/empuje, encogerse/disparo y espada/escudo.
- Fases monocromáticas secuenciales: Yin recorre el mundo blanco y Yang el mundo negro.

## Controles predeterminados

| Jugador | Izquierda | Derecha | Saltar | Abajo / caída rápida | Poder / liberar mascota |
| --- | --- | --- | --- | --- | --- |
| Yin | A | D | W | S | Espacio |
| Yang | ← | → | ↑ | ↓ | L |

`Esc` abre y cierra la pausa.

## Desarrollo

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Vercel

El proyecto usa Next.js App Router y no necesita variables de entorno. Se puede importar directamente en Vercel o desplegar con:

```bash
npx vercel
```
