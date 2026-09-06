import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const HoloStudio = lazy(() => import("@/components/HoloStudio"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Visionary — Neural Model" },
      {
        name: "description",
        content:
          "Turn any camera feed into a live 3D model. Every frame is rebuilt as 3D geometry in the browser, with real-time mouth sync and motion sync.",
      },
      {
        property: "og:title",
        content: "Visionary — Neural Model",
      },
      {
        property: "og:description",
        content:
          "By NastyLex and RychTech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="aurora pointer-events-none absolute inset-0" />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
        <header className="mb-8 sm:mb-12">
          <span className="font-mono text-[11px] uppercase tracking-[0.4em] text-accent">
            Visionary · Neural Model 
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Every frame of your video feed,{" "}
            <span className="text-gradient">rebuilt as it happens.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            The Visionary neural model reads the camera stream frame by frame and reconstructs
            a live volumetric mesh — 478 facial vertices per face, with mouth
            movement and motion tracked in real time.
          </p>
        </header>

        <ClientOnly
          fallback={
            <div className="panel flex aspect-[4/3] items-center justify-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground lg:aspect-[16/10]">
              handshaking RychTech
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="panel flex aspect-[4/3] items-center justify-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground lg:aspect-[16/10]">
                Handing shaking Nastylex
              </div>
            }
          >
            <HoloStudio />
          </Suspense>
        </ClientOnly>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "Frame Accurate",
              d: "Each incoming frame produces its own 3D wireframe — no interpolated scan.",
            },
            {
              t: "Mouth sync",
              d: "Fluid Rendering depends on Cache and GPU performance.",
            },
            {
              t: "Powered By CNN",
              d: "Co-authored By Nastylex.",
            },
          ].map((f) => (
            <article key={f.t} className="panel p-5">
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
                {f.t}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.d}
              </p>
            </article>
          ))}
        </section>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          NastyLex · RychTech
        </p>
      </div>
    </main>
  );
}
