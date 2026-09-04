/*
 * Folded Signal Field
 * A lightweight canvas depth layer, informed by Canvas UI's Grid approach:
 * live HTML remains fully interactive while a separate canvas carries the
 * dimensional response. It deliberately avoids a framework dependency.
 */
const canvas = document.querySelector("#foldField");

if (canvas) {
  const context = canvas.getContext("2d", { alpha: true });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    pointerX: window.innerWidth * 0.67,
    pointerY: window.innerHeight * 0.42,
    lastMove: 0,
    pulseAt: 0,
    animation: 0
  };

  const resize = () => {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  };

  const polygon = (points, fill, stroke) => {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index][0], points[index][1]);
    context.closePath();
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (stroke) {
      context.strokeStyle = stroke;
      context.stroke();
    }
  };

  const draw = (time = 0) => {
    if (!context || !state.width || !state.height) return;
    context.clearRect(0, 0, state.width, state.height);
    const compact = state.width < 720;
    const tile = compact ? 56 : 76;
    const halfWidth = tile;
    const halfHeight = tile * 0.38;
    const columns = Math.ceil(state.width / halfWidth) + 10;
    const rows = Math.ceil(state.height / halfHeight) + 12;
    const originX = state.width * 0.55;
    const originY = compact ? 92 : -38;
    const idle = reducedMotion.matches ? 0 : Math.sin(time * 0.00032) * 0.22;
    const pointerAge = Math.min(1, (time - state.lastMove) / 2400);
    const pulseAge = Math.max(0, 1 - (time - state.pulseAt) / 1250);

    context.lineWidth = 0.8;
    for (let row = -6; row < rows; row += 1) {
      for (let column = -columns; column < columns; column += 1) {
        const x = originX + (column - row) * halfWidth;
        const y = originY + (column + row) * halfHeight;
        const dx = x - state.pointerX;
        const dy = y - state.pointerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const influence = Math.max(0, 1 - distance / (compact ? 280 : 400));
        const ripple = Math.sin(distance * 0.034 - time * 0.0026) * influence * (1 - pointerAge) * 10;
        const lift = Math.max(0, influence * 36 + ripple + idle * 9 + pulseAge * Math.max(0, 1 - distance / 540) * 22);
        const topY = y - lift;
        const top = [[x, topY - halfHeight], [x + halfWidth, topY], [x, topY + halfHeight], [x - halfWidth, topY]];
        const tint = Math.min(0.30, 0.075 + influence * 0.20 + pulseAge * 0.11);
        const isViolet = (column + row) % 5 === 0;
        polygon(
          top,
          isViolet ? `rgba(151, 132, 255, ${tint})` : `rgba(103, 238, 202, ${tint})`,
          `rgba(160, 193, 255, ${0.09 + influence * 0.16})`
        );
        if (lift > 1) {
          polygon([top[2], top[3], [top[3][0], y], [top[2][0], y + lift]], "rgba(3, 7, 18, .26)");
          polygon([top[1], top[2], [top[2][0], y + lift], [top[1][0], y]], `rgba(77, 115, 170, ${0.04 + influence * 0.12})`);
        }
      }
    }

    if (!reducedMotion.matches && !document.hidden) state.animation = requestAnimationFrame(draw);
  };

  const render = (time) => {
    cancelAnimationFrame(state.animation);
    draw(time || performance.now());
  };

  resize();
  render();
  window.addEventListener("resize", () => { resize(); render(); }, { passive: true });
  window.addEventListener("pointermove", (event) => {
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.lastMove = performance.now();
    if (reducedMotion.matches) render();
  }, { passive: true });
  window.addEventListener("pointerdown", (event) => {
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.pulseAt = performance.now();
    render();
  }, { passive: true });
  reducedMotion.addEventListener?.("change", () => render());
}
