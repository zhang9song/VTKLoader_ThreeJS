
import React, { useState, Suspense, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { VTKUnstructuredLoader } from './loaders/VTKUnstructuredLoader';
import { VTULoader } from './loaders/VTULoader';
import Scene from './components/Scene';
import Controls from './components/Controls';
import { ViewerSettings, VTKData, ScalarField } from './types';

const App: React.FC = () => {
  const [baseGeometry, setBaseGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [visualGeometry, setVisualGeometry] = useState<THREE.BufferGeometry | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ points: number; cells: number } | null>(null);
  
  const [vtkData, setVtkData] = useState<VTKData>({ pointData: [], cellData: [], cellIdMap: [] });
  const [activeField, setActiveField] = useState<string | null>(null);
  const [activeFieldType, setActiveFieldType] = useState<'POINT' | 'CELL' | 'SOLID'>('SOLID');

  const [settings, setSettings] = useState<ViewerSettings>({
    showWireframe: true,
    color: '#6366f1',
    wireframeColor: '#000000',
    opacity: 1.0,
    flatShading: true,
  });

  // Color Mapping Helper
  const getHeatmapColor = (value: number, min: number, max: number) => {
    let t = (value - min) / (max - min);
    if (isNaN(t)) t = 0.5;
    t = Math.max(0, Math.min(1, t));
    // Blue (240) to Red (0)
    const hue = (1.0 - t) * 0.6667; 
    const color = new THREE.Color();
    color.setHSL(hue, 1.0, 0.5);
    return color;
  };

  // Re-compute geometry colors when settings change
  useEffect(() => {
    if (!baseGeometry) return;

    if (activeFieldType === 'SOLID') {
      // Revert to base geometry without colors
      // We can just use baseGeometry but we need to ensure 'color' attribute is removed or ignored
      // Cloning is safer to avoid side effects if we mutate
      const geo = baseGeometry.clone(); // Clone is cheap for geometry structure, attributes are shared usually until modified
      // Ensure no color attribute if solid
      geo.deleteAttribute('color');
      setVisualGeometry(geo);
      return;
    }

    let targetGeometry: THREE.BufferGeometry;
    let field: ScalarField | undefined;

    if (activeFieldType === 'POINT') {
      field = vtkData.pointData.find(f => f.name === activeField);
      targetGeometry = baseGeometry.clone();
      
      if (field) {
         const count = targetGeometry.attributes.position.count;
         const colors = new Float32Array(count * 3);
         const { min, max, data } = field;
         
         for (let i = 0; i < count; i++) {
             const val = data[i] || 0;
             const c = getHeatmapColor(val, min, max);
             colors[i * 3] = c.r;
             colors[i * 3 + 1] = c.g;
             colors[i * 3 + 2] = c.b;
         }
         targetGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
    } 
    else if (activeFieldType === 'CELL') {
      field = vtkData.cellData.find(f => f.name === activeField);
      
      // For cell data, we must use non-indexed geometry to have per-face colors
      // because indices share vertices.
      // We assume baseGeometry has indices.
      targetGeometry = baseGeometry.toNonIndexed();
      
      if (field && vtkData.cellIdMap) {
         const count = targetGeometry.attributes.position.count;
         const colors = new Float32Array(count * 3);
         const { min, max, data } = field;
         const cellIdMap = vtkData.cellIdMap;

         // In non-indexed geometry (Triangle Soup), every 3 vertices is a triangle.
         // The order of triangles in toNonIndexed matches the order of indices/3.
         
         const numTriangles = count / 3;
         
         for (let t = 0; t < numTriangles; t++) {
             const cellIndex = cellIdMap[t];
             // If cellIndex is valid
             let val = min;
             if (cellIndex !== undefined && cellIndex < data.length) {
                 val = data[cellIndex];
             }
             
             const c = getHeatmapColor(val, min, max);
             
             // Set color for all 3 vertices of the triangle
             const vStart = t * 3;
             for (let k = 0; k < 3; k++) {
                 colors[(vStart + k) * 3] = c.r;
                 colors[(vStart + k) * 3 + 1] = c.g;
                 colors[(vStart + k) * 3 + 2] = c.b;
             }
         }
         targetGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
    }

    setVisualGeometry(targetGeometry!); // ! safe because handled above

  }, [baseGeometry, activeField, activeFieldType, vtkData]);


  const handleFileUpload = (file: File) => {
    setLoading(true);
    const reader = new FileReader();
    const isVtu = file.name.toLowerCase().endsWith('.vtu');

    reader.onload = (event) => {
      if (event.target?.result) {
        try {
          // Choose Loader based on extension
          let loader: THREE.Loader;
          if (isVtu) {
              loader = new VTULoader();
          } else {
              loader = new VTKUnstructuredLoader();
          }

          // Both loaders support .parse(ArrayBuffer)
          // @ts-ignore
          const geo = loader.parse(event.target.result as ArrayBuffer);
          
          // Safety check for empty geometry
          if (!geo || !geo.attributes.position || geo.attributes.position.count === 0) {
              throw new Error("Parsed geometry is empty or invalid.");
          }

          geo.center();
          
          // Store raw geometry and data
          setBaseGeometry(geo);
          setVisualGeometry(geo); // Default to solid
          
          const rawData = geo.userData as VTKData;
          setVtkData(rawData);
          
          // Stats extraction slightly differs depending on what the loader attaches, 
          // but we standardized on userData.cellData length for cells estimate
          // and attributes.position.count for points.
          let cellCount = 0;
          if (rawData.cellIdMap && rawData.cellIdMap.length > 0) {
              // Estimate distinct cells from the map (approximate if max ID is used)
              // Or better: get max ID from cellIdMap
              let maxId = 0;
              for(let id of rawData.cellIdMap) if(id > maxId) maxId = id;
              cellCount = maxId + 1;
          }

          setStats({
            points: geo.getAttribute('position').count,
            cells: cellCount
          });

          // Reset selection
          setActiveFieldType('SOLID');
          setActiveField(null);

        } catch (error) {
          console.error("Error parsing file:", error);
          alert("Failed to parse file. Ensure it is a valid .vtk or .vtu file.\n" + (error instanceof Error ? error.message : String(error)));
        } finally {
            setLoading(false);
        }
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="w-full h-screen bg-slate-950 overflow-hidden relative">
      <Canvas
        camera={{ position: [50, 50, 50], fov: 45 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene geometry={visualGeometry} settings={settings} />
        </Suspense>
      </Canvas>
      
      {!visualGeometry && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-slate-500">
           <div className="w-96 text-center space-y-4">
               <p className="text-2xl font-light">No Model Loaded</p>
               <p className="text-sm opacity-70">Upload an ASCII/Binary .vtk or .vtu file.</p>
           </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
           <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-blue-400 font-mono animate-pulse">Parsing Mesh...</p>
           </div>
        </div>
      )}

      <Controls 
        onFileUpload={handleFileUpload} 
        settings={settings}
        setSettings={setSettings}
        loading={loading}
        stats={stats}
        fields={{ point: vtkData.pointData, cell: vtkData.cellData }}
        activeField={activeField}
        setActiveField={setActiveField}
        activeFieldType={activeFieldType}
        setActiveFieldType={setActiveFieldType}
      />
    </div>
  );
};

export default App;
