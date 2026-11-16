import type { CountryState, Unit, UnitType } from "./state";

/**
 * Unit types. Every unit belongs to one of the three branches the rest of the game already knows (army, fleet,
 * air wing) and is one *kind* within it. Kinds differ in attack and defense, speed, price, training time, the
 * military research level that unlocks them, and whether they burn fuel (energy). Numbers are game rules: a unit is
 * an abstract formation, not a real-world one.
 */
export type UnitKind =
  // Army
  | "infantry"
  | "motorized"
  | "mechanized"
  | "tanks"
  | "heavyTanks"
  | "artillery"
  | "antiAir"
  | "antiTank"
  | "specialForces"
  | "paratroopers"
  // Air
  | "fighter"
  | "heavyFighter"
  | "bomber"
  | "strategicBomber"
  | "navalBomber"
  | "transportPlane"
  // Navy
  | "destroyer"
  | "cruiser"
  | "battleship"
  | "carrier"
  | "submarine"
  | "transportShip";

export interface KindStats {
  type: UnitType;
  label: string;
  plural: string;
  /** Combat power when attacking and when defending (infantry = 1). */
  attack: number;
  defense: number;
  /** Movement speed multiplier. */
  speed: number;
  /** Recruiting price multiplier (upkeep follows the price). */
  cost: number;
  /** Days of training before the unit can move (it defends at half strength meanwhile). */
  trainDays: number;
  /** Military research level needed. */
  tech: number;
  /** Burns fuel: an energy shortage weakens it. */
  fuel: boolean;
  /** Tracked or armoured (anti-tank units counter it). */
  armored?: boolean;
  /** Counters enemy armour. */
  antiArmor?: boolean;
  /** Shoots down enemy air support over its province. */
  antiAir?: boolean;
  /** Air wings: support given to land battles in range, and to sea battles. */
  landSupport?: number;
  seaSupport?: number;
  /** Air wings: cancels this many enemy air wings' support (fighters). */
  airDefense?: number;
  /** Bombs enemy infrastructure in range each month in wartime. */
  strategic?: boolean;
  /** Can be dropped by air into enemy territory (needs a transport plane). */
  airborne?: boolean;
  /** Occupies provinces faster. */
  occupation?: number;
  /** Carries the war at sea to nearby coasts: support for coastal land battles. */
  carrier?: boolean;
  /** Submarines: stronger unless the enemy has destroyers. */
  submarine?: boolean;
  /** Destroyers: hunt submarines. */
  antiSub?: boolean;
  summary: string;
}

export const UNIT_KINDS: Record<UnitKind, KindStats> = {
  infantry: { type: "army", label: "Infantry", plural: "infantry", attack: 1, defense: 1, speed: 1, cost: 1, trainDays: 30, tech: 0, fuel: false, summary: "Cheap and steady. The backbone of every army." },
  motorized: { type: "army", label: "Motorized infantry", plural: "motorized infantry", attack: 1.1, defense: 1.05, speed: 1.35, cost: 1.4, trainDays: 40, tech: 2, fuel: true, summary: "Infantry on trucks: much faster, needs fuel." },
  mechanized: { type: "army", label: "Mechanized infantry", plural: "mechanized infantry", attack: 1.35, defense: 1.4, speed: 1.3, cost: 2, trainDays: 50, tech: 5, fuel: true, armored: true, summary: "Armoured carriers: fast, tough on defense." },
  tanks: { type: "army", label: "Tanks", plural: "tank divisions", attack: 1.9, defense: 1.15, speed: 1.25, cost: 2.4, trainDays: 60, tech: 4, fuel: true, armored: true, summary: "Hard-hitting breakthrough force. Weak to anti-tank guns." },
  heavyTanks: { type: "army", label: "Heavy tanks", plural: "heavy tank divisions", attack: 2.4, defense: 1.7, speed: 0.85, cost: 3.4, trainDays: 75, tech: 8, fuel: true, armored: true, summary: "Slow, very expensive, very strong." },
  artillery: { type: "army", label: "Artillery", plural: "artillery", attack: 1.6, defense: 1.3, speed: 0.9, cost: 1.6, trainDays: 45, tech: 1, fuel: false, summary: "Firepower for attacks and sieges. Slow." },
  antiAir: { type: "army", label: "Anti-air", plural: "anti-air", attack: 0.7, defense: 1, speed: 1, cost: 1.3, trainDays: 40, tech: 3, fuel: false, antiAir: true, summary: "Cancels enemy air support over its province." },
  antiTank: { type: "army", label: "Anti-tank", plural: "anti-tank", attack: 0.9, defense: 1.4, speed: 1, cost: 1.4, trainDays: 40, tech: 3, fuel: false, antiArmor: true, summary: "Blunts enemy tanks and mechanized units." },
  specialForces: { type: "army", label: "Special forces", plural: "special forces", attack: 1.6, defense: 1.3, speed: 1.1, cost: 2.2, trainDays: 70, tech: 5, fuel: false, occupation: 1.5, summary: "Elite troops. Take provinces 50% faster." },
  paratroopers: { type: "army", label: "Paratroopers", plural: "paratroopers", attack: 1.3, defense: 1.05, speed: 1, cost: 2, trainDays: 60, tech: 6, fuel: false, airborne: true, summary: "Can be dropped by air up to 1,200 km into enemy land (needs a transport plane)." },

  fighter: { type: "air", label: "Fighters", plural: "fighter wings", attack: 1, defense: 1, speed: 1, cost: 1, trainDays: 40, tech: 0, fuel: true, landSupport: 0.12, seaSupport: 0.06, airDefense: 1, summary: "Air support, and cancels one enemy wing's support." },
  heavyFighter: { type: "air", label: "Heavy fighters", plural: "heavy fighter wings", attack: 1, defense: 1, speed: 0.95, cost: 1.5, trainDays: 50, tech: 4, fuel: true, landSupport: 0.15, seaSupport: 0.08, airDefense: 1.4, summary: "Longer-ranged, tougher fighters." },
  bomber: { type: "air", label: "Bombers", plural: "bomber wings", attack: 1, defense: 1, speed: 0.9, cost: 1.6, trainDays: 55, tech: 3, fuel: true, landSupport: 0.22, seaSupport: 0.08, summary: "Strong support for land battles." },
  strategicBomber: { type: "air", label: "Strategic bombers", plural: "strategic bomber wings", attack: 1, defense: 1, speed: 0.85, cost: 2.4, trainDays: 75, tech: 8, fuel: true, landSupport: 0.1, strategic: true, summary: "In wartime, bomb enemy infrastructure within range every month." },
  navalBomber: { type: "air", label: "Naval bombers", plural: "naval bomber wings", attack: 1, defense: 1, speed: 0.9, cost: 1.6, trainDays: 55, tech: 5, fuel: true, landSupport: 0.06, seaSupport: 0.28, summary: "Sink ships: big support in sea battles." },
  transportPlane: { type: "air", label: "Transport aircraft", plural: "transport wings", attack: 1, defense: 1, speed: 1, cost: 1.1, trainDays: 40, tech: 2, fuel: true, summary: "Needed to drop paratroopers." },

  destroyer: { type: "navy", label: "Destroyers", plural: "destroyer flotillas", attack: 1, defense: 1, speed: 1.15, cost: 1, trainDays: 60, tech: 0, fuel: true, antiSub: true, summary: "Fast escorts that hunt submarines." },
  cruiser: { type: "navy", label: "Cruisers", plural: "cruiser squadrons", attack: 1.5, defense: 1.4, speed: 1.05, cost: 1.7, trainDays: 90, tech: 3, fuel: true, summary: "Balanced warships." },
  battleship: { type: "navy", label: "Battleships", plural: "battleship squadrons", attack: 2.5, defense: 2.3, speed: 0.85, cost: 3.2, trainDays: 150, tech: 6, fuel: true, summary: "Heavy guns, heavy armour, heavy price." },
  carrier: { type: "navy", label: "Aircraft carriers", plural: "carrier groups", attack: 1.2, defense: 1, speed: 0.95, cost: 3.5, trainDays: 150, tech: 8, fuel: true, carrier: true, seaSupport: 0.25, landSupport: 0.12, summary: "Air power at sea: supports sea battles and nearby coastal battles." },
  submarine: { type: "navy", label: "Submarines", plural: "submarine flotillas", attack: 1.6, defense: 0.6, speed: 0.9, cost: 1.2, trainDays: 70, tech: 2, fuel: true, submarine: true, summary: "Deadly unless the enemy brings destroyers." },
  transportShip: { type: "navy", label: "Transport ships", plural: "transport flotillas", attack: 0.2, defense: 0.4, speed: 1, cost: 0.6, trainDays: 40, tech: 1, fuel: true, summary: "Cheap hulls to ship armies overseas." },
};

export const UNIT_KIND_LIST = Object.keys(UNIT_KINDS) as UnitKind[];
export const KINDS_OF: Record<UnitType, UnitKind[]> = {
  army: UNIT_KIND_LIST.filter((k) => UNIT_KINDS[k].type === "army"),
  air: UNIT_KIND_LIST.filter((k) => UNIT_KINDS[k].type === "air"),
  navy: UNIT_KIND_LIST.filter((k) => UNIT_KINDS[k].type === "navy"),
};
/** The kind every unit of a branch had before unit types existed (and what old saves get). */
export const DEFAULT_KIND: Record<UnitType, UnitKind> = { army: "infantry", air: "fighter", navy: "destroyer" };

export const kindOf = (u: Pick<Unit, "type" | "kind">): KindStats => UNIT_KINDS[u.kind ?? DEFAULT_KIND[u.type]];
export const militaryLevel = (c: CountryState | undefined) => c?.research?.levels.military ?? c?.techLevel ?? 1;
/** Is this kind unlocked by the country's military research? */
export const kindUnlocked = (c: CountryState | undefined, k: UnitKind) => militaryLevel(c) >= UNIT_KINDS[k].tech;
