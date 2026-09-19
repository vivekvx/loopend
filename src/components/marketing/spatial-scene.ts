import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export async function mountScene(host: HTMLDivElement): Promise<() => void> {
  gsap.registerPlugin(ScrollTrigger);
  const canvas = document.createElement('canvas');
  canvas.className = 'spatial-canvas';
  const renderer = new THREE.WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  try {
    await renderer.init();
  } catch {
    renderer.dispose();
    host.dataset.renderer = 'static';
    return () => {};
  }
  // WebGPURenderer selects its built-in WebGL2 backend when WebGPU is unavailable.
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  if (!host.isConnected) {
    renderer.dispose();
    return () => {};
  }
  host.dataset.renderer = backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  host.append(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 0, 9);
  const group = new THREE.Group();
  group.rotation.set(0.18, -0.25, -0.35);
  scene.add(group);
  const arcMaterial = new THREE.MeshBasicMaterial({ color: 0xb4422d });
  const softMaterial = new THREE.MeshBasicMaterial({
    color: 0xd4c7b9,
    transparent: true,
    opacity: 0.65,
  });
  const ringGeometry = new THREE.TorusGeometry(
    1.75,
    0.014,
    8,
    160,
    Math.PI * 1.73,
  );
  const arc = new THREE.Mesh(ringGeometry, arcMaterial);
  arc.rotation.z = 0.5;
  group.add(arc);
  const outerGeometry = new THREE.TorusGeometry(
    2.14,
    0.008,
    8,
    160,
    Math.PI * 1.64,
  );
  const outer = new THREE.Mesh(outerGeometry, softMaterial);
  outer.rotation.set(0.1, 0.15, -1);
  group.add(outer);
  const beadGeometry = new THREE.SphereGeometry(0.055, 12, 12);
  const bead = new THREE.Mesh(beadGeometry, arcMaterial);
  bead.position.set(Math.cos(0.5) * 1.75, Math.sin(0.5) * 1.75, 0);
  group.add(bead);
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  let visible = true;
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  visibility.observe(host);
  let alive = true;
  renderer.setAnimationLoop(() => {
    if (visible && !document.hidden && alive) renderer.render(scene, camera);
  });
  const context = gsap.context(() => {
    gsap.to(group.rotation, {
      z: 0.18,
      x: -0.1,
      scrollTrigger: {
        trigger: '.landing-hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 1,
      },
    });
    gsap.to('.fragment-email', {
      x: 22,
      y: 50,
      rotation: 0,
      scrollTrigger: {
        trigger: '.landing-hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 1,
      },
    });
    gsap.to('.fragment-order', {
      x: -30,
      y: -25,
      rotation: 0,
      scrollTrigger: {
        trigger: '.landing-hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 1,
      },
    });
    const stages = gsap.utils.toArray<HTMLElement>('.story-step');
    stages.forEach((step, index) => {
      ScrollTrigger.create({
        trigger: step,
        start: 'top 60%',
        end: 'bottom 60%',
        onToggle: ({ isActive }) => {
          if (isActive) {
            document
              .querySelector('.story-diagram')
              ?.setAttribute('data-stage', String(index));
          }
        },
      });
    });
    gsap.fromTo(
      '.story-circle-progress',
      { strokeDashoffset: 640 },
      {
        strokeDashoffset: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: '.story-steps',
          start: 'top 65%',
          end: 'bottom 65%',
          scrub: 0.6,
        },
      },
    );
  });
  return () => {
    alive = false;
    context.revert();
    observer.disconnect();
    visibility.disconnect();
    renderer.setAnimationLoop(null);
    ringGeometry.dispose();
    outerGeometry.dispose();
    beadGeometry.dispose();
    arcMaterial.dispose();
    softMaterial.dispose();
    renderer.dispose();
    canvas.remove();
    host.dataset.renderer = 'static';
  };
}
