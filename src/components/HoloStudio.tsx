import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Status = "idle" | "loading" | "live" | "error";

type Metrics = {
  fps: number;
  points: number;
  mouth: number;
  smile: number;
  blink: number;
  face: boolean;
  faces: number;
};

const EMPTY: Metrics = {
  fps: 0,
  points: 0,
  mouth: 0,
  smile: 0,
  blink: 0,
  face: false,
  faces: 0,
};

const MAX_FACES = 2;

const PALETTE = [
  { points: 0x7dfcd2, wire: 0x2ee6a8, lips: [1, 0.7, 0.48] as const },
  { points: 0xc9a8ff, wire: 0x8f6bff, lips: [0.75, 0.55, 1] as const },
];

function shape(res: FaceLandmarkerResult, idx: number, name: string) {
  const cats = res.faceBlendshapes?.[idx]?.categories;
  if (!cats) return 0;
  const c = cats.find((k) => k.categoryName === name);
  return c ? c.score : 0;
}


export default function HoloStudio() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopRef.current?.();
    stopRef.current = null;
    const v = videoRef.current;
    if (v?.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
    setStatus("idle");
    setMetrics(EMPTY);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    const mount = mountRef.current;
    const video = videoRef.current;
    if (!mount || !video || status === "loading" || status === "live") return;

    setError(null);
    setStatus("loading");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: MAX_FACES,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      /* ---------- three.js scene ---------- */
      const scene = new THREE.Scene();
      scene.background = null;
      const camera = new THREE.PerspectiveCamera(
        45,
        mount.clientWidth / mount.clientHeight,
        0.1,
        100,
      );
      camera.position.set(0, 0.1, 5.2);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minDistance = 2;
      controls.maxDistance = 10;
      controls.target.set(0, 0, 0);

      const grid = new THREE.GridHelper(14, 28, 0x1d4b52, 0x123036);
      grid.position.y = -2.6;
      scene.add(grid);

      const FACE_N = 478;

      const meshIndex: number[] = [];
      FaceLandmarker.FACE_LANDMARKS_TESSELATION.forEach((c) =>
        meshIndex.push(c.start, c.end),
      );
      const lipsIndex: number[] = [];
      FaceLandmarker.FACE_LANDMARKS_LIPS.forEach((c) =>
        lipsIndex.push(c.start, c.end),
      );

      const rigs = PALETTE.slice(0, MAX_FACES).map((c) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(FACE_N * 3), 3),
        );
        const points = new THREE.Points(
          geom,
          new THREE.PointsMaterial({
            color: c.points,
            size: 0.022,
            transparent: true,
            opacity: 0.95,
          }),
        );
        const wireGeom = new THREE.BufferGeometry();
        wireGeom.setAttribute("position", geom.getAttribute("position"));
        wireGeom.setIndex(meshIndex);
        const wire = new THREE.LineSegments(
          wireGeom,
          new THREE.LineBasicMaterial({
            color: c.wire,
            transparent: true,
            opacity: 0.32,
          }),
        );
        const lipsGeom = new THREE.BufferGeometry();
        lipsGeom.setAttribute("position", geom.getAttribute("position"));
        lipsGeom.setIndex(lipsIndex);
        const lips = new THREE.LineSegments(
          lipsGeom,
          new THREE.LineBasicMaterial({ color: c.points }),
        );
        scene.add(points, wire, lips);
        return {
          geom,
          pos: geom.getAttribute("position") as THREE.BufferAttribute,
          points,
          wire,
          lips,
          lipsBase: c.lips,
        };
      });

      const onResize = () => {
        if (!mount.clientWidth) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
      window.addEventListener("resize", onResize);

      /* ---------- per-frame reconstruction ---------- */
      let lastVideoTime = -1;
      let frames = 0;
      let fpsMark = performance.now();
      let uiMark = 0;
      let live: Metrics = { ...EMPTY };

      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const now = performance.now();

        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const ts = now;

          let faceRes: FaceLandmarkerResult | null = null;
          try {
            faceRes = faceLandmarker.detectForVideo(video, ts);
          } catch {
            /* frame dropped */
          }

          let detected = 0;

          rigs.forEach((rig, idx) => {
            const lm = faceRes?.faceLandmarks?.[idx];
            const ok = !!lm && lm.length > 0;
            rig.points.visible = ok;
            rig.wire.visible = ok;
            rig.lips.visible = ok;
            if (!ok || !lm) return;
            detected++;

            for (let i = 0; i < FACE_N; i++) {
              const p = lm[i];
              if (!p) continue;
              rig.pos.setXYZ(
                i,
                -(p.x - 0.5) * 4.2,
                -(p.y - 0.5) * 4.2,
                -p.z * 4.2,
              );
            }
            rig.pos.needsUpdate = true;
            rig.geom.computeBoundingSphere();

            const mouth = shape(faceRes!, idx, "jawOpen");
            const smile =
              (shape(faceRes!, idx, "mouthSmileLeft") +
                shape(faceRes!, idx, "mouthSmileRight")) /
              2;
            const blink =
              (shape(faceRes!, idx, "eyeBlinkLeft") +
                shape(faceRes!, idx, "eyeBlinkRight")) /
              2;

            const [lr, lg, lb] = rig.lipsBase;
            (rig.lips.material as THREE.LineBasicMaterial).color.setRGB(
              Math.min(1, lr + mouth * 0.25),
              Math.max(0, lg - mouth * 0.45),
              Math.max(0, lb - mouth * 0.4),
            );
            (rig.points.material as THREE.PointsMaterial).size =
              0.02 + mouth * 0.006 * (1 + mouth * 0.9);

            if (idx === 0) {
              live.mouth = mouth;
              live.smile = smile;
              live.blink = blink;
            }
          });

          live.faces = detected;
          live.face = detected > 0;
          live.points = detected * FACE_N;
          if (!detected) {
            live.mouth = 0;
            live.smile = 0;
            live.blink = 0;
          }


          frames++;
          if (now - fpsMark > 500) {
            live.fps = Math.round((frames * 1000) / (now - fpsMark));
            frames = 0;
            fpsMark = now;
          }
        }

        if (now - uiMark > 120) {
          uiMark = now;
          setMetrics({ ...live });
        }

        controls.update();
        renderer.render(scene, camera);
      };

      stopRef.current = () => {
        window.removeEventListener("resize", onResize);
        controls.dispose();
        faceLandmarker.close();
        renderer.dispose();
        if (renderer.domElement.parentNode === mount)
          mount.removeChild(renderer.domElement);
      };

      setStatus("live");
      loop();
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? e.message
          : "Could not start the camera. Allow camera access and try again.",
      );
      setStatus("error");
      stop();
      setStatus("error");
    }
  }, [status, stop]);

  const busy = status === "loading";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="panel relative aspect-[4/3] w-full overflow-hidden lg:aspect-[16/10]">
        <div ref={mountRef} className="absolute inset-0" />
        <div className="scanline pointer-events-none absolute inset-0" />

        {status !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-accent">
              {busy ? "loading neural models" : "reconstruction offline"}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {error ??
                "Your camera stream is analysed frame by frame in the browser and rebuilt as live 3D geometry. Nothing is uploaded."}
            </p>
            <button className="btn-glow" onClick={start} disabled={busy}>
              {busy ? "Initialising…" : "Start live reconstruction"}
            </button>
          </div>
        )}

        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute bottom-3 right-3 w-28 rounded-md border border-border/60 opacity-70 shadow-lg sm:w-36"
          style={{ transform: "scaleX(-1)" }}
        />

        {status === "live" && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-accent backdrop-blur">
            <span className="pulse-dot" /> live · {metrics.fps} fps
          </div>
        )}
      </div>

      <aside className="panel flex flex-col gap-5 p-5">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Telemetry
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Per-frame signals driving the mesh
          </p>
        </div>

        <Meter label="Mouth sync" value={metrics.mouth} />
        <Meter label="Smile" value={metrics.smile} />
        <Meter label="Blink" value={metrics.blink} />

        <dl className="grid grid-cols-2 gap-3 border-t border-border/60 pt-4 font-mono text-xs">
          <Stat k="Vertices" v={metrics.points.toString()} />
          <Stat k="Frame rate" v={`${metrics.fps} fps`} />
          <Stat k="Face" v={metrics.face ? "locked" : "—"} />
        </dl>

        <div className="mt-auto flex flex-col gap-2">
          {status === "live" ? (
            <button className="btn-ghost" onClick={stop}>
              Stop capture
            </button>
          ) : (
            <button className="btn-glow" onClick={start} disabled={busy}>
              {busy ? "Initialising…" : "Start capture"}
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Drag the viewport to orbit the reconstruction, scroll to zoom.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest">
        <span className="text-foreground/80">{label}</span>
        <span className="text-accent">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 text-foreground">{v}</dd>
    </div>
  );
}
