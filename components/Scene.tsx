import React, { useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Center, OrbitControls } from '@react-three/drei';
import { ViewerSettings } from '../types';

interface SceneProps {
  geometry: THREE.BufferGeometry | null;
  settings: ViewerSettings;
}

const Scene: React.FC<SceneProps> = ({ geometry, settings }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Detect if geometry has color attribute
  const hasVertexColors = !!geometry?.attributes.color;

  if (!geometry) return null;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <directionalLight position={[-10, -10, -5]} intensity={0.5} />
      
      <OrbitControls makeDefault />

      <Center top>
        <group>
            {/* Main Solid Mesh */}
            <mesh ref={meshRef} geometry={geometry}>
            <meshStandardMaterial 
                color={hasVertexColors ? '#ffffff' : settings.color} 
                vertexColors={hasVertexColors}
                opacity={settings.opacity} 
                transparent={settings.opacity < 1}
                side={THREE.DoubleSide}
                flatShading={settings.flatShading}
                roughness={0.7}
                metalness={0.1}
            />
            </mesh>

            {/* Wireframe Overlay */}
            {settings.showWireframe && (
            <mesh geometry={geometry}>
                <meshStandardMaterial
                    color={settings.wireframeColor}
                    wireframe={true}
                    transparent={true}
                    opacity={0.3}
                    side={THREE.DoubleSide}
                />
            </mesh>
            )}
        </group>
      </Center>

      <gridHelper args={[100, 100, 0x444444, 0x222222]} position={[0, -5, 0]} />
    </>
  );
};

export default Scene;