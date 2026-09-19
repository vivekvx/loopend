'use client';
import { useEffect, useRef } from 'react';

export function HeroVisual() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      const currentGeneration = ++generation;
      if (preference.matches) {
        element.dataset.renderer = 'static';
        return;
      }
      timer = setTimeout(() => {
        void import('./spatial-scene')
          .then(async ({ mountScene }) => {
            if (
              disposed ||
              preference.matches ||
              currentGeneration !== generation
            )
              return;
            const destroy = await mountScene(element);
            if (
              disposed ||
              preference.matches ||
              currentGeneration !== generation
            )
              destroy();
            else cleanup = destroy;
          })
          .catch(() => {
            element.dataset.renderer = 'static';
          });
      }, 120);
    };
    const change = () => {
      generation++;
      clearTimeout(timer);
      cleanup?.();
      cleanup = undefined;
      element.dataset.renderer = 'static';
      if (!preference.matches) load();
    };
    load();
    preference.addEventListener('change', change);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cleanup?.();
      preference.removeEventListener('change', change);
    };
  }, []);
  return (
    <div
      className="hero-art"
      ref={host}
      data-renderer="static"
      aria-hidden="true"
    >
      <div className="art-grid" />
      <div className="static-orbit orbit-one" />
      <div className="static-orbit orbit-two" />
      <div className="orbit-core">
        <span className="tiny-label">ONE OPEN LOOP</span>
        <span className="orbit-title">
          The refund
          <br />
          that didn’t arrive.
        </span>
        <span className="orbit-amount">£ 128.00</span>
      </div>
      <div className="fragment fragment-email">
        <span className="fragment-icon">↳</span>
        <div>
          <small>THE EMAIL</small>
          <p>“Your refund is on its way.”</p>
          <span>7 business days ago</span>
        </div>
      </div>
      <div className="fragment fragment-date">
        <span className="tiny-label">THE PROMISE</span>
        <strong>3–5 days</strong>
        <span>Expected. Still waiting.</span>
      </div>
      <div className="fragment fragment-order">
        <span className="tiny-label">THE ORDER</span>
        <p>
          Return received <span>✓</span>
        </p>
        <span>Order #1048 · £128.00</span>
      </div>
      <div className="art-coordinate coordinate-top">
        01 / A SITUATION, NOT A TASK
      </div>
      <div className="art-coordinate coordinate-bottom">
        <span className="live-dot" /> THE STORY, HELD TOGETHER
      </div>
    </div>
  );
}
