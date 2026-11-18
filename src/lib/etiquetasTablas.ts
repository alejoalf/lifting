/**
 * Adaptación de las tablas `.tabla` a teléfonos (ver "Adaptación a teléfonos" en styles.css):
 *
 * 1. Cada celda recibe un `data-label` con el título de su columna, para mostrarlo
 *    cuando la fila se dibuja como tarjeta.
 * 2. En pantallas angostas cada fila se vuelve desplegable: se ven las dos primeras
 *    celdas como resumen y el resto aparece al tocarla.
 *
 * Se hace de forma global y se mantiene al día con un MutationObserver, así ninguna
 * pantalla tiene que acordarse de hacerlo. Solo se tocan atributos que React no maneja
 * (data-*, role, tabindex, aria-expanded), por eso no interfiere con los re-renders.
 * Las tablas con clase `tabla-desplegable` traen su propio resumen y se dejan como están.
 */
const CONSULTA_MOVIL = "(max-width: 640px)";
const CELDAS_RESUMEN = 2;
const INTERACTIVOS = "a, button, input, select, textarea, label, summary";

function etiquetarCeldas(tabla: HTMLTableElement) {
  const filaEncabezado = tabla.tHead?.rows[0];
  if (!filaEncabezado) return;

  const titulos: string[] = [];
  for (const th of Array.from(filaEncabezado.cells)) {
    const texto = th.textContent?.trim() ?? "";
    for (let i = 0; i < th.colSpan; i++) titulos.push(texto);
  }

  for (const cuerpo of Array.from(tabla.tBodies)) {
    for (const fila of Array.from(cuerpo.rows)) {
      let columna = 0;
      for (const celda of Array.from(fila.cells)) {
        const titulo = celda.colSpan > 1 ? "" : titulos[columna] ?? "";
        if (celda.getAttribute("data-label") !== titulo) celda.setAttribute("data-label", titulo);
        columna += celda.colSpan;
      }
    }
  }
}

function prepararDesplegables(tabla: HTMLTableElement, movil: boolean) {
  const propia = tabla.classList.contains("tabla-desplegable");
  for (const cuerpo of Array.from(tabla.tBodies)) {
    for (const fila of Array.from(cuerpo.rows)) {
      const primera = fila.cells[0];
      const desplegable = movil && !propia && fila.cells.length > CELDAS_RESUMEN;
      if (desplegable) {
        if (!fila.hasAttribute("data-desplegable")) fila.setAttribute("data-desplegable", "");
        const expandido = fila.hasAttribute("data-abierto") ? "true" : "false";
        if (primera.getAttribute("aria-expanded") !== expandido) primera.setAttribute("aria-expanded", expandido);
        if (primera.getAttribute("role") !== "button") primera.setAttribute("role", "button");
        if (primera.tabIndex !== 0) primera.tabIndex = 0;
      } else if (fila.hasAttribute("data-desplegable")) {
        fila.removeAttribute("data-desplegable");
        fila.removeAttribute("data-abierto");
        primera?.removeAttribute("aria-expanded");
        primera?.removeAttribute("role");
        primera?.removeAttribute("tabindex");
      }
    }
  }
}

function alternarFila(fila: HTMLTableRowElement) {
  const abierta = fila.toggleAttribute("data-abierto");
  fila.cells[0]?.setAttribute("aria-expanded", abierta ? "true" : "false");
}

/** Devuelve la fila desplegable si el evento ocurrió en su resumen (y no sobre un link o control). */
function filaDelResumen(evento: Event) {
  const destino = evento.target;
  if (!(destino instanceof Element)) return null;
  const celda = destino.closest<HTMLTableCellElement>("tr[data-desplegable] > td");
  if (!celda || celda.cellIndex >= CELDAS_RESUMEN) return null;
  const interactivo = destino.closest(INTERACTIVOS);
  if (interactivo && celda.contains(interactivo)) return null;
  return celda.parentElement as HTMLTableRowElement;
}

export function iniciarEtiquetasTablas(raiz: HTMLElement = document.body) {
  const movil = window.matchMedia(CONSULTA_MOVIL);

  function actualizar() {
    raiz.querySelectorAll<HTMLTableElement>("table.tabla").forEach((tabla) => {
      etiquetarCeldas(tabla);
      prepararDesplegables(tabla, movil.matches);
    });
  }

  actualizar();
  let pendiente = false;
  const observer = new MutationObserver(() => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      actualizar();
    });
  });
  // No se observan atributos, así que los que ponemos no vuelven a disparar el observer.
  observer.observe(raiz, { childList: true, subtree: true, characterData: true });
  movil.addEventListener("change", actualizar);

  function alHacerClic(evento: MouseEvent) {
    const fila = filaDelResumen(evento);
    if (fila) alternarFila(fila);
  }
  function alPresionarTecla(evento: KeyboardEvent) {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const destino = evento.target;
    if (!(destino instanceof HTMLTableCellElement) || !destino.matches("tr[data-desplegable] > td[role=button]")) return;
    evento.preventDefault();
    alternarFila(destino.parentElement as HTMLTableRowElement);
  }
  raiz.addEventListener("click", alHacerClic);
  raiz.addEventListener("keydown", alPresionarTecla);

  return () => {
    observer.disconnect();
    movil.removeEventListener("change", actualizar);
    raiz.removeEventListener("click", alHacerClic);
    raiz.removeEventListener("keydown", alPresionarTecla);
  };
}
