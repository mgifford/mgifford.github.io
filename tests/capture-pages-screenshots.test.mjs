import test from "node:test";
import assert from "node:assert/strict";

import { candidateUrl } from "../scripts/capture-pages-screenshots.mjs";

test("candidateUrl returns homepage when valid http URL is provided", () => {
  const repo = { homepage: "https://example.com", hasPages: false };
  assert.equal(candidateUrl(repo), "https://example.com");
});

test("candidateUrl returns homepage for http (non-https) URL", () => {
  const repo = { homepage: "http://example.com/project", hasPages: false };
  assert.equal(candidateUrl(repo), "http://example.com/project");
});

test("candidateUrl returns github.io URL when hasPages is true and no homepage", () => {
  const repo = { name: "my-project", homepage: "", hasPages: true };
  assert.equal(candidateUrl(repo), "https://mgifford.github.io/my-project/");
});

test("candidateUrl uses provided owner in github.io URL", () => {
  const repo = { name: "my-project", owner: "customowner", homepage: "", hasPages: true };
  assert.equal(candidateUrl(repo), "https://customowner.github.io/my-project/");
});

test("candidateUrl falls back to mgifford owner when owner is not set", () => {
  const repo = { name: "my-project", homepage: "", hasPages: true };
  assert.ok(candidateUrl(repo).includes("mgifford.github.io"));
});

test("candidateUrl returns empty string when no homepage and hasPages is false", () => {
  const repo = { name: "no-site", homepage: "", hasPages: false };
  assert.equal(candidateUrl(repo), "");
});

test("candidateUrl returns empty string when homepage is null", () => {
  const repo = { name: "no-site", homepage: null, hasPages: false };
  assert.equal(candidateUrl(repo), "");
});

test("candidateUrl prefers homepage over hasPages", () => {
  const repo = {
    name: "both",
    homepage: "https://custom-site.example.com",
    hasPages: true,
    owner: "someowner"
  };
  assert.equal(candidateUrl(repo), "https://custom-site.example.com");
});

test("candidateUrl returns empty string when homepage is a non-http protocol", () => {
  const repo = { name: "ftp-site", homepage: "ftp://example.com", hasPages: false };
  assert.equal(candidateUrl(repo), "");
});

test("candidateUrl returns empty string when homepage is a relative path", () => {
  const repo = { name: "relative", homepage: "/path/to/something", hasPages: false };
  assert.equal(candidateUrl(repo), "");
});
