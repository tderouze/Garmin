import { describe, it, expect } from "vitest";
import { parseGPX, parseFIT } from "@/lib/fit/parser";

describe("parseGPX", () => {
  it("parses a minimal GPX track", () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk><name>Test Run</name><trkseg>
    <trkpt lat="48.8566" lon="2.3522"><ele>35</ele><time>2024-01-01T08:00:00Z</time></trkpt>
    <trkpt lat="48.8570" lon="2.3530"><ele>36</ele><time>2024-01-01T08:01:00Z</time></trkpt>
    <trkpt lat="48.8575" lon="2.3540"><ele>37</ele><time>2024-01-01T08:02:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
    const result = parseGPX(gpx);
    expect(result.trackPoints.length).toBe(3);
    expect(result.trackPoints[0].lat).toBeCloseTo(48.8566);
    expect(result.trackPoints[0].lng).toBeCloseTo(2.3522);
    expect(result.distance).toBeGreaterThan(0);
    expect(result.duration).toBe(120);
  });

  it("throws on invalid GPX", () => {
    expect(() => parseGPX("not xml")).toThrow();
  });

  it("handles GPX with no track points", () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Empty</name><trkseg></trkseg></trk></gpx>`;
    const result = parseGPX(gpx);
    expect(result.trackPoints.length).toBe(0);
    expect(result.distance).toBe(0);
    expect(result.duration).toBe(0);
  });
});

describe("parseFIT", () => {
  it("rejects empty buffer", async () => {
    await expect(parseFIT(Buffer.alloc(0))).rejects.toThrow();
  });
  it("rejects invalid FIT data", async () => {
    await expect(parseFIT(Buffer.from("not a fit file"))).rejects.toThrow();
  });
});
