import { CellFlag, Direction, CELL_COUNT } from '../domain/constants';
import type { BoardSnapshot, FlowStepResult, RainEvent } from '../domain/types';
import type { StageTurnPreview } from '../domain/stage-session';
import type { ForecastCellView, StageCellRiskView } from './stage-projection';
import {
  getCellGeometry,
  insetDiamond,
  projectCell,
  sortCellIndicesForDrawing
} from './isometric';
import type { IsometricCellGeometry, IsometricLayout, IsometricPoint } from './isometric';
import { clampPlaybackProgress, playbackPulseForMotion } from './playback-visuals';

export interface BoardRenderOptions {
  readonly selectedCell?: number | null;
  readonly preview?: StageTurnPreview | null;
  readonly constructionAnchorCells?: readonly number[];
  readonly activePlacementCells?: readonly number[];
  readonly flowResult?: FlowStepResult | null;
  readonly rainCells?: readonly RainEvent[];
  readonly forecastCells?: readonly ForecastCellView[];
  readonly riskCells?: readonly StageCellRiskView[];
  readonly playbackProgress?: number | null;
  readonly reducedMotion?: boolean;
  readonly background?: string;
}

function polygonPath(
  context: CanvasRenderingContext2D,
  polygon: readonly IsometricPoint[]
): void {
  const first = polygon[0];
  if (first === undefined) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const current of polygon.slice(1)) context.lineTo(current.x, current.y);
  context.closePath();
}

function fillPolygon(
  context: CanvasRenderingContext2D,
  polygon: readonly IsometricPoint[],
  fill: string,
  stroke = 'rgba(12, 25, 36, 0.55)',
  lineWidth = 1
): void {
  polygonPath(context, polygon);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function terrainColor(terrain: number): string {
  const lightness = Math.max(18, Math.min(42, 30 + terrain * 1.7));
  return `hsl(142 28% ${lightness}%)`;
}

function terrainSideColor(terrain: number, side: 'left' | 'right'): string {
  const base = Math.max(12, Math.min(34, 23 + terrain * 1.4));
  return side === 'left' ? `hsl(145 26% ${base}%)` : `hsl(150 22% ${base - 4}%)`;
}

function waterLift(layout: IsometricLayout, amount: number): number {
  return Math.min(layout.tileHeight * 0.36, Math.max(0, amount) * 0.8);
}

function waterPolygon(
  layout: IsometricLayout,
  geometry: IsometricCellGeometry,
  amount: number
): readonly IsometricPoint[] {
  const liftedCenter = point(geometry.center.x, geometry.center.y - waterLift(layout, amount));
  const top = [
    point(liftedCenter.x, liftedCenter.y - layout.tileHeight * 0.42),
    point(liftedCenter.x + layout.tileWidth * 0.42, liftedCenter.y),
    point(liftedCenter.x, liftedCenter.y + layout.tileHeight * 0.42),
    point(liftedCenter.x - layout.tileWidth * 0.42, liftedCenter.y)
  ];
  return insetDiamond(top, Math.min(layout.tileWidth, layout.tileHeight) * 0.08);
}

function point(x: number, y: number): IsometricPoint {
  return Object.freeze({ x, y });
}

function drawEdgeMarker(
  context: CanvasRenderingContext2D,
  geometry: IsometricCellGeometry,
  mask: number,
  direction: Direction,
  color: string
): void {
  if ((mask & direction) === 0) return;
  const edgeIndex = direction === Direction.North
    ? 0
    : direction === Direction.East
      ? 1
      : direction === Direction.South
        ? 2
        : 3;
  const nextIndex = (edgeIndex + 1) % 4;
  const start = geometry.top[edgeIndex];
  const end = geometry.top[nextIndex];
  if (start === undefined || end === undefined) return;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.stroke();
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: IsometricPoint,
  to: IsometricPoint,
  color: string
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 6;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - Math.PI / 6) * head, to.y - Math.sin(angle - Math.PI / 6) * head);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 6) * head, to.y - Math.sin(angle + Math.PI / 6) * head);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function flowTarget(
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  from: number,
  to: number | null,
  direction: Direction
): IsometricPoint {
  const fromPoint = getCellGeometry(layout, snapshot, from).center;
  if (to !== null) return getCellGeometry(layout, snapshot, to).center;
  const distance = layout.tileWidth * 0.75;
  const horizontal = direction === Direction.East ? distance : direction === Direction.West ? -distance : 0;
  const vertical = direction === Direction.South ? distance * 0.45 : direction === Direction.North ? -distance * 0.45 : 0;
  return point(fromPoint.x + horizontal, fromPoint.y + vertical);
}

function drawFlowPreview(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  result: FlowStepResult
): void {
  for (const transfer of result.transfers) {
    const from = getCellGeometry(layout, snapshot, transfer.from).center;
    const to = flowTarget(layout, snapshot, transfer.from, transfer.to, transfer.direction);
    const color = transfer.kind === 'danger-edge'
      ? '#ff6b6b'
      : transfer.kind === 'safe-edge'
        ? '#8ee3cf'
        : '#b9e7ff';
    drawArrow(context, from, to, color);
  }
}

function riskColor(level: StageCellRiskView['level']): string {
  switch (level) {
    case 'caution': return 'rgba(255, 209, 102, 0.22)';
    case 'danger': return 'rgba(255, 145, 92, 0.28)';
    case 'critical': return 'rgba(255, 92, 92, 0.34)';
    case 'safe': return 'transparent';
  }
}

function forecastColor(eventIndex: number): string {
  return eventIndex % 2 === 0 ? '#c8f1ff' : '#b9a7ff';
}

function drawRiskOverlay(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  risks: readonly StageCellRiskView[]
): void {
  for (const risk of risks) {
    if (risk.level === 'safe') continue;
    const geometry = getCellGeometry(layout, snapshot, risk.index);
    fillPolygon(context, geometry.top, riskColor(risk.level), 'rgba(255, 255, 255, 0.18)', 1.5);
  }
}

function drawForecastOverlay(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  forecastCells: readonly ForecastCellView[]
): void {
  context.setLineDash([4, 3]);
  for (const forecast of forecastCells) {
    const geometry = getCellGeometry(layout, snapshot, forecast.index);
    const radius = Math.max(5, layout.tileHeight * 0.22) + forecast.eventIndex * 3;
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y, radius, 0, Math.PI * 2);
    context.strokeStyle = forecastColor(forecast.eventIndex);
    context.lineWidth = 2;
    context.stroke();
    context.font = `${Math.max(9, Math.round(layout.tileHeight * 0.2))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = forecastColor(forecast.eventIndex);
    context.fillText(String(forecast.amount), geometry.center.x, geometry.center.y - radius - 4);
  }
  context.setLineDash([]);
}

function drawConstructionAnchorMarkers(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>,
  anchorIndices: readonly number[]
): void {
  const radius = Math.max(5, Math.min(8, Math.min(layout.tileWidth, layout.tileHeight) * 0.34));
  for (const index of anchorIndices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= CELL_COUNT) continue;
    const geometry = getCellGeometry(layout, snapshot, index);
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y, radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(49, 214, 151, 0.78)';
    context.fill();
    context.strokeStyle = '#d7fff0';
    context.lineWidth = 1.5;
    context.stroke();
  }
}

/** Draws one deterministic board frame. It contains no game-rule calculations. */
export function renderIsometricBoard(
  context: CanvasRenderingContext2D,
  snapshot: BoardSnapshot,
  layout: IsometricLayout,
  options: BoardRenderOptions = {}
): void {
  context.clearRect(0, 0, layout.viewportWidth, layout.viewportHeight);
  context.fillStyle = options.background ?? '#071521';
  context.fillRect(0, 0, layout.viewportWidth, layout.viewportHeight);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  const terrain = options.preview?.terrainAfterConstruction;
  const renderSnapshot: Pick<BoardSnapshot, 'terrain'> = {
    terrain: terrain ?? snapshot.terrain
  };
  const indices = sortCellIndicesForDrawing(renderSnapshot);

  for (const index of indices) {
    const geometry = getCellGeometry(layout, renderSnapshot, index);
    if (geometry.terrain > 0) {
      fillPolygon(context, geometry.leftSide, terrainSideColor(geometry.terrain, 'left'));
      fillPolygon(context, geometry.rightSide, terrainSideColor(geometry.terrain, 'right'));
    }
  }

  for (const index of indices) {
    const geometry = getCellGeometry(layout, renderSnapshot, index);
    const waterAmount = snapshot.water[index] ?? 0;
    fillPolygon(context, geometry.top, terrainColor(geometry.terrain), 'rgba(8, 22, 31, 0.76)');
    if (waterAmount > 0) {
      fillPolygon(context, waterPolygon(layout, geometry, waterAmount), 'rgba(44, 166, 214, 0.72)', 'rgba(180, 235, 255, 0.45)');
    }

    const flags = snapshot.cellFlags[index] ?? 0;
    if ((flags & CellFlag.Protected) !== 0) {
      context.beginPath();
      context.arc(geometry.center.x, geometry.center.y, Math.max(4, layout.tileHeight * 0.12), 0, Math.PI * 2);
      context.fillStyle = '#ffe08a';
      context.fill();
      context.strokeStyle = '#5e4314';
      context.lineWidth = 1;
      context.stroke();
    }
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.North, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.East, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.South, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.safeEdgeMask[index] ?? 0, Direction.West, '#8ee3cf');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.North, '#ff6b6b');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.East, '#ff6b6b');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.South, '#ff6b6b');
    drawEdgeMarker(context, geometry, snapshot.dangerEdgeMask[index] ?? 0, Direction.West, '#ff6b6b');
  }

  drawRiskOverlay(context, layout, renderSnapshot, options.riskCells ?? []);
  drawForecastOverlay(context, layout, renderSnapshot, options.forecastCells ?? []);

  const selectedCell = options.selectedCell ?? null;
  if (selectedCell !== null && selectedCell >= 0 && selectedCell < CELL_COUNT) {
    const geometry = getCellGeometry(layout, renderSnapshot, selectedCell);
    fillPolygon(context, geometry.top, 'rgba(255, 255, 255, 0.14)', '#fff3b0', 3);
  }

  const preview = options.preview;
  const playbackProgress = clampPlaybackProgress(options.playbackProgress);
  const playbackPulseValue = playbackPulseForMotion(playbackProgress, options.reducedMotion ?? false);
  const activePlacementCells = options.activePlacementCells ?? [];
  for (const index of activePlacementCells) {
    const geometry = getCellGeometry(layout, renderSnapshot, index);
    fillPolygon(
      context,
      geometry.top,
      `rgba(255, 208, 92, ${0.12 + playbackPulseValue * 0.22})`,
      '#ffd166',
      2 + playbackPulseValue
    );
  }

  const activeFlow = options.flowResult ?? null;
  if (preview !== undefined && preview !== null && preview.valid) {
    for (const index of preview.placementCells) {
      const geometry = getCellGeometry(layout, renderSnapshot, index);
      fillPolygon(context, geometry.top, 'rgba(255, 208, 92, 0.28)', '#ffd166', 2);
    }
    if (activeFlow === null) drawFlowPreview(context, layout, renderSnapshot, preview.nextFlow);
    for (const rain of preview.rainCells) {
      const geometry = getCellGeometry(layout, renderSnapshot, rain.index);
      context.beginPath();
      context.arc(geometry.center.x, geometry.center.y - layout.tileHeight * 0.18, Math.max(3, layout.tileWidth * 0.06), 0, Math.PI * 2);
      context.fillStyle = '#e2f3ff';
      context.fill();
    }
  }

  if (activeFlow !== null) {
    const previousAlpha = context.globalAlpha;
    context.globalAlpha = 0.58 + playbackPulseValue * 0.42;
    drawFlowPreview(context, layout, snapshot, activeFlow);
    context.globalAlpha = previousAlpha;
  }

  for (const rain of options.rainCells ?? []) {
    const geometry = getCellGeometry(layout, snapshot, rain.index);
    const radius = Math.max(3, layout.tileWidth * 0.06) * (0.72 + playbackPulseValue * 0.55);
    context.beginPath();
    context.arc(geometry.center.x, geometry.center.y - layout.tileHeight * 0.18, radius, 0, Math.PI * 2);
    context.fillStyle = '#b9e7ff';
    context.fill();
  }

  drawBoardGridLabels(context, layout, renderSnapshot);
  drawConstructionAnchorMarkers(
    context,
    layout,
    renderSnapshot,
    options.constructionAnchorCells ?? []
  );
}

export function drawBoardGridLabels(
  context: CanvasRenderingContext2D,
  layout: IsometricLayout,
  snapshot: Pick<BoardSnapshot, 'terrain'>
): void {
  context.font = `${Math.max(9, Math.round(layout.tileHeight * 0.22))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(226, 243, 255, 0.5)';
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const geometry = getCellGeometry(layout, snapshot, index);
    context.fillText(String(index + 1), geometry.center.x, geometry.center.y + layout.tileHeight * 0.25);
  }
}
