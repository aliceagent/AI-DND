/** Demo scenes as data (original content). EchoDM walks these rails the
 *  way the Director will walk pack beats: travel matchers move the scene,
 *  dialogue rails answer in character ([voice:x] prefixes drive the caption
 *  band's speaker label), reveal rails disclose facts (party-wide or to
 *  the asker alone), and an encounter spec springs real combatants. The
 *  graph lives here too — the hub fogs it before anything reaches a client. */

import type { StatBlock } from "../../../engine/src/srd.js";

export interface SceneLocation {
  id: string; name: string; mood: string; palette: string;
  x: number; y: number;             // map coordinates (200×140 viewbox)
  arrival: string;                  // narration on entering
}

export interface DemoScene {
  id: string;
  title: string;
  opening: { location: string; fact?: { id: string; text: string } };
  locations: Record<string, SceneLocation>;
  edges: [string, string][];
  /** Travel rails: first match wins; `to` must be a location id. */
  travel: { re: RegExp; to: string }[];
  /** Dialogue rails: in-character replies; optional fact reveal rides along. */
  dialogue: { re: RegExp; at?: string; line: string;
              reveal?: { id: string; text: string; to: "party" | "asker" } }[];
  /** One springable encounter (host can also start combat manually). */
  encounter?: { re: RegExp; at: string; statblock: StatBlock; count: number;
                announce: string };
}

/** Original creature for the Salt Mill (engine-shaped, public-repo safe). */
export const BRINE_CRAWLER: StatBlock = {
  ref: "demo.brine_crawler", name: "Brine Crawler", side: "npc",
  ac: 13, maxHp: 11,
  abilities: { str: 12, dex: 15, con: 12, int: 2, wis: 10, cha: 4 },
  attacks: [{ name: "Barbed Claw", toHit: 4, damage: "1d6+2", type: "slashing", kind: "melee" }],
  proficiency: 2,
};

export const SCENES: Record<string, DemoScene> = {
  cellar: {
    id: "cellar",
    title: "The Moonlit Cellar",
    opening: { location: "loc.cellar",
      fact: { id: "fact.cellar_dark", text: "The cellar is dark, cold, and smells of mildew and old paper." } },
    locations: {
      "loc.cellar": { id: "loc.cellar", name: "The Moonlit Cellar", mood: "dread",
        palette: "night-blues", x: 100, y: 105,
        arrival: "The hatch creaks open onto darkness. Cold air rises, thick with mildew and old paper. Your lantern pushes a small circle of light down worn stone steps." },
      "loc.counting_house": { id: "loc.counting_house", name: "The Counting-House Above",
        mood: "wary-quiet", palette: "lamp-gold", x: 100, y: 45,
        arrival: "You climb back into the counting-house: overturned desks, scattered ledgers, moonlight through a broken shutter." },
      "loc.alley": { id: "loc.alley", name: "Back Alley", mood: "watchful",
        palette: "night-blues", x: 165, y: 95,
        arrival: "The alley is narrow and wet, one lantern guttering at the far end." },
      "loc.street": { id: "loc.street", name: "Merchant Row", mood: "hushed",
        palette: "lamp-gold", x: 35, y: 35,
        arrival: "Merchant Row stands shuttered, signboards creaking in the night wind." },
    },
    edges: [["loc.cellar", "loc.counting_house"], ["loc.cellar", "loc.alley"],
            ["loc.counting_house", "loc.street"]],
    travel: [
      { re: /upstairs|counting.house|back up/i, to: "loc.counting_house" },
      { re: /cellar|downstairs|back down/i, to: "loc.cellar" },
      { re: /alley|grate/i, to: "loc.alley" },
      { re: /street|outside|row/i, to: "loc.street" },
    ],
    dialogue: [],
  },

  saltmill: {
    id: "saltmill",
    title: "The Salt Mill",
    opening: { location: "loc.village_road",
      fact: { id: "fact.mill_stopped", text: "The mill wheel has stood still for three days." } },
    locations: {
      "loc.village_road": { id: "loc.village_road", name: "The Village Road", mood: "uneasy-calm",
        palette: "grass-day", x: 30, y: 40,
        arrival: "The road runs between salt-bleached fences toward the mill. No cart has passed today; the ruts hold yesterday's rain." },
      "loc.mill": { id: "loc.mill", name: "The Salt Mill", mood: "wary-quiet",
        palette: "lamp-gold", x: 95, y: 55,
        arrival: "The mill leans over the brine channel, wheel stopped mid-turn. Salt dust furs every sill, and the door stands a hand's width open." },
      "loc.loft": { id: "loc.loft", name: "The Flour Loft", mood: "dust-still",
        palette: "cave-dark", x: 95, y: 15,
        arrival: "The loft is white with old flour and salt. Rope hoists hang dead still over the open hatches." },
      "loc.brine_channel": { id: "loc.brine_channel", name: "The Brine Channel", mood: "dread",
        palette: "night-blues", x: 140, y: 95,
        arrival: "The channel runs black and fast under a plank bridge. Foam clings where the water turns, and nothing sings here." },
      "loc.sluice_gate": { id: "loc.sluice_gate", name: "The Old Sluice Gate", mood: "held-breath",
        palette: "cave-dark", x: 185, y: 120,
        arrival: "The sluice gate is shut with rust and years. Below it the water goes quiet — too quiet for a channel this fast." },
    },
    edges: [["loc.village_road", "loc.mill"], ["loc.mill", "loc.loft"],
            ["loc.mill", "loc.brine_channel"], ["loc.brine_channel", "loc.sluice_gate"]],
    travel: [
      { re: /\bmill\b|inside/i, to: "loc.mill" },
      { re: /loft|ladder|hoist|attic/i, to: "loc.loft" },
      { re: /channel|bridge|water/i, to: "loc.brine_channel" },
      { re: /sluice|gate downstream|downstream/i, to: "loc.sluice_gate" },
      { re: /road|village|back out/i, to: "loc.village_road" },
    ],
    dialogue: [
      { re: /marta|miller|old woman|greet|hello/i,
        line: "[voice:npc.marta] Wheel stopped three nights back, and my salt's still in the pans. You want the story, you'll have it — but not standing in my doorway." },
      { re: /ledger|book|accounts|deliver/i,
        line: "[voice:npc.marta] The ledger? Aye, take your look. Half those deliveries go to a name I've never poured a drink for.",
        reveal: { id: "fact.ledger_ghost_buyer", to: "party",
          text: "Marta's ledger lists regular deliveries to a buyer who does not exist." } },
      { re: /wheel|why.*stopped|what happened/i,
        line: "[voice:npc.marta] Something fouled the wheel from below. I sent the boy to look. He came back wet and wouldn't speak of it." },
    ],
    encounter: {
      re: /wade|cross the channel|swim|net|drag the water|disturb/i, at: "loc.brine_channel",
      statblock: BRINE_CRAWLER, count: 2,
      announce: "The water boils. Two long shapes come up the bank fast, all plate and claw, brine streaming off their backs.",
    },
  },
};

/** Secret rails that reveal to the ASKER alone (Box-private moments). */
export const PRIVATE_RAILS: Record<string, { re: RegExp; at: string; id: string; text: string }[]> = {
  saltmill: [
    { re: /look (under|below)|claw|marks|tracks|examine the gate|study the water/i,
      at: "loc.sluice_gate", id: "secret.crawlers_fear_gate",
      text: "The claw-marks come from the channel in dozens — and every line of them bends away from the sluice gate. Whatever lives here will not pass it." },
  ],
  cellar: [],
};
