import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Dataset, CellPoint } from '../../types';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Download } from 'lucide-react';
import { downloadCsv } from '../../utils/export';

// Shared zoom/layout constants so the wheel handler, buttons, and draw loop
// all agree on the same geometry.
const PADDING = 60;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 20;

// Compute the equal-scale origin that centres the data cloud within the canvas.
function scaleAndOrigin(
  canvasW: number, canvasH: number,
  rangeX: number, rangeY: number,
  zoom: number, padding: number,
) {
  const scale = Math.min(
    (canvasW - padding * 2) / rangeX,
    (canvasH - padding * 2) / rangeY,
  ) * zoom;
  const originX = padding + (canvasW - padding * 2 - rangeX * scale) / 2;
  const originY = padding + (canvasH - padding * 2 - rangeY * scale) / 2;
  return { scale, originX, originY };
}

const CELL_TYPE_COLORS: Record<string, string> = {
  'Tumor':        '#ef4444',
  'CD8+ T Cell':  '#3b82f6',
  'CD4+ T Cell':  '#8b5cf6',
  'Macrophage':   '#f59e0b',
  'NK Cell':      '#10b981',
  'B Cell':       '#06b6d4',
  'Stromal':      '#6b7280',
  'CAF':          '#f97316',
  'Fibroblast':   '#84cc16',
};

interface Props {
  dataset: Dataset;
  activeMarker?: string;
  miniMode?: boolean;
  height?: number;
}

export default function SpatialPlot({ dataset, activeMarker, miniMode = false, height = 480 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredCell, setHoveredCell] = useState<CellPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const animFrameRef = useRef<number>(0);
  const hoverRafRef = useRef<number>(0);
  // Last cursor position seen over the canvas (in canvas-internal pixel
  // space), so the +/- zoom buttons can anchor on "wherever the mouse is"
  // too, not just the canvas center. Persists after the cursor moves onto
  // the button itself (a sibling overlay), which is exactly what we want.
  const lastPointerRef = useRef<{ cx: number; cy: number } | null>(null);
  // drawRef lets the ResizeObserver always call the latest draw without
  // needing to be re-registered every time draw changes.
  const drawRef = useRef<() => void>(() => {});

  // Stable identity → draw() doesn't get a new reference on every render.
  const visibleLayers = useMemo(
    () => new Set(
      dataset.layers
        .filter(l => l.visible && l.cellType)
        .map(l => l.cellType as string)
    ),
    [dataset.layers]
  );

  // Compute bounds ONCE per dataset using a single pass — no spread (which
  // would throw `RangeError: Maximum call stack size exceeded` for large
  // uploads) and not recomputed on every frame / mousemove.
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of dataset.cells) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    const rangeX = (maxX - minX) || 1;
    const rangeY = (maxY - minY) || 1;
    return { minX, maxX, minY, maxY, rangeX, rangeY };
  }, [dataset.cells]);

  const getMarkerColor = useCallback((value: number): string => {
    const v = Math.max(0, Math.min(1, value));
    const r = Math.round(v * 255);
    const g = Math.round(20 + (1 - v) * 20);
    const b = Math.round(255 * (1 - v));
    return `rgba(${r},${g},${b},0.85)`;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e2837';
    ctx.lineWidth = 1;
    const gridStep = 80 * zoom;
    const offsetX = (pan.x % gridStep + gridStep) % gridStep;
    const offsetY = (pan.y % gridStep + gridStep) % gridStep;
    for (let x = offsetX; x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = offsetY; y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const cells = dataset.cells;
    if (!cells.length) return;

    const { minX, minY, rangeX, rangeY } = bounds;
    const { scale, originX, originY } = scaleAndOrigin(W, H, rangeX, rangeY, zoom, PADDING);

    const toScreen = (x: number, y: number) => ({
      sx: originX + (x - minX) * scale + pan.x,
      sy: originY + (y - minY) * scale + pan.y,
    });

    // Cap the circle radius so deep zoom (needed to separate dense clusters)
    // doesn't balloon individual cells into oversized blobs.
    const r = miniMode ? 2 : Math.min(16, Math.max(2, 4 * zoom));

    for (const cell of cells) {
      const isVisible = visibleLayers.has(cell.cellType) ||
        (visibleLayers.size === 0);

      if (!isVisible) continue;

      const { sx, sy } = toScreen(cell.x, cell.y);
      if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;

      let color: string;
      if (activeMarker && cell.markers[activeMarker] !== undefined) {
        color = getMarkerColor(cell.markers[activeMarker]);
      } else {
        color = CELL_TYPE_COLORS[cell.cellType] || '#6b7280';
      }

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Hovered cell tooltip target
    if (hoveredCell && !miniMode) {
      const { sx, sy } = toScreen(hoveredCell.x, hoveredCell.y);
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [dataset.cells, zoom, pan, activeMarker, hoveredCell, miniMode, visibleLayers, getMarkerColor, bounds]);

  // Keep drawRef up to date so the ResizeObserver can always call the latest draw.
  useEffect(() => { drawRef.current = draw; }, [draw]);

  // Sync canvas buffer size to its CSS display size so there is no asymmetric
  // pixel-stretching that would make circular tissue cores appear oval.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          canvas.width  = Math.round(width);
          canvas.height = Math.round(height);
          animFrameRef.current = requestAnimationFrame(() => drawRef.current());
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  // Zoom while keeping the world point under (canvasX, canvasY) fixed on
  // screen. Without this, `scaleAndOrigin` re-centres the fitted view on
  // every zoom step, so any panning the user did gets silently undone and
  // the image appears to "jump" — this is what made zooming feel broken.
  const applyZoom = useCallback((
    canvasX: number,
    canvasY: number,
    computeNext: (current: number) => number,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { minX, minY, rangeX, rangeY } = bounds;
    setZoom(currentZoom => {
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, computeNext(currentZoom)));
      if (nextZoom === currentZoom) return currentZoom;
      const oldGeom = scaleAndOrigin(canvas.width, canvas.height, rangeX, rangeY, currentZoom, PADDING);
      const newGeom = scaleAndOrigin(canvas.width, canvas.height, rangeX, rangeY, nextZoom, PADDING);
      setPan(currentPan => {
        const worldX = (canvasX - oldGeom.originX - currentPan.x) / oldGeom.scale + minX;
        const worldY = (canvasY - oldGeom.originY - currentPan.y) / oldGeom.scale + minY;
        return {
          x: canvasX - newGeom.originX - (worldX - minX) * newGeom.scale,
          y: canvasY - newGeom.originY - (worldY - minY) * newGeom.scale,
        };
      });
      return nextZoom;
    });
  }, [bounds]);

  // Returns mouse position in canvas-internal pixel space and display pixel space.
  // The canvas has a fixed internal resolution (width/height attrs) but is scaled
  // by CSS to fill the container, so raw clientX/Y must be scaled to match.
  // Accepts both React's synthetic events and native DOM events (clientX/Y is
  // the only thing needed) since the wheel handler below is attached natively.
  const getCanvasCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return null;
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    return { cx: displayX * ratioX, cy: displayY * ratioY, displayX, displayY };
  }, []);

  // Attached natively (not via React's onWheel prop) with `passive: false`.
  // Browsers/React may treat JSX-bound wheel listeners as passive, which
  // makes `preventDefault()` silently fail — the page would then scroll
  // right along with the zoom. A native listener guarantees it's blocked.
  const handleWheel = useCallback((e: WheelEvent) => {
    if (miniMode) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;
    lastPointerRef.current = { cx: coords.cx, cy: coords.cy };
    e.preventDefault();
    // Proportional to scroll delta so both notchy mice and smooth trackpads
    // feel consistent, and zoom anchors on the cursor instead of re-centring.
    const factor = Math.exp(-e.deltaY * 0.0018);
    applyZoom(coords.cx, coords.cy, z => z * factor);
  }, [applyZoom, getCanvasCoords, miniMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (miniMode) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;
    applyZoom(coords.cx, coords.cy, z => z * 1.8);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e);
    if (!coords) return;
    setDragging(true);
    setDragStart({ x: coords.cx - pan.x, y: coords.cy - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getCanvasCoords(e);
    if (!coords) return;
    lastPointerRef.current = { cx: coords.cx, cy: coords.cy };

    if (dragging) {
      setPan({ x: coords.cx - dragStart.x, y: coords.cy - dragStart.y });
    }

    if (miniMode) return;
    setMousePos({ x: coords.displayX, y: coords.displayY });

    // Throttle the hover hit-test to once per animation frame so the linear
    // cell scan doesn't run on every mousemove pixel (was freezing the tab
    // on large uploads).
    if (hoverRafRef.current) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = 0;
      const cells = dataset.cells;
      if (!cells.length) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { minX, minY, rangeX, rangeY } = bounds;
      const { scale, originX, originY } = scaleAndOrigin(
        canvas.width, canvas.height, rangeX, rangeY, zoom, PADDING,
      );

      const worldX = (coords.cx - originX - pan.x) / scale + minX;
      const worldY = (coords.cy - originY - pan.y) / scale + minY;
      const threshold = 8 / scale;

      let near: CellPoint | null = null;
      let bestDist = threshold * threshold;
      for (const c of cells) {
        if (!visibleLayers.has(c.cellType)) continue;
        const dx = c.x - worldX;
        const dy = c.y - worldY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; near = c; }
      }
      setHoveredCell(near);
    });
  };

  useEffect(() => () => {
    if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
  }, []);

  const handleMouseUp = () => setDragging(false);
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); lastPointerRef.current = null; };

  const handleExportCsv = useCallback(() => {
    if (!dataset.cells.length) return;
    const markerKeys = Array.from(
      dataset.cells.reduce((keys, c) => {
        for (const k of Object.keys(c.markers)) keys.add(k);
        return keys;
      }, new Set<string>()),
    );
    const columns = ['x', 'y', 'cell_type', 'sample_id', 'region', 'cluster', ...markerKeys];
    const rows = dataset.cells.map(c => ({
      x: c.x,
      y: c.y,
      cell_type: c.cellType,
      sample_id: c.sampleId ?? '',
      region: c.region ?? '',
      cluster: c.cluster ?? '',
      ...Object.fromEntries(markerKeys.map(k => [k, c.markers[k] ?? ''])),
    }));
    downloadCsv(rows, `spatial-cells-${dataset.id}.csv`, columns);
  }, [dataset.cells, dataset.id]);

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden border border-slate-800" style={{ height, overscrollBehavior: 'contain' }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragging(false); setHoveredCell(null); }}
        onDoubleClick={handleDoubleClick}
      />

      {!miniMode && (
        <>
          {/* Controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-1.5">
            <button
              title="Export CSV"
              onClick={handleExportCsv}
              disabled={!dataset.cells.length}
              className="w-7 h-7 bg-slate-900/90 border border-slate-700 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={12} />
            </button>
            <div className="h-px bg-slate-800 mx-1" />
            <button
              title="Zoom in"
              onClick={() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const anchor = lastPointerRef.current ?? { cx: canvas.width / 2, cy: canvas.height / 2 };
                applyZoom(anchor.cx, anchor.cy, z => z * 1.3);
              }}
              className="w-7 h-7 bg-slate-900/90 border border-slate-700 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
            >
              <ZoomIn size={13} />
            </button>
            <button
              title="Zoom out"
              onClick={() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const anchor = lastPointerRef.current ?? { cx: canvas.width / 2, cy: canvas.height / 2 };
                applyZoom(anchor.cx, anchor.cy, z => z / 1.3);
              }}
              className="w-7 h-7 bg-slate-900/90 border border-slate-700 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
            >
              <ZoomOut size={13} />
            </button>
            <button title="Reset view" onClick={reset} className="w-7 h-7 bg-slate-900/90 border border-slate-700 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-500 transition-colors">
              <RotateCcw size={12} />
            </button>
            <button title="Fit to view" onClick={reset} className="w-7 h-7 bg-slate-900/90 border border-slate-700 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:border-slate-500 transition-colors">
              <Maximize2 size={12} />
            </button>
          </div>

          {/* Zoom indicator */}
          <div className="absolute bottom-3 left-3 text-[10px] font-mono text-slate-600 bg-slate-900/80 px-2 py-0.5 rounded">
            {Math.round(zoom * 100)}% · {dataset.cellCount.toLocaleString()} cells · scroll to zoom · drag to pan · double-click to zoom in
          </div>

          {/* Hover tooltip */}
          {hoveredCell && (
            <div
              className="absolute z-10 pointer-events-none bg-slate-900/95 border border-slate-700 rounded-lg p-2.5 text-xs max-w-[200px] shadow-xl"
              style={{ left: mousePos.x + 14, top: mousePos.y - 10 }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: CELL_TYPE_COLORS[hoveredCell.cellType] || '#6b7280' }} />
                <span className="font-semibold text-slate-200">{hoveredCell.cellType}</span>
              </div>
              <div className="space-y-0.5 text-slate-400">
                <div>x: {hoveredCell.x.toFixed(1)} · y: {hoveredCell.y.toFixed(1)}</div>
                {Object.entries(hoveredCell.markers).slice(0, 3).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span>{k}:</span>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full" style={{ width: `${v * 100}%` }} />
                    </div>
                    <span className="font-mono text-slate-300">{(v * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active marker label */}
          {activeMarker && (
            <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-300">
              Coloring by <span className="font-semibold text-brand-400">{activeMarker}</span>
              <div className="mt-1 flex items-center gap-1">
                <div className="h-1.5 w-20 rounded-full" style={{ background: 'linear-gradient(to right, #3b82f6, #ef4444)' }} />
                <span className="text-[10px] text-slate-500">Low → High</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
