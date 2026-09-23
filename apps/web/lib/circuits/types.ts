import { z } from "zod";

const CoordinateSchema = z.tuple([z.number(), z.number()]);
const NormalizedPointSchema = z.tuple([
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
]);

export const TurnMarkerSchema = z.object({
  number: z.number().int().positive(),
  progress: z.number().min(0).max(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  label: z.string().optional(),
});
export type TurnMarker = z.infer<typeof TurnMarkerSchema>;

export const SectorDivisionSchema = z.object({
  sector: z.union([z.literal(1), z.literal(2), z.literal(3), z.number().int().positive()]),
  startProgress: z.number().min(0).max(1),
  endProgress: z.number().min(0).max(1),
});
export type SectorDivision = z.infer<typeof SectorDivisionSchema>;

export const DRSSegmentSchema = z.object({
  id: z.string().optional(),
  zone: z.number().int().positive().optional(),
  startProgress: z.number().min(0).max(1),
  endProgress: z.number().min(0).max(1),
  detectionProgress: z.number().min(0).max(1).optional(),
});
export type DRSSegment = z.infer<typeof DRSSegmentSchema>;

export const SpeedTrapSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  progress: z.number().min(0).max(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});
export type SpeedTrap = z.infer<typeof SpeedTrapSchema>;

export const CircuitOverlaysSchema = z.object({
  turns: z.union([z.literal("unavailable"), z.array(TurnMarkerSchema)]),
  sectors: z.union([z.literal("unavailable"), z.array(SectorDivisionSchema)]),
  drs: z.union([z.literal("unavailable"), z.array(DRSSegmentSchema)]),
  speedTraps: z.union([z.literal("unavailable"), z.array(SpeedTrapSchema)]),
});
export type CircuitOverlays = z.infer<typeof CircuitOverlaysSchema>;

export const CircuitGeometrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: z.string().min(1),
  lengthKm: z.number().positive(),
  viewBox: z.literal("0 0 1000 1000"),
  path: z.string().min(1),
  source: z.object({
    repository: z.literal("bacinger/f1-circuits"),
    revision: z.literal("394d8fbe70ef2c0b0c8d23ff7bee61fa09606055"),
    file: z.string().startsWith("circuits/"),
    license: z.literal("MIT"),
    projection: z.literal("local equirectangular; centered, aspect-preserving fit; 80 unit padding"),
    sha256: z.string().length(64),
    coordinates: z.array(CoordinateSchema).min(2),
  }),
  normalizedCoordinates: z.array(NormalizedPointSchema).min(2),
  overlays: CircuitOverlaysSchema,
});

export type CircuitGeometry = z.infer<typeof CircuitGeometrySchema>;

export type CanonicalCircuitId =
  | "bahrain" | "jeddah" | "melbourne" | "suzuka" | "shanghai" | "miami"
  | "imola" | "monaco" | "montreal" | "barcelona" | "spielberg"
  | "silverstone" | "budapest" | "spa" | "zandvoort" | "monza" | "baku"
  | "singapore" | "austin" | "mexico" | "sao_paulo" | "las_vegas"
  | "lusail" | "yas_marina" | "madrid";

export type CircuitAlias =
  | "austria" | "red_bull_ring" | "hungaroring" | "cota"
  | "circuit_of_the_americas" | "interlagos" | "jose_carlos_pace"
  | "lasvegas" | "yasmarina" | "albert_park" | "monte_carlo"
  | "gilles_villeneuve" | "catalunya" | "spa_francorchamps" | "sakhir"
  | "marina_bay";

export type CircuitId = CanonicalCircuitId | CircuitAlias | (string & {});
