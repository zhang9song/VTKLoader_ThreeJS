
import * as THREE from 'three';
import { ScalarField, VTKData } from '../types';
import { triangulateCell } from '../utils/vtkUtils';

/**
 * A custom loader for ASCII VTK Unstructured Grid files.
 * Parses POINTS, CELLS, CELL_TYPES, POINT_DATA, and CELL_DATA.
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
    loader.setResponseType('text');
    loader.load(
      url,
      (text) => {
        try {
          const geometry = this.parse(text as string);
          onLoad(geometry);
        } catch (e) {
          if (onError) onError(e);
        }
      },
      onProgress,
      onError
    );
  }

  parse(data: string): THREE.BufferGeometry {
    const lines = data.split(/\r?\n/);
    let points: number[] = [];
    const indices: number[] = [];
    
    // Data storage
    const pointDataFields: ScalarField[] = [];
    const cellDataFields: ScalarField[] = [];
    
    // Parsing State
    let section: 'NONE' | 'POINTS' | 'CELLS' | 'CELL_TYPES' | 'POINT_DATA' | 'CELL_DATA' = 'NONE';
    let subSection: 'NONE' | 'SCALARS' | 'LOOKUP_TABLE' = 'NONE';
    
    let numPoints = 0;
    let numCells = 0;
    
    let pointCount = 0;
    let cellDataRaw: number[] = [];
    let cellTypes: number[] = [];

    // Temporary storage for current scalar being parsed
    let currentScalar: { name: string; data: number[]; type: string; components: number } | null = null;
    let expectedDataCount = 0;

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
        if (type !== 'unstructured_grid') console.warn(`Unsupported dataset: ${type}`);
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

      if (lowerKeyword === 'cell_types') {
        section = 'CELL_TYPES';
        continue;
      }

      if (lowerKeyword === 'point_data') {
        section = 'POINT_DATA';
        subSection = 'NONE';
        expectedDataCount = parseInt(parts[1]); // usually matches numPoints
        continue;
      }

      if (lowerKeyword === 'cell_data') {
        section = 'CELL_DATA';
        subSection = 'NONE';
        expectedDataCount = parseInt(parts[1]); // usually matches numCells
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
        continue;
      }

      // Data Processing
      if (section === 'POINTS') {
        const vals = parseNumbers(line);
        for (let v of vals) points[pointCount++] = v;
      } 
      else if (section === 'CELLS') {
        const vals = parseNumbers(line);
        for (let v of vals) cellDataRaw.push(v);
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
        
        // Check if finished this scalar
        const targetCount = section === 'POINT_DATA' ? numPoints : numCells;
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

    // --- GEOMETRY GENERATION ---
    const cellIdMap: number[] = []; // Maps each generated triangle to the original cell index

    let cellDataIndex = 0;
    
    for (let i = 0; i < numCells; i++) {
        const type = cellTypes[i];
        const nPts = cellDataRaw[cellDataIndex++]; 
        const cellIndices = [];
        
        for (let j = 0; j < nPts; j++) {
            cellIndices.push(cellDataRaw[cellDataIndex++]);
        }

        const trianglesAdded = triangulateCell(type, cellIndices, indices);

        for(let t=0; t<trianglesAdded; t++) {
            cellIdMap.push(i);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setIndex(indices);
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
