// Runs the layout logic of mods/machine-meters/main.js against Herdr's main layout shape, with the
// app's functions faked: node test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./mods/machine-meters/main.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("// This mod's block"), src.indexOf("export default class"));
const main = () => ({ id: "root", type: "row", children: [
  { id: "sidebar", type: "column", children: [{ id: "spaces", type: "block", content: { mod: "spaces" } }, { id: "sidebar-footer", type: "block", content: { mod: "workspace-chrome" } }] },
  { id: "work", type: "column", children: [{ id: "status", type: "block", size: { px: 28 }, content: { mod: "workspace-status" } }] } ] });

let tree = main(), calls = [];
const env = { MOD: "machine-meters", layout: () => tree, machines: () => [{ name: null }, { name: "devbox" }], opts: () => ({ hidden: [] }),
  run: (name, args) => { calls.push(name); if (name === "layout.set") tree = args.layout; else find(tree, args.id).hidden = name === "layout.hide"; return null; } };
const { block, find, setPlace } = new Function(...Object.keys(env), body + "; return { block, find, setPlace };")(...Object.values(env));

assert.equal(block("panel"), null);
setPlace("panel", true);
const sidebar = find(tree, "sidebar").children.map((c) => c.id);
assert.deepEqual(sidebar, ["spaces", "meters", "sidebar-footer"], "sidebar block goes above the footer");
assert.equal(find(tree, "meters").size.px, 12 + 86 * 2, "sized for two machines");

setPlace("bar", true);
const status = find(tree, "status");
assert.equal(status.type, "row");
assert.deepEqual(status.children.map((c) => c.content.mod), ["workspace-status", "machine-meters"], "status bar keeps Herdr's own block");
assert.equal(block("bar").node.content.props.variant, "bar");
assert.equal(block("panel").node.id, "meters", "the two places are told apart");

setPlace("bar", false);
assert.equal(block("bar").hidden, true);
setPlace("bar", true);
assert.equal(block("bar").hidden, false);
assert.deepEqual(calls, ["layout.set", "layout.set", "layout.hide", "layout.show"]);

find(tree, "sidebar").hidden = true;
assert.equal(block("panel").hidden, true, "a folded sidebar hides its block");
console.log("ok");
