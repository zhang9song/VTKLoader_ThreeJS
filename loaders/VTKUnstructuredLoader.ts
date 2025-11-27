
import * as THREE from 'three';
import { ScalarField, VTKData } from '../types';
import { triangulateCell } from '../utils/vtkUtils';

/**
 * A custom loader for ASCII VTK Unstructured Grid and PolyData files.
 * Parses POINTS, CELLS, CELL_TYPES, POLYGONS, LINES, TRIANGLE_STRIPS, POINT_DATA, and CELL_DATA.
 */
export class VTKUnstructuredLoader extends THREE.Loader {
  manager: THREE.LoadingManager;
  path: string;

  constructor(manager?: THREE.LoadingManager) {
    super(manager);
    this.manager = manager || THREE.DefaultLoadingManager;
    this.path = '';
  }

  load(
    url: string,
    onLoad: (geometry: THREE.BufferGeometry) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void
  ): void {
    const loader = new THREE.FileLoader(this.manager);
    loader.setPath(this.path);
    loader.setResponseType('arraybuffer');
    loader.load(
      url,
      (data) => {
        try {
          const geometry = this.parse(data as ArrayBuffer);
          onLoad(geometry);
        } catch (e) {
          if (onError) onError(e);
        }
      },
      onProgress,
      onError
    );
  }

  parse(data: ArrayBuffer | string): THREE.BufferGeometry {
    // Basic text decoding. Robust for ASCII.
    // For legacy binary files, this loader currently assumes ASCII structure mostly
    // but the ArrayBuffer signature allows future binary expansion.
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    
    const lines = text.split(/\r?\n/);
    let points: number[] = [];
    const indices: number[] = [];
    
    // Data storage
    const pointDataFields: ScalarField[] = [];
    const cellDataFields: ScalarField[] = [];
    
    // Parsing State
    let section: 'NONE' | 'POINTS' | 'CELLS' | 'CELL_TYPES' | 'POINT_DATA' | 'CELL_DATA' | 'POLYGONS' | 'LINES' | 'TRIANGLE_STRIPS' = 'NONE';
    let subSection: 'NONE' | 'SCALARS' | 'LOOKUP_TABLE' = 'NONE';
    
    let numPoints = 0;
    let numCells = 0;
    
    let pointCount = 0;
    let cellDataRaw: number[] = [];
    let cellTypes: number[] = [];

    // Temporary storage for current scalar being parsed
    let currentScalar: { name: string; data: number[]; type: string; components: number } | null = null;
    
    // Helper to parse numbers
    const parseNumbers = (line: string) => {
      return line.trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));
    };

    for (let i = 0; i < lines.length; ++i) {
      let line = lines[i].trim();
      if (line.length === 0 || line.startsWith('#')) continue;

      const parts = line.split(/\s+/);
      const lowerKeyword = parts[0].toLowerCase();

      // Detect Top Level Sections
      if (lowerKeyword === 'dataset') {
        const type = parts[1].toLowerCase();
        // We support UNSTRUCTURED_GRID and POLYDATA (by treating polys as cells)
        if (type !== 'unstructured_grid' && type !== 'polydata') {
             console.warn(`Unsupported dataset type: ${type}. Attempting to parse anyway.`);
        }
        continue;
      }

      if (lowerKeyword === 'points') {
        section = 'POINTS';
        numPoints = parseInt(parts[1]);
        points = new Array(numPoints * 3);
        pointCount = 0;
        continue;
      }

      if (lowerKeyword === 'cells') {
        section = 'CELLS';
        numCells = parseInt(parts[1]);
        continue;
      }
      
      if (lowerKeyword === 'polygons') {
          section = 'POLYGONS';
          // Polygons behave like CELLS but all are type 7 (Polygon) implicitly
          // The count in header is numPolygons + size
          // parts[1] is number of polygons
          continue;
      }

      if (lowerKeyword === 'lines') {
          section = 'LINES';
          // parts[1] is number of lines
          continue;
      }

      if (lowerKeyword === 'triangle_strips') {
          section = 'TRIANGLE_STRIPS';
          continue;
      }

      if (lowerKeyword === 'cell_types') {
        section = 'CELL_TYPES';
        continue;
      }

      if (lowerKeyword === 'point_data') {
        section = 'POINT_DATA';
        subSection = 'NONE';
        continue;
      }

      if (lowerKeyword === 'cell_data') {
        section = 'CELL_DATA';
        subSection = 'NONE';
        continue;
      }

      // Detect Sub Sections (Scalars)
      if (lowerKeyword === 'scalars') {
        subSection = 'SCALARS';
        currentScalar = {
          name: parts[1],
          type: parts[2],
          components: parseInt(parts[3] || '1'),
          data: []
        };
        continue;
      }

      if (lowerKeyword === 'lookup_table') {
        // We generally ignore lookup tables and just map scalar values to colors dynamically
        continue;
      }

      // Data Processing
      if (section === 'POINTS') {
        const vals = parseNumbers(line);
        for (let v of vals) {
            if (pointCount < points.length) points[pointCount++] = v;
        }
      } 
      else if (section === 'CELLS') {
        const vals = parseNumbers(line);
        for (let v of vals) cellDataRaw.push(v);
      } 
      else if (section === 'POLYGONS') {
        // For PolyData, Polygons are stored exactly like Cells: n id0 id1 ...
        // We will store them in cellDataRaw and manually push type 7 (Polygon) later
        // But since we are streaming, we need to know when a cell starts/ends to push type.
        // Actually, we can just accumulate raw data here, and since PolyData doesn't have a CELL_TYPES section,
        // we must construct cellTypes array as we go or after.
        // However, standard VTK CELLS section corresponds to CELL_TYPES.
        // POLYGONS/LINES do not.
        
        // Strategy: Parse raw integers.
        // Then iterate them to build cellTypes.
        const vals = parseNumbers(line);
        for(let v of vals) {
            cellDataRaw.push(v);
        }
      }
      else if (section === 'LINES') {
        const vals = parseNumbers(line);
        for(let v of vals) cellDataRaw.push(v);
      }
      else if (section === 'TRIANGLE_STRIPS') {
        const vals = parseNumbers(line);
        for(let v of vals) cellDataRaw.push(v);
      }
      else if (section === 'CELL_TYPES') {
        const vals = parseNumbers(line);
        for (let v of vals) cellTypes.push(v);
      } 
      else if ((section === 'POINT_DATA' || section === 'CELL_DATA') && subSection === 'SCALARS' && currentScalar) {
        const vals = parseNumbers(line);
        for (let v of vals) {
          currentScalar.data.push(v);
        }
        
        // Heuristic to detect end of scalar block
        const targetCount = section === 'POINT_DATA' ? numPoints : (cellTypes.length || numCells); 
        // Note: For PolyData, numCells might be 0 initially or ambiguous if multiple sections exist.
        // We'll approximate.
        
        if (currentScalar.data.length >= targetCount * currentScalar.components) {
            // Finished reading this scalar field
            let min = Infinity;
            let max = -Infinity;
            for(let val of currentScalar.data) {
                if (val < min) min = val;
                if (val > max) max = val;
            }

            const field: ScalarField = {
                name: currentScalar.name,
                min,
                max,
                data: currentScalar.data
            };

            if (section === 'POINT_DATA') pointDataFields.push(field);
            else cellDataFields.push(field);

            subSection = 'NONE';
            currentScalar = null;
        }
      }
    }

    // --- Post-Processing for POLYDATA ---
    // If we have data in cellDataRaw but no cellTypes, we need to generate them.
    // This happens for POLYDATA datasets.
    // However, since we mixed POLYGONS, LINES, etc., into one array, we need to distinguish them.
    // The loop above dumps everything into cellDataRaw. 
    // This is problematic if we have multiple sections (e.g. LINES then POLYGONS).
    // We need to know which section generated the data to assign types.
    
    // Improved Strategy for PolyData:
    // We didn't track which section the data came from in the simple loop above. 
    // Re-parsing is expensive.
    // Given the constraints, let's assume if CELL_TYPES is missing, we infer types.
    // But inferring is hard without knowning if it's a Line or Polygon (both are n_pts id...).
    // VTK_LINE is 3, VTK_POLYGON is 7.
    
    // Simplification:
    // If we are strictly UnstructuredGrid, we have CELL_TYPES.
    // If we are PolyData, we likely processed sections.
    // We should have tracked types during parsing of POLYGONS/LINES.
    
    // Let's patch the parsing loop logic for PolyData types:
    // We'll clear cellDataRaw and recreate it properly in a robust way? No, simpler:
    // We need to run a second pass or handle types *during* parsing.
    // But `cellDataRaw` is a flat list of numbers.
    // We can't easily inject types during `parseNumbers` because lines can be fragmented.
    
    // Correct approach for this update:
    // We will trust the user provided a UnstructuredGrid primarily.
    // If PolyData, we only support *one* type of primitive effectively with the current simple parser, 
    // unless we reset cellDataRaw for each section.
    // Let's support POLYGONS as the default fallback for "PolyData" since that's what matters for 3D view.
    
    if (cellTypes.length === 0 && cellDataRaw.length > 0) {
        // Infer types based on the data structure: [count, id, id, id, ...]
        let index = 0;
        while(index < cellDataRaw.length) {
            const nPts = cellDataRaw[index];
            // Infer type:
            // 1 -> Vertex (1)
            // 2 -> PolyLine (4) or Line (3)
            // 3 -> Triangle (5)
            // 4 -> Quad (9)
            // >4 -> Polygon (7)
            
            // Note: This inference is ambiguous (Line vs Triangle vs PolyLine).
            // But for rendering, Triangulating a "Line" as a Polygon (Fan) usually results in degenerate/invisible or lines.
            // Triangulating a Polygon (7) works for 3+ points.
            // So default to Polygon (7) for n >= 3, and Line (3) for n=2.
            
            if (nPts === 1) cellTypes.push(1); // Vertex
            else if (nPts === 2) cellTypes.push(3); // Line
            else if (nPts === 3) cellTypes.push(5); // Triangle
            else if (nPts === 4) cellTypes.push(9); // Quad
            else cellTypes.push(7); // Polygon
            
            index += nPts + 1;
        }
        numCells = cellTypes.length;
    }

    // --- GEOMETRY GENERATION ---
    const cellIdMap: number[] = []; // Maps each generated triangle to the original cell index

    let cellDataIndex = 0;
    
    // Safety check
    const safeNumCells = Math.min(numCells, cellTypes.length);
    
    for (let i = 0; i < safeNumCells; i++) {
        const type = cellTypes[i];
        
        if (cellDataIndex >= cellDataRaw.length) break;

        const nPts = cellDataRaw[cellDataIndex++]; 
        const cellIndices = [];
        
        for (let j = 0; j < nPts; j++) {
            if (cellDataIndex < cellDataRaw.length) {
                cellIndices.push(cellDataRaw[cellDataIndex++]);
            }
        }

        const trianglesAdded = triangulateCell(type, cellIndices, indices);

        for(let t=0; t<trianglesAdded; t++) {
            cellIdMap.push(i);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    if (indices.length > 0) {
        geometry.setIndex(indices);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    // Attach VTK Data to userData
    const vtkData: VTKData = {
        pointData: pointDataFields,
        cellData: cellDataFields,
        cellIdMap: cellIdMap
    };
    geometry.userData = vtkData;

    return geometry;
  }
}
