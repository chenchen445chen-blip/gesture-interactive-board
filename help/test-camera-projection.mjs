import * as THREE from 'three';

const width = 1920;
const height = 1080;

const camera = new THREE.OrthographicCamera(0, width, 0, height, -1200, 1200);
camera.position.set(0, 0, 500);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();

// 测试一个点 (960, 540, 0) 的投影坐标
const p = new THREE.Vector3(960, 540, 0);
p.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);

console.log('Projected NDC coordinates for (960, 540, 0):', p);
console.log('Camera projectionMatrix determinant:', camera.projectionMatrix.determinant());
console.log('Camera world matrix determinant:', camera.matrixWorld.determinant());
