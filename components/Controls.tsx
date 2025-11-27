
import React from 'react';
import { Upload, Box, Activity, Layers, Palette } from 'lucide-react';
import { ViewerSettings, ScalarField } from '../types';

interface ControlsProps {
  onFileUpload: (file: File) => void;
  settings: ViewerSettings;
  setSettings: React.Dispatch<React.SetStateAction<ViewerSettings>>;
  loading: boolean;
  stats: { points: number; cells: number } | null;
  fields: { point: ScalarField[], cell: ScalarField[] };
  activeField: string | null;
  setActiveField: (field: string | null) => void;
  activeFieldType: 'POINT' | 'CELL' | 'SOLID';
  setActiveFieldType: (type: 'POINT' | 'CELL' | 'SOLID') => void;
}

const Controls: React.FC<ControlsProps> = ({ 
  onFileUpload, 
  settings, 
  setSettings, 
  loading,
  stats,
  fields,
  activeField,
  setActiveField,
  activeFieldType,
  setActiveFieldType
}) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileUpload(e.target.files[0]);
    }
  };

  const getActiveFieldData = () => {
    if (activeFieldType === 'POINT') return fields.point.find(f => f.name === activeField);
    if (activeFieldType === 'CELL') return fields.cell.find(f => f.name === activeField);
    return null;
  };

  const activeData = getActiveFieldData();

  return (
    <div className="absolute top-4 right-4 w-80 bg-slate-900/90 backdrop-blur-md text-white p-6 rounded-xl shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto">
      <div className="flex items-center gap-3 mb-6 border-b border-slate-700 pb-4">
        <Box className="w-6 h-6 text-blue-400" />
        <h1 className="text-xl font-bold">VTK Viewer</h1>
      </div>

      <div className="space-y-6">
        {/* Upload */}
        <div className="relative group">
          <input
            type="file"
            accept=".vtk,.vtu"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
            disabled={loading}
          />
          <label
            htmlFor="file-upload"
            className={`flex items-center justify-center gap-2 w-full p-4 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
              loading 
                ? 'border-slate-600 bg-slate-800 opacity-50 cursor-not-allowed' 
                : 'border-blue-500 hover:border-blue-400 hover:bg-slate-800'
            }`}
          >
            <Upload className="w-5 h-5" />
            <span className="font-medium">{loading ? 'Parsing...' : 'Upload .vtk / .vtu'}</span>
          </label>
        </div>

        {/* Stats */}
        {stats && (
          <div className="bg-slate-800 p-4 rounded-lg space-y-2 text-sm">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-2"><Activity className="w-3 h-3" /> Points</span>
              <span className="text-white font-mono">{stats.points.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-2"><Layers className="w-3 h-3" /> Cells</span>
              <span className="text-white font-mono">{stats.cells.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Data Coloring Section */}
        {(fields.point.length > 0 || fields.cell.length > 0) && (
             <div className="space-y-3 pt-2 border-t border-slate-700">
                <h3 className="text-xs font-semibold uppercase text-slate-500 tracking-wider flex items-center gap-2">
                    <Palette className="w-3 h-3" /> Color Map
                </h3>
                
                <div className="space-y-2">
                    <select 
                        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                        value={`${activeFieldType}:${activeField || ''}`}
                        onChange={(e) => {
                            const [type, name] = e.target.value.split(':');
                            if (type === 'SOLID') {
                                setActiveFieldType('SOLID');
                                setActiveField(null);
                            } else {
                                setActiveFieldType(type as 'POINT' | 'CELL');
                                setActiveField(name);
                            }
                        }}
                    >
                        <option value="SOLID:">Solid Color</option>
                        {fields.point.length > 0 && (
                            <optgroup label="Point Data">
                                {fields.point.map(f => (
                                    <option key={`POINT:${f.name}`} value={`POINT:${f.name}`}>{f.name}</option>
                                ))}
                            </optgroup>
                        )}
                        {fields.cell.length > 0 && (
                            <optgroup label="Cell Data">
                                {fields.cell.map(f => (
                                    <option key={`CELL:${f.name}`} value={`CELL:${f.name}`}>{f.name}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>

                    {/* Legend */}
                    {activeData && (
                        <div className="mt-2 bg-slate-800 p-3 rounded border border-slate-700">
                            <div className="h-4 w-full rounded bg-gradient-to-r from-blue-600 via-green-500 to-red-600 mb-1"></div>
                            <div className="flex justify-between text-xs font-mono text-slate-400">
                                <span>{activeData.min.toExponential(2)}</span>
                                <span>{activeData.max.toExponential(2)}</span>
                            </div>
                        </div>
                    )}
                </div>
             </div>
        )}

        {/* Visualization Settings */}
        <div className="space-y-4 pt-2 border-t border-slate-700">
          <h3 className="text-xs font-semibold uppercase text-slate-500 tracking-wider">Visualization</h3>
          
          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-slate-300">Show Wireframe</span>
              <input 
                type="checkbox" 
                checked={settings.showWireframe}
                onChange={e => setSettings(p => ({ ...p, showWireframe: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-slate-300">Flat Shading</span>
              <input 
                type="checkbox" 
                checked={settings.flatShading}
                onChange={e => setSettings(p => ({ ...p, flatShading: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500"
              />
            </label>

            <div className="space-y-1">
              <div className="flex justify-between text-sm text-slate-300">
                <span>Opacity</span>
                <span>{settings.opacity.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={settings.opacity}
                onChange={e => setSettings(p => ({ ...p, opacity: parseFloat(e.target.value) }))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>
            
            {activeFieldType === 'SOLID' && (
                <div className="space-y-1">
                    <label className="text-xs text-slate-400">Mesh Color</label>
                    <input
                        type="color"
                        value={settings.color}
                        onChange={e => setSettings(p => ({ ...p, color: e.target.value }))}
                        className="h-8 w-full rounded cursor-pointer bg-slate-800 border border-slate-600 p-1"
                    />
                </div>
            )}
            
            <div className="space-y-1">
                 <label className="text-xs text-slate-400">Wireframe Color</label>
                 <input
                    type="color"
                    value={settings.wireframeColor}
                    onChange={e => setSettings(p => ({ ...p, wireframeColor: e.target.value }))}
                    className="h-8 w-full rounded cursor-pointer bg-slate-800 border border-slate-600 p-1"
                 />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Controls;
