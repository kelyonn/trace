/**
 * Sample SQLite database from a different domain (ride-hailing fleet) so the
 * hot-swap story can be tried without any external database: switch to it and
 * the overview, cube and query views re-derive everything from its schema.
 */
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { resolveRepoPath } from "./paths.js";

type Db = { exec(sql: string): void; close(): void };
type DbCtor = new (path: string) => Db;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fleetSamplePath(): string {
  return process.env.FLEET_SAMPLE_PATH ?? path.join(resolveRepoPath("data"), "samples", "fleet.sqlite");
}

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function ensureFleetSample(target = fleetSamplePath(), trips = 40000): Promise<string> {
  if (existsSync(target)) return target;
  mkdirSync(path.dirname(target), { recursive: true });
  const DatabaseSync = (await import("node:sqlite")).DatabaseSync as unknown as DbCtor;
  const db = new DatabaseSync(target);
  const r = rng(7);
  const pick = <T,>(xs: T[], w?: number[]) => {
    if (!w) return xs[Math.floor(r() * xs.length)];
    const total = w.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < xs.length; i++) if ((x -= w[i]) <= 0) return xs[i];
    return xs[xs.length - 1];
  };

  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE cities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL, region TEXT NOT NULL);
    CREATE TABLE vehicles (id INTEGER PRIMARY KEY, make TEXT NOT NULL, vehicle_class TEXT NOT NULL, fuel TEXT NOT NULL);
    CREATE TABLE drivers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, tenure_band TEXT NOT NULL, city_id INTEGER NOT NULL REFERENCES cities(id));
    CREATE TABLE trips (
      id INTEGER PRIMARY KEY,
      driver_id INTEGER NOT NULL REFERENCES drivers(id),
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      city_id INTEGER NOT NULL REFERENCES cities(id),
      started_at TIMESTAMP NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL,
      distance_km REAL NOT NULL,
      duration_min REAL NOT NULL,
      fare REAL NOT NULL,
      tip REAL NOT NULL
    );
  `);

  const cities = [
    ["Lisbon", "Portugal", "Europe"],
    ["Berlin", "Germany", "Europe"],
    ["Madrid", "Spain", "Europe"],
    ["Austin", "United States", "Americas"],
    ["Toronto", "Canada", "Americas"],
    ["São Paulo", "Brazil", "Americas"],
    ["Singapore", "Singapore", "Asia Pacific"],
    ["Sydney", "Australia", "Asia Pacific"],
    ["Nairobi", "Kenya", "Africa"]
  ];
  const cityWeight = [10, 14, 11, 13, 9, 15, 12, 8, 6];
  db.exec(`INSERT INTO cities VALUES ${cities.map((c, i) => `(${i + 1},${esc(c[0])},${esc(c[1])},${esc(c[2])})`).join(",")}`);

  const makes = ["Toyota", "Tesla", "Hyundai", "Kia", "BYD", "Volkswagen", "Škoda"];
  const classes = ["Economy", "Comfort", "XL", "Premium"];
  const vehicles: string[] = [];
  for (let i = 1; i <= 220; i++) {
    const make = pick(makes, [22, 14, 16, 12, 10, 14, 12]);
    const fuel = make === "Tesla" || make === "BYD" ? "Electric" : pick(["Hybrid", "Petrol", "Electric"], [5, 4, 2]);
    vehicles.push(`(${i},${esc(make)},${esc(pick(classes, [50, 28, 14, 8]))},${esc(fuel)})`);
  }
  db.exec(`INSERT INTO vehicles VALUES ${vehicles.join(",")}`);

  const first = ["Ana", "Ben", "Chen", "Dara", "Emil", "Fatma", "Goran", "Hana", "Ivo", "Jun", "Kofi", "Lena", "Mateo", "Nia", "Omar", "Priya"];
  const last = ["Silva", "Müller", "García", "Smith", "Tremblay", "Souza", "Tan", "Jones", "Otieno", "Novak", "Kim", "Rossi"];
  const drivers: string[] = [];
  const driverCity: number[] = [];
  for (let i = 1; i <= 900; i++) {
    const city = cities.indexOf(pick(cities, cityWeight)) + 1;
    driverCity.push(city);
    drivers.push(`(${i},${esc(`${pick(first)} ${pick(last)}`)},${esc(pick(["< 1 year", "1–3 years", "3+ years"], [4, 4, 2]))},${city})`);
  }
  db.exec(`INSERT INTO drivers VALUES ${drivers.join(",")}`);

  const start = Date.UTC(2025, 0, 1);
  const span = Date.UTC(2026, 9, 31) - start;
  const hourWeight = [2, 1, 1, 1, 1, 2, 4, 7, 9, 6, 5, 5, 6, 5, 5, 6, 8, 10, 9, 7, 6, 5, 4, 3];
  db.exec("BEGIN");
  const batch: string[] = [];
  for (let i = 1; i <= trips; i++) {
    const driver = 1 + Math.floor(r() * 900);
    const city = driverCity[driver - 1];
    // Growth over time: later dates are more likely.
    const t = Math.sqrt(r());
    const day = new Date(start + Math.floor(t * span / 86400000) * 86400000);
    const hour = Number(pick([...Array(24).keys()], hourWeight));
    const ts = `${day.toISOString().slice(0, 10)} ${String(hour).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}:00`;
    const vehicle = 1 + Math.floor(r() * 220);
    const distance = Math.max(0.6, -Math.log(1 - r()) * 7.5);
    const duration = distance * (2.2 + r() * 2.5) + 3;
    const priceFactor = [1, 1.15, 1, 0.75, 1.1, 0.55, 1.05, 1.25, 0.45][city - 1];
    const status = pick(["completed", "cancelled_by_rider", "cancelled_by_driver"], [90, 7, 3]);
    const fare = status === "completed" ? (2.5 + distance * 1.35 + duration * 0.28) * priceFactor : 0;
    const payment = pick(["Card", "Wallet", "Cash"], city === 9 || city === 6 ? [3, 3, 4] : [6, 3, 1]);
    const tip = status === "completed" && payment !== "Cash" && r() < 0.35 ? fare * (0.05 + r() * 0.15) : 0;
    batch.push(
      `(${i},${driver},${vehicle},${city},'${ts}',${esc(payment)},${esc(status)},${distance.toFixed(2)},${duration.toFixed(1)},${fare.toFixed(2)},${tip.toFixed(2)})`
    );
    if (batch.length === 2000) {
      db.exec(`INSERT INTO trips VALUES ${batch.join(",")}`);
      batch.length = 0;
    }
  }
  if (batch.length) db.exec(`INSERT INTO trips VALUES ${batch.join(",")}`);
  db.exec("COMMIT");
  db.exec("CREATE INDEX idx_trips_started ON trips(started_at); CREATE INDEX idx_trips_city ON trips(city_id);");
  db.close();
  return target;
}
