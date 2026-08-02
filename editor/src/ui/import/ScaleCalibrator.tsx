'use client';

/**
 * Two-point scale calibration surface for plan import (M1.5 — ARCHITECTURE §8.2).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * The user clicks two points they know the real distance between (a printed
 * dimension string, a graphic scale bar, a column bay) and types that distance.
 * `metersPerPixel = distance / pixelDistance` is the only calibration
 * `FloorUnderlay` and the extraction transform need, and it is measured in
 * **unscaled source-image pixels**: the preview is letterboxed to fit the dialog,
 * so every click is divided back through the fit scale before being stored. That
 * keeps the calibration independent of the preview size, which matters because
 * the same pixel space is what `frameUnitsPerPixel` normalizes against.
 */

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

/** A point in unscaled source-image pixel space. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** Preview box, CSS pixels. The image is letterboxed inside it. */
export const PREVIEW_WIDTH = 780;
export const PREVIEW_HEIGHT = 480;

const MARKER_RADIUS = 7;
const AMBER = '#fbbf24';

export interface ScaleCalibratorProps {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** 0, 1 or 2 points, in source-image pixels. */
  points: PixelPoint[];
  onPointsChange: (next: PixelPoint[]) => void;
}

/** Letterbox geometry for the preview: uniform scale plus centring offsets. */
function previewFit(imageWidth: number, imageHeight: number) {
  const scale =
    imageWidth > 0 && imageHeight > 0
      ? Math.min(PREVIEW_WIDTH / imageWidth, PREVIEW_HEIGHT / imageHeight)
      : 1;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (PREVIEW_WIDTH - drawWidth) / 2,
    offsetY: (PREVIEW_HEIGHT - drawHeight) / 2,
  };
}

export function ScaleCalibrator({
  imageDataUrl,
  imageWidth,
  imageHeight,
  points,
  onPointsChange,
}: ScaleCalibratorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // Decode once per source raster; the redraw effect below depends on the
  // decoded element, so nothing is painted until the bitmap is ready.
  useEffect(() => {
    let cancelled = false;
    const element = new Image();
    element.onload = () => {
      if (!cancelled) setImage(element);
    };
    element.src = imageDataUrl;
    return () => {
      cancelled = true;
      setImage(null);
    };
  }, [imageDataUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(PREVIEW_WIDTH * dpr);
    canvas.height = Math.round(PREVIEW_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    if (!image) return;

    const fit = previewFit(imageWidth, imageHeight);
    ctx.drawImage(image, fit.offsetX, fit.offsetY, fit.drawWidth, fit.drawHeight);

    const toPreview = (point: PixelPoint) => ({
      x: fit.offsetX + point.x * fit.scale,
      y: fit.offsetY + point.y * fit.scale,
    });

    const [first, second] = points;

    if (first && second) {
      const a = toPreview(first);
      const b = toPreview(second);
      ctx.save();
      // Dark halo under the measure line so it reads on white paper too.
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      const pixels = Math.hypot(second.x - first.x, second.y - first.y);
      const label = `${Math.round(pixels)} px`;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      ctx.save();
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      const width = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15,17,21,0.85)';
      ctx.fillRect(midX - width / 2 - 4, midY - 18, width + 8, 15);
      ctx.fillStyle = AMBER;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, midX, midY - 10);
      ctx.restore();
    }

    points.forEach((point, index) => {
      const p = toPreview(point);
      ctx.save();
      ctx.lineCap = 'round';
      // Halo, then the crosshair itself.
      for (const pass of [
        { color: 'rgba(0,0,0,0.6)', width: 3.5 },
        { color: AMBER, width: 1.5 },
      ]) {
        ctx.strokeStyle = pass.color;
        ctx.lineWidth = pass.width;
        ctx.beginPath();
        ctx.moveTo(p.x - MARKER_RADIUS, p.y);
        ctx.lineTo(p.x + MARKER_RADIUS, p.y);
        ctx.moveTo(p.x, p.y - MARKER_RADIUS);
        ctx.lineTo(p.x, p.y + MARKER_RADIUS);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, MARKER_RADIUS - 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = AMBER;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), p.x + MARKER_RADIUS + 3, p.y);
      ctx.restore();
    });
  }, [image, imageWidth, imageHeight, points]);

  function handleClick(event: ReactMouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    if (!canvas || imageWidth <= 0 || imageHeight <= 0) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // The canvas may be laid out smaller than PREVIEW_WIDTH on a narrow window;
    // normalize through the measured box before undoing the letterbox.
    const previewX = ((event.clientX - rect.left) / rect.width) * PREVIEW_WIDTH;
    const previewY = ((event.clientY - rect.top) / rect.height) * PREVIEW_HEIGHT;

    const fit = previewFit(imageWidth, imageHeight);
    if (fit.scale <= 0) return;
    const x = (previewX - fit.offsetX) / fit.scale;
    const y = (previewY - fit.offsetY) / fit.scale;
    // Clicks in the letterbox margin are not on the plan.
    if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) return;

    // A third click starts a fresh measurement rather than silently doing nothing.
    onPointsChange(points.length >= 2 ? [{ x, y }] : [...points, { x, y }]);
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      aria-label="Plan preview — click two points a known distance apart"
      className="max-w-full cursor-crosshair rounded-sm border border-editor-border"
      style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
    />
  );
}

export default ScaleCalibrator;
