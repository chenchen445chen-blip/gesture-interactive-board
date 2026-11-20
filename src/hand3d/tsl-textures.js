import * as THREE from 'three';

/**
 * 05. TSL Textures — 柔和有机真皮皮肤纹理引擎 (Soft Organic Subsurface Skin Texture Engine)
 *
 * 针对用户反馈优化：
 *  1. 彻底去除原先突兀生硬的深褐色粗掌纹线与大圈同心靶环
 *  2. 掌纹与指节折痕采用多层高斯羽化 (Gaussian Feathering) + 极低对比度暖肤色微阴影 (Subtle Warm Crease)，
 *     与周边肤色无缝平滑融合，远看白净自然、近看有真实微肌理
 *  3. 凹凸深度 (bumpScale) 控制在柔和细腻的微表皮量级，呈现细腻真实的生物皮肤质感
 */
export class ProceduralHandTextures {
  static createSkinTextures() {
    const size = 1024;

    // 1. 颜色与微血管贴图 (Albedo + Subsurface Soft Variation)
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const cCtx = colorCanvas.getContext('2d');

    // 2. 柔和微表皮凹凸贴图 (Soft Micro-Relief Bump Map)
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d');

    // 3. 粗糙度贴图 (Roughness Map)
    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d');

    // ═══════════════════════════════════════════════════════
    //  Step A: 柔和温润的基础肤色与极柔和的指腹/鱼际血色渐变
    // ═══════════════════════════════════════════════════════
    const baseGrad = cCtx.createRadialGradient(
      size * 0.68,
      size * 0.38,
      size * 0.05,
      size * 0.5,
      size * 0.5,
      size * 0.65
    );
    baseGrad.addColorStop(0, '#f5c7a9');
    baseGrad.addColorStop(0.55, '#efb997');
    baseGrad.addColorStop(1, '#e8ae8b');
    cCtx.fillStyle = baseGrad;
    cCtx.fillRect(0, 0, size, size);

    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    rCtx.fillStyle = '#7a7a7a';
    rCtx.fillRect(0, 0, size, size);

    // 极柔和的真皮微血管透红晕染（大半径羽化，无边界感）
    const blushZones = [
      { u: 0.878, v: 0.384, r: 0.065, alpha: 0.12 }, // 拇指腹
      { u: 0.824, v: 0.094, r: 0.058, alpha: 0.12 }, // 食指腹
      { u: 0.700, v: 0.091, r: 0.058, alpha: 0.12 }, // 中指腹
      { u: 0.501, v: 0.265, r: 0.055, alpha: 0.12 }, // 无名指腹
      { u: 0.419, v: 0.426, r: 0.055, alpha: 0.12 }, // 小指腹
      { u: 0.773, v: 0.463, r: 0.125, alpha: 0.09 }, // 大鱼际
      { u: 0.645, v: 0.430, r: 0.115, alpha: 0.09 }, // 小鱼际
      { u: 0.713, v: 0.345, r: 0.110, alpha: 0.08 }, // 指根掌垫
    ];

    blushZones.forEach((z) => {
      const gx = z.u * size;
      const gy = z.v * size;
      const gr = z.r * size;
      const g = cCtx.createRadialGradient(gx, gy, 2, gx, gy, gr);
      g.addColorStop(0, `rgba(225, 118, 98, ${z.alpha})`);
      g.addColorStop(0.5, `rgba(225, 118, 98, ${z.alpha * 0.45})`);
      g.addColorStop(1, 'rgba(225, 118, 98, 0)');
      cCtx.fillStyle = g;
      cCtx.beginPath();
      cCtx.arc(gx, gy, gr, 0, Math.PI * 2);
      cCtx.fill();
    });

    // 细腻微毛孔与表皮漫反射微粒（低对比度，仅在放大近看时呈现皮肤质感）
    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 1.5 + 0.5;
      cCtx.fillStyle =
        i % 3 === 0
          ? 'rgba(215, 118, 95, 0.018)'
          : i % 3 === 1
            ? 'rgba(255, 236, 218, 0.018)'
            : 'rgba(180, 115, 85, 0.015)';
      cCtx.fillRect(x, y, r, r);

      bCtx.fillStyle = i % 2 === 0 ? 'rgba(105, 105, 105, 0.12)' : 'rgba(150, 150, 150, 0.10)';
      bCtx.fillRect(x, y, 1.2, 1.2);
    }

    // ═══════════════════════════════════════════════════════
    //  Step B: 羽化渐隐的柔和掌纹与指节微折痕 (Feathered Soft Creases)
    // ═══════════════════════════════════════════════════════
    /**
     * 绘制首尾两端自然渐隐、边缘带有高斯柔化过渡的皮肤折痕
     * 颜色仅比周围基底肤色微深一点点（暖肉粉色过渡，绝不发黑发焦）
     */
    const drawSoftFeatheredCrease = (pts, width = 2.0, strength = 0.22) => {
      // 1. 颜色贴图：使用 canvas shadowBlur 实现平滑羽化晕染过渡，两端平滑渐细
      cCtx.save();
      cCtx.lineCap = 'round';
      cCtx.lineJoin = 'round';

      // 外层极柔和暖粉褐羽化晕圈
      cCtx.shadowColor = `rgba(195, 118, 92, ${strength * 0.55})`;
      cCtx.shadowBlur = width * 3.5;
      cCtx.strokeStyle = `rgba(195, 118, 92, ${strength * 0.35})`;
      cCtx.lineWidth = width * 1.4;
      this._strokeTaperedCurve(cCtx, pts, size, width * 1.3);

      // 内层细微折痕中心（比周边肤色略暖微深，平滑融入）
      cCtx.shadowBlur = width * 1.2;
      cCtx.strokeStyle = `rgba(178, 102, 78, ${strength * 0.45})`;
      this._strokeTaperedCurve(cCtx, pts, size, width * 0.65);
      cCtx.restore();

      // 2. 凹凸贴图：柔和的浅凹微沟
      bCtx.save();
      bCtx.lineCap = 'round';
      bCtx.lineJoin = 'round';
      bCtx.shadowColor = `rgba(75, 75, 75, ${strength * 0.8})`;
      bCtx.shadowBlur = width * 2.0;
      bCtx.strokeStyle = `rgba(82, 82, 82, ${strength * 0.85})`;
      this._strokeTaperedCurve(bCtx, pts, size, width * 0.85);
      bCtx.restore();
    };

    // 掌心三大主掌纹（严格对齐手心真实 3D 顶点对应的 UV 坐标，首尾渐隐，弧度自然柔美）
    // 1. 生命线 (Life Line)：从虎口 (0.785, 0.372) 沿大鱼际内缘柔和弯向手腕上方 (0.735, 0.515)
    drawSoftFeatheredCrease(
      [
        [0.785, 0.372],
        [0.762, 0.405],
        [0.748, 0.445],
        [0.742, 0.482],
        [0.736, 0.515],
      ],
      2.1,
      0.24
    );

    // 2. 智慧线 (Head Line)：从虎口 (0.780, 0.368) 柔和斜向掌心中央至小鱼际 (0.655, 0.432)
    drawSoftFeatheredCrease(
      [
        [0.780, 0.368],
        [0.745, 0.388],
        [0.712, 0.408],
        [0.682, 0.422],
        [0.655, 0.432],
      ],
      1.9,
      0.22
    );

    // 3. 感情线 (Heart Line)：从小指根下方 (0.618, 0.398) 经过无名指、中指延伸向食指中指指缝下方 (0.735, 0.352)
    drawSoftFeatheredCrease(
      [
        [0.618, 0.398],
        [0.648, 0.382],
        [0.682, 0.368],
        [0.712, 0.358],
        [0.738, 0.352],
      ],
      1.9,
      0.22
    );

    // 4. 掌心中央微弱事业线 (Fate Line)
    drawSoftFeatheredCrease(
      [
        [0.718, 0.495],
        [0.715, 0.445],
        [0.712, 0.402],
        [0.708, 0.368],
      ],
      1.4,
      0.14
    );

    // ═══════════════════════════════════════════════════════
    //  Step C: 五指手心侧柔和指节横纹 (Soft Palmar Joint Folds)
    // ═══════════════════════════════════════════════════════
    const palmarJointCreases = [
      // 拇指指节微横纹
      { u: 0.782, v: 0.412, dx: 0.009, dy: 0.022 },
      { u: 0.842, v: 0.394, dx: 0.008, dy: 0.020 },
      // 食指三道指节微横纹
      { u: 0.774, v: 0.305, dx: 0.022, dy: 0.005 },
      { u: 0.790, v: 0.202, dx: 0.020, dy: 0.006 },
      { u: 0.815, v: 0.124, dx: 0.018, dy: 0.005 },
      // 中指三道指节微横纹
      { u: 0.708, v: 0.302, dx: 0.022, dy: 0.002 },
      { u: 0.699, v: 0.178, dx: 0.021, dy: 0.002 },
      { u: 0.700, v: 0.106, dx: 0.018, dy: 0.002 },
      // 无名指三道指节微横纹
      { u: 0.642, v: 0.336, dx: 0.016, dy: -0.015 },
      { u: 0.568, v: 0.306, dx: 0.012, dy: 0.018 },
      { u: 0.514, v: 0.292, dx: 0.015, dy: -0.012 },
      // 小指三道指节微横纹
      { u: 0.588, v: 0.365, dx: 0.016, dy: 0.012 },
      { u: 0.528, v: 0.348, dx: 0.011, dy: 0.018 },
      { u: 0.451, v: 0.394, dx: 0.014, dy: 0.014 },
    ];

    palmarJointCreases.forEach((jc) => {
      const p1 = [jc.u - jc.dx, jc.v - jc.dy];
      const pMid = [jc.u, jc.v + (jc.dy >= 0 ? 0.002 : -0.002)];
      const p2 = [jc.u + jc.dx, jc.v + jc.dy];
      drawSoftFeatheredCrease([p1, pMid, p2], 1.5, 0.18);
    });

    // ═══════════════════════════════════════════════════════
    //  Step D: 五指指腹超细腻微指纹 (Micro-Fine Fingerprints)
    // ═══════════════════════════════════════════════════════
    // 仅在五指末节指腹生成极细密、边缘柔和消隐的微指纹，只影响微高光凹凸，不污染肤色
    const fingerprintPads = [
      { u: 0.878, v: 0.384, rx: 0.028, ry: 0.022, angle: -0.25 },
      { u: 0.824, v: 0.094, rx: 0.024, ry: 0.028, angle: 0.22 },
      { u: 0.700, v: 0.091, rx: 0.024, ry: 0.028, angle: 0.0 },
      { u: 0.501, v: 0.265, rx: 0.024, ry: 0.026, angle: -0.45 },
      { u: 0.419, v: 0.426, rx: 0.022, ry: 0.025, angle: -0.75 },
    ];

    fingerprintPads.forEach((fp) => {
      const cx = fp.u * size;
      const cy = fp.v * size;
      const maxRx = fp.rx * size;
      const maxRy = fp.ry * size;
      const ringSpacing = 2.0; // 超细密微纹间距
      const numRings = Math.floor(Math.max(maxRx, maxRy) / ringSpacing);

      bCtx.save();
      bCtx.translate(cx, cy);
      bCtx.rotate(fp.angle);

      for (let r = 1; r <= numRings; r++) {
        const t = r / numRings;
        // 余弦平滑衰减包络：中心与外缘均柔和消隐为 0
        const falloff = Math.cos(t * Math.PI * 0.5);
        const alpha = falloff * falloff * 0.18;
        const rx = r * ringSpacing * (maxRx / Math.max(maxRx, maxRy));
        const ry = r * ringSpacing * (maxRy / Math.max(maxRx, maxRy));

        bCtx.strokeStyle = `rgba(92, 92, 92, ${alpha})`;
        bCtx.lineWidth = 0.85;
        bCtx.beginPath();
        bCtx.ellipse(0, t * 2.0, rx, ry, 0, -Math.PI * 0.82, Math.PI * 0.82);
        bCtx.stroke();
      }

      bCtx.restore();
    });

    // ═══════════════════════════════════════════════════════
    //  Step E: 手背侧柔和指关节微褶皱 (Soft Dorsal Knuckle Folds)
    // ═══════════════════════════════════════════════════════
    const dorsalKnuckles = [
      { u: 0.643, v: 0.374, rx: 0.016, ry: 0.024, angle: -0.25 },
      { u: 0.693, v: 0.359, rx: 0.014, ry: 0.020, angle: -0.25 },
      { u: 0.415, v: 0.522, rx: 0.018, ry: 0.024, angle: -0.1 },
      { u: 0.512, v: 0.492, rx: 0.015, ry: 0.022, angle: -0.35 },
      { u: 0.558, v: 0.460, rx: 0.012, ry: 0.018, angle: -0.35 },
      { u: 0.365, v: 0.665, rx: 0.018, ry: 0.024, angle: 0.25 },
      { u: 0.485, v: 0.705, rx: 0.015, ry: 0.022, angle: 0.22 },
      { u: 0.562, v: 0.724, rx: 0.012, ry: 0.018, angle: 0.22 },
      { u: 0.345, v: 0.698, rx: 0.016, ry: 0.022, angle: 0.2 },
      { u: 0.445, v: 0.732, rx: 0.015, ry: 0.020, angle: 0.35 },
      { u: 0.482, v: 0.750, rx: 0.012, ry: 0.016, angle: 0.25 },
      { u: 0.275, v: 0.755, rx: 0.015, ry: 0.022, angle: 0.1 },
      { u: 0.343, v: 0.768, rx: 0.014, ry: 0.018, angle: 0.85 },
      { u: 0.340, v: 0.818, rx: 0.012, ry: 0.015, angle: 1.1 },
    ];

    dorsalKnuckles.forEach((dk) => {
      const cx = dk.u * size;
      const cy = dk.v * size;
      const rx = dk.rx * size;
      const ry = dk.ry * size;

      bCtx.save();
      bCtx.translate(cx, cy);
      bCtx.rotate(dk.angle);

      cCtx.save();
      cCtx.translate(cx, cy);
      cCtx.rotate(dk.angle);
      cCtx.shadowColor = 'rgba(188, 112, 88, 0.12)';
      cCtx.shadowBlur = 4;

      for (let k = -1; k <= 1; k++) {
        const offsetX = k * (rx * 0.34);
        const foldScaleY = 1 - Math.abs(k) * 0.22;
        const curRy = ry * foldScaleY;
        const curRx = rx * 0.22;

        bCtx.strokeStyle = 'rgba(95, 95, 95, 0.22)';
        bCtx.lineWidth = 1.2;
        bCtx.beginPath();
        bCtx.ellipse(offsetX, 0, curRx, curRy, 0, -Math.PI * 0.4, Math.PI * 0.4);
        bCtx.stroke();

        cCtx.strokeStyle = 'rgba(188, 112, 88, 0.11)';
        cCtx.lineWidth = 1.2;
        cCtx.beginPath();
        cCtx.ellipse(offsetX, 0, curRx, curRy, 0, -Math.PI * 0.4, Math.PI * 0.4);
        cCtx.stroke();
      }

      bCtx.restore();
      cCtx.restore();
    });

    // ═══════════════════════════════════════════════════════
    //  Step F: 封装为 1:1 精确 UV 贴图 (flipY = false 以匹配 GLTF UV 标准)
    // ═══════════════════════════════════════════════════════
    const map = new THREE.CanvasTexture(colorCanvas);
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.flipY = false;
    bumpMap.anisotropy = 8;
    bumpMap.needsUpdate = true;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.flipY = false;
    roughnessMap.anisotropy = 8;
    roughnessMap.needsUpdate = true;

    return { map, bumpMap, roughnessMap };
  }

  /**
   * 绘制首尾两端粗细与透明度自然渐隐的平滑曲线，避免线段端点生硬截断
   */
  static _strokeTaperedCurve(ctx, pts, size, maxLineWidth) {
    if (!pts || pts.length < 2) return;
    // 将控制点细分为 24 小段，使线宽从首端 0 -> 中段 maxLineWidth -> 末端 0 平滑包络过渡
    const samples = 24;
    const expanded = [];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const segPos = t * (pts.length - 1);
      const idx = Math.min(pts.length - 2, Math.floor(segPos));
      const frac = segPos - idx;
      const u = pts[idx][0] * (1 - frac) + pts[idx + 1][0] * frac;
      const v = pts[idx][1] * (1 - frac) + pts[idx + 1][1] * frac;
      expanded.push([u * size, v * size]);
    }

    for (let s = 0; s < samples; s++) {
      const t = (s + 0.5) / samples;
      const taper = Math.sin(t * Math.PI); // 0 -> 1 -> 0 正弦圆滑包络
      ctx.lineWidth = Math.max(0.3, maxLineWidth * taper);
      ctx.beginPath();
      ctx.moveTo(expanded[s][0], expanded[s][1]);
      ctx.lineTo(expanded[s + 1][0], expanded[s + 1][1]);
      ctx.stroke();
    }
  }

  static createCyberTextures() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.5;
    const r = 20;
    const h = r * Math.sqrt(3);
    for (let row = 0; row < size / h + 2; row++) {
      for (let col = 0; col < size / (r * 1.5) + 2; col++) {
        const cx = col * r * 1.5;
        const cy = row * h + (col % 2 === 1 ? h / 2 : 0);
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const ang = (s * Math.PI) / 3;
          const px = cx + (r - 2) * Math.cos(ang);
          const py = cy + (r - 2) * Math.sin(ang);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }
}
