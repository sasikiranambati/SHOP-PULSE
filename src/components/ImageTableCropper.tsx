import React, { useState, useRef, useCallback } from 'react';
import { 
  ScanLine, 
  RotateCw, 
  Maximize2, 
  X, 
  Camera, 
  HelpCircle,
  Move
} from 'lucide-react';
import type { CropRegion } from '../services/imagePreprocessor';

interface ImageTableCropperProps {
  imageUrl: string;
  onConfirmCrop: (cropRegion: CropRegion) => void;
  onCancel: () => void;
  onRetake?: () => void;
}

type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'move' | null;

export const ImageTableCropper: React.FC<ImageTableCropperProps> = ({
  imageUrl,
  onConfirmCrop,
  onCancel,
  onRetake,
}) => {
  // Crop region stored as percentage: 0 to 100
  const [crop, setCrop] = useState<CropRegion>({
    x: 8,
    y: 18,
    width: 84,
    height: 64,
    unit: 'percent',
  });

  const [rotation, setRotation] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeHandleRef = useRef<HandleType>(null);
  const startDragRef = useRef<{ clientX: number; clientY: number; initialCrop: CropRegion } | null>(null);

  const resetToTablePreset = () => {
    setCrop({
      x: 8,
      y: 18,
      width: 84,
      height: 64,
      unit: 'percent',
    });
  };

  const resetToFullPreset = () => {
    setCrop({
      x: 2,
      y: 2,
      width: 96,
      height: 96,
      unit: 'percent',
    });
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Pointer event handlers for moving and resizing crop box
  const handlePointerDown = (e: React.PointerEvent, handle: HandleType) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    activeHandleRef.current = handle;
    startDragRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      initialCrop: { ...crop },
    };
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!activeHandleRef.current || !startDragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dxPercent = ((e.clientX - startDragRef.current.clientX) / rect.width) * 100;
    const dyPercent = ((e.clientY - startDragRef.current.clientY) / rect.height) * 100;
    const initial = startDragRef.current.initialCrop;
    const handle = activeHandleRef.current;

    const minSize = 10; // minimum 10% width/height

    let newX = initial.x;
    let newY = initial.y;
    let newW = initial.width;
    let newH = initial.height;

    if (handle === 'move') {
      newX = Math.max(0, Math.min(100 - initial.width, initial.x + dxPercent));
      newY = Math.max(0, Math.min(100 - initial.height, initial.y + dyPercent));
    } else {
      // Horizontal resize
      if (handle === 'nw' || handle === 'w' || handle === 'sw') {
        const potentialW = initial.width - dxPercent;
        if (potentialW >= minSize) {
          newX = Math.max(0, initial.x + dxPercent);
          newW = potentialW;
        }
      } else if (handle === 'ne' || handle === 'e' || handle === 'se') {
        newW = Math.max(minSize, Math.min(100 - initial.x, initial.width + dxPercent));
      }

      // Vertical resize
      if (handle === 'nw' || handle === 'n' || handle === 'ne') {
        const potentialH = initial.height - dyPercent;
        if (potentialH >= minSize) {
          newY = Math.max(0, initial.y + dyPercent);
          newH = potentialH;
        }
      } else if (handle === 'sw' || handle === 's' || handle === 'se') {
        newH = Math.max(minSize, Math.min(100 - initial.y, initial.height + dyPercent));
      }
    }

    setCrop({
      x: Math.round(newX * 10) / 10,
      y: Math.round(newY * 10) / 10,
      width: Math.round(newW * 10) / 10,
      height: Math.round(newH * 10) / 10,
      unit: 'percent',
    });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (activeHandleRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (_) {
        // ignore
      }
      activeHandleRef.current = null;
      startDragRef.current = null;
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex flex-col p-2 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="bg-white rounded-t-2xl p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
            <ScanLine className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              Crop Product Table
              <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                V2 Table Only
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              Drag the green box to select ONLY the line-items table. Keep column headers inside.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRotate}
            title="Rotate 90 degrees"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <RotateCw className="w-4 h-4" />
            <span className="hidden sm:inline">Rotate</span>
          </button>
          <button
            type="button"
            onClick={resetToTablePreset}
            title="Focus Table preset"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <ScanLine className="w-4 h-4 text-emerald-600" />
            <span className="hidden sm:inline">Table Preset</span>
          </button>
          <button
            type="button"
            onClick={resetToFullPreset}
            title="Select full image"
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <Maximize2 className="w-4 h-4" />
            <span className="hidden sm:inline">Full Area</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Interactive Cropper Canvas Workspace */}
      <div className="flex-1 bg-slate-950/95 relative flex items-center justify-center p-2 sm:p-6 overflow-hidden select-none">
        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative max-h-full max-w-full flex items-center justify-center rounded-lg overflow-hidden shadow-2xl border border-slate-800"
          style={{
            touchAction: 'none',
          }}
        >
          {/* Base Invoice Image */}
          <img
            src={imageUrl}
            alt="Invoice preview for cropping"
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              maxHeight: 'calc(100vh - 220px)',
              maxWidth: '100%',
              display: 'block',
              objectFit: 'contain',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />

          {/* Darkened overlay outside the crop box */}
          {/* Top dark band */}
          <div
            className="absolute left-0 right-0 top-0 bg-slate-950/60 pointer-events-none"
            style={{ height: `${crop.y}%` }}
          />
          {/* Bottom dark band */}
          <div
            className="absolute left-0 right-0 bottom-0 bg-slate-950/60 pointer-events-none"
            style={{ height: `${100 - (crop.y + crop.height)}%` }}
          />
          {/* Left dark band */}
          <div
            className="absolute left-0 bg-slate-950/60 pointer-events-none"
            style={{
              top: `${crop.y}%`,
              height: `${crop.height}%`,
              width: `${crop.x}%`,
            }}
          />
          {/* Right dark band */}
          <div
            className="absolute right-0 bg-slate-950/60 pointer-events-none"
            style={{
              top: `${crop.y}%`,
              height: `${crop.height}%`,
              width: `${100 - (crop.x + crop.width)}%`,
            }}
          />

          {/* Draggable & Resizable Active Crop Box */}
          <div
            className="absolute border-2 border-emerald-400 bg-emerald-500/10 cursor-move transition-shadow shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
            style={{
              left: `${crop.x}%`,
              top: `${crop.y}%`,
              width: `${crop.width}%`,
              height: `${crop.height}%`,
            }}
            onPointerDown={(e) => handlePointerDown(e, 'move')}
          >
            {/* Rule of thirds grid lines */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
              <div className="border-r border-b border-emerald-300 border-dashed" />
              <div className="border-r border-b border-emerald-300 border-dashed" />
              <div className="border-b border-emerald-300 border-dashed" />
              <div className="border-r border-b border-emerald-300 border-dashed" />
              <div className="border-r border-b border-emerald-300 border-dashed" />
              <div className="border-b border-emerald-300 border-dashed" />
              <div className="border-r border-emerald-300 border-dashed" />
              <div className="border-r border-emerald-300 border-dashed" />
              <div />
            </div>

            {/* Center move badge */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-slate-900/80 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm backdrop-blur-xs">
                <Move className="w-3 h-3" />
                Drag to Move Table Box
              </span>
            </div>

            {/* Corner Handles */}
            <div
              className="absolute -top-2.5 -left-2.5 w-5 h-5 bg-emerald-400 border-2 border-white rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform"
              onPointerDown={(e) => handlePointerDown(e, 'nw')}
            />
            <div
              className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-emerald-400 border-2 border-white rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform"
              onPointerDown={(e) => handlePointerDown(e, 'ne')}
            />
            <div
              className="absolute -bottom-2.5 -left-2.5 w-5 h-5 bg-emerald-400 border-2 border-white rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform"
              onPointerDown={(e) => handlePointerDown(e, 'sw')}
            />
            <div
              className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-emerald-400 border-2 border-white rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform"
              onPointerDown={(e) => handlePointerDown(e, 'se')}
            />

            {/* Edge Handles */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-2.5 bg-emerald-400 border border-white rounded-full cursor-ns-resize"
              onPointerDown={(e) => handlePointerDown(e, 'n')}
            />
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-8 h-2.5 bg-emerald-400 border border-white rounded-full cursor-ns-resize"
              onPointerDown={(e) => handlePointerDown(e, 's')}
            />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 h-8 w-2.5 bg-emerald-400 border border-white rounded-full cursor-ew-resize"
              onPointerDown={(e) => handlePointerDown(e, 'w')}
            />
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-8 w-2.5 bg-emerald-400 border border-white rounded-full cursor-ew-resize"
              onPointerDown={(e) => handlePointerDown(e, 'e')}
            />
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="bg-white rounded-b-2xl p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-lg shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <HelpCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Selected region: {Math.round(crop.width)}% × {Math.round(crop.height)}% of document.
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {onRetake && (
            <button
              type="button"
              onClick={onRetake}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" />
              Retake / Re-upload
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirmCrop(crop)}
            className="px-5 py-2 text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            <ScanLine className="w-4 h-4" />
            Confirm Crop & Scan Table
          </button>
        </div>
      </div>
    </div>
  );
};
