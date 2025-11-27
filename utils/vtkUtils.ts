
/**
 * Shared utilities for VTK Loaders
 */

/**
 * Triangulates a VTK cell based on its type and vertex indices.
 * Pushes the resulting triangle vertex indices into the target `indices` array.
 * 
 * @param type VTK Cell Type ID (e.g., 5 for Triangle, 10 for Tetra)
 * @param cellIndices Array of vertex indices belonging to this cell
 * @param indices Target array to push triangle indices into
 * @returns The number of triangles added
 */
export function triangulateCell(type: number, cellIndices: number[], indices: number[]): number {
    const initialLength = indices.length;

    switch (type) {
        case 5: // VTK_TRIANGLE
            if (cellIndices.length >= 3) {
                indices.push(cellIndices[0], cellIndices[1], cellIndices[2]);
            }
            break;
        case 7: // VTK_POLYGON (Fan triangulation)
            if (cellIndices.length >= 3) {
                for (let k = 1; k < cellIndices.length - 1; k++) {
                    indices.push(cellIndices[0], cellIndices[k], cellIndices[k + 1]);
                }
            }
            break;
        case 9: // VTK_QUAD
            if (cellIndices.length >= 4) {
                indices.push(cellIndices[0], cellIndices[1], cellIndices[2]);
                indices.push(cellIndices[0], cellIndices[2], cellIndices[3]);
            }
            break;
        case 10: // VTK_TETRA
            if (cellIndices.length >= 4) {
                indices.push(cellIndices[0], cellIndices[1], cellIndices[2]);
                indices.push(cellIndices[0], cellIndices[2], cellIndices[3]);
                indices.push(cellIndices[0], cellIndices[3], cellIndices[1]);
                indices.push(cellIndices[1], cellIndices[3], cellIndices[2]);
            }
            break;
        case 12: // VTK_HEXAHEDRON
            if (cellIndices.length >= 8) {
                const hexFaces = [
                    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], 
                    [0, 3, 2, 1], [4, 5, 6, 7]
                ];
                for (const face of hexFaces) {
                    const idx = face.map(id => cellIndices[id]);
                    indices.push(idx[0], idx[1], idx[2]);
                    indices.push(idx[0], idx[2], idx[3]);
                }
            }
            break;
        case 13: // VTK_WEDGE
            if (cellIndices.length >= 6) {
                // Top/Bottom triangles
                indices.push(cellIndices[0], cellIndices[1], cellIndices[2]);
                indices.push(cellIndices[3], cellIndices[5], cellIndices[4]);
                // Side quads
                const wedgeQuads = [[0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]];
                for (const face of wedgeQuads) {
                    const idx = face.map(id => cellIndices[id]);
                    indices.push(idx[0], idx[1], idx[2]);
                    indices.push(idx[0], idx[2], idx[3]);
                }
            }
            break;
        case 14: // VTK_PYRAMID
            if (cellIndices.length >= 5) {
                // Base
                indices.push(cellIndices[0], cellIndices[1], cellIndices[2]);
                indices.push(cellIndices[0], cellIndices[2], cellIndices[3]);
                // Sides
                indices.push(cellIndices[0], cellIndices[1], cellIndices[4]);
                indices.push(cellIndices[1], cellIndices[2], cellIndices[4]);
                indices.push(cellIndices[2], cellIndices[3], cellIndices[4]);
                indices.push(cellIndices[3], cellIndices[0], cellIndices[4]);
            }
            break;
        default:
            // Warn or handle other types if necessary
            break;
    }

    return (indices.length - initialLength) / 3;
}
