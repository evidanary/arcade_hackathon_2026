import { asNodeHandler, handleArcade } from "../server/handlers.js";

// POST /api/arcade: the Arcade API (patterns, products, categories, jobs).
export default asNodeHandler(handleArcade);
