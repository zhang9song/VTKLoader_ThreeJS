
import * as THREE from 'three';
import { ScalarField, VTKData } from '../types';
import { triangulateCell } from '../utils/vtkUtils';

/**
 * A custom loader for XML-based VTK Unstructured Grid (.vtu) files.
 * Supports ASCII and uncompressed binary (base64) inline formats.
 */
export class VTULoader extends THREE.Loader {
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
          else console.error(e);
        }
      },
      onProgress,
      onError
    );
  }

  parse(data: string): THREE.BufferGeometry {
    const parser = new DOMParser();
    const xml = parser.parseFromString(data, 'text/xml');
    
    const root = xml.querySelector('VTKFile');
    if (!root) throw new Error('Invalid VTU file: Missing VTKFile tag');
    
    const grid = root.querySelector('UnstructuredGrid');
    if (!grid) throw new Error('Invalid VTU file: Missing UnstructuredGrid tag');
    
    // We assume one piece for simplicity, or we merge pieces.
    // For now, take the first piece.
    const piece = grid.querySelector('Piece');
    if (!piece) throw new Error('Invalid VTU file: Missing Piece tag');

    const numberOfPoints = parseInt(piece.getAttribute('NumberOfPoints') || '0');
    const numberOfCells = parseInt(piece.getAttribute('NumberOfCells') || '0');

    // --- Parse Points ---
    const pointsElement = piece.querySelector('Points > DataArray');
    if (!pointsElement) throw new Error('Missing Points DataArray');
    const pointsArray = this.parseDataArray(pointsElement);
    
    if (!pointsArray) {
        throw new Error('Failed to parse Points data (empty or invalid)');
    }
    
    if (pointsArray.length / 3 !== numberOfPoints) {
       console.warn(`Mismatch in points data: expected ${numberOfPoints}, got ${pointsArray.length / 3}`);
    }

    // --- Parse Cells ---
    const cellsElement = piece.querySelector('Cells');
    if (!cellsElement) throw new Error('Missing Cells');
    
    const connectivityEl = cellsElement.querySelector('DataArray[Name="connectivity"]');
    const offsetsEl = cellsElement.querySelector('DataArray[Name="offsets"]');
    const typesEl = cellsElement.querySelector('DataArray[Name="types"]');

    if (!connectivityEl || !offsetsEl || !typesEl) throw new Error('Incomplete Cell data (connectivity, offsets, or types missing)');

    const connectivity = this.parseDataArray(connectivityEl);
    const offsets = this.parseDataArray(offsetsEl);
    const types = this.parseDataArray(typesEl);

    // --- Generate Geometry Indices ---
    const indices: number[] = [];
    const cellIdMap: number[] = [];

    let currentOffset = 0;
    
    if (connectivity && offsets && types) {
        // Safe check for loop limit based on available data
        const safeNumCells = Math.min(numberOfCells, offsets.length, types.length);

        for (let i = 0; i < safeNumCells; i++) {
            const nextOffset = offsets[i];
            const type = types[i];
            
            const cellIndices = [];
            // Slice the connectivity array for this cell
            for (let k = currentOffset; k < nextOffset; k++) {
                if (k < connectivity.length) {
                    cellIndices.push(connectivity[k]);
                }
            }
            currentOffset = nextOffset;

            const trianglesAdded = triangulateCell(type, cellIndices, indices);

            for (let t = 0; t < trianglesAdded; t++) {
                cellIdMap.push(i);
            }
        }
    }

    // --- Parse Point Data ---
    const pointDataFields: ScalarField[] = [];
    const pointDataEl = piece.querySelector('PointData');
    if (pointDataEl) {
        const dataArrays = pointDataEl.querySelectorAll('DataArray');
        dataArrays.forEach(da => {
            const name = da.getAttribute('Name') || 'Unknown';
            const comps = parseInt(da.getAttribute('NumberOfComponents') || '1');
            if (comps === 1) {
                const arr = this.parseDataArray(da);
                if (arr) {
                    const data = Array.from(arr); 
                    let min = Infinity, max = -Infinity;
                    for (const v of data) {
                        if (v < min) min = v;
                        if (v > max) max = v;
                    }
                    if (data.length > 0) {
                        pointDataFields.push({ name, min, max, data });
                    }
                }
            }
        });
    }

    // --- Parse Cell Data ---
    const cellDataFields: ScalarField[] = [];
    const cellDataEl = piece.querySelector('CellData');
    if (cellDataEl) {
        const dataArrays = cellDataEl.querySelectorAll('DataArray');
        dataArrays.forEach(da => {
            const name = da.getAttribute('Name') || 'Unknown';
            const comps = parseInt(da.getAttribute('NumberOfComponents') || '1');
            if (comps === 1) {
                const arr = this.parseDataArray(da);
                if (arr) {
                    const data = Array.from(arr);
                    let min = Infinity, max = -Infinity;
                    for (const v of data) {
                        if (v < min) min = v;
                        if (v > max) max = v;
                    }
                    if (data.length > 0) {
                        cellDataFields.push({ name, min, max, data });
                    }
                }
            }
        });
    }

    // --- Build Geometry ---
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pointsArray, 3));
    
    if (indices.length > 0) {
        geometry.setIndex(indices);
    }
    
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const vtkData: VTKData = {
        pointData: pointDataFields,
        cellData: cellDataFields,
        cellIdMap: cellIdMap
    };
    geometry.userData = vtkData;

    return geometry;
  }

  private parseDataArray(element: Element): Float32Array | Int32Array | Uint8Array | null {
    const format = element.getAttribute('format');
    const type = element.getAttribute('type');
    const text = element.textContent?.trim() || '';

    if (!text) return null;

    if (format === 'binary') {
        try {
            // Check if there is base64 content
            const binaryString = atob(text);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Standard VTU binary has a header (UInt32) indicating data size in bytes.
            // We'll skip the first 4 bytes.
            const headerSize = 4;
            if (bytes.byteLength <= headerSize) {
                console.warn('Binary block too short');
                return null;
            }
            
            return this.createTypedArray(type, bytes.buffer, headerSize); 
            
        } catch (e) {
            console.warn('Failed to parse binary data', e);
            return null;
        }
    } else {
        // ASCII
        const strValues = text.split(/\s+/);
        
        // Map to typed array
        let typedArray: Float32Array | Int32Array | Uint8Array;
        
        if (type === 'Float32' || type === 'Float64') {
            typedArray = new Float32Array(strValues.length);
            for(let i=0; i<strValues.length; i++) typedArray[i] = parseFloat(strValues[i]);
        } else if (type === 'Int32' || type === 'Int64') {
            typedArray = new Int32Array(strValues.length);
            for(let i=0; i<strValues.length; i++) typedArray[i] = parseInt(strValues[i]);
        } else if (type === 'UInt8') {
            typedArray = new Uint8Array(strValues.length);
            for(let i=0; i<strValues.length; i++) typedArray[i] = parseInt(strValues[i]);
        } else {
            // Default to Float32
            typedArray = new Float32Array(strValues.length);
            for(let i=0; i<strValues.length; i++) typedArray[i] = parseFloat(strValues[i]);
        }
        
        return typedArray;
    }
  }

  private createTypedArray(type: string | null, buffer: ArrayBuffer, offset: number) {
      const slice = buffer.slice(offset);
      // Ensure strict alignment isn't an issue by copying if needed, 
      // but typed array constructors handle ArrayBuffer+Offset+Length well usually, 
      // except Float64 requires 8-byte alignment.
      // .slice() returns a new ArrayBuffer which is aligned.
      
      try {
          switch(type) {
              case 'Float32': return new Float32Array(slice);
              case 'Float64': return new Float32Array(new Float64Array(slice)); // Convert to f32 for webgl
              case 'Int32': return new Int32Array(slice);
              case 'UInt8': return new Uint8Array(slice);
              default: return new Float32Array(slice);
          }
      } catch (e) {
          console.warn(`Failed to create typed array for type ${type}`, e);
          return new Float32Array(slice.byteLength / 4); // Fallback
      }
  }
}
