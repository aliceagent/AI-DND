/** The demo world's LocationGraph (original content). Real campaigns load
 *  theirs from the pack (entity cards + beat exits) — same shape. The fog
 *  is NOT stored here: visited comes from the scene_set fold, so the map
 *  can never know more than the table does. */

export interface MapNode { id: string; name: string; x: number; y: number }
export interface MapEdge { from: string; to: string }

export interface LocationGraph { nodes: MapNode[]; edges: MapEdge[] }

export const DEMO_MAP: LocationGraph = {
  nodes: [
    { id: "loc.cellar", name: "The Moonlit Cellar", x: 100, y: 105 },
    { id: "loc.counting_house", name: "The Counting-House", x: 100, y: 45 },
    { id: "loc.alley", name: "Back Alley", x: 165, y: 95 },
    { id: "loc.street", name: "Merchant Row", x: 35, y: 35 },
  ],
  edges: [
    { from: "loc.cellar", to: "loc.counting_house" },
    { from: "loc.cellar", to: "loc.alley" },        // the grate — if they find it
    { from: "loc.counting_house", to: "loc.street" },
  ],
};
