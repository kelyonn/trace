/**
 * Deterministic synthetic retail dataset for the embedded engine.
 *
 * The generator layers growth, seasonality, weekday effects, regional mix,
 * industry/category affinity and a heavy-tailed customer distribution so the
 * dashboard and cube views show realistic structure instead of uniform noise.
 */

export type DemoCustomer = { id: number; name: string; industry: string; region: string };
export type DemoProduct = { id: number; sku: string; category: string; unit_price: number };
export type DemoOrder = { id: number; customer_id: number; order_date: string; amount: number; status: string };
export type DemoLine = { id: number; order_id: number; product_id: number; quantity: number; line_amount: number };

export type DemoDataset = {
  customers: DemoCustomer[];
  products: DemoProduct[];
  orders: DemoOrder[];
  orderLines: DemoLine[];
};

export const DEMO_START = "2024-01-01";
export const DEMO_END = "2026-10-31";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPicker<T>(items: T[], weights: number[], rand: () => number): () => T {
  const total = weights.reduce((a, b) => a + b, 0);
  const cumulative: number[] = [];
  let acc = 0;
  for (const w of weights) {
    acc += w / total;
    cumulative.push(acc);
  }
  return () => {
    const r = rand();
    for (let i = 0; i < cumulative.length; i++) {
      if (r <= cumulative[i]) return items[i];
    }
    return items[items.length - 1];
  };
}

const REGIONS = ["North America", "Europe", "APAC", "Latin America", "Middle East", "Africa"];
const REGION_WEIGHTS = [34, 27, 21, 9, 5, 4];
/** Annual growth rate per region (APAC and LatAm grow fastest). */
const REGION_GROWTH: Record<string, number> = {
  "North America": 0.14,
  Europe: 0.1,
  APAC: 0.42,
  "Latin America": 0.3,
  "Middle East": 0.22,
  Africa: 0.26
};

const INDUSTRIES = [
  "Retail",
  "Manufacturing",
  "Healthcare",
  "Technology",
  "Finance",
  "Energy",
  "Logistics",
  "Media",
  "Education",
  "Government"
];
const INDUSTRY_WEIGHTS = [16, 14, 11, 15, 10, 6, 9, 7, 6, 6];

const CATEGORIES = [
  "Electronics",
  "Apparel",
  "Home",
  "Industrial",
  "Pharma",
  "Software",
  "Food",
  "Automotive",
  "Office",
  "Sports",
  "Beauty",
  "Garden"
];
const CATEGORY_PRICE: Record<string, number> = {
  Electronics: 420,
  Apparel: 48,
  Home: 95,
  Industrial: 610,
  Pharma: 180,
  Software: 890,
  Food: 22,
  Automotive: 340,
  Office: 35,
  Sports: 75,
  Beauty: 30,
  Garden: 55
};

const AFFINITY: Record<string, string[]> = {
  Retail: ["Apparel", "Beauty", "Home", "Food"],
  Manufacturing: ["Industrial", "Automotive", "Electronics"],
  Healthcare: ["Pharma", "Office", "Electronics"],
  Technology: ["Software", "Electronics", "Office"],
  Finance: ["Software", "Office"],
  Energy: ["Industrial", "Automotive"],
  Logistics: ["Automotive", "Industrial", "Office"],
  Media: ["Electronics", "Software"],
  Education: ["Office", "Software", "Sports"],
  Government: ["Office", "Industrial", "Software"]
};

const NAME_A = [
  "Northwind", "Bluepeak", "Ironclad", "Silverline", "Brightwater", "Redwood", "Summit", "Harbor",
  "Granite", "Evergreen", "Lumen", "Cobalt", "Meridian", "Pioneer", "Atlas", "Crescent", "Sterling",
  "Horizon", "Oakridge", "Vertex", "Kestrel", "Polaris", "Riverstone", "Aurora", "Beacon", "Cascade"
];
const NAME_B: Record<string, string[]> = {
  Retail: ["Outfitters", "Market", "Goods", "Stores"],
  Manufacturing: ["Works", "Fabrication", "Industries", "Machining"],
  Healthcare: ["Health", "Clinics", "Medical", "Care"],
  Technology: ["Labs", "Systems", "Digital", "Networks"],
  Finance: ["Capital", "Partners", "Financial", "Bancorp"],
  Energy: ["Energy", "Power", "Utilities", "Renewables"],
  Logistics: ["Freight", "Logistics", "Transport", "Shipping"],
  Media: ["Studios", "Media", "Broadcasting", "Publishing"],
  Education: ["Academy", "Learning", "University", "Schools"],
  Government: ["Agency", "Authority", "Department", "Council"]
};
const SUFFIX = ["Inc", "LLC", "Group", "Co", "Ltd", "GmbH", "Holdings"];

/** Month multipliers (Jan..Dec): soft Q1, mid-year bump, strong Q4 peak. */
const SEASONALITY = [0.78, 0.82, 0.95, 0.98, 1.02, 1.0, 0.94, 0.97, 1.05, 1.12, 1.38, 1.52];
/** Weekday multipliers (Sun..Sat). */
const WEEKDAY = [0.55, 1.08, 1.14, 1.12, 1.1, 1.04, 0.66];

export type DemoScale = { customers: number; products: number; ordersPerDay: number };

export const DEFAULT_SCALE: DemoScale = { customers: 2400, products: 360, ordersPerDay: 58 };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function generateDemoData(scale: DemoScale = DEFAULT_SCALE, seed = 20241105): DemoDataset {
  const rand = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(rand(), 1e-9);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const pickRegion = weightedPicker(REGIONS, REGION_WEIGHTS, rand);
  const pickIndustry = weightedPicker(INDUSTRIES, INDUSTRY_WEIGHTS, rand);

  // Customers ---------------------------------------------------------------
  const customers: DemoCustomer[] = [];
  const customerWeight: number[] = [];
  const usedNames = new Set<string>();
  for (let i = 1; i <= scale.customers; i++) {
    const industry = pickIndustry();
    const region = pickRegion();
    let name = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = NAME_A[Math.floor(rand() * NAME_A.length)];
      const bList = NAME_B[industry];
      const b = bList[Math.floor(rand() * bList.length)];
      const s = SUFFIX[Math.floor(rand() * SUFFIX.length)];
      name = `${a} ${b} ${s}`;
      if (!usedNames.has(name)) break;
      name = `${a} ${b} ${s} ${i}`;
    }
    usedNames.add(name);
    customers.push({ id: i, name, industry, region });
    // Pareto-ish account size so a handful of customers dominate revenue.
    customerWeight.push(Math.pow(rand(), -0.85));
  }

  const customersByRegion = new Map<string, { ids: number[]; weights: number[] }>();
  for (const c of customers) {
    const bucket = customersByRegion.get(c.region) ?? { ids: [], weights: [] };
    bucket.ids.push(c.id);
    bucket.weights.push(customerWeight[c.id - 1]);
    customersByRegion.set(c.region, bucket);
  }
  const regionCustomerPicker = new Map<string, () => number>();
  for (const [region, bucket] of customersByRegion) {
    regionCustomerPicker.set(region, weightedPicker(bucket.ids, bucket.weights, rand));
  }

  // Products ----------------------------------------------------------------
  const products: DemoProduct[] = [];
  const productsByCategory = new Map<string, number[]>();
  for (let i = 1; i <= scale.products; i++) {
    const category = CATEGORIES[(i - 1) % CATEGORIES.length];
    const base = CATEGORY_PRICE[category];
    const unit_price = round2(Math.max(2, base * Math.exp(gauss() * 0.45)));
    products.push({ id: i, sku: `SKU-${String(i).padStart(6, "0")}`, category, unit_price });
    const list = productsByCategory.get(category) ?? [];
    list.push(i);
    productsByCategory.set(category, list);
  }

  const categoryPickerByIndustry = new Map<string, () => string>();
  for (const industry of INDUSTRIES) {
    const preferred = new Set(AFFINITY[industry]);
    categoryPickerByIndustry.set(
      industry,
      weightedPicker(
        CATEGORIES,
        CATEGORIES.map((c) => (preferred.has(c) ? 5 : 1)),
        rand
      )
    );
  }

  // Orders + lines ----------------------------------------------------------
  const orders: DemoOrder[] = [];
  const orderLines: DemoLine[] = [];
  const start = new Date(`${DEMO_START}T00:00:00Z`);
  const end = new Date(`${DEMO_END}T00:00:00Z`);
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const regionTotal = REGION_WEIGHTS.reduce((a, b) => a + b, 0);

  let orderId = 0;
  let lineId = 0;
  for (let d = 0; d <= totalDays; d++) {
    const day = new Date(start.getTime() + d * 86400000);
    const yearFrac = d / 365;
    const seasonal = SEASONALITY[day.getUTCMonth()] * WEEKDAY[day.getUTCDay()];
    const daysAgo = totalDays - d;
    const dateStr = day.toISOString().slice(0, 10);

    for (let r = 0; r < REGIONS.length; r++) {
      const region = REGIONS[r];
      const growth = Math.pow(1 + REGION_GROWTH[region], yearFrac);
      const expected = scale.ordersPerDay * (REGION_WEIGHTS[r] / regionTotal) * seasonal * growth;
      // Poisson-ish draw via rounding with jitter.
      const count = Math.max(0, Math.round(expected + gauss() * Math.sqrt(expected)));
      const pickCustomer = regionCustomerPicker.get(region);
      if (!pickCustomer) continue;

      for (let k = 0; k < count; k++) {
        orderId += 1;
        const customerId = pickCustomer();
        const customer = customers[customerId - 1];
        const pickCategory = categoryPickerByIndustry.get(customer.industry)!;

        let status: string;
        const s = rand();
        if (daysAgo < 3) status = s < 0.55 ? "pending" : s < 0.92 ? "processing" : "cancelled";
        else if (daysAgo < 14) status = s < 0.12 ? "pending" : s < 0.42 ? "processing" : s < 0.95 ? "shipped" : "cancelled";
        else status = s < 0.9 ? "shipped" : s < 0.965 ? "cancelled" : s < 0.985 ? "processing" : "pending";

        const lineCount = 1 + Math.floor(Math.pow(rand(), 1.6) * 5);
        let amount = 0;
        for (let l = 0; l < lineCount; l++) {
          lineId += 1;
          const category = pickCategory();
          const list = productsByCategory.get(category)!;
          const productId = list[Math.floor(rand() * list.length)];
          const product = products[productId - 1];
          const quantity = 1 + Math.floor(Math.pow(rand(), 2.2) * 12);
          const line_amount = round2(quantity * product.unit_price);
          amount += line_amount;
          orderLines.push({ id: lineId, order_id: orderId, product_id: productId, quantity, line_amount });
        }
        orders.push({ id: orderId, customer_id: customerId, order_date: dateStr, amount: round2(amount), status });
      }
    }
  }

  return { customers, products, orders, orderLines };
}
