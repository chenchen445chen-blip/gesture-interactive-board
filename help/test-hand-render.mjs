global.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 2 };

import * as THREE from 'three';
import { Hand3DScene } from '../src/hand3d/hand-scene.js';

// 绕过 WebGLRenderer 创建纯逻辑场景测试
class TestHandScene extends Hand3DScene {
  constructor() {
    super({ style: {}, getContext: () => null });
  }
  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, this.width, 0, this.height, -1200, 1200);
    this.camera.position.set(0, 0, 500);
    this.camera.lookAt(0, 0, 0);
    this.renderer = {
      clear: () => {},
      clearColor: () => {},
      render: () => {},
    };
    this._setupLighting();
    this._initMaterials();
    this.hands.Right = this._createHandContainer('Right');
    this.hands.Left = this._createHandContainer('Left');
    this.scene.add(this.hands.Right.group);
    this.scene.add(this.hands.Left.group);
  }
}

const mockLandmarks = [];
for (let i = 0; i < 21; i++) {
  mockLandmarks.push({
    x: 0.5 + (i % 5) * 0.02 - 0.05,
    y: 0.5 + Math.floor(i / 5) * 0.04 - 0.1,
    z: -0.02 * (i % 4),
  });
}

const hands = [{
  rawLandmarks: mockLandmarks,
  handedness: 'Right',
  classification: {
    isOpenPalm: false,
    isPinching: true,
    facing: 'PALM',
    gesture: 'PINCH',
  },
  eraserRadius: 50,
}];

const scene = new TestHandScene();
scene.update(hands, true);

const rightHand = scene.hands.Right;
console.log('Right hand group visible:', rightHand.group.visible);
console.log('PalmMesh visible:', rightHand.palmMesh.visible);
console.log('PalmMesh position:', rightHand.palmMesh.position);
console.log('WristMesh position:', rightHand.wristMesh.position);
console.log('WristMesh scale:', rightHand.wristMesh.scale);
console.log('Finger 0 knuckles count:', rightHand.fingers[0].knuckles.length);
console.log('Finger 0 knuckle 0 pos:', rightHand.fingers[0].knuckles[0].mesh.position);
console.log('Finger 0 knuckle 0 scale:', rightHand.fingers[0].knuckles[0].mesh.scale);
console.log('Finger 0 segments count:', rightHand.fingers[0].segments.length);
console.log('Finger 0 segment 0 pos:', rightHand.fingers[0].segments[0].mesh.position);
console.log('Finger 0 segment 0 scale:', rightHand.fingers[0].segments[0].mesh.scale);
