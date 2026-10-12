const fs = require('fs');
const path = require('path');

// 简单读取 GLB 头部和 JSON chunk 探查 node/bone 层次
const glbPath = path.resolve(__dirname, '../public/models/right.glb');
if (!fs.existsSync(glbPath)) {
  console.error('File not found:', glbPath);
  process.exit(1);
}

const buffer = fs.readFileSync(glbPath);
// GLB header: magic(4), version(4), length(4)
// Chunk 0: length(4), type(4 = 0x4E4F534A 'JSON')
const chunk0Length = buffer.readUInt32LE(12);
const jsonBuf = buffer.slice(20, 20 + chunk0Length);
const gltf = JSON.parse(jsonBuf.toString('utf-8'));

console.log('Nodes count:', gltf.nodes?.length);
console.log('Nodes names:', gltf.nodes?.map(n => n.name).filter(Boolean));
console.log('Skins:', JSON.stringify(gltf.skins, null, 2));
console.log('Meshes:', gltf.meshes?.map(m => m.name));
