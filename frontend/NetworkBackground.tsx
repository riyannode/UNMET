import { animate } from "animejs";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const sceneUrl = import.meta.env.VITE_NETWORK_SCENE_URL?.trim();

export default function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: window.devicePixelRatio < 2,
        powerPreference: "low-power",
      });
    } catch {
      return;
    }

    const viewHeight = 8.4;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
    camera.position.set(0, 0, 15);
    const field = new THREE.Group();
    const fallback = createNetworkField();
    field.add(fallback);
    scene.add(field);

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));

    let disposed = false;
    let frame = 0;
    let drift: ReturnType<typeof animate> | null = null;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

    const draw = () => renderer.render(scene, camera);
    const renderLoop = () => {
      draw();
      frame = window.requestAnimationFrame(renderLoop);
    };
    const stopLoop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const syncMotion = () => {
      drift?.revert();
      drift = null;
      stopLoop();
      if (motionPreference.matches) {
        draw();
        return;
      }
      drift = animate(field.rotation, {
        x: [-0.006, 0.006],
        y: [-0.026, 0.026],
        duration: 36_000,
        alternate: true,
        loop: true,
        ease: "inOutSine",
      });
      if (!document.hidden) renderLoop();
    };

    const resize = () => {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      const aspect = width / height;
      camera.left = -viewHeight * aspect / 2;
      camera.right = viewHeight * aspect / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      draw();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
        return;
      }
      if (!motionPreference.matches && frame === 0) renderLoop();
      else draw();
    };

    resize();
    syncMotion();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionPreference.addEventListener("change", syncMotion);

    if (sceneUrl) {
      void new GLTFLoader().loadAsync(sceneUrl).then(({ scene: model }) => {
        if (disposed) {
          disposeObject(model);
          return;
        }
        field.remove(fallback);
        disposeObject(fallback);
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const longestSide = Math.max(size.x, size.y, size.z, 1);
        const scale = 6.2 / longestSide;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        const viewWidth = viewHeight * window.innerWidth / Math.max(window.innerHeight, 1);
        model.position.x -= Math.min(viewWidth * 0.18, 2.2);
        model.position.y += viewHeight * 0.16;
        field.add(model);
        draw();
      }).catch(() => {
        // Keep the procedural field when the optional Blender scene is unavailable.
      });
    }

    return () => {
      disposed = true;
      stopLoop();
      drift?.revert();
      motionPreference.removeEventListener("change", syncMotion);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      disposeObject(field);
      renderer.dispose();
    };
  }, []);

  return <div className="network-background" aria-hidden="true"><canvas ref={canvasRef} /></div>;
}

function createNetworkField(): THREE.Group {
  let seed = 0x51a7e;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const nodes: THREE.Vector3[] = [];
  const columns = 8;
  const rows = 7;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      nodes.push(new THREE.Vector3(
        -5.85 + column * 0.76 + (random() - 0.5) * 0.34,
        0.65 + row * 0.43 + (random() - 0.5) * 0.28,
        (random() - 0.5) * 3.2,
      ));
    }
  }

  const links: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (column < columns - 1) addLink(index, index + 1, nodes, links);
      if (row < rows - 1 && random() > 0.18) addLink(index, index + columns, nodes, links);
      if (row < rows - 1 && column < columns - 1 && random() > 0.63) {
        addLink(index, index + columns + 1, nodes, links);
      }
    }
  }

  const group = new THREE.Group();
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(links, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
    color: 0x91b8ee,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    toneMapped: false,
  }));
  group.add(lines);

  const nodeGeometry = new THREE.SphereGeometry(1, 8, 8);
  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: 0xe6f3ff,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
  });
  const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, nodes.length);
  const transform = new THREE.Object3D();
  const nodeColors = [0xdceeff, 0x9fcaff, 0x7caeff].map((color) => new THREE.Color(color));
  nodes.forEach((position, index) => {
    transform.position.copy(position);
    transform.scale.setScalar(index % 11 === 0 ? 0.055 : 0.026 + random() * 0.012);
    transform.updateMatrix();
    nodeMesh.setMatrixAt(index, transform.matrix);
    nodeMesh.setColorAt(index, nodeColors[index % nodeColors.length]);
  });
  group.add(nodeMesh);

  const glowTexture = createGlowTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0x7fb9ff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  nodes.forEach((position, index) => {
    if (index % 10 !== 0) return;
    const sprite = new THREE.Sprite(glowMaterial);
    sprite.position.copy(position);
    sprite.scale.set(0.72, 0.72, 1);
    group.add(sprite);
  });

  const particlePositions: number[] = [];
  for (let index = 0; index < 46; index += 1) {
    particlePositions.push(
      -6.4 + random() * 11.8,
      -2.9 + random() * 6.7,
      -3.6 + random() * 5.2,
    );
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.Float32BufferAttribute(particlePositions, 3));
  group.add(new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    color: 0xb8d5ff,
    size: 0.045,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  })));
  return group;
}

function addLink(from: number, to: number, nodes: THREE.Vector3[], positions: number[]) {
  positions.push(...nodes[from]!.toArray(), ...nodes[to]!.toArray());
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, "rgba(224,240,255,0.8)");
    gradient.addColorStop(0.22, "rgba(124,177,255,0.28)");
    gradient.addColorStop(1, "rgba(82,145,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
