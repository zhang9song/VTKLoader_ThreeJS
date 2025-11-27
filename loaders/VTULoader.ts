import * as THREE from 'three';
import { ScalarField, VTKData } from '../types';
import { triangulateCell } from '../utils/vtkUtils';

/**
 * A custom loader for XML-based VTK Unstructured Grid (.vtu) files.
 * Supports ASCII, Inline Binary (Base64), and Appended Data (Raw/Base64).
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
    loader.setResponseType('arraybuffer');
    loader.load(
      url,
      (data) => {
        try {
          const geometry = this.parse(data as ArrayBuffer);
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

  parse(data: ArrayBuffer | string): THREE.BufferGeometry {
    let text = '';
    let buffer: ArrayBuffer | null = null;

    if (typeof data === 'string') {
        text = data;
        // If string provided, we can't handle raw appended data easily unless it was read as text carefully
    } else {
        buffer = data;
        text = new TextDecoder().decode(data);
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    
    const root = xml.querySelector('VTKFile');
    if (!root) throw new Error('Invalid VTU file: Missing VTKFile tag');
    
    // Check header type for offsets (UInt32 vs UInt64)
    // VTK 5.0+ usually uses UInt32 by default, 6.0+ might default to UInt64
    const headerType = root.getAttribute('header_type') || 'UInt32';
    const headerSize = headerType === 'UInt64' ? 8 : 4;

    // --- Handle Appended Data ---
    let appendedDataMap: { buffer: Uint8Array | null, offsetStart: number, encoding: string } = {
        buffer: null,
        offsetStart: 0,
        encoding: 'base64'
    };

    const appendedDataEl = root.querySelector('AppendedData');
    if (appendedDataEl) {
        const encoding = appendedDataEl.getAttribute('encoding') || 'base64';
        appendedDataMap.encoding = encoding;

        if (encoding === 'base64') {
            // Content is inside the tag, usually starting with '_'
            const content = appendedDataEl.textContent?.trim() || '';
            let base64 = content;
            if (base64.startsWith('_')) base64 = base64.substring(1);
            
            // Decode entire appended block
            try {
                const binString = atob(base64.replace(/\s/g, ''));
                const len = binString.length;
                const bytes = new Uint8Array(len);
                for(let i=0; i<len; i++) bytes[i] = binString.charCodeAt(i);
                appendedDataMap.buffer = bytes;
            } catch (e) {
                console.warn('Failed to decode AppendedData base64', e);
            }
        } else if (encoding === 'raw' && buffer) {
            // Raw binary appended data
            // We need to find the '_' marker in the original buffer
            // Since parsing XML consumes text, we use a robust search in the buffer
            
            // We search for the byte sequence of "<AppendedData" then find the first "_"
            // This is a heuristic but works for standard VTK files
            const enc = new TextEncoder(); // UTF-8
            // Note: VTK XML is usually UTF-8 or ASCII
            
            // Strategy: Use the length of the text before the AppendedData content as a hint?
            // No, text decoding might handle multibyte chars differently.
            // Simple approach: decode buffer as latin1 to preserve 1-1 byte mapping for search
            const decoder = new TextDecoder('iso-8859-1');
            const latin1Text = decoder.decode(buffer);
            
            // Find <AppendedData
            const tagIndex = latin1Text.indexOf('<AppendedData');
            if (tagIndex !== -1) {
                const markerIndex = latin1Text.indexOf('_', tagIndex);
                if (markerIndex !== -1) {
                    appendedDataMap.offsetStart = markerIndex + 1;
                    appendedDataMap.buffer = new Uint8Array(buffer); // View of the whole file
                }
            }
        }
    }

    const grid = root.querySelector('UnstructuredGrid');
    if (!grid) throw new Error('Invalid VTU file: Missing UnstructuredGrid tag');
    
    const piece = grid.querySelector('Piece');
    if (!piece) throw new Error('Invalid VTU file: Missing Piece tag');

    const numberOfPoints = parseInt(piece.getAttribute('NumberOfPoints') || '0');
    const numberOfCells = parseInt(piece.getAttribute('NumberOfCells') || '0');

    // --- Parse Points ---
    const pointsElement = piece.querySelector('Points > DataArray');
    if (!pointsElement) throw new Error('Missing Points DataArray');
    const pointsArray = this.parseDataArray(pointsElement, appendedDataMap, headerSize);
    
    if (!pointsArray) {
        throw new Error('Failed to parse Points data (empty or invalid)');
    }

    // --- Parse Cells ---
    const cellsElement = piece.querySelector('Cells');
    if (!cellsElement) throw new Error('Missing Cells');
    
    const connectivityEl = cellsElement.querySelector('DataArray[Name="connectivity"]');
    const offsetsEl = cellsElement.querySelector('DataArray[Name="offsets"]');
    const typesEl = cellsElement.querySelector('DataArray[Name="types"]');

    if (!connectivityEl || !offsetsEl || !typesEl) throw new Error('Incomplete Cell data (connectivity, offsets, or types missing)');

    const connectivity = this.parseDataArray(connectivityEl, appendedDataMap, headerSize);
    const offsets = this.parseDataArray(offsetsEl, appendedDataMap, headerSize);
    const types = this.parseDataArray(typesEl, appendedDataMap, headerSize);

    // --- Generate Geometry Indices ---
    const indices: number[] = [];
    const cellIdMap: number[] = [];

    let currentOffset = 0;
    
    if (connectivity && offsets && types) {
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
                const arr = this.parseDataArray(da, appendedDataMap, headerSize);
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
                const arr = this.parseDataArray(da, appendedDataMap, headerSize);
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

  private parseDataArray(
      element: Element, 
      appendedMap: { buffer: Uint8Array | null, offsetStart: number, encoding: string },
      headerSize: number
  ): Float32Array | Int32Array | Uint8Array | null {
    const format = element.getAttribute('format');
    const type = element.getAttribute('type');
    
    if (format === 'appended') {
        const offsetAttr = element.getAttribute('offset');
        if (!offsetAttr || !appendedMap.buffer) return null;
        
        let offset = parseInt(offsetAttr);
        if (isNaN(offset)) return null;
        
        // Handle Appended Data
        // If raw, offset is from the underscore position
        // If base64 (decoded), offset is index in the decoded buffer
        
        // Check for header to determine size
        // Usually [size (header_type)] [data...]
        
        const buffer = appendedMap.buffer;
        let start = 0;
        
        if (appendedMap.encoding === 'raw') {
            start = appendedMap.offsetStart + offset;
        } else {
            // Base64 decoded buffer starts at 0 relative to offset
            start = offset;
        }

        if (start >= buffer.length) return null;
        
        // Read size header
        // We need a DataView to read headerSize bytes
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        
        // Note: VTK binary is Little Endian for XML formats usually, unless ByteOrder="BigEndian" specified in VTKFile
        // Default is LittleEndian.
        
        // Safety check for bounds
        if (start + headerSize > buffer.byteLength) return null;
        
        let byteSize = 0;
        if (headerSize === 8) {
             // Read 64-bit int (BigInt) but JS array buffers need number. 
             // Provided size usually fits in number.
             // Get lower 32 bits if little endian
             const low = view.getUint32(start, true); 
             const high = view.getUint32(start + 4, true);
             // Assume size fits in JS number (2^53)
             byteSize = low + (high * 0x100000000);
        } else {
             byteSize = view.getUint32(start, true);
        }

        // Create Typed Array from data following header
        const dataStart = start + headerSize;
        if (dataStart + byteSize > buffer.byteLength) {
             console.warn('Appended data segment out of bounds');
             return null;
        }
        
        const segment = buffer.buffer.slice(buffer.byteOffset + dataStart, buffer.byteOffset + dataStart + byteSize);
        return this.createTypedArray(type, segment);

    } else if (format === 'binary') {
        const text = element.textContent?.trim() || '';
        try {
            const binaryString = atob(text);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Header is always present in binary blocks too
            if (bytes.byteLength <= headerSize) return null;
            
            // Slice off the header. 
            // NOTE: The header tells us the size, but we already have the bytes from base64.
            // We can just verify or ignore.
            
            return this.createTypedArray(type, bytes.buffer.slice(headerSize)); 
        } catch (e) {
            console.warn('Failed to parse binary data', e);
            return null;
        }
    } else {
        // ASCII
        const text = element.textContent?.trim() || '';
        if (!text) return null;
        const strValues = text.split(/\s+/);
        
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
            typedArray = new Float32Array(strValues.length);
            for(let i=0; i<strValues.length; i++) typedArray[i] = parseFloat(strValues[i]);
        }
        return typedArray;
    }
  }

  private createTypedArray(type: string | null, buffer: ArrayBuffer) {
      try {
          switch(type) {
              case 'Float32': return new Float32Array(buffer);
              case 'Float64': return new Float32Array(new Float64Array(buffer)); 
              case 'Int32': return new Int32Array(buffer);
              case 'Int64': 
                   // Fix: Convert Int64 to Int32 if possible, or Float32. WebGL doesn't support Int64 attributes directly usually.
                   // For indices, Int32 is enough.
                   const bigInts = new BigInt64Array(buffer);
                   const int32s = new Int32Array(bigInts.length);
                   for(let i=0; i<bigInts.length; i++) {
                       int32s[i] = Number(bigInts[i]);
                   }
                   return int32s;
              case 'UInt8': return new Uint8Array(buffer);
              case 'UInt32': return new Int32Array(new Uint32Array(buffer)); // Cast to Signed Int32 for consistency
              default: return new Float32Array(buffer);
          }
      } catch (e) {
          console.warn(`Failed to create typed array for type ${type}`, e);
          return new Float32Array(buffer.byteLength / 4);
      }
  }
}