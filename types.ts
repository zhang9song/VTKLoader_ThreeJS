import * as THREE from 'three';

export interface ViewerSettings {
  showWireframe: boolean;
  color: string;
  wireframeColor: string;
  opacity: number;
  flatShading: boolean;
}

export interface ScalarField {
  name: string;
  min: number;
  max: number;
  data: number[];
}

export interface VTKData {
  pointData: ScalarField[];
  cellData: ScalarField[];
  cellIdMap: number[]; // Maps triangle index -> cell index
}

export interface ParseResult {
  geometry: THREE.BufferGeometry;
  stats: {
    points: number;
    cells: number;
  };
}