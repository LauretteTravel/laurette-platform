import {
  CanvasTexture, Group, Mesh, MeshPhongMaterial, OrthographicCamera, Scene,
  SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer, HemisphereLight, DirectionalLight,
} from '/assets/vendor/three/three.module.min.js';

const rad = Math.PI / 180;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

async function earthTexture() {
  const response = await fetch('/assets/data/brochure-land.json');
  if (!response.ok) throw new Error('Missing land data');
  const land = await response.json();
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const palette = getComputedStyle(document.body);
  ctx.fillStyle = palette.getPropertyValue('--navy').trim() || '#064B49';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#286055';
  for (let x = 0; x < width; x += width / 12) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += height / 6) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.fillStyle = '#8bb29a';
  ctx.strokeStyle = palette.getPropertyValue('--gold-2').trim() || '#E0C78D';
  ctx.lineWidth = 1.5;
  for (const polygon of land) {
    ctx.beginPath();
    for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => ctx[i ? 'lineTo' : 'moveTo']((lon + 180) * width / 360, (90 - lat) * height / 180));
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function worldPoint(pin) {
  const lat = pin.latitude * rad;
  const lon = pin.longitude * rad;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export async function mountGlobe(stage, { label, open, onFailure }) {
  const host = stage.querySelector('.bh-canvas');
  const markers = stage.querySelector('.bh-markers');
  const toggle = stage.querySelector('[data-spin]');
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  let texture;
  try { texture = await earthTexture(); }
  catch (error) { renderer.dispose(); throw error; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  host.append(renderer.domElement);

  const scene = new Scene();
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const earth = new Group();
  earth.rotation.order = 'XYZ';
  earth.rotation.x = 23 * rad;
  earth.rotation.y = -124 * rad;
  scene.add(earth);
  earth.add(new Mesh(new SphereGeometry(1, 64, 40), new MeshPhongMaterial({ map: texture, shininess: 9 })));
  scene.add(new HemisphereLight('#fff5d4', '#6ba28f', 2.25));
  const rim = new DirectionalLight('#f6cc73', 1.5);
  rim.position.set(-3, 2, -2);
  scene.add(rim);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let stopped = reduced.matches;
  let active = false;
  let drawer = false;
  let iconFocus = false;
  let hovering = false;
  let idleUntil = 0;
  let width = 0;
  let height = 0;
  let zoom = 1;
  let lastTime = 0;
  let frame = 0;
  let pins = [];
  const pointer = new Map();
  const buttons = new Map();
  const projected = new Vector3();
  const spinning = time => !stopped && !drawer && !iconFocus && !hovering && !pointer.size && time > idleUntil;

  function spinLabel() {
    toggle.textContent = stopped ? 'تشغيل الدوران' : 'إيقاف الدوران';
    toggle.setAttribute('aria-pressed', String(stopped));
  }

  function addMarker(cluster) {
    const key = JSON.stringify(cluster.entries.map(entry => entry.pin.key));
    let item = buttons.get(key);
    if (!item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bh-pin';
      if (cluster.entries.length > 1) button.textContent = String(cluster.entries.length);
      button.addEventListener('click', () => open(buttons.get(key).entries.map(entry => entry.pin)));
      markers.append(button);
      item = { button };
      buttons.set(key, item);
    }
    const description = cluster.entries.map(entry => label(entry.pin)).join(' | ');
    if (item.button.dataset.label !== description) {
      item.button.dataset.label = description;
      item.button.setAttribute('aria-label', description);
    }
    item.entries = cluster.entries;
    item.button.style.left = cluster.x + 'px';
    item.button.style.top = cluster.y + 'px';
    return key;
  }

  function positionMarkers() {
    const clusters = [];
    for (const entry of pins) {
      const p = projected.copy(entry.point).applyMatrix4(earth.matrixWorld);
      if (p.z < .14) continue;
      p.project(camera);
      const x = (p.x + 1) * width / 2;
      const y = (1 - p.y) * height / 2;
      if (x < 8 || x > width - 8 || y < 20 || y > height - 20) continue;
      const nearby = clusters.find(group => Math.abs(group.x - x) < 30 && Math.abs(group.y - y) < 30);
      if (nearby) nearby.entries.push(entry);
      else clusters.push({ x: clamp(x, 14, width - 14), y, entries: [entry] });
    }
    const visible = new Set(clusters.map(addMarker));
    for (const [key, { button }] of buttons) {
      if (!visible.has(key)) { button.remove(); buttons.delete(key); }
    }
  }

  function render(time) {
    frame = 0;
    if (!active || document.hidden) return;
    const elapsed = lastTime ? Math.min(time - lastTime, 40) : 0;
    lastTime = time;
    if (spinning(time)) earth.rotation.y += elapsed * .00009;
    renderer.render(scene, camera);
    positionMarkers();
    if (spinning(time) || (!stopped && idleUntil > time)) schedule();
  }
  function schedule() { if (active && !frame) frame = requestAnimationFrame(render); }
  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    const half = 1.28 / zoom;
    camera.left = -half * Math.max(1, width / height);
    camera.right = -camera.left;
    camera.top = half * Math.max(1, height / width);
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    schedule();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  function changeZoom(factor) {
    zoom = clamp(zoom * factor, .8, 2.8);
    idleUntil = performance.now() + 1200;
    resize();
  }
  stage.querySelector('[data-zoom=in]').onclick = () => changeZoom(1.2);
  stage.querySelector('[data-zoom=out]').onclick = () => changeZoom(1 / 1.2);
  toggle.onclick = () => { stopped = !stopped; spinLabel(); schedule(); };
  reduced.addEventListener('change', event => { stopped = event.matches; spinLabel(); schedule(); });
  spinLabel();

  markers.onpointerover = event => { hovering = Boolean(event.target.closest('button')); schedule(); };
  markers.onpointerout = event => { hovering = Boolean(event.relatedTarget?.closest?.('.bh-pin')); schedule(); };
  markers.onfocusin = () => { iconFocus = true; schedule(); };
  markers.onfocusout = event => { iconFocus = markers.contains(event.relatedTarget); schedule(); };
  host.onpointerdown = event => {
    host.setPointerCapture(event.pointerId);
    pointer.set(event.pointerId, [event.clientX, event.clientY]);
    schedule();
  };
  const distance = () => {
    const [a, b] = pointer.values();
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  host.onpointermove = event => {
    const previous = pointer.get(event.pointerId);
    if (!previous) return;
    const oldDistance = pointer.size === 2 ? distance() : 0;
    pointer.set(event.pointerId, [event.clientX, event.clientY]);
    if (oldDistance > 0) changeZoom(distance() / oldDistance);
    if (pointer.size === 1) {
      earth.rotation.y += (event.clientX - previous[0]) * .007 / zoom;
      earth.rotation.x = clamp(earth.rotation.x + (event.clientY - previous[1]) * .007 / zoom, -Math.PI / 2, Math.PI / 2);
      schedule();
    }
  };
  const release = event => {
    pointer.delete(event.pointerId);
    idleUntil = performance.now() + 1200;
    schedule();
  };
  host.onpointerup = host.onpointercancel = host.onlostpointercapture = release;
  host.addEventListener('wheel', event => {
    event.preventDefault();
    changeZoom(Math.exp(clamp(-event.deltaY, -150, 150) * .002));
  }, { passive: false });
  document.addEventListener('visibilitychange', () => { lastTime = 0; schedule(); });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); active = false; onFailure(); });

  return {
    setPins(next) { pins = next.map(pin => ({ pin, point: worldPoint(pin) })); schedule(); },
    setActive(next) { active = next; lastTime = 0; if (next) resize(); },
    setDrawer(opened) { drawer = opened; if (!opened) { hovering = false; idleUntil = performance.now() + 1200; } schedule(); },
  };
}
