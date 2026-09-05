"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface TracePoint {
  lat: number;
  lng: number;
  ele?: number | null;
  time?: string | Date | null;
  hr?: number | null;
}

export interface Trace {
  id: string;
  color: string;
  points: TracePoint[];
}

export interface MapViewProps {
  traces: Trace[];
  onHover?: (traceId: string, index: number, point: TracePoint) => void;
  hoverPoint?: { traceId: string; index: number } | null;
  opacity?: number;
}

function getBounds(traces: Trace[]): maplibregl.LngLatBounds | null {
  if (!traces.length) return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  let hasPoint = false;
  for (const t of traces) {
    for (const p of t.points) {
      if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
      hasPoint = true;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
  }
  if (!hasPoint) return null;
  // pad slightly if single point
  if (minLng === maxLng && minLat === maxLat) {
    const d = 0.005;
    return new maplibregl.LngLatBounds([minLng - d, minLat - d], [maxLng + d, maxLat + d]);
  }
  return new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
}

export function MapView({ traces, onHover, hoverPoint, opacity = 0.8 }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const hoverMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onHoverRef = useRef<MapViewProps["onHover"]>(onHover);
  const tracesRef = useRef<Trace[]>(traces);
  const listenersRef = useRef<
    Map<string, { mouseenter: () => void; mouseleave: () => void; click: (e: maplibregl.MapLayerMouseEvent) => void }>
  >(new Map());

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);
  useEffect(() => {
    tracesRef.current = traces;
  }, [traces]);

  // Create map once
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [2.35, 48.85],
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-left");

    mapRef.current = map;

    return () => {
      // cleanup markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      hoverMarkerRef.current?.remove();
      hoverMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync traces -> sources/layers + fitBounds
  // onHover is read via onHoverRef to avoid thrashing the effect when the
  // parent recreates the closure; opacity/traces are the only deps that need
  // to re-run the sync. Listener cleanup uses map.off on removal (leak fix).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      // Remove existing trace layers/sources
      const existingIds = new Set(traces.map((t) => t.id));
      // collect current layers/sources to remove stale ones
      const style = map.getStyle();
      if (style?.layers) {
        for (const lyr of [...style.layers]) {
          if (lyr.id.startsWith("trace-")) {
            const id = lyr.id.replace(/^trace-/, "");
            if (!existingIds.has(id)) {
              // cleanup listeners before removing layer
              const handlers = listenersRef.current.get(lyr.id);
              if (handlers) {
                try {
                  map.off("mouseenter", lyr.id, handlers.mouseenter);
                } catch {
                  // ignore
                }
                try {
                  map.off("mouseleave", lyr.id, handlers.mouseleave);
                } catch {
                  // ignore
                }
                try {
                  map.off("click", lyr.id, handlers.click);
                } catch {
                  // ignore
                }
                listenersRef.current.delete(lyr.id);
              }
              try {
                if (map.getLayer(lyr.id)) map.removeLayer(lyr.id);
              } catch {
                // ignore
              }
              try {
                if (map.getSource(id)) map.removeSource(id);
              } catch {
                // ignore
              }
            }
          }
          // also hover layer
          if (lyr.id === "trace-hover") {
            try {
              if (map.getLayer(lyr.id)) map.removeLayer(lyr.id);
            } catch {
              // ignore
            }
          }
        }
      }
      // Remove hover source if present
      try {
        if (map.getSource("trace-hover")) map.removeSource("trace-hover");
      } catch {
        // ignore
      }

      for (const trace of traces) {
        if (!trace.points || trace.points.length < 2) continue;
        const coords = trace.points
          .filter((p) => isFinite(p.lat) && isFinite(p.lng))
          .map((p) => [p.lng, p.lat] as [number, number]);
        if (coords.length < 2) continue;

        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        };

        const sourceId = trace.id;
        const layerId = `trace-${trace.id}`;

        const existingSource = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
        if (existingSource) {
          existingSource.setData(geojson as never);
          // update paint
          try {
            if (map.getLayer(layerId)) {
              map.setPaintProperty(layerId, "line-color", trace.color);
              map.setPaintProperty(layerId, "line-opacity", opacity);
            }
          } catch {
            // ignore
          }
        } else {
          map.addSource(sourceId, { type: "geojson", data: geojson as never });
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": trace.color,
              "line-width": 3,
              "line-opacity": opacity,
            },
          });

          // Hover interaction: query nearest point on click/mousemove
          // Store handlers so we can map.off on stale-layer cleanup / effect cleanup
          const onEnter = () => {
            map.getCanvas().style.cursor = "pointer";
          };
          const onLeave = () => {
            map.getCanvas().style.cursor = "";
          };
          const onClick = (e: maplibregl.MapLayerMouseEvent) => {
            const cb = onHoverRef.current;
            if (!cb || !e.lngLat) return;
            // Use tracesRef to avoid stale closure over trace.points if trace mutated
            const curTraces = tracesRef.current;
            const curTrace = curTraces.find((t) => t.id === trace.id) ?? trace;
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let idx = 0; idx < curTrace.points.length; idx++) {
              const p = curTrace.points[idx];
              const d = Math.hypot(p.lng - e.lngLat.lng, p.lat - e.lngLat.lat);
              if (d < bestDist) {
                bestDist = d;
                bestIdx = idx;
              }
            }
            cb(curTrace.id, bestIdx, curTrace.points[bestIdx]);
          };
          listenersRef.current.set(layerId, { mouseenter: onEnter, mouseleave: onLeave, click: onClick });
          map.on("mouseenter", layerId, onEnter);
          map.on("mouseleave", layerId, onLeave);
          map.on("click", layerId, onClick);
        }
      }

      // Fit bounds if we have any traces
      const bounds = getBounds(traces);
      if (bounds) {
        try {
          map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 600 });
        } catch {
          // ignore fit errors before style loaded
        }
      }

      // Start/end markers: one per trace (optional, not per every trace to avoid clutter if many)
      // Clear old
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (traces.length <= 10) {
        for (const trace of traces) {
          if (!trace.points.length) continue;
          const start = trace.points[0];
          const end = trace.points[trace.points.length - 1];
          if (!isFinite(start.lat) || !isFinite(start.lng)) continue;
          const elStart = document.createElement("div");
          elStart.className = "h-3 w-3 rounded-full border-2 border-white shadow";
          elStart.style.backgroundColor = trace.color;
          elStart.title = `${trace.id} start`;
          const m1 = new maplibregl.Marker({ element: elStart }).setLngLat([start.lng, start.lat]).addTo(map);
          markersRef.current.push(m1);

          if (trace.points.length > 1 && isFinite(end.lat) && isFinite(end.lng)) {
            const elEnd = document.createElement("div");
            elEnd.className = "h-3 w-3 rounded-sm border-2 border-white shadow rotate-45";
            elEnd.style.backgroundColor = trace.color;
            elEnd.title = `${trace.id} end`;
            const m2 = new maplibregl.Marker({ element: elEnd }).setLngLat([end.lng, end.lat]).addTo(map);
            markersRef.current.push(m2);
          }
        }
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
      // also try on styledata in case load already fired
      map.once("styledata", () => {
        if (map.isStyleLoaded()) update();
      });
    }

    return () => {
      const m = mapRef.current;
      if (!m) return;
      for (const [layerId, handlers] of listenersRef.current) {
        try {
          m.off("mouseenter", layerId, handlers.mouseenter);
        } catch {
          // ignore
        }
        try {
          m.off("mouseleave", layerId, handlers.mouseleave);
        } catch {
          // ignore
        }
        try {
          m.off("click", layerId, handlers.click);
        } catch {
          // ignore
        }
      }
      listenersRef.current.clear();
    };
  }, [traces, opacity]);

  // Hover marker synchronized from ElevationProfile
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    hoverMarkerRef.current?.remove();
    hoverMarkerRef.current = null;
    if (!hoverPoint) return;
    const trace = traces.find((t) => t.id === hoverPoint.traceId);
    if (!trace) return;
    const pt = trace.points[hoverPoint.index];
    if (!pt || !isFinite(pt.lat) || !isFinite(pt.lng)) return;
    const el = document.createElement("div");
    el.className = "h-4 w-4 rounded-full border-2 border-white shadow-lg";
    el.style.backgroundColor = trace.color;
    el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.2)";
    const marker = new maplibregl.Marker({ element: el }).setLngLat([pt.lng, pt.lat]).addTo(map);
    hoverMarkerRef.current = marker;
  }, [hoverPoint, traces]);

  // handle empty state
  if (!traces.length) {
    return (
      <div className="flex h-[500px] w-full items-center justify-center rounded-xl border bg-zinc-50 text-sm text-zinc-500">
        Aucune trace sélectionnée — choisissez 2 à 10 activités à superposer.
      </div>
    );
  }

  // check if any trace has points
  const hasAnyPoints = traces.some((t) => t.points && t.points.length > 0);
  if (!hasAnyPoints) {
    return (
      <div className="flex h-[500px] w-full items-center justify-center rounded-xl border bg-zinc-50 text-sm text-zinc-500">
        Les activités sélectionnées n’ont pas de points GPS.
      </div>
    );
  }

  return <div ref={containerRef} className="h-[500px] w-full rounded-xl border shadow-sm" data-testid="map-container" />;
}
