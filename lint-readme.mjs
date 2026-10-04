#!/usr/bin/env node
// Scans the README for the phrasing habits that read as machine written.
// Run with: node lint-readme.mjs
//
// Two kinds of finding. Overused openers, where a lot of sentences begin with
// the same word. And stock phrases that pad a sentence without adding anything.
// Em dashes get their own count because they are easy to lean on.

import { readFileSync } from "node:fs";

const text = readFileSync(new URL("./README.md", import.meta.url), "utf8");

// Phrases that pad rather than inform. Each is a real habit of generated prose.
// Matched whole words or fixed phrases, never a bare 2 letter word, because
// "so" and "it" are common in ordinary technical writing.
const TELLS = [
	"not just", "Here's the thing", "The good news", "Whether you", "it's not",
	"Simply put", "simply put", "In order to", "Note that", "That said",
	"Think of it", "Picture this", "at its core", "Bottom line", "bottom line",
	"Crucially", "Importantly", "Worth noting", "seamless", "leverage",
	"powerful", "robust", "vital", "breathtaking", "landscape of", "realm of",
	"journey", "delve", "tapestry", "Moreover", "Furthermore", "Additionally,",
	"In conclusion", "game-changer", "cutting-edge", "seamlessly",
	"without missing a beat", "the sky's the limit", "buckle up",
	"Enter ", "Let's", "This is where", "the magic happens",
	// Connectives that pad rather than carry meaning.
	"Moreover,", "Additionally,", "That said,", "In essence", "In summary",
	"To summarize", "In short", "Put simply", "Put differently",
];

// Sentence openers. Reported as a count so a habit stands out.
const openers = new Map();

const sentences = text
	.replace(/```[\s\S]*?```/g, " ") // code blocks are not prose
	.split(/(?<=[.!?])\s+/);

for (const sentence of sentences) {
	const word = sentence.match(/^[A-Za-z"'`]+/)?.[0] ?? "";
	if (!word) continue;
	const key = word[0].toUpperCase() + word.slice(1).toLowerCase();
	openers.set(key, (openers.get(key) ?? 0) + 1);
}

const emDash = (text.match(/—/g) ?? []).length;
const found = TELLS.filter((tell) => text.toLowerCase().includes(tell.toLowerCase()));
const topOpeners = [...openers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

console.log(`${sentences.length} sentences in the prose\n`);

console.log("em dashes:", emDash, emDash === 0 ? "" : "(lean on these and the text reads as machine written)");

console.log("\nstock phrases found:", found.length);
if (found.length === 0) console.log("  none");
for (const tell of found) {
	const lines = text.split("\n").filter((line) => line.toLowerCase().includes(tell.toLowerCase()));
	for (const line of lines.slice(0, 3)) {
		const at = text.indexOf(line) ;
		const lineNo = text.slice(0, at).split("\n").length;
		console.log(`  line ${lineNo}: ${tell}  ${line.trim().slice(0, 70)}`);
	}
}

console.log("\nmost common sentence openers:");
for (const [word, count] of topOpeners) {
	const flag = count >= 8 ? "  <- repeated often" : "";
	console.log(`  ${String(count).padStart(3)}  ${word}${flag}`);
}

// A threshold, so this fails loudly when the habit grows again.
const problems = [];
if (emDash > 3) problems.push(`${emDash} em dashes`);
if (found.length > 0) problems.push(`${found.length} stock phrase(s)`);
for (const [word, count] of topOpeners) {
	if (count >= 10) problems.push(`"${word}" opens ${count} sentences`);
}

console.log(
	problems.length === 0
		? "\nclean"
		: `\n${problems.length} to fix: ${problems.join(", ")}`,
);
process.exit(problems.length === 0 ? 0 : 1);
